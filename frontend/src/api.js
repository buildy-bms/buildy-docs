import axios from 'axios'
import router, { resetAuth } from '@/router'
import { isQueueable, enqueue } from '@/lib/offline-queue'
import { notifySaveStart, notifySaveEnd } from '@/composables/useGlobalSaveStatus'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

const PUBLIC_PATHS = ['/login']

// Suivi global des écritures audit/AF — alimente l'indicateur unique
// dans la toolbar (« Sauvegarde… » / « Tout enregistré »). On `start`
// au request et `end` au response (succès ou échec). Inflight count
// + dernier état persistent dans le composable singleton.
api.interceptors.request.use((cfg) => {
  notifySaveStart(cfg.method, cfg.url)
  const queueable = isQueueable(
    cfg.method, cfg.url,
    cfg.headers?.['Content-Type'] || cfg.headers?.['content-type'],
  )
  if (queueable) {
    // Les mutations audit sont de petits PATCH/POST : si rien ne répond
    // en 12 s c'est qu'on est hors-ligne. Sans ce timeout, iOS PWA peut
    // laisser la requête « pendre » 30 s+ et l'indicateur reste bloqué
    // sur « Sauvegarde… ». Le timeout local n'affecte pas les requêtes
    // longues (export PDF, etc.) qui ne sont pas queueables.
    cfg.timeout = 12000
    // Hors-ligne détecté de façon fiable : on ne tente même pas le
    // réseau, on rejette tout de suite — l'interceptor de réponse route
    // ça vers la queue offline comme une erreur réseau classique.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const offlineErr = new Error('offline (navigator.onLine=false)')
      offlineErr.config = cfg
      return Promise.reject(offlineErr)
    }
  }
  return cfg
})

api.interceptors.response.use(
  (res) => {
    notifySaveEnd(res.config?.method, res.config?.url, { ok: true })
    return res
  },
  async (err) => {
    const onPublicPage = PUBLIC_PATHS.some((p) => window.location.pathname.startsWith(p))
    if (err.response?.status === 401 && !onPublicPage) {
      resetAuth()
      router.push('/login')
    }
    // Mig PR-E (offline-first PWA) : si on perd le réseau pendant un
    // PATCH/POST/DELETE sur une route audit, on push la mutation dans
    // une queue localStorage et on retourne au caller un mock 202
    // (acceptée pour replay ultérieur). Le store optimistic update
    // reste valide. Au retour en ligne, useOfflineQueue déclenche le
    // drain qui rejoue dans l'ordre. Les mutations marquées
    // `_isOfflineReplay` ne sont pas re-queueables (anti-boucle).
    const cfg = err.config || {}
    const isNetwork = !err.response
    // iOS Safari (surtout PWA standalone) ne flippe pas toujours
    // `navigator.onLine` à false au moment du fail — on considère donc
    // toute erreur sans response comme un signal offline pour les
    // routes queueables. C'est plus permissif que la version 1 qui
    // exigeait `!navigator.onLine`, et c'est ce qui permet à la queue
    // de s'enclencher sur device réel.
    if (
      isNetwork
      && !cfg._isOfflineReplay
      && isQueueable(cfg.method, cfg.url, cfg.headers?.['Content-Type'] || cfg.headers?.['content-type'])
    ) {
      const queued = enqueue({
        method: cfg.method, url: cfg.url, data: cfg.data ? safeParseJson(cfg.data) : null,
        headers: extractCustomHeaders(cfg.headers),
      })
      // Du point de vue du caller, c'est un succès (la mutation sera
      // rejouée). On marque l'indicateur global comme `saved` pour
      // ne pas signaler une fausse erreur.
      notifySaveEnd(cfg.method, cfg.url, { ok: true })
      return {
        status: 202,
        statusText: 'Accepted (queued offline)',
        data: { _queued: true, _localId: queued.id },
        headers: {},
        config: cfg,
      }
    }
    notifySaveEnd(cfg.method, cfg.url, { ok: false, error: err })
    return Promise.reject(err)
  }
)

