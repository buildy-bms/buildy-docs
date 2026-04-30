<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import {
  DocumentIcon, TrashIcon, ArrowDownTrayIcon, PaperClipIcon,
  PlusIcon,
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

watch(() => props.siteUuid, refresh)
onMounted(refresh)
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
          <th class="text-center px-3 py-2">Titre</th>
          <th class="text-center py-2 w-44">Catégorie</th>
          <th class="text-center py-2 w-48">Rattaché à</th>
          <th class="text-center py-2 w-24">Taille</th>
          <th class="text-center px-3 py-2 w-24">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100">
        <tr v-for="d in documents" :key="d.id" class="group">
          <td class="px-3 py-2 text-gray-700">
            <div class="flex items-center gap-2">
              <DocumentIcon class="w-4 h-4 text-gray-400 shrink-0" />
              <input type="text" :value="d.title"
                     @blur="e => e.target.value !== d.title && patchDoc(d, { title: e.target.value })"
                     class="flex-1 px-2 py-0.5 border border-transparent hover:border-gray-200 focus:border-indigo-500 focus:outline-none rounded" />
            </div>
            <p class="text-[11px] text-gray-400 ml-6">{{ d.original_name }}</p>
          </td>
          <td class="py-2 text-center">
            <select :value="d.category"
                    @change="e => patchDoc(d, { category: e.target.value })"
                    class="text-xs px-2 py-1 border border-gray-200 rounded text-center">
              <option v-for="c in CATEGORIES" :key="c.value" :value="c.value">{{ c.label }}</option>
            </select>
          </td>
          <td class="py-2 text-center">
            <select :value="d.bacs_audit_system_id"
                    @change="e => patchDoc(d, { bacs_audit_system_id: e.target.value ? parseInt(e.target.value) : null })"
                    class="text-xs px-2 py-1 border border-gray-200 rounded text-center">
              <option :value="null">— site (non rattaché)</option>
              <option v-for="s in systems" :key="s.id" :value="s.id">
                {{ s.system_category }} / {{ s.zone_name }}
              </option>
            </select>
          </td>
          <td class="py-2 text-center text-xs text-gray-500">{{ fmtSize(d.size_bytes) }}</td>
          <td class="px-3 py-2 text-center">
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
