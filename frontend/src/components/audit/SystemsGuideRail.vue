<script setup>
/**
 * Guide d'une zone (étape Systèmes, mise en page guidée) : colonne de gauche avec la zone, sa
 * progression (usages terminés sur présents), la liste des usages avec leur icône et leur état
 * (à compléter, à vérifier, sans réponse, complet) et le bouton « Reprendre les N points, un par
 * un ». En tête, « Tous les usages » (choisi par défaut) ; un clic sur un usage filtre la liste
 * (seul cet usage reste affiché). Réduit à ses icônes quand la place manque (`collapsed`), chaque
 * icône gardant sa carte d'état au survol.
 */
import { computed } from 'vue'
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { faRoute, faLayerGroup } from '@fortawesome/free-solid-svg-icons'
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import {
  progressLabel, systemStatusParts, railItemTip, resumeLabel, RESUME_TIP, GUIDE_DONE_TEXT,
  ALL_USAGES_LABEL, zoneStatusParts, allUsagesTip,
} from '@/lib/audit-tips-systems-guide'

const props = defineProps({
  zone: { type: Object, required: true },        // zoneGuide() de lib/systems-guide.js
  natureLabel: { type: String, default: '' },
  stopsCount: { type: Number, default: 0 },      // points à reprendre dans la zone
  // Usage affiché seul dans la liste (null = tous les usages).
  filterSystemId: { type: Number, default: null },
  collapsed: { type: Boolean, default: false },
  labelOf: { type: Function, required: true },   // libellé d'un usage (catégorie ou nom libre)
})
const emit = defineEmits(['filter', 'resume'])

library.add(faRoute, faLayerGroup)

// Teinte claire derrière l'icône d'usage (mêmes couleurs que SystemCategoryIcon).
const TINT = {
  heating: '#fef2f2',
  cooling: '#ecfeff',
  ventilation: '#f1f5f9',
  dhw: '#eff6ff',
  lighting_indoor: '#fffbeb',
  lighting_outdoor: '#fffbeb',
  electricity_production: '#f0fdf4',
}
const PART_TONE = {
  amber: 'text-amber-800',
  rose: 'text-rose-700',
  slate: 'text-slate-600',
  green: 'text-emerald-700',
}
const DOT_TONE = {
  amber: 'bg-amber-400',
  rose: 'bg-rose-500',
  slate: 'bg-white ring-1 ring-inset ring-slate-500 [border-style:dashed]',
  green: 'bg-emerald-500',
}

// Usages du guide : présents et sans réponse (les non concernés restent en pastilles sous la liste).
const items = computed(() => props.zone.systems.filter(x => x.status !== 'not_concerned'))
const pct = computed(() => (props.zone.present ? Math.round(props.zone.done / props.zone.present * 100) : 0))
function firstTone(x) { return systemStatusParts(x)[0]?.tone || 'slate' }
const allParts = computed(() => zoneStatusParts(props.zone))
function itemClass(selected) {
  return ['w-full flex items-center rounded-lg text-left transition outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50',
    props.collapsed ? 'relative justify-center p-1.5' : 'gap-2.5 px-2 py-1.5',
    selected ? 'bg-slate-100 shadow-[inset_3px_0_0_var(--color-indigo-600)]' : 'hover:bg-slate-50']
}
</script>