// axios sérialise data en JSON-string sur les requêtes JSON. On reparse
// pour stocker proprement en localStorage (si on garde la string brute,
// au replay axios la re-stringify et ça donne `"\"...\""`).
function safeParseJson(raw) {
  if (typeof raw !== 'string') return raw
  try { return JSON.parse(raw) } catch { return raw }
}
// On ne stocke que les headers custom utiles ; les headers axios
// internes (Content-Type, Accept, Cookie…) seront re-générés au replay.
function extractCustomHeaders(headers) {
  if (!headers) return null
  const out = {}
  for (const k of Object.keys(headers)) {
    if (/^x-/i.test(k)) out[k] = headers[k]
  }
  return Object.keys(out).length ? out : null
}

// ── AFs ──
export const listAfs = (params) => api.get('/afs', { params })
export const getAfsStats = () => api.get('/afs/stats')
export const getAf = (id) => api.get(`/afs/${id}`)
export const createAf = (data) => api.post('/afs', data)
export const updateAf = (id, data) => api.patch(`/afs/${id}`, data)
// Preview des sections candidates a l'auto opt-out pour un niveau cible
export const previewAfAutoOptOut = (id, level) =>
  api.get(`/afs/${id}/auto-opt-out-preview`, { params: { level } })
// Applique l'auto opt-out sur les sections au-dessus du niveau cible
export const applyAfAutoOptOut = (id, level) =>
  api.post(`/afs/${id}/auto-opt-out`, { level })
export const deleteAf = (id) => api.delete(`/afs/${id}`)
export const cloneAf = (id, data) => api.post(`/afs/${id}/clone`, data)
export const getAfAudit = (id) => api.get(`/afs/${id}/audit`)
export const getAfTemplateUpdates = (id) => api.get(`/afs/${id}/template-updates`)
export const syncAfFromLibrary = (id, { overwriteBodies = false } = {}) =>
  api.post(`/afs/${id}/sync-library`, { overwrite_bodies: overwriteBodies })
export const listAfInstances = (afId) => api.get(`/afs/${afId}/instances`)
export const listAfPoints = (afId) => api.get(`/afs/${afId}/points`)
export const getAfRequiredLevel = (id, excludedIds = []) =>
  api.get(`/afs/${id}/required-level`, { params: excludedIds.length ? { excluded: excludedIds.join(',') } : {} })

// ── Sections ──
// listSections : `light=1` omet body_html / body_yjs pour accelerer l'init
// load de l'AF (le body est rapatrie a la selection via getSection).
export const listSections = (afId, { light = false } = {}) =>
  api.get(`/afs/${afId}/sections`, { params: light ? { light: 1 } : {} })
export const getSection = (id) => api.get(`/sections/${id}`)
export const updateSection = (id, data) => api.patch(`/sections/${id}`, data)
export const createSection = (afId, data) => api.post(`/afs/${afId}/sections`, data)
export const deleteSection = (id) => api.delete(`/sections/${id}`)
// Lot — Déplace une section dans sa fratrie (up/down).
export const moveSection = (id, direction) => api.post(`/sections/${id}/move`, { direction })
// Lot — Reorder atomique d'une fratrie de sections AF via drag-drop.
// payload : { parent_id: number|null, ids: [...] }
export const reorderAfSections = (afId, payload) =>
  api.post(`/afs/${afId}/sections/reorder`, payload)
export const getSectionPoints = (id) => api.get(`/sections/${id}/points`)
export const addSectionOverride = (id, data) => api.post(`/sections/${id}/overrides`, data)
export const deleteSectionOverride = (sectionId, overrideId) =>
  api.delete(`/sections/${sectionId}/overrides/${overrideId}`)
export const listSectionInstances = (id) => api.get(`/sections/${id}/instances`)
export const getSectionTemplateUpdate = (id) => api.get(`/sections/${id}/template-update`)
// parts : ['bacs', 'fonctionnel', 'points'] (cf. SectionSyncModal).
// Si null, sync legacy (= 'fonctionnel' par defaut backend).
export const applySectionTemplateUpdate = (id, parts = null) =>
  api.post(`/sections/${id}/template-update/apply`, parts ? { parts } : {})
export const dismissSectionTemplateUpdate = (id) => api.post(`/sections/${id}/template-update/dismiss`)
// Insere un section_template manquant dans une AF (source 'new_section' / 'new_functionality')
export const addMissingTemplateToAf = (afId, templateId) =>
  api.post(`/afs/${afId}/template-updates/add-missing/${templateId}`)
