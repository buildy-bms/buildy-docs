<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import {
  DocumentIcon, TrashIcon, ArrowDownTrayIcon, PaperClipIcon,
  PlusIcon, EyeIcon, XMarkIcon, MapPinIcon, ClockIcon,
} from '@heroicons/vue/24/outline'
import {
  listSiteDocuments, uploadSiteDocument, updateSiteDocument, deleteSiteDocument,
  getSiteDocumentDownloadUrl,
} from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import { meterUsageLabel } from '@/lib/meter-options'
import { exifTip, attachmentTip, DOC_ATTACHED_COLUMN_TIP, DOC_REPORT_COLUMN_TIP } from '@/lib/audit-tips-site'
import DocumentViewerModal from '@/components/DocumentViewerModal.vue'
import Tooltip from '@/components/Tooltip.vue'
import SearchableSelect from '@/components/SearchableSelect.vue'
import { groupDocuments, kindShownInGroup } from '@/lib/documents-guide'
import { DOCS_GROUPS, DOCS_REPORT_TIP, DOCS_SITE_WIDE, docsReportCount, docsSummaryLine } from '@/lib/audit-tips-guided'

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
  // Points de check-list et actions de l'audit : nomment le rattachement
  // des documents déposés depuis la check-list ou une action.
  checklist: { type: Array, default: () => [] },
  actions: { type: Array, default: () => [] },
  // Zone de dépôt sur une seule ligne (étape Documents de l'audit à onglets) :
  // mêmes textes, hauteur divisée par ~4.
  compact: { type: Boolean, default: false },
  // Mise en page « Nouvelle » de l'audit : documents groupés par rattachement (lib/documents-guide.js),
  // catégorie en liste de choix de l'appli, pastille « Rattaché à » sans le type redit par le groupe.
  guided: { type: Boolean, default: false },
})

const { success, error } = useNotification()
const { confirm } = useConfirm()

const CATEGORIES = [
  { value: 'plan', label: 'Plan' },
  { value: 'schema_electrique', label: 'Schéma électrique' },
  { value: 'schema_synoptique', label: 'Schéma synoptique' },
  { value: 'analyse_fonctionnelle', label: 'Analyse fonctionnelle' },
  { value: 'datasheet', label: 'Fiche technique' },
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
    notifyDocsChanged()
  } catch (e) {
    error(e.response?.data?.detail || 'Upload impossible')
  } finally {
    uploading.value = false
  }
}

// Prévient l'audit (décompte des documents : règles des étapes Documents et GTB).
function notifyDocsChanged() {
  window.dispatchEvent(new CustomEvent('site-documents:changed'))
}
async function patchDoc(d, patch) {
  try {
    const { data } = await updateSiteDocument(d.id, patch)
    Object.assign(d, data)
    if ('category' in patch) notifyDocsChanged()
  } catch {
    error('Sauvegarde impossible')
  }
}

// Case « Inclure dans le rapport » (annexe E « Documents joints » du PDF),
// décochée par défaut. Mise à jour immédiate à l'écran, puis enregistrement.
const includedCount = computed(() => documents.value.filter(d => d.include_in_report).length)
function setInReport(d, value) {
  const before = d.include_in_report
  d.include_in_report = value ? 1 : 0
  updateSiteDocument(d.id, { include_in_report: !!value }).catch(() => {
    d.include_in_report = before
    error('Sauvegarde impossible')
  })
}
async function setSelectionInReport(value) {
  const docs = documents.value.filter(d => selectedIds.value.has(d.id))
  if (!docs.length) return
  const results = await Promise.allSettled(docs.map(d => {
    d.include_in_report = value ? 1 : 0
    return updateSiteDocument(d.id, { include_in_report: !!value })
  }))
  const failed = results.filter(r => r.status === 'rejected').length
  if (failed) { error('Sauvegarde partielle — recharge la page'); refresh(); return }
  success(`${docs.length} document${docs.length > 1 ? 's' : ''} ${value ? 'inclus dans le' : 'retiré' + (docs.length > 1 ? 's' : '') + ' du'} rapport`)
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
    notifyDocsChanged()
  } catch {
    error('Suppression impossible')
  }
}

function fmtSize(b) {
  if (!b) return ''
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1).replace('.', ',') + ' Ko'
  return (b / 1024 / 1024).toFixed(1).replace('.', ',') + ' Mo'
}

