<script setup>
/**
 * SegmentedToggle — 2 boutons côte à côte (oui / non) pour saisie binaire
 * explicite. Préféré aux checkboxes uniques sur les champs métier sensibles
 * (présent / absent, conforme / non conforme, etc.) car le choix actif est
 * visuellement explicite : le bouton actif est coloré, l'autre est neutre.
 *
 * Voir mémoire feedback_segmented_control_for_binary_state : « Préférer 2
 * boutons (Présent/Absent) à une checkbox unique pour les états métier
 * explicites sur PWA, distingue 'non saisi' de 'absent' + plus tactile. »
 *
 * Compatible avec :
 *  - colonne de tableau (compact = true) : icônes ✓ / ✗ uniquement
 *  - inline form (compact = false) : icônes + label
 *  - état null possible (3-state) : les 2 boutons restent neutres tant que
 *    l'utilisateur n'a pas cliqué.
 */
defineProps({
  // true / false / null. null = pas encore répondu (les 2 boutons neutres).
  modelValue: { type: Boolean, default: null },
  // Si true, n'affiche que les icônes ✓ / ✗ (pour les colonnes de tableau).
  compact: { type: Boolean, default: false },
  // Labels personnalisables.
  yesLabel: { type: String, default: 'Oui' },
  noLabel: { type: String, default: 'Non' },
  // Tooltip global sur l'ensemble (ex: "Compteur présent sur site ?").
  tooltip: { type: String, default: '' },
  // Variante "yes danger" : le "Oui" est rouge au lieu de vert. Utilisé pour
  // les booléens où le "oui" est une mauvaise nouvelle (out_of_service…).
  yesDanger: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

function pick(v) {
  if (!emit) return;
  emit('update:modelValue', v);
}
</script>

<template>
  <div class="seg-toggle inline-flex rounded-full border border-gray-200 overflow-hidden text-xs"
       :class="{ 'opacity-50 pointer-events-none': disabled }"
       :title="tooltip">
    <button type="button"
            class="seg-btn px-3 py-1 font-semibold transition select-none"
            :class="modelValue === true
              ? (yesDanger ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700')
              : 'bg-white text-gray-300 hover:text-gray-600 hover:bg-gray-50'"
            @click="pick(true)">
      <span class="font-bold">✓</span><span v-if="!compact" class="ml-1">{{ yesLabel }}</span>
    </button>
    <button type="button"
            class="seg-btn px-3 py-1 font-semibold transition select-none border-l border-gray-200"
            :class="modelValue === false
              ? 'bg-red-50 text-red-700'
              : 'bg-white text-gray-300 hover:text-gray-600 hover:bg-gray-50'"
            @click="pick(false)">
      <span class="font-bold">✗</span><span v-if="!compact" class="ml-1">{{ noLabel }}</span>
    </button>
  </div>
</template>

<style scoped>
.seg-btn { min-height: 28px; min-width: 36px; }
@media (pointer: coarse) { .seg-btn { min-height: 44px; min-width: 48px; padding: 0 14px; } }
</style>
