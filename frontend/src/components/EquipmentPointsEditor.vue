<script setup>
/**
 * Editeur des "points" (donnees lues / ecrites) d'un modele d'equipement.
 *
 * Deux tableaux : direction='read' et direction='write'. Chaque ligne est
 * editable inline, drag-drop pour reordonner par direction, ajout/suppression.
 *
 * Props :
 *   templateId : number — modele cible (les points sont rattaches a ce modele)
 *
 * S'auto-fetch les points au mount + apres chaque modif.
 */
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import Sortable from 'sortablejs'
import {
  PlusIcon, TrashIcon, Bars3Icon, CheckIcon, XMarkIcon,
} from '@heroicons/vue/24/outline'
import {
  getEquipmentTemplate, addTemplatePoint, updateTemplatePoint,
  deleteTemplatePoint, reorderTemplatePoints,
} from '@/api'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  templateId: { type: Number, required: true },
})
const emit = defineEmits(['updated'])

const { success, error: notifyError } = useNotification()

const points = ref([])
const loading = ref(false)
const editing = ref({}) // map pointId -> brouillon de modif
const adding = ref(null) // 'read' | 'write' | null — direction de la nouvelle ligne en cours

const DATA_TYPES = ['Mesure', 'État', 'Alarme', 'Commande', 'Consigne']
const NATURES = [
  { value: '', label: '— (auto)' },
  { value: 'Booléen',   label: 'Booléen' },
  { value: 'Numérique', label: 'Numérique' },
  { value: 'Enum',      label: 'Enum' },
  { value: 'Chaîne de caractères',    label: 'Chaîne de caractères' },
]

// Couleurs par data_type (palette Buildy)
// Pilules nature : Booléen=vert, Numérique=violet, Enum=orange, Chaîne=gris
const NATURE_COLORS = {
  'Booléen':   'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Numérique': 'bg-violet-50 text-violet-700 border-violet-200',
  'Enum':      'bg-orange-50 text-orange-700 border-orange-200',
  'Chaîne de caractères':    'bg-gray-100 text-gray-700 border-gray-200',
}

const TYPE_COLORS = {
  Mesure:   'bg-blue-50 text-blue-700 border-blue-200',
  'État':   'bg-gray-100 text-gray-700 border-gray-200',
  Alarme:   'bg-red-50 text-red-700 border-red-200',
  Commande: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Consigne: 'bg-amber-50 text-amber-700 border-amber-200',
}

async function refresh() {
  loading.value = true
  try {
    const { data } = await getEquipmentTemplate(props.templateId)
    points.value = data.points || []
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec du chargement des points')
  } finally {
    loading.value = false
  }
}
onMounted(refresh)

watch(() => props.templateId, refresh)

// Filtrage texte + tri par colonne (par direction)
const filterText = ref('')
const sortBy = ref({ read: 'position', write: 'position' })
const sortDir = ref({ read: 'asc', write: 'asc' })

function toggleSort(direction, col) {
  if (sortBy.value[direction] === col) {
    sortDir.value[direction] = sortDir.value[direction] === 'asc' ? 'desc' : 'asc'
  } else {
    sortBy.value[direction] = col
    sortDir.value[direction] = 'asc'
  }
}

function applyFilterSort(list, direction) {
  const q = filterText.value.trim().toLowerCase()
  let r = q
    ? list.filter(p =>
        (p.slug || '').toLowerCase().includes(q) ||
        (p.label || '').toLowerCase().includes(q) ||
        (p.tech_name || '').toLowerCase().includes(q) ||
        (p.unit || '').toLowerCase().includes(q) ||
        (p.data_type || '').toLowerCase().includes(q) ||
        (p.nature || '').toLowerCase().includes(q)
      )
    : list
  const key = sortBy.value[direction]
  const dir = sortDir.value[direction] === 'asc' ? 1 : -1
  r = [...r].sort((a, b) => {
    let av = a[key], bv = b[key]
    if (key === 'is_optional') { av = av ? 1 : 0; bv = bv ? 1 : 0 }
    if (typeof av === 'string') av = av.toLowerCase()
    if (typeof bv === 'string') bv = bv.toLowerCase()
    if (av == null) return 1
    if (bv == null) return -1
    if (av < bv) return -1 * dir
    if (av > bv) return  1 * dir
    return 0
  })
  return r
}

