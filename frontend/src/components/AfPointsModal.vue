<script setup>
/**
 * Modale "Tous les points de l'AF" — vue tableau a plat de tous les points
 * (resolus template + overrides) de toutes les sections kind='equipment'.
 * Pendant de AfInstancesModal pour les points. Tri + filtre par colonne.
 */
import { ref, onMounted, computed } from 'vue'
import { MagnifyingGlassIcon, XMarkIcon, ArrowsUpDownIcon, ArrowUpIcon, ArrowDownIcon } from '@heroicons/vue/24/outline'
import BaseModal from './BaseModal.vue'
import { listAfPoints } from '@/api'
import { useTableSortFilter } from '@/composables/useTableSortFilter'

const props = defineProps({ afId: { type: Number, required: true } })
const emit = defineEmits(['close', 'goto-section'])

const points = ref([])
const loading = ref(false)
const search = ref('')

onMounted(async () => {
  loading.value = true
  try {
    const { data } = await listAfPoints(props.afId)
    points.value = data
  } finally {
    loading.value = false
  }
})

function normalize(s) { return (s ?? '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') }

const searched = computed(() => {
  const q = normalize(search.value)
  if (q.length < 2) return points.value
  return points.value.filter(p =>
    normalize(p.label).includes(q) ||
    normalize(p.tech_name).includes(q) ||
    normalize(p.section_title).includes(q) ||
    normalize(p.section_number).includes(q) ||
    normalize(p.equipment_template_name).includes(q)
  )
})

const { sortKey, sortDir, columnFilters, processed, toggleSort, setFilter } =
  useTableSortFilter(searched, { defaultSortKey: 'section_number' })

const totals = computed(() => ({
  all: points.value.length,
  required: points.value.filter(p => !p.is_optional).length,
  optional: points.value.filter(p => p.is_optional).length,
  read: points.value.filter(p => p.direction === 'read').length,
  write: points.value.filter(p => p.direction === 'write').length,
}))

function gotoSection(sectionId) {
  emit('goto-section', sectionId)
  emit('close')
}

