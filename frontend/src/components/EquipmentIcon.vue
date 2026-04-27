<script setup>
import { computed } from 'vue'
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import {
  faFan, faFire, faTemperatureArrowUp, faSnowflake, faBuilding, faWind,
  faDroplet, faLightbulb, faPlug, faSolarPanel, faBolt, faFireFlameSimple,
  faTemperatureHalf, faLeaf, faIndustry, faCube, faRectangleAd,
} from '@fortawesome/free-solid-svg-icons'

// Enregistrer les icones FA utilisees par defaut dans nos templates
library.add(
  faFan, faFire, faTemperatureArrowUp, faSnowflake, faBuilding, faWind,
  faDroplet, faLightbulb, faPlug, faSolarPanel, faBolt, faFireFlameSimple,
  faTemperatureHalf, faLeaf, faIndustry, faCube, faRectangleAd,
)

const props = defineProps({
  template: { type: Object, required: true },
  size: { type: String, default: 'md' }, // 'sm' | 'md' | 'lg'
})

const sizeClass = computed(() => ({
  sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8',
}[props.size] || 'w-6 h-6'))

const iconKind = computed(() => props.template?.icon_kind || 'fa')
const iconValue = computed(() => props.template?.icon_value || 'fa-cube')
const iconColor = computed(() => props.template?.icon_color || '#6b7280')

// Pour FontAwesome, on enleve le prefixe 'fa-' et on convertit en camelCase
const faName = computed(() => {
  const v = (iconValue.value || 'fa-cube').replace(/^fa-/, '')
  return v // FA Vue accept ce format directement via library.add() au-dessus
})
</script>

<template>
  <span :class="['inline-flex items-center justify-center shrink-0', sizeClass]" :style="{ color: iconColor }">
    <FontAwesomeIcon v-if="iconKind === 'fa'" :icon="['fas', faName]" />
    <!-- TODO svg-hyperveez et svg-custom : copier les SVG depuis hyperveez/src/assets quand on en aura besoin -->
    <span v-else class="text-[10px] text-gray-400">{{ iconValue }}</span>
  </span>
</template>
