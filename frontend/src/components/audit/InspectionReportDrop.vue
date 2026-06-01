<script setup>
/**
 * Zone de drop pour le rapport PDF d'une inspection R175-5-1.
 *
 * Liste les site_documents rattachés à `bacs_audit_inspection_id = props.inspectionId`,
 * accepte un drag-drop ou un clic-pour-parcourir, upload via
 * `uploadSiteDocument(siteUuid, formData, { bacs_audit_inspection_id, category: 'rapport_essais' })`.
 *
 * Format : PDF principalement, mais on accepte aussi image (scan papier) —
 * la categorie reste `rapport_essais` pour les 2.
 *
 * Composant léger réutilisé en desktop (InspectionsSection) et en PWA
 * (MobileInspectionsSheet) — pas de variante mobile dédiée, le drop-zone
 * marche au clic sur tactile (ouvre le file picker natif).
 */
import { ref, computed, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import { listSiteDocuments, uploadSiteDocument, deleteSiteDocument, getSiteDocumentDownloadUrl } from '@/api'

const props = defineProps({
  inspectionId: { type: Number, required: true },
})

const audit = useAuditStore()
const { document: auditDoc } = storeToRefs(audit)
const { success, error } = useNotification()
const { confirm } = useConfirm()

const docs = ref([])
const loading = ref(false)
const uploading = ref(false)
const dragOver = ref(false)
const fileInput = ref(null)

const siteUuid = computed(() => auditDoc.value?.site_uuid || null)

async function load() {
  if (!siteUuid.value || !props.inspectionId) return
  loading.value = true
  try {
    const { data } = await listSiteDocuments(siteUuid.value, {
      bacs_audit_inspection_id: props.inspectionId,
    })
    docs.value = data || []
  } catch {
    error('Impossible de charger les rapports d\'inspection')
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => props.inspectionId, load)

function pick() {
  fileInput.value?.click()
}

async function uploadFiles(files) {
  if (!files || !files.length || !siteUuid.value) return
  uploading.value = true
  for (const file of files) {
    const fd = new FormData()
    fd.append('file', file)
    try {
      const { data } = await uploadSiteDocument(siteUuid.value, fd, {
        title: file.name,
        category: 'rapport_essais',
        bacs_audit_inspection_id: props.inspectionId,
      })
      docs.value = [data, ...docs.value]
    } catch (e) {
      error(e.response?.data?.detail || `Upload de ${file.name} impossible`)
    }
  }
  uploading.value = false
  success(`${files.length} fichier${files.length > 1 ? 's' : ''} ajouté${files.length > 1 ? 's' : ''}`)
}

function onDrop(e) {
  e.preventDefault()
  dragOver.value = false
  uploadFiles(e.dataTransfer?.files)
}
function onInput(e) {
  uploadFiles(e.target.files)
  e.target.value = ''
}

async function remove(doc) {
  const ok = await confirm({
    title: 'Supprimer ce rapport ?',
    message: doc.original_name || doc.title,
    confirmLabel: 'Supprimer',
    danger: true,
  })
  if (!ok) return
  try {
    await deleteSiteDocument(doc.id)
    docs.value = docs.value.filter(d => d.id !== doc.id)
  } catch {
    error('Suppression impossible')
  }
}

function fmtSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} ko`
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}
function isPdf(doc) {
  return /pdf$/i.test(doc.mime_type || '') || /\.pdf$/i.test(doc.filename || '')
}
function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
</script>

<template>
  <div class="space-y-2">
    <label class="text-[11px] text-gray-600 block">Rapport d'inspection (PDF)</label>

    <!-- Liste des fichiers déjà uploadés -->
    <div v-if="docs.length" class="space-y-1.5">
      <div v-for="d in docs" :key="d.id"
           class="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm">
        <FontAwesomeIcon :icon="['fas', isPdf(d) ? 'file-pdf' : 'file']"
                         :class="isPdf(d) ? 'text-red-500' : 'text-gray-400'"
                         class="w-4 h-4 shrink-0" />
        <a :href="getSiteDocumentDownloadUrl(d.id)" target="_blank" rel="noopener"
           class="flex-1 truncate text-indigo-700 hover:text-indigo-900 hover:underline">
          {{ d.original_name || d.title }}
        </a>
        <span class="text-xs text-gray-500 shrink-0 hidden sm:inline">
          {{ fmtSize(d.size_bytes) }} · {{ fmtDate(d.uploaded_at) }}
        </span>
        <button type="button" @click="remove(d)"
                class="p-1.5 text-gray-400 hover:text-red-600 transition shrink-0"
                title="Supprimer">
          <FontAwesomeIcon :icon="['fas', 'trash']" class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>

    <!-- Drop zone -->
    <button type="button"
            @click="pick"
            @dragover.prevent="dragOver = true"
            @dragleave.prevent="dragOver = false"
            @drop="onDrop"
            :class="[
              'w-full flex flex-col items-center justify-center gap-1.5 px-4 py-4 border-2 border-dashed rounded-lg transition cursor-pointer',
              dragOver ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100',
              uploading && 'opacity-50 pointer-events-none',
            ]">
      <FontAwesomeIcon :icon="['fas', uploading ? 'spinner' : 'cloud-arrow-up']"
                       :class="uploading && 'fa-spin'"
                       class="w-5 h-5 text-gray-500" />
      <div class="text-xs text-gray-700 text-center">
        <span v-if="uploading">Envoi en cours…</span>
        <span v-else-if="docs.length">
          <strong>Ajouter</strong> un autre fichier
        </span>
        <span v-else>
          <strong>Glisse le PDF du rapport ici</strong>, ou clique pour parcourir
        </span>
      </div>
      <span v-if="!uploading" class="text-[10px] text-gray-500">PDF, JPG ou PNG · 25 Mo max</span>
      <input ref="fileInput" type="file" multiple
             accept="application/pdf,image/jpeg,image/png,image/webp"
             class="hidden"
             @change="onInput" />
    </button>
  </div>
</template>
