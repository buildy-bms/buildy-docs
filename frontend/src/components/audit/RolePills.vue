<script setup>
/**
 * Affichage en lecture seule des fonctions d'un équipement (Production /
 * Distribution / Émission / Régulation / Autre) sous forme de pilules
 * colorées avec icône.
 *
 * Source unique des couleurs et icônes : `ROLE_OPTIONS` de `lib/audit-options.js`.
 * Utilisé en bibliothèque (LibraryEquipmentView, LibraryDevicePicker) et
 * partout où on a besoin d'afficher les fonctions sans permettre l'édition.
 *
 * Pour la saisie, voir `SearchableSelect` multi-select avec `ROLE_OPTIONS`
 * qui rend des chips éditables (audit).
 */
import { computed } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { ROLE_OPTIONS } from '@/lib/audit-options'
import { resolveFaIconName } from '@/lib/equipment-icons'

const props = defineProps({
  // Soit un array de valeurs, soit une string CSV, soit une string JSON array.
  roles: { type: [Array, String, null], default: null },
  size: { type: String, default: 'sm' }, // 'xs' | 'sm' | 'md'
  // En affichage compact (catalogue dense), on cache le label texte.
  iconOnly: { type: Boolean, default: false },
})

function parseRoles(raw) {
  if (Array.isArray(raw)) return raw
  if (!raw) return []
  const s = String(raw).trim()
  if (s.startsWith('[')) {
    try { const a = JSON.parse(s); if (Array.isArray(a)) return a } catch {}
  }
  return s.split(',').map(x => x.trim()).filter(Boolean)
}

const items = computed(() => {
  const arr = parseRoles(props.roles)
  return arr.map(v => {
    const opt = ROLE_OPTIONS.find(o => o.value === v)
    return {
      value: v,
      label: opt?.label || v,
      icon: opt?.icon || 'fa-cube',
      color: opt?.color || '#6b7280',
    }
  })
})

const sizeClasses = computed(() => {
  if (props.size === 'xs') return { pill: 'text-[10px] px-1.5 py-0.5 gap-0.5', icon: 'w-2.5 h-2.5' }
  if (props.size === 'md') return { pill: 'text-xs px-2 py-1 gap-1.5',          icon: 'w-3.5 h-3.5' }
  return                          { pill: 'text-[11px] px-1.5 py-0.5 gap-1',    icon: 'w-3 h-3' }
})

function faName(icon) { return resolveFaIconName(icon) }
</script>

<template>
  <span v-if="items.length" class="inline-flex flex-wrap items-center gap-1">
    <span v-for="o in items" :key="o.value"
          class="inline-flex items-center rounded-full font-medium border bg-white whitespace-nowrap"
          :class="sizeClasses.pill"
          :style="{
            color: o.color,
            borderColor: o.color + '55',
            backgroundColor: o.color + '12',
          }"
          v-tooltip="iconOnly ? o.label : null">
      <FontAwesomeIcon :icon="['fas', faName(o.icon)]" :class="sizeClasses.icon" />
      <span v-if="!iconOnly">{{ o.label }}</span>
    </span>
  </span>
  <span v-else class="text-gray-300 text-xs italic">—</span>
</template>
