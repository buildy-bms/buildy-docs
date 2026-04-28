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
const emit = defineEmits(['goto-section'])

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
  <div v-if="data && data.required" class="border border-gray-200 rounded-lg bg-white shadow-xs">
    <div class="px-5 py-4">
      <div class="flex items-start justify-between gap-4 mb-3">
        <div class="flex-1 min-w-0">
          <p class="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-2">
            Niveau de contrat Buildy nécessaire pour couvrir cette AF
          </p>
          <div class="flex items-center gap-3 flex-wrap">
            <span :class="['inline-flex items-center px-3 py-1 text-sm font-bold rounded-full border', LEVEL_COLOR[data.required]]">
              {{ LEVEL_LABEL[data.required] }}
            </span>
            <template v-if="verdict?.kind === 'shortfall'">
              <span class="inline-flex items-center gap-1.5 text-xs text-red-700 font-medium">
                <ExclamationTriangleIcon class="w-4 h-4" />
                Dépasse le contrat actuel ({{ LEVEL_LABEL[verdict.contract] }}) — à arbitrer commercialement.
              </span>
            </template>
            <template v-else-if="verdict?.kind === 'ok'">
              <span class="inline-flex items-center gap-1.5 text-xs text-emerald-700">
                <CheckCircleIcon class="w-4 h-4" />
                Cohérent avec le contrat actuel ({{ LEVEL_LABEL[verdict.contract] }}).
              </span>
            </template>
            <template v-else-if="verdict?.kind === 'no-contract'">
              <span class="text-xs text-gray-500 italic">Aucun niveau de contrat fixé — à choisir au moment du bon de commande.</span>
            </template>
          </div>
        </div>
        <button @click="refresh" :disabled="loading" class="text-gray-400 hover:text-gray-700 shrink-0 p-1" title="Recalculer">
          <ArrowPathIcon :class="['w-4 h-4', loading && 'animate-spin']" />
        </button>
      </div>

      <div v-if="data.justifications.length" class="pt-3 border-t border-gray-100">
        <p class="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-2">Sections justifiant ce niveau</p>
        <div class="flex items-center gap-1.5 flex-wrap">
          <button
            v-for="j in data.justifications.slice(0, 6)"
            :key="(j.number || '?') + j.title"
            type="button"
            @click="emit('goto-section', { number: j.number, id: j.section_id })"
            class="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 bg-gray-50 hover:bg-indigo-50 border border-gray-200 hover:border-indigo-300 rounded-full text-[11px] cursor-pointer transition-colors"
            title="Aller à cette section dans l'arbre"
          >
            <code class="font-mono text-gray-500">§{{ j.number || '?' }}</code>
            <span class="text-gray-700 font-medium">{{ j.title }}</span>
            <span :class="['inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded-full', LEVEL_COLOR[j.level]]">{{ LEVEL_LABEL[j.level] || j.level }}</span>
          </button>
          <span v-if="data.justifications.length > 6" class="text-[11px] text-gray-400 italic px-1">
            +{{ data.justifications.length - 6 }} autres
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
