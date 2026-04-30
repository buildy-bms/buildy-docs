import axios from 'axios'
import router, { resetAuth } from '@/router'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

const PUBLIC_PATHS = ['/login']

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const onPublicPage = PUBLIC_PATHS.some((p) => window.location.pathname.startsWith(p))
    if (err.response?.status === 401 && !onPublicPage) {
      resetAuth()
      router.push('/login')
    }
    return Promise.reject(err)
  }
)

// ── AFs ──
export const listAfs = (params) => api.get('/afs', { params })
export const getAfsStats = () => api.get('/afs/stats')
export const getAf = (id) => api.get(`/afs/${id}`)
export const createAf = (data) => api.post('/afs', data)
export const updateAf = (id, data) => api.patch(`/afs/${id}`, data)
export const deleteAf = (id) => api.delete(`/afs/${id}`)
export const cloneAf = (id, data) => api.post(`/afs/${id}/clone`, data)
export const getAfAudit = (id) => api.get(`/afs/${id}/audit`)
export const getAfTemplateUpdates = (id) => api.get(`/afs/${id}/template-updates`)
export const listAfInstances = (afId) => api.get(`/afs/${afId}/instances`)
export const getAfRequiredLevel = (id, excludedIds = []) =>
  api.get(`/afs/${id}/required-level`, { params: excludedIds.length ? { excluded: excludedIds.join(',') } : {} })

// ── Sections ──
export const listSections = (afId) => api.get(`/afs/${afId}/sections`)
export const getSection = (id) => api.get(`/sections/${id}`)
export const updateSection = (id, data) => api.patch(`/sections/${id}`, data)
export const createSection = (afId, data) => api.post(`/afs/${afId}/sections`, data)
export const deleteSection = (id) => api.delete(`/sections/${id}`)
export const getSectionPoints = (id) => api.get(`/sections/${id}/points`)
export const addSectionOverride = (id, data) => api.post(`/sections/${id}/overrides`, data)
export const deleteSectionOverride = (sectionId, overrideId) =>
  api.delete(`/sections/${sectionId}/overrides/${overrideId}`)
export const listSectionInstances = (id) => api.get(`/sections/${id}/instances`)
export const getSectionTemplateUpdate = (id) => api.get(`/sections/${id}/template-update`)
export const applySectionTemplateUpdate = (id) => api.post(`/sections/${id}/template-update/apply`)
export const dismissSectionTemplateUpdate = (id) => api.post(`/sections/${id}/template-update/dismiss`)
export const addSectionInstance = (id, data) => api.post(`/sections/${id}/instances`, data)
export const updateInstance = (id, data) => api.patch(`/instances/${id}`, data)
export const deleteInstance = (id) => api.delete(`/instances/${id}`)
export const listInstanceZones = (id) => api.get(`/instances/${id}/zones`)
export const setInstanceZones = (id, zone_ids) => api.put(`/instances/${id}/zones`, { zone_ids })
export const listInstanceCategories = (id) => api.get(`/instances/${id}/categories`)
export const setInstanceCategories = (id, category_keys) => api.put(`/instances/${id}/categories`, { category_keys })
export const listSystemCategories = () => api.get('/system-categories')
export const createSystemCategory = (data) => api.post('/system-categories', data)
export const updateSystemCategory = (id, data) => api.patch(`/system-categories/${id}`, data)
export const deleteSystemCategory = (id) => api.delete(`/system-categories/${id}`)
export const listAfAllZones = (afId) => api.get(`/afs/${afId}/all-zones`)
export const getAfZonesMatrix = (afId) => api.get(`/afs/${afId}/zones-matrix`)

// ── Attachments ──
export const listSectionAttachments = (id) => api.get(`/sections/${id}/attachments`)
export const uploadSectionAttachment = (id, file, onProgress) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post(`/sections/${id}/attachments`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: onProgress,
  })
}
export const updateAttachment = (id, data) => api.patch(`/attachments/${id}`, data)
export const reorderAttachments = (sectionId, order) =>
  api.post(`/sections/${sectionId}/attachments/reorder`, { order })
export const deleteAttachment = (id) => api.delete(`/attachments/${id}`)
export const moveAttachment = (id, targetSectionId) =>
  api.post(`/attachments/${id}/move`, { section_id: targetSectionId })