const reads = computed(() => applyFilterSort(points.value.filter(p => p.direction === 'read'), 'read'))
const writes = computed(() => applyFilterSort(points.value.filter(p => p.direction === 'write'), 'write'))

// Drag-drop disponible uniquement quand on n'est pas en train de filtrer/trier
const dragEnabled = computed(() => !filterText.value.trim() && sortBy.value.read === 'position' && sortBy.value.write === 'position')

// Brouillon edition d'une ligne existante
function startEdit(p) {
  editing.value = {
    ...editing.value,
    [p.id]: {
      slug: p.slug,
      label: p.label,
      data_type: p.data_type,
      unit: p.unit || '',
      nature: p.nature || '',
      tech_name: p.tech_name || '',
      is_optional: !!p.is_optional,
    },
  }
}
function cancelEdit(pointId) {
  const next = { ...editing.value }; delete next[pointId]; editing.value = next
}
async function saveEdit(pointId) {
  const draft = editing.value[pointId]
  if (!draft || !draft.slug.trim() || !draft.label.trim()) {
    notifyError('Identifiant et nom obligatoires')
    return
  }
  try {
    await updateTemplatePoint(props.templateId, pointId, {
      slug: draft.slug.trim(),
      label: draft.label.trim(),
      data_type: draft.data_type,
      unit: draft.unit.trim() || null,
      nature: draft.nature || null,
      tech_name: draft.tech_name.trim() || null,
      is_optional: draft.is_optional,
    })
    cancelEdit(pointId)
    await refresh()
    emit('updated')
    success('Point mis à jour')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de la mise à jour')
  }
}

// Ligne d'ajout
const addDraft = ref({})
function startAdd(direction) {
  adding.value = direction
  addDraft.value = {
    slug: '',
    label: '',
    data_type: direction === 'read' ? 'Mesure' : 'Commande',
    unit: '',
    nature: '',
    tech_name: '',
    is_optional: false,
  }
}
function cancelAdd() {
  adding.value = null
  addDraft.value = {}
}
async function submitAdd() {
  if (!addDraft.value.slug.trim() || !addDraft.value.label.trim()) {
    notifyError('Identifiant et nom obligatoires')
    return
  }
  try {
    await addTemplatePoint(props.templateId, {
      slug: addDraft.value.slug.trim(),
      label: addDraft.value.label.trim(),
      data_type: addDraft.value.data_type,
      direction: adding.value,
      unit: addDraft.value.unit.trim() || null,
      nature: addDraft.value.nature || null,
      tech_name: addDraft.value.tech_name.trim() || null,
      is_optional: addDraft.value.is_optional,
    })
    cancelAdd()
    await refresh()
    emit('updated')
    success('Point ajouté')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de l\'ajout')
  }
}

async function removePoint(point) {
  if (!confirm(`Supprimer le point « ${point.label} » ?`)) return
  try {
    await deleteTemplatePoint(props.templateId, point.id)
    await refresh()
    emit('updated')
    success('Point supprimé')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de la suppression')
  }
}

