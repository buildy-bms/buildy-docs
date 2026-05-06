<script setup>
import { computed } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { resolveFaIconName } from '@/lib/equipment-icons'

const props = defineProps({
  template: { type: Object, required: true },
  size: { type: String, default: 'md' }, // 'xs' | 'sm' | 'md' | 'lg'
})

const sizeClass = computed(() => ({
  xs: 'w-3 h-3', sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8',
}[props.size] || 'w-6 h-6'))

const iconKind = computed(() => props.template?.icon_kind || 'fa')
const iconValue = computed(() => props.template?.icon_value || 'fa-cube')
const iconColor = computed(() => props.template?.icon_color || '#6b7280')
const faName = computed(() => resolveFaIconName(iconValue.value))
</script>

<template>
  <span :class="['inline-flex items-center justify-center shrink-0', sizeClass]" :style="{ color: iconColor }">
    <FontAwesomeIcon v-if="iconKind === 'fa'" :icon="['fas', faName]" />
    <!-- TODO svg-hyperveez et svg-custom : copier les SVG depuis hyperveez/src/assets quand on en aura besoin -->
    <span v-else class="text-[10px] text-gray-400">{{ iconValue }}</span>
  </span>
</template>