// Captures rattachees a un section_template (heritees automatiquement par
// toutes les sections AF qui referencent ce template).
export const listSectionTemplateAttachments = (id) => api.get(`/section-templates/${id}/attachments`)
export const uploadSectionTemplateAttachment = (id, file, onProgress) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post(`/section-templates/${id}/attachments`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: onProgress,
  })
}
export const reorderSectionTemplateAttachments = (id, order) =>
  api.post(`/section-templates/${id}/attachments/reorder`, { order })

// Captures rattachees a un equipment_template.
export const listEquipmentTemplateAttachments = (id) => api.get(`/equipment-templates/${id}/attachments`)
export const uploadEquipmentTemplateAttachment = (id, file, onProgress) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post(`/equipment-templates/${id}/attachments`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: onProgress,
  })
}
export const reorderEquipmentTemplateAttachments = (id, order) =>
  api.post(`/equipment-templates/${id}/attachments/reorder`, { order })

// ── Exports ──
export const listAfExports = (afId) => api.get(`/afs/${afId}/exports`)
export const exportPointsList = (afId, data) =>
  api.post(`/afs/${afId}/exports/points-list`, data)
export const exportAf = (afId, data) =>
  api.post(`/afs/${afId}/exports/af`, data) // data: { motif, includeBacsAnnex }
export const exportSynthesis = (afId, data) =>
  api.post(`/afs/${afId}/exports/synthesis`, data)
export const downloadExportUrl = (id) => `/api/exports/${id}/download`

// ── Permissions AF (Lot 28) ──
export const listAfPermissions = (afId) => api.get(`/afs/${afId}/permissions`)
export const grantAfPermission = (afId, user_id, role) => api.post(`/afs/${afId}/permissions`, { user_id, role })
export const revokeAfPermission = (afId, userId) => api.delete(`/afs/${afId}/permissions/${userId}`)
export const listUsers = (q) => api.get('/users', { params: q ? { q } : {} })

// ── BACS articles (statique) ──
let _bacsCache = null
export async function getBacsArticles() {
  if (_bacsCache) return _bacsCache
  const { data } = await api.get('/bacs/articles')
  _bacsCache = data
  return data
}

// ── Recherche ──
export const search = (q, params = {}) => api.get('/search', { params: { q, ...params } })

// ── Versions Git ──
export const listAfVersions = (afId) => api.get(`/afs/${afId}/versions`)
export const getAfVersionsDiff = (afId, from, to) =>
  api.get(`/afs/${afId}/versions/diff`, { params: { from, to } })
export const restoreAfVersion = (afId, sha) =>
  api.post(`/afs/${afId}/versions/restore`, { sha })
export const checkpointAf = (afId, message, tag) =>
  api.post(`/afs/${afId}/versions/checkpoint`, { message, tag })

// ── Equipment templates (bibliothèque) ──
export const listEquipmentTemplates = (params) => api.get('/equipment-templates', { params })
export const getEquipmentTemplate = (id) => api.get(`/equipment-templates/${id}`)
export const createEquipmentTemplate = (data) => api.post('/equipment-templates', data)
export const updateEquipmentTemplate = (id, data) => api.patch(`/equipment-templates/${id}`, data)
export const deleteEquipmentTemplate = (id) => api.delete(`/equipment-templates/${id}`)
export const addTemplatePoint = (templateId, data) =>
  api.post(`/equipment-templates/${templateId}/points`, data)
export const updateTemplatePoint = (templateId, pointId, data) =>
  api.patch(`/equipment-templates/${templateId}/points/${pointId}`, data)
export const deleteTemplatePoint = (templateId, pointId) =>
  api.delete(`/equipment-templates/${templateId}/points/${pointId}`)
// reorderTemplatePoints({ ids: [...] }) — reordonne dans une direction
export const reorderTemplatePoints = (templateId, ids) =>
  api.patch(`/equipment-templates/${templateId}/points/reorder`, { ids })
export const getTemplateVersions = (id) => api.get(`/equipment-templates/${id}/versions`)
export const getTemplateAffectedAfs = (id) => api.get(`/equipment-templates/${id}/affected-afs`)

// ── Section templates (bibliothèque "Sections types" + "Fonctionnalités") ──
export const listSectionTemplates = ({ kind, tree } = {}) =>
  api.get('/section-templates', { params: { ...(kind ? { kind } : {}), ...(tree ? { tree: 1 } : {}) } })
export const getSectionTemplate = (id) => api.get(`/section-templates/${id}`)
export const createSectionTemplate = (data) => api.post('/section-templates', data)
export const updateSectionTemplate = (id, data) =>
  api.patch(`/section-templates/${id}`, data)