export const addSectionInstance = (id, data) => api.post(`/sections/${id}/instances`, data)
export const updateInstance = (id, data) => api.patch(`/instances/${id}`, data)
export const duplicateInstance = (id) => api.post(`/instances/${id}/duplicate`)
export const deleteInstance = (id) => api.delete(`/instances/${id}`)
export const duplicateAfZone = (id) => api.post(`/zones/${id}/duplicate`)
export const listInstanceZones = (id) => api.get(`/instances/${id}/zones`)
export const setInstanceZones = (id, zone_ids) => api.put(`/instances/${id}/zones`, { zone_ids })
export const listInstanceCategories = (id) => api.get(`/instances/${id}/categories`)
export const setInstanceCategories = (id, category_keys) => api.put(`/instances/${id}/categories`, { category_keys })
export const listSystemCategories = () => api.get('/system-categories')
export const createSystemCategory = (data) => api.post('/system-categories', data)
export const updateSystemCategory = (id, data) => api.patch(`/system-categories/${id}`, data)
export const getSystemCategoryUsage = (id) => api.get(`/system-categories/${id}/usage`)
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

// Historique des versions du body_html d'un section_template (pour
// restaurer un texte ecrase depuis la modale d'edition).
export const listSectionTemplateVersions = (id) => api.get(`/section-templates/${id}/versions`)
export const getSectionTemplateVersion = (id, versionId) =>
  api.get(`/section-templates/${id}/versions/${versionId}`)

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
// URLs preview HTML (rendu Handlebars sans Puppeteer, pour iframe)
export const previewAfUrl = (afId, includeBacsAnnex = false) => {
  const qs = []
  if (includeBacsAnnex) qs.push('includeBacsAnnex=1')
  return `/api/afs/${afId}/exports/af/preview${qs.length ? '?' + qs.join('&') : ''}`
}
export const previewPointsListUrl = (afId) =>
  `/api/afs/${afId}/exports/points-list/preview`

// ── Catalogue offres Buildy (PDF tableau comparatif) ──
export const previewOfferingsUrl = () => `/api/offerings/preview`
export const exportOfferingsPdfUrl = () => `/api/offerings/export-pdf`
export const listOfferingLevels = () => api.get('/offering-levels')
export const updateOfferingLevel = (slug, data) => api.patch(`/offering-levels/${slug}`, data)

// ── Brochures (lot A2/A3) ──
export const listBrochureLibrary = (kind) =>
  api.get('/brochures/library', { params: kind ? { kind } : {} })
export const listBrochureItems = (brochureId) =>
  api.get(`/brochures/${brochureId}/items`)
export const createBrochureItem = (brochureId, data) =>
  api.post(`/brochures/${brochureId}/items`, data)
export const updateBrochureItem = (itemId, data) =>
  api.patch(`/brochures/items/${itemId}`, data)
export const deleteBrochureItem = (itemId) =>
  api.delete(`/brochures/items/${itemId}`)
export const updateBrochureLayout = (brochureId, layout) =>
  api.patch(`/brochures/${brochureId}/layout`, { layout_template: layout })

// ── PDF boilerplate admin (lot B4) ──
// Methodologie + disclaimers du PDF audit BACS, editables sans redeployer.
export const listPdfBoilerplate = (kind) =>
  api.get('/pdf-boilerplate', { params: kind ? { kind } : {} })
export const createPdfBoilerplate = (data) => api.post('/pdf-boilerplate', data)
export const updatePdfBoilerplate = (id, data) => api.patch(`/pdf-boilerplate/${id}`, data)
export const deletePdfBoilerplate = (id) => api.delete(`/pdf-boilerplate/${id}`)

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
export const reorderEquipmentTemplates = (category, ids) => api.post('/equipment-templates/reorder', { category, ids })
export const deleteEquipmentTemplate = (id) => api.delete(`/equipment-templates/${id}`)
export const cloneEquipmentTemplate = (id, data) => api.post(`/equipment-templates/${id}/clone`, data)

// Statut de validation du contenu (mig 89). Pareil que pour les sections.
export const validateEquipmentTemplateContent = (id) =>
  api.post(`/equipment-templates/${id}/validate-content`)
