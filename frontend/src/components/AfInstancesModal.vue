<script setup>
/**
 * Modale "Toutes les instances d'équipement de l'AF" — vue tableau a plat.
 * Ouverte depuis le header AF (bouton "Instances").
 */
import { ref, onMounted, computed } from 'vue'
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import BaseModal from './BaseModal.vue'
import EquipmentIcon from './EquipmentIcon.vue'

const props = defineProps({
  afId: { type: Number, required: true },
})
const emit = defineEmits(['close', 'goto-section'])

const instances = ref([])
const loading = ref(false)
const search = ref('')

import { listAfInstances } from '@/api'

onMounted(async () => {
  loading.value = true
  try {
    const { data } = await listAfInstances(props.afId)
    instances.value = data
  } finally {
    loading.value = false
  }
})

function normalize(s) { return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') }

const filtered = computed(() => {
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

// Comptage par template
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

      <!-- Recherche -->
      <div class="relative max-w-md mb-3">
        <MagnifyingGlassIcon class="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input v-model="search" type="text" placeholder="Rechercher (repère, localisation, équipement, section)…" autocomplete="off"
               data-1p-ignore="true" data-bwignore="true" data-lpignore="true"
               class="w-full pl-9 pr-9 py-2 border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <button v-if="search" @click="search = ''" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
          <XMarkIcon class="w-4 h-4" />
        </button>
      </div>

      <!-- Tableau -->
      <div class="bg-white border border-gray-200 overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 text-xs uppercase text-gray-500 tracking-wider">
            <tr>
              <th class="text-left px-3 py-2 whitespace-nowrap">Section</th>
              <th class="text-left px-3 py-2 whitespace-nowrap">Équipement</th>
              <th class="text-left px-3 py-2 whitespace-nowrap">Repère</th>
              <th class="text-left px-3 py-2 whitespace-nowrap">Localisation</th>
              <th class="text-center px-3 py-2 whitespace-nowrap">Qté</th>
              <th class="text-left px-3 py-2 whitespace-nowrap">Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in filtered" :key="i.id"
                class="border-t border-gray-100 hover:bg-indigo-50/40 cursor-pointer"
                @click="gotoSection(i.section_id)">
              <td class="px-3 py-2 whitespace-nowrap">
                <span class="font-mono text-[11px] text-gray-500">{{ i.section_number || '—' }}</span>
                <span class="ml-1 text-xs text-gray-700">{{ i.section_title }}</span>
                <span v-if="i.section_included_in_export === 0" class="ml-1 text-[10px] text-amber-600 italic">(exclue)</span>
              </td>
              <td class="px-3 py-2 whitespace-nowrap">
                <span class="inline-flex items-center gap-1.5">
                  <EquipmentIcon v-if="i.template_id" :template="{ icon_kind: i.template_icon_kind, icon_value: i.template_icon_value, icon_color: i.template_icon_color }" size="sm" />
                  <span class="text-gray-700">{{ i.template_name || '—' }}</span>
                </span>
              </td>
              <td class="px-3 py-2 whitespace-nowrap font-medium text-gray-800">{{ i.reference }}</td>
              <td class="px-3 py-2 whitespace-nowrap text-gray-600">{{ i.location || '—' }}</td>
              <td class="px-3 py-2 text-center tabular-nums text-gray-700">{{ i.qty || 1 }}</td>
              <td class="px-3 py-2 text-gray-500 text-xs truncate max-w-xs">{{ i.notes || '—' }}</td>
            </tr>
            <tr v-if="!filtered.length">
              <td colspan="6" class="px-3 py-8 text-center text-sm text-gray-400 italic">
                {{ search ? `Aucune instance ne correspond à « ${search} ».` : 'Aucune instance d\'équipement saisie pour cette AF.' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="text-[11px] text-gray-400 mt-3">
        Total : <strong class="text-gray-600">{{ instances.length }}</strong> instance(s) sur l'AF · cliquer sur une ligne pour aller à sa section.
      </p>
    </template>

    <template #footer>
      <button @click="emit('close')" class="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">Fermer</button>
    </template>
  </BaseModal>
</template>
