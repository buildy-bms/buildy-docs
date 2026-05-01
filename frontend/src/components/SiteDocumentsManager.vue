<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import {
  DocumentIcon, TrashIcon, ArrowDownTrayIcon, PaperClipIcon,
  PlusIcon, EyeIcon, XMarkIcon,
} from '@heroicons/vue/24/outline'
import {
  listSiteDocuments, uploadSiteDocument, updateSiteDocument, deleteSiteDocument,
  getSiteDocumentDownloadUrl,
} from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'

/**
 * Manager des fichiers DOE rattachés à un site (visibles depuis l'audit BACS).
 * Drag & drop ou file picker. Modal de saisie titre + catégorie + rattachement
 * à un système BACS optionnel.
 */
const props = defineProps({
  siteUuid: { type: String, required: true },
  systems: { type: Array, default: () => [] }, // pour rattachement optionnel
  zones: { type: Array, default: () => [] },
  meters: { type: Array, default: () => [] },
  devices: { type: Array, default: () => [] },
  bms: { type: Object, default: () => ({}) },
})

const { success, error } = useNotification()
const { confirm } = useConfirm()

const CATEGORIES = [
  { value: 'plan', label: 'Plan' },
  { value: 'schema_electrique', label: 'Schéma électrique' },
  { value: 'schema_synoptique', label: 'Schéma synoptique' },
  { value: 'analyse_fonctionnelle', label: 'Analyse fonctionnelle' },
  { value: 'datasheet', label: 'Fiche technique (datasheet)' },
  { value: 'manuel_utilisateur', label: 'Manuel utilisateur' },
  { value: 'rapport_essais', label: "Rapport d'essais" },
  { value: 'autre', label: 'Autre' },
]

const documents = ref([])
const loading = ref(false)
const uploading = ref(false)
const dragOver = ref(false)
const showModal = ref(false)
const pendingFile = ref(null)
const pendingMeta = ref({ title: '', category: 'plan', bacs_audit_system_id: null })
const fileInput = ref(null)

async function refresh() {
  loading.value = true
  try {
    const { data } = await listSiteDocuments(props.siteUuid)
    documents.value = data
  } catch {
    error('Échec du chargement des documents')
  } finally {
    loading.value = false
  }
}

function onDrop(e) {
  e.preventDefault()
  dragOver.value = false
  const file = e.dataTransfer.files?.[0]
  if (file) startUpload(file)
}

function onPick(e) {
  const file = e.target.files?.[0]
  if (file) startUpload(file)
  e.target.value = ''
}

function startUpload(file) {
  pendingFile.value = file
  pendingMeta.value = {
    title: file.name.replace(/\.[^.]+$/, ''),
    category: 'plan',
    bacs_audit_system_id: null,
  }
  showModal.value = true
}

async function confirmUpload() {
  if (!pendingFile.value || !pendingMeta.value.title.trim()) return
  uploading.value = true
  try {
    const fd = new FormData()
    fd.append('file', pendingFile.value)
    await uploadSiteDocument(props.siteUuid, fd, {
      title: pendingMeta.value.title.trim(),
      category: pendingMeta.value.category,
      bacs_audit_system_id: pendingMeta.value.bacs_audit_system_id || undefined,
    })
    success('Document ajouté')
    showModal.value = false
    pendingFile.value = null
    refresh()
  } catch (e) {
    error(e.response?.data?.detail || 'Upload impossible')
  } finally {
    uploading.value = false
  }
}

async function patchDoc(d, patch) {
  try {
    const { data } = await updateSiteDocument(d.id, patch)
    Object.assign(d, data)
  } catch {
    error('Sauvegarde impossible')
  }
}

async function removeDoc(d) {
  const ok = await confirm({
    title: 'Supprimer ce document ?',
    message: `« ${d.title} »`,
    confirmLabel: 'Supprimer', danger: true,
  })
  if (!ok) return
  try {
    await deleteSiteDocument(d.id)
    documents.value = documents.value.filter(x => x.id !== d.id)
    success('Document supprimé')
  } catch {
    error('Suppression impossible')
  }
}

function fmtSize(b) {
  if (!b) return ''
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' Ko'
  return (b / 1024 / 1024).toFixed(1) + ' Mo'
}

function categoryLabel(v) {
  return CATEGORIES.find(c => c.value === v)?.label || v
}

const SYSTEM_LABEL_FR = {
  heating: 'Chauffage', cooling: 'Refroidissement', ventilation: 'Ventilation',
  dhw: 'ECS', lighting_indoor: 'Éclairage intérieur',
  lighting_outdoor: 'Éclairage extérieur', electricity_production: 'Production photovoltaïque',
}