export const unvalidateEquipmentTemplateContent = (id) =>
  api.delete(`/equipment-templates/${id}/validate-content`)
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
export const updateSectionTemplate = (id, data, { cascadeDocumentKinds } = {}) =>
  api.patch(`/section-templates/${id}`, data, {
    params: cascadeDocumentKinds === false ? { cascade_document_kinds: 0 } : {},
  })
// Catalogue des types de documents Buildy (af / brochure / bacs_audit).
// Retourne array<{ kind, label, description }>. Utilise pour alimenter le multi-select
// dans la modale d'edition d'une section type.
export const listDocumentKinds = () => api.get('/section-templates/document-kinds')

// Modification en bulk des document_kinds.
// Payload : { ids: [...], action: 'add'|'remove'|'replace', kinds: [...], cascade: boolean }
// Retourne : { ok, affected, cascaded }
export const bulkUpdateSectionTemplateDocumentKinds = (payload) =>
  api.post('/section-templates/bulk-document-kinds', payload)
export const deleteSectionTemplate = (id, { force = false } = {}) =>
  api.delete(`/section-templates/${id}`, { params: force ? { force: 1 } : {} })

// Synchronisation biblio fonctionnalités -> FAQ Crisp (Lot 138)
export const getFaqStatusForFunctionality = (id) =>
  api.get(`/section-templates/${id}/faq-status`)
export const generateFaqFromFunctionality = (id, { category_id, locale } = {}) =>
  api.post(`/section-templates/${id}/generate-faq`, { category_id, locale })
export const regenerateFaqFromFunctionality = (id, { article_id, force = false }) =>
  api.post(`/section-templates/${id}/regenerate-faq`, { article_id, force })
export const cloneSectionTemplate = (id, data) => api.post(`/section-templates/${id}/clone`, data)

// Statut de validation du contenu (mig 89). validate marque la section/feature
// comme "validée" (date + auteur). unvalidate repasse en brouillon.
export const validateSectionTemplateContent = (id) =>
  api.post(`/section-templates/${id}/validate-content`)
export const unvalidateSectionTemplateContent = (id) =>
  api.delete(`/section-templates/${id}/validate-content`)

// Promotion d'une section AF ad-hoc (sans template) vers la bibliothèque.
// Crée un section_template depuis la section + lie l'AF au nouveau template.
export const promoteSectionToLibrary = (sectionId) =>
  api.post(`/sections/${sectionId}/promote-to-library`)
// reorder({ ids, parent_template_id? }). parent_template_id si re-parenting drag-drop.
export const reorderSectionTemplates = ({ ids, parent_template_id } = {}) =>
  api.patch('/section-templates/reorder', { ids, ...(parent_template_id !== undefined ? { parent_template_id } : {}) })

// ── Audit trail (logs globaux d'activite) ──
export const listAuditLog = (params) => api.get('/audit-log', { params })
export const listAuditActions = () => api.get('/audit-log/actions')

// ── Claude (assistant redaction bibliotheque) ──
// payload : { mode, kind, title?, html?, parent_path?, category_label?,
//             bacs_articles?, avail_e?, avail_s?, avail_p?,
//             current_template_id?, parent_template_id?, category?,
//             library_context?: { enabled, strategy } }
// mode 'title' : Claude propose UNIQUEMENT un titre (pas de body), via le
// marker `<!--TITLE: ...-->`. Backend retourne suggested_title + html=''.
export const getClaudeUsage = () => api.get('/claude/usage')
// ── Prompts IA editables ──
// Le `prefix` filtre les clés (ex. 'bacs.' pour ne retourner que les
// prompts d'audit BACS dans la page Paramètres BACS).
export const listAiPrompts = (params = {}) => api.get('/ai-prompts', { params })
export const getAiPrompt = (key) => api.get(`/ai-prompts/${key}`)
export const updateAiPrompt = (key, body, label = null) => api.patch(`/ai-prompts/${key}`, { body, label })
export const resetAiPrompt = (key) => api.post(`/ai-prompts/${key}/reset`)
export const restoreAiPromptVersion = (key, versionId) => api.post(`/ai-prompts/${key}/restore/${versionId}`)
// ── Articles R175 BACS (read-only) ──
export const listBacsArticles = () => api.get('/bacs-articles')
export const searchAfs = (q) => api.get('/afs/search', { params: { q } })
export const claudeLibraryAssist = (payload) =>
  api.post('/claude/library-assist', payload)

