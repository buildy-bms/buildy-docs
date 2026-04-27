<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import { PlusCircleIcon, TrashIcon, ArrowUturnLeftIcon } from '@heroicons/vue/24/outline'
import { getSectionPoints, addSectionOverride, deleteSectionOverride } from '@/api'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  sectionId: { type: Number, required: true },
})

const { error: notifyError } = useNotification()
const points = ref([])
const loading = ref(false)
const showAdd = ref(false)
const draftPoint = ref({ label: '', data_type: 'Mesure', direction: 'read', unit: '' })

const TYPE_COLORS = {
  Mesure:   { bg: 'bg-blue-50',     text: 'text-blue-700' },
  'État':   { bg: 'bg-gray-100',    text: 'text-gray-700' },
  Alarme:   { bg: 'bg-red-50',      text: 'text-red-700' },
  Commande: { bg: 'bg-emerald-50',  text: 'text-emerald-700' },
  Consigne: { bg: 'bg-amber-50',    text: 'text-amber-700' },
}

const SOURCE_BADGE = {
  template:     { label: '',                  classes: '' },
  'local-add':  { label: 'Ajouté localement',  classes: 'bg-emerald-100 text-emerald-800' },
  'local-edit': { label: 'Modifié localement', classes: 'bg-amber-100 text-amber-800' },
}

const readPoints = computed(() => points.value.filter(p => p.direction === 'read'))
const writePoints = computed(() => points.value.filter(p => p.direction === 'write'))
const localCount = computed(() => points.value.filter(p => p.source !== 'template').length)

async function refresh() {
  loading.value = true
  try {
    const { data } = await getSectionPoints(props.sectionId)
    points.value = data.points
  } catch (e) {
    notifyError('Échec du chargement des points')
  } finally {
    loading.value = false
  }
}

async function removePoint(p) {
  try {
    if (p.source === 'template') {
      // Créer un override 'remove' pour masquer le point template
      if (!confirm(`Retirer "${p.label}" de cette section ?\n(Le template d'origine n'est pas modifié.)`)) return
      await addSectionOverride(props.sectionId, { action: 'remove', base_point_id: p.base_point_id })
    } else {
      // Supprimer l'override directement
      if (!confirm(`Retirer "${p.label}" ?`)) return
      await deleteSectionOverride(props.sectionId, p.override_id)
    }
    await refresh()
  } catch (e) {
    notifyError('Échec de la suppression')
  }
}

async function restorePoint(p) {
  // Pour un 'local-add' inutile (le bouton n'est pas affiché). Pour un 'local-edit',
  // on supprime l'override pour revenir à la valeur du template.
  // Pour un point template "remove" → il faut chercher l'override 'remove' et le supprimer.
  // V1 : on gère seulement le cas local-edit via le bouton restore.
  if (p.override_id) {
    try {
      await deleteSectionOverride(props.sectionId, p.override_id)
      await refresh()
    } catch (e) {
      notifyError('Échec de la restauration')
    }
  }
}

async function submitAdd() {
  if (!draftPoint.value.label.trim()) return
  try {
    const maxPos = Math.max(0, ...points.value.map(p => p.position || 0))
    await addSectionOverride(props.sectionId, {
      action: 'add',
      label: draftPoint.value.label.trim(),
      data_type: draftPoint.value.data_type,
      direction: draftPoint.value.direction,
      unit: draftPoint.value.unit?.trim() || null,
      position: maxPos + 10,
    })
    draftPoint.value = { label: '', data_type: 'Mesure', direction: 'read', unit: '' }
    showAdd.value = false
    await refresh()
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de l\'ajout')
  }
}

watch(() => props.sectionId, refresh)
onMounted(refresh)

