<script setup>
import { computed, ref } from 'vue'
import {
  CheckBadgeIcon, ClipboardDocumentCheckIcon, ArrowLeftIcon,
  DocumentArrowDownIcon, TableCellsIcon,
} from '@heroicons/vue/24/outline'
import { updateAf, exportPointsList, downloadExportUrl } from '@/api'
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
const exportMotif = ref('')
const lastExportId = ref(null)

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
  alert('Préparation d\'inspection BACS — disponible au Lot 7c (génère un PDF horodaté + tag Git d\'inspection).')
}

function openExport() {
  exportMotif.value = ''
  lastExportId.value = null
  showExport.value = true
}

async function submitExport() {
  if (!exportMotif.value.trim()) return
  submitting.value = true
  try {
    const { data } = await exportPointsList(props.af.id, { motif: exportMotif.value.trim() })
    success(`PDF généré : ${data.version} — ${data.total_lines} ligne${data.total_lines > 1 ? 's' : ''} (${(data.file_size_bytes / 1024).toFixed(0)} KB)`)
    lastExportId.value = data.id
    window.open(downloadExportUrl(data.id), '_blank')
  } catch (e) {
    error(e.response?.data?.detail || 'Échec de la génération du PDF')
  } finally {
    submitting.value = false
  }
}
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
      @click="openExport"
      class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700"
      title="Exporter la liste de points contractuelle en PDF A3"
    >
      <TableCellsIcon class="w-4 h-4" />
      Liste de points (PDF A3)
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

  <!-- Modale export liste de points -->
  <BaseModal v-if="showExport" title="Exporter la liste de points contractuelle (PDF A3)" size="md" @close="showExport = false">
    <form @submit.prevent="submitExport" class="space-y-4">
      <p class="text-xs text-gray-500 leading-relaxed">
        Génère un PDF A3 portrait avec page de garde Buildy, sommaire par catégorie d'équipement,
        et toutes les lignes <code class="bg-gray-100 px-1 py-0.5 rounded">points × instances</code> définies
        dans la fiche AF. Le PDF est sauvegardé dans l'historique pour traçabilité.
      </p>
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">Motif de cette version *</label>
        <input
          v-model="exportMotif"
          type="text"
          required
          placeholder="ex : version initiale transmise au bureau d'études"
          class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <p class="text-[11px] text-gray-400 mt-1">
          Apparaîtra sur la page de garde du PDF + dans l'historique des exports.
        </p>
      </div>
      <div v-if="lastExportId" class="p-3 bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
        ✓ PDF généré et téléchargé. Si le téléchargement n'a pas démarré,
        <a :href="downloadExportUrl(lastExportId)" target="_blank" class="underline font-medium">cliquer ici</a>.
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
