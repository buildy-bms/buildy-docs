<script setup>
import { computed } from 'vue'
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import {
  faFire, faSnowflake, faFan, faFaucet, faLightbulb,
  faTowerCell, faSolarPanel, faGauge, faCube,
} from '@fortawesome/pro-solid-svg-icons'

library.add(faFire, faSnowflake, faFan, faFaucet, faLightbulb, faTowerCell, faSolarPanel, faGauge, faCube)

const ICONS = {
  heating:                { name: 'fire',         color: '#dc2626' },
  cooling:                { name: 'snowflake',    color: '#0891b2' },
  ventilation:            { name: 'fan',          color: '#64748b' },
  dhw:                    { name: 'faucet',       color: '#0284c7' },
  lighting_indoor:        { name: 'lightbulb',    color: '#f59e0b' },
  lighting_outdoor:       { name: 'tower-cell',   color: '#f59e0b' },
  electricity_production: { name: 'solar-panel',  color: '#16a34a' },
}

const props = defineProps({
  category: { type: String, required: true },
  size: { type: String, default: 'md' }, // 'sm' | 'md' | 'lg'
})

const cfg = computed(() => ICONS[props.category] || { name: 'cube', color: '#6b7280' })
const sizeClass = computed(() => ({
  xs: 'w-3.5 h-3.5', sm: 'w-4 h-4', md: 'w-5 h-5', lg: 'w-6 h-6',
}[props.size] || 'w-5 h-5'))
</script>

<template>
  <span :class="['inline-flex items-center justify-center shrink-0', sizeClass]" :style="{ color: cfg.color }">
    <FontAwesomeIcon :icon="['fas', cfg.name]" />
  </span>
</template>