// ── Sites (synchro bidirectionnelle Fleet Manager) ──
export const listSites = (params) => api.get('/sites', { params })
export const getSite = (uuid) => api.get(`/sites/${uuid}`)
export const createSite = (data) => api.post('/sites', data)
export const updateSite = (uuid, data) => api.patch(`/sites/${uuid}`, data)
export const deleteSite = (uuid) => api.delete(`/sites/${uuid}`)
export const ensureUserFromPocketId = (pocketid_id) => api.post('/users/ensure-by-pocketid-id', { pocketid_id })

// ── Audit BACS — donnees structurees ──
export const getBacsSystems = (docId) => api.get(`/bacs-audit/${docId}/systems`)
export const updateBacsSystem = (id, data) => api.patch(`/bacs-audit/systems/${id}`, data)
// Usage manuel non BACS (mig 144).
export const createBacsSystem = (docId, data) =>
  api.post(`/bacs-audit/${docId}/systems`, data)
export const deleteBacsSystem = (id) => api.delete(`/bacs-audit/systems/${id}`)
// Partage / déplacement d'un device entre systèmes (zone × usage), mig 143.
export const shareBacsDevice = (deviceId, extraSystemIds) =>
  api.patch(`/bacs-audit/devices/${deviceId}/share`, { extra_system_ids: extraSystemIds })
export const moveBacsDevice = (deviceId, systemId) =>
  api.patch(`/bacs-audit/devices/${deviceId}/move`, { system_id: systemId })
export const getBacsMeters = (docId) => api.get(`/bacs-audit/${docId}/meters`)
export const createBacsMeter = (docId, data) => api.post(`/bacs-audit/${docId}/meters`, data)
export const updateBacsMeter = (id, data) => api.patch(`/bacs-audit/meters/${id}`, data)
export const deleteBacsMeter = (id) => api.delete(`/bacs-audit/meters/${id}`)
export const getBacsBms = (docId) => api.get(`/bacs-audit/${docId}/bms`)
// Check-list audit (mig 100) — pièces jointes du dossier + couverture photo
export const getBacsChecklist = (docId) => api.get(`/bacs-audit/${docId}/checklist`)
export const updateBacsChecklistItem = (docId, key, data) =>
  api.patch(`/bacs-audit/${docId}/checklist/${encodeURIComponent(key)}`, data)
export const getBacsPhotoCoverage = (docId) => api.get(`/bacs-audit/${docId}/photo-coverage`)
export const getBacsPhotoCounts = (docId) => api.get(`/bacs-audit/${docId}/photo-counts`)
// Notes par sujet de la carte GTB (mig 108 + 109).
// Une note libre HTML par sous-section du chapitre 6 GTB ; visible
// dans le PDF même si la GTB est marquée Hors-Service.
export const getBacsGtbObservations = (docId) => api.get(`/bacs-audit/${docId}/gtb-observations`)
export const updateBacsGtbObservation = (docId, topicKey, data) =>
  api.put(`/bacs-audit/${docId}/gtb-observations/${encodeURIComponent(topicKey)}`, data)
export const listChecklistCatalog = (params) => api.get('/bacs-checklist-catalog', { params })
export const createChecklistCatalogItem = (data) => api.post('/bacs-checklist-catalog', data)
export const updateChecklistCatalogItem = (key, data) =>
  api.patch(`/bacs-checklist-catalog/${encodeURIComponent(key)}`, data)
export const deleteChecklistCatalogItem = (key) =>
  api.delete(`/bacs-checklist-catalog/${encodeURIComponent(key)}`)
export const reorderChecklistCatalog = (keys) =>
  api.patch('/bacs-checklist-catalog/reorder', { keys })
