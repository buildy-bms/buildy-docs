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
import RolePills from './audit/RolePills.vue'
import EnergyPill from './audit/EnergyPill.vue'
import SearchableSelect from './SearchableSelect.vue'
import { listEquipmentTemplates, createBacsDevice } from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useAuditStore } from '@/stores/audit'
import { ENERGY_OPTIONS, ROLE_OPTIONS } from '@/lib/audit-options'

const props = defineProps({
  system: { type: Object, required: true },
  systemLabel: { type: String, required: true },
  zoneName: { type: String, default: '' },
  // Mode onglet : rend le contenu sans son BaseModal ni son footer propre
  // (utilisé comme panneau de la modale d'ajout d'équipement à 2 onglets).
  embedded: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'added'])
const { success, error: notifyError } = useNotification()
const auditStore = useAuditStore()

// Un même modèle bibliothèque ne peut être ajouté qu'une fois par usage.
const usedTemplateIds = computed(() => new Set(
  (auditStore.devices || [])
    .filter(d => d.system_id === props.system.id && d.equipment_template_id)
    .map(d => d.equipment_template_id),
))
function isUsed(t) {
  return usedTemplateIds.value.has(t.id) || recentlyAdded.value.has(t.id)
}

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

// Catégories bibliothèque à proposer :
//  - usage BACS : mappées depuis la system_category (LIBRARY_CATS_FOR_BACS)
//  - usage manuel rattaché à une catégorie : cette catégorie
//  - usage manuel libre : null → toute la bibliothèque
const allowedCategories = computed(() => {
  if (props.system.is_bacs === 0) {
    return props.system.library_category_key ? [props.system.library_category_key] : null
  }
  return LIBRARY_CATS_FOR_BACS[props.system.system_category] || []
})

async function loadTemplates() {
  loading.value = true
  try {
    // null = usage libre → on charge toute la bibliothèque.
    if (allowedCategories.value === null) {
      const { data } = await listEquipmentTemplates()
      templates.value = (data || []).sort((a, b) =>
        (a.name || '').localeCompare(b.name || '', 'fr'))
      return
    }
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
  if (adding.value[t.id] || isUsed(t)) return
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
  <component
    :is="embedded ? 'div' : BaseModal"
    v-bind="embedded ? {} : { title: `Bibliothèque — ${systemLabel}${zoneName ? ' / ' + zoneName : ''}`, size: 'xl', dismissOnBackdrop: false }"
    @close="emit('close')"
  >
    <div class="space-y-3">
      <p class="text-sm text-gray-600">
        Choisis un modèle pour ajouter rapidement un équipement préconfiguré (énergie, niveau).
        Tu pourras ensuite renseigner marque, référence et puissance directement sur l'équipement.
      </p>

      <!-- Filtres : grille 1 col mobile, ligne flex-wrap au-dessus de 640px -->
      <div class="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-stretch">
        <div class="relative sm:flex-1 sm:min-w-56">
          <MagnifyingGlassIcon class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            v-model="search"
            type="text"
            placeholder="Rechercher un modèle…"
            class="w-full pl-9 pr-3 py-2 min-h-11 sm:min-h-0 text-base sm:text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
          />
        </div>
        <div class="sm:w-44">
          <SearchableSelect
            v-model="energyFilter"
            :options="ENERGY_FILTER_OPTIONS"
            placeholder="Toutes énergies"
            :clearable="false"
          />
        </div>
        <div class="sm:w-44">
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

      <!-- Liste : 2 rendus selon viewport -->
      <template v-else>
      <!-- PWA / mobile : stack de cards plein-largeur, bouton 44px tactile -->
      <div class="sm:hidden space-y-2">
        <div
          v-for="t in filtered"
          :key="t.id"
          class="bg-white border border-gray-200 rounded-xl p-3 flex flex-col gap-2.5"
        >
          <div class="flex items-start gap-2.5 min-w-0">
            <EquipmentIcon
              :template="t"
              class="shrink-0 mt-0.5"
            />
            <div class="min-w-0 flex-1">
              <div class="font-medium text-base text-gray-900 leading-snug">{{ t.name }}</div>
              <div class="flex flex-wrap items-center gap-1.5 mt-1">
                <EnergyPill :value="t.default_energy_source" size="xs" />
                <RolePills :roles="t.default_device_role" size="xs" />
              </div>
            </div>
          </div>
          <button
            type="button"
            @click="pickTemplate(t)"
            :disabled="!!adding[t.id] || isUsed(t)"
            :class="[
              'w-full inline-flex items-center justify-center gap-1.5 px-4 py-3 min-h-11 text-base font-medium rounded-lg transition',
              isUsed(t)
                ? 'bg-gray-50 text-gray-400 border border-gray-200 cursor-not-allowed'
                : 'bg-emerald-600 text-white active:bg-emerald-700 disabled:opacity-50'
            ]"
          >
            <CheckIcon v-if="isUsed(t)" class="w-4 h-4 shrink-0" />
            {{ adding[t.id] ? 'Ajout…' : isUsed(t) ? 'Déjà ajouté' : 'Ajouter' }}
          </button>
        </div>
      </div>

      <!-- Desktop : tableau compact -->
      <div class="hidden sm:block border border-gray-200 rounded-lg overflow-hidden bg-white">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
            <tr>
              <th class="px-3 py-2 text-left font-medium">Modèle</th>
              <th class="px-3 py-2 text-left font-medium whitespace-nowrap">Énergie</th>
              <th class="px-3 py-2 text-left font-medium whitespace-nowrap">Fonction(s)</th>
              <th class="px-3 py-2 text-right font-medium whitespace-nowrap">Action</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="t in filtered" :key="t.id" class="hover:bg-gray-50">
              <td class="px-3 py-2.5">
                <div class="flex items-center gap-2.5 min-w-0">
                  <EquipmentIcon
                    :template="t"
                    class="shrink-0"
                  />
                  <div class="min-w-0">
                    <div class="font-medium text-gray-900 truncate">{{ t.name }}</div>
                  </div>
                </div>
              </td>
              <td class="px-3 py-2.5 whitespace-nowrap">
                <EnergyPill :value="t.default_energy_source" size="xs" />
              </td>
              <td class="px-3 py-2.5 whitespace-nowrap">
                <RolePills :roles="t.default_device_role" size="xs" />
              </td>
              <td class="px-3 py-2.5 text-right whitespace-nowrap">
                <button
                  type="button"
                  @click="pickTemplate(t)"
                  :disabled="!!adding[t.id] || isUsed(t)"
                  :class="[
                    'inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition shrink-0 whitespace-nowrap',
                    isUsed(t)
                      ? 'bg-gray-50 text-gray-400 border border-gray-200 cursor-not-allowed'
                      : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50'
                  ]"
                >
                  <CheckIcon v-if="isUsed(t)" class="w-3.5 h-3.5 shrink-0" />
                  {{ adding[t.id] ? 'Ajout…' : isUsed(t) ? 'Déjà ajouté' : 'Ajouter' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      </template>

      <!-- Footer : fermer (masqué en mode onglet — la modale parente gère) -->
      <div v-if="!embedded" class="flex items-center justify-end pt-2 border-t border-gray-100">
        <button
          type="button"
          @click="emit('close')"
          class="inline-flex items-center justify-center gap-1 px-4 py-2 min-h-11 sm:min-h-0 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg whitespace-nowrap"
        >
          <XMarkIcon class="w-4 h-4" /> Fermer
        </button>
      </div>
    </div>
  </component>
</template>
