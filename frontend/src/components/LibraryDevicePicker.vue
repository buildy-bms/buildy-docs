<script setup>
/**
 * Modale de sélection d'un modèle d'équipement depuis la bibliothèque
 * pour l'ajouter comme device d'un système BACS. La liste est préfiltrée
 * automatiquement sur la system_category du système courant (un système
 * Chauffage ne montre que des modèles chauffage / mixte).
 *
 * Reste ouverte après chaque ajout pour permettre d'enchaîner plusieurs
 * équipements à la suite.
 *
 * Props :
 *   system : { id, system_category, ... }
 *   systemLabel : libellé humain (Chauffage, Ventilation, …)
 *   zoneName : nom de la zone (ex. « Bureaux »)
 *
 * Émet :
 *   close → ferme la modale
 *   added → un device a été créé, le parent doit refresh
 */
import { ref, computed, onMounted, watch } from 'vue'
import { CheckIcon, XMarkIcon, MagnifyingGlassIcon } from '@heroicons/vue/24/outline'
import BaseModal from './BaseModal.vue'
import EquipmentIcon from './EquipmentIcon.vue'
import SearchableSelect from './SearchableSelect.vue'
import { listEquipmentTemplates, createBacsDevice } from '@/api'
import { useNotification } from '@/composables/useNotification'
import { ENERGY_OPTIONS, ROLE_OPTIONS } from '@/lib/audit-options'

const props = defineProps({
  system: { type: Object, required: true },
  systemLabel: { type: String, required: true },
  zoneName: { type: String, default: '' },
})
const emit = defineEmits(['close', 'added'])
const { success, error: notifyError } = useNotification()

// Mapping côté front pour rester cohérent avec
// backend-node/src/lib/system-categories.js::libraryCategoriesForBacsCategory.
// Toute évolution doit être propagée des deux côtés.
const LIBRARY_CATS_FOR_BACS = {
  heating: ['chauffage', 'thermique_mixte'],
  cooling: ['climatisation', 'thermique_mixte'],
  ventilation: ['ventilation', 'thermique_mixte'],
  dhw: ['ecs'],
  // 'eclairage' = ancien slug unique ; 'eclairage_int'/'eclairage_ext' = nouvelle dichotomie.
  lighting_indoor: ['eclairage_int', 'eclairage'],
  lighting_outdoor: ['eclairage_ext', 'eclairage'],
  // 'pv' = nouveau slug ; 'electricite' = ancien slug du seed production-electricite.
  electricity_production: ['pv', 'electricite'],
}

const templates = ref([])
const loading = ref(false)
const search = ref('')
const energyFilter = ref(null)
const roleFilter = ref(null)
const adding = ref({})  // template_id -> boolean

const allowedCategories = computed(() =>
  LIBRARY_CATS_FOR_BACS[props.system.system_category] || [],
)

async function loadTemplates() {
  loading.value = true
  try {
    if (!allowedCategories.value.length) {
      templates.value = []
      return
    }
    const results = await Promise.all(
      allowedCategories.value.map(cat =>
        listEquipmentTemplates({ category: cat }).then(r => r.data),
      ),
    )
    // Dédup par id (un mixte est ramené 2x quand on charge chauffage + mixte)
    const byId = new Map()
    for (const arr of results) {
      for (const t of arr) byId.set(t.id, t)
    }
    templates.value = Array.from(byId.values()).sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', 'fr'),
    )
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Chargement impossible')
  } finally {
    loading.value = false
  }
}
onMounted(loadTemplates)
watch(() => props.system?.id, loadTemplates)

const ENERGY_FILTER_OPTIONS = computed(() => [
  { value: null, label: 'Toutes énergies' },
  ...ENERGY_OPTIONS,
])
const ROLE_FILTER_OPTIONS = computed(() => [
  { value: null, label: 'Tous niveaux' },
  ...ROLE_OPTIONS,
])

