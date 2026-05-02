<script setup>
import { computed, ref, watch, nextTick } from 'vue'
import {
  CheckBadgeIcon, ArrowLeftIcon,
  DocumentArrowDownIcon, TableCellsIcon, ClockIcon, ChevronDownIcon,
  RocketLaunchIcon, PencilSquareIcon, UserGroupIcon, ListBulletIcon,
  EyeIcon,
} from '@heroicons/vue/24/outline'
import ShareAfModal from './ShareAfModal.vue'
import AfInstancesModal from './AfInstancesModal.vue'
import AddressAutocomplete from './AddressAutocomplete.vue'
import PdfPreviewModal from './PdfPreviewModal.vue'
import { useRouter } from 'vue-router'
import api, {
  updateAf, exportPointsList, exportAf, exportSynthesis, downloadExportUrl,
  previewAfUrl, previewPointsListUrl,
  listSections, getAfRequiredLevel,
} from '@/api'
import SectionPickerTree from './SectionPickerTree.vue'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import BaseModal from './BaseModal.vue'
import StatusBadge from './StatusBadge.vue'
import ServiceLevelBadge from './ServiceLevelBadge.vue'

const props = defineProps({
  af: { type: Object, required: true },
})
const emit = defineEmits(['updated', 'back', 'toggle-activity', 'toggle-presentation', 'goto-section'])
import { inject } from 'vue'
const presentationMode = inject('presentationMode', null)

const { success, error } = useNotification()
const { confirm } = useConfirm()
const router = useRouter()
const submitting = ref(false)
const showExport = ref(false)
const exportKind = ref('points-list') // 'points-list' | 'af'
const exportMotif = ref('')
const exportIncludeBacs = ref(false)
const lastExportId = ref(null)
const lastExportInfo = ref(null)

// Lot 28 — partage AF
const showShare = ref(false)
const showInstances = ref(false)

// Lot 29 — édition des métadonnées AF
const showEdit = ref(false)
// Inline rename du nom de projet (raccourci edition rapide P6.4) — evite
// d'avoir a ouvrir la modale complete juste pour corriger une typo. Le
// pencil icon a cote ouvre toujours la modale pour les autres champs.
const inlineEdit = ref(false)
const inlineProjectName = ref('')
const inlineInputRef = ref(null)
function startInlineEdit() {
  inlineProjectName.value = props.af.project_name || ''
  inlineEdit.value = true
  nextTick(() => inlineInputRef.value?.focus())
}
async function saveInlineEdit() {
  const next = inlineProjectName.value.trim()
  inlineEdit.value = false
  if (!next || next === props.af.project_name) return
  try {
    const { data } = await updateAf(props.af.id, { project_name: next })
    success('Nom du projet mis à jour')
    emit('updated', data)
  } catch (e) {
    error(e.response?.data?.detail || 'Échec mise à jour')
  }
}
function cancelInlineEdit() {
  inlineEdit.value = false
}
function onInlineKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveInlineEdit() }
  else if (e.key === 'Escape') { e.preventDefault(); cancelInlineEdit() }
}
const editForm = ref({ client_name: '', project_name: '', site_address: '', service_level: null })
function openEdit() {
  editForm.value = {
    client_name: props.af.client_name,
    project_name: props.af.project_name,
    site_address: props.af.site_address || '',
    service_level: props.af.service_level || null,
  }
  showEdit.value = true
}
async function submitEdit() {
  if (!editForm.value.client_name.trim() || !editForm.value.project_name.trim()) return
  submitting.value = true
  try {
    const { data } = await updateAf(props.af.id, {
      client_name: editForm.value.client_name.trim(),
      project_name: editForm.value.project_name.trim(),
      site_address: editForm.value.site_address.trim() || null,
      service_level: editForm.value.service_level,
    })
    success('AF mise à jour')
    showEdit.value = false
    emit('updated', data)
  } catch (e) {
    error(e.response?.data?.detail || 'Échec de la mise à jour')
  } finally {
    submitting.value = false
  }
}

// Lot 21 — sélecteur de sections à inclure
const exportSections = ref([])
const exportExcluded = ref(new Set())
const showSectionPicker = ref(false)
const liveRequiredLevel = ref(null)
const LEVEL_LABEL = { E: 'Essentials', S: 'Smart', P: 'Premium' }

async function loadSectionsForPicker() {
  try {
    const { data } = await listSections(props.af.id)
    exportSections.value = data
  } catch { exportSections.value = [] }
}

