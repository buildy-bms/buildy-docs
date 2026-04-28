<script setup>
import { ref, computed, onMounted } from 'vue'
import { MagnifyingGlassIcon, XMarkIcon, PencilIcon } from '@heroicons/vue/24/outline'
import { listSectionTemplates } from '@/api'
import BacsBadge from '@/components/BacsBadge.vue'
import ServiceLevelBadge from '@/components/ServiceLevelBadge.vue'
import SectionTemplateEditor from '@/components/SectionTemplateEditor.vue'

const sectionTemplates = ref([])
const sectionTplSearch = ref('')
const editingSectionTpl = ref(null)

async function refresh() {
  const { data } = await listSectionTemplates()
  sectionTemplates.value = data
}
function openEditor(t) { editingSectionTpl.value = t }
async function onSaved() {
  editingSectionTpl.value = null
  await refresh()
}
const filtered = computed(() => {
  const q = sectionTplSearch.value.trim().toLowerCase()
  if (!q) return sectionTemplates.value
  return sectionTemplates.value.filter(t =>
    (t.title || '').toLowerCase().includes(q) ||
    (t.number || '').toLowerCase().includes(q) ||
    (t.bacs_articles || '').toLowerCase().includes(q)
  )
})

onMounted(refresh)
</script>

<template>
  <div class="max-w-screen-2xl mx-auto">
    <div class="mb-6">
      <h1 class="text-2xl font-semibold text-gray-800">Bibliothèque de sections types</h1>
      <p class="text-sm text-gray-500 mt-1">
        {{ sectionTemplates.length }} section{{ sectionTemplates.length > 1 ? 's' : '' }} canonique{{ sectionTemplates.length > 1 ? 's' : '' }}
        du plan AF. Édite le contenu pour qu'il s'applique aux nouvelles AFs et, si tu coches « propager », aux AFs existantes non personnalisées.
      </p>
    </div>

    <div class="relative max-w-md mb-4">
      <MagnifyingGlassIcon class="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
      <input v-model="sectionTplSearch" type="text" placeholder="Rechercher (titre, numéro, BACS)…"
             autocomplete="off" data-1p-ignore="true" data-bwignore="true" data-lpignore="true"
             class="w-full pl-9 pr-9 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      <button v-if="sectionTplSearch" @click="sectionTplSearch = ''"
              class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
        <XMarkIcon class="w-4 h-4" />
      </button>
    </div>

    <div class="bg-white border border-gray-200 rounded-none overflow-x-auto">
      <table class="w-full text-sm" style="table-layout: auto">
        <thead class="bg-gray-50 text-xs uppercase text-gray-500 tracking-wider">
          <tr>
            <th class="text-left px-4 py-2.5 whitespace-nowrap">Numéro</th>
            <th class="text-left px-4 py-2.5 whitespace-nowrap">Titre</th>
            <th class="text-left px-4 py-2.5 whitespace-nowrap">Niveau</th>
            <th class="text-left px-4 py-2.5 whitespace-nowrap">BACS</th>
            <th class="text-center px-4 py-2.5 whitespace-nowrap">AFs concernées</th>
            <th class="text-center px-4 py-2.5 whitespace-nowrap">Version</th>
            <th class="text-center px-4 py-2.5 whitespace-nowrap"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in filtered" :key="t.id"
              class="border-t border-gray-100 hover:bg-indigo-50/40 cursor-pointer"
              @click="openEditor(t)">
            <td class="px-4 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">{{ t.number || '—' }}</td>
            <td class="px-4 py-2 font-medium text-gray-800 whitespace-nowrap">{{ t.title }}</td>
            <td class="px-4 py-2 whitespace-nowrap">
              <ServiceLevelBadge v-if="t.service_level" :level="t.service_level" />
              <span v-else class="text-gray-300 italic text-xs">—</span>
            </td>
            <td class="px-4 py-2 whitespace-nowrap">
              <BacsBadge v-if="t.bacs_articles" :reference="t.bacs_articles" />
              <span v-else class="text-gray-300 italic text-xs">—</span>
            </td>
            <td class="px-4 py-2 text-center text-xs whitespace-nowrap">
              <span v-if="t.outdated_count > 0" class="inline-block px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded">
                {{ t.outdated_count }} en retard / {{ t.affected_afs_count }}
              </span>
              <span v-else class="text-gray-500">{{ t.affected_afs_count || 0 }}</span>
            </td>
            <td class="px-4 py-2 text-center text-[11px] text-gray-400 font-mono whitespace-nowrap">v{{ t.current_version }}</td>
            <td class="px-4 py-2 text-center whitespace-nowrap">
              <PencilIcon class="w-4 h-4 text-gray-400 inline-block" />
            </td>
          </tr>
          <tr v-if="!filtered.length">
            <td colspan="7" class="px-4 py-8 text-center text-sm text-gray-400 italic">
              {{ sectionTplSearch ? `Aucune section type ne correspond à « ${sectionTplSearch} ».` : 'Aucune section type.' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <SectionTemplateEditor
      v-if="editingSectionTpl"
      :template="editingSectionTpl"
      @close="editingSectionTpl = null"
      @saved="onSaved"
    />
  </div>
</template>