function normalizeText(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function rolesArr(v) {
  return Array.isArray(v) ? v : (v ? [v] : [])
}
const filtered = computed(() => {
  const q = normalizeText(search.value.trim())
  return templates.value.filter(t => {
    if (q && !normalizeText(t.name).includes(q)) return false
    if (energyFilter.value && t.default_energy_source !== energyFilter.value) return false
    // Multi-rôle (mig 117) : un template apparaît si son array de rôles
    // contient le rôle filtré.
    if (roleFilter.value && !rolesArr(t.default_device_role).includes(roleFilter.value)) return false
    return true
  })
})

function energyLabel(value) {
  return ENERGY_OPTIONS.find(o => o.value === value)?.label || ''
}
function roleLabel(value) {
  // Multi-rôle : array → labels FR joints par ' / '. Scalaire (legacy) → label simple.
  return rolesArr(value)
    .map(v => ROLE_OPTIONS.find(o => o.value === v)?.label || v)
    .join(' / ')
}
function hasRole(value) {
  return rolesArr(value).length > 0
}

const recentlyAdded = ref(new Set())

async function pickTemplate(t) {
  if (adding.value[t.id]) return
  adding.value = { ...adding.value, [t.id]: true }
  try {
    await createBacsDevice(props.system.id, { equipment_template_id: t.id })
    success(`« ${t.name} » ajouté`)
    recentlyAdded.value = new Set([...recentlyAdded.value, t.id])
    emit('added')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Ajout impossible')
  } finally {
    adding.value = { ...adding.value, [t.id]: false }
  }
}
</script>

<template>
  <BaseModal
    :title="`Bibliothèque — ${systemLabel}${zoneName ? ' / ' + zoneName : ''}`"
    size="xl"
    :dismiss-on-backdrop="false"
    @close="emit('close')"
  >
    <div class="space-y-3">
      <p class="text-sm text-gray-600">
        Choisis un modèle pour ajouter rapidement un équipement préconfiguré (énergie, niveau).
        Tu pourras ensuite renseigner marque, référence et puissance directement sur l'équipement.
      </p>

      <!-- Filtres -->
      <div class="flex flex-wrap gap-2 items-stretch">
        <div class="relative flex-1 min-w-56">
          <MagnifyingGlassIcon class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            v-model="search"
            type="text"
            placeholder="Rechercher un modèle…"
            class="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
          />
        </div>
        <div class="w-44">
          <SearchableSelect
            v-model="energyFilter"
            :options="ENERGY_FILTER_OPTIONS"
            placeholder="Toutes énergies"
            :clearable="false"
          />
        </div>
        <div class="w-44">
          <SearchableSelect
            v-model="roleFilter"
            :options="ROLE_FILTER_OPTIONS"
            placeholder="Tous niveaux"
            :clearable="false"
            :creatable="true"
          />
        </div>
      </div>

      <!-- État de chargement -->
      <div v-if="loading" class="py-12 text-center text-sm text-gray-500">
        Chargement de la bibliothèque…
      </div>

      <!-- Aucun modèle pour cette catégorie -->
      <div
        v-else-if="!templates.length"
        class="py-12 text-center text-sm text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-200"
      >
        Aucun modèle dans la bibliothèque pour la catégorie « {{ systemLabel }} » pour le moment.
      </div>

      <!-- Aucun résultat de filtrage -->
      <div
        v-else-if="!filtered.length"
        class="py-12 text-center text-sm text-gray-500"
      >
        Aucun modèle ne correspond aux filtres.
      </div>

      <!-- Liste des modèles : tableau compact responsive -->
      <div v-else class="border border-gray-200 rounded-lg overflow-hidden bg-white">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
            <tr>
              <th class="px-3 py-2 text-left font-medium">Modèle</th>
              <th class="px-3 py-2 text-left font-medium hidden sm:table-cell whitespace-nowrap">Énergie</th>
              <th class="px-3 py-2 text-left font-medium hidden sm:table-cell whitespace-nowrap">Niveau</th>
              <th class="px-3 py-2 text-right font-medium whitespace-nowrap">Action</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="t in filtered" :key="t.id" class="hover:bg-gray-50">
              <td class="px-3 py-2.5">
                <div class="flex items-center gap-2.5 min-w-0">
                  <EquipmentIcon
                    :icon-kind="t.icon_kind"
                    :icon-value="t.icon_value"
                    :icon-color="t.icon_color"
                    class="shrink-0"
                  />
                  <div class="min-w-0">
                    <div class="font-medium text-gray-900 truncate">{{ t.name }}</div>
                    <div class="text-xs text-gray-400 sm:hidden mt-0.5">
                      <span v-if="t.default_energy_source">{{ energyLabel(t.default_energy_source) }}</span>
                      <span v-if="t.default_energy_source && hasRole(t.default_device_role)"> · </span>
                      <span v-if="hasRole(t.default_device_role)">{{ roleLabel(t.default_device_role) }}</span>
                    </div>
                  </div>
                </div>
              </td>
              <td class="px-3 py-2.5 text-gray-600 hidden sm:table-cell whitespace-nowrap">
                <span v-if="t.default_energy_source">{{ energyLabel(t.default_energy_source) }}</span>
                <span v-else class="text-gray-300">—</span>
              </td>
              <td class="px-3 py-2.5 text-gray-600 hidden sm:table-cell whitespace-nowrap">
                <span v-if="hasRole(t.default_device_role)">{{ roleLabel(t.default_device_role) }}</span>
                <span v-else class="text-gray-300">—</span>
              </td>
              <td class="px-3 py-2.5 text-right whitespace-nowrap">
                <button
                  type="button"
                  @click="pickTemplate(t)"
                  :disabled="!!adding[t.id]"
                  :class="[
                    'inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition shrink-0 whitespace-nowrap',
                    recentlyAdded.has(t.id)
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                      : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50'
                  ]"
                >
                  <CheckIcon v-if="recentlyAdded.has(t.id)" class="w-3.5 h-3.5 shrink-0" />
                  {{ adding[t.id] ? 'Ajout…' : recentlyAdded.has(t.id) ? 'Ajouté · Encore ?' : 'Ajouter' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Footer : fermer -->
      <div class="flex items-center justify-end pt-2 border-t border-gray-100">
        <button
          type="button"
          @click="emit('close')"
          class="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg whitespace-nowrap"
        >
          <XMarkIcon class="w-4 h-4" /> Fermer
        </button>
      </div>
    </div>
  </BaseModal>
</template>
