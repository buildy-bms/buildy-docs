<script setup>
/**
 * Onglet « Docs » mobile (6e tab) — check-list de collecte.
 * Couverture photo des entités + pièces jointes du dossier.
 *
 * Le sheet d'édition d'un item permet :
 *  - Choisir le statut (À collecter / Collecté / Non disponible)
 *  - Prendre une photo (caméra native)
 *  - Importer un fichier
 *  - Saisir une note libre
 *  - Si Non disponible : raison libre
 */
import { ref, computed, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import {
  CheckIcon, NoSymbolIcon, ExclamationCircleIcon,
  CameraIcon, DocumentIcon, TrashIcon, ChevronRightIcon,
} from '@heroicons/vue/24/outline'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import {
  getBacsChecklist, getBacsPhotoCoverage, updateBacsChecklistItem,
  listSiteDocuments, uploadSiteDocument, deleteSiteDocument,
  getSiteDocumentDownloadUrl,
} from '@/api'
import MobileSheet from './MobileSheet.vue'
import EquipmentIcon from '@/components/EquipmentIcon.vue'

const audit = useAuditStore()
const { document } = storeToRefs(audit)
const { error, success } = useNotification()

const items = ref([])
const coverage = ref({
  zones: { total: 0, covered: 0 }, systems: { total: 0, covered: 0 },
  meters: { total: 0, covered: 0 }, bms: { total: 0, covered: 0 },
})
const loading = ref(true)

async function load() {
  loading.value = true
  try {
    const [c, cov] = await Promise.all([
      getBacsChecklist(audit.docId),
      getBacsPhotoCoverage(audit.docId),
    ])
    items.value = c.data
    coverage.value = cov.data
  } catch { error('Chargement impossible') }
  finally { loading.value = false }
}
onMounted(load)
watch(() => audit.docId, load)

const totalCovered = computed(() =>
  coverage.value.zones.covered + coverage.value.systems.covered + coverage.value.meters.covered + coverage.value.bms.covered,
)
const totalEntities = computed(() =>
  coverage.value.zones.total + coverage.value.systems.total + coverage.value.meters.total + coverage.value.bms.total,
)
const itemsHandled = computed(() => items.value.filter(i => i.status !== 'pending').length)
const totalScore = computed(() => totalCovered.value + itemsHandled.value)
const totalPossible = computed(() => totalEntities.value + items.value.length)
const completionPct = computed(() =>
  totalPossible.value === 0 ? 0 : Math.round((totalScore.value / totalPossible.value) * 100),
)

// Sheet édition
const editing = ref(null)
const editingFiles = ref([])
const editingStatus = ref('pending')
const editingNotes = ref('')
const editingReason = ref('')
const saving = ref(false)
const fileInput = ref(null)
const cameraInput = ref(null)

async function openItem(it) {
  editing.value = it
  editingStatus.value = it.status
  editingNotes.value = it.notes_html || ''
  editingReason.value = it.not_available_reason || ''
  await refreshFiles()
}
function closeItem() { editing.value = null; editingFiles.value = [] }

async function refreshFiles() {
  if (!editing.value?.id || !document.value?.site_uuid) {
    editingFiles.value = []
    return
  }
  try {
    const { data } = await listSiteDocuments(document.value.site_uuid, {
      bacs_audit_checklist_id: editing.value.id,
    })
    editingFiles.value = data
  } catch { editingFiles.value = [] }
}

async function persist({ close = false } = {}) {
  if (!editing.value) return
  saving.value = true
  try {
    await updateBacsChecklistItem(audit.docId, editing.value.catalog_key, {
      status: editingStatus.value,
      notes_html: editingNotes.value || null,
      not_available_reason: editingStatus.value === 'not_available' ? (editingReason.value || null) : null,
    })
    await load()
    editing.value = items.value.find(i => i.catalog_key === editing.value.catalog_key) || null
    success('Mis à jour')
    if (close) closeItem()
  } catch (e) {
    error(e.response?.data?.detail || 'Sauvegarde impossible')
  } finally {
    saving.value = false
  }
}

async function onFileSelected(e) {
  const files = Array.from(e.target.files || [])
  e.target.value = ''
  if (!files.length || !editing.value) return
  if (!editing.value.id) {
    await persist({ close: false })
    if (!editing.value?.id) return
  }
  if (!document.value?.site_uuid) { error('Pas de site rattaché'); return }
  for (const file of files) {
    try {
      const fd = new FormData()
      fd.append('file', file)
      await uploadSiteDocument(document.value.site_uuid, fd, {
        title: file.name,
        category: 'autre',
        bacs_audit_checklist_id: editing.value.id,
      })
    } catch { error(`Upload « ${file.name} » impossible`) }
  }
  await refreshFiles()
  await load()
  if (editingStatus.value === 'pending') {
    editingStatus.value = 'available'
    await persist({ close: false })
  }
}

async function removeFile(f) {
  try {
    await deleteSiteDocument(f.id)
    await refreshFiles()
    await load()
  } catch { error('Suppression impossible') }
}

function statusClass(s) {
  return {
    pending:        'bg-white border-gray-200',
    available:      'bg-emerald-50 border-emerald-200',
    not_available:  'bg-gray-100 border-gray-200 opacity-70',
  }[s] || 'bg-white border-gray-200'
}
</script>

<template>
  <div class="p-3 space-y-3">
    <!-- Stat globale -->
    <div class="bg-white rounded-2xl border border-gray-200 p-4 flex items-center gap-4">
      <div class="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 inline-flex items-center justify-center">
        <CheckIcon class="w-6 h-6" />
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-2xl font-medium text-gray-900 leading-none">
          {{ totalScore }}<span class="text-sm text-gray-500"> / {{ totalPossible }}</span>
        </p>
        <p class="text-xs text-gray-500 mt-1">Documents & photos collectés ({{ completionPct }}%)</p>
      </div>
    </div>

    <!-- Couverture photo -->
    <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div class="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <CameraIcon class="w-5 h-5 text-emerald-600" />
        <h3 class="text-base font-medium text-gray-900">Couverture photo des entités</h3>
      </div>
      <div class="grid grid-cols-2 divide-x divide-y divide-gray-100">
        <div v-for="kind in ['zones', 'systems', 'meters', 'bms']" :key="kind" class="p-4">
          <p class="text-xs uppercase tracking-wider text-gray-500">
            {{ { zones: 'Zones', systems: 'Systèmes', meters: 'Compteurs', bms: 'GTB' }[kind] }}
          </p>
          <p class="text-2xl font-medium text-gray-900 mt-1 leading-none">
            {{ coverage[kind].covered }}<span class="text-base text-gray-400 font-normal"> / {{ coverage[kind].total }}</span>
          </p>
          <p v-if="coverage[kind].total === 0" class="text-[11px] text-gray-400 italic mt-1">Aucun</p>
          <p v-else-if="coverage[kind].covered === coverage[kind].total" class="text-[11px] text-emerald-700 mt-1">✓ Couvert</p>
          <p v-else class="text-[11px] text-amber-700 mt-1">⚠ {{ coverage[kind].total - coverage[kind].covered }} sans photo</p>
        </div>
      </div>
    </div>

    <!-- Pièces jointes -->
    <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div class="px-4 py-3 border-b border-gray-100">
        <h3 class="text-base font-medium text-gray-900">Pièces jointes du dossier</h3>
        <p class="text-xs text-gray-500 mt-0.5">{{ itemsHandled }} / {{ items.length }} traités</p>
      </div>
      <div v-if="loading" class="px-4 py-6 text-sm text-gray-400 text-center">Chargement…</div>
      <div v-else-if="!items.length" class="px-4 py-6 text-sm text-gray-400 italic text-center">
        Aucun item dans le catalogue.
      </div>
      <div v-else class="divide-y divide-gray-100">
        <button v-for="it in items" :key="it.catalog_key"
                @click="openItem(it)"
                :class="['w-full flex items-center gap-3 px-4 py-4 text-left active:bg-gray-50', statusClass(it.status)]">
          <EquipmentIcon :template="{ icon_kind: 'fa', icon_value: it.icon_value || 'fa-file', icon_color: it.icon_color || '#6b7280' }" size="md" class="shrink-0" />
          <div class="flex-1 min-w-0">
            <p :class="['text-base font-medium leading-tight', it.status === 'not_available' ? 'line-through text-gray-500' : 'text-gray-900']">
              {{ it.label }}
            </p>
            <p class="text-xs mt-0.5 flex items-center gap-1">
              <CheckIcon v-if="it.status === 'available'" class="w-3.5 h-3.5 text-emerald-600" />
              <NoSymbolIcon v-else-if="it.status === 'not_available'" class="w-3.5 h-3.5 text-gray-400" />
              <ExclamationCircleIcon v-else class="w-3.5 h-3.5 text-amber-500" />
              <span :class="{
                'text-emerald-700': it.status === 'available',
                'text-gray-500':    it.status === 'not_available',
                'text-amber-700':   it.status === 'pending',
              }">
                <template v-if="it.status === 'available'">{{ it.files_count }} fichier{{ it.files_count > 1 ? 's' : '' }}</template>
                <template v-else-if="it.status === 'not_available'">Non disponible</template>
                <template v-else>À collecter</template>
              </span>
            </p>
          </div>
          <ChevronRightIcon class="w-5 h-5 text-gray-300 shrink-0" />
        </button>
      </div>
    </div>

    <!-- Sheet édition item -->
    <MobileSheet
      :open="!!editing"
      :title="editing?.label || ''"
      :saving="saving"
      save-label="Enregistrer"
      @close="closeItem"
      @save="persist({ close: true })"
    >
      <div v-if="editing" class="p-4 space-y-4">
        <!-- Statut -->
        <div class="grid grid-cols-3 gap-2">
          <button v-for="opt in [
            { v: 'pending',       label: 'À collecter',  icon: ExclamationCircleIcon },
            { v: 'available',     label: 'Collecté',     icon: CheckIcon },
            { v: 'not_available', label: 'Non dispo.',   icon: NoSymbolIcon },
          ]" :key="opt.v" type="button" @click="editingStatus = opt.v"
            :class="['flex flex-col items-center gap-1 px-2 py-3 text-xs font-medium rounded-xl border-2',
                     editingStatus === opt.v
                       ? 'border-indigo-500 bg-indigo-50 text-indigo-800'
                       : 'border-gray-200 bg-white text-gray-600']">
            <component :is="opt.icon" class="w-5 h-5" />
            {{ opt.label }}
          </button>
        </div>

        <!-- Raison non dispo -->
        <div v-if="editingStatus === 'not_available'">
          <label class="block text-xs font-medium text-gray-700 mb-1.5">Pourquoi ?</label>
          <input v-model="editingReason" type="text"
                 placeholder="Ex : Le client n'a pas retrouvé les originaux"
                 class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white" />
        </div>

        <!-- Photos / fichiers -->
        <div v-if="editingStatus !== 'not_available'">
          <p class="text-xs font-medium text-gray-600 uppercase tracking-wider mb-2">
            Fichiers ({{ editingFiles.length }})
          </p>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" @click="cameraInput?.click()"
                    class="inline-flex items-center justify-center gap-2 px-4 py-4 text-base font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 active:bg-indigo-100 rounded-xl">
              <CameraIcon class="w-5 h-5" /> Photo
            </button>
            <input ref="cameraInput" type="file" accept="image/*" capture="environment"
                   class="hidden" @change="onFileSelected" />
            <button type="button" @click="fileInput?.click()"
                    class="inline-flex items-center justify-center gap-2 px-4 py-4 text-base font-medium text-gray-700 bg-white border border-gray-200 active:bg-gray-50 rounded-xl">
              <DocumentIcon class="w-5 h-5" /> Fichier
            </button>
            <input ref="fileInput" type="file" multiple class="hidden" @change="onFileSelected" />
          </div>
          <ul v-if="editingFiles.length" class="mt-2 divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
            <li v-for="f in editingFiles" :key="f.id"
                class="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
              <a :href="getSiteDocumentDownloadUrl(f.id)" target="_blank" class="flex-1 truncate text-indigo-700">{{ f.title }}</a>
              <button type="button" @click="removeFile(f)" class="text-gray-400 active:text-red-600 p-1.5">
                <TrashIcon class="w-4 h-4" />
              </button>
            </li>
          </ul>
        </div>

        <!-- Notes -->
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1.5">Notes</label>
          <textarea v-model="editingNotes" rows="4"
                    placeholder="Observations, contacts, références…"
                    class="w-full px-4 py-3 text-base border border-gray-200 rounded-xl bg-white"></textarea>
        </div>
      </div>
    </MobileSheet>
  </div>
</template>