// Drag-drop : un Sortable par direction (lecture / ecriture)
const readsBodyRef = ref(null)
const writesBodyRef = ref(null)
const sortables = []
function teardownSortables() {
  while (sortables.length) {
    try { sortables.pop().destroy() } catch { /* ignore */ }
  }
}
function setupSortables() {
  teardownSortables()
  if (!dragEnabled.value) return // pas de drag-drop si filtre/tri actif
  for (const [el, getter] of [
    [readsBodyRef.value, () => reads.value],
    [writesBodyRef.value, () => writes.value],
  ]) {
    if (!el) continue
    const s = Sortable.create(el, {
      animation: 150,
      handle: '.drag-handle',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onEnd: async (evt) => {
        if (evt.oldIndex === evt.newIndex) return
        const ids = Array.from(el.children)
          .map(li => parseInt(li.getAttribute('data-id'), 10))
          .filter(Boolean)
        try {
          await reorderTemplatePoints(props.templateId, ids)
          await refresh()
          emit('updated')
        } catch {
          notifyError('Échec de la réorganisation')
          await refresh()
        }
      },
    })
    sortables.push(s)
  }
}
watch([points, dragEnabled], async () => {
  await nextTick()
  setupSortables()
}, { deep: false })
onBeforeUnmount(teardownSortables)
</script>