export const deleteSectionTemplate = (id, { force = false } = {}) =>
  api.delete(`/section-templates/${id}`, { params: force ? { force: 1 } : {} })
// reorder({ ids, parent_template_id? }). parent_template_id si re-parenting drag-drop.
export const reorderSectionTemplates = ({ ids, parent_template_id } = {}) =>
  api.patch('/section-templates/reorder', { ids, ...(parent_template_id !== undefined ? { parent_template_id } : {}) })

// ── Audit trail (logs globaux d'activite) ──
export const listAuditLog = (params) => api.get('/audit-log', { params })
export const listAuditActions = () => api.get('/audit-log/actions')

// ── Claude (assistant redaction bibliotheque) ──
// payload : { mode, kind, title?, html?, parent_path?, category_label?,
//             bacs_articles?, avail_e?, avail_s?, avail_p? }
export const claudeLibraryAssist = (payload) =>
  api.post('/claude/library-assist', payload)

// ── Sites (synchro bidirectionnelle Fleet Manager) ──
export const listSites = (params) => api.get('/sites', { params })
export const getSite = (uuid) => api.get(`/sites/${uuid}`)
export const createSite = (data) => api.post('/sites', data)
export const updateSite = (uuid, data) => api.patch(`/sites/${uuid}`, data)
export const deleteSite = (uuid) => api.delete(`/sites/${uuid}`)

// ── Audit BACS — donnees structurees ──
export const getBacsSystems = (docId) => api.get(`/bacs-audit/${docId}/systems`)
export const updateBacsSystem = (id, data) => api.patch(`/bacs-audit/systems/${id}`, data)
export const getBacsMeters = (docId) => api.get(`/bacs-audit/${docId}/meters`)
export const createBacsMeter = (docId, data) => api.post(`/bacs-audit/${docId}/meters`, data)
export const updateBacsMeter = (id, data) => api.patch(`/bacs-audit/meters/${id}`, data)
export const deleteBacsMeter = (id) => api.delete(`/bacs-audit/meters/${id}`)
export const getBacsBms = (docId) => api.get(`/bacs-audit/${docId}/bms`)
export const updateBacsBms = (docId, data) => api.put(`/bacs-audit/${docId}/bms`, data)
export const getBacsThermal = (docId) => api.get(`/bacs-audit/${docId}/thermal-regulation`)
export const updateBacsThermal = (id, data) => api.patch(`/bacs-audit/thermal-regulation/${id}`, data)
export const getBacsActionItems = (docId, params) =>
  api.get(`/bacs-audit/${docId}/action-items`, { params })
export const createBacsActionItem = (docId, data) =>
  api.post(`/bacs-audit/${docId}/action-items`, data)
export const updateBacsActionItem = (id, data) =>
  api.patch(`/bacs-audit/action-items/${id}`, data)
export const deleteBacsActionItem = (id) => api.delete(`/bacs-audit/action-items/${id}`)
export const regenerateBacsActionItems = (docId) =>
  api.post(`/bacs-audit/${docId}/action-items/regenerate`)
export const getBacsActionItemsCsvUrl = (docId) =>
  `/api/bacs-audit/${docId}/action-items/export.csv`

// ── Site-zones (locales Buildy Docs, attachees a un site) ──
// Note : namespace `/site-zones` plutot que `/zones` car les routes /zones
// sont deja prises par les af_zones legacy (routes/sections.js). Sera
// renomme en /zones a la migration 35 quand on dropera af_zones.
export const listZones = (siteId) => api.get('/site-zones', { params: { site_id: siteId } })
export const getZone = (id) => api.get(`/site-zones/${id}`)
export const createZone = (data) => api.post('/site-zones', data)
export const updateZone = (id, data) => api.patch(`/site-zones/${id}`, data)
export const deleteZone = (id) => api.delete(`/site-zones/${id}`)

// ── Equipements (et compteurs) ──
export const listEquipments = ({ zoneId, siteId } = {}) =>
  api.get('/equipments', { params: { zone_id: zoneId, site_id: siteId } })
export const getEquipment = (id) => api.get(`/equipments/${id}`)
export const createEquipment = (data) => api.post('/equipments', data)
export const updateEquipment = (id, data) => api.patch(`/equipments/${id}`, data)
export const deleteEquipment = (id) => api.delete(`/equipments/${id}`)
export const getBacsPowerCumul = (siteId) =>
  api.get('/equipments/bacs-power-cumul', { params: { site_id: siteId } })

export default api
