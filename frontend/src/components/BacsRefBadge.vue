<script setup>
import { inject, computed } from 'vue'

// Affiche la ref stable d'une entite d'audit BACS (zone, systeme, device,
// compteur, regulation thermique). Utilise par le stepper et les tableaux
// pour que le collaborateur puisse cross-referencer photos/notes papier
// (cf. checklist PDF).
const props = defineProps({
  kind: { type: String, required: true },
  id: { type: [Number, String], default: null },
  value: { type: String, default: '' },
})

const refOf = inject('refOf', null)
const label = computed(() => props.value
  || (refOf && props.id != null ? refOf(props.kind, props.id) : ''))
</script>

<template>
  <span v-if="label"
    class="inline-flex items-center px-1.5 py-0.5 rounded font-mono text-[10px] tracking-tight bg-gray-100 text-gray-600 border border-gray-200"
    :title="`Référence stable — utilisable sur la checklist papier`">
    {{ label }}
  </span>
</template>
