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
  getBacsActionItems, getBacsDevices, getBacsPowerSummary,
  getBacsInspections, getBacsPhotoCounts, listZones,
  updateBacsBms, updateBacsActionItem, regenerateBacsActionItems,
  createBacsInspection, updateBacsInspection, deleteBacsInspection,
  getSite, updateSite,
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
    photoCounts: { zones: {}, systems: {}, meters: {}, devices: {}, bms: 0 },
    // Notes par sujet de la carte GTB (mig 109). Tableau de
    // { topic_key, label, observation_html, ... } chargé en parallèle.
    gtbTopicNotes: [],
    // loading=true par defaut : evite que les sous-composants ne se
    // montent avec un state non initialise (notamment BmsComponentsTable
    // qui fetcherait avec docId=null sinon). Passe a false a la fin de
    // loadAudit().
    loading: true,
    saving: false,
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
        }
        // Fallback : si l'audit n'a pas de site rattaché OU si listZones a
        // échoué, on reconstitue les zones depuis les systèmes de l'audit
        // (chaque système porte zone_id + zone_name via JOIN backend). Sans
        // ça, toute la card 02 « usages homogènes » et tout composant qui
        // lit audit.zones reste vide alors que les zones existent en DB.
        if (!this.zones?.length && sys.data?.length) {
          const map = new Map()
          for (const s of sys.data) {
            if (s.zone_id != null && !map.has(s.zone_id)) {
              map.set(s.zone_id, {
                zone_id: s.zone_id,
                name: s.zone_name || `Zone #${s.zone_id}`,
                nature: s.zone_nature || null,
              })
            }
          }
          this.zones = [...map.values()]
        }
        // Charge le site (source de vérité pour l'adresse, le nom client, etc).
        // Évite la duplication site_address dans le document.
        if (d.data.site_uuid) {
          try {
            const s = await getSite(d.data.site_uuid)
            this.site = s.data
          } catch { this.site = null }
        }
        const [dev, ps, ins, pc, gtb] = await Promise.all([
          getBacsDevices(docId),
          getBacsPowerSummary(docId),
          getBacsInspections(docId),
          getBacsPhotoCounts(docId).catch(() => ({ data: { zones: {}, systems: {}, meters: {}, devices: {}, bms: 0 } })),
          getBacsGtbObservations(docId).catch(() => ({ data: [] })),
        ])
        this.devices = dev.data
        this.powerSummary = ps.data
        this.inspections = ins.data
        this.photoCounts = pc.data
        this.gtbTopicNotes = gtb.data
      } finally {
        this.loading = false
      }
    },

    async refreshActionItems() {
      const a = await getBacsActionItems(this.docId)
      this.actionItems = a.data
    },

    /**
     * Met à jour un champ du site (adresse, nom client, etc) — la source
     * de vérité est la table `sites`, propagée à FM via la sync. Les
     * documents héritent de ces valeurs et ne stockent pas de duplicata.
     */
    async updateSiteFields(patch) {
      if (!this.site?.uuid) throw new Error('Site non chargé')
      const { data } = await updateSite(this.site.uuid, patch)
      this.site = data
    },

    async refreshInspections() {
      const r = await getBacsInspections(this.docId)
      this.inspections = r.data
    },

    async refreshAuditCore() {
      const [s, t, a, dev, ps, m, pc] = await Promise.all([
        getBacsSystems(this.docId), getBacsThermal(this.docId),
        getBacsActionItems(this.docId), getBacsDevices(this.docId),
        getBacsPowerSummary(this.docId), getBacsMeters(this.docId),
        getBacsPhotoCounts(this.docId).catch(() => ({ data: { zones: {}, systems: {}, meters: {}, devices: {}, bms: 0 } })),
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

    async saveBms() {
      await updateBacsBms(this.docId, this.bms)
      await this.refreshActionItems()
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
