<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import { PlusCircleIcon, TrashIcon, MapPinIcon, PencilSquareIcon, BuildingOfficeIcon, TagIcon } from '@heroicons/vue/24/outline'
import {
  listSectionInstances, addSectionInstance, updateInstance, deleteInstance,
  listInstanceZones, setInstanceZones, listAfAllZones,
  listInstanceCategories, setInstanceCategories, listSystemCategories,
  getEquipmentTemplate,
} from '@/api'
import { useNotification } from '@/composables/useNotification'
import BaseModal from '@/components/BaseModal.vue'

const props = defineProps({
  sectionId: { type: Number, required: true },
  afId: { type: Number, required: true },
  templateId: { type: Number, default: null },
})

const { error: notifyError, success: notifySuccess } = useNotification()
const instances = ref([])
const zonesAll = ref([])
const instanceZonesMap = ref(new Map()) // instance_id → [zone, ...]
const instanceCatsMap = ref(new Map()) // instance_id → [catKey, ...]
const allCategories = ref([]) // catalogue complet
const templateSlug = ref(null)
const loading = ref(false)
const draft = ref({ reference: '', location: '', qty: 1, notes: '' })
const showAdd = ref(false)

// Catégories candidates pour ce template
const candidateCategories = computed(() => {
  if (!templateSlug.value || !allCategories.value.length) return []
  return allCategories.value.filter(c => c.slugs.includes(templateSlug.value))
})

// Édition
const editing = ref(null) // instance object or null
const editForm = ref({ reference: '', location: '', qty: 1, notes: '', zone_ids: [], category_keys: [] })