export const updateBacsBms = (docId, data) => api.put(`/bacs-audit/${docId}/bms`, data)
export const getBacsBmsComponents = (docId) => api.get(`/bacs-audit/${docId}/bms-components`)
export const createBacsBmsComponent = (docId, data) => api.post(`/bacs-audit/${docId}/bms-components`, data)
export const updateBacsBmsComponent = (id, data) => api.patch(`/bacs-audit/bms-components/${id}`, data)
export const duplicateBacsBmsComponent = (id) => api.post(`/bacs-audit/bms-components/${id}/duplicate`)
export const deleteBacsBmsComponent = (id) => api.delete(`/bacs-audit/bms-components/${id}`)
export const getBacsThermal = (docId) => api.get(`/bacs-audit/${docId}/thermal-regulation`)
export const updateBacsThermal = (id, data) => api.patch(`/bacs-audit/thermal-regulation/${id}`, data)
export const getBacsInspections = (docId) => api.get(`/bacs-audit/${docId}/inspections`)
export const createBacsInspection = (docId, data) => api.post(`/bacs-audit/${docId}/inspections`, data)
export const updateBacsInspection = (id, data) => api.patch(`/bacs-audit/inspections/${id}`, data)
export const deleteBacsInspection = (id) => api.delete(`/bacs-audit/inspections/${id}`)
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
export const exportBacsPdf = (docId) => api.post(`/bacs-audit/${docId}/export-pdf`)
export const exportBacsTablesPdf = (docId) => api.post(`/bacs-audit/${docId}/exports/tables`)
export const exportBacsChecklistPdf = (docId) =>
  api.post(`/bacs-audit/${docId}/exports/checklist`, null, { responseType: 'blob' })

// ── Transcript Plaud + suggestions Claude (B3) ──
export const listBacsTranscripts = (docId) => api.get(`/bacs-audit/${docId}/transcripts`)
export const uploadBacsTranscript = (docId, file) => {
  const fd = new FormData()
  fd.append('file', file, file.name)
  return api.post(`/bacs-audit/${docId}/transcripts`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}
export const generateBacsSuggestions = (transcriptId) =>
  api.post(`/bacs-audit/transcripts/${transcriptId}/suggestions`)
export const listBacsSuggestions = (docId, params) =>
  api.get(`/bacs-audit/${docId}/suggestions`, { params })
export const applyBacsSuggestion = (id) =>
  api.post(`/bacs-audit/suggestions/${id}/apply`)
export const rejectBacsSuggestion = (id) =>
  api.post(`/bacs-audit/suggestions/${id}/reject`)

// Upload massif de photos terrain : parse EXIF + tri chronologique cote serveur.
export const bulkUploadSitePhotos = (siteUuid, files, onProgress) => {
  const fd = new FormData()
  for (const f of files) fd.append('photos', f, f.name)
  return api.post(`/sites/${siteUuid}/photos/bulk`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: onProgress,
  })
}
export const deliverBacsAudit = (docId) => api.post(`/bacs-audit/${docId}/deliver`)
export const resyncBacsAudit = (docId) => api.post(`/bacs-audit/${docId}/resync`)

// ── Audit BACS — devices (multi-systèmes par catégorie x zone) ──
export const getBacsDevices = (docId) => api.get(`/bacs-audit/${docId}/devices`)
export const createBacsDevice = (systemId, data) =>
  api.post(`/bacs-audit/systems/${systemId}/devices`, data)
export const updateBacsDevice = (id, data) => api.patch(`/bacs-audit/devices/${id}`, data)
export const deleteBacsDevice = (id) => api.delete(`/bacs-audit/devices/${id}`)
export const reorderBacsDevices = (systemId, ids) =>
  api.post(`/bacs-audit/systems/${systemId}/devices/reorder`, { ids })
export const reorderBacsZones = (docId, ids) =>
  api.post(`/bacs-audit/${docId}/zones/reorder`, { ids })
export const reorderBacsSystems = (docId, ids) =>
  api.post(`/bacs-audit/${docId}/systems/reorder`, { ids })
export const reorderBacsMeters = (docId, ids) =>
  api.post(`/bacs-audit/${docId}/meters/reorder`, { ids })
export const reorderBacsThermal = (docId, ids) =>
  api.post(`/bacs-audit/${docId}/thermal-regulation/reorder`, { ids })
export const getBacsPowerSummary = (docId) => api.get(`/bacs-audit/${docId}/power-summary`)
export const validateBacsAuditStep = (docId, step, validated, reason = null) =>
  api.post(`/bacs-audit/${docId}/validate-step`, { step, validated, reason })
export const updateBacsAuditSynthesis = (docId, html) =>
  api.put(`/bacs-audit/${docId}/synthesis`, { html })
