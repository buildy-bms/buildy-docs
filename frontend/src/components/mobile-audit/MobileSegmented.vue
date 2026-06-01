<script setup>
/**
 * Contrôle segmenté tactile pour la PWA d'audit — équivalent mobile du
 * SegmentedToggle desktop avec options custom (enum string).
 *
 * - Tant que `modelValue` est null/undefined, AUCUNE option n'est sélectionnée.
 * - Chaque option : { value, label, tone? }. `tone` ∈ 'green' | 'amber' |
 *   'slate' colore le bouton sélectionné (même convention que SegmentedToggle).
 * - Boutons pleine largeur, hauteur 44 pt (cible tactile iOS).
 * - Carte avec label de question + description optionnelle.
 *
 * À utiliser quand les valeurs DB sont des strings (`yes`/`partial`/`no`,
 * etc.), pas des booléens. Pour le cas boolean Oui/Non/Partiel, préférer
 * MobileYesNo qui force la sémantique ternaire.
 */
defineProps({
  label: { type: String, required: true },
  description: { type: String, default: '' },
  modelValue: { default: null },
  options: { type: Array, required: true },
  disabled: { type: Boolean, default: false },
})
defineEmits(['update:modelValue'])

const TONE = {
  green: 'bg-[#00cd92] text-white border-[#00cd92]',
  amber: 'bg-amber-500 text-white border-amber-500',
  slate: 'bg-slate-600 text-white border-slate-600',
}
</script>

<template>
  <div :class="['bg-white rounded-xl border border-gray-200 px-4 py-3',
                disabled ? 'opacity-40 pointer-events-none' : '']">
    <p class="text-base text-gray-900 font-medium leading-snug">{{ label }}</p>
    <p v-if="description" class="text-sm text-gray-500 mt-0.5 leading-relaxed">{{ description }}</p>
    <div class="flex gap-2 mt-2.5">
      <button
        v-for="opt in options"
        :key="String(opt.value)"
        type="button"
        :disabled="disabled"
        @click="!disabled && $emit('update:modelValue', opt.value)"
        :class="['pwa-button flex-1 border',
                 modelValue === opt.value
                   ? (TONE[opt.tone] || TONE.slate)
                   : 'bg-white text-gray-600 border-gray-200']"
      >{{ opt.label }}</button>
    </div>
  </div>
</template>