// EXIF helpers — `taken_at` est une string ISO, `gps_latitude/longitude`
// sont des floats en degrés décimaux (WGS84). Le pin GPS ouvre Google Maps
// dans un nouvel onglet.
function fmtTakenAt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}
function gpsMapUrl(d) {
  if (d.gps_latitude == null || d.gps_longitude == null) return null
  return `https://www.google.com/maps/search/?api=1&query=${d.gps_latitude},${d.gps_longitude}`
}
// Informations de la photo (date de prise de vue, appareil, position) : carte
// exifTip (lib/audit-tips-site.js), plus de ligne brute « Pris le … · Canon … · GPS … ».

function categoryLabel(v) {
  return CATEGORIES.find(c => c.value === v)?.label || v
}

const SYSTEM_LABEL_FR = {
  heating: 'Chauffage', cooling: 'Refroidissement', ventilation: 'Ventilation',
  dhw: 'Eau chaude sanitaire', lighting_indoor: 'Éclairage intérieur',
  lighting_outdoor: 'Éclairage extérieur', electricity_production: 'Production photovoltaïque',
}

function attachmentLabel(d) {
  if (d.bacs_audit_zone_id) {
    const z = props.zones.find(x => x.zone_id === d.bacs_audit_zone_id)
    return { kind: 'Zone', label: z?.name || `Zone #${d.bacs_audit_zone_id}` }
  }
  if (d.bacs_audit_device_id) {
    const dev = props.devices.find(x => x.id === d.bacs_audit_device_id)
    return { kind: 'Équipement', label: dev?.name || dev?.brand || `Équipement #${d.bacs_audit_device_id}` }
  }
  if (d.bacs_audit_system_id) {
    const s = props.systems.find(x => x.id === d.bacs_audit_system_id)
    const cat = s ? (SYSTEM_LABEL_FR[s.system_category] || s.system_category) : `Système #${d.bacs_audit_system_id}`
    return { kind: 'Système', label: s ? `${cat} / ${s.zone_name}` : cat }
  }
  if (d.bacs_audit_meter_id) {
    const m = props.meters.find(x => x.id === d.bacs_audit_meter_id)
    return { kind: 'Compteur', label: m ? `${meterUsageLabel(m.usage)} ${m.zone_name ? '/ ' + m.zone_name : ''}`.trim() : `Compteur #${d.bacs_audit_meter_id}` }
  }
  if (d.bacs_audit_bms_document_id) {
    return { kind: 'GTB', label: props.bms?.existing_solution || 'GTB' }
  }
  if (d.bacs_audit_checklist_id) {
    const c = props.checklist.find(x => x.id === d.bacs_audit_checklist_id)
    return { kind: 'Check-list', label: c?.label || '' }
  }
  if (d.bacs_audit_action_item_id) {
    const a = props.actions.find(x => x.id === d.bacs_audit_action_item_id)
    return { kind: 'Action', label: a?.display_number || '' }
  }
  if (d.bacs_audit_inspection_id) {
    return { kind: 'Inspection', label: 'périodique' }
  }
  // Document de l'ensemble du site (plan, schéma, manuel…), sans élément
  // précis : il EST rattaché au site. L'ancien libellé « Site — non
  // rattaché », sous l'en-tête « Rattaché à », se contredisait. Infobulle :
  // attachmentTip (lib/audit-tips-site.js).
  return { kind: 'Site', label: '' }
}

// Lignes du tableau : dans l'ordre d'origine, ou groupées par rattachement (mise en page « Nouvelle »).
const grouped = computed(() => groupDocuments(documents.value, d => attachmentLabel(d).kind, d => attachmentLabel(d).label))
const tableRows = computed(() => (props.guided
  ? grouped.value.rows
  : documents.value.map(doc => ({ doc, group: null, first: false }))))
const CATEGORY_OPTIONS = [...CATEGORIES, { value: 'photo', label: 'Photo' }]

const previewDoc = ref(null)
// Aperçu d'un PDF dans une fenêtre de l'appli (plus de téléchargement forcé).
const viewerDoc = ref(null)
function isImage(d) {
  return (d.mime_type || '').startsWith('image/') || d.category === 'photo'
}
function isPdf(d) {
  return d.mime_type === 'application/pdf' || /\.pdf$/i.test(d.original_name || '')
}
function openPreview(d) {
  if (isImage(d)) previewDoc.value = d
  else if (isPdf(d)) viewerDoc.value = d
  else window.open(getSiteDocumentDownloadUrl(d.id), '_blank')
}

