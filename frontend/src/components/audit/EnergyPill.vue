<script setup>
/**
 * Pilule colorée d'une énergie primaire (gaz, élec, RC urbain, bois, etc.)
 * avec icône depuis `ENERGY_OPTIONS` de `lib/audit-options.js`.
 *
 * Cohérent avec le SearchableSelect d'édition (audit) et avec RolePills.
 * Utilisé en lecture seule dans la biblio + futures listes denses.
 */
import { computed } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { ENERGY_OPTIONS } from '@/lib/audit-options'
import { resolveFaIconName } from '@/lib/equipment-icons'

const props = defineProps({
  value: { type: String, default: null },
  size: { type: String, default: 'sm' }, // 'xs' | 'sm' | 'md'
})

const option = computed(() => ENERGY_OPTIONS.find(o => o.value === props.value) || null)

const sizeClasses = computed(() => {
  if (props.size === 'xs') return { pill: 'text-[10px] px-1.5 py-0.5 gap-0.5', icon: 'w-2.5 h-2.5' }
  if (props.size === 'md') return { pill: 'text-xs px-2 py-1 gap-1.5',          icon: 'w-3.5 h-3.5' }
  return                          { pill: 'text-[11px] px-1.5 py-0.5 gap-1',    icon: 'w-3 h-3' }
})

function faName(icon) { return resolveFaIconName(icon) }
</script>

<template>
  <span v-if="option"
        class="inline-flex items-center rounded-full font-medium border whitespace-nowrap"
        :class="sizeClasses.pill"
        :style="{
          color: option.color,
          borderColor: option.color + '55',
          backgroundColor: option.color + '12',
        }">
    <FontAwesomeIcon :icon="['fas', faName(option.icon)]" :class="sizeClasses.icon" />
    <span>{{ option.label }}</span>
  </span>
  <span v-else class="text-gray-300 text-xs italic">—</span>
</template>