<template>
  <nav :aria-label="`Guide de la zone ${zone.zoneName}`"
       :class="['flex flex-col', collapsed ? 'items-center gap-1.5 py-3' : 'gap-2.5 p-3']">
    <div v-if="!collapsed" class="px-1">
      <div class="flex items-baseline gap-1.5 min-w-0">
        <span class="text-[15px] font-semibold text-indigo-600 truncate" v-tooltip.overflow>{{ zone.zoneName }}</span>
        <span v-if="natureLabel" class="text-xs text-slate-500 truncate shrink-0" v-tooltip.overflow>{{ natureLabel }}</span>
      </div>
      <p class="text-xs text-slate-600 mt-0.5">{{ progressLabel(zone.done, zone.present) }}</p>
      <div role="progressbar" aria-label="Usages terminés" :aria-valuenow="zone.done" aria-valuemin="0" :aria-valuemax="zone.present"
           class="h-1.5 rounded-full bg-slate-200 mt-2 overflow-hidden">
        <div class="h-full rounded-full bg-[#00cd92] transition-[width] duration-300" :style="{ width: `${pct}%` }"></div>
      </div>
    </div>
    <ul :class="['flex flex-col', collapsed ? 'gap-1' : 'gap-0.5']">
      <!-- Tous les usages (par défaut) : la liste montre toute la zone. -->
      <li>
        <button type="button" data-guide-all-usages
                :aria-pressed="filterSystemId == null ? 'true' : 'false'"
                @click="emit('filter', null)"
                v-tooltip.right="() => allUsagesTip(zone)"
                :class="itemClass(filterSystemId == null)">
          <span class="relative w-7 h-7 shrink-0 rounded-lg inline-flex items-center justify-center bg-slate-100 text-indigo-600">
            <FontAwesomeIcon :icon="['fas', 'layer-group']" class="w-3.5 h-3.5" />
            <span v-if="collapsed" aria-hidden="true"
                  :class="['absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white', DOT_TONE[allParts[0].tone]]"></span>
          </span>
          <span v-if="!collapsed" class="flex flex-col min-w-0">
            <span :class="['text-[13px] text-indigo-600 truncate', filterSystemId == null ? 'font-semibold' : 'font-medium']">{{ ALL_USAGES_LABEL }}</span>
            <span class="text-xs leading-snug">
              <template v-for="(p, i) in allParts" :key="p.text">
                <span v-if="i" class="text-slate-400">, </span><span :class="PART_TONE[p.tone]">{{ p.text }}</span>
              </template>
            </span>
          </span>
          <span v-else class="sr-only">{{ ALL_USAGES_LABEL }}</span>
        </button>
      </li>
      <li v-if="!collapsed" aria-hidden="true" class="mx-2 my-1 border-t border-slate-100"></li>
      <li v-for="x in items" :key="x.system.id">
        <button type="button"
                :data-guide-system="x.system.id"
                :aria-pressed="x.system.id === filterSystemId ? 'true' : 'false'"
                @click="emit('filter', x.system.id)"
                v-tooltip.right="() => railItemTip(x, labelOf(x.system))"
                :class="itemClass(x.system.id === filterSystemId)">
          <span class="relative w-7 h-7 shrink-0 rounded-lg inline-flex items-center justify-center"
                :style="{ background: TINT[x.system.system_category] || '#f1f5f9' }">
            <SystemCategoryIcon :category="x.system.system_category" size="sm" :with-tooltip="false" />
            <span v-if="collapsed" aria-hidden="true"
                  :class="['absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white', DOT_TONE[firstTone(x)]]"></span>
          </span>
          <span v-if="!collapsed" class="flex flex-col min-w-0">
            <span :class="['text-[13px] text-indigo-600 truncate', x.system.id === filterSystemId ? 'font-semibold' : 'font-medium']"
                  v-tooltip.overflow>{{ labelOf(x.system) }}</span>
            <span class="text-xs leading-snug">
              <template v-for="(p, i) in systemStatusParts(x)" :key="p.text">
                <span v-if="i" class="text-slate-400">, </span><span :class="PART_TONE[p.tone]">{{ p.text }}</span>
              </template>
            </span>
          </span>
          <span v-else class="sr-only">{{ labelOf(x.system) }}</span>
        </button>
      </li>
    </ul>
    <template v-if="stopsCount">
      <button v-if="!collapsed" type="button" @click="emit('resume')" v-tooltip="RESUME_TIP"
              class="mt-1 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-left text-[13px] font-medium text-white hover:bg-indigo-700 transition outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-600">
        <FontAwesomeIcon :icon="['fas', 'route']" class="w-3.5 h-3.5 shrink-0" />
        {{ resumeLabel(stopsCount) }}
      </button>
      <button v-else type="button" @click="emit('resume')" v-tooltip.right="RESUME_TIP"
              class="mt-1 inline-flex items-center justify-center w-9 h-9 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition">
        <FontAwesomeIcon :icon="['fas', 'route']" class="w-3.5 h-3.5" />
        <span class="sr-only">{{ resumeLabel(stopsCount) }}</span>
      </button>
    </template>
    <p v-else-if="!collapsed && zone.present" class="px-1 text-xs text-emerald-700">✓ {{ GUIDE_DONE_TEXT }}</p>
  </nav>
</template>
