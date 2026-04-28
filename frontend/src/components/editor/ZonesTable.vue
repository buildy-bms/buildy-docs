<script setup>
import { ref, onMounted, watch } from 'vue'
import { PlusCircleIcon, TrashIcon, BuildingOfficeIcon, PencilSquareIcon } from '@heroicons/vue/24/outline'
import api, { getAfZonesMatrix } from '@/api'
import { useNotification } from '@/composables/useNotification'
import BaseModal from '@/components/BaseModal.vue'

const props = defineProps({
  sectionId: { type: Number, required: true },
  afId: { type: Number, required: true },
})

const matrix = ref(null) // { categories, zones, unzoned, totalsByCategory }
async function refreshMatrix() {
  try { const { data } = await getAfZonesMatrix(props.afId); matrix.value = data }
  catch { matrix.value = null }
}
const { error: notifyError, success: notifySuccess } = useNotification()

const zones = ref([])
const loading = ref(false)
const showAdd = ref(false)
const draft = ref(emptyDraft())

const editing = ref(null)
const editForm = ref(emptyDraft())

const OCCUPATION_TYPES = ['Bureaux', 'Logistique', 'Atelier', 'Locaux techniques', 'Circulation', 'Parking', 'Salle serveur', 'Sanitaires', 'Restauration', 'Réunion', 'Extérieur', 'Autre']

function emptyDraft() {
  return { name: '', surface_m2: null, occupation_type: '', occupation_max_personnes: null, horaires: '', qai_contraintes: '', notes: '' }
}

async function refresh() {
  loading.value = true
  try {
    const { data } = await api.get(`/sections/${props.sectionId}/zones`)
    zones.value = data
  } catch { zones.value = [] }
  finally { loading.value = false }
  await refreshMatrix()
}

function buildPayload(form) {
  return {
    ...form,
    surface_m2: form.surface_m2 ? Number(form.surface_m2) : null,
    occupation_max_personnes: form.occupation_max_personnes ? Number(form.occupation_max_personnes) : null,
  }
}

async function submitAdd() {
  if (!draft.value.name.trim()) return
  try {
    const maxPos = Math.max(0, ...zones.value.map(z => z.position || 0))
    await api.post(`/sections/${props.sectionId}/zones`, { ...buildPayload(draft.value), position: maxPos + 10 })
    draft.value = emptyDraft()
    showAdd.value = false
    await refresh()
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de l\'ajout')
  }
}

function openEdit(z) {
  editing.value = z
  editForm.value = {
    name: z.name || '',
    surface_m2: z.surface_m2 || null,
    occupation_type: z.occupation_type || '',
    occupation_max_personnes: z.occupation_max_personnes || null,
    horaires: z.horaires || '',
    qai_contraintes: z.qai_contraintes || '',
    notes: z.notes || '',
  }
}

async function submitEdit() {
  if (!editForm.value.name.trim()) return
  try {
    await api.patch(`/zones/${editing.value.id}`, buildPayload(editForm.value))
    notifySuccess('Zone mise à jour')
    editing.value = null
    await refresh()
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de la mise à jour')
  }
}

