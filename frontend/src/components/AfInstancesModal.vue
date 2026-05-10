<script setup>
/**
 * Modale "Toutes les instances d'équipement de l'AF" — vue tableau a plat.
 * Ouverte depuis le header AF (bouton "Instances"). Tri + filtre par colonne
 * + bouton dupliquer (POST /instances/:id/duplicate).
 */
import { ref, onMounted, computed } from 'vue'
import { MagnifyingGlassIcon, XMarkIcon, DocumentDuplicateIcon, ArrowsUpDownIcon, ArrowUpIcon, ArrowDownIcon } from '@heroicons/vue/24/outline'
import BaseModal from './BaseModal.vue'
import EquipmentIcon from './EquipmentIcon.vue'
import { listAfInstances, duplicateInstance } from '@/api'
import { useTableSortFilter } from '@/composables/useTableSortFilter'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({ afId: { type: Number, required: true } })
const emit = defineEmits(['close', 'goto-section'])

const { error: notifyError, success: notifySuccess } = useNotification()
const instances = ref([])
const loading = ref(false)
const search = ref('')

async function refresh() {
  loading.value = true
  try {
    const { data } = await listAfInstances(props.afId)
    instances.value = data
  } finally {
    loading.value = false
  }
}
onMounted(refresh)

function normalize(s) { return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') }

const searched = computed(() => {
  const q = normalize(search.value)
  if (q.length < 2) return instances.value
  return instances.value.filter(i =>
    normalize(i.reference).includes(q) ||
    normalize(i.location).includes(q) ||
    normalize(i.template_name).includes(q) ||
    normalize(i.section_title).includes(q) ||
    normalize(i.section_number).includes(q)
  )
})

const { sortKey, sortDir, columnFilters, processed, toggleSort, setFilter } =
  useTableSortFilter(searched, { defaultSortKey: 'section_number' })

const groupedCount = computed(() => {
  const m = new Map()
  for (const i of instances.value) {
    const key = i.template_id || 0
    if (!m.has(key)) {
      m.set(key, { template_name: i.template_name || '—', template_id: i.template_id, qty_total: 0, count: 0,
                   icon_kind: i.template_icon_kind, icon_value: i.template_icon_value, icon_color: i.template_icon_color })
    }
    const entry = m.get(key)
    entry.count += 1
    entry.qty_total += (i.qty || 1)
  }
  return Array.from(m.values()).sort((a, b) => b.qty_total - a.qty_total)
})

function gotoSection(sectionId) {
  emit('goto-section', sectionId)
  emit('close')
}

async function duplicateRow(inst) {
  try {
    await duplicateInstance(inst.id)
    notifySuccess('Instance dupliquée')
    await refresh()
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de la duplication')
  }
}

const cols = [
  { key: 'section_number', label: 'Section', align: 'left' },
  { key: 'template_name', label: 'Équipement', align: 'left' },
  { key: 'reference', label: 'Repère', align: 'left' },
  { key: 'location', label: 'Localisation', align: 'left' },
  { key: 'qty', label: 'Qté', align: 'center' },
]
</script>

<template>
  <BaseModal title="Instances d'équipements du projet" size="lg" @close="emit('close')">
    <div v-if="loading" class="text-center py-12 text-gray-400 text-sm">Chargement…</div>
    <template v-else>
      <!-- Synthese par template -->
      <div v-if="groupedCount.length" class="mb-5">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Synthèse par type d'équipement ({{ groupedCount.length }})
        </h3>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
          <div v-for="g in groupedCount" :key="g.template_id || g.template_name"
               class="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded">
            <EquipmentIcon v-if="g.template_id" :template="{ icon_kind: g.icon_kind, icon_value: g.icon_value, icon_color: g.icon_color }" size="sm" />
            <span class="flex-1 text-sm text-gray-700 truncate">{{ g.template_name }}</span>
            <span class="text-xs font-semibold text-gray-900 tabular-nums">{{ g.qty_total }}</span>
          </div>
        </div>
      </div>

      <!-- Recherche globale -->
      <div class="relative max-w-md mb-3">
        <MagnifyingGlassIcon class="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input v-model="search" type="text" placeholder="Rechercher (repère, localisation, équipement, section)…" autocomplete="off"
               class="w-full pl-9 pr-9 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
        <button v-if="search" @click="search = ''" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
          <XMarkIcon class="w-4 h-4" />
        </button>
      </div>

      <!-- Tableau -->
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
              <th class="text-left px-3 py-2 whitespace-nowrap">Notes</th>
              <th class="px-2 py-2 w-16"></th>
            </tr>
            <tr class="bg-white border-t border-gray-100">
              <th v-for="c in cols" :key="`f-${c.key}`" class="px-2 py-1.5">
                <input
                  :value="columnFilters[c.key] || ''"
                  @input="setFilter(c.key, $event.target.value)"
                  type="text" placeholder="Filtrer…"
                  class="w-full px-2 py-1 rounded-md border border-gray-200 text-[11px] text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400 transition" />
              </th>
              <th class="px-2 py-1.5"></th>
              <th class="px-2 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in processed" :key="i.id"
                class="border-t border-gray-100 hover:bg-indigo-50/40 group">
              <td class="px-3 py-2 whitespace-nowrap cursor-pointer" @click="gotoSection(i.section_id)">
                <span class="font-mono text-[11px] text-gray-500">{{ i.section_number || '—' }}</span>
                <span class="ml-1 text-xs text-gray-700">{{ i.section_title }}</span>
                <span v-if="i.section_included_in_export === 0" class="ml-1 text-[10px] text-amber-600 italic">(exclue)</span>
              </td>
              <td class="px-3 py-2 whitespace-nowrap cursor-pointer" @click="gotoSection(i.section_id)">
                <span class="inline-flex items-center gap-1.5">
                  <EquipmentIcon v-if="i.template_id" :template="{ icon_kind: i.template_icon_kind, icon_value: i.template_icon_value, icon_color: i.template_icon_color }" size="sm" />
                  <span class="text-gray-700">{{ i.template_name || '—' }}</span>
                </span>
              </td>
              <td class="px-3 py-2 whitespace-nowrap font-medium text-gray-800 cursor-pointer" @click="gotoSection(i.section_id)">{{ i.reference }}</td>
              <td class="px-3 py-2 whitespace-nowrap text-gray-600 cursor-pointer" @click="gotoSection(i.section_id)">{{ i.location || '—' }}</td>
              <td class="px-3 py-2 text-center tabular-nums text-gray-700 cursor-pointer" @click="gotoSection(i.section_id)">{{ i.qty || 1 }}</td>
              <td class="px-3 py-2 text-gray-500 text-xs truncate max-w-xs cursor-pointer" @click="gotoSection(i.section_id)">{{ i.notes || '—' }}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">
                <button @click.stop="duplicateRow(i)" class="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-gray-900" title="Dupliquer">
                  <DocumentDuplicateIcon class="w-4 h-4 inline" />
                </button>
              </td>
            </tr>
            <tr v-if="!processed.length">
              <td :colspan="cols.length + 2" class="px-3 py-8 text-center text-sm text-gray-400 italic">
                {{ search || Object.keys(columnFilters).length ? 'Aucune instance ne correspond aux filtres actuels.' : 'Aucune instance d\'équipement saisie pour cette AF.' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="text-[11px] text-gray-400 mt-3">
        <strong class="text-gray-600">{{ processed.length }}</strong> / {{ instances.length }} instance(s) affichée(s) · cliquer sur une ligne pour aller à sa section.
      </p>
    </template>

    <template #footer>
      <button @click="emit('close')" class="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">Fermer</button>
    </template>
  </BaseModal>
</template>
