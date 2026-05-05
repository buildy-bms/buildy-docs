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
import ServiceLevelBadge from '@/components/ServiceLevelBadge.vue'

/**
 * Aligne le badge de niveau de chaque justification sur celui affiché dans
 * l'arborescence (SectionTreeNode → minServiceLevel) : prend le niveau MINIMUM
 * accessible (premier token de "E/S/P" → "E", "S/P" → "S", "P" → "P").
 * Sinon le badge afficherait le brut "S/P" alors que l'arbre affiche "S",
 * ce qui crée une incohérence visuelle. */
function minServiceLevel(lvl) {
  const v = (lvl || '').toUpperCase().trim()
  if (!v) return null
  return v.split('/')[0].trim() || null
}

const props = defineProps({
  afId: { type: Number, required: true },
  contractLevel: { type: String, default: null }, // 'E' | 'S' | 'P' | null
  // Trigger de refresh externe (ex: après modif d'une section, on incrémente)
  refreshKey: { type: [String, Number], default: 0 },
})
const emit = defineEmits(['goto-section'])

const data = ref(null)
const loading = ref(false)

// Aligne sur ServiceLevelBadge (Essentiel sans 's' final).
const LEVEL_LABEL = { E: 'Essentiel', S: 'Smart', P: 'Premium' }

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

// Couleur de la card selon le verdict :
//   - 'ok' (niveau requis ≤ contrat) → vert
//   - 'shortfall' (niveau requis > contrat) → rouge
//   - 'no-contract' (pas de contrat fixé) → ambre (rappel)
//   - default → blanc neutre
const cardClass = computed(() => {
  const k = verdict.value?.kind
  if (k === 'ok') return 'border-emerald-300 bg-emerald-50/60'
  if (k === 'shortfall') return 'border-red-300 bg-red-50/60'
  if (k === 'no-contract') return 'border-amber-200 bg-amber-50/60'
  return 'border-gray-200 bg-white'
})

defineExpose({ refresh })
</script>

<template>
  <div v-if="data && data.required" :class="['border rounded-lg shadow-xs px-4 py-2.5 transition-colors', cardClass]">
    <div class="flex items-center gap-3 flex-wrap">
      <p class="text-[10px] uppercase tracking-wider text-gray-500 font-semibold shrink-0">Niveau requis</p>
      <ServiceLevelBadge :level="data.required" variant="full" />
      <template v-if="verdict?.kind === 'shortfall'">
        <span class="inline-flex items-center gap-1 text-xs text-red-700 font-medium">
          <ExclamationTriangleIcon class="w-3.5 h-3.5" />
          Dépasse le contrat ({{ LEVEL_LABEL[verdict.contract] }}) — à arbitrer.
        </span>
      </template>
      <template v-else-if="verdict?.kind === 'ok'">
        <span class="inline-flex items-center gap-1 text-xs text-emerald-700">
          <CheckCircleIcon class="w-3.5 h-3.5" />
          Cohérent avec le contrat ({{ LEVEL_LABEL[verdict.contract] }}).
        </span>
      </template>
      <template v-else-if="verdict?.kind === 'no-contract'">
        <span class="text-xs text-gray-500 italic">Aucun contrat fixé — à choisir au bon de commande.</span>
      </template>

      <span v-if="data.justifications.length" class="text-[10px] uppercase tracking-wider text-gray-400 font-semibold ml-2 shrink-0">Justifié par</span>
      <button
        v-for="j in data.justifications.slice(0, 6)"
        :key="(j.number || '?') + j.title"
        type="button"
        @click="emit('goto-section', { number: j.number, id: j.section_id })"
        class="inline-flex items-center gap-1.5 px-2 py-0.5 bg-gray-50 hover:bg-indigo-50 border border-gray-200 hover:border-indigo-300 rounded-full text-[11px] cursor-pointer transition-colors"
        title="Aller à cette section"
      >
        <span class="text-gray-700 font-medium">{{ j.title }}</span>
        <ServiceLevelBadge v-if="minServiceLevel(j.level)" :level="minServiceLevel(j.level)" />
      </button>
      <span v-if="data.justifications.length > 6" class="text-[11px] text-gray-400 italic">
        +{{ data.justifications.length - 6 }} autres
      </span>

      <button @click="refresh" :disabled="loading" class="text-gray-400 hover:text-gray-700 shrink-0 p-1 ml-auto" title="Recalculer">
        <ArrowPathIcon :class="['w-3.5 h-3.5', loading && 'animate-spin']" />
      </button>
    </div>
  </div>
</template>
