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
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import { ClipboardDocumentCheckIcon } from '@heroicons/vue/24/outline'
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

async function load({ silent = false } = {}) {
  if (!silent) loading.value = true
  try {
    const [c, cov] = await Promise.all([
      getBacsChecklist(props.docId),
      getBacsPhotoCoverage(props.docId),
    ])
    // MAJ ciblée sur les items existants (par catalog_key) pour ne pas
    // déranger le rendu Vue avec un nouveau tableau (cause de clignotement) ;
    // sinon, premier mount, on assigne l'array.
    if (items.value.length && c.data.length === items.value.length) {
      const byKey = new Map(c.data.map(x => [x.catalog_key, x]))
      for (const it of items.value) {
        const fresh = byKey.get(it.catalog_key)
        if (!fresh) continue
        // On préserve l'objet pour ne pas re-render la ligne si rien n'a
        // changé visuellement (status, files_count, raison, id).
        if (it.id !== fresh.id) it.id = fresh.id
        if (it.files_count !== fresh.files_count) it.files_count = fresh.files_count
        if (it.status !== fresh.status) it.status = fresh.status
        if (it.notes_html !== fresh.notes_html) it.notes_html = fresh.notes_html
        if (it.not_available_reason !== fresh.not_available_reason) it.not_available_reason = fresh.not_available_reason
      }
    } else {
      items.value = c.data
    }
    coverage.value = cov.data
  } catch (e) {
    if (!silent) error('Chargement de la check-list impossible')
  } finally {
    if (!silent) loading.value = false
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
// NB : `document` est shadowed par le ref destructuré ligne 47 — on passe
// par `window.document` pour pointer le DOM global.
onMounted(() => window.document.addEventListener('mousedown', closePopover))
onBeforeUnmount(() => window.document.removeEventListener('mousedown', closePopover))

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

// ─── Quick toggle « Non disponible » avec optimistic update ─────────
// On modifie l'objet en place (Vue détecte le changement de status sans
// re-render la ligne entière). Pas de `load()` derrière → pas de
// clignotement. Le serveur confirme en arrière-plan.
async function quickToggleNotAvailable(item) {
  const newStatus = item.status === 'not_available' ? 'pending' : 'not_available'
  const prev = item.status
  item.status = newStatus
  try {
    const { data } = await updateBacsChecklistItem(props.docId, item.catalog_key, { status: newStatus })
    item.id = data.id
    item.status = data.status
  } catch {
    item.status = prev
    error('Mise à jour impossible')
  }
}

// ─── Drag-drop direct sur une ligne d'item (sans ouvrir la modale) ──
const dragOverItem = ref(null)

async function onDropFiles(e, item) {
  e.preventDefault()
  dragOverItem.value = null
  const files = Array.from(e.dataTransfer?.files || [])
  if (!files.length) return
  if (!document.value?.site_uuid) {
    error('Audit non rattaché à un site, impossible d\'uploader.')
    return
  }
  // Lazy create de la ligne d'état si besoin (1er upload)
  let target = item
  if (!target.id) {
    try {
      const { data } = await updateBacsChecklistItem(props.docId, item.catalog_key, {
        status: 'available',
      })
      // Recharge pour avoir le nouveau id
      await load()
      target = items.value.find(i => i.catalog_key === item.catalog_key) || target
    } catch { error('Création de la ligne impossible'); return }
  }
  for (const file of files) {
    try {
      const fd = new FormData()
      fd.append('file', file)
      await uploadSiteDocument(document.value.site_uuid, fd, {
        title: file.name,
        category: 'autre',
        bacs_audit_checklist_id: target.id,
      })
    } catch { error(`Upload « ${file.name} » impossible`) }
  }
  // Bascule auto en « Collecté » si on était en pending
  if (target.status === 'pending') {
    try {
      await updateBacsChecklistItem(props.docId, target.catalog_key, { status: 'available' })
    } catch { /* silencieux */ }
  }
  await load()
  success(`${files.length} fichier${files.length > 1 ? 's' : ''} ajouté${files.length > 1 ? 's' : ''}`)
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
  <CollapsibleSection storage-key="docs-checklist" section-id="section-docs-checklist" :active="active">
    <template #header>
      <SectionHeader number="9" title="Check-list documentaire"
                     :subtitle="`${totalScore} / ${totalPossible} collectés (${completionPct}%)`"
                     :icon="ClipboardDocumentCheckIcon" icon-color="text-indigo-600"
                     :step="step"
                     @validate="emit('validate-step', $event)"
                     @invalidate="emit('invalidate-step', $event)" />
    </template>

    <div v-if="loading" class="px-5 py-6 text-center text-sm text-gray-400">Chargement…</div>

    <div v-else class="px-5 py-4 space-y-3">
      <!-- ── BLOC 1 : Couverture photo (KPI pleines) ───────────────────── -->
      <section ref="popoverRef">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-1.5">
          <button v-for="kind in ['zones', 'systems', 'meters', 'bms']" :key="kind"
                  type="button"
                  @click="kind !== 'bms' ? togglePopover(kind) : emit('goto-bms')"
                  :class="['relative rounded-md px-2.5 py-1.5 text-left transition-colors duration-200 flex items-center gap-2 border',
                           coverage[kind].total === 0
                             ? 'bg-gray-50 border-gray-200 text-gray-400'
                             : coverage[kind].covered === coverage[kind].total
                               ? 'bg-emerald-100 border-emerald-300 text-emerald-900 hover:bg-emerald-200'
                               : 'bg-amber-100 border-amber-300 text-amber-900 hover:bg-amber-200']">
            <MapPinIcon v-if="kind === 'zones'" class="w-3.5 h-3.5 shrink-0 opacity-70" />
            <WrenchScrewdriverIcon v-if="kind === 'systems'" class="w-3.5 h-3.5 shrink-0 opacity-70" />
            <BoltIcon v-if="kind === 'meters'" class="w-3.5 h-3.5 shrink-0 opacity-70" />
            <CpuChipIcon v-if="kind === 'bms'" class="w-3.5 h-3.5 shrink-0 opacity-70" />
            <div class="flex-1 min-w-0">
              <p class="text-[10px] uppercase tracking-wider opacity-70 leading-tight">
                {{ { zones: 'Zones', systems: 'Systèmes', meters: 'Compteurs', bms: 'GTB' }[kind] }}
              </p>
              <p class="text-sm font-semibold leading-tight">
                {{ coverage[kind].covered }}<span class="opacity-50 font-normal">/{{ coverage[kind].total }}</span>
              </p>
            </div>
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

      <!-- ── BLOC 2 : Pièces jointes du dossier (1 ligne par item) ──────── -->
      <section>
        <div v-if="!items.length" class="text-sm text-gray-400 italic px-3 py-3 border border-dashed border-gray-200 rounded-md text-center">
          Aucun item dans le catalogue.
        </div>
        <ul v-else class="space-y-1">
          <li v-for="item in items" :key="item.catalog_key"
              @dragover.prevent="dragOverItem = item.catalog_key"
              @dragleave="dragOverItem === item.catalog_key && (dragOverItem = null)"
              @drop="onDropFiles($event, item)"
              :class="['relative border rounded-md flex items-center gap-2 px-2.5 py-1.5 transition-colors duration-200',
                       statusClass(item.status),
                       dragOverItem === item.catalog_key ? 'border-indigo-500! ring-2 ring-indigo-500/30 bg-indigo-50!' : '']">
            <EquipmentIcon :template="{ icon_kind: 'fa', icon_value: item.icon_value || 'fa-file', icon_color: item.icon_color || '#6b7280' }"
                           size="sm" class="shrink-0" />

            <div class="flex-1 min-w-0 leading-tight">
              <p :class="['text-sm font-medium truncate',
                          item.status === 'not_available' ? 'line-through text-gray-500' : 'text-gray-800']">
                {{ item.label }}
              </p>
              <p v-if="item.status === 'available'" class="text-[11px] text-emerald-700 inline-flex items-center gap-1 mt-0.5">
                <CheckIcon class="w-3 h-3" /> {{ item.files_count }} fichier{{ item.files_count > 1 ? 's' : '' }}
              </p>
              <p v-else-if="item.status === 'not_available'" class="text-[11px] text-gray-500 inline-flex items-center gap-1 mt-0.5 truncate">
                <NoSymbolIcon class="w-3 h-3 shrink-0" /> {{ item.not_available_reason || 'Non disponible' }}
              </p>
            </div>

            <!-- Actions inline -->
            <div class="flex items-center gap-1 shrink-0">
              <BacsPhotoButton
                v-if="document?.site_uuid"
                :site-uuid="document.site_uuid"
                :attach-to="{ checklist_id: item.id }"
                :label="item.label"
                size="sm"
                @changed="load({ silent: true })" />
              <span v-else
                    v-tooltip="'Rattacher un site à l\'audit pour activer les photos'"
                    class="inline-flex items-center justify-center w-7 h-7 text-gray-300 bg-gray-50 border border-gray-200 rounded-md cursor-not-allowed">
                <CameraIcon class="w-3.5 h-3.5" />
              </span>
              <button type="button" @click.stop="openItem(item)"
                      v-tooltip="'Notes & fichiers'"
                      class="inline-flex items-center justify-center w-7 h-7 text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100">
                <PencilSquareIcon class="w-3.5 h-3.5" />
              </button>
              <button type="button" @click.stop="quickToggleNotAvailable(item)"
                      v-tooltip="item.status === 'not_available' ? 'Réactiver (= À collecter)' : 'Marquer non disponible'"
                      :class="['inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors',
                               item.status === 'not_available'
                                 ? 'text-gray-700 bg-gray-100 border-gray-300 hover:bg-gray-200'
                                 : 'text-gray-500 bg-white border-gray-200 hover:bg-gray-50 hover:text-gray-700']">
                <NoSymbolIcon class="w-3.5 h-3.5" />
              </button>
            </div>
          </li>
        </ul>
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