function tableFor(direction) {
  return direction === 'read' ? readPoints.value : writePoints.value
}
</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200">
    <div class="flex items-center justify-between px-5 py-3 border-b border-gray-100">
      <h3 class="text-sm font-semibold text-gray-700">
        Points attendus pour cet équipement
        <span v-if="localCount > 0" class="ml-2 text-xs font-normal text-amber-600">
          ({{ localCount }} modification{{ localCount > 1 ? 's' : '' }} locale{{ localCount > 1 ? 's' : '' }})
        </span>
      </h3>
      <button
        @click="showAdd = !showAdd"
        class="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
      >
        <PlusCircleIcon class="w-4 h-4" /> Ajouter un point
      </button>
    </div>

    <!-- Formulaire ajout inline -->
    <div v-if="showAdd" class="px-5 py-3 bg-gray-50 border-b border-gray-100">
      <form @submit.prevent="submitAdd" class="flex items-center gap-2 flex-wrap">
        <input v-model="draftPoint.label" type="text" required placeholder="Libellé du point (ex : Pression filtre)"
               class="flex-1 min-w-[180px] px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <select v-model="draftPoint.data_type" class="px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option>Mesure</option><option>État</option><option>Alarme</option><option>Commande</option><option>Consigne</option>
        </select>
        <select v-model="draftPoint.direction" class="px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="read">Lecture</option>
          <option value="write">Écriture</option>
        </select>
        <input v-model="draftPoint.unit" type="text" placeholder="Unité"
               class="w-20 px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <button type="submit" class="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700">Ajouter</button>
        <button type="button" @click="showAdd = false" class="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-800">Annuler</button>
      </form>
    </div>

    <div v-if="loading" class="text-center py-6 text-sm text-gray-400">Chargement…</div>

    <template v-else>
      <!-- Lecture -->
      <div class="px-5 py-3">
        <h4 class="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Données typiquement lues ({{ readPoints.length }})
        </h4>
        <div v-if="!readPoints.length" class="text-xs text-gray-400 italic py-2">Aucune donnée de lecture définie.</div>
        <table v-else class="w-full text-sm">
          <tbody>
            <tr v-for="p in readPoints" :key="p.override_id || p.id" class="border-b border-gray-50 last:border-0 group">
              <td class="py-1.5 pr-2 text-gray-800">
                {{ p.label }}
                <span v-if="SOURCE_BADGE[p.source]?.label" :class="['ml-2 inline-block px-1.5 py-0.5 text-[10px] font-semibold rounded', SOURCE_BADGE[p.source].classes]">
                  {{ SOURCE_BADGE[p.source].label }}
                </span>
              </td>
              <td class="py-1.5 pr-2 w-32">
                <span :class="['inline-block px-1.5 py-0.5 text-[10px] font-semibold rounded', TYPE_COLORS[p.data_type]?.bg, TYPE_COLORS[p.data_type]?.text]">{{ p.data_type }}</span>
              </td>
              <td class="py-1.5 pr-2 w-16 text-xs text-gray-500">{{ p.unit || '—' }}</td>
              <td class="py-1.5 w-16 text-right">
                <button v-if="p.source === 'local-edit'" @click="restorePoint(p)" class="opacity-0 group-hover:opacity-100 text-amber-600 hover:text-amber-800 mr-1" title="Restaurer la valeur du template">
                  <ArrowUturnLeftIcon class="w-3.5 h-3.5 inline" />
                </button>
                <button @click="removePoint(p)" class="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700" title="Retirer ce point">
                  <TrashIcon class="w-3.5 h-3.5 inline" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Écriture -->
      <div class="px-5 py-3 border-t border-gray-100">
        <h4 class="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Données typiquement écrites ({{ writePoints.length }})
        </h4>
        <div v-if="!writePoints.length" class="text-xs text-gray-400 italic py-2">Aucune donnée d'écriture définie.</div>
        <table v-else class="w-full text-sm">
          <tbody>
            <tr v-for="p in writePoints" :key="p.override_id || p.id" class="border-b border-gray-50 last:border-0 group">
              <td class="py-1.5 pr-2 text-gray-800">
                {{ p.label }}
                <span v-if="SOURCE_BADGE[p.source]?.label" :class="['ml-2 inline-block px-1.5 py-0.5 text-[10px] font-semibold rounded', SOURCE_BADGE[p.source].classes]">
                  {{ SOURCE_BADGE[p.source].label }}
                </span>
              </td>
              <td class="py-1.5 pr-2 w-32">
                <span :class="['inline-block px-1.5 py-0.5 text-[10px] font-semibold rounded', TYPE_COLORS[p.data_type]?.bg, TYPE_COLORS[p.data_type]?.text]">{{ p.data_type }}</span>
              </td>
              <td class="py-1.5 pr-2 w-16 text-xs text-gray-500">{{ p.unit || '—' }}</td>
              <td class="py-1.5 w-16 text-right">
                <button v-if="p.source === 'local-edit'" @click="restorePoint(p)" class="opacity-0 group-hover:opacity-100 text-amber-600 hover:text-amber-800 mr-1">
                  <ArrowUturnLeftIcon class="w-3.5 h-3.5 inline" />
                </button>
                <button @click="removePoint(p)" class="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700">
                  <TrashIcon class="w-3.5 h-3.5 inline" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