export const generateBacsAuditSynthesis = (docId) =>
  api.post(`/bacs-audit/${docId}/generate-synthesis`)
export const generateActionAlternatives = (actionId) =>
  api.post(`/bacs-audit/action-items/${actionId}/generate-alternatives`)
export const seedBacsFixture = () => api.post('/bacs-audit/seed-fixture')
export const duplicateZone = (id) => api.post(`/site-zones/${id}/duplicate`)
export const duplicateBacsMeter = (id) => api.post(`/bacs-audit/meters/${id}/duplicate`)
export const duplicateBacsDevice = (id) => api.post(`/bacs-audit/devices/${id}/duplicate`)

// ── Site documents (DOE) ──
export const listSiteDocuments = (siteUuid, params) =>
  api.get(`/sites/${siteUuid}/documents`, { params })
export const uploadSiteDocument = (siteUuid, formData, params) =>
  api.post(`/sites/${siteUuid}/documents`, formData, {
    params,
    headers: { 'Content-Type': 'multipart/form-data' },
  })
export const updateSiteDocument = (id, data) => api.patch(`/site-documents/${id}`, data)
export const deleteSiteDocument = (id) => api.delete(`/site-documents/${id}`)
export const getSiteDocumentDownloadUrl = (id) => `/api/site-documents/${id}/download`
// Notes vocales : transcription a la demande (OpenAI Whisper / gpt-4o-transcribe)
export const transcribeSiteDocument = (id) => api.post(`/site-documents/${id}/transcribe`)
// Exporte la transcription vers les notes de l'element rattache
export const exportSiteDocumentTranscript = (id) =>
  api.post(`/site-documents/${id}/export-transcript-to-notes`)

// ── Configuration publique (cle Google Maps restreinte par referent) ──
export const getPublicConfig = () => api.get('/public-config')

// ── Site credentials ──
export const listSiteCredentials = (siteUuid) => api.get(`/sites/${siteUuid}/credentials`)
export const createSiteCredential = (siteUuid, data) =>
  api.post(`/sites/${siteUuid}/credentials`, data)
export const updateSiteCredential = (id, data) => api.patch(`/site-credentials/${id}`, data)
export const deleteSiteCredential = (id) => api.delete(`/site-credentials/${id}`)
export const revealSiteCredential = (id) => api.get(`/site-credentials/${id}/reveal`)

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

// ── FAQ Buildy / Crisp Knowledge Base ──
export const getFaqSettings = () => api.get('/faq/settings')
export const saveFaqSettings = (data) => api.put('/faq/settings', data)
export const testFaqConnection = () => api.post('/faq/test-connection')
export const pullFaqFromCrisp = () => api.post('/faq/sync/pull')

// Whitelist mots-clés SEO (override DB de DEFAULT_KEYWORDS)
export const getFaqSeoKeywords = () => api.get('/faq/settings/seo-keywords')
export const saveFaqSeoKeywords = (keywords) => api.put('/faq/settings/seo-keywords', { keywords })
export const resetFaqSeoKeywords = () => api.post('/faq/settings/seo-keywords/reset')

export const listFaqCategories = () => api.get('/faq/categories')
export const createFaqCategory = (data) => api.post('/faq/categories', data)
export const updateFaqCategory = (id, data) => api.patch(`/faq/categories/${id}`, data)
export const deleteFaqCategory = (id, { force = false } = {}) =>
  api.delete(`/faq/categories/${id}`, { params: force ? { force: 1 } : {} })
export const pushFaqCategory = (id) => api.post(`/faq/categories/${id}/push`)

export const listFaqArticles = (params) => api.get('/faq/articles', { params })
export const searchFaqArticles = (q) => api.get('/faq/articles/searchable', { params: q ? { q } : {} })
export const listFaqArticleVersions = (id) => api.get(`/faq/articles/${id}/versions`)
export const restoreFaqArticleVersion = (id, versionId) =>
  api.post(`/faq/articles/${id}/versions/${versionId}/restore`)
