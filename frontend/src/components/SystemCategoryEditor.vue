<script setup>
/**
 * Modale CRUD d'une categorie de systeme.
 * Champs : key (immuable en edit), label, bacs (texte libre), slugs (multi-select
 * des templates equipement), icone FA Pro + couleur.
 */
import { ref, computed, watch } from 'vue'
import { TrashIcon } from '@heroicons/vue/24/outline'
import BaseModal from './BaseModal.vue'
import EquipmentIcon from './EquipmentIcon.vue'
import BacsArticlesPicker from './BacsArticlesPicker.vue'
import * as allSolidIcons from '@fortawesome/pro-solid-svg-icons'
import { createSystemCategory, updateSystemCategory, deleteSystemCategory, listEquipmentTemplates } from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'

const ALL_FA_NAMES = [...new Set(
  Object.values(allSolidIcons).filter(i => i && i.iconName && i.icon).map(i => i.iconName)
)].sort()

const props = defineProps({
  category: { type: Object, default: null }, // null = creation
})
const emit = defineEmits(['close', 'saved', 'deleted'])
const { success, error: notifyError } = useNotification()
const { confirm } = useConfirm()

const isEdit = computed(() => !!props.category?.id)

const COLOR_PRESETS = [
  '#dc2626', '#ea580c', '#facc15', '#22c55e', '#16a34a', '#06b6d4',
  '#0ea5e9', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#64748b', '#6b7280',
]

const form = ref({ key: '', label: '', bacs: '', slugs: [], icon_value: 'fa-cube', icon_color: '#6b7280' })
const submitting = ref(false)
const allTemplates = ref([])

watch(() => props.category, (c) => {
  if (c) {
    form.value = {
      key: c.key || '',
      label: c.label || '',
      bacs: c.bacs || '',
      slugs: Array.isArray(c.slugs) ? [...c.slugs] : [],
      icon_value: c.icon_value || 'fa-cube',
      icon_color: c.icon_color || '#6b7280',
    }
  } else {
    form.value = { key: '', label: '', bacs: '', slugs: [], icon_value: 'fa-cube', icon_color: '#6b7280' }
  }
}, { immediate: true })

async function loadTemplates() {
  try { const { data } = await listEquipmentTemplates(); allTemplates.value = data }
  catch { allTemplates.value = [] }
}
loadTemplates()

const iconSearch = ref('')
const filteredIcons = computed(() => {
  const q = iconSearch.value.trim().toLowerCase()
  if (!q) return [] // grille masquee tant qu'on ne tape rien (gain de place)
  return ALL_FA_NAMES.filter(n => n.includes(q)).slice(0, 60)
})

function selectIconName(name) { form.value.icon_value = 'fa-' + name }
function selectColor(c) { form.value.icon_color = c }
function toggleSlug(slug) {
  const i = form.value.slugs.indexOf(slug)
  if (i >= 0) form.value.slugs.splice(i, 1)
  else form.value.slugs.push(slug)
}

async function submit() {
  if (!form.value.label.trim() || !form.value.key.trim()) return
  submitting.value = true
  try {
    const payload = {
      label: form.value.label.trim(),
      bacs: form.value.bacs.trim() || null,
      slugs: form.value.slugs,
      icon_value: form.value.icon_value,
      icon_color: form.value.icon_color,
    }
    let res
    if (isEdit.value) {
      res = await updateSystemCategory(props.category.id, payload)
      success('Catégorie mise à jour')
    } else {
      payload.key = form.value.key.trim()
      res = await createSystemCategory(payload)
      success('Catégorie créée')
    }
    emit('saved', res.data)
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de l\'enregistrement')
  } finally {
    submitting.value = false
  }
}

async function destroy() {
  if (!isEdit.value) return
  const ok = await confirm({
    title: 'Supprimer la catégorie ?',
    message: `« ${props.category.label} »\n\nLes instances qui l'avaient sélectionnée la perdent.`,
    confirmLabel: 'Supprimer',
    danger: true,
  })
  if (!ok) return
  try {
    await deleteSystemCategory(props.category.id)
    success('Catégorie supprimée')
    emit('deleted', props.category.id)
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec suppression')
  }
}
</script>