async function refresh() {
  loading.value = true
  try {
    const [instRes, zonesRes, catsRes, tplRes] = await Promise.all([
      listSectionInstances(props.sectionId),
      listAfAllZones(props.afId).catch(() => ({ data: [] })),
      listSystemCategories().catch(() => ({ data: [] })),
      props.templateId ? getEquipmentTemplate(props.templateId).catch(() => ({ data: null })) : Promise.resolve({ data: null }),
    ])
    instances.value = instRes.data
    zonesAll.value = zonesRes.data
    allCategories.value = catsRes.data
    templateSlug.value = tplRes.data?.slug || null
    // Charge les zones et categories liees a chaque instance (en parallele)
    const fetches = await Promise.all(
      instances.value.map(i => Promise.all([
        listInstanceZones(i.id).then(r => r.data).catch(() => []),
        listInstanceCategories(i.id).then(r => r.data).catch(() => []),
      ]).then(([z, c]) => [i.id, { zones: z, cats: c }]))
    )
    instanceZonesMap.value = new Map(fetches.map(([id, v]) => [id, v.zones]))
    instanceCatsMap.value = new Map(fetches.map(([id, v]) => [id, v.cats]))
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

function openEdit(inst) {
  editing.value = inst
  const linkedZones = instanceZonesMap.value.get(inst.id) || []
  const linkedCats = instanceCatsMap.value.get(inst.id) || []
  editForm.value = {
    reference: inst.reference,
    location: inst.location || '',
    qty: inst.qty || 1,
    notes: inst.notes || '',
    zone_ids: linkedZones.map(z => z.id),
    // Si l'instance n'a aucune categorie sauvegardee, on pre-selectionne TOUS
    // les candidats du template (pour preserver le comportement par defaut)
    category_keys: linkedCats.length > 0 ? linkedCats : candidateCategories.value.map(c => c.key),
  }
}

async function submitEdit() {
  if (!editForm.value.reference.trim()) return
  try {
    await updateInstance(editing.value.id, {
      reference: editForm.value.reference.trim(),
      location: editForm.value.location?.trim() || null,
      qty: editForm.value.qty || 1,
      notes: editForm.value.notes?.trim() || null,
    })
    await Promise.all([
      setInstanceZones(editing.value.id, editForm.value.zone_ids),
      setInstanceCategories(editing.value.id, editForm.value.category_keys),
    ])
    notifySuccess('Instance mise à jour')
    editing.value = null
    await refresh()
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de la mise à jour')
  }
}

function toggleZone(zoneId) {
  const i = editForm.value.zone_ids.indexOf(zoneId)
  if (i >= 0) editForm.value.zone_ids.splice(i, 1)
  else editForm.value.zone_ids.push(zoneId)
}

function toggleCategory(key) {
  const i = editForm.value.category_keys.indexOf(key)
  if (i >= 0) editForm.value.category_keys.splice(i, 1)
  else editForm.value.category_keys.push(key)
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
  <div class="bg-white rounded-lg border border-gray-200">
    <div class="flex items-center justify-between px-5 py-3 border-b border-gray-100">
      <div>
        <h3 class="text-sm font-semibold text-gray-700">
          Instances réelles sur le site
          <span class="ml-2 text-xs font-normal text-gray-500">({{ instances.length }})</span>
        </h3>
        <p class="text-xs text-gray-500 mt-0.5">
          Référence et localisation de chaque équipement réel. La liste de points contractuelle
          (PDF A3) sera générée pour chaque instance. Cliquer le crayon pour éditer + lier des zones.
        </p>
      </div>
      <button
        @click="showAdd = !showAdd"
        class="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium shrink-0"
      >
        <PlusCircleIcon class="w-4 h-4" /> Ajouter une instance
      </button>
    </div>

    <div v-if="showAdd" class="px-5 py-3 bg-gray-50 border-b border-gray-100">
      <form @submit.prevent="submitAdd" class="flex items-center gap-2 flex-wrap">
        <input v-model="draft.reference" type="text" required placeholder="Référence (ex : CTA-N1-EST)" autocomplete="off" data-1p-ignore="true"
               class="w-44 px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <input v-model="draft.location" type="text" placeholder="Localisation libre" autocomplete="off" data-1p-ignore="true"
               class="flex-1 min-w-40 px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <input v-model.number="draft.qty" type="number" min="1" class="w-16 px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" />
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
          <th class="text-left px-2 py-2 font-medium">Zones fonctionnelles</th>
          <th class="text-left px-2 py-2 font-medium">Catégories d'usage</th>
          <th class="text-left px-2 py-2 font-medium w-12">Qté</th>
          <th class="px-5 py-2 w-20"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="inst in instances" :key="inst.id" class="border-t border-gray-100 group hover:bg-indigo-50/30">
          <td class="px-5 py-2 font-medium text-gray-800">{{ inst.reference }}</td>
          <td class="px-2 py-2 text-gray-600">
            <span v-if="inst.location" class="inline-flex items-center gap-1">
              <MapPinIcon class="w-3 h-3 text-gray-400" /> {{ inst.location }}
            </span>
            <span v-else class="text-gray-400 italic">—</span>
          </td>
          <td class="px-2 py-2 text-xs">
            <span v-if="(instanceZonesMap.get(inst.id) || []).length" class="flex flex-wrap gap-1">
              <span v-for="z in instanceZonesMap.get(inst.id)" :key="z.id"
                    class="inline-flex items-center gap-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded">
                <BuildingOfficeIcon class="w-3 h-3" /> {{ z.name }}
              </span>
            </span>
            <span v-else class="text-gray-400 italic">—</span>
          </td>
          <td class="px-2 py-2 text-xs">
            <span v-if="(instanceCatsMap.get(inst.id) || []).length" class="flex flex-wrap gap-1">
              <span v-for="key in instanceCatsMap.get(inst.id)" :key="key"
                    class="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded">
                <TagIcon class="w-3 h-3" />
                {{ allCategories.find(c => c.key === key)?.label || key }}
              </span>
            </span>
            <span v-else-if="candidateCategories.length" class="text-amber-600 italic text-[11px]" title="Aucune catégorie choisie — toutes celles du template seront utilisées par défaut">
              tous candidats du template
            </span>
            <span v-else class="text-gray-400 italic">—</span>
          </td>
          <td class="px-2 py-2 text-gray-600">{{ inst.qty }}</td>
          <td class="px-5 py-2 text-right">
            <button @click="openEdit(inst)" class="opacity-0 group-hover:opacity-100 text-indigo-600 hover:text-indigo-800 mr-2" title="Éditer">
              <PencilSquareIcon class="w-3.5 h-3.5 inline" />
            </button>
            <button @click="removeInstance(inst)" class="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700" title="Supprimer">
              <TrashIcon class="w-3.5 h-3.5 inline" />
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <BaseModal v-if="editing" :title="`Éditer l'instance ${editing.reference}`" size="lg" @close="editing = null">
      <form @submit.prevent="submitEdit" class="space-y-3">
        <div class="grid grid-cols-3 gap-3">
          <div class="col-span-2">
            <label class="block text-xs font-medium text-gray-700 mb-1">Référence *</label>
            <input v-model="editForm.reference" type="text" required autocomplete="off" data-1p-ignore="true"
                   class="w-full px-3 py-2 border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">Quantité</label>
            <input v-model.number="editForm.qty" type="number" min="1"
                   class="w-full px-3 py-2 border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Localisation libre</label>
          <input v-model="editForm.location" type="text" autocomplete="off" data-1p-ignore="true"
                 placeholder="Texte libre — utile en complément des zones structurées"
                 class="w-full px-3 py-2 border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div v-if="candidateCategories.length">
          <label class="block text-xs font-medium text-gray-700 mb-1">
            Catégories d'usage ({{ editForm.category_keys.length }} sélectionnée{{ editForm.category_keys.length > 1 ? 's' : '' }})
            <span class="text-gray-400 font-normal ml-1">— ce que cette instance fait réellement (ex : une CTA peut faire ventilation seule, ou ventilation + chauffage)</span>
          </label>
          <div class="grid grid-cols-3 gap-1.5 p-2 bg-gray-50 rounded">
            <label v-for="c in candidateCategories" :key="c.key"
                   :class="['flex items-center gap-2 px-2 py-1.5 text-xs rounded cursor-pointer border',
                            editForm.category_keys.includes(c.key) ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100']">
              <input type="checkbox" :checked="editForm.category_keys.includes(c.key)" @change="toggleCategory(c.key)" class="shrink-0" />
              <TagIcon class="w-3 h-3 shrink-0" />
              <span class="truncate">{{ c.label }}</span>
              <span v-if="c.bacs" class="text-[9px] bg-violet-100 text-violet-700 px-1 rounded ml-auto" :title="c.bacs">⚖️</span>
            </label>
          </div>
        </div>

        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Zones fonctionnelles ({{ editForm.zone_ids.length }} sélectionnée{{ editForm.zone_ids.length > 1 ? 's' : '' }})</label>
          <div v-if="!zonesAll.length" class="text-xs text-gray-400 italic px-2 py-3 bg-gray-50 rounded">
            Aucune zone fonctionnelle définie pour cette AF. Créez d'abord des zones depuis la section « Zones fonctionnelles du bâtiment ».
          </div>
          <div v-else class="grid grid-cols-3 gap-1.5 max-h-48 overflow-y-auto p-2 bg-gray-50 rounded">
            <label v-for="z in zonesAll" :key="z.id"
                   :class="['flex items-center gap-2 px-2 py-1.5 text-xs rounded cursor-pointer border',
                            editForm.zone_ids.includes(z.id) ? 'bg-indigo-100 text-indigo-800 border-indigo-300' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100']">
              <input type="checkbox" :checked="editForm.zone_ids.includes(z.id)" @change="toggleZone(z.id)" class="shrink-0" />
              <BuildingOfficeIcon class="w-3 h-3 shrink-0" />
              <span class="truncate">{{ z.name }}</span>
            </label>
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Notes</label>
          <textarea v-model="editForm.notes" rows="2" autocomplete="off"
                    class="w-full px-3 py-2 border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"></textarea>
        </div>
      </form>
      <template #footer>
        <button @click="editing = null" class="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">Annuler</button>
        <button @click="submitEdit" :disabled="!editForm.reference.trim()"
                class="px-3 py-1.5 text-xs bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
          Enregistrer
        </button>
      </template>
    </BaseModal>
  </div>
</template>
