<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import Sortable from 'sortablejs'
import {
  MagnifyingGlassIcon, XMarkIcon, PencilIcon, PlusIcon, Bars3Icon,
} from '@heroicons/vue/24/outline'
import {
  listSectionTemplates, reorderSectionTemplates,
} from '@/api'
import BacsBadge from '@/components/BacsBadge.vue'
import ServiceLevelBadge from '@/components/ServiceLevelBadge.vue'
import SectionTemplateEditor from '@/components/SectionTemplateEditor.vue'
import { useNotification } from '@/composables/useNotification'

const { error: notifyError } = useNotification()
const items = ref([])
const search = ref('')
const editing = ref(null)
const showCreate = ref(false)
const tbodyRef = ref(null)
let sortable = null

async function refresh() {
  const { data } = await listSectionTemplates({ kind: 'functionality' })
  items.value = data
}
function openEditor(t) { editing.value = t }
function openCreate() { showCreate.value = true }
async function onSaved() {
  editing.value = null
  showCreate.value = false
  await refresh()
}
async function onDeleted() {
  editing.value = null
  await refresh()
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return items.value
  return items.value.filter(t =>
    (t.title || '').toLowerCase().includes(q) ||
    (t.bacs_articles || '').toLowerCase().includes(q)
  )
})

function setupSortable() {
  if (sortable) { sortable.destroy(); sortable = null }
  if (!tbodyRef.value || search.value.trim()) return
  sortable = Sortable.create(tbodyRef.value, {
    animation: 150,
    handle: '.drag-handle',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    onEnd: async (evt) => {
      if (evt.oldIndex === evt.newIndex) return
      const [moved] = items.value.splice(evt.oldIndex, 1)
      items.value.splice(evt.newIndex, 0, moved)
      try {
        await reorderSectionTemplates(items.value.map(t => t.id))
      } catch {
        notifyError('Échec de la réorganisation')
        refresh()
      }
    },
  })
}

watch([items, search], async () => {
  await nextTick()
  setupSortable()
}, { deep: false })

onMounted(async () => {
  await refresh()
  await nextTick()
  setupSortable()
})
onBeforeUnmount(() => { if (sortable) sortable.destroy() })
</script>

<template>
  <div class="max-w-screen-2xl mx-auto">
    <div class="mb-6 flex items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold text-gray-800">Bibliothèque de fonctionnalités</h1>
        <p class="text-sm text-gray-500 mt-1">
          {{ items.length }} fonctionnalité{{ items.length > 1 ? 's' : '' }} Buildy.
          Glisser-déposer pour réorganiser. Le PDF de synthèse liste ces fonctionnalités dans cet ordre, avec leur niveau de contrat minimum.
        </p>
      </div>
      <button @click="openCreate"
              class="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded">
        <PlusIcon class="w-4 h-4" /> Nouvelle fonctionnalité
      </button>
    </div>

    <div class="relative max-w-md mb-4">
      <MagnifyingGlassIcon class="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
      <input v-model="search" type="text" placeholder="Rechercher (titre, BACS)…"
             autocomplete="off" data-1p-ignore="true" data-bwignore="true" data-lpignore="true"
             class="w-full pl-9 pr-9 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      <button v-if="search" @click="search = ''"
              class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
        <XMarkIcon class="w-4 h-4" />
      </button>
    </div>

    <div class="bg-white border border-gray-200 rounded-none overflow-x-auto">
      <table class="w-full text-sm" style="table-layout: auto">
        <thead class="bg-gray-50 text-xs uppercase text-gray-500 tracking-wider">
          <tr>
            <th class="text-center px-2 py-2.5 w-8"></th>
            <th class="text-left px-4 py-2.5 whitespace-nowrap">Titre</th>
            <th class="text-left px-4 py-2.5 whitespace-nowrap">Niveau</th>
            <th class="text-left px-4 py-2.5 whitespace-nowrap">BACS</th>
            <th class="text-center px-4 py-2.5 whitespace-nowrap">AFs concernées</th>
            <th class="text-center px-4 py-2.5 whitespace-nowrap">Version</th>
            <th class="text-center px-4 py-2.5 whitespace-nowrap"></th>
          </tr>
        </thead>
        <tbody ref="tbodyRef">
          <tr v-for="t in filtered" :key="t.id"
              class="border-t border-gray-100 hover:bg-indigo-50/40 cursor-pointer"
              @click="openEditor(t)">
            <td class="px-2 py-2 text-center align-middle drag-handle cursor-grab text-gray-300 hover:text-gray-500"
                @click.stop>
              <Bars3Icon class="w-4 h-4 inline-block" />
            </td>
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
              {{ search ? `Aucune fonctionnalité ne correspond à « ${search} ».` : 'Aucune fonctionnalité.' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <SectionTemplateEditor
      v-if="editing"
      :template="editing"
      mode="functionality"
      @close="editing = null"
      @saved="onSaved"
      @deleted="onDeleted"
    />

    <SectionTemplateEditor
      v-if="showCreate"
      :template="{}"
      mode="functionality"
      @close="showCreate = false"
      @saved="onSaved"
    />
  </div>
</template>

<style scoped>
.sortable-ghost { opacity: 0.4; background: #eef2ff; }
.sortable-chosen { background: #eef2ff; }
</style>