export const getFaqArticle = (id) => api.get(`/faq/articles/${id}`)
export const createFaqArticle = (data) => api.post('/faq/articles', data)
export const updateFaqArticle = (id, data) => api.patch(`/faq/articles/${id}`, data)
export const deleteFaqArticle = (id) => api.delete(`/faq/articles/${id}`)
export const pushFaqArticle = (id) => api.post(`/faq/articles/${id}/push`)
export const pullFaqArticleFromCrisp = (id) => api.post(`/faq/articles/${id}/pull`)

export const faqAiRewrite = (payload) => {
  // Accepte un id (legacy) ou un objet { article_id, instructions }.
  const body = (payload && typeof payload === 'object')
    ? { article_id: payload.article_id, instructions: payload.instructions || null }
    : { article_id: payload }
  return api.post('/faq/ai/rewrite', body)
}
export const faqAiRewriteTitle = (article_id) => api.post('/faq/ai/rewrite-title', { article_id })
export const faqAiRewriteDescription = (article_id) => api.post('/faq/ai/rewrite-description', { article_id })
// Génération article FAQ — accepte un objet riche.
// Si `images` est fourni (Array<File>), on envoie en multipart/form-data
// (Claude Vision). Sinon JSON simple.
export const faqAiGenerate = (payload = {}) => {
  const {
    question, category_id, article_type = 'howto',
    include_images_in_content = false, images = [], annotations = [],
  } = payload
  if (!images.length) {
    return api.post('/faq/ai/generate', {
      question, category_id, article_type,
    })
  }
  const fd = new FormData()
  fd.append('question', question)
  if (category_id) fd.append('category_id', String(category_id))
  fd.append('article_type', article_type)
  fd.append('include_images_in_content', include_images_in_content ? '1' : '0')
  if (annotations?.length) fd.append('annotations', JSON.stringify(annotations))
  for (const img of images) fd.append('images', img, img.name)
  return api.post('/faq/ai/generate', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120_000, // vision peut être lente, on relâche le timeout par défaut axios
  })
}

// Régénération partielle d'un passage sélectionné dans l'éditeur.
export const faqAiRewriteSelection = ({ article_id, selection_html, instruction = '' }) =>
  api.post('/faq/ai/rewrite-selection', { article_id, selection_html, instruction })
export const faqAiSuggestMissing = () => api.post('/faq/ai/missing-articles')
export const faqAiCorpusStats = () => api.get('/faq/ai/corpus-stats')

// ─── Livres blancs (Marketing) ──────────────────────────────────────
export const listWhitepapers = () => api.get('/whitepapers')
export const createWhitepaper = (payload) => api.post('/whitepapers', payload)
export const getWhitepaper = (id) => api.get(`/whitepapers/${id}`)
export const updateWhitepaper = (id, payload) => api.patch(`/whitepapers/${id}`, payload)
export const deleteWhitepaper = (id) => api.delete(`/whitepapers/${id}`)
export const getWhitepaperChapter = (id, chapterId) =>
  api.get(`/whitepapers/${id}/chapters/${chapterId}`)
export const createWhitepaperChapter = (id, payload) =>
  api.post(`/whitepapers/${id}/chapters`, payload)
export const updateWhitepaperChapter = (id, chapterId, payload) =>
  api.patch(`/whitepapers/${id}/chapters/${chapterId}`, payload)
export const deleteWhitepaperChapter = (id, chapterId) =>
  api.delete(`/whitepapers/${id}/chapters/${chapterId}`)
export const moveWhitepaperChapter = (id, chapterId, direction) =>
  api.post(`/whitepapers/${id}/chapters/${chapterId}/move`, { direction })
export const exportWhitepaperPdf = (id) =>
  api.get(`/whitepapers/${id}/export/pdf`, { responseType: 'blob' })
// Mode « HTML brut » (coffre) — édition hors-app
export const getWhitepaperSourceHtml = (id) => api.get(`/whitepapers/${id}/source-html`)
export const replaceWhitepaperSourceHtml = (id, file) => {
  const fd = new FormData()
  fd.append('file', file, file.name || 'source.html')
  return api.put(`/whitepapers/${id}/source-html`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}
export const publishWhitepaper = (id) => api.post(`/whitepapers/${id}/publish`)
export const getWhitepaperClicks = (id) => api.get(`/whitepapers/${id}/clicks`)
export const refreshWhitepaperClicks = (id) => api.post(`/whitepapers/${id}/clicks/refresh`)

export default api
