<script setup>
/**
 * Encart "Niveau de contrat requis pour cette AF" — recalculé live à chaque modif.
 *
 * - Si l'AF n'a pas de niveau contractuel défini : affiche le niveau requis seul.
 * - Si l'AF a un niveau contractuel : compare et avertit si le requis dépasse le contrat.
 * - Liste les sections les plus contraignantes (top justifications).
 */
import { ref, watch, computed } from 'vue'
import { ExclamationTriangleIcon, CheckCircleIcon, ArrowPathIcon } from '@heroicons/vue/24/outline'
import { getAfRequiredLevel } from '@/api'

const props = defineProps({
  afId: { type: Number, required: true },
  contractLevel: { type: String, default: null }, // 'E' | 'S' | 'P' | null
  // Trigger de refresh externe (ex: après modif d'une section, on incrémente)
  refreshKey: { type: [String, Number], default: 0 },
})

const data = ref(null)
const loading = ref(false)

const LEVEL_LABEL = { E: 'Essentials', S: 'Smart', P: 'Premium' }
const LEVEL_COLOR = {
  E: 'bg-gray-100 text-gray-800 border-gray-300',
  S: 'bg-blue-100 text-blue-800 border-blue-300',
  P: 'bg-emerald-100 text-emerald-800 border-emerald-300',
}

async function refresh() {
  loading.value = true
  try {
    const { data: d } = await getAfRequiredLevel(props.afId)
    data.value = d
  } catch {
    data.value = null
  } finally {
    loading.value = false
  }
}

watch(() => [props.afId, props.refreshKey], refresh, { immediate: true })

const verdict = computed(() => {
  if (!data.value) return null
  const { contract_level, required, shortfall } = data.value
  if (!required) return { kind: 'empty' }
  if (!contract_level) return { kind: 'no-contract', required }
  if (shortfall) return { kind: 'shortfall', contract: contract_level, required }
  return { kind: 'ok', contract: contract_level, required }
})

defineExpose({ refresh })
</script>

<template>
  <div v-if="data && data.required" class="border border-gray-200 rounded-none bg-white">
    <div class="px-4 py-3 flex items-start justify-between gap-4">
      <div class="flex-1 min-w-0">
        <p class="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5">
          Niveau de contrat Buildy nécessaire pour couvrir cette AF
        </p>
        <div class="flex items-center gap-2 flex-wrap">
          <span :class="['inline-flex items-center px-2.5 py-1 text-sm font-bold rounded-full border', LEVEL_COLOR[data.required]]">
            {{ LEVEL_LABEL[data.required] }}
          </span>

          <template v-if="verdict?.kind === 'shortfall'">
            <ExclamationTriangleIcon class="w-4 h-4 text-red-600" />
            <span class="text-xs text-red-700 font-medium">
              Dépasse le contrat actuel ({{ LEVEL_LABEL[verdict.contract] }}) — à arbitrer commercialement.
            </span>
          </template>
          <template v-else-if="verdict?.kind === 'ok'">
            <CheckCircleIcon class="w-4 h-4 text-emerald-600" />
            <span class="text-xs text-emerald-700">Cohérent avec le contrat actuel ({{ LEVEL_LABEL[verdict.contract] }}).</span>
          </template>
          <template v-else-if="verdict?.kind === 'no-contract'">
            <span class="text-xs text-gray-500 italic">Aucun niveau de contrat fixé — à choisir au moment du BC.</span>
          </template>
        </div>

        <p v-if="data.justifications.length" class="text-[11px] text-gray-500 mt-2">
          <span class="font-semibold text-gray-700">Justifié par&nbsp;:</span>
          <span v-for="(j, i) in data.justifications.slice(0, 4)" :key="j.number || j.title">
            <code class="text-gray-500">§ {{ j.number || '?' }}</code>
            <span class="text-gray-700">{{ j.title }}</span>
            <span class="text-gray-400">[{{ j.level }}]</span>
            <span v-if="i < Math.min(data.justifications.length, 4) - 1"> · </span>
          </span>
          <span v-if="data.justifications.length > 4" class="text-gray-400 italic ml-1">
            (+{{ data.justifications.length - 4 }} autres)
          </span>
        </p>
      </div>
      <button @click="refresh" :disabled="loading" class="text-gray-400 hover:text-gray-700 shrink-0" title="Recalculer">
        <ArrowPathIcon :class="['w-3.5 h-3.5', loading && 'animate-spin']" />
      </button>
    </div>
  </div>
</template>
