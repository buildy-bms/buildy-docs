<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import { PlusCircleIcon, TrashIcon, MapPinIcon, PencilSquareIcon, BuildingOfficeIcon, TagIcon, DocumentDuplicateIcon, ArrowsUpDownIcon, ArrowUpIcon, ArrowDownIcon } from '@heroicons/vue/24/outline'
import {
  listSectionInstances, addSectionInstance, updateInstance, deleteInstance,
  duplicateInstance,
  listInstanceZones, setInstanceZones, listAfAllZones,
  listInstanceCategories, setInstanceCategories, listSystemCategories,
  getEquipmentTemplate,
} from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import { useTableSortFilter } from '@/composables/useTableSortFilter'
import BaseModal from '@/components/BaseModal.vue'

const props = defineProps({
  sectionId: { type: Number, required: true },
  afId: { type: Number, required: true },
  templateId: { type: Number, default: null },
})

const { error: notifyError, success: notifySuccess } = useNotification()
const { confirm } = useConfirm()
const instances = ref([])
const zonesAll = ref([])
const instanceZonesMap = ref(new Map()) // instance_id → [zone, ...]
const instanceCatsMap = ref(new Map()) // instance_id → [catKey, ...]
const allCategories = ref([]) // catalogue complet
const templateSlug = ref(null)
const loading = ref(false)

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

