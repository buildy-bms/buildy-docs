// Store Pinia centralisant l'état d'un audit BACS ouvert.
// Évite le props drilling vers les sous-composants (Inspections, Plan,
// Synthese, et a terme BMS / Systemes / Compteurs / Thermal / Devices).
//
// Les actions encapsulent les appels API + maj du state. La vue parente
// charge un audit via `loadAudit(docId)` et n'a plus a passer le state
// en props : les sous-composants font `const audit = useAuditStore()`.

import { defineStore } from 'pinia'
import {
  getAf, getBacsSystems, getBacsMeters, getBacsBms, getBacsThermal,
  createBacsThermal, deleteBacsThermal,
  getBacsActionItems, getBacsDevices, getBacsPowerSummary,
  getBacsInspections, getBacsPhotoCounts, listZones,
  updateBacsBms, updateBacsActionItem, regenerateBacsActionItems,
  createBacsInspection, updateBacsInspection, deleteBacsInspection,
  getSite, updateSite, getSiteParties,
  getBacsGtbObservations, updateBacsGtbObservation,
} from '@/api'

export const useAuditStore = defineStore('audit', {
  state: () => ({
    docId: null,
    document: null,
    site: null,
    zones: [],
    systems: [],
    meters: [],
    bms: {},
    thermal: [],
    devices: [],
    actionItems: [],
    inspections: [],
    powerSummary: { by_category: {}, heating_cooling_total_kw: 0 },
    auditProgress: {},
    synthesisHtml: '',
    // Counts photos par entité (alimente badges « 📷 N »).
    photoCounts: { zones: {}, systems: {}, meters: {}, devices: {}, bms: 0, site: 0 },
    // Notes par sujet de la carte GTB (mig 109). Tableau de
    // { topic_key, label, observation_html, ... } chargé en parallèle.
    gtbTopicNotes: [],
    // Parties prenantes du site (item 4/5). Source unique partagée : la
    // carte Structure juridique, la section Zones, la base de consommations
    // et la modale d'ajout de zone lisent toutes ce même tableau — évite
    // les listes locales qui se désynchronisaient. Chaque partie porte son
    // `zone_ids` (zones affectées).
    siteParties: [],
    sitePartiesSuggestion: null,
    // loading=true par defaut : evite que les sous-composants ne se
    // montent avec un state non initialise (notamment BmsComponentsTable
    // qui fetcherait avec docId=null sinon). Passe a false a la fin de
    // loadAudit().
    loading: true,
    saving: false,
    // Demande de focus inter-tab : MobileChecklistTab (KPIs) bascule
    // l'onglet et set ce flag, le tab cible (zones / meters / systems)
    // l'observe pour ouvrir directement l'entité, puis le reset.
    pendingFocus: null, // { kind, id } ou null
  }),

  getters: {
    // Le kind 'site_audit' a été supprimé (mig 106) ; tout audit est un
    // bacs_audit. On garde isBacs/isSiteAudit en getter pour compat des
    // composants qui les utilisent en `v-if`/`v-else` jusqu'au nettoyage
    // complet des conditionnelles.
    isBacs: () => true,
    isSiteAudit: () => false,
    siteUuid: (s) => s.document?.site_uuid || null,
    todayIso: () => new Date().toISOString().slice(0, 10),
    latestInspection: (s) => s.inspections[0] || null,
  },

  actions: {
    async loadAudit(docId) {
      // Reset complet entre 2 audits pour eviter le flicker (vue qui
      // affiche brievement les donnees de l'audit precedent avant que les
      // fetches ne completent).
      this.$reset()
      this.docId = docId
      this.loading = true
      try {
        const [d, sys, met, b, t, a] = await Promise.all([
          getAf(docId),
          getBacsSystems(docId),
          getBacsMeters(docId),
          getBacsBms(docId),
          getBacsThermal(docId),
          getBacsActionItems(docId),
        ])
        this.document = d.data
        this.systems = sys.data
        this.meters = met.data
        this.bms = b.data || {}
        this.thermal = t.data
        this.actionItems = a.data
        try { this.auditProgress = JSON.parse(d.data.audit_progress || '{}') }
        catch { this.auditProgress = {} }
        this.synthesisHtml = d.data.audit_synthesis_html || ''
        if (d.data.site_id) {
          try {
            const z = await listZones(d.data.site_id)
            this.zones = z.data
          } catch { this.zones = [] }
        } else {
          this.zones = []
        }
        // Note : on N'utilise PAS de fallback "reconstituer depuis sys.data".
        // Auparavant on faisait ça pour pallier un bug ancien (#63, #65) mais
        // ça causait le bug "zones fantômes" :  si un audit avait des rows
        // bacs_audit_systems orphelines (zone soft-delete ou d'un autre site),
        // le fallback recréait des zones synthétiques que l'utilisateur ne
        // pouvait pas supprimer (DELETE no-op + listZones retourne [] +
        // fallback recrée à chaque load). La table `zones` du site rattaché
        // est désormais l'unique source de vérité (cf. mig 130/131 qui
        // nettoient les rows BACS pointant vers des zones invalides).
        // Charge le site (source de vérité pour l'adresse, le nom client, etc).
        // Évite la duplication site_address dans le document.
        if (d.data.site_uuid) {
          try {
            const s = await getSite(d.data.site_uuid)
            this.site = s.data
          } catch { this.site = null }
        }
        const [dev, ps, ins, pc, gtb, parties] = await Promise.all([
          getBacsDevices(docId),
          getBacsPowerSummary(docId),
          getBacsInspections(docId),
          getBacsPhotoCounts(docId).catch(() => ({ data: { zones: {}, systems: {}, meters: {}, devices: {}, bms: 0, site: 0 } })),
          getBacsGtbObservations(docId).catch(() => ({ data: [] })),
          d.data.site_uuid
            ? getSiteParties(d.data.site_uuid).catch(() => ({ data: { parties: [], suggestion: null } }))
            : Promise.resolve({ data: { parties: [], suggestion: null } }),
        ])
        this.devices = dev.data
        this.powerSummary = ps.data
        this.inspections = ins.data
        this.photoCounts = pc.data
        this.gtbTopicNotes = gtb.data
        this.siteParties = parties.data.parties || []
        this.sitePartiesSuggestion = parties.data.suggestion || null
      } finally {
        this.loading = false
      }
    },

    async refreshActionItems() {
      // On rafraîchit aussi le cumul de puissance : une édition système /
      // device peut faire bouger la puissance retenue (items 5 & 8).
      const [a, ps] = await Promise.all([
        getBacsActionItems(this.docId),
        getBacsPowerSummary(this.docId).catch(() => null),
      ])
      this.actionItems = a.data
      if (ps) this.powerSummary = ps.data
    },

    /**
     * Met à jour un champ du site (adresse, nom client, structure
     * juridique, etc) — la source de vérité est la table `sites`. Les
     * champs synchronisés (adresse…) sont propagés à FM par le worker de
     * sync ; `ownership_structure` / `ownership_notes` (item 4) restent
     * locaux à Buildy Docs (non poussés vers FM).
     */
    async updateSiteFields(patch) {
      const uuid = this.site?.site_uuid || this.site?.uuid || this.document?.site_uuid
      if (!uuid) throw new Error('Site non chargé')
      const { data } = await updateSite(uuid, patch)
      this.site = data
    },

    async refreshInspections() {
      const r = await getBacsInspections(this.docId)
      this.inspections = r.data
    },

    async refreshThermal() {
      const r = await getBacsThermal(this.docId)
      this.thermal = r.data
    },

    // Recharge les parties prenantes du site (avec leurs zones affectées).
    // Appelée après toute modification des liens partie ↔ zone pour garder
    // la carte Structure juridique et la section Zones synchronisées.
    async refreshSiteParties() {
      const uuid = this.site?.site_uuid || this.site?.uuid || this.document?.site_uuid
      if (!uuid) { this.siteParties = []; return }
      try {
        const { data } = await getSiteParties(uuid)
        this.siteParties = data.parties || []
        this.sitePartiesSuggestion = data.suggestion || null
      } catch { /* garde la liste existante en cas d'échec réseau */ }
    },

    /**
     * Régulation thermique multi-systèmes (mig 170) : une zone peut être
     * desservie par plusieurs systèmes de chauffage / refroidissement, chacun
     * avec son libellé. `addThermalEntry` crée une entrée supplémentaire,
     * `removeThermalEntry` la supprime. Les deux régénèrent le plan d'action.
     */
    async addThermalEntry({ zone_id, category, label }) {
      const { data } = await createBacsThermal(this.docId, { zone_id, category, label: label || null })
      this.thermal.push(data)
      await this.refreshActionItems()
      return data
    },

    async removeThermalEntry(id) {
      await deleteBacsThermal(id)
      this.thermal = this.thermal.filter(t => t.id !== id)
      await this.refreshActionItems()
    },

    async refreshAuditCore() {
      const [s, t, a, dev, ps, m, pc] = await Promise.all([
        getBacsSystems(this.docId), getBacsThermal(this.docId),
        getBacsActionItems(this.docId), getBacsDevices(this.docId),
        getBacsPowerSummary(this.docId), getBacsMeters(this.docId),
        getBacsPhotoCounts(this.docId).catch(() => ({ data: { zones: {}, systems: {}, meters: {}, devices: {}, bms: 0, site: 0 } })),
      ])
      this.systems = s.data
      this.thermal = t.data
      this.actionItems = a.data
      this.devices = dev.data
      this.powerSummary = ps.data
      this.meters = m.data
      this.photoCounts = pc.data
    },

    /**
     * Rafraîchit l'audit complet (document + entités) sans repasser par
     * le `$reset` qui causerait un flash UI. Utilisé pour la sync
     * desktop ↔ PWA : revalidation au focus + polling 30 s. Toutes les
     * sous-vues qui lisent le store via `storeToRefs` se mettent à jour
     * en place sans démontage.
     */
    async softRefresh() {
      if (!this.docId) return
      try {
        const d = await getAf(this.docId)
        // on ne remplace que les champs métier qui peuvent évoluer côté
        // un autre client (statut, métadonnées, synthèse, progression).
        if (this.document) {
          Object.assign(this.document, d.data)
        } else {
          this.document = d.data
        }
        try { this.auditProgress = JSON.parse(d.data.audit_progress || '{}') }
        catch { /* keep previous */ }
        this.synthesisHtml = d.data.audit_synthesis_html || this.synthesisHtml
        const [bms] = await Promise.all([
          getBacsBms(this.docId),
        ])
        this.bms = bms.data || {}
        // Rafraîchit aussi les zones (sinon une zone créée/supprimée côté
        // desktop n'apparaît pas en PWA tant qu'on ne reload pas la page).
        if (d.data.site_id) {
          try {
            const z = await listZones(d.data.site_id)
            this.zones = z.data
          } catch { /* on garde les zones existantes en cas d'echec */ }
        }
        await this.refreshAuditCore()
        await this.refreshInspections()
      } catch { /* network glitch — silencieux, sera retenté au prochain tick */ }
    },

    async addInspection() {
      await createBacsInspection(this.docId, {})
      await this.refreshInspections()
      await this.refreshActionItems()
    },

    async patchInspection(ins, patch) {
      Object.assign(ins, patch)
      await updateBacsInspection(ins.id, patch)
      await this.refreshActionItems()
    },

    async removeInspection(id) {
      await deleteBacsInspection(id)
      await this.refreshInspections()
      await this.refreshActionItems()
    },

    async patchActionItem(item, patch) {
      const { data } = await updateBacsActionItem(item.id, patch)
      Object.assign(item, data)
    },

    async regenerateActions() {
      await regenerateBacsActionItems(this.docId)
      await this.refreshActionItems()
    },

    // Fire-and-forget : on déclenche le PATCH GTB sans attendre la réponse
    // serveur. L'état local (`this.bms`) a déjà été muté en synchrone côté
    // composant (via Object.assign / affectation directe sur le state Pinia),
    // donc l'UI a déjà réagi. Le refresh du plan d'action + cumul puissance
    // est debouncé 800 ms via `scheduleActionItemsRefresh` pour ne déclencher
    // qu'un seul recalcul après une rafale de clics — cf. memoire
    // `feedback_audit_perf_no_blocking_patch`. Avant ce fix, chaque toggle
    // GTB enchainait await PATCH + await refreshActionItems (2 GET + Vue
    // re-render lourd), figeant l'UI plusieurs centaines de ms.
    saveBms() {
      const p = updateBacsBms(this.docId, this.bms)
      p.then(() => this.scheduleActionItemsRefresh()).catch(() => {})
      return p
    },

    // Debounce centralisé du refresh action items + power summary. Utilisé
    // par les patch* GTB / device / meter pour mutualiser une seule rafale
    // de refresh quand l'auditeur enchaîne 10-20 toggles.
    scheduleActionItemsRefresh() {
      if (this._actionItemsRefreshTimer) clearTimeout(this._actionItemsRefreshTimer);
      this._actionItemsRefreshTimer = setTimeout(() => {
        this.refreshActionItems().catch(() => {})
      }, 800)
    },

    /**
     * Sauvegarde la note d'un sujet de la carte GTB (mig 109).
     * Met à jour le state local en place pour refléter immédiatement
     * la nouvelle pastille « note présente » sur le bouton.
     */
    async saveGtbTopicNote(topicKey, html) {
      await updateBacsGtbObservation(this.docId, topicKey, { observation_html: html || null })
      const item = this.gtbTopicNotes.find(t => t.topic_key === topicKey)
      if (item) item.observation_html = html || null
    },

    setSynthesisHtml(html) { this.synthesisHtml = html },
    setAuditProgress(progress) { this.auditProgress = progress || {} },
    setDocument(doc) { this.document = doc },
  },
})
