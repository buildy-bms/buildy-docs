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
  // Taille : 'sm' = 28px (defaut, colonnes tableau, desktop dense),
  // 'lg' = 48px (gabarit tactile PWA, force la hauteur partout sans
  // dependre du media query pointer:coarse — necessaire en dev sur
  // Mac trackpad qui ne match pas le query).
  size: { type: String, default: 'sm' },
});
const emit = defineEmits(['update:modelValue']);

function pick(v) {
  if (!emit) return;
  emit('update:modelValue', v);
}
</script>

<template>
  <div :class="['seg-toggle inline-flex rounded-lg border border-gray-200 overflow-hidden shrink-0',
                size === 'lg' ? 'text-base' : 'text-xs',
                disabled ? 'opacity-50 pointer-events-none' : '']"
       :title="tooltip">
    <button type="button"
            :class="['seg-btn font-medium transition whitespace-nowrap select-none',
                     size === 'lg' ? 'min-h-12 px-4' : 'h-7 px-3',
                     modelValue === true
                       ? (yesDanger ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-800')
                       : 'bg-white text-gray-300 hover:text-gray-500 hover:bg-gray-50']"
            @click="pick(true)">
      <span class="font-bold">✓</span><span v-if="!compact" class="ml-1">{{ yesLabel }}</span>
    </button>
    <button type="button"
            :class="['seg-btn font-medium transition whitespace-nowrap select-none border-l border-gray-200',
                     size === 'lg' ? 'min-h-12 px-4' : 'h-7 px-3',
                     modelValue === false
                       ? 'bg-red-100 text-red-700'
                       : 'bg-white text-gray-300 hover:text-gray-500 hover:bg-gray-50']"
            @click="pick(false)">
      <span class="font-bold">✗</span><span v-if="!compact" class="ml-1">{{ noLabel }}</span>
    </button>
  </div>
</template>

<style scoped>
/* Aligné sur components/audit/SegmentedToggle.vue (text version) :
   h-7 (28px) en desktop compact. Sur tactile, gabarit PWA Buildy 48px
   (aligné sur .pwa-button — cf. main.css §PWA tactile design system)
   pour homogénéité parfaite avec inputs/selects/MobileYesNo voisins. */
.seg-btn { min-width: 36px; }
@media (pointer: coarse) {
  .seg-btn { min-height: 48px; min-width: 56px; padding: 0 16px; font-size: 1rem; }
}
</style>