// Ouvre la modale d'edition en mode CREATION (instance vide avec defaults).
// Au submit, l'instance est creee + ses zones/categories liees en cascade.
function openCreate() {
  editing.value = { id: null, _isCreating: true } // sentinel pour distinguer create/edit
  editForm.value = {
    reference: '',
    location: '',
    qty: 1,
    notes: '',
    zone_ids: [],
    // Pre-selectionne par defaut TOUS les candidats du template (comportement
    // existant pour les nouvelles instances : 1 instance = toutes les usages).
    category_keys: candidateCategories.value.map(c => c.key),
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
    let instanceId = editing.value.id
    // Mode creation : on cree l'instance d'abord, puis on lie zones/categories.
    if (editing.value._isCreating) {
      const { data } = await addSectionInstance(props.sectionId, {
        reference: editForm.value.reference.trim(),
        location: editForm.value.location?.trim() || undefined,
        qty: editForm.value.qty || 1,
        notes: editForm.value.notes?.trim() || undefined,
        position: instances.value.length,
      })
      instanceId = data.id
    } else {
      await updateInstance(instanceId, {
        reference: editForm.value.reference.trim(),
        location: editForm.value.location?.trim() || null,
        qty: editForm.value.qty || 1,
        notes: editForm.value.notes?.trim() || null,
      })
    }
    await Promise.all([
      setInstanceZones(instanceId, editForm.value.zone_ids),
      setInstanceCategories(instanceId, editForm.value.category_keys),
    ])
    notifySuccess(editing.value._isCreating ? 'Instance créée' : 'Instance mise à jour')
    editing.value = null
    await refresh()
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de l\'enregistrement')
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
  const ok = await confirm({ title: 'Supprimer l\'instance ?', message: `« ${inst.reference} »`, confirmLabel: 'Supprimer', danger: true })
  if (!ok) return
  try {
    await deleteInstance(inst.id)
    await refresh()
  } catch {
    notifyError('Échec de la suppression')
  }
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

const { sortKey, sortDir, columnFilters, processed: visibleInstances, toggleSort, setFilter } =
  useTableSortFilter(instances, { defaultSortKey: null })

watch(() => props.sectionId, refresh)
onMounted(refresh)

// ── Bulk ─────────────────────────────────────────────────────────────
import { useBulkSelection } from '@/composables/useBulkSelection'
import BulkActionBar from '@/components/BulkActionBar.vue'

const visibleIds = computed(() => visibleInstances.value.map(i => i.id))
const sel = useBulkSelection(() => visibleIds.value)
const bulkBusy = ref(false)

async function bulkDelete() {
  if (!sel.size.value) return
  const ok = await confirm({
    title: `Supprimer ${sel.size.value} instance${sel.size.value > 1 ? 's' : ''} ?`,
    message: 'Cette action est irréversible.',
    confirmLabel: 'Supprimer',
    danger: true,
  })
  if (!ok) return
  bulkBusy.value = true
  try {
    await Promise.all([...sel.selected.value].map(id => deleteInstance(id).catch(() => null)))
    sel.clear()
    await refresh()
    notifySuccess('Instances supprimées')
  } catch { notifyError('Échec de la suppression en masse') }
  finally { bulkBusy.value = false }
}
async function bulkDuplicate() {
  if (!sel.size.value) return
  bulkBusy.value = true
  try {
    await Promise.all([...sel.selected.value].map(id => duplicateInstance(id).catch(() => null)))
    sel.clear()
    await refresh()
    notifySuccess('Instances dupliquées')
  } catch { notifyError('Échec de la duplication en masse') }
  finally { bulkBusy.value = false }
}
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
          Référence, localisation, zones et catégories d'usage de chaque équipement réel. La liste
          de points contractuelle (PDF A3) sera générée pour chaque instance.
        </p>
      </div>
      <button
        @click="openCreate"
        class="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium shrink-0 whitespace-nowrap"
      >
        <PlusCircleIcon class="w-4 h-4 shrink-0" /> Ajouter une instance
      </button>
    </div>

    <div v-if="loading" class="text-center py-6 text-sm text-gray-400">Chargement…</div>

    <div v-else-if="!instances.length" class="px-5 py-6 text-center text-xs text-gray-400 italic">
      Aucune instance saisie. Ajoute la première référence d'équipement réelle du site.
    </div>

    <table v-else class="w-full text-sm">
      <thead class="bg-gray-50 text-[11px] text-gray-500 uppercase">
        <tr>
          <th class="px-3 py-2 text-center w-9">
            <input type="checkbox" :checked="sel.allChecked.value" @change="sel.toggleAll()"
                   v-tooltip="'Tout cocher / décocher'"
                   class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/30" />
          </th>
          <th class="text-left px-5 py-2 font-medium select-none">
            <button @click="toggleSort('reference')" class="inline-flex items-center gap-1 hover:text-indigo-700">
              Référence
              <ArrowUpIcon v-if="sortKey === 'reference' && sortDir === 'asc'" class="w-3 h-3" />
              <ArrowDownIcon v-else-if="sortKey === 'reference' && sortDir === 'desc'" class="w-3 h-3" />
              <ArrowsUpDownIcon v-else class="w-3 h-3 text-gray-300" />
            </button>
          </th>
          <th class="text-left px-2 py-2 font-medium select-none">
            <button @click="toggleSort('location')" class="inline-flex items-center gap-1 hover:text-indigo-700">
              Localisation
              <ArrowUpIcon v-if="sortKey === 'location' && sortDir === 'asc'" class="w-3 h-3" />
              <ArrowDownIcon v-else-if="sortKey === 'location' && sortDir === 'desc'" class="w-3 h-3" />
              <ArrowsUpDownIcon v-else class="w-3 h-3 text-gray-300" />
            </button>
          </th>
          <th class="text-left px-2 py-2 font-medium">Zones fonctionnelles</th>
          <th class="text-left px-2 py-2 font-medium">Catégories d'usage</th>
          <th class="text-left px-2 py-2 font-medium w-12 select-none">
            <button @click="toggleSort('qty')" class="inline-flex items-center gap-1 hover:text-indigo-700">
              Qté
              <ArrowUpIcon v-if="sortKey === 'qty' && sortDir === 'asc'" class="w-3 h-3" />
              <ArrowDownIcon v-else-if="sortKey === 'qty' && sortDir === 'desc'" class="w-3 h-3" />
              <ArrowsUpDownIcon v-else class="w-3 h-3 text-gray-300" />
            </button>
          </th>
          <th class="px-5 py-2 w-24"></th>
        </tr>
        <tr class="bg-white border-t border-gray-100">
          <th class="px-2 py-1.5"></th>
          <th class="px-5 py-1.5"><input :value="columnFilters.reference || ''" @input="setFilter('reference', $event.target.value)" type="text" placeholder="Filtrer…" class="w-full px-2 py-1 rounded-md border border-gray-200 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" /></th>
          <th class="px-2 py-1.5"><input :value="columnFilters.location || ''" @input="setFilter('location', $event.target.value)" type="text" placeholder="Filtrer…" class="w-full px-2 py-1 rounded-md border border-gray-200 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" /></th>
          <th class="px-2 py-1.5"></th>
          <th class="px-2 py-1.5"></th>
          <th class="px-2 py-1.5"><input :value="columnFilters.qty || ''" @input="setFilter('qty', $event.target.value)" type="text" placeholder="…" class="w-full px-1 py-1 rounded-md border border-gray-200 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" /></th>
          <th class="px-5 py-1.5"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="inst in visibleInstances" :key="inst.id" :class="['border-t border-gray-100 group hover:bg-indigo-50/30', sel.has(inst.id) ? 'bg-indigo-50/40' : '']">
          <td class="px-3 py-2 text-center" @click.stop>
            <input type="checkbox" :checked="sel.has(inst.id)" @change="sel.toggle(inst.id)"
                   class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/30" />
          </td>
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
            <span v-else-if="candidateCategories.length" class="text-amber-600 italic text-[11px]" v-tooltip="'Aucune catégorie choisie — toutes celles du template seront utilisées par défaut'">
              tous candidats du template
            </span>
            <span v-else class="text-gray-400 italic">—</span>
          </td>
          <td class="px-2 py-2 text-gray-600">{{ inst.qty }}</td>
          <td class="px-5 py-2 text-right whitespace-nowrap">
            <button @click="openEdit(inst)" class="opacity-0 group-hover:opacity-100 text-indigo-600 hover:text-indigo-800 mr-2" v-tooltip="'Éditer'">
              <PencilSquareIcon class="w-3.5 h-3.5 inline" />
            </button>
            <button @click="duplicateRow(inst)" class="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-gray-900 mr-2" v-tooltip="'Dupliquer'">
              <DocumentDuplicateIcon class="w-3.5 h-3.5 inline" />
            </button>
            <button @click="removeInstance(inst)" class="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700" v-tooltip="'Supprimer'">
              <TrashIcon class="w-3.5 h-3.5 inline" />
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <BulkActionBar :count="sel.size.value" noun="instance" @clear="sel.clear()">
      <button @click="bulkDuplicate" :disabled="bulkBusy"
              class="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-white/10 hover:bg-white/20 rounded-md disabled:opacity-50 whitespace-nowrap">
        <DocumentDuplicateIcon class="w-4 h-4" />
        Dupliquer
      </button>
      <button @click="bulkDelete" :disabled="bulkBusy"
              class="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-rose-500 hover:bg-rose-600 rounded-md disabled:opacity-50 whitespace-nowrap">
        <TrashIcon class="w-4 h-4" />
        Supprimer
      </button>
    </BulkActionBar>

    <BaseModal v-if="editing" :title="editing._isCreating ? 'Nouvelle instance' : `Éditer l'instance ${editing.reference}`" size="lg" @close="editing = null">
      <form @submit.prevent="submitEdit" class="space-y-3">
        <div class="grid grid-cols-3 gap-3">
          <div class="col-span-2">
            <label class="block text-xs font-medium text-gray-700 mb-1">Référence *</label>
            <input v-model="editForm.reference" type="text" required autocomplete="off" data-1p-ignore="true"
                   placeholder="ex : CTA-N1-EST"
                   class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">Quantité</label>
            <input v-model.number="editForm.qty" type="number" min="1"
                   class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Localisation libre</label>
          <input v-model="editForm.location" type="text" autocomplete="off" data-1p-ignore="true"
                 placeholder="Texte libre — utile en complément des zones structurées"
                 class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
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
              <span v-if="c.bacs" class="text-[9px] bg-violet-100 text-violet-700 px-1 rounded ml-auto" v-tooltip="c.bacs">⚖️</span>
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
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"></textarea>
        </div>
      </form>
      <template #footer>
        <button @click="editing = null" class="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 whitespace-nowrap">Annuler</button>
        <button @click="submitEdit" :disabled="!editForm.reference.trim()"
                class="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap">
          {{ editing._isCreating ? 'Créer l\'instance' : 'Enregistrer' }}
        </button>
      </template>
    </BaseModal>
  </div>
</template>
