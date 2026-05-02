// Store Pinia centralisant l'état d'un audit BACS / site_audit ouvert.
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
  getBacsAuditRefs, getBacsInspections, listZones,
  updateBacsBms, updateBacsActionItem, regenerateBacsActionItems,
  createBacsInspection, updateBacsInspection, deleteBacsInspection,
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
    auditRefs: { zones: {}, systems: {}, devices: {}, meters: {}, thermal: {} },
    auditProgress: {},
    synthesisHtml: '',
    loading: false,
    saving: false,
  }),

  getters: {
    isBacs: (s) => s.document?.kind === 'bacs_audit',
    isSiteAudit: (s) => s.document?.kind === 'site_audit',
    siteUuid: (s) => s.document?.site_uuid || null,
    todayIso: () => new Date().toISOString().slice(0, 10),
    latestInspection: (s) => s.inspections[0] || null,
    refOf: (s) => (kind, id) => s.auditRefs?.[kind]?.[id] || '',
  },

  actions: {
    async loadAudit(docId) {
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
          const z = await listZones(d.data.site_id)
          this.zones = z.data
        }
        const [dev, ps, refs, ins] = await Promise.all([
          getBacsDevices(docId),
          getBacsPowerSummary(docId),
          getBacsAuditRefs(docId),
          getBacsInspections(docId),
        ])
        this.devices = dev.data
        this.powerSummary = ps.data
        this.auditRefs = refs.data
        this.inspections = ins.data
      } finally {
        this.loading = false
      }
    },

    async refreshActionItems() {
      const a = await getBacsActionItems(this.docId)
      this.actionItems = a.data
    },

    async refreshInspections() {
      const r = await getBacsInspections(this.docId)
      this.inspections = r.data
    },

    async refreshAuditCore() {
      const [s, t, a, dev, ps, m, refs] = await Promise.all([
        getBacsSystems(this.docId), getBacsThermal(this.docId),
        getBacsActionItems(this.docId), getBacsDevices(this.docId),
        getBacsPowerSummary(this.docId), getBacsMeters(this.docId),
        getBacsAuditRefs(this.docId),
      ])
      this.systems = s.data
      this.thermal = t.data
      this.actionItems = a.data
      this.devices = dev.data
      this.powerSummary = ps.data
      this.meters = m.data
      this.auditRefs = refs.data
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

    setSynthesisHtml(html) { this.synthesisHtml = html },
    setAuditProgress(progress) { this.auditProgress = progress || {} },
    setDocument(doc) { this.document = doc },
  },
})
