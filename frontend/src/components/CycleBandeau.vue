<script setup>
import { computed, ref } from 'vue'
import {
  CheckBadgeIcon, ClipboardDocumentCheckIcon, ArrowLeftIcon,
  DocumentArrowDownIcon, TableCellsIcon,
} from '@heroicons/vue/24/outline'
import {
  updateAf, exportPointsList, exportAf, downloadExportUrl,
  createInspection, listInspections,
} from '@/api'
import { useNotification } from '@/composables/useNotification'
import BaseModal from './BaseModal.vue'
import StatusBadge from './StatusBadge.vue'
import ServiceLevelBadge from './ServiceLevelBadge.vue'

const props = defineProps({
  af: { type: Object, required: true },
})
const emit = defineEmits(['updated', 'back'])

const { success, error } = useNotification()
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

const canDeliver = computed(() => ['setup', 'chantier'].includes(props.af.status))
const canInspect = computed(() => ['livree', 'revision'].includes(props.af.status))

async function markDelivered() {
  if (!confirm(`Marquer "${props.af.client_name} — ${props.af.project_name}" comme LIVRÉE ?\nUn snapshot sera figé pour les futures comparaisons d'inspection.`)) return
  submitting.value = true
  try {
    const { data } = await updateAf(props.af.id, { status: 'livree' })
    success('AF marquée comme livrée')
    emit('updated', data)
  } catch (e) {
    error('Échec de la mise à jour')
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
    const fn = exportKind.value === 'af' ? exportAf : exportPointsList
    const payload = { motif: exportMotif.value.trim() }
    if (exportKind.value === 'af') payload.includeBacsAnnex = exportIncludeBacs.value
    const { data } = await fn(props.af.id, payload)
    if (exportKind.value === 'af') {
      success(`PDF AF généré : ${data.version} — ${data.sections_total} sections (${(data.file_size_bytes / 1024).toFixed(0)} KB) — Niveau requis : ${data.service_level?.label || '—'}`)
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

const exportTitle = computed(() => exportKind.value === 'af'
  ? "Exporter l'analyse fonctionnelle (PDF A4)"
  : 'Exporter la liste de points contractuelle (PDF A3)'
)
const exportDescription = computed(() => exportKind.value === 'af'
  ? "Génère le PDF complet de l'AF (12 chapitres, sections, captures, badges niveau service, calcul auto du niveau requis sur la page de garde). A4 portrait."
  : "Génère un PDF A3 portrait avec page de garde Buildy, sommaire par catégorie d'équipement, et toutes les lignes points × instances définies dans la fiche AF."
)
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
      AF (PDF A4)
    </button>
    <button
      @click="openExport('points-list')"
      class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700"
      title="Exporter la liste de points contractuelle en PDF A3"
    >
      <TableCellsIcon class="w-4 h-4" />
      Points (PDF A3)
    </button>
    <button
      v-if="canDeliver"
      @click="markDelivered"
      :disabled="submitting"
      class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50"
    >
      <CheckBadgeIcon class="w-4 h-4" />
      Marquer comme livrée
    </button>
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
</template>
