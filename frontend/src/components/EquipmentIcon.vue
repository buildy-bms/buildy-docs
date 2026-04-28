<script setup>
import { computed } from 'vue'
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import * as allSolidIcons from '@fortawesome/free-solid-svg-icons'

// Enregistre TOUTES les icones FA Free Solid (~1500 icones, ~150KB gzippé)
// pour permettre au picker de proposer une recherche dans toute la base.
const iconObjs = Object.values(allSolidIcons).filter(i => i && i.iconName && i.icon)
library.add(...iconObjs)

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

// Pour FontAwesome, on enleve le prefixe 'fa-'. Si l'icone n'existe pas, fallback 'cube'.
const knownNames = new Set(iconObjs.map(i => i.iconName))
const faName = computed(() => {
  const v = (iconValue.value || 'fa-cube').replace(/^fa-/, '')
  return knownNames.has(v) ? v : 'cube'
})
</script>

<template>
  <span :class="['inline-flex items-center justify-center shrink-0', sizeClass]" :style="{ color: iconColor }">
    <FontAwesomeIcon v-if="iconKind === 'fa'" :icon="['fas', faName]" />
    <!-- TODO svg-hyperveez et svg-custom : copier les SVG depuis hyperveez/src/assets quand on en aura besoin -->
    <span v-else class="text-[10px] text-gray-400">{{ iconValue }}</span>
  </span>
</template>
