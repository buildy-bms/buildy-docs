import { ref, computed } from 'vue'
import { uploadSiteDocument } from '@/api'
import { useNotification } from '@/composables/useNotification'

const IMAGE_MIMES = new Set(['image/jpeg','image/jpg','image/png','image/webp','image/heic','image/heif','image/gif'])
const PDF_MIMES = new Set(['application/pdf'])

/**
 * Composable : drop zone fichiers (photos ET PDFs) sur une ligne d'audit.
 *
 * Images → upload immédiat avec category='photo' (workflow rapide pour
 * les captures terrain).
 * PDFs → mis en file dans `pendingDocs` ; le composant parent doit afficher
 * une modale (DocumentUploadModal) qui saisit catégorie + titre obligatoires
 * par fichier, puis appelle `uploadDocsWithMeta(metaList)` pour uploader.
 *
 * Multi-fichiers OK pour les 2 types (toute la liste est traitée d'un coup).
 *
 * @param siteUuidRef ref/computed du site_uuid
 * @param attachToRef ref/computed de { zone_id?, system_id?, meter_id?, device_id?, bms_document_id? }
 * @param onUploaded callback (optionnel) appele apres chaque batch d'upload
 */
export function usePhotoDropzone(siteUuidRef, attachToRef, onUploaded) {
  const isDragOver = ref(false)
  const dragDepth = ref(0)
  const uploading = ref(false)
  const pendingDocs = ref([]) // [File, ...] PDFs en attente de saisie meta
  const { success, error: notifyError } = useNotification()

  const filterParams = computed(() => {
    const a = (typeof attachToRef === 'function' ? attachToRef() : attachToRef.value) || {}
    const p = {}
    if (a.zone_id != null)         p.bacs_audit_zone_id = a.zone_id
    if (a.meter_id != null)        p.bacs_audit_meter_id = a.meter_id
    if (a.system_id != null)       p.bacs_audit_system_id = a.system_id
    if (a.device_id != null)       p.bacs_audit_device_id = a.device_id
    if (a.bms_document_id != null) p.bacs_audit_bms_document_id = a.bms_document_id
    return p
  })

  // Upload direct (utilisé pour les images : pas besoin de saisir titre +
  // catégorie, on déduit). `category` peut être surchargée si besoin.
  async function uploadFiles(files, { category = 'photo' } = {}) {
    const siteUuid = typeof siteUuidRef === 'function' ? siteUuidRef() : siteUuidRef.value
    if (!siteUuid || !files.length) return
    uploading.value = true
    try {
      for (const f of files) {
        const fd = new FormData()
        fd.append('file', f)
        await uploadSiteDocument(siteUuid, fd, {
          title: f.name.replace(/\.[^.]+$/, ''),
          category,
          ...filterParams.value,
        })
      }
      const label = category === 'photo' ? 'photo' : 'document'
      success(files.length > 1 ? `${files.length} ${label}s téléversés` : `${label.charAt(0).toUpperCase() + label.slice(1)} téléversé`)
      window.dispatchEvent(new CustomEvent('site-documents:changed'))
      if (onUploaded) onUploaded()
    } catch (err) {
      notifyError(err.response?.data?.detail || 'Échec upload')
    } finally {
      uploading.value = false
    }
  }

  // Upload avec metadata par fichier (utilisé après confirmation modale
  // pour les PDFs : chaque fichier a son titre + sa catégorie propres).
  async function uploadDocsWithMeta(metaList) {
    const siteUuid = typeof siteUuidRef === 'function' ? siteUuidRef() : siteUuidRef.value
    if (!siteUuid || !metaList.length) return
    uploading.value = true
    try {
      for (const m of metaList) {
        const fd = new FormData()
        fd.append('file', m.file)
        await uploadSiteDocument(siteUuid, fd, {
          title: m.title.trim(),
          category: m.category,
          ...filterParams.value,
        })
      }
      success(metaList.length > 1 ? `${metaList.length} documents téléversés` : 'Document téléversé')
      window.dispatchEvent(new CustomEvent('site-documents:changed'))
      if (onUploaded) onUploaded()
    } catch (err) {
      notifyError(err.response?.data?.detail || 'Échec upload document')
    } finally {
      uploading.value = false
      pendingDocs.value = []
    }
  }

  function cancelPendingDocs() {
    pendingDocs.value = []
  }

  function onDragEnter(e) {
    if (!e.dataTransfer?.types?.includes('Files')) return
    dragDepth.value++
    isDragOver.value = true
  }
  function onDragLeave() {
    dragDepth.value = Math.max(0, dragDepth.value - 1)
    if (dragDepth.value === 0) isDragOver.value = false
  }
  function onDragOver(_e) { /* preventDefault uniquement, fait via @drag*.prevent */ }
  async function onDrop(e) {
    isDragOver.value = false
    dragDepth.value = 0
    // Drop interne (SortableJS reorder) : dataTransfer.files vide → on
    // return silencieusement sinon on aurait une fausse erreur.
    const allFiles = Array.from(e.dataTransfer?.files || [])
    if (!allFiles.length) return
    const images = allFiles.filter(f => f.type.startsWith('image/') || IMAGE_MIMES.has(f.type))
    const pdfs = allFiles.filter(f => f.type === 'application/pdf' || PDF_MIMES.has(f.type))
    const unsupported = allFiles.length - images.length - pdfs.length
    if (unsupported > 0) {
      notifyError('Seules les images et les PDFs sont acceptés')
    }
    if (images.length) await uploadFiles(images, { category: 'photo' })
    if (pdfs.length) {
      // Mise en file pour la modale parent. Le parent doit reagir via watch
      // sur pendingDocs.value.length > 0 et afficher DocumentUploadModal.
      pendingDocs.value = pdfs
    }
  }

  return {
    isDragOver,
    uploading,
    uploadFiles,
    pendingDocs,
    uploadDocsWithMeta,
    cancelPendingDocs,
    handlers: {
      onDragenter: onDragEnter,
      onDragover: onDragOver,
      onDragleave: onDragLeave,
      onDrop,
    },
  }
}
