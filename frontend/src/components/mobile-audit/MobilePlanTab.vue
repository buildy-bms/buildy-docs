<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import {
  ClipboardDocumentListIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
} from '@heroicons/vue/24/outline'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { regenerateBacsActionItems } from '@/api'
import { ref } from 'vue'

const audit = useAuditStore()
const { actionItems, document } = storeToRefs(audit)
const { error, success } = useNotification()

const SEVERITY_LABEL = {
  blocking: { label: 'Bloquante', cls: 'bg-red-50 border-red-200 text-red-700' },
  major: { label: 'Majeure', cls: 'bg-orange-50 border-orange-200 text-orange-700' },
  minor: { label: 'Mineure', cls: 'bg-amber-50 border-amber-200 text-amber-700' },
}
const STATUS_LABEL = {
  open: 'Ouverte', quoted: 'Chiffrée', in_progress: 'En cours',
  done: 'Terminée', declined: 'Non retenue',
}

const visibleItems = computed(() =>
  actionItems.value.filter(it => it.status !== 'done' && it.status !== 'declined')
)
const itemsBySeverity = computed(() => ({
  blocking: visibleItems.value.filter(i => i.severity === 'blocking'),
  major: visibleItems.value.filter(i => i.severity === 'major'),
  minor: visibleItems.value.filter(i => i.severity === 'minor'),
}))

const regenerating = ref(false)
async function regenerate() {
  regenerating.value = true
  try {
    const { data } = await regenerateBacsActionItems(document.value.id)
    success(`+${data.added} nouvelles · ${data.updated} synchronisées · ${data.resolved} résolues`)
    await audit.refreshAuditCore()
  } catch {
    error('Régénération impossible')
  } finally {
    regenerating.value = false
  }
}
</script>

<template>
  <div class="p-3 pb-24 space-y-3">
    <!-- 3 stats severities -->
    <div class="grid grid-cols-3 gap-2">
      <div v-for="sev in ['blocking', 'major', 'minor']" :key="sev"
           :class="['rounded-xl border p-3 text-center', SEVERITY_LABEL[sev].cls]">
        <p class="text-2xl font-medium leading-none">{{ itemsBySeverity[sev].length }}</p>
        <p class="text-[10px] uppercase tracking-wider mt-1 opacity-80">{{ SEVERITY_LABEL[sev].label }}</p>
      </div>
    </div>

    <!-- Bouton régénérer -->
    <button
      @click="regenerate"
      :disabled="regenerating"
      class="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-xl active:bg-gray-50"
    >
      <ArrowPathIcon :class="['w-4 h-4', regenerating ? 'animate-spin' : '']" />
      {{ regenerating ? 'Régénération…' : 'Régénérer le plan' }}
    </button>

    <!-- Liste actions -->
    <div v-if="visibleItems.length" class="space-y-2">
      <div
        v-for="(it, idx) in visibleItems"
        :key="it.id"
        :class="['bg-white rounded-2xl border-2 p-4',
          it.severity === 'blocking' ? 'border-red-200' : it.severity === 'major' ? 'border-orange-200' : 'border-amber-200']"
      >
        <div class="flex items-start gap-2 mb-2">
          <span class="inline-flex items-center justify-center min-w-12 px-2 py-1 text-[10px] font-mono rounded bg-gray-800 text-white whitespace-nowrap">
            BACS-{{ String(idx + 1).padStart(3, '0') }}
          </span>
          <span :class="['inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full', SEVERITY_LABEL[it.severity].cls]">
            {{ SEVERITY_LABEL[it.severity].label }}
          </span>
          <span class="text-[10px] text-gray-500 font-mono">{{ it.r175_article || '—' }}</span>
        </div>
        <p class="text-sm font-medium text-gray-900 leading-snug">{{ it.title }}</p>
        <p v-if="it.description" class="text-xs text-gray-600 mt-1.5 leading-relaxed">{{ it.description }}</p>
        <p v-if="it.zone_name" class="text-xs text-gray-500 mt-2">📍 {{ it.zone_name }}</p>
      </div>
    </div>
    <div v-else class="bg-white rounded-2xl border border-dashed border-emerald-300 p-8 text-center">
      <CheckCircleIcon class="w-12 h-12 text-emerald-500 mx-auto" />
      <p class="text-base font-medium text-emerald-700 mt-3">Aucune action corrective</p>
      <p class="text-xs text-gray-500 mt-1">Tu peux passer à la livraison</p>
    </div>
  </div>
</template>
