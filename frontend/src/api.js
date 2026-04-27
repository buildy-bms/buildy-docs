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

// ── Sections ──
export const listSections = (afId) => api.get(`/afs/${afId}/sections`)
export const getSection = (id) => api.get(`/sections/${id}`)
export const updateSection = (id, data) => api.patch(`/sections/${id}`, data)
export const getSectionPoints = (id) => api.get(`/sections/${id}/points`)
export const addSectionOverride = (id, data) => api.post(`/sections/${id}/overrides`, data)
export const deleteSectionOverride = (sectionId, overrideId) =>
  api.delete(`/sections/${sectionId}/overrides/${overrideId}`)
export const listSectionInstances = (id) => api.get(`/sections/${id}/instances`)
export const addSectionInstance = (id, data) => api.post(`/sections/${id}/instances`, data)
export const updateInstance = (id, data) => api.patch(`/instances/${id}`, data)
export const deleteInstance = (id) => api.delete(`/instances/${id}`)

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

export default api
