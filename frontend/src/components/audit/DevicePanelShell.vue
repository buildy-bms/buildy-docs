<script setup>
/**
 * Enveloppe « panneau » de DeviceEditModal : même formulaire que la modale,
 * affiché dans la fiche équipement à droite de l'étape Systèmes (page audit
 * à onglets). L'en-tête (nom, navigation, actions) est porté par le parent ;
 * ici : le corps du formulaire + le pied collant (complétude, Fermer).
 * Accepte les props de BaseModal pour être interchangeable avec elle.
 */
defineProps({
  title: { type: String, default: '' },
  size: { type: String, default: '' },
  dismissOnBackdrop: { type: Boolean, default: false },
})
defineEmits(['close'])
</script>

<template>
  <div class="flex flex-col min-h-0">
    <div class="px-3 pt-3 pb-2">
      <slot />
    </div>
    <div v-if="$slots.footer" class="sticky bottom-0 z-10 bg-slate-50 border-t border-slate-200 px-3 py-2">
      <slot name="footer" />
    </div>
  </div>
</template>
