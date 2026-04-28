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

// ── Inspections BACS ──
export const listInspections = (afId) => api.get(`/afs/${afId}/inspections`)
export const createInspection = (afId, data) =>
  api.post(`/afs/${afId}/inspections`, data) // { inspector_name, notes? }

// ── Equipment templates (bibliothèque) ──
export const listEquipmentTemplates = (params) => api.get('/equipment-templates', { params })
export const getEquipmentTemplate = (id) => api.get(`/equipment-templates/${id}`)
export const createEquipmentTemplate = (data) => api.post('/equipment-templates', data)
export const updateEquipmentTemplate = (id, data) => api.patch(`/equipment-templates/${id}`, data)
export const deleteEquipmentTemplate = (id) => api.delete(`/equipment-templates/${id}`)
export const addTemplatePoint = (templateId, data) =>
  api.post(`/equipment-templates/${templateId}/points`, data)
export const deleteTemplatePoint = (templateId, pointId) =>
  api.delete(`/equipment-templates/${templateId}/points/${pointId}`)
export const getTemplateVersions = (id) => api.get(`/equipment-templates/${id}/versions`)
export const getTemplateAffectedAfs = (id) => api.get(`/equipment-templates/${id}/affected-afs`)

// ── Section templates (bibliothèque "Sections types" + "Fonctionnalités") ──
export const listSectionTemplates = ({ kind } = {}) =>
  api.get('/section-templates', { params: kind ? { kind } : {} })
export const getSectionTemplate = (id) => api.get(`/section-templates/${id}`)
export const createSectionTemplate = (data) => api.post('/section-templates', data)
export const updateSectionTemplate = (id, data, { propagateUnchanged = false } = {}) =>
  api.patch(`/section-templates/${id}`, data, { params: propagateUnchanged ? { propagate_unchanged: 1 } : {} })
export const deleteSectionTemplate = (id) => api.delete(`/section-templates/${id}`)
export const reorderSectionTemplates = (ids) => api.patch('/section-templates/reorder', { ids })

export default api