function attachmentLabel(d) {
  if (d.bacs_audit_zone_id) {
    const z = props.zones.find(x => x.zone_id === d.bacs_audit_zone_id)
    return { kind: 'Zone', label: z?.name || `Zone #${d.bacs_audit_zone_id}` }
  }
  if (d.bacs_audit_device_id) {
    const dev = props.devices.find(x => x.id === d.bacs_audit_device_id)
    return { kind: 'Système', label: dev?.name || dev?.brand || `Équipement #${d.bacs_audit_device_id}` }
  }
  if (d.bacs_audit_system_id) {
    const s = props.systems.find(x => x.id === d.bacs_audit_system_id)
    const cat = s ? (SYSTEM_LABEL_FR[s.system_category] || s.system_category) : `Système #${d.bacs_audit_system_id}`
    return { kind: 'Catégorie', label: s ? `${cat} / ${s.zone_name}` : cat }
  }
  if (d.bacs_audit_meter_id) {
    const m = props.meters.find(x => x.id === d.bacs_audit_meter_id)
    return { kind: 'Compteur', label: m ? `${m.usage} ${m.zone_name ? '/ ' + m.zone_name : ''}`.trim() : `Compteur #${d.bacs_audit_meter_id}` }
  }
  if (d.bacs_audit_bms_document_id) {
    return { kind: 'GTB', label: props.bms?.existing_solution || 'GTB' }
  }
  return { kind: 'Site', label: '— non rattaché' }
}

const previewDoc = ref(null)
function isImage(d) {
  return (d.mime_type || '').startsWith('image/') || d.category === 'photo'
}
function openPreview(d) {
  if (isImage(d)) previewDoc.value = d
  else window.open(getSiteDocumentDownloadUrl(d.id), '_blank')
}

function onDocsChanged() { refresh() }

watch(() => props.siteUuid, refresh)
onMounted(() => {
  refresh()
  window.addEventListener('site-documents:changed', onDocsChanged)
})
onBeforeUnmount(() => {
  window.removeEventListener('site-documents:changed', onDocsChanged)
})
</script>

