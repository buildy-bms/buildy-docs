<script setup>
import { ref, onMounted, watch } from 'vue'
import { PlusCircleIcon, TrashIcon, BuildingOfficeIcon, PencilSquareIcon } from '@heroicons/vue/24/outline'
import api, { getAfZonesMatrix } from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import BaseModal from '@/components/BaseModal.vue'
import Tooltip from '@/components/Tooltip.vue'

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
const { confirm } = useConfirm()

const zones = ref([])
const loading = ref(false)
const showAdd = ref(false)
const draft = ref(emptyDraft())

const editing = ref(null)
const editForm = ref(emptyDraft())

const OCCUPATION_TYPES = ['Bureaux', 'Logistique', 'Atelier', 'Locaux techniques', 'Circulation', 'Parking', 'Salle serveur', 'Sanitaires', 'Restauration', 'Réunion', 'Extérieur', 'Autre']

function emptyDraft() {
  return { name: '', surface_m2: null, occupation_type: '' }
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
    name: form.name,
    surface_m2: form.surface_m2 ? Number(form.surface_m2) : null,
    occupation_type: form.occupation_type || null,
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
  const ok = await confirm({
    title: 'Supprimer la zone ?',
    message: `« ${zone.name} »\n\nLes liens avec les instances d'équipements seront aussi supprimés.`,
    confirmLabel: 'Supprimer',
    danger: true,
  })
  if (!ok) return
  try { await api.delete(`/zones/${zone.id}`); await refresh() }
  catch (e) { notifyError('Échec suppression') }
}

watch(() => props.sectionId, refresh)
onMounted(refresh)
</script>

