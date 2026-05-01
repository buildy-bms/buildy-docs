<script setup>
import { computed } from 'vue'
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import {
  faBolt, faSolarPanel, faFire, faDroplet, faTemperatureHalf, faGauge,
} from '@fortawesome/pro-solid-svg-icons'

library.add(faBolt, faSolarPanel, faFire, faDroplet, faTemperatureHalf, faGauge)

// Pilule colorée pour les types de compteurs.
// Codes couleur Buildy alignés sur les conventions metier :
// - Eau : bleu
// - Électricité : ambre/jaune
// - Gaz : rouge
// - Thermique (calories) : violet
// - PV : vert
const TYPE_CFG = {
  electric:            { name: 'bolt',             label: 'Électrique',         bg: 'bg-amber-100',  text: 'text-amber-800',  ring: 'ring-amber-300' },
  electric_production: { name: 'solar-panel',      label: 'Élec. production',   bg: 'bg-emerald-100', text: 'text-emerald-800', ring: 'ring-emerald-300' },
  gas:                 { name: 'fire',             label: 'Gaz',                bg: 'bg-red-100',     text: 'text-red-800',    ring: 'ring-red-300' },
  water:               { name: 'droplet',          label: 'Eau',                bg: 'bg-sky-100',     text: 'text-sky-800',    ring: 'ring-sky-300' },
  thermal:             { name: 'temperature-half', label: 'Thermique',          bg: 'bg-violet-100',  text: 'text-violet-800', ring: 'ring-violet-300' },
  other:               { name: 'gauge',            label: 'Autre',              bg: 'bg-gray-100',    text: 'text-gray-700',   ring: 'ring-gray-300' },
}

const props = defineProps({
  type: { type: String, required: true },
})

const cfg = computed(() => TYPE_CFG[props.type] || TYPE_CFG.other)
</script>

<template>
  <span :class="['inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full ring-1 ring-inset whitespace-nowrap',
                 cfg.bg, cfg.text, cfg.ring]">
    <FontAwesomeIcon :icon="['fas', cfg.name]" class="w-3 h-3" />
    {{ cfg.label }}
  </span>
</template>
