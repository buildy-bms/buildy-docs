<script setup>
/**
 * Contrôle Oui / Non tactile pour la PWA d'audit — équivalent mobile du
 * SegmentedToggle desktop. Tri-état natif : tant que `modelValue` est null /
 * undefined, aucun bouton n'est sélectionné (= question non répondue).
 *
 * Mode `allowPartial=true` : ajoute un 3e bouton « Partiel » qui émet `null`
 * explicitement — utilisé pour les champs où l'auditeur veut dire « ni oui
 * ni non, c'est partiel » (cf. systems.present, qui est ternaire en DB et
 * dont l'UI desktop expose Oui / Partiel / Non).
 *
 * Carte avec la question + une description optionnelle, puis 2 ou 3 boutons
 * pleine largeur à 44 px (cible tactile). « Oui » en vert Buildy (#00cd92),
 * « Non » en slate, « Partiel » en ambre — même convention que le desktop.
 */
import { computed } from 'vue'

const props = defineProps({
  label: { type: String, required: true },
  description: { type: String, default: '' },
  modelValue: { default: null },
  // Active le 3e bouton « Partiel » qui émet null. Utile pour les ternaires
  // métier où l'absence de réponse a une sémantique propre (différente de Non).
  allowPartial: { type: Boolean, default: false },
  partialLabel: { type: String, default: 'Partiel' },
})
defineEmits(['update:modelValue'])

// Normalise 0/1/true/false/null → null | true | false (les colonnes DB
// arrivent en 0/1, les clics émettent des booléens ou null).
const state = computed(() => (props.modelValue == null ? null : !!props.modelValue))
</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200 px-4 py-3">
    <p class="text-base text-gray-900 font-medium leading-snug">{{ label }}</p>
    <p v-if="description" class="text-sm text-gray-500 mt-0.5 leading-relaxed">{{ description }}</p>
    <div class="flex gap-2 mt-2.5">
      <button
        type="button"
        @click="$emit('update:modelValue', true)"
        :class="['flex-1 min-h-11 px-3 rounded-lg border font-medium transition',
                 state === true
                   ? 'bg-[#00cd92] text-white border-[#00cd92]'
                   : 'bg-white text-gray-600 border-gray-200']"
      >Oui</button>
      <button
        v-if="allowPartial"
        type="button"
        @click="$emit('update:modelValue', null)"
        :class="['flex-1 min-h-11 px-3 rounded-lg border font-medium transition',
                 state === null
                   ? 'bg-amber-500 text-white border-amber-500'
                   : 'bg-white text-gray-600 border-gray-200']"
      >{{ partialLabel }}</button>
      <button
        type="button"
        @click="$emit('update:modelValue', false)"
        :class="['flex-1 min-h-11 px-3 rounded-lg border font-medium transition',
                 state === false
                   ? 'bg-slate-600 text-white border-slate-600'
                   : 'bg-white text-gray-600 border-gray-200']"
      >Non</button>
    </div>
  </div>
</template>