<template>
  <div class="space-y-5">
    <!-- Bloc 1 : liste des zones -->
    <div class="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div class="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50/50">
        <h3 class="text-sm font-semibold text-gray-700 inline-flex items-center gap-2">
          <BuildingOfficeIcon class="w-4 h-4 text-indigo-500" />
          Zones fonctionnelles
          <span class="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[11px] font-medium">{{ zones.length }}</span>
        </h3>
        <button
          v-if="!showAdd"
          @click="showAdd = true"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors"
        >
          <PlusCircleIcon class="w-4 h-4" /> Ajouter une zone
        </button>
      </div>

      <!-- Formulaire d'ajout inline -->
      <div v-if="showAdd" class="px-5 py-4 bg-indigo-50/40 border-b border-indigo-100">
        <div class="flex items-end gap-3 flex-wrap">
          <div class="flex-1 min-w-60">
            <label class="block text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1">Nom de la zone *</label>
            <input
              v-model="draft.name"
              type="text"
              required
              placeholder="ex : Open-space N1 Est"
              autocomplete="off"
              data-1p-ignore="true"
              class="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"
              @keyup.enter="submitAdd"
            />
          </div>
          <div class="w-28">
            <label class="block text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1">Surface m²</label>
            <input
              v-model.number="draft.surface_m2"
              type="number"
              min="0"
              step="1"
              placeholder="—"
              autocomplete="off"
              class="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"
            />
          </div>
          <div class="w-48">
            <label class="block text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1">Type d'occupation</label>
            <select
              v-model="draft.occupation_type"
              class="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"
            >
              <option value="">—</option>
              <option v-for="t in OCCUPATION_TYPES" :key="t">{{ t }}</option>
            </select>
          </div>
          <button
            @click="submitAdd"
            :disabled="!draft.name.trim()"
            class="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            Ajouter
          </button>
          <button
            @click="showAdd = false; draft = emptyDraft()"
            class="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            Annuler
          </button>
        </div>
      </div>

      <div v-if="loading" class="text-center py-8 text-sm text-gray-400">Chargement…</div>
      <div v-else-if="!zones.length && !showAdd" class="px-5 py-10 text-center">
        <div class="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center mx-auto mb-3">
          <BuildingOfficeIcon class="w-6 h-6 text-indigo-500" />
        </div>
        <p class="text-sm font-medium text-gray-700">Aucune zone fonctionnelle définie</p>
        <p class="text-xs text-gray-500 mt-1 max-w-md mx-auto">
          Découpe le bâtiment en zones (open-space, locaux techniques, parking…) pour
          relier ensuite chaque équipement à la zone qu'il dessert.
        </p>
        <button
          @click="showAdd = true"
          class="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors"
        >
          <PlusCircleIcon class="w-4 h-4" /> Définir la première zone
        </button>
      </div>

      <table v-else-if="zones.length" class="w-full text-sm">
        <thead class="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
          <tr>
            <th class="text-left px-5 py-2 font-semibold">Zone</th>
            <th class="text-right px-4 py-2 font-semibold w-28">Surface</th>
            <th class="text-left px-4 py-2 font-semibold w-52">Type d'occupation</th>
            <th class="px-4 py-2 w-24"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="z in zones" :key="z.id" class="border-t border-gray-100 group hover:bg-indigo-50/40 transition-colors">
            <td class="px-5 py-2.5 font-semibold text-gray-800">{{ z.name }}</td>
            <td class="px-4 py-2.5 text-right tabular-nums text-gray-600">
              <span v-if="z.surface_m2">{{ z.surface_m2 }} <span class="text-gray-400">m²</span></span>
              <span v-else class="text-gray-300">—</span>
            </td>
            <td class="px-4 py-2.5 text-gray-600">{{ z.occupation_type || '—' }}</td>
            <td class="px-4 py-2.5 text-right whitespace-nowrap">
              <Tooltip text="Éditer la zone">
                <button @click="openEdit(z)" class="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-indigo-100 text-indigo-600 transition-opacity">
                  <PencilSquareIcon class="w-3.5 h-3.5" />
                </button>
              </Tooltip>
              <Tooltip text="Supprimer la zone">
                <button @click="deleteZone(z)" class="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-100 text-red-500 transition-opacity ml-1">
                  <TrashIcon class="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Bloc 2 : Synthèse zones × catégories de systèmes (live) -->
    <div v-if="matrix && matrix.categories.length" class="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div class="px-5 py-3 border-b border-gray-100 bg-gray-50/50">
        <h3 class="text-sm font-semibold text-gray-700 inline-flex items-center gap-2">
          <BuildingOfficeIcon class="w-4 h-4 text-emerald-500" />
          Répartition des instances par zone et par catégorie
        </h3>
        <p class="text-xs text-gray-500 mt-1 leading-relaxed">
          Mise à jour à chaque ajout d'instance ou modification de lien instance ↔ zone.
          Seules les catégories ayant au moins une instance dans le projet sont affichées.
        </p>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead class="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
            <tr>
              <th class="text-left px-5 py-2.5 font-semibold sticky left-0 bg-gray-50 border-r border-gray-100">Zone</th>
              <th v-for="c in matrix.categories" :key="c.key" class="text-center px-3 py-2 font-semibold whitespace-nowrap">
                <div class="text-gray-700">{{ c.label }}</div>
                <div class="mt-1">
                  <span v-if="c.bacs" class="inline-block px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded text-[9px] font-bold normal-case tracking-normal">BACS</span>
                </div>
              </th>
              <th class="text-center px-4 py-2.5 font-semibold bg-emerald-50 text-emerald-700 whitespace-nowrap border-l border-emerald-100">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in matrix.zones" :key="row.id" class="border-t border-gray-100 hover:bg-emerald-50/30 transition-colors">
              <td class="px-5 py-2.5 font-semibold text-gray-800 sticky left-0 bg-white border-r border-gray-100">{{ row.name }}</td>
              <td v-for="(n, i) in row.cells" :key="i" class="text-center px-3 py-2.5 tabular-nums">
                <span v-if="n" class="inline-flex items-center justify-center min-w-6 px-1.5 py-0.5 bg-emerald-50 text-emerald-700 font-bold rounded">{{ n }}</span>
                <span v-else class="text-gray-300">—</span>
              </td>
              <td class="text-center px-4 py-2.5 bg-emerald-50/50 text-emerald-800 font-bold tabular-nums border-l border-emerald-100">{{ row.total }}</td>
            </tr>
            <tr v-if="matrix.unzoned.total > 0" class="border-t border-amber-200 bg-amber-50">
              <td class="px-5 py-2.5 font-medium text-amber-900 sticky left-0 bg-amber-50 italic border-r border-amber-200">
                Instances sans zone
              </td>
              <td v-for="(n, i) in matrix.unzoned.cells" :key="i" class="text-center px-3 py-2.5 tabular-nums">
                <span v-if="n" class="inline-flex items-center justify-center min-w-6 px-1.5 py-0.5 bg-amber-100 text-amber-800 font-bold rounded">{{ n }}</span>
                <span v-else class="text-amber-300">—</span>
              </td>
              <td class="text-center px-4 py-2.5 bg-amber-100 text-amber-900 font-bold tabular-nums border-l border-amber-200">{{ matrix.unzoned.total }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="border-t-2 border-gray-200 bg-gray-50">
              <td class="px-5 py-2.5 font-bold text-gray-900 sticky left-0 bg-gray-50 border-r border-gray-200">Total catégorie</td>
              <td v-for="(n, i) in matrix.totalsByCategory" :key="i" class="text-center px-3 py-2.5 font-bold text-gray-900 tabular-nums">{{ n }}</td>
              <td class="text-center px-4 py-2.5 bg-emerald-100 text-emerald-900 font-bold tabular-nums border-l border-emerald-200">
                {{ matrix.totalsByCategory.reduce((a, b) => a + b, 0) }}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p v-if="matrix.unzoned.total > 0" class="px-5 py-3 text-xs text-amber-700 bg-amber-50/50 border-t border-amber-100 leading-relaxed">
        ⚠ {{ matrix.unzoned.total }} instance{{ matrix.unzoned.total > 1 ? 's' : '' }} non encore rattachée{{ matrix.unzoned.total > 1 ? 's' : '' }}.
        Édite chaque instance d'équipement (page Périmètre des équipements) pour la rattacher à une zone.
      </p>
    </div>

    <BaseModal v-if="editing" :title="`Éditer la zone « ${editing.name} »`" size="lg" @close="editing = null">
      <form @submit.prevent="submitEdit" class="grid grid-cols-2 gap-4 min-w-md">
        <div class="col-span-2">
          <label class="block text-xs font-medium text-gray-700 mb-1">Nom *</label>
          <input
            v-model="editForm.name"
            type="text"
            required
            autocomplete="off"
            data-1p-ignore="true"
            class="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Surface (m²)</label>
          <input
            v-model.number="editForm.surface_m2"
            type="number"
            min="0"
            step="1"
            class="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Type d'occupation</label>
          <select
            v-model="editForm.occupation_type"
            class="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"
          >
            <option value="">—</option>
            <option v-for="t in OCCUPATION_TYPES" :key="t">{{ t }}</option>
          </select>
        </div>
      </form>
      <template #footer>
        <button @click="editing = null" class="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900">Annuler</button>
        <button
          @click="submitEdit"
          :disabled="!editForm.name.trim()"
          class="px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          Enregistrer
        </button>
      </template>
    </BaseModal>
  </div>
</template>
