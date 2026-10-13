<script setup>
/**
 * Enveloppe d'infobulle (2026-10-12) : porte la bulle navy de v-tooltip (lib/tooltip.js) sur un
 * <span> autour de son contenu. Même API qu'avant :
 *   <Tooltip text="Section vérifiée"><CheckCircleIcon class="w-4 h-4" /></Tooltip>
 *   <Tooltip :text="{ title, text, tone, rows, todo }" placement="right">…</Tooltip>
 *
 * À utiliser surtout pour un bouton grisé : un bouton désactivé ne reçoit pas le survol, la bulle
 * (la raison du grisé) est donc portée par l'enveloppe (data-tip-wrap, cf. assets/main.css) :
 *   <Tooltip :text="reason"><button :disabled="!!reason">Valider</button></Tooltip>
 * Le bouton enveloppé reçoit le nom accessible et la bulle au focus clavier.
 *
 * Props :
 *   - text : étiquette (texte), carte (objet) ou fonction ; vide = pas de bulle
 *   - placement : 'top' (défaut) | 'bottom' | 'left' | 'right'
 */
import { computed } from 'vue'

const props = defineProps({
  text: { type: [String, Object, Function], default: '' },
  placement: { type: String, default: 'top' },
})

const value = computed(() => {
  const t = props.text
  if (!t) return null
  if (typeof t === 'string') return { label: t, placement: props.placement }
  if (typeof t === 'function') return () => {
    const v = t()
    return v && typeof v === 'object' ? { placement: props.placement, ...v } : v
  }
  return { placement: props.placement, ...t }
})
</script>

<template>
  <span class="inline-flex" data-tip-wrap v-tooltip="value"><slot /></span>
</template>
