import { ref, computed } from 'vue'
import { uploadSiteDocument } from '@/api'
import { useNotification } from '@/composables/useNotification'

/**
 * Composable : transforme une zone DOM en drop zone pour photos.
 * Retourne {handlers, isDragOver, uploadFiles} a binder via v-on / class.
 *
 * @param siteUuidRef ref/computed du site_uuid
 * @param attachToRef ref/computed de { zone_id?, system_id?, meter_id?, device_id?, bms_document_id? }
 * @param onUploaded callback (optionnel) appele apres chaque batch d'upload
 */
export function usePhotoDropzone(siteUuidRef, attachToRef, onUploaded) {
  const isDragOver = ref(false)
  const dragDepth = ref(0)
  const uploading = ref(false)
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

  async function uploadFiles(files) {
    const siteUuid = typeof siteUuidRef === 'function' ? siteUuidRef() : siteUuidRef.value
    if (!siteUuid || !files.length) return
    uploading.value = true
    try {
      for (const f of files) {
        const fd = new FormData()
        fd.append('file', f)
        await uploadSiteDocument(siteUuid, fd, {
          title: f.name.replace(/\.[^.]+$/, ''),
          category: 'photo',
          ...filterParams.value,
        })
      }
      success(files.length > 1 ? `${files.length} photos téléversées` : 'Photo téléversée')
      window.dispatchEvent(new CustomEvent('site-documents:changed'))
      if (onUploaded) onUploaded()
    } catch (err) {
      notifyError(err.response?.data?.detail || 'Échec upload photo')
    } finally {
      uploading.value = false
    }
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
  function onDragOver(e) { /* preventDefault uniquement, fait via @drag*.prevent */ }
  async function onDrop(e) {
    isDragOver.value = false
    dragDepth.value = 0
    const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'))
    if (!files.length) {
      notifyError('Glisse uniquement des fichiers image')
      return
    }
    await uploadFiles(files)
  }

  return {
    isDragOver,
    uploading,
    uploadFiles,
    handlers: {
      onDragenter: onDragEnter,
      onDragover: onDragOver,
      onDragleave: onDragLeave,
      onDrop,
    },
  }
}
