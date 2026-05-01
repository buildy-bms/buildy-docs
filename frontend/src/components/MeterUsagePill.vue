<script setup>
import { computed } from 'vue'
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import {
  faFire, faSnowflake, faFaucet, faSolarPanel, faLightbulb, faCircleNotch,
} from '@fortawesome/pro-solid-svg-icons'

library.add(faFire, faSnowflake, faFaucet, faSolarPanel, faLightbulb, faCircleNotch)

// Pilule colorée pour les usages de compteurs (alignée sur SystemCategoryIcon).
const USAGE_CFG = {
  heating:  { name: 'fire',        label: 'Chauffage',     bg: 'bg-red-50',     text: 'text-red-700',    ring: 'ring-red-200' },
  cooling:  { name: 'snowflake',   label: 'Climatisation', bg: 'bg-cyan-50',    text: 'text-cyan-700',   ring: 'ring-cyan-200' },
  dhw:      { name: 'faucet',      label: 'ECS',           bg: 'bg-sky-50',     text: 'text-sky-700',    ring: 'ring-sky-200' },
  pv:       { name: 'solar-panel', label: 'PV',            bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200' },
  lighting: { name: 'lightbulb',   label: 'Éclairage',     bg: 'bg-amber-50',   text: 'text-amber-700',  ring: 'ring-amber-200' },
  other:    { name: 'circle-notch', label: 'Général',      bg: 'bg-gray-50',    text: 'text-gray-700',   ring: 'ring-gray-200' },
}

const props = defineProps({
  usage: { type: String, required: true },
})

const cfg = computed(() => USAGE_CFG[props.usage] || USAGE_CFG.other)
</script>

<template>
  <span :class="['inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full ring-1 ring-inset whitespace-nowrap',
                 cfg.bg, cfg.text, cfg.ring]">
    <FontAwesomeIcon :icon="['fas', cfg.name]" class="w-3 h-3" />
    {{ cfg.label }}
  </span>
</template>