<template>
  <BaseModal :title="isEdit ? `Éditer la catégorie « ${category.label} »` : 'Nouvelle catégorie de système'" size="lg" @close="emit('close')">
    <form @submit.prevent="submit" class="space-y-4">
      <div class="grid grid-cols-3 gap-3">
        <div class="col-span-2">
          <label class="block text-xs font-medium text-gray-700 mb-1">Libellé *</label>
          <input v-model="form.label" type="text" required autocomplete="off"
                 placeholder="Ex : Chauffage"
                 class="w-full px-3 py-2 border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Key (interne) *</label>
          <input v-model="form.key" type="text" required :disabled="isEdit" autocomplete="off"
                 placeholder="chauffage"
                 class="w-full px-3 py-2 border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100 disabled:text-gray-500" />
        </div>
      </div>

      <div>
        <label class="block text-xs font-medium text-gray-600 mb-1.5">
          Articles BACS applicables
          <span class="text-gray-400 font-normal">— hérités par tous les équipements de la catégorie</span>
        </label>
        <BacsArticlesPicker v-model="form.bacs" />
      </div>

      <div>
        <label class="block text-xs font-medium text-gray-600 mb-1">Icône & couleur</label>
        <div class="flex items-center gap-2">
          <span class="inline-flex items-center justify-center w-9 h-9 bg-white border border-gray-200 rounded-lg shrink-0">
            <EquipmentIcon :template="{ icon_kind: 'fa', icon_value: form.icon_value, icon_color: form.icon_color }" size="md" />
          </span>
          <input v-model="iconSearch" type="text" autocomplete="off"
                 placeholder="Rechercher une icône (fire, snowflake, fan…)"
                 class="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
        </div>
        <div v-if="iconSearch.trim()" class="bg-white border border-gray-200 rounded-lg p-1.5 mt-1.5 max-h-28 overflow-y-auto grid grid-cols-10 gap-0.5">
          <button v-for="name in filteredIcons" :key="name" type="button" @click="selectIconName(name)"
                  :class="['inline-flex items-center justify-center w-7 h-7 rounded-md transition', form.icon_value === 'fa-' + name ? 'bg-indigo-100 ring-1 ring-indigo-400' : 'hover:bg-gray-100']"
                  :title="name">
            <EquipmentIcon :template="{ icon_kind: 'fa', icon_value: 'fa-' + name, icon_color: form.icon_color }" size="sm" />
          </button>
          <p v-if="!filteredIcons.length" class="col-span-10 text-[11px] text-gray-400 italic text-center py-2">
            Aucune icône.
          </p>
        </div>
        <div class="flex items-center gap-1.5 mt-1.5">
          <span class="text-[11px] text-gray-500 mr-1">Couleur</span>
          <button v-for="c in COLOR_PRESETS" :key="c" type="button" @click="selectColor(c)"
                  :class="['w-4 h-4 rounded-full border-2 transition', form.icon_color === c ? 'border-gray-700 scale-110' : 'border-white ring-1 ring-gray-200']"
                  :style="{ background: c }" :title="c"></button>
          <input type="color" v-model="form.icon_color" class="w-5 h-5 rounded cursor-pointer ml-1 border border-gray-200" />
        </div>
      </div>

      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">Templates équipement candidats ({{ form.slugs.length }})</label>
        <p class="text-[10px] text-gray-400 mb-2">Templates dont les instances peuvent appartenir à cette catégorie. Ex : pour Chauffage, sélectionner CTA, chaudière, aérotherme, DRV, rooftop.</p>
        <div class="grid grid-cols-3 gap-1.5 max-h-40 overflow-y-auto p-2 bg-gray-50 rounded">
          <label v-for="tpl in allTemplates" :key="tpl.id"
                 :class="['flex items-center gap-2 px-2 py-1 text-xs rounded cursor-pointer border',
                          form.slugs.includes(tpl.slug) ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100']">
            <input type="checkbox" :checked="form.slugs.includes(tpl.slug)" @change="toggleSlug(tpl.slug)" class="shrink-0" />
            <EquipmentIcon :template="tpl" size="sm" />
            <span class="truncate">{{ tpl.name }}</span>
          </label>
        </div>
      </div>
    </form>

    <template #footer>
      <button v-if="isEdit" @click="destroy" class="mr-auto px-3 py-1.5 text-xs text-red-600 hover:text-red-800 inline-flex items-center gap-1">
        <TrashIcon class="w-3.5 h-3.5" /> Supprimer
      </button>
      <button @click="emit('close')" class="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">Annuler</button>
      <button @click="submit" :disabled="submitting || !form.label.trim() || !form.key.trim()"
              class="px-3 py-1.5 text-xs bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
        {{ submitting ? 'Enregistrement…' : (isEdit ? 'Enregistrer' : 'Créer') }}
      </button>
    </template>
  </BaseModal>
</template>