<template>
  <div>
    <!-- Drop zone -->
    <div
      :class="[
        'border-2 border-dashed rounded-lg px-4 py-6 text-center transition cursor-pointer',
        dragOver ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 hover:border-gray-400',
      ]"
      @dragover.prevent="dragOver = true"
      @dragleave.prevent="dragOver = false"
      @drop="onDrop"
      @click="fileInput?.click()"
    >
      <input ref="fileInput" type="file" class="hidden" @change="onPick"
             accept=".pdf,.dwg,.png,.jpg,.jpeg,.webp,.xls,.xlsx,.doc,.docx,.txt" />
      <PaperClipIcon class="w-8 h-8 mx-auto text-gray-400" />
      <p class="mt-2 text-sm text-gray-600">
        Glisse-dépose un fichier ici ou
        <span class="text-indigo-600 font-medium">parcours</span>
      </p>
      <p class="text-[11px] text-gray-400 mt-1">PDF, DWG, images, Office… 25 Mo max</p>
    </div>

    <!-- Liste -->
    <div v-if="loading" class="text-center py-6 text-sm text-gray-400">Chargement…</div>

    <div v-else-if="!documents.length" class="text-center py-6 text-sm text-gray-500">
      Aucun document encore importé pour ce site.
    </div>

    <table v-else class="w-full text-sm mt-4">
      <thead class="text-xs uppercase text-gray-500 tracking-wider bg-gray-50">
        <tr>
          <th class="text-center px-3 py-2 w-16">Aperçu</th>
          <th class="text-center px-3 py-2">Titre</th>
          <th class="text-center py-2 w-44">Catégorie</th>
          <th class="text-center py-2 w-56">Rattaché à</th>
          <th class="text-center py-2 w-24">Taille</th>
          <th class="text-center px-3 py-2 w-28">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100">
        <tr v-for="d in documents" :key="d.id" class="group hover:bg-gray-50/60">
          <td class="px-3 py-2 text-center">
            <button v-if="isImage(d)" @click="openPreview(d)" class="inline-block">
              <img :src="getSiteDocumentDownloadUrl(d.id)" :alt="d.title"
                   class="w-12 h-12 object-cover rounded border border-gray-200 hover:border-indigo-400 transition" />
            </button>
            <DocumentIcon v-else class="w-6 h-6 text-gray-400 mx-auto" />
          </td>
          <td class="px-3 py-2 text-gray-700">
            <input type="text" :value="d.title"
                   @blur="e => e.target.value !== d.title && patchDoc(d, { title: e.target.value })"
                   class="w-full px-2 py-0.5 border border-transparent hover:border-gray-200 focus:border-indigo-500 focus:outline-none rounded" />
            <p class="text-[11px] text-gray-400">{{ d.original_name }}</p>
          </td>
          <td class="py-2 text-center">
            <select :value="d.category"
                    @change="e => patchDoc(d, { category: e.target.value })"
                    class="text-xs px-2 py-1 border border-gray-200 rounded text-center">
              <option v-for="c in CATEGORIES" :key="c.value" :value="c.value">{{ c.label }}</option>
              <option value="photo">Photo</option>
            </select>
          </td>
          <td class="py-2 text-center">
            <span :class="['inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full border',
              attachmentLabel(d).kind === 'Site'
                ? 'border-gray-200 text-gray-500 bg-gray-50 italic'
                : 'border-indigo-200 text-indigo-700 bg-indigo-50']">
              <span class="font-semibold">{{ attachmentLabel(d).kind }}</span>
              <span class="truncate max-w-40">{{ attachmentLabel(d).label }}</span>
            </span>
          </td>
          <td class="py-2 text-center text-xs text-gray-500">{{ fmtSize(d.size_bytes) }}</td>
          <td class="px-3 py-2 text-center whitespace-nowrap">
            <button v-if="isImage(d)" @click="openPreview(d)"
                    class="text-gray-400 hover:text-indigo-600 mx-1" title="Aperçu">
              <EyeIcon class="w-4 h-4" />
            </button>
            <a :href="getSiteDocumentDownloadUrl(d.id)" target="_blank"
               class="inline-block text-gray-400 hover:text-indigo-600 mx-1" title="Télécharger">
              <ArrowDownTrayIcon class="w-4 h-4" />
            </a>
            <button @click="removeDoc(d)" class="text-gray-400 hover:text-red-600 mx-1" title="Supprimer">
              <TrashIcon class="w-4 h-4" />
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Modal lightbox preview -->
    <div v-if="previewDoc"
         class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
         @click.self="previewDoc = null">
      <div class="relative max-w-6xl max-h-[90vh] w-full flex flex-col">
        <header class="flex items-center justify-between text-white mb-3">
          <div class="min-w-0 flex-1">
            <h3 class="text-base font-semibold truncate">{{ previewDoc.title }}</h3>
            <p class="text-xs opacity-70 truncate">
              {{ attachmentLabel(previewDoc).kind }} : {{ attachmentLabel(previewDoc).label }}
              · {{ fmtSize(previewDoc.size_bytes) }}
            </p>
          </div>
          <a :href="getSiteDocumentDownloadUrl(previewDoc.id)" target="_blank"
             class="ml-4 px-3 py-1.5 text-xs font-medium text-white border border-white/40 rounded hover:bg-white/10">
            <ArrowDownTrayIcon class="w-4 h-4 inline-block mr-1" /> Télécharger
          </a>
          <button @click="previewDoc = null" class="ml-2 p-2 text-white hover:bg-white/10 rounded">
            <XMarkIcon class="w-5 h-5" />
          </button>
        </header>
        <img :src="getSiteDocumentDownloadUrl(previewDoc.id)" :alt="previewDoc.title"
             class="max-h-[80vh] mx-auto object-contain rounded shadow-2xl" />
      </div>
    </div>

    <!-- Modal de saisie meta après drop -->
    <div v-if="showModal" class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4"
         @click.self="showModal = false">
      <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <h3 class="text-lg font-semibold text-gray-800 mb-1">Nouveau document</h3>
        <p class="text-sm text-gray-500 mb-4">{{ pendingFile?.name }} ({{ fmtSize(pendingFile?.size) }})</p>
        <form @submit.prevent="confirmUpload" class="space-y-3">
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">Titre *</label>
            <input v-model="pendingMeta.title" type="text" required
                   class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">Catégorie *</label>
            <select v-model="pendingMeta.category" required
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
              <option v-for="c in CATEGORIES" :key="c.value" :value="c.value">{{ c.label }}</option>
            </select>
          </div>
          <div v-if="systems.length">
            <label class="block text-xs font-medium text-gray-700 mb-1">
              Rattacher à un système (optionnel)
            </label>
            <select v-model="pendingMeta.bacs_audit_system_id"
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
              <option :value="null">— rattaché au site uniquement</option>
              <option v-for="s in systems" :key="s.id" :value="s.id">
                {{ s.system_category }} / {{ s.zone_name }}
              </option>
            </select>
          </div>
          <div class="flex justify-end gap-2 pt-3">
            <button type="button" @click="showModal = false"
                    class="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">
              Annuler
            </button>
            <button type="submit" :disabled="uploading || !pendingMeta.title.trim()"
                    class="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap">
              {{ uploading ? 'Upload…' : 'Téléverser' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