let recalcTimer = null
async function recalcRequiredLevel() {
  clearTimeout(recalcTimer)
  recalcTimer = setTimeout(async () => {
    try {
      const { data } = await getAfRequiredLevel(props.af.id, [...exportExcluded.value])
      liveRequiredLevel.value = data
    } catch { /* ignore */ }
  }, 200)
}
watch(exportExcluded, recalcRequiredLevel, { deep: true })

// Workflow d'avancement de phase (Lot 15)
const PHASE_FLOW = ['redaction', 'validee', 'commissioning', 'commissioned', 'livree']
const PHASE_LABELS = {
  redaction: 'Rédaction en cours',
  validee: 'Validée',
  commissioning: 'Commissionnement en cours',
  commissioned: 'Commissionnée',
  livree: 'Projet livré',
}
const nextPhase = computed(() => {
  const idx = PHASE_FLOW.indexOf(props.af.status)
  return idx >= 0 && idx < PHASE_FLOW.length - 1 ? PHASE_FLOW[idx + 1] : null
})
const showPhaseMenu = ref(false)
const showTransitionModal = ref(false)
const transitionTo = ref(null)
const transitionMotif = ref('')
const transitionNotes = ref('')
const transitionWarnings = ref([])

function openPhaseMenu() { showPhaseMenu.value = !showPhaseMenu.value }

async function startTransition(target) {
  showPhaseMenu.value = false
  transitionTo.value = target
  transitionMotif.value = ''
  transitionNotes.value = ''
  transitionWarnings.value = []
  // Validee + livree : modale obligatoire (snapshot figé)
  if (target === 'validee' || target === 'livree') {
    // Pre-check : remonte les avertissements (sections vides, equipements
    // sans instance, etc.) avant que l'utilisateur ne confirme.
    try {
      const { data } = await api.get(`/afs/${props.af.id}/transition-checks`, { params: { to: target } })
      transitionWarnings.value = data.warnings || []
    } catch { /* check informatif, on ouvre quand meme la modale */ }
    showTransitionModal.value = true
  } else {
    confirmTransition()
  }
}

async function confirmTransition() {
  const target = transitionTo.value
  const isSnapshot = target === 'validee' || target === 'livree'
  if (isSnapshot && !transitionMotif.value.trim()) return
  submitting.value = true
  try {
    const { data } = await api.post(`/afs/${props.af.id}/transition`, {
      to: target,
      motif: transitionMotif.value.trim() || null,
      notes: transitionNotes.value.trim() || null,
    })
    success(isSnapshot
      ? `${PHASE_LABELS[target]} — snapshot figé (PDF + tag Git)`
      : `Phase passée à : ${PHASE_LABELS[target]}`)
    showTransitionModal.value = false
    emit('updated', data.af)
    if (data.pdf_export_id) {
      window.open(`/api/exports/${data.pdf_export_id}/download`, '_blank')
    }
  } catch (e) {
    error(e.response?.data?.detail || 'Échec de la transition')
  } finally {
    submitting.value = false
  }
}

async function rollbackPhase() {
  const idx = PHASE_FLOW.indexOf(props.af.status)
  if (idx <= 0) return
  const prev = PHASE_FLOW[idx - 1]
  const ok = await confirm({
    title: `Revenir à « ${PHASE_LABELS[prev]} » ?`,
    message: 'Cela lève le verrou doux et permet à nouveau toutes les modifications.',
    confirmLabel: 'Revenir en arrière',
  })
  if (!ok) return
  submitting.value = true
  try {
    const { data } = await api.post(`/afs/${props.af.id}/transition`, { to: prev })
    success(`Phase revenue à : ${PHASE_LABELS[prev]}`)
    showPhaseMenu.value = false
    emit('updated', data.af)
  } catch (e) {
    error(e.response?.data?.detail || 'Échec')
  } finally {
    submitting.value = false
  }
}

function openExport(kind) {
  exportKind.value = kind
  exportMotif.value = ''
  exportIncludeBacs.value = false
  lastExportId.value = null
  lastExportInfo.value = null
  exportExcluded.value = new Set()
  showSectionPicker.value = false
  liveRequiredLevel.value = null
  showExport.value = true
  loadSectionsForPicker()
  recalcRequiredLevel()
}

