<script setup>
/**
 * Section « Documents & photos collectées » de l'audit BACS / GTB.
 *
 * 2 sous-blocs dans 1 seule card :
 *  1. Couverture photo des entités existantes (zones, systèmes, compteurs,
 *     GTB) — auto-tracking, lecture seule. Compteurs cliquables avec popover
 *     listant les entités sans photo (clic → scroll vers l'entité).
 *  2. Pièces jointes du dossier (catalogue éditable, items du genre plans
 *     d'étages, schémas, synoptique GTB, IP, AF GTB, locataires) — chacun
 *     a sa dropzone + notes + toggle « Non disponible ».
 *
 * Le score « X / Y collectés » du header agrège les 2 sous-blocs (chaque
 * entité auto-couverte = 1 point ; chaque item de check-list available OR
 * not_available = 1 point).
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { storeToRefs } from 'pinia'
import {
  CheckIcon, XMarkIcon, PencilSquareIcon, CameraIcon,
  ExclamationCircleIcon, NoSymbolIcon, MapPinIcon,
  WrenchScrewdriverIcon, BoltIcon, CpuChipIcon,
} from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import EquipmentIcon from '@/components/EquipmentIcon.vue'
import RichTextEditor from '@/components/RichTextEditor.vue'
import BaseModal from '@/components/BaseModal.vue'
import {
  getBacsChecklist, getBacsPhotoCoverage, updateBacsChecklistItem,
  listSiteDocuments, uploadSiteDocument, deleteSiteDocument,
  getSiteDocumentDownloadUrl,
} from '@/api'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  docId: { type: Number, required: true },
  step: { type: Object, default: null },
  active: { type: Boolean, default: false },
})
const emit = defineEmits(['validate-step', 'invalidate-step', 'goto-zone', 'goto-system', 'goto-meter', 'goto-bms'])

const audit = useAuditStore()
const { document } = storeToRefs(audit)
const { error, success } = useNotification()

// ─── Données ────────────────────────────────────────────────────────
const items = ref([])
const coverage = ref({ zones: { total: 0, covered: 0, missing: [] }, systems: { total: 0, covered: 0, missing: [] }, meters: { total: 0, covered: 0, missing: [] }, bms: { total: 0, covered: 0, files_count: 0 } })
const loading = ref(true)

async function load() {
  loading.value = true
  try {
    const [c, cov] = await Promise.all([
      getBacsChecklist(props.docId),
      getBacsPhotoCoverage(props.docId),
    ])
    items.value = c.data
    coverage.value = cov.data
  } catch (e) {
    error('Chargement de la check-list impossible')
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => props.docId, load)

// ─── Stats globales ────────────────────────────────────────────────
const totalCovered = computed(() =>
  coverage.value.zones.covered + coverage.value.systems.covered + coverage.value.meters.covered + coverage.value.bms.covered,
)
const totalEntities = computed(() =>
  coverage.value.zones.total + coverage.value.systems.total + coverage.value.meters.total + coverage.value.bms.total,
)
const itemsHandled = computed(() => items.value.filter(i => i.status !== 'pending').length)
const totalItems = computed(() => items.value.length)
const totalScore = computed(() => totalCovered.value + itemsHandled.value)
const totalPossible = computed(() => totalEntities.value + totalItems.value)
const completionPct = computed(() =>
  totalPossible.value === 0 ? 0 : Math.round((totalScore.value / totalPossible.value) * 100),
)

// ─── Popover « entités sans photo » ─────────────────────────────────
const popoverOpen = ref(null) // 'zones' | 'systems' | 'meters' | null
const popoverRef = ref(null)
function togglePopover(kind) {
  popoverOpen.value = popoverOpen.value === kind ? null : kind
}
function closePopover(e) {
  if (!popoverRef.value) return
  if (popoverRef.value.contains(e.target)) return
  popoverOpen.value = null
}
onMounted(() => document.addEventListener('mousedown', closePopover))
onBeforeUnmount(() => document.removeEventListener('mousedown', closePopover))

function gotoEntity(kind, entityId) {
  popoverOpen.value = null
  emit(`goto-${kind === 'systems' ? 'system' : kind === 'meters' ? 'meter' : 'zone'}`, entityId)
}

// ─── Items check-list : modale d'édition ────────────────────────────
const editingItem = ref(null)
const itemFiles = ref([])
const itemSaving = ref(false)
const draftNotes = ref('')
const draftReason = ref('')
const draftStatus = ref('pending')

async function openItem(item) {
  editingItem.value = item
  draftNotes.value = item.notes_html || ''
  draftReason.value = item.not_available_reason || ''
  draftStatus.value = item.status
  await refreshItemFiles()
}
function closeItem() {
  editingItem.value = null
  itemFiles.value = []
}

async function refreshItemFiles() {
  if (!editingItem.value || !document.value?.site_uuid || !editingItem.value.id) {
    itemFiles.value = []
    return
  }
  try {
    const { data } = await listSiteDocuments(document.value.site_uuid, {
      bacs_audit_checklist_id: editingItem.value.id,
    })
    itemFiles.value = data
  } catch { itemFiles.value = [] }
}

async function saveItem({ close = true } = {}) {
  if (!editingItem.value) return
  itemSaving.value = true
  try {
    const { data } = await updateBacsChecklistItem(props.docId, editingItem.value.catalog_key, {
      status: draftStatus.value,
      notes_html: draftNotes.value || null,
      not_available_reason: draftStatus.value === 'not_available' ? (draftReason.value || null) : null,
    })
    // Recharge listForDocument pour avoir le nouveau id si lazy-create
    await load()
    // Re-pointe sur l'item à jour pour les prochains uploads
    editingItem.value = items.value.find(i => i.catalog_key === editingItem.value.catalog_key) || null
    success('Mis à jour')
    if (close) closeItem()
  } catch (e) {
    error(e.response?.data?.detail || 'Sauvegarde impossible')
  } finally {
    itemSaving.value = false
  }
}

async function uploadFiles(files) {
  if (!editingItem.value || !files?.length) return
  // Lazy create si l'item n'a pas encore d'id (premier upload).
  if (!editingItem.value.id) {
    await saveItem({ close: false })
    if (!editingItem.value?.id) return
  }
  if (!document.value?.site_uuid) {
    error('Audit non rattaché à un site, impossible d\'uploader.')
    return
  }
  for (const file of files) {
    try {
      const fd = new FormData()
      fd.append('file', file)
      await uploadSiteDocument(document.value.site_uuid, fd, {
        title: file.name,
        category: 'autre',
        bacs_audit_checklist_id: editingItem.value.id,
      })
    } catch (e) {
      error(`Upload « ${file.name} » impossible`)
    }
  }
  await refreshItemFiles()
  await load()
  // Si on était en pending, l'upload bascule auto en available
  if (draftStatus.value === 'pending') {
    draftStatus.value = 'available'
    await saveItem({ close: false })
  }
}

function onFileInput(e) {
  uploadFiles(Array.from(e.target.files || []))
  e.target.value = ''
}
function onDrop(e) {
  e.preventDefault()
  uploadFiles(Array.from(e.dataTransfer.files || []))
}

async function removeFile(f) {
  try {
    await deleteSiteDocument(f.id)
    await refreshItemFiles()
    await load()
  } catch { error('Suppression impossible') }
}

// ─── Quick toggle « Non disponible » depuis la card ────────────────
async function quickToggleNotAvailable(item) {
  const newStatus = item.status === 'not_available' ? 'pending' : 'not_available'
  try {
    await updateBacsChecklistItem(props.docId, item.catalog_key, { status: newStatus })
    await load()
  } catch { error('Mise à jour impossible') }
}

// ─── Status helpers ────────────────────────────────────────────────
function statusLabel(s) {
  return { pending: 'À collecter', available: 'Collecté', not_available: 'Non disponible' }[s] || s
}
function statusClass(s) {
  return {
    pending:        'border-gray-200 bg-white',
    available:      'border-emerald-200 bg-emerald-50/40',
    not_available:  'border-gray-200 bg-gray-100 opacity-70',
  }[s] || 'border-gray-200 bg-white'
}

defineExpose({ refresh: load })
</script>

<template>
  <CollapsibleSection
    :icon="CheckIcon" :title="'Documents & photos collectées'"
    :subtitle="`${totalScore} / ${totalPossible} collectés (${completionPct}%)`"
    :step="step" :active="active" :anchor-id="'docs-checklist'"
    @validate-step="emit('validate-step')" @invalidate-step="emit('invalidate-step')">

    <div v-if="loading" class="px-5 py-8 text-center text-sm text-gray-400">Chargement…</div>

    <div v-else class="px-5 py-4 space-y-6">
      <!-- ── BLOC 1 : Couverture photo ─────────────────────────────────── -->
      <section ref="popoverRef" class="space-y-3">
        <div class="flex items-center gap-2">
          <CameraIcon class="w-4 h-4 text-emerald-600" />
          <h3 class="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
            Couverture photo des entités ({{ totalCovered }}/{{ totalEntities }})
          </h3>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button v-for="kind in ['zones', 'systems', 'meters', 'bms']" :key="kind"
                  type="button"
                  @click="kind !== 'bms' ? togglePopover(kind) : emit('goto-bms')"
                  :class="['relative bg-white border rounded-lg p-3 text-left transition hover:border-emerald-300',
                           coverage[kind].covered === coverage[kind].total && coverage[kind].total > 0
                             ? 'border-emerald-200'
                             : coverage[kind].total === 0
                               ? 'border-gray-200 opacity-60'
                               : 'border-amber-200 bg-amber-50/40']">
            <div class="flex items-center gap-2 mb-1">
              <MapPinIcon v-if="kind === 'zones'" class="w-4 h-4 text-gray-500" />
              <WrenchScrewdriverIcon v-if="kind === 'systems'" class="w-4 h-4 text-gray-500" />
              <BoltIcon v-if="kind === 'meters'" class="w-4 h-4 text-gray-500" />
              <CpuChipIcon v-if="kind === 'bms'" class="w-4 h-4 text-gray-500" />
              <span class="text-xs font-semibold text-gray-700 capitalize">
                {{ { zones: 'Zones', systems: 'Systèmes', meters: 'Compteurs', bms: 'GTB' }[kind] }}
              </span>
            </div>
            <p class="text-2xl font-semibold text-gray-900">
              {{ coverage[kind].covered }}<span class="text-base text-gray-400 font-normal"> / {{ coverage[kind].total }}</span>
            </p>
            <p v-if="coverage[kind].total === 0" class="text-[11px] text-gray-400 italic mt-0.5">
              Aucun à photographier
            </p>
            <p v-else-if="coverage[kind].covered === coverage[kind].total" class="text-[11px] text-emerald-700 mt-0.5">
              ✓ Tout couvert
            </p>
            <p v-else class="text-[11px] text-amber-700 mt-0.5">
              ⚠ {{ coverage[kind].total - coverage[kind].covered }} sans photo · voir →
            </p>
            <!-- Popover liste des entités sans photo -->
            <div v-if="popoverOpen === kind && coverage[kind].missing?.length"
                 class="absolute top-full mt-1 left-0 right-0 z-20 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto py-1 text-sm">
              <button v-for="m in coverage[kind].missing" :key="m.id"
                      type="button"
                      @click.stop="gotoEntity(kind, m.id)"
                      class="w-full text-left px-3 py-1.5 hover:bg-emerald-50 text-gray-700 hover:text-emerald-700 truncate">
                {{ m.name }}
              </button>
            </div>
          </button>
        </div>
      </section>

      <!-- ── BLOC 2 : Pièces jointes du dossier ─────────────────────────── -->
      <section class="space-y-3">
        <div class="flex items-center gap-2">
          <PencilSquareIcon class="w-4 h-4 text-indigo-600" />
          <h3 class="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
            Pièces jointes du dossier ({{ itemsHandled }}/{{ totalItems }})
          </h3>
        </div>
        <div v-if="!items.length" class="text-sm text-gray-400 italic px-3 py-4 border border-dashed border-gray-200 rounded-lg text-center">
          Aucun item dans le catalogue. Ajoutez-en depuis l'admin (« Catalogue check-list »).
        </div>
        <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
          <button v-for="item in items" :key="item.catalog_key"
                  type="button"
                  @click="openItem(item)"
                  :class="['relative text-left border rounded-lg p-3 transition hover:border-indigo-300', statusClass(item.status)]">
            <div class="flex items-start gap-2 mb-1">
              <EquipmentIcon :template="{ icon_kind: 'fa', icon_value: item.icon_value || 'fa-file', icon_color: item.icon_color || '#6b7280' }"
                             size="md" class="shrink-0 mt-0.5" />
              <div class="flex-1 min-w-0">
                <p :class="['text-sm font-medium leading-tight',
                            item.status === 'not_available' ? 'line-through text-gray-500' : 'text-gray-800']">
                  {{ item.label }}
                </p>
              </div>
            </div>
            <div class="flex items-center justify-between gap-2 mt-2">
              <div class="flex items-center gap-1.5 text-[11px]">
                <span v-if="item.status === 'available'" class="inline-flex items-center gap-1 text-emerald-700">
                  <CheckIcon class="w-3 h-3" /> {{ item.files_count }} fichier{{ item.files_count > 1 ? 's' : '' }}
                </span>
                <span v-else-if="item.status === 'not_available'" class="inline-flex items-center gap-1 text-gray-500">
                  <NoSymbolIcon class="w-3 h-3" /> Non disponible
                </span>
                <span v-else class="inline-flex items-center gap-1 text-amber-700">
                  <ExclamationCircleIcon class="w-3 h-3" /> À collecter
                </span>
              </div>
            </div>
          </button>
        </div>
      </section>
    </div>
  </CollapsibleSection>

  <!-- Modale d'édition d'un item ─────────────────────────────────── -->
  <BaseModal v-if="editingItem" :title="`Pièce : ${editingItem.label}`" size="lg" @close="closeItem">
    <div class="space-y-4">
      <!-- Statut sélecteur 3 boutons -->
      <div class="grid grid-cols-3 gap-2">
        <button v-for="opt in [
          { v: 'pending',        label: 'À collecter',   icon: ExclamationCircleIcon, cls: 'amber' },
          { v: 'available',      label: 'Collecté',      icon: CheckIcon,             cls: 'emerald' },
          { v: 'not_available',  label: 'Non disponible',icon: NoSymbolIcon,          cls: 'gray' },
        ]" :key="opt.v" type="button" @click="draftStatus = opt.v"
          :class="['flex flex-col items-center gap-1.5 px-3 py-3 text-sm font-medium rounded-lg border-2 transition',
                   draftStatus === opt.v
                     ? `border-${opt.cls}-500 bg-${opt.cls}-50 text-${opt.cls}-800`
                     : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300']">
          <component :is="opt.icon" class="w-5 h-5" />
          {{ opt.label }}
        </button>
      </div>

      <!-- Raison de non disponibilité -->
      <div v-if="draftStatus === 'not_available'">
        <label class="block text-xs font-medium text-gray-700 mb-1">Pourquoi non disponible ?</label>
        <input v-model="draftReason" type="text" placeholder="Ex : Le client n'a pas retrouvé les originaux"
               class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500" />
      </div>

      <!-- Dropzone fichiers (si pas Non disponible) -->
      <div v-if="draftStatus !== 'not_available'">
        <label class="block text-xs font-medium text-gray-700 mb-1.5">Fichiers</label>
        <div @dragover.prevent @drop="onDrop"
             class="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center hover:border-indigo-300 transition">
          <p class="text-sm text-gray-500 mb-2">Glisse des fichiers ici, ou</p>
          <label class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg cursor-pointer hover:bg-indigo-100">
            Sélectionner
            <input type="file" multiple class="hidden" @change="onFileInput" />
          </label>
        </div>
        <ul v-if="itemFiles.length" class="mt-2 divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
          <li v-for="f in itemFiles" :key="f.id" class="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-gray-50">
            <a :href="getSiteDocumentDownloadUrl(f.id)" target="_blank" class="flex-1 truncate text-indigo-700 hover:underline">
              {{ f.title }}
            </a>
            <span class="text-[11px] text-gray-400 shrink-0">{{ Math.round((f.size_bytes || 0) / 1024) }} ko</span>
            <button type="button" @click="removeFile(f)" v-tooltip="'Supprimer'"
                    class="text-gray-400 hover:text-red-600 p-1"><XMarkIcon class="w-4 h-4" /></button>
          </li>
        </ul>
      </div>

      <!-- Notes Tiptap -->
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1.5">Notes</label>
        <RichTextEditor v-model="draftNotes" placeholder="Observations, contacts, références…" />
      </div>
    </div>
    <template #footer>
      <button type="button" @click="closeItem" class="px-4 py-2 text-sm rounded-lg text-gray-700 hover:bg-gray-100">
        Annuler
      </button>
      <button type="button" @click="saveItem()" :disabled="itemSaving"
              class="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
        {{ itemSaving ? 'Enregistrement…' : 'Enregistrer' }}
      </button>
    </template>
  </BaseModal>
</template>