async function deleteZone(zone) {
  if (!confirm(`Supprimer la zone "${zone.name}" ?\nLes liens avec les instances d'équipements seront aussi supprimés.`)) return
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
          <th class="px-4 py-2 w-20"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="z in zones" :key="z.id" class="border-t border-gray-100 group hover:bg-indigo-50/30">
          <td class="px-4 py-2 font-semibold text-gray-800">{{ z.name }}</td>
          <td class="px-4 py-2 text-right font-variant-numeric tabular-nums text-gray-600">{{ z.surface_m2 ? `${z.surface_m2} m²` : '—' }}</td>
          <td class="px-4 py-2 text-gray-600">{{ z.occupation_type || '—' }}</td>
          <td class="px-4 py-2 text-right text-gray-600">{{ z.occupation_max_personnes || '—' }}</td>
          <td class="px-4 py-2 text-gray-600">{{ z.horaires || '—' }}</td>
          <td class="px-4 py-2 text-gray-500">{{ z.qai_contraintes || z.notes || '—' }}</td>
          <td class="px-4 py-2 text-right whitespace-nowrap">
            <button @click="openEdit(z)" class="opacity-0 group-hover:opacity-100 text-indigo-600 hover:text-indigo-800 mr-2" title="Éditer">
              <PencilSquareIcon class="w-3.5 h-3.5" />
            </button>
            <button @click="deleteZone(z)" class="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700" title="Supprimer">
              <TrashIcon class="w-3.5 h-3.5" />
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Synthèse zones × catégories de systèmes (live) -->
    <div v-if="matrix && matrix.categories.length" class="mt-6 border-t border-gray-100 pt-4">
      <div class="px-5 mb-3">
        <h3 class="text-sm font-semibold text-gray-700">
          Répartition des instances par zone et par catégorie
        </h3>
        <p class="text-xs text-gray-500 mt-0.5">
          Mis à jour à chaque ajout d'instance ou modification de lien instance↔zone.
          Seules les catégories ayant au moins une instance dans le projet sont affichées.
        </p>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead class="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
            <tr>
              <th class="text-left px-4 py-2 font-medium sticky left-0 bg-gray-50">Zone</th>
              <th v-for="c in matrix.categories" :key="c.key" class="text-center px-3 py-2 font-medium whitespace-nowrap">
                <div class="font-semibold text-gray-700">{{ c.label }}</div>
                <div class="mt-0.5">
                  <span v-if="c.bacs" class="inline-block px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded text-[9px] font-bold normal-case tracking-normal">⚖️ BACS</span>
                  <span v-else class="text-gray-300 text-[9px]">—</span>
                </div>
              </th>
              <th class="text-center px-3 py-2 font-medium bg-emerald-50 text-emerald-700 whitespace-nowrap">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in matrix.zones" :key="row.id" class="border-t border-gray-100 hover:bg-emerald-50/30">
              <td class="px-4 py-2 font-semibold text-gray-800 sticky left-0 bg-white">{{ row.name }}</td>
              <td v-for="(n, i) in row.cells" :key="i" class="text-center px-3 py-2 tabular-nums">
                <span v-if="n" class="text-emerald-700 font-bold">{{ n }}</span>
                <span v-else class="text-gray-300">—</span>
              </td>
              <td class="text-center px-3 py-2 bg-emerald-50/50 text-emerald-800 font-bold tabular-nums">{{ row.total }}</td>
            </tr>
            <tr v-if="matrix.unzoned.total > 0" class="border-t border-amber-200 bg-amber-50">
              <td class="px-4 py-2 font-medium text-amber-900 sticky left-0 bg-amber-50 italic">Instances sans zone</td>
              <td v-for="(n, i) in matrix.unzoned.cells" :key="i" class="text-center px-3 py-2 tabular-nums">
                <span v-if="n" class="text-amber-800 font-semibold">{{ n }}</span>
                <span v-else class="text-amber-300">—</span>
              </td>
              <td class="text-center px-3 py-2 bg-amber-100 text-amber-900 font-bold tabular-nums">{{ matrix.unzoned.total }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="border-t-2 border-gray-300 bg-gray-100">
              <td class="px-4 py-2 font-bold text-gray-900 sticky left-0 bg-gray-100">Total catégorie</td>
              <td v-for="(n, i) in matrix.totalsByCategory" :key="i" class="text-center px-3 py-2 font-bold text-gray-900 tabular-nums">{{ n }}</td>
              <td class="text-center px-3 py-2 bg-emerald-100 text-emerald-900 font-bold tabular-nums">
                {{ matrix.totalsByCategory.reduce((a, b) => a + b, 0) }}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p v-if="matrix.unzoned.total > 0" class="text-[11px] text-amber-700 italic px-5 mt-2">
        ⚠ {{ matrix.unzoned.total }} instance{{ matrix.unzoned.total > 1 ? 's' : '' }} non encore rattachée{{ matrix.unzoned.total > 1 ? 's' : '' }} à une zone fonctionnelle. Édite chaque instance d'équipement pour la rattacher.
      </p>
    </div>

    <BaseModal v-if="editing" :title="`Éditer la zone « ${editing.name} »`" size="lg" @close="editing = null">
      <form @submit.prevent="submitEdit" class="grid grid-cols-2 gap-3">
        <div class="col-span-2">
          <label class="block text-xs font-medium text-gray-700 mb-1">Nom *</label>
          <input v-model="editForm.name" type="text" required autocomplete="off" data-1p-ignore="true"
                 class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Surface (m²)</label>
          <input v-model.number="editForm.surface_m2" type="number" min="0" step="1"
                 class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Type d'occupation</label>
          <select v-model="editForm.occupation_type" class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">—</option>
            <option v-for="t in OCCUPATION_TYPES" :key="t">{{ t }}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Personnes max</label>
          <input v-model.number="editForm.occupation_max_personnes" type="number" min="0"
                 class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Horaires</label>
          <input v-model="editForm.horaires" type="text" placeholder="ex : 8h-19h semaine"
                 class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div class="col-span-2">
          <label class="block text-xs font-medium text-gray-700 mb-1">Contraintes QAI / confort</label>
          <input v-model="editForm.qai_contraintes" type="text"
                 class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div class="col-span-2">
          <label class="block text-xs font-medium text-gray-700 mb-1">Notes</label>
          <textarea v-model="editForm.notes" rows="2"
                    class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
        </div>
      </form>
      <template #footer>
        <button @click="editing = null" class="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">Annuler</button>
        <button @click="submitEdit" :disabled="!editForm.name.trim()"
                class="px-3 py-1.5 text-xs bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
          Enregistrer
        </button>
      </template>
    </BaseModal>
  </div>
</template>
