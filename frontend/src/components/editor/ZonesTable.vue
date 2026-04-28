<script setup>
import { ref, onMounted, watch } from 'vue'
import { PlusCircleIcon, TrashIcon, BuildingOfficeIcon } from '@heroicons/vue/24/outline'
import api from '@/api'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  sectionId: { type: Number, required: true },
})
const { error: notifyError } = useNotification()

const zones = ref([])
const loading = ref(false)
const showAdd = ref(false)
const draft = ref({ name: '', surface_m2: null, occupation_type: '', occupation_max_personnes: null, horaires: '', qai_contraintes: '', notes: '' })

const OCCUPATION_TYPES = ['Bureaux', 'Logistique', 'Atelier', 'Locaux techniques', 'Circulation', 'Parking', 'Salle serveur', 'Sanitaires', 'Restauration', 'Réunion', 'Extérieur', 'Autre']

async function refresh() {
  loading.value = true
  try {
    const { data } = await api.get(`/sections/${props.sectionId}/zones`)
    zones.value = data
  } catch { zones.value = [] }
  finally { loading.value = false }
}

async function submitAdd() {
  if (!draft.value.name.trim()) return
  try {
    const maxPos = Math.max(0, ...zones.value.map(z => z.position || 0))
    await api.post(`/sections/${props.sectionId}/zones`, {
      ...draft.value,
      position: maxPos + 10,
      surface_m2: draft.value.surface_m2 ? Number(draft.value.surface_m2) : null,
      occupation_max_personnes: draft.value.occupation_max_personnes ? Number(draft.value.occupation_max_personnes) : null,
    })
    draft.value = { name: '', surface_m2: null, occupation_type: '', occupation_max_personnes: null, horaires: '', qai_contraintes: '', notes: '' }
    showAdd.value = false
    await refresh()
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de l\'ajout')
  }
}

async function deleteZone(zone) {
  if (!confirm(`Supprimer la zone "${zone.name}" ?`)) return
  try { await api.delete(`/zones/${zone.id}`); await refresh() }
  catch (e) { notifyError('Échec suppression') }
}

watch(() => props.sectionId, refresh)
onMounted(refresh)
</script>

<template>
  <div class="bg-white rounded-none border border-gray-200">
    <div class="flex items-center justify-between px-5 py-3 border-b border-gray-100">
      <h3 class="text-sm font-semibold text-gray-700 inline-flex items-center gap-1.5">
        <BuildingOfficeIcon class="w-4 h-4 text-gray-500" />
        Zones fonctionnelles ({{ zones.length }})
      </h3>
      <button @click="showAdd = !showAdd" class="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium">
        <PlusCircleIcon class="w-4 h-4" /> Ajouter une zone
      </button>
    </div>

    <div v-if="showAdd" class="px-5 py-3 bg-gray-50 border-b border-gray-100 grid grid-cols-2 gap-2">
      <input v-model="draft.name" type="text" required placeholder="Nom de la zone (ex : Open-space N1 Est)" autocomplete="off" data-1p-ignore="true"
             class="col-span-2 px-2 py-1.5 border border-gray-300 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      <input v-model.number="draft.surface_m2" type="number" min="0" step="1" placeholder="Surface m²" autocomplete="off"
             class="px-2 py-1.5 border border-gray-300 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      <select v-model="draft.occupation_type" class="px-2 py-1.5 border border-gray-300 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500">
        <option value="">Type d'occupation…</option>
        <option v-for="t in OCCUPATION_TYPES" :key="t">{{ t }}</option>
      </select>
      <input v-model.number="draft.occupation_max_personnes" type="number" min="0" placeholder="Personnes max" autocomplete="off"
             class="px-2 py-1.5 border border-gray-300 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      <input v-model="draft.horaires" type="text" placeholder="Horaires (ex : 8h-19h sem.)" autocomplete="off"
             class="px-2 py-1.5 border border-gray-300 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      <input v-model="draft.qai_contraintes" type="text" placeholder="Contraintes QAI / confort" autocomplete="off"
             class="col-span-2 px-2 py-1.5 border border-gray-300 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      <input v-model="draft.notes" type="text" placeholder="Notes" autocomplete="off"
             class="col-span-2 px-2 py-1.5 border border-gray-300 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      <div class="col-span-2 flex items-center gap-2">
        <button @click="submitAdd" :disabled="!draft.name.trim()" class="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 disabled:opacity-50">Ajouter la zone</button>
        <button @click="showAdd = false" class="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-800">Annuler</button>
      </div>
    </div>

    <div v-if="loading" class="text-center py-6 text-sm text-gray-400">Chargement…</div>
    <div v-else-if="!zones.length" class="text-center py-8 text-sm text-gray-400 italic">
      Aucune zone définie. Cliquez « Ajouter une zone » pour commencer.
    </div>

    <table v-else class="w-full text-xs">
      <thead class="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
        <tr>
          <th class="text-left px-4 py-2 font-medium">Zone</th>
          <th class="text-right px-4 py-2 font-medium w-20">Surface</th>
          <th class="text-left px-4 py-2 font-medium w-32">Type</th>
          <th class="text-right px-4 py-2 font-medium w-20">Pers. max</th>
          <th class="text-left px-4 py-2 font-medium w-32">Horaires</th>
          <th class="text-left px-4 py-2 font-medium">Contraintes</th>
          <th class="px-4 py-2 w-12"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="z in zones" :key="z.id" class="border-t border-gray-100 group hover:bg-gray-50">
          <td class="px-4 py-2 font-semibold text-gray-800">{{ z.name }}</td>
          <td class="px-4 py-2 text-right font-variant-numeric tabular-nums text-gray-600">{{ z.surface_m2 ? `${z.surface_m2} m²` : '—' }}</td>
          <td class="px-4 py-2 text-gray-600">{{ z.occupation_type || '—' }}</td>
          <td class="px-4 py-2 text-right text-gray-600">{{ z.occupation_max_personnes || '—' }}</td>
          <td class="px-4 py-2 text-gray-600">{{ z.horaires || '—' }}</td>
          <td class="px-4 py-2 text-gray-500">{{ z.qai_contraintes || z.notes || '—' }}</td>
          <td class="px-4 py-2 text-right">
            <button @click="deleteZone(z)" class="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700">
              <TrashIcon class="w-3.5 h-3.5" />
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
