<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { SparklesIcon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import RichTextEditor from '@/components/RichTextEditor.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import Tooltip from '@/components/Tooltip.vue'
import { useAuditStore } from '@/stores/audit'
import { isSynthesisStale } from '@/lib/synthesis-staleness'
import { STALE_SYNTHESIS_TIP, CONFIRM_SYNTHESIS_TIP, claudeUsageTip, longDateTime } from '@/lib/audit-tips-site'

// Section 12 — Note de synthèse (rédigée à la main ou pré-remplie via
// Claude). Affichée en tête du PDF d'audit livré au client.
const props = defineProps({
  synthesisHtml: { type: String, default: '' },
  synthesisGenerating: { type: Boolean, default: false },
  generatedAt: { type: String, default: null },
  claudeUsage: { type: Object, default: null },
  step: { type: Object, default: null },
  // Infobulle du bouton Claude fournie par la vue (texte ou carte) ; à défaut d'une carte,
  // la carte est construite ici depuis `claudeUsage` (coût, budget).
  usageTooltip: { type: [String, Object, Function], default: '' },
  active: { type: Boolean, default: false },
})
const emit = defineEmits([
  'generate', 'update:synthesis-html', 'confirm-current',
  'validate-step', 'invalidate-step',
])

// Note périmée (lib/synthesis-staleness.js, même règle que le serveur) : elle
// n'est PAS imprimée dans le rapport — on le dit ici, là où on la rédige.
const { actionItems } = storeToRefs(useAuditStore())
const isStale = computed(() => isSynthesisStale({
  html: props.synthesisHtml, generatedAt: props.generatedAt, actionItems: actionItems.value,
}))

// Bouton « Rédiger avec Claude » : grisé pendant la génération (la bulle le dit), sinon
// carte du coût. Une carte fournie par la vue garde la priorité.
const generateTip = computed(() => {
  if (props.synthesisGenerating) return 'Génération de la note en cours…'
  if (props.usageTooltip && typeof props.usageTooltip !== 'string') return props.usageTooltip
  return claudeUsageTip(props.claudeUsage)
})
const generatedAtLabel = computed(() => longDateTime(props.generatedAt))
</script>

<template>
  <CollapsibleSection storage-key="synthesis" section-id="section-synthesis" :active="active">
    <template #header>
      <SectionHeader number="12" :title="'Note de synthèse'"
                     subtitle="Affichée en tête du PDF d'audit livré au client."
                     :icon="SparklesIcon" icon-color="text-violet-500"
                     :step="step"
                     @validate="emit('validate-step', $event)"
                     @invalidate="emit('invalidate-step', $event)">
        <template v-if="generatedAt" #subtitle-extra>
          <span class="inline-flex items-center gap-1 text-[11px] text-violet-700 italic">
            <SparklesIcon class="w-3 h-3 shrink-0" />
            Note datée du {{ generatedAtLabel }}
            <span v-if="isStale" class="not-italic font-medium text-amber-700" v-tooltip="STALE_SYNTHESIS_TIP"> · périmée, absente du rapport</span>
          </span>
        </template>
      </SectionHeader>
    </template>
    <template #summary>
      <span v-if="synthesisHtml">
        Note rédigée<span v-if="generatedAt"> · datée du {{ new Date(generatedAt).toLocaleDateString('fr-FR') }}</span>
        <span v-if="isStale" class="text-amber-700 font-medium"> · périmée, absente du rapport</span>
      </span>
      <span v-else class="italic">Pas encore de note de synthèse</span>
    </template>
    <div class="px-5 py-4 space-y-3">
      <div v-if="isStale"
           class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 flex items-start justify-between gap-3">
        <div class="text-xs text-amber-900 leading-snug">
          <p class="font-semibold">Le plan d'actions a changé depuis cette note : elle ne sera pas imprimée dans le rapport.</p>
          <p class="mt-0.5">Une note périmée contredirait le tableau de bord et le plan. Régénère-la avec Claude, ou corrige-la à la main puis confirme qu'elle est à jour.</p>
        </div>
        <button type="button" @click="emit('confirm-current')"
                v-tooltip="CONFIRM_SYNTHESIS_TIP"
                class="shrink-0 inline-flex items-center px-2.5 py-1.5 text-xs font-medium text-amber-900 bg-white border border-amber-300 hover:bg-amber-100 rounded-lg transition">
          Note relue et à jour
        </button>
      </div>
      <div class="flex items-center gap-2">
        <Tooltip :text="generateTip" class="shrink-0">
          <button
            @click="emit('generate')"
            :disabled="synthesisGenerating"
            class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg transition shadow-sm">
            <SparklesIcon class="w-4 h-4" :class="synthesisGenerating ? 'animate-pulse' : ''" />
            {{ synthesisGenerating
                ? 'Génération en cours…'
                : (synthesisHtml ? 'Régénérer avec Claude' : 'Rédiger avec Claude') }}
            <span v-if="claudeUsage" class="ml-1 text-[11px] text-violet-200 tabular-nums">
              ≈ {{ (claudeUsage.avg_cost_eur || 0).toFixed(3).replace('.', ',') }} €
            </span>
          </button>
        </Tooltip>
        <p class="text-[11px] text-gray-500 italic">
          Claude lit l'intégralité de l'audit (zones, systèmes, compteurs, GTB, plan) et rédige une note client bienveillante et actionnable, sans inventer de données.
        </p>
      </div>
      <RichTextEditor
        :model-value="synthesisHtml"
        @update:model-value="v => emit('update:synthesis-html', v)"
        placeholder="Rédige la note de synthèse, ou clique sur « Rédiger avec Claude » pour la préparer, puis ajuste-la."
        min-height="240px"
      />
    </div>
  </CollapsibleSection>
</template>