<template>
  <div class="space-y-4">
    <!-- Filtre global (s'applique aux 2 tableaux) -->
    <div class="relative max-w-md">
      <input v-model="filterText" type="text" placeholder="Filtrer (identifiant, nom, nom technique, unité…)"
             autocomplete="off"
             class="w-full pl-3 pr-9 py-1.5 bg-white border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
      <button v-if="filterText" @click="filterText = ''"
              class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-xs">×</button>
    </div>

    <!-- ── Donnees lues ── -->
    <section>
      <div class="flex items-center justify-between mb-2">
        <h4 class="text-xs font-medium text-gray-700">
          Données lues
          <span class="text-gray-400 font-normal">— {{ reads.length }} point{{ reads.length > 1 ? 's' : '' }}</span>
        </h4>
        <button type="button" @click="startAdd('read')" :disabled="adding"
                class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 rounded-md transition disabled:opacity-50">
          <PlusIcon class="w-3.5 h-3.5" /> Ajouter une lecture
        </button>
      </div>

      <div class="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 text-[10px] uppercase text-gray-500 tracking-wider">
            <tr>
              <th class="w-8"></th>
              <th class="text-left px-3 py-2 font-medium cursor-pointer hover:text-gray-700" @click="toggleSort('read', 'slug')">
                Identifiant {{ sortBy['read'] === 'slug' ? (sortDir['read'] === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-left px-3 py-2 font-medium cursor-pointer hover:text-gray-700" @click="toggleSort('read', 'tech_name')">
                Nom technique {{ sortBy['read'] === 'tech_name' ? (sortDir['read'] === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-left px-3 py-2 font-medium cursor-pointer hover:text-gray-700" @click="toggleSort('read', 'label')">
                Nom {{ sortBy['read'] === 'label' ? (sortDir['read'] === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-left px-3 py-2 font-medium w-24 cursor-pointer hover:text-gray-700" @click="toggleSort('read', 'data_type')">
                Type {{ sortBy['read'] === 'data_type' ? (sortDir['read'] === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-left px-3 py-2 font-medium w-20 cursor-pointer hover:text-gray-700" @click="toggleSort('read', 'unit')">
                Unité {{ sortBy['read'] === 'unit' ? (sortDir['read'] === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-left px-3 py-2 font-medium w-24 cursor-pointer hover:text-gray-700" @click="toggleSort('read', 'nature')">
                Nature {{ sortBy['read'] === 'nature' ? (sortDir['read'] === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-center px-3 py-2 font-medium w-20 cursor-pointer hover:text-gray-700" @click="toggleSort('read', 'is_optional')">
                Optionnel {{ sortBy['read'] === 'is_optional' ? (sortDir['read'] === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="w-16"></th>
            </tr>
          </thead>
          <tbody ref="readsBodyRef">
            <template v-for="p in reads" :key="p.id">
              <!-- Ligne lecture/affichage -->
              <tr v-if="!editing[p.id]" :data-id="p.id"
                  class="border-t border-gray-100 hover:bg-indigo-50/40 cursor-pointer"
                  @click="startEdit(p)">
                <td class="px-2 text-center align-middle drag-handle cursor-grab text-gray-300 hover:text-gray-500"
                    @click.stop>
                  <Bars3Icon class="w-4 h-4 inline-block" />
                </td>
                <td class="px-3 py-1.5 text-xs font-mono text-gray-500">{{ p.slug }}</td>
                <td class="px-3 py-1.5 text-xs">
                  <code v-if="p.tech_name" class="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-[11px] text-gray-700">{{ p.tech_name }}</code>
                  <span v-else class="text-gray-300 italic">—</span>
                </td>
                <td class="px-3 py-1.5 text-gray-800" :class="p.is_optional ? 'italic text-gray-500' : ''">
                  {{ p.label }}
                  <span v-if="p.is_optional" class="text-[10px] text-gray-400 ml-1">(optionnel)</span>
                </td>
                <td class="px-3 py-1.5">
                  <span :class="['inline-flex items-center px-2 py-0.5 text-[10px] rounded-full border', TYPE_COLORS[p.data_type]]">
                    {{ p.data_type }}
                  </span>
                </td>
                <td class="px-3 py-1.5 text-xs text-gray-600 tabular-nums">{{ p.unit || '—' }}</td>
                <td class="px-3 py-1.5">
                  <span v-if="p.nature" :class="['inline-flex items-center px-2 py-0.5 text-[10px] rounded-full border', NATURE_COLORS[p.nature] || 'bg-gray-50 text-gray-600 border-gray-200']">
                    {{ p.nature }}
                  </span>
                  <span v-else class="text-gray-300 text-xs">—</span>
                </td>
                <td class="px-3 py-1.5 text-center">
                  <CheckIcon v-if="p.is_optional" class="w-4 h-4 text-gray-400 inline-block" />
                </td>
                <td class="px-3 py-1.5 text-right whitespace-nowrap" @click.stop>
                  <button @click="removePoint(p)" class="text-gray-300 hover:text-red-600 p-0.5" title="Supprimer">
                    <TrashIcon class="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
              <!-- Ligne edition -->
              <tr v-else :data-id="p.id" class="border-t border-gray-100 bg-indigo-50/40">
                <td class="px-2 text-center text-gray-300"><Bars3Icon class="w-4 h-4 inline-block" /></td>
                <td class="px-2 py-1.5">
                  <input v-model="editing[p.id].slug" type="text"
                         class="w-full px-2 py-1 bg-white border border-gray-200 rounded-md text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
                </td>
                <td class="px-2 py-1.5">
                  <input v-model="editing[p.id].tech_name" type="text" placeholder="ex: Supply_Water_Temp_R"
                         class="w-full px-2 py-1 bg-white border border-gray-200 rounded-md text-xs font-mono text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
                </td>
                <td class="px-2 py-1.5">
                  <input v-model="editing[p.id].label" type="text"
                         class="w-full px-2 py-1 bg-white border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
                </td>
                <td class="px-2 py-1.5">
                  <select v-model="editing[p.id].data_type"
                          class="w-full px-2 py-1 bg-white border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30">
                    <option v-for="t in DATA_TYPES" :key="t" :value="t">{{ t }}</option>
                  </select>
                </td>
                <td class="px-2 py-1.5">
                  <input v-model="editing[p.id].unit" type="text"
                         class="w-full px-2 py-1 bg-white border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
                </td>
                <td class="px-2 py-1.5">
                  <select v-model="editing[p.id].nature"
                          class="w-full px-2 py-1 bg-white border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30">
                    <option v-for="n in NATURES" :key="n.value" :value="n.value">{{ n.label }}</option>
                  </select>
                </td>
                <td class="px-2 py-1.5 text-center">
                  <input v-model="editing[p.id].is_optional" type="checkbox"
                         class="rounded text-indigo-600 focus:ring-indigo-500/30" />
                </td>
                <td class="px-2 py-1.5 text-right whitespace-nowrap">
                  <button @click="saveEdit(p.id)" class="text-emerald-600 hover:text-emerald-700 p-0.5 mr-1" title="Enregistrer">
                    <CheckIcon class="w-4 h-4" />
                  </button>
                  <button @click="cancelEdit(p.id)" class="text-gray-400 hover:text-gray-700 p-0.5" title="Annuler">
                    <XMarkIcon class="w-4 h-4" />
                  </button>
                </td>
              </tr>
            </template>
            <!-- Ligne ajout -->
            <tr v-if="adding === 'read'" class="border-t border-gray-100 bg-emerald-50/40">
              <td class="px-2 text-center text-emerald-400"><PlusIcon class="w-4 h-4 inline-block" /></td>
              <td class="px-2 py-1.5">
                <input v-model="addDraft.slug" type="text" placeholder="ex: temp.depart_eau"
                       class="w-full px-2 py-1 bg-white border border-gray-200 rounded-md text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
              </td>
              <td class="px-2 py-1.5">
                <input v-model="addDraft.tech_name" type="text" placeholder="ex: Supply_Water_Temp_R"
                       class="w-full px-2 py-1 bg-white border border-gray-200 rounded-md text-xs font-mono text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
              </td>
              <td class="px-2 py-1.5">
                <input v-model="addDraft.label" type="text" placeholder="ex: Température départ d'eau"
                       class="w-full px-2 py-1 bg-white border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
              </td>
              <td class="px-2 py-1.5">
                <select v-model="addDraft.data_type"
                        class="w-full px-2 py-1 bg-white border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30">
                  <option v-for="t in DATA_TYPES" :key="t" :value="t">{{ t }}</option>
                </select>
              </td>
              <td class="px-2 py-1.5">
                <input v-model="addDraft.unit" type="text" placeholder="°C"
                       class="w-full px-2 py-1 bg-white border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
              </td>
              <td class="px-2 py-1.5">
                <select v-model="addDraft.nature"
                        class="w-full px-2 py-1 bg-white border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30">
                  <option v-for="n in NATURES" :key="n.value" :value="n.value">{{ n.label }}</option>
                </select>
              </td>
              <td class="px-2 py-1.5 text-center">
                <input v-model="addDraft.is_optional" type="checkbox"
                       class="rounded text-indigo-600 focus:ring-indigo-500/30" />
              </td>
              <td class="px-2 py-1.5 text-right whitespace-nowrap">
                <button @click="submitAdd" class="text-emerald-600 hover:text-emerald-700 p-0.5 mr-1" title="Ajouter">
                  <CheckIcon class="w-4 h-4" />
                </button>
                <button @click="cancelAdd" class="text-gray-400 hover:text-gray-700 p-0.5" title="Annuler">
                  <XMarkIcon class="w-4 h-4" />
                </button>
              </td>
            </tr>
            <tr v-if="!reads.length && adding !== 'read'">
              <td colspan="9" class="px-3 py-4 text-center text-xs text-gray-400 italic">
                Aucune donnée lue.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── Donnees ecrites ── -->
    <section>
      <div class="flex items-center justify-between mb-2">
        <h4 class="text-xs font-medium text-gray-700">
          Données écrites
          <span class="text-gray-400 font-normal">— {{ writes.length }} point{{ writes.length > 1 ? 's' : '' }}</span>
        </h4>
        <button type="button" @click="startAdd('write')" :disabled="adding"
                class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 rounded-md transition disabled:opacity-50">
          <PlusIcon class="w-3.5 h-3.5" /> Ajouter une écriture
        </button>
      </div>

      <div class="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 text-[10px] uppercase text-gray-500 tracking-wider">
            <tr>
              <th class="w-8"></th>
              <th class="text-left px-3 py-2 font-medium cursor-pointer hover:text-gray-700" @click="toggleSort('write', 'slug')">
                Identifiant {{ sortBy['write'] === 'slug' ? (sortDir['write'] === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-left px-3 py-2 font-medium cursor-pointer hover:text-gray-700" @click="toggleSort('write', 'tech_name')">
                Nom technique {{ sortBy['write'] === 'tech_name' ? (sortDir['write'] === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-left px-3 py-2 font-medium cursor-pointer hover:text-gray-700" @click="toggleSort('write', 'label')">
                Nom {{ sortBy['write'] === 'label' ? (sortDir['write'] === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-left px-3 py-2 font-medium w-24 cursor-pointer hover:text-gray-700" @click="toggleSort('write', 'data_type')">
                Type {{ sortBy['write'] === 'data_type' ? (sortDir['write'] === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-left px-3 py-2 font-medium w-20 cursor-pointer hover:text-gray-700" @click="toggleSort('write', 'unit')">
                Unité {{ sortBy['write'] === 'unit' ? (sortDir['write'] === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-left px-3 py-2 font-medium w-24 cursor-pointer hover:text-gray-700" @click="toggleSort('write', 'nature')">
                Nature {{ sortBy['write'] === 'nature' ? (sortDir['write'] === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-center px-3 py-2 font-medium w-20 cursor-pointer hover:text-gray-700" @click="toggleSort('write', 'is_optional')">
                Optionnel {{ sortBy['write'] === 'is_optional' ? (sortDir['write'] === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="w-16"></th>
            </tr>
          </thead>
          <tbody ref="writesBodyRef">
            <template v-for="p in writes" :key="p.id">
              <tr v-if="!editing[p.id]" :data-id="p.id"
                  class="border-t border-gray-100 hover:bg-indigo-50/40 cursor-pointer"
                  @click="startEdit(p)">
                <td class="px-2 text-center align-middle drag-handle cursor-grab text-gray-300 hover:text-gray-500"
                    @click.stop>
                  <Bars3Icon class="w-4 h-4 inline-block" />
                </td>
                <td class="px-3 py-1.5 text-xs font-mono text-gray-500">{{ p.slug }}</td>
                <td class="px-3 py-1.5 text-xs">
                  <code v-if="p.tech_name" class="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-[11px] text-gray-700">{{ p.tech_name }}</code>
                  <span v-else class="text-gray-300 italic">—</span>
                </td>
                <td class="px-3 py-1.5 text-gray-800" :class="p.is_optional ? 'italic text-gray-500' : ''">
                  {{ p.label }}
                  <span v-if="p.is_optional" class="text-[10px] text-gray-400 ml-1">(optionnel)</span>
                </td>
                <td class="px-3 py-1.5">
                  <span :class="['inline-flex items-center px-2 py-0.5 text-[10px] rounded-full border', TYPE_COLORS[p.data_type]]">
                    {{ p.data_type }}
                  </span>
                </td>
                <td class="px-3 py-1.5 text-xs text-gray-600 tabular-nums">{{ p.unit || '—' }}</td>
                <td class="px-3 py-1.5">
                  <span v-if="p.nature" :class="['inline-flex items-center px-2 py-0.5 text-[10px] rounded-full border', NATURE_COLORS[p.nature] || 'bg-gray-50 text-gray-600 border-gray-200']">
                    {{ p.nature }}
                  </span>
                  <span v-else class="text-gray-300 text-xs">—</span>
                </td>
                <td class="px-3 py-1.5 text-center">
                  <CheckIcon v-if="p.is_optional" class="w-4 h-4 text-gray-400 inline-block" />
                </td>
                <td class="px-3 py-1.5 text-right whitespace-nowrap" @click.stop>
                  <button @click="removePoint(p)" class="text-gray-300 hover:text-red-600 p-0.5" title="Supprimer">
                    <TrashIcon class="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
              <tr v-else :data-id="p.id" class="border-t border-gray-100 bg-indigo-50/40">
                <td class="px-2 text-center text-gray-300"><Bars3Icon class="w-4 h-4 inline-block" /></td>
                <td class="px-2 py-1.5">
                  <input v-model="editing[p.id].slug" type="text"
                         class="w-full px-2 py-1 bg-white border border-gray-200 rounded-md text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
                </td>
                <td class="px-2 py-1.5">
                  <input v-model="editing[p.id].tech_name" type="text" placeholder="ex: Supply_Water_Temp_R"
                         class="w-full px-2 py-1 bg-white border border-gray-200 rounded-md text-xs font-mono text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
                </td>
                <td class="px-2 py-1.5">
                  <input v-model="editing[p.id].label" type="text"
                         class="w-full px-2 py-1 bg-white border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
                </td>
                <td class="px-2 py-1.5">
                  <select v-model="editing[p.id].data_type"
                          class="w-full px-2 py-1 bg-white border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30">
                    <option v-for="t in DATA_TYPES" :key="t" :value="t">{{ t }}</option>
                  </select>
                </td>
                <td class="px-2 py-1.5">
                  <input v-model="editing[p.id].unit" type="text"
                         class="w-full px-2 py-1 bg-white border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
                </td>
                <td class="px-2 py-1.5">
                  <select v-model="editing[p.id].nature"
                          class="w-full px-2 py-1 bg-white border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30">
                    <option v-for="n in NATURES" :key="n.value" :value="n.value">{{ n.label }}</option>
                  </select>
                </td>
                <td class="px-2 py-1.5 text-center">
                  <input v-model="editing[p.id].is_optional" type="checkbox"
                         class="rounded text-indigo-600 focus:ring-indigo-500/30" />
                </td>
                <td class="px-2 py-1.5 text-right whitespace-nowrap">
                  <button @click="saveEdit(p.id)" class="text-emerald-600 hover:text-emerald-700 p-0.5 mr-1" title="Enregistrer">
                    <CheckIcon class="w-4 h-4" />
                  </button>
                  <button @click="cancelEdit(p.id)" class="text-gray-400 hover:text-gray-700 p-0.5" title="Annuler">
                    <XMarkIcon class="w-4 h-4" />
                  </button>
                </td>
              </tr>
            </template>
            <tr v-if="adding === 'write'" class="border-t border-gray-100 bg-emerald-50/40">
              <td class="px-2 text-center text-emerald-400"><PlusIcon class="w-4 h-4 inline-block" /></td>
              <td class="px-2 py-1.5">
                <input v-model="addDraft.slug" type="text" placeholder="ex: cmd.marche_arret"
                       class="w-full px-2 py-1 bg-white border border-gray-200 rounded-md text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
              </td>
              <td class="px-2 py-1.5">
                <input v-model="addDraft.label" type="text" placeholder="ex: Commande marche/arrêt"
                       class="w-full px-2 py-1 bg-white border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
              </td>
              <td class="px-2 py-1.5">
                <select v-model="addDraft.data_type"
                        class="w-full px-2 py-1 bg-white border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30">
                  <option v-for="t in DATA_TYPES" :key="t" :value="t">{{ t }}</option>
                </select>
              </td>
              <td class="px-2 py-1.5">
                <input v-model="addDraft.unit" type="text" placeholder="°C"
                       class="w-full px-2 py-1 bg-white border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
              </td>
              <td class="px-2 py-1.5">
                <select v-model="addDraft.nature"
                        class="w-full px-2 py-1 bg-white border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30">
                  <option v-for="n in NATURES" :key="n.value" :value="n.value">{{ n.label }}</option>
                </select>
              </td>
              <td class="px-2 py-1.5 text-center">
                <input v-model="addDraft.is_optional" type="checkbox"
                       class="rounded text-indigo-600 focus:ring-indigo-500/30" />
              </td>
              <td class="px-2 py-1.5 text-right whitespace-nowrap">
                <button @click="submitAdd" class="text-emerald-600 hover:text-emerald-700 p-0.5 mr-1" title="Ajouter">
                  <CheckIcon class="w-4 h-4" />
                </button>
                <button @click="cancelAdd" class="text-gray-400 hover:text-gray-700 p-0.5" title="Annuler">
                  <XMarkIcon class="w-4 h-4" />
                </button>
              </td>
            </tr>
            <tr v-if="!writes.length && adding !== 'write'">
              <td colspan="9" class="px-3 py-4 text-center text-xs text-gray-400 italic">
                Aucune donnée écrite.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.sortable-ghost { opacity: 0.4; background: #eef2ff; }
.sortable-chosen { background: #eef2ff; }
</style>
