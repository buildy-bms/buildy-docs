<script setup>
/**
 * Affichage en lecture seule des fonctions d'un équipement (Production /
 * Distribution / Émission / Régulation / Autre) sous forme de pilules
 * colorées avec une PASTILLE de couleur (plus d'icône — Buildy Docs 0.1.147,
 * pour éviter la confusion entre l'icône fa-fan d'Émission et la catégorie
 * d'usage Ventilation, etc.).
 *
 * Source unique des couleurs : `ROLE_OPTIONS` de `lib/audit-options.js`.
 * Utilisé en bibliothèque (LibraryEquipmentView, LibraryDevicePicker) et
 * partout où on a besoin d'afficher les fonctions sans permettre l'édition.
 *
 * Pour la saisie, voir `SearchableSelect` multi-select avec `ROLE_OPTIONS`
 * qui rend des chips éditables (audit).
 */
import { computed } from 'vue'
import { ROLE_OPTIONS } from '@/lib/audit-options'

const props = defineProps({
  // Soit un array de valeurs, soit une string CSV, soit une string JSON array.
  roles: { type: [Array, String, null], default: null },
  size: { type: String, default: 'sm' }, // 'xs' | 'sm' | 'md'
  // Affichage compact (catalogue dense) : on cache le label texte, garde
  // juste la pastille colorée + tooltip avec le nom complet.
  // Note : `iconOnly` est conservé pour compat ascendante ; sémantiquement
  // c'est désormais « pastille seule ».
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
      color: opt?.color || '#6b7280',
    }
  })
})

const sizeClasses = computed(() => {
  if (props.size === 'xs') return { pill: 'text-[10px] px-1.5 py-0.5 gap-1', dot: 'w-1.5 h-1.5' }
  if (props.size === 'md') return { pill: 'text-xs px-2 py-1 gap-1.5',       dot: 'w-2 h-2' }
  return                          { pill: 'text-[11px] px-1.5 py-0.5 gap-1', dot: 'w-1.5 h-1.5' }
})
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
      <span class="rounded-full shrink-0"
            :class="sizeClasses.dot"
            :style="{ backgroundColor: o.color }"></span>
      <span v-if="!iconOnly">{{ o.label }}</span>
    </span>
  </span>
  <span v-else class="text-gray-300 text-xs italic">—</span>
</template>
