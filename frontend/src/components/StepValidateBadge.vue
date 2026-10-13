<script setup>
import { computed } from 'vue'
import { CheckCircleIcon } from '@heroicons/vue/24/solid'
import { CheckCircleIcon as CheckOutline } from '@heroicons/vue/24/outline'
import { validateBadgeTip } from '@/lib/audit-tips-shell'

const props = defineProps({
  step: { type: Object, default: null }, // { key, validated, validated_at, complete }
})
const emit = defineEmits(['validate', 'invalidate'])

// Validée : carte (date, auteur, un clic rouvre l'étape). À valider : étiquette, ou ce qui
// manque encore (lib/audit-tips-shell.js).
const tooltip = computed(() => validateBadgeTip(props.step))
</script>

<template>
  <button
    v-if="step"
    type="button"
    @click.stop="step.validated ? emit('invalidate', step.key) : emit('validate', step.key)"
    :class="['inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition',
      step.validated
        ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
        : (step.complete
          ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
          : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50')]"
    v-tooltip="tooltip"
  >
    <CheckCircleIcon v-if="step.validated" class="w-4 h-4 text-emerald-600" />
    <CheckOutline v-else class="w-4 h-4" />
    {{ step.validated ? 'Étape validée' : 'Valider' }}
  </button>
</template>