function onDocsChanged() { refresh() }

const selectedIds = ref(new Set())
const allSelected = computed(() =>
  documents.value.length > 0 && documents.value.every(d => selectedIds.value.has(d.id))
)
function toggleAll() {
  if (allSelected.value) selectedIds.value = new Set()
  else selectedIds.value = new Set(documents.value.map(d => d.id))
}
function toggleOne(id) {
  const s = new Set(selectedIds.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  selectedIds.value = s
}
async function downloadSelection() {
  const docs = documents.value.filter(d => selectedIds.value.has(d.id))
  if (!docs.length) return
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i]
    const a = window.document.createElement('a')
    a.href = getSiteDocumentDownloadUrl(d.id)
    a.download = d.original_name || d.title || `document-${d.id}`
    a.target = '_blank'
    window.document.body.appendChild(a)
    a.click()
    window.document.body.removeChild(a)
    if (i < docs.length - 1) await new Promise(r => setTimeout(r, 300))
  }
  success(`Téléchargement de ${docs.length} fichier${docs.length > 1 ? 's' : ''} lancé`)
}
async function deleteSelection() {
  const docs = documents.value.filter(d => selectedIds.value.has(d.id))
  if (!docs.length) return
  const ok = await confirm({
    title: `Supprimer ${docs.length} document${docs.length > 1 ? 's' : ''} ?`,
    message: 'Cette action est irréversible.',
    confirmLabel: 'Supprimer', danger: true,
  })
  if (!ok) return
  try {
    for (const d of docs) await deleteSiteDocument(d.id)
    selectedIds.value = new Set()
    refresh()
    notifyDocsChanged()
    success(`${docs.length} document${docs.length > 1 ? 's' : ''} supprimé${docs.length > 1 ? 's' : ''}`)
  } catch {
    error('Suppression partielle — recharge la page')
  }
}

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
    <!-- Drop zone — pleine largeur, point d'entrée principal -->
    <div
      :class="[
        'w-full border-2 border-dashed rounded-xl text-center transition-all cursor-pointer',
        compact ? 'px-4 py-3 flex items-center justify-center gap-3 flex-wrap' : 'px-6 py-12',
        dragOver
          ? 'border-indigo-500 bg-indigo-50 scale-[1.01] shadow-sm'
          : 'border-gray-300 bg-gray-50/40 hover:border-indigo-400 hover:bg-indigo-50/30',
      ]"
      @dragover.prevent="dragOver = true"
      @dragleave.prevent="dragOver = false"
      @drop="onDrop"
      @click="fileInput?.click()"
    >
      <input ref="fileInput" type="file" class="hidden" @change="onPick"
             accept=".pdf,.dwg,.png,.jpg,.jpeg,.webp,.xls,.xlsx,.doc,.docx,.txt" />
      <PaperClipIcon :class="['transition', compact ? 'w-6 h-6 shrink-0' : 'w-12 h-12 mx-auto', dragOver ? 'text-indigo-500' : 'text-gray-400']" />
      <p :class="compact ? 'text-sm font-medium text-gray-700' : 'mt-3 text-base font-medium text-gray-700'">
        Glisser-déposer un fichier ici
      </p>
      <p :class="compact ? 'text-sm text-gray-500' : 'mt-1 text-sm text-gray-500'">
        ou <span class="text-indigo-600 font-semibold underline-offset-2 hover:underline">parcourir l'ordinateur</span>
      </p>
      <p :class="compact ? 'text-[11px] text-gray-400' : 'mt-3 text-[11px] text-gray-400'">PDF, DWG, images, Office… 25 Mo max</p>
    </div>

    <!-- Liste -->
    <div v-if="loading" class="text-center py-6 text-sm text-gray-400">Chargement…</div>

    <div v-else-if="!documents.length" class="text-center py-6 text-sm text-gray-500">
      Aucun document encore importé pour ce site.
    </div>

    <!-- Bulk actions bar -->
    <div v-if="!loading && documents.length && selectedIds.size" class="mt-4 flex items-center justify-between gap-3 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-lg">
      <span class="text-xs text-indigo-800 font-medium">
        {{ selectedIds.size }} document{{ selectedIds.size > 1 ? 's' : '' }} sélectionné{{ selectedIds.size > 1 ? 's' : '' }}
      </span>
      <div class="flex items-center gap-2 flex-wrap justify-end">
        <button @click="setSelectionInReport(true)"
                class="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-white border border-indigo-200 hover:bg-indigo-50 rounded-lg">
          Inclure dans le rapport
        </button>
        <button @click="setSelectionInReport(false)"
                class="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg">
          Retirer du rapport
        </button>
        <button @click="downloadSelection"
                class="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm">
          <ArrowDownTrayIcon class="w-3.5 h-3.5" /> Télécharger
        </button>
        <button @click="deleteSelection"
                class="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-lg">
          <TrashIcon class="w-3.5 h-3.5" /> Supprimer
        </button>
        <button @click="selectedIds = new Set()"
                class="text-xs text-indigo-700 hover:underline">
          Annuler
        </button>
      </div>
    </div>

    <p v-if="!loading && documents.length && guided" class="mt-4 text-xs text-gray-600">
      <span v-tooltip="DOCS_REPORT_TIP">{{ docsSummaryLine(documents.length, includedCount) }}</span>
    </p>
    <p v-if="!loading && documents.length && !guided" class="mt-4 text-xs text-gray-500">
      <span class="font-semibold text-gray-700">{{ includedCount }}</span>
      document{{ includedCount > 1 ? 's' : '' }} sur {{ documents.length }}
      inclus dans le rapport PDF (annexe « Documents joints »). Coche « Inclure » pour ajouter un document ;
      les photos rattachées à une zone, un système, un équipement, un compteur ou la GTB figurent déjà dans leur chapitre.
    </p>

    <div v-if="!loading && documents.length" class="mt-2 overflow-x-auto">
    <table class="w-full text-sm table-fixed">
      <colgroup>
        <col class="w-10" />
        <col class="w-20" />
        <col />
        <col class="w-48" />
        <col class="w-60" />
        <col class="w-24" />
        <col class="w-24" />
        <col class="w-28" />
      </colgroup>
      <thead class="text-xs uppercase text-gray-500 tracking-wider bg-gray-50">
        <tr>
          <th class="text-center py-2 px-2">
            <input type="checkbox" :checked="allSelected" @change="toggleAll" class="rounded"
                   v-tooltip="allSelected ? { label: 'Tout désélectionner', icon: 'square-minus' } : 'Tout sélectionner'" />
          </th>
          <th class="text-center px-3 py-2">Aperçu</th>
          <th class="text-left px-3 py-2">Titre</th>
          <th class="text-left px-3 py-2">Catégorie</th>
          <th class="text-left px-3 py-2" v-tooltip="DOC_ATTACHED_COLUMN_TIP">Rattaché à</th>
          <th class="text-right px-3 py-2">Taille</th>
          <th class="text-center px-3 py-2" v-tooltip="DOC_REPORT_COLUMN_TIP">Rapport</th>
          <th class="text-center px-3 py-2">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100">
        <template v-for="{ doc: d, group: g, first } in tableRows" :key="d.id">
        <!-- Mise en page « Nouvelle » : en-tête de groupe (rattachement). -->
        <tr v-if="first" class="docs-group-head">
          <td colspan="8" class="px-3 py-2 bg-slate-100 text-left">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-[13px] font-semibold text-indigo-600 normal-case">{{ DOCS_GROUPS[g].label }}</span>
              <span class="text-xs text-gray-500">{{ grouped.groups[g].count }}<template v-if="grouped.groups[g].inReport"> · {{ docsReportCount(grouped.groups[g].inReport) }}</template><template v-if="DOCS_GROUPS[g].note"> · {{ DOCS_GROUPS[g].note }}</template></span>
            </div>
          </td>
        </tr>
        <tr :class="['group hover:bg-gray-50/60 align-middle', selectedIds.has(d.id) ? 'bg-indigo-50/40' : '']">
          <td class="text-center py-2 px-2 align-middle">
            <input type="checkbox" :checked="selectedIds.has(d.id)" @change="toggleOne(d.id)" class="rounded"
                   v-tooltip="selectedIds.has(d.id) ? { label: 'Désélectionner ce document', icon: 'square-minus' } : 'Sélectionner ce document'" />
          </td>
          <td class="px-3 py-2 text-center align-middle">
            <button v-if="isImage(d)" @click="openPreview(d)" class="inline-block" v-tooltip="'Agrandir la photo'">
              <img :src="getSiteDocumentDownloadUrl(d.id)" :alt="d.title || d.original_name || 'Document'"
                   loading="lazy" decoding="async"
                   class="w-12 h-12 object-cover rounded border border-gray-200 hover:border-indigo-400 transition" />
            </button>
            <button v-else-if="isPdf(d)" @click="openPreview(d)" class="inline-block" v-tooltip="'Voir le PDF'">
              <DocumentIcon class="w-6 h-6 text-gray-400 hover:text-indigo-600 mx-auto transition" />
            </button>
            <DocumentIcon v-else class="w-6 h-6 text-gray-400 mx-auto" />
          </td>
          <td class="px-3 py-2 text-gray-700 align-middle min-w-0">
            <input type="text" :value="d.title" v-tooltip.overflow
                   @blur="e => e.target.value !== d.title && patchDoc(d, { title: e.target.value })"
                   class="w-full px-2 py-1 border border-transparent hover:border-gray-200 focus:border-indigo-500 focus:outline-none rounded text-sm" />
            <div class="px-2 mt-0.5 flex items-center gap-2 flex-wrap text-[11px] text-gray-400">
              <span class="truncate" v-tooltip.overflow>{{ d.original_name }}</span>
              <span v-if="d.taken_at" v-tooltip="exifTip(d)"
                    class="inline-flex items-center gap-0.5 text-gray-500 shrink-0">
                <ClockIcon class="w-3 h-3" />
                {{ fmtTakenAt(d.taken_at) }}
              </span>
              <a v-if="gpsMapUrl(d)" :href="gpsMapUrl(d)" target="_blank" rel="noopener"
                 v-tooltip="'Voir l’endroit sur Google Maps'"
                 class="inline-flex items-center gap-0.5 text-indigo-600 hover:text-indigo-800 shrink-0"
                 @click.stop>
                <MapPinIcon class="w-3 h-3" />
                GPS
              </a>
            </div>
          </td>
          <td class="px-3 py-2 align-middle">
            <SearchableSelect v-if="guided" :model-value="d.category" :options="CATEGORY_OPTIONS"
                              :clearable="false" size="sm"
                              @update:model-value="v => v && v !== d.category && patchDoc(d, { category: v })" />
            <select v-else :value="d.category"
                    @change="e => patchDoc(d, { category: e.target.value })"
                    class="w-full text-xs px-2 py-1 border border-gray-200 rounded">
              <option v-for="c in CATEGORIES" :key="c.value" :value="c.value">{{ c.label }}</option>
              <option value="photo">Photo</option>
            </select>
          </td>
          <td class="px-3 py-2 align-middle">
            <!-- Mise en page « Nouvelle » : le groupe dit déjà le type de rattachement. -->
            <span v-if="guided && attachmentLabel(d).kind === 'Site'" class="text-xs text-gray-400"
                  v-tooltip="attachmentTip(attachmentLabel(d))">{{ DOCS_SITE_WIDE }}</span>
            <span v-else :class="['inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full border max-w-full whitespace-nowrap',
              attachmentLabel(d).kind === 'Site'
                ? 'border-gray-200 text-gray-600 bg-gray-50'
                : 'border-indigo-200 text-indigo-700 bg-indigo-50']"
                  v-tooltip="attachmentTip(attachmentLabel(d))">
              <span v-if="!guided || kindShownInGroup(g) || !attachmentLabel(d).label" class="font-semibold shrink-0">{{ attachmentLabel(d).kind }}</span>
              <span v-if="attachmentLabel(d).label" class="truncate">{{ attachmentLabel(d).label }}</span>
            </span>
          </td>
          <td class="px-3 py-2 text-right text-xs text-gray-500 tabular-nums align-middle whitespace-nowrap">{{ fmtSize(d.size_bytes) }}</td>
          <td class="px-3 py-2 text-center align-middle">
            <label class="inline-flex items-center gap-1.5 text-xs leading-5 text-gray-600 cursor-pointer select-none align-middle"
                   v-tooltip="{ label: 'Joindre ce document au rapport PDF', icon: 'paperclip' }">
              <input type="checkbox" :checked="!!d.include_in_report"
                     @change="e => setInReport(d, e.target.checked)"
                     class="rounded accent-emerald-600" />
              Inclure
            </label>
          </td>
          <td class="px-3 py-2 text-center whitespace-nowrap align-middle">
            <button v-if="isImage(d) || isPdf(d)" @click="openPreview(d)"
                    class="text-gray-400 hover:text-indigo-600 mx-0.5 p-1" v-tooltip="'Voir ce document'">
              <EyeIcon class="w-4 h-4" />
            </button>
            <a :href="getSiteDocumentDownloadUrl(d.id)" target="_blank"
               class="inline-block text-gray-400 hover:text-indigo-600 mx-0.5 p-1" v-tooltip="'Télécharger ce document'">
              <ArrowDownTrayIcon class="w-4 h-4" />
            </a>
            <button @click="removeDoc(d)" class="text-gray-400 hover:text-red-600 mx-0.5 p-1" v-tooltip="'Supprimer ce document'">
              <TrashIcon class="w-4 h-4" />
            </button>
          </td>
        </tr>
        </template>
      </tbody>
    </table>
    </div>

    <!-- Aperçu PDF dans l'appli -->
    <DocumentViewerModal :doc="viewerDoc" @close="viewerDoc = null" />

    <!-- Modal lightbox preview -->
    <div v-if="previewDoc"
         class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
         @click.self="previewDoc = null">
      <div class="relative max-w-6xl max-h-[90vh] w-full flex flex-col">
        <header class="flex items-center justify-between text-white mb-3">
          <div class="min-w-0 flex-1">
            <h3 class="text-base font-semibold truncate" v-tooltip.overflow>{{ previewDoc.title }}</h3>
            <p class="text-xs opacity-70 truncate" v-tooltip.overflow>
              {{ attachmentLabel(previewDoc).kind }}{{ attachmentLabel(previewDoc).label ? ' : ' + attachmentLabel(previewDoc).label : '' }}
              · {{ fmtSize(previewDoc.size_bytes) }}
            </p>
            <div v-if="previewDoc.taken_at || gpsMapUrl(previewDoc) || previewDoc.camera_make || previewDoc.camera_model"
                 class="mt-1 flex items-center gap-3 flex-wrap text-[11px] opacity-80"
                 v-tooltip="exifTip(previewDoc)">
              <span v-if="previewDoc.taken_at" class="inline-flex items-center gap-1">
                <ClockIcon class="w-3 h-3" />
                {{ fmtTakenAt(previewDoc.taken_at) }}
              </span>
              <a v-if="gpsMapUrl(previewDoc)" :href="gpsMapUrl(previewDoc)" target="_blank" rel="noopener"
                 v-tooltip="'Voir l’endroit sur Google Maps'"
                 class="inline-flex items-center gap-1 text-indigo-200 hover:text-white">
                <MapPinIcon class="w-3 h-3" />
                {{ previewDoc.gps_latitude.toFixed(5) }}, {{ previewDoc.gps_longitude.toFixed(5) }}
              </a>
              <span v-if="previewDoc.camera_make || previewDoc.camera_model" class="text-white/60">
                {{ [previewDoc.camera_make, previewDoc.camera_model].filter(Boolean).join(' ') }}
              </span>
            </div>
          </div>
          <a :href="getSiteDocumentDownloadUrl(previewDoc.id)" target="_blank"
             class="ml-4 px-3 py-1.5 text-xs font-medium text-white border border-white/40 rounded hover:bg-white/10">
            <ArrowDownTrayIcon class="w-4 h-4 inline-block mr-1" /> Télécharger
          </a>
          <button @click="previewDoc = null" class="ml-2 p-2 text-white hover:bg-white/10 rounded"
                  v-tooltip="'Fermer l’aperçu'">
            <XMarkIcon class="w-5 h-5" />
          </button>
        </header>
        <img :src="getSiteDocumentDownloadUrl(previewDoc.id)" :alt="previewDoc.title || 'Document'"
             decoding="async"
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
                {{ SYSTEM_LABEL_FR[s.system_category] || s.custom_label || s.system_category }} / {{ s.zone_name }}
              </option>
            </select>
          </div>
          <div class="flex justify-end gap-2 pt-3">
            <button type="button" @click="showModal = false"
                    class="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">
              Annuler
            </button>
            <Tooltip :text="uploading ? 'Envoi en cours…' : (!pendingMeta.title.trim() ? 'Donne d’abord un titre au document' : null)">
              <button type="submit" :disabled="uploading || !pendingMeta.title.trim()"
                      class="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap">
                {{ uploading ? 'Envoi…' : 'Téléverser' }}
              </button>
            </Tooltip>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
