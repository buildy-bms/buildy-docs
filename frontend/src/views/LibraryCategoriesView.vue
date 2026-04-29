<script setup>
import { ref, onMounted } from 'vue'
import { PlusIcon } from '@heroicons/vue/24/outline'
import { listSystemCategories } from '@/api'
import EquipmentIcon from '@/components/EquipmentIcon.vue'
import SystemCategoryEditor from '@/components/SystemCategoryEditor.vue'

const systemCategories = ref([])
const editing = ref(null)
const showEditor = ref(false)

async function refresh() {
  const { data } = await listSystemCategories()
  systemCategories.value = data
}
function openCreate() { editing.value = null; showEditor.value = true }
function openEdit(c) { editing.value = c; showEditor.value = true }
async function onSaved() { showEditor.value = false; editing.value = null; await refresh() }
async function onDeleted() { showEditor.value = false; editing.value = null; await refresh() }

onMounted(refresh)
</script>

<template>
  <div class="max-w-screen-2xl mx-auto">
    <div class="mb-6 flex items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold text-gray-800">Catégories de systèmes</h1>
        <p class="text-sm text-gray-500 mt-1">
          {{ systemCategories.length }} catégorie{{ systemCategories.length > 1 ? 's' : '' }}.
          Utilisées pour la matrice « Zones × Catégories » du tableau de synthèse.
          Chaque instance d'équipement choisit ses catégories d'usage parmi celles dont son template est candidat.
        </p>
      </div>
      <button @click="openCreate"
              class="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg shadow-sm whitespace-nowrap transition">
        <PlusIcon class="w-4 h-4" /> Nouvelle catégorie
      </button>
    </div>

    <div class="bg-white border border-gray-200">
      <table class="w-full text-sm">
        <thead class="bg-gray-50 text-xs uppercase text-gray-500 tracking-wider">
          <tr>
            <th class="text-center px-4 py-2.5 whitespace-nowrap"></th>
            <th class="text-left px-4 py-2.5 whitespace-nowrap">Libellé</th>
            <th class="text-left px-4 py-2.5 whitespace-nowrap">Key</th>
            <th class="text-left px-4 py-2.5 whitespace-nowrap">Article BACS</th>
            <th class="text-left px-4 py-2.5 whitespace-nowrap">Templates candidats</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in systemCategories" :key="c.id"
              class="border-t border-gray-100 hover:bg-indigo-50/40 cursor-pointer"
              @click="openEdit(c)">
            <td class="px-4 py-2 text-center whitespace-nowrap">
              <EquipmentIcon :template="{ icon_kind: 'fa', icon_value: c.icon_value, icon_color: c.icon_color }" size="md" />
            </td>
            <td class="px-4 py-2 font-semibold text-gray-800 whitespace-nowrap">{{ c.label }}</td>
            <td class="px-4 py-2 whitespace-nowrap"><code class="text-[11px] bg-gray-100 px-1.5 py-0.5 rounded">{{ c.key }}</code></td>
            <td class="px-4 py-2 whitespace-nowrap">
              <span v-if="c.bacs" class="inline-block px-2 py-0.5 bg-violet-100 text-violet-700 rounded text-[11px] font-semibold">⚖️ {{ c.bacs }}</span>
              <span v-else class="text-gray-300 italic text-xs">—</span>
            </td>
            <td class="px-4 py-2 text-xs text-gray-600">
              <span v-if="c.slugs.length" class="flex flex-wrap gap-1">
                <span v-for="s in c.slugs" :key="s" class="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-[10px]">{{ s }}</span>
              </span>
              <span v-else class="text-gray-300 italic">aucun</span>
            </td>
          </tr>
          <tr v-if="!systemCategories.length">
            <td colspan="5" class="px-4 py-8 text-center text-sm text-gray-400 italic">
              Aucune catégorie définie. Cliquez « Nouvelle catégorie » pour commencer.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <SystemCategoryEditor
      v-if="showEditor"
      :category="editing"
      @close="showEditor = false"
      @saved="onSaved"
      @deleted="onDeleted"
    />
  </div>
</template>