// Palette canonique alignee sur la liste de points PDF
// (cf. `templates/pdf/styles-points.css` .badge-nature) :
//   Booléen  -> vert (emerald)
//   Numérique -> violet
//   Enum      -> orange
//   Chaîne    -> gris (slate)
const NATURE_COLORS = {
  'Booléen':              { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  'Numérique':            { bg: 'bg-violet-50',  text: 'text-violet-700',  border: 'border-violet-200' },
  'Enum':                 { bg: 'bg-orange-50',  text: 'text-orange-700',  border: 'border-orange-200' },
  'Chaîne de caractères': { bg: 'bg-slate-50',   text: 'text-slate-700',   border: 'border-slate-200' },
}
const TYPE_COLORS = {
  Mesure:   { bg: 'bg-blue-50',     text: 'text-blue-700' },
  'État':   { bg: 'bg-gray-100',    text: 'text-gray-700' },
  Alarme:   { bg: 'bg-red-50',      text: 'text-red-700' },
  Commande: { bg: 'bg-emerald-50',  text: 'text-emerald-700' },
  Consigne: { bg: 'bg-amber-50',    text: 'text-amber-700' },
}

const cols = [
  { key: 'section_number', label: 'Section #', align: 'left' },
  { key: 'section_title', label: 'Section', align: 'left' },
  { key: 'equipment_template_name', label: 'Équipement', align: 'left' },
  { key: 'tech_name', label: 'Repère technique', align: 'left' },
  { key: 'label', label: 'Libellé', align: 'left' },
  { key: 'data_type', label: 'Type', align: 'left' },
  { key: 'direction', label: 'Sens', align: 'center' },
  { key: 'nature', label: 'Nature', align: 'left' },
  { key: 'unit', label: 'Unité', align: 'left' },
  { key: 'is_optional', label: 'Optionnel', align: 'center' },
]
</script>

<template>
  <BaseModal title="Tous les points de l'AF" size="full" @close="emit('close')">
    <div v-if="loading" class="text-center py-12 text-gray-400 text-sm">Chargement…</div>
    <template v-else>
      <!-- Synthese compteurs -->
      <div class="mb-4 grid grid-cols-2 md:grid-cols-5 gap-2">
        <div class="px-3 py-2 bg-gray-50 border border-gray-200 rounded">
          <p class="text-[10px] uppercase tracking-wider text-gray-500">Total</p>
          <p class="text-lg font-semibold text-gray-800 tabular-nums">{{ totals.all }}</p>
        </div>
        <div class="px-3 py-2 bg-emerald-50 border border-emerald-200 rounded">
          <p class="text-[10px] uppercase tracking-wider text-emerald-700">Obligatoires</p>
          <p class="text-lg font-semibold text-emerald-800 tabular-nums">{{ totals.required }}</p>
        </div>
        <div class="px-3 py-2 bg-amber-50 border border-amber-200 rounded">
          <p class="text-[10px] uppercase tracking-wider text-amber-700">Optionnels</p>
          <p class="text-lg font-semibold text-amber-800 tabular-nums">{{ totals.optional }}</p>
        </div>
        <div class="px-3 py-2 bg-indigo-50 border border-indigo-200 rounded">
          <p class="text-[10px] uppercase tracking-wider text-indigo-700">En lecture</p>
          <p class="text-lg font-semibold text-indigo-800 tabular-nums">{{ totals.read }}</p>
        </div>
        <div class="px-3 py-2 bg-rose-50 border border-rose-200 rounded">
          <p class="text-[10px] uppercase tracking-wider text-rose-700">En écriture</p>
          <p class="text-lg font-semibold text-rose-800 tabular-nums">{{ totals.write }}</p>
        </div>
      </div>

      <!-- Recherche globale -->
      <div class="relative max-w-md mb-3">
        <MagnifyingGlassIcon class="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input v-model="search" type="text" placeholder="Rechercher (libellé, repère, équipement, section)…" autocomplete="off"
               class="w-full pl-9 pr-9 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
        <button v-if="search" @click="search = ''" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
          <XMarkIcon class="w-4 h-4" />
        </button>
      </div>

      <!-- Tableau avec tri + filtre par colonne -->
      <div class="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 text-xs uppercase text-gray-500 tracking-wider">
            <tr>
              <th v-for="c in cols" :key="c.key"
                  :class="['px-3 py-2 whitespace-nowrap select-none', c.align === 'center' ? 'text-center' : 'text-left']">
                <button @click="toggleSort(c.key)" class="inline-flex items-center gap-1 hover:text-indigo-700 whitespace-nowrap">
                  {{ c.label }}
                  <ArrowUpIcon v-if="sortKey === c.key && sortDir === 'asc'" class="w-3 h-3 shrink-0" />
                  <ArrowDownIcon v-else-if="sortKey === c.key && sortDir === 'desc'" class="w-3 h-3 shrink-0" />
                  <ArrowsUpDownIcon v-else class="w-3 h-3 text-gray-300 shrink-0" />
                </button>
              </th>
              <th class="px-2 py-2"></th>
            </tr>
            <tr class="bg-white border-t border-gray-100">
              <th v-for="c in cols" :key="`f-${c.key}`" class="px-2 py-1.5">
                <input
                  :value="columnFilters[c.key] || ''"
                  @input="setFilter(c.key, $event.target.value)"
                  type="text" placeholder="Filtrer…"
                  class="w-full px-2 py-1 rounded-md border border-gray-200 text-[11px] text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400 transition"
                />
              </th>
              <th class="px-2 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in processed" :key="`${p.section_id}-${p.point_id}`"
                class="border-t border-gray-100 hover:bg-indigo-50/40 cursor-pointer"
                @click="gotoSection(p.section_id)">
              <td class="px-3 py-2 whitespace-nowrap font-mono text-[11px] text-gray-500">{{ p.section_number || '—' }}</td>
              <td class="px-3 py-2 whitespace-nowrap text-xs text-gray-700">{{ p.section_title }}</td>
              <td class="px-3 py-2 whitespace-nowrap text-gray-700">{{ p.equipment_template_name || '—' }}</td>
              <td class="px-3 py-2 whitespace-nowrap"><code v-if="p.tech_name" class="text-[11px] text-gray-700 bg-gray-50 px-1.5 py-0.5 rounded">{{ p.tech_name }}</code><span v-else class="text-gray-400">—</span></td>
              <td class="px-3 py-2 whitespace-nowrap text-gray-800">{{ p.label }}</td>
              <td class="px-3 py-2 whitespace-nowrap">
                <span :class="['text-[11px] px-1.5 py-0.5 rounded font-medium', TYPE_COLORS[p.data_type]?.bg || 'bg-gray-100', TYPE_COLORS[p.data_type]?.text || 'text-gray-700']">{{ p.data_type }}</span>
              </td>
              <td class="px-3 py-2 whitespace-nowrap text-center">
                <span :class="['text-[11px] px-1.5 py-0.5 rounded font-medium', p.direction === 'read' ? 'bg-indigo-100 text-indigo-800' : 'bg-rose-100 text-rose-800']">{{ p.direction === 'read' ? 'R' : 'W' }}</span>
              </td>
              <td class="px-3 py-2 whitespace-nowrap">
                <span v-if="p.nature && NATURE_COLORS[p.nature]"
                      :class="['text-[11px] px-1.5 py-0.5 rounded border font-medium', NATURE_COLORS[p.nature].bg, NATURE_COLORS[p.nature].text, NATURE_COLORS[p.nature].border]">{{ p.nature }}</span>
                <span v-else class="text-gray-400">—</span>
              </td>
              <td class="px-3 py-2 whitespace-nowrap text-gray-600">{{ p.unit || '—' }}</td>
              <td class="px-3 py-2 whitespace-nowrap text-center">
                <span :class="['inline-block w-4 h-4 rounded border align-middle', p.is_optional ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-gray-300']">
                  <span v-if="p.is_optional" class="block text-white text-[10px] leading-4 text-center">✓</span>
                </span>
              </td>
              <td class="px-2"></td>
            </tr>
            <tr v-if="!processed.length">
              <td :colspan="cols.length + 1" class="px-3 py-8 text-center text-sm text-gray-400 italic">
                {{ search || Object.keys(columnFilters).length ? 'Aucun point ne correspond aux filtres actuels.' : 'Aucun point dans cette AF.' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="text-[11px] text-gray-400 mt-3">
        <strong class="text-gray-600">{{ processed.length }}</strong> / {{ totals.all }} point(s) affiché(s) · cliquer sur une ligne pour aller à sa section.
      </p>
    </template>

    <template #footer>
      <button @click="emit('close')" class="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">Fermer</button>
    </template>
  </BaseModal>
</template>
