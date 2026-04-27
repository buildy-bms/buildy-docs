<script setup>
import { computed, ref } from 'vue'
import {
  CheckBadgeIcon, ClipboardDocumentCheckIcon, ArrowLeftIcon,
  DocumentArrowDownIcon, TableCellsIcon, ClockIcon, ChevronDownIcon,
  RocketLaunchIcon,
} from '@heroicons/vue/24/outline'
import { useRouter } from 'vue-router'
import api, {
  updateAf, exportPointsList, exportAf, exportSynthesis, downloadExportUrl,
  createInspection, listInspections,
} from '@/api'
import { useNotification } from '@/composables/useNotification'
import BaseModal from './BaseModal.vue'
import StatusBadge from './StatusBadge.vue'
import ServiceLevelBadge from './ServiceLevelBadge.vue'

const props = defineProps({
  af: { type: Object, required: true },
})
const emit = defineEmits(['updated', 'back', 'toggle-activity'])

const { success, error } = useNotification()
const router = useRouter()
const submitting = ref(false)
const showExport = ref(false)
const exportKind = ref('points-list') // 'points-list' | 'af'
const exportMotif = ref('')
const exportIncludeBacs = ref(false)
const lastExportId = ref(null)
const lastExportInfo = ref(null)

const showInspection = ref(false)
const inspectorName = ref('')
const inspectionNotes = ref('')
const lastInspection = ref(null)

const canInspect = computed(() => props.af.status === 'livree')

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

function openPhaseMenu() { showPhaseMenu.value = !showPhaseMenu.value }

function startTransition(target) {
  showPhaseMenu.value = false
  transitionTo.value = target
  transitionMotif.value = ''
  transitionNotes.value = ''
  // Validee + livree : modale obligatoire (snapshot figé)
  if (target === 'validee' || target === 'livree') {
    showTransitionModal.value = true
  } else {
    // Bascule simple
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
  if (!confirm(`Revenir à "${PHASE_LABELS[prev]}" ? Cela lève le verrou doux et permet à nouveau toutes les modifications.`)) return
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

function prepareInspection() {
  inspectorName.value = ''
  inspectionNotes.value = ''
  lastInspection.value = null
  showInspection.value = true
}

async function submitInspection() {
  if (!inspectorName.value.trim()) return
  submitting.value = true
  try {
    const { data } = await createInspection(props.af.id, {
      inspector_name: inspectorName.value.trim(),
      notes: inspectionNotes.value.trim() || undefined,
    })
    success(`Inspection BACS générée — PDF avec annexe inclus (${data.sections_total} sections)`)
    lastInspection.value = data
    window.open(data.pdf_download_url, '_blank')
    emit('updated', { ...props.af, last_inspection_at: new Date().toISOString() })
  } catch (e) {
    error(e.response?.data?.detail || 'Échec de la préparation d\'inspection')
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
  showExport.value = true
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
      <h2 class="text-sm font-semibold text-gray-800 truncate">
        {{ af.client_name }} — {{ af.project_name }}
      </h2>
      <p v-if="af.site_address" class="text-xs text-gray-500 truncate">{{ af.site_address }}</p>
    </div>
    <ServiceLevelBadge :level="af.service_level" />
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
    <button
      @click="openExport('points-list')"
      class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700"
      title="Exporter la liste de points contractuelle en PDF A3"
    >
      <TableCellsIcon class="w-4 h-4" />
      Points (A3)
    </button>
    <button
      @click="openExport('synthesis')"
      class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700"
      title="Exporter le tableau de synthèse en PDF A3 paysage"
    >
      <TableCellsIcon class="w-4 h-4" />
      Synthèse (A3)
    </button>
    <button
      @click="emit('toggle-activity')"
      class="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50"
      title="Panneau d'activité"
    >
      <ClockIcon class="w-4 h-4" />
      Activité
    </button>
    <button
      @click="router.push(`/afs/${af.id}/versions`)"
      class="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50"
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
      <div v-if="showPhaseMenu" class="absolute right-0 mt-1 w-72 bg-white border border-gray-200 shadow-lg rounded-none z-30">
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
    <button
      v-if="canInspect"
      @click="prepareInspection"
      class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700"
    >
      <ClipboardDocumentCheckIcon class="w-4 h-4" />
      Préparer inspection BACS
    </button>
  </div>

  <!-- Modale Inspection BACS -->
  <BaseModal v-if="showInspection" title="Préparer une inspection BACS" size="md" @close="showInspection = false">
    <form @submit.prevent="submitInspection" class="space-y-4">
      <p class="text-xs text-gray-500 leading-relaxed">
        Génère un PDF AF horodaté <strong>avec annexe Décret BACS incluse</strong>, à présenter
        lors de l'inspection périodique obligatoire (Article R175-5-1).
        Une entrée est créée dans l'historique des inspections de cette AF pour traçabilité.
      </p>
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">Nom de l'inspecteur *</label>
        <input
          v-model="inspectorName"
          type="text"
          required
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          data-1p-ignore="true"
          data-bwignore="true"
          data-lpignore="true"
          placeholder="ex : Jean Dupont — Bureau Veritas"
          class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">Notes (optionnel)</label>
        <textarea
          v-model="inspectionNotes"
          rows="2"
          autocomplete="off"
          data-1p-ignore="true"
          placeholder="Observations particulières ou contexte de l'inspection"
          class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        ></textarea>
      </div>
      <div v-if="lastInspection" class="p-3 bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
        ✓ Inspection enregistrée. PDF téléchargé. Si le téléchargement n'a pas démarré,
        <a :href="lastInspection.pdf_download_url" target="_blank" class="underline font-medium">cliquer ici</a>.
      </div>
    </form>
    <template #footer>
      <button @click="showInspection = false" class="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Fermer</button>
      <button
        @click="submitInspection"
        :disabled="submitting || !inspectorName.trim()"
        class="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
      >
        <ClipboardDocumentCheckIcon class="w-4 h-4" />
        {{ submitting ? 'Génération…' : 'Générer le PDF d\'inspection' }}
      </button>
    </template>
  </BaseModal>

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
          class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <p class="text-[11px] text-gray-400 mt-1">
          Apparaîtra sur la page de garde du PDF + dans l'historique des exports.
        </p>
      </div>

      <!-- Option Annexe BACS, uniquement pour AF -->
      <div v-if="exportKind === 'af'" class="flex items-start gap-2 pt-2 border-t border-gray-100">
        <input
          v-model="exportIncludeBacs"
          type="checkbox"
          id="bacs-annex"
          class="mt-0.5 w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
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
        @click="submitExport"
        :disabled="submitting || !exportMotif.trim()"
        class="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
      >
        <DocumentArrowDownIcon class="w-4 h-4" />
        {{ submitting ? 'Génération…' : 'Générer le PDF' }}
      </button>
    </template>
  </BaseModal>

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
      <div>
        <label class="block text-xs font-semibold text-gray-700 mb-1">Motif (obligatoire) *</label>
        <input v-model="transitionMotif" type="text" required autocomplete="off" data-1p-ignore="true" data-bwignore="true" data-lpignore="true"
               :placeholder="transitionTo === 'livree' ? 'Ex : Livraison DOE finale Acme Lyon' : 'Ex : Validation pour démarrage chantier'"
               class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      </div>
      <div>
        <label class="block text-xs font-semibold text-gray-700 mb-1">Notes (optionnel)</label>
        <textarea v-model="transitionNotes" rows="2" autocomplete="off" data-1p-ignore="true"
                  class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
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
</template>