async function submitExport() {
  if (!exportMotif.value.trim()) return
  submitting.value = true
  try {
    const fn = exportKind.value === 'af' ? exportAf
             : exportKind.value === 'synthesis' ? exportSynthesis
             : exportPointsList
    const payload = { motif: exportMotif.value.trim() }
    if (exportKind.value === 'af') payload.includeBacsAnnex = exportIncludeBacs.value
    if (exportExcluded.value.size > 0) payload.excluded_section_ids = [...exportExcluded.value]
    const { data } = await fn(props.af.id, payload)
    if (exportKind.value === 'af') {
      success(`PDF AF généré : ${data.version} — ${data.sections_total} sections (${(data.file_size_bytes / 1024).toFixed(0)} KB) — Niveau requis : ${data.service_level?.label || '—'}`)
    } else if (exportKind.value === 'synthesis') {
      success(`Tableau de synthèse généré : ${data.version} — ${data.rows_count} systèmes (${(data.file_size_bytes / 1024).toFixed(0)} KB)`)
    } else {
      success(`PDF généré : ${data.version} — ${data.total_lines} ligne${data.total_lines > 1 ? 's' : ''} (${(data.file_size_bytes / 1024).toFixed(0)} KB)`)
    }
    lastExportId.value = data.id
    lastExportInfo.value = data
    window.open(downloadExportUrl(data.id), '_blank')
  } catch (e) {
    error(e.response?.data?.detail || 'Échec de la génération du PDF')
  } finally {
    submitting.value = false
  }
}

// Apercu HTML in-browser (sans Puppeteer) — disponible pour AF + points-list.
// Synthesis n'est pas couvert pour l'instant (rendu trop specifique, peu utilise
// hors export PDF final).
const previewOpen = ref(false)
const previewKind = ref(null)
const previewUrlComputed = computed(() => {
  if (!previewKind.value) return ''
  if (previewKind.value === 'af') return previewAfUrl(props.af.id, exportIncludeBacs.value)
  if (previewKind.value === 'points-list') return previewPointsListUrl(props.af.id)
  return ''
})
const previewTitle = computed(() => {
  if (previewKind.value === 'af') return "Aperçu — Analyse fonctionnelle"
  if (previewKind.value === 'points-list') return "Aperçu — Liste de points"
  return 'Aperçu'
})
function openPreview() {
  if (exportKind.value === 'synthesis') return // pas de preview synthesis (volumineux, peu utile)
  previewKind.value = exportKind.value
  previewOpen.value = true
}
function closePreview() { previewOpen.value = false; previewKind.value = null }

const exportTitle = computed(() => {
  if (exportKind.value === 'af') return "Exporter l'analyse fonctionnelle (PDF A4)"
  if (exportKind.value === 'synthesis') return 'Exporter le tableau de synthèse (PDF A3 paysage)'
  return 'Exporter la liste de points contractuelle (PDF A3)'
})
const exportDescription = computed(() => {
  if (exportKind.value === 'af') return "Génère le PDF complet de l'AF (12 chapitres, sections, captures, badges niveau service, calcul auto du niveau requis sur la page de garde). A4 portrait."
  if (exportKind.value === 'synthesis') return "Génère un tableau matriciel A3 paysage : tous les systèmes en lignes, par colonnes les compteurs de points par type, instances, fonctions Hyperveez applicables. Vue d'ensemble synthétique pour DOE."
  return "Génère un PDF A3 portrait avec page de garde Buildy, sommaire par catégorie d'équipement, et toutes les lignes points × instances définies dans la fiche AF."
})
</script>

