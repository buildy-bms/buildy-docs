<script setup>
import { ref, onMounted, watch } from 'vue'
import { PlusCircleIcon, TrashIcon, MapPinIcon } from '@heroicons/vue/24/outline'
import {
  listSectionInstances, addSectionInstance, updateInstance, deleteInstance,
} from '@/api'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  sectionId: { type: Number, required: true },
})

const { error: notifyError } = useNotification()
const instances = ref([])
const loading = ref(false)
const draft = ref({ reference: '', location: '', qty: 1, notes: '' })
const showAdd = ref(false)

async function refresh() {
  loading.value = true
  try {
    const { data } = await listSectionInstances(props.sectionId)
    instances.value = data
  } catch (e) {
    notifyError('Échec du chargement des instances')
  } finally {
    loading.value = false
  }
}

async function submitAdd() {
  if (!draft.value.reference.trim()) return
  try {
    await addSectionInstance(props.sectionId, {
      reference: draft.value.reference.trim(),
      location: draft.value.location?.trim() || undefined,
      qty: draft.value.qty || 1,
      notes: draft.value.notes?.trim() || undefined,
      position: instances.value.length,
    })
    draft.value = { reference: '', location: '', qty: 1, notes: '' }
    showAdd.value = false
    await refresh()
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de l\'ajout')
  }
}

async function removeInstance(inst) {
  if (!confirm(`Supprimer l'instance "${inst.reference}" ?`)) return
  try {
    await deleteInstance(inst.id)
    await refresh()
  } catch {
    notifyError('Échec de la suppression')
  }
}

watch(() => props.sectionId, refresh)
onMounted(refresh)
</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200">
    <div class="flex items-center justify-between px-5 py-3 border-b border-gray-100">
      <div>
        <h3 class="text-sm font-semibold text-gray-700">
          Instances réelles sur le site
          <span class="ml-2 text-xs font-normal text-gray-500">({{ instances.length }})</span>
        </h3>
        <p class="text-xs text-gray-500 mt-0.5">
          Référence et localisation de chaque équipement réel. La liste de points contractuelle
          (PDF A3) sera générée pour chaque instance.
        </p>
      </div>
      <button
        @click="showAdd = !showAdd"
        class="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium flex-shrink-0"
      >
        <PlusCircleIcon class="w-4 h-4" /> Ajouter une instance
      </button>
    </div>

    <!-- Formulaire ajout -->
    <div v-if="showAdd" class="px-5 py-3 bg-gray-50 border-b border-gray-100">
      <form @submit.prevent="submitAdd" class="flex items-center gap-2 flex-wrap">
        <input v-model="draft.reference" type="text" required placeholder="Référence (ex : CTA-N1-EST)"
               class="w-44 px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <input v-model="draft.location" type="text" placeholder="Localisation (ex : Niveau 1 - Aile Est)"
               class="flex-1 min-w-[160px] px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <input v-model.number="draft.qty" type="number" min="1" class="w-16 px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <button type="submit" class="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700">Ajouter</button>
        <button type="button" @click="showAdd = false" class="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-800">Annuler</button>
      </form>
    </div>

    <div v-if="loading" class="text-center py-6 text-sm text-gray-400">Chargement…</div>

    <div v-else-if="!instances.length" class="px-5 py-6 text-center text-xs text-gray-400 italic">
      Aucune instance saisie. Ajoute la première référence d'équipement réelle du site.
    </div>

    <table v-else class="w-full text-sm">
      <thead class="bg-gray-50 text-[11px] text-gray-500 uppercase">
        <tr>
          <th class="text-left px-5 py-2 font-medium">Référence</th>
          <th class="text-left px-2 py-2 font-medium">Localisation</th>
          <th class="text-left px-2 py-2 font-medium w-12">Qté</th>
          <th class="px-5 py-2 w-12"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="inst in instances" :key="inst.id" class="border-t border-gray-100 group">
          <td class="px-5 py-2 font-medium text-gray-800">{{ inst.reference }}</td>
          <td class="px-2 py-2 text-gray-600">
            <span v-if="inst.location" class="inline-flex items-center gap-1">
              <MapPinIcon class="w-3 h-3 text-gray-400" /> {{ inst.location }}
            </span>
            <span v-else class="text-gray-400 italic">—</span>
          </td>
          <td class="px-2 py-2 text-gray-600">{{ inst.qty }}</td>
          <td class="px-5 py-2 text-right">
            <button @click="removeInstance(inst)" class="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700">
              <TrashIcon class="w-3.5 h-3.5 inline" />
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
