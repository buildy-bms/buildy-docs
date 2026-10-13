<script setup>
// Pastille 3 etats deduits du couple (contenu, content_validated_at) :
//   - 'empty'     : contenu vide -> pastille grise
//   - 'draft'     : contenu present, pas valide -> pastille orange
//   - 'validated' : valide -> pastille verte
//
// Usage :
//   <ContentValidationDot :status="getValidationStatus(item)" :validated-at="..." :validated-by="..." />
// Helper getValidationStatus dans @/lib/content-validation.
import { computed } from 'vue'
import { validationTip } from '@/lib/library-tips'

const props = defineProps({
  status: { type: String, required: true },
  validatedAt: { type: String, default: null },
  validatedBy: { type: String, default: null },
})

const config = computed(() => {
  switch (props.status) {
    case 'validated':
      return { cls: 'bg-emerald-500', label: 'Validé' }
    case 'draft':
      return { cls: 'bg-amber-400', label: 'Brouillon (à valider)' }
    case 'empty':
    default:
      return { cls: 'bg-gray-300', label: 'Vide (à rédiger)' }
  }
})

// Carte : état, date et auteur de la validation, ce qu'il reste à faire.
const tooltip = computed(() => validationTip(props.status, { validatedAt: props.validatedAt, validatedBy: props.validatedBy }))
</script>

<template>
  <span :class="['inline-block w-2.5 h-2.5 rounded-full shrink-0', config.cls]"
        v-tooltip="tooltip" :aria-label="config.label" />
</template>