<template>
  <div class="bg-white border border-gray-200 px-5 py-3 flex items-center gap-3 mb-4">
    <button @click="emit('back')" class="p-1 -ml-1 text-gray-500 hover:text-gray-800">
      <ArrowLeftIcon class="w-4 h-4" />
    </button>
    <div class="min-w-0 flex-1">
      <h2 class="text-sm font-semibold text-gray-800 truncate flex items-center gap-1.5">
        <span class="text-gray-500">{{ af.client_name }} —</span>
        <input
          v-if="inlineEdit"
          ref="inlineInputRef"
          v-model="inlineProjectName"
          @blur="saveInlineEdit"
          @keydown="onInlineKeydown"
          type="text"
          autocomplete="off"
          data-1p-ignore="true"
          data-bwignore="true"
          data-lpignore="true"
          class="flex-1 min-w-0 text-sm font-semibold text-gray-800 bg-indigo-50 border-0 rounded px-1 py-0 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
        />
        <span
          v-else
          @click="startInlineEdit"
          class="cursor-text hover:bg-gray-100 rounded px-1 -mx-1"
          title="Cliquer pour renommer rapidement (Entrée valide, Esc annule)"
        >{{ af.project_name }}</span>
        <button @click="openEdit" class="text-gray-300 hover:text-indigo-600 shrink-0" title="Éditer client / projet / contrat">
          <PencilSquareIcon class="w-3.5 h-3.5" />
        </button>
      </h2>
      <p v-if="af.site_address" class="text-xs text-gray-500 truncate">{{ af.site_address }}</p>
    </div>
    <ServiceLevelBadge v-if="af.service_level" :level="af.service_level" />
    <span v-else class="text-[10px] text-gray-400 italic px-2 py-0.5 border border-dashed border-gray-200 rounded">contrat à définir</span>
    <StatusBadge :status="af.status" />
    <div class="w-px h-6 bg-gray-200"></div>
    <button
      @click="openExport('af')"
      class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700"
      title="Exporter l'analyse fonctionnelle complète en PDF A4"
    >
      <DocumentArrowDownIcon class="w-4 h-4" />
      AF (A4)
    </button>
    <div class="inline-flex rounded-lg overflow-hidden">
      <button
        @click="openExport('points-list')"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700"
        title="Exporter la liste de points contractuelle en PDF A3"
      >
        <TableCellsIcon class="w-4 h-4" />
        Points (A3)
      </button>
      <a
        :href="`/api/afs/${af.id}/exports/points-list.xlsx`"
        download
        class="inline-flex items-center px-2.5 py-1.5 bg-indigo-700 text-white text-xs font-medium hover:bg-indigo-800 border-l border-indigo-500"
        title="Télécharger la liste de points en Excel (XLSX, intégrateur GTB)"
      >
        XLSX
      </a>
    </div>
    <button
      @click="openExport('synthesis')"
      class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700"
      title="Exporter le tableau de synthèse en PDF A3 paysage"
    >
      <TableCellsIcon class="w-4 h-4" />
      Synthèse (A3)
    </button>
    <button
      @click="showInstances = true"
      class="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50"
      title="Vue tableau de toutes les instances d'équipements de l'AF"
    >
      <ListBulletIcon class="w-4 h-4" />
      Instances
    </button>
    <button
      @click="showShare = true"
      class="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50"
      title="Partager cette AF avec d'autres utilisateurs"
    >
      <UserGroupIcon class="w-4 h-4" />
      Partager
    </button>
    <button
      @click="emit('toggle-activity')"
      class="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50"
      title="Panneau d'activité"
    >
      <ClockIcon class="w-4 h-4" />
      Activité
    </button>
    <button
      @click="emit('toggle-presentation')"
      :class="[
        'inline-flex items-center gap-1.5 px-3 py-1.5 border text-xs font-medium rounded-lg',
        presentationMode?.value
          ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
          : 'border-gray-200 text-gray-700 hover:bg-gray-50',
      ]"
      title="Mode présentation : masque les boutons d'édition (utile en réunion)"
    >
      👁️ {{ presentationMode?.value ? 'Quitter présentation' : 'Présentation' }}
    </button>
    <button
      @click="router.push(`/afs/${af.id}/versions`)"
      class="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50"
      title="Historique des versions Git"
    >
      <ClockIcon class="w-4 h-4" />
      Versions
    </button>
    <!-- Bouton "Faire avancer la phase" (Lot 15) -->
    <div v-if="nextPhase" class="relative">
      <button
        @click="openPhaseMenu"
        :disabled="submitting"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50"
        title="Faire avancer la phase de l'AF"
      >
        <RocketLaunchIcon class="w-4 h-4" />
        Faire avancer la phase
        <ChevronDownIcon class="w-3 h-3" />
      </button>
      <div v-if="showPhaseMenu" class="absolute right-0 mt-1 w-72 bg-white border border-gray-200 shadow-lg rounded-lg z-30">
        <button
          @click="startTransition(nextPhase)"
          class="w-full text-left px-4 py-2.5 hover:bg-emerald-50 text-sm border-b border-gray-100"
        >
          <p class="font-semibold text-gray-800">→ {{ PHASE_LABELS[nextPhase] }}</p>
          <p v-if="nextPhase === 'validee'" class="text-[11px] text-gray-500 mt-0.5">Snapshot figé : tag Git + PDF AF horodaté</p>
          <p v-else-if="nextPhase === 'livree'" class="text-[11px] text-gray-500 mt-0.5">Livraison DOE : tag v1.0 + PDF AF final</p>
          <p v-else class="text-[11px] text-gray-500 mt-0.5">Bascule simple de phase</p>
        </button>
        <button
          v-if="af.status !== 'redaction'"
          @click="rollbackPhase"
          class="w-full text-left px-4 py-2 hover:bg-gray-50 text-xs text-gray-500"
        >
          ← Revenir à la phase précédente
        </button>
      </div>
    </div>
    <span v-else class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-lg border border-emerald-200">
      <CheckBadgeIcon class="w-4 h-4" />
      Projet livré
    </span>
  </div>

  <!-- Modale export -->
  <BaseModal v-if="showExport" :title="exportTitle" size="md" @close="showExport = false">
    <form @submit.prevent="submitExport" class="space-y-4">
      <p class="text-xs text-gray-500 leading-relaxed">
        {{ exportDescription }} Le PDF est sauvegardé dans l'historique pour traçabilité.
      </p>
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">Motif de cette version *</label>
        <input
          v-model="exportMotif"
          type="text"
          required
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          data-1p-ignore="true"
          data-bwignore="true"
          data-lpignore="true"
          placeholder="ex : version initiale transmise au bureau d'études"
          class="w-full px-3 py-2 border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <p class="text-[11px] text-gray-400 mt-1">
          Apparaîtra sur la page de garde du PDF + dans l'historique des exports.
        </p>
      </div>

      <!-- Sélecteur de sections à inclure (Lot 21) -->
      <div class="pt-3 border-t border-gray-100">
        <button type="button" @click="showSectionPicker = !showSectionPicker"
                class="text-xs text-indigo-600 hover:text-indigo-800 font-medium inline-flex items-center gap-1">
          {{ showSectionPicker ? '▾' : '▸' }} Sections à inclure dans l'export
          <span v-if="exportExcluded.size > 0" class="text-amber-700 font-normal">— {{ exportExcluded.size }} décochée{{ exportExcluded.size > 1 ? 's' : '' }}</span>
          <span v-else class="text-gray-400 font-normal">— toutes incluses</span>
        </button>
        <div v-if="showSectionPicker" class="mt-2">
          <SectionPickerTree
            :sections="exportSections"
            :excluded="exportExcluded"
            @update:excluded="exportExcluded = $event"
          />
          <div v-if="liveRequiredLevel?.required" class="mt-2 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded text-xs text-indigo-900">
            Avec votre sélection actuelle, le niveau de contrat requis est :
            <strong>{{ LEVEL_LABEL[liveRequiredLevel.required] || liveRequiredLevel.required }}</strong>
            <span v-if="liveRequiredLevel.shortfall" class="text-red-700 ml-1">
              ⚠️ dépasse le contrat ({{ LEVEL_LABEL[liveRequiredLevel.contract_level] }})
            </span>
          </div>
        </div>
      </div>

      <!-- Option Annexe BACS, uniquement pour AF -->
      <div v-if="exportKind === 'af'" class="flex items-start gap-2 pt-2 border-t border-gray-100">
        <input
          v-model="exportIncludeBacs"
          type="checkbox"
          id="bacs-annex"
          class="mt-0.5 w-4 h-4 rounded border-gray-200 text-indigo-600 focus:ring-indigo-500"
        />
        <label for="bacs-annex" class="text-xs text-gray-700 cursor-pointer flex-1">
          Inclure l'<strong>annexe Décret BACS</strong> (R175-1 à R175-6)
          <span class="block text-[11px] text-gray-400 mt-0.5">
            Ajoute en fin de document les articles complets pour référence.
          </span>
        </label>
      </div>
      <div v-if="lastExportId" class="p-3 bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 space-y-1">
        <p>✓ PDF généré et téléchargé. Si le téléchargement n'a pas démarré,
          <a :href="downloadExportUrl(lastExportId)" target="_blank" class="underline font-medium">cliquer ici</a>.
        </p>
        <p v-if="lastExportInfo?.service_level?.label">
          <strong>Niveau de service requis :</strong> {{ lastExportInfo.service_level.label }}
          <span v-if="lastExportInfo.service_level.justifications?.length" class="text-emerald-700">
            (justifié par {{ lastExportInfo.service_level.justifications[0].title }}{{ lastExportInfo.service_level.justifications.length > 1 ? ` + ${lastExportInfo.service_level.justifications.length - 1} autre${lastExportInfo.service_level.justifications.length > 2 ? 's' : ''}` : '' }})
          </span>
        </p>
      </div>
    </form>
    <template #footer>
      <button @click="showExport = false" class="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Fermer</button>
      <button
        v-if="exportKind !== 'synthesis'"
        type="button"
        @click="openPreview"
        title="Aperçu HTML rapide du rendu (sans génération PDF)"
        class="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-50 text-indigo-700 border border-indigo-200 text-sm font-medium rounded-lg hover:bg-indigo-100"
      >
        <EyeIcon class="w-4 h-4" />
        Aperçu
      </button>
      <button
        @click="submitExport"
        :disabled="submitting || !exportMotif.trim()"
        class="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
      >
        <DocumentArrowDownIcon class="w-4 h-4" />
        {{ submitting ? 'Génération…' : 'Générer le PDF' }}
      </button>
    </template>
  </BaseModal>

  <PdfPreviewModal
    v-if="previewOpen"
    :title="previewTitle"
    :preview-url="previewUrlComputed"
    :downloading="submitting"
    download-label="Générer le PDF"
    @download="submitExport"
    @close="closePreview"
  />

  <!-- Modale transition de phase avec snapshot (validee / livree) -->
  <BaseModal v-if="showTransitionModal" :title="transitionTo === 'livree' ? 'Livraison du DOE' : 'Validation de l\'AF'" size="md" @close="showTransitionModal = false">
    <form @submit.prevent="confirmTransition" class="space-y-4">
      <p class="text-xs text-gray-600 leading-relaxed">
        <template v-if="transitionTo === 'validee'">
          La validation va <strong>figer un snapshot</strong> de l'AF (PDF horodaté + tag Git <code class="bg-gray-100 px-1">validee-YYYY-MM-DD</code>).
          L'AF reste éditable, mais toute modification ultérieure sera tracée comme post-validation.
        </template>
        <template v-else>
          La livraison du DOE va générer le <strong>PDF AF final</strong> (avec annexe BACS), poser le tag Git <code class="bg-gray-100 px-1">v1.0-livraison-DOE</code>
          et faire basculer l'AF en mode "Projet livré".
        </template>
      </p>

      <!-- Avertissements pre-transition (3.3) -->
      <div v-if="transitionWarnings.length" class="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
        <p class="text-xs font-semibold text-amber-900 inline-flex items-center gap-1.5">
          <span class="text-base leading-none">⚠️</span>
          Vérifications avant transition
        </p>
        <ul class="space-y-2">
          <li v-for="w in transitionWarnings" :key="w.code" class="text-[11px] leading-relaxed">
            <p :class="w.severity === 'error' ? 'text-red-700 font-semibold' : 'text-amber-800 font-medium'">
              {{ w.severity === 'error' ? '🛑' : '•' }} {{ w.label }}
            </p>
            <ul v-if="w.details && w.details.length" class="mt-1 ml-4 space-y-0.5">
              <li v-for="d in w.details" :key="d.id" class="text-gray-600">
                <button type="button" @click="emit('goto-section', { id: d.id, number: d.number })" class="hover:text-indigo-600 hover:underline cursor-pointer text-left">
                  <code class="font-mono text-gray-500">§{{ d.number || '?' }}</code> {{ d.title }}
                </button>
              </li>
              <li v-if="w.moreCount > 0" class="text-gray-400 italic">+{{ w.moreCount }} autres</li>
            </ul>
          </li>
        </ul>
        <p class="text-[11px] text-amber-800 italic">Vous pouvez confirmer malgré ces avertissements ; ils sont consignés dans l'audit.</p>
      </div>
      <div>
        <label class="block text-xs font-semibold text-gray-700 mb-1">Motif (obligatoire) *</label>
        <input v-model="transitionMotif" type="text" required autocomplete="off" data-1p-ignore="true" data-bwignore="true" data-lpignore="true"
               :placeholder="transitionTo === 'livree' ? 'Ex : Livraison DOE finale Acme Lyon' : 'Ex : Validation pour démarrage chantier'"
               class="w-full px-3 py-2 border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      </div>
      <div>
        <label class="block text-xs font-semibold text-gray-700 mb-1">Notes (optionnel)</label>
        <textarea v-model="transitionNotes" rows="2" autocomplete="off" data-1p-ignore="true"
                  class="w-full px-3 py-2 border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
      </div>
    </form>
    <template #footer>
      <button @click="showTransitionModal = false" class="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">Annuler</button>
      <button @click="confirmTransition" :disabled="submitting || !transitionMotif.trim()"
              :class="['px-3 py-1.5 text-xs text-white disabled:opacity-50', transitionTo === 'livree' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700']">
        {{ submitting ? 'En cours…' : (transitionTo === 'livree' ? 'Livrer le DOE' : 'Valider l\'AF') }}
      </button>
    </template>
  </BaseModal>

  <!-- Modale partage AF (Lot 28) -->
  <ShareAfModal v-if="showShare" :af-id="af.id" @close="showShare = false" />
  <AfInstancesModal v-if="showInstances" :af-id="af.id" @close="showInstances = false" @goto-section="(id) => emit('goto-section', id)" />

  <!-- Modale édition métadonnées AF (Lot 29) -->
  <BaseModal v-if="showEdit" title="Éditer les informations de l'AF" size="lg" @close="showEdit = false">
    <form @submit.prevent="submitEdit" class="space-y-6">
      <!-- ── Identité du chantier ─────────────────────────────────── -->
      <section class="space-y-3">
        <h3 class="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Identité du chantier</h3>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1.5">Client <span class="text-red-500">*</span></label>
            <input v-model="editForm.client_name" type="text" required autocomplete="off" data-1p-ignore="true" data-bwignore="true" data-lpignore="true"
                   placeholder="Ex : Acme SAS"
                   class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all" />
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1.5">Projet <span class="text-red-500">*</span></label>
            <input v-model="editForm.project_name" type="text" required autocomplete="off" data-1p-ignore="true" data-bwignore="true" data-lpignore="true"
                   placeholder="Ex : Lyon Part-Dieu"
                   class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all" />
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1.5">Adresse du site</label>
          <AddressAutocomplete v-model="editForm.site_address" placeholder="Rechercher une adresse française…" />
        </div>
      </section>

      <!-- ── Engagement contractuel ────────────────────────────────── -->
      <section class="space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Engagement contractuel</h3>
          <span v-if="editForm.service_level" class="text-[11px] text-gray-400">Niveau visé pour ce projet</span>
          <span v-else class="text-[11px] text-amber-600">Aucun niveau fixé — à arbitrer au bon de commande</span>
        </div>
        <div class="grid grid-cols-4 gap-2">
          <label
            v-for="opt in [
              { value: null, label: 'À déterminer', sub: 'Décision plus tard', dot: 'bg-gray-300', selected: 'border-gray-500 bg-gray-50 text-gray-800' },
              { value: 'E', label: 'Essentials', sub: 'Baseline garantie', dot: 'bg-gray-400', selected: 'border-gray-600 bg-gray-50 text-gray-800' },
              { value: 'S', label: 'Smart', sub: 'Pilotage avancé', dot: 'bg-blue-500', selected: 'border-blue-600 bg-blue-50 text-blue-900' },
              { value: 'P', label: 'Premium', sub: 'Tout inclus', dot: 'bg-emerald-500', selected: 'border-emerald-600 bg-emerald-50 text-emerald-900' },
            ]"
            :key="opt.value || 'none'"
            :class="[
              'cursor-pointer rounded-lg border-2 px-3 py-2.5 transition-all',
              editForm.service_level === opt.value
                ? opt.selected + ' shadow-sm'
                : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
            ]"
          >
            <input v-model="editForm.service_level" :value="opt.value" type="radio" class="sr-only" />
            <div class="flex items-center gap-1.5 mb-0.5">
              <span :class="['w-2 h-2 rounded-full', opt.dot]"></span>
              <span class="text-sm font-semibold">{{ opt.label }}</span>
            </div>
            <p class="text-[11px] text-gray-500 leading-tight">{{ opt.sub }}</p>
          </label>
        </div>
      </section>
    </form>
    <template #footer>
      <button @click="showEdit = false" class="px-4 py-2 text-sm rounded-lg text-gray-700 hover:bg-gray-100 transition-colors">
        Annuler
      </button>
      <button @click="submitEdit" :disabled="submitting || !editForm.client_name.trim() || !editForm.project_name.trim()"
              class="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors">
        {{ submitting ? 'Enregistrement…' : 'Enregistrer' }}
      </button>
    </template>
  </BaseModal>
</template>
