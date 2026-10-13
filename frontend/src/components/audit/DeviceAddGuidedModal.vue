<script setup>
/**
 * Ajouter un équipement (étape Systèmes, mise en page guidée). Recherche d'abord : le champ a le
 * focus dès l'ouverture, la liste se filtre à la frappe. Portée « modèles de cet usage » ou
 * « toute la bibliothèque », filtres énergie et fonction (comme aujourd'hui). « Ajouter » crée
 * l'équipement en un clic et la fenêtre reste ouverte pour enchaîner (comme aujourd'hui) ; le
 * dernier équipement ajouté s'ouvre dans la fiche, à droite (`added` → la page l'ouvre).
 * « Pas dans la bibliothèque ? Saisie libre » : formulaire complet (AddDeviceModal intégré).
 */
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { faMagnifyingGlass, faArrowLeft } from '@fortawesome/free-solid-svg-icons'
import { CheckIcon } from '@heroicons/vue/24/outline'
import BaseModal from '@/components/BaseModal.vue'
import EquipmentIcon from '@/components/EquipmentIcon.vue'
import RolePills from '@/components/audit/RolePills.vue'
import EnergyPill from '@/components/audit/EnergyPill.vue'
import SearchableSelect from '@/components/SearchableSelect.vue'
import Tooltip from '@/components/Tooltip.vue'
import AddDeviceModal from '@/components/AddDeviceModal.vue'
import { listEquipmentTemplates, createBacsDevice } from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useAuditStore } from '@/stores/audit'
import { ENERGY_OPTIONS, ROLE_OPTIONS, COMM_OPTIONS } from '@/lib/audit-options'
import { TEMPLATE_ALREADY_ADDED_TIP } from '@/lib/audit-tips-systems'
import { templateMatches } from '@/lib/library-search'
import {
  usageModelsLabel, ALL_LIBRARY_LABEL, ADD_SCOPE_TIPS, ADD_SEARCH_PLACEHOLDER, GUIDE_TEXTS,
  ADD_FREE_ENTRY_LABEL, ADD_FREE_ENTRY_TIP, ADD_BACK_LABEL, ADD_TEMPLATE_TIP, ADD_NO_MATCH, elsewhereLabel,
} from '@/lib/audit-tips-systems-guide'

library.add(faMagnifyingGlass, faArrowLeft)

const props = defineProps({
  system: { type: Object, required: true },   // { id, system_category, is_bacs, library_category_key, … }
  systemLabel: { type: String, required: true },
  zoneName: { type: String, default: '' },
})
const emit = defineEmits(['close', 'added', 'created'])
const { success, error: notifyError } = useNotification()
const auditStore = useAuditStore()

// Même correspondance que LibraryDevicePicker et le serveur
// (backend-node/src/lib/system-categories.js::libraryCategoriesForBacsCategory).
const LIBRARY_CATS_FOR_BACS = {
  heating: ['chauffage', 'thermique_mixte'],
  cooling: ['climatisation', 'thermique_mixte'],
  ventilation: ['ventilation', 'thermique_mixte'],
  dhw: ['ecs'],
  lighting_indoor: ['eclairage_int', 'eclairage'],
  lighting_outdoor: ['eclairage_ext', 'eclairage'],
  electricity_production: ['pv', 'electricite'],
}
// null = usage libre : toute la bibliothèque.
const usageCategories = computed(() => {
  if (props.system.is_bacs === 0) return props.system.library_category_key ? [props.system.library_category_key] : null
  return LIBRARY_CATS_FOR_BACS[props.system.system_category] || []
})

const view = ref('library')           // library | manual
const scope = ref('usage')            // usage | all
const allTemplates = ref([])
const loading = ref(false)
const search = ref('')
const energyFilter = ref(null)
const roleFilter = ref(null)
const adding = ref({})
const recentlyAdded = ref(new Set())
const searchInput = ref(null)

async function load() {
  loading.value = true
  try {
    const { data } = await listEquipmentTemplates()
    allTemplates.value = (data || []).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr'))
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Chargement de la bibliothèque impossible')
  } finally {
    loading.value = false
  }
}
onMounted(async () => {
  await load()
  await nextTick()
  searchInput.value?.focus()
})

const usedTemplateIds = computed(() => new Set(
  (auditStore.devices || [])
    .filter(d => d.system_id === props.system.id && d.equipment_template_id)
    .map(d => d.equipment_template_id),
))
function isUsed(t) { return usedTemplateIds.value.has(t.id) || recentlyAdded.value.has(t.id) }

function norm(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}
function rolesArr(v) { return Array.isArray(v) ? v : (v ? [v] : []) }
const hasUsageScope = computed(() => usageCategories.value !== null)
const inScope = computed(() => {
  if (scope.value === 'all' || !hasUsageScope.value) return allTemplates.value
  const cats = new Set(usageCategories.value)
  return allTemplates.value.filter(t => cats.has(t.category))
})
const filtered = computed(() => {
  const q = norm(search.value.trim())
  return inScope.value.filter(t => {
    if (q && !templateMatches(t, search.value)) return false
    if (energyFilter.value && t.default_energy_source !== energyFilter.value) return false
    if (roleFilter.value && !rolesArr(t.default_device_role).includes(roleFilter.value)) return false
    return true
  })
})
// Recherche sans résultat dans l'usage, mais avec des résultats ailleurs : on le dit.
const elsewhere = computed(() => {
  if (scope.value === 'all' || !hasUsageScope.value || filtered.value.length || !search.value.trim()) return 0
  const q = norm(search.value.trim())
  return allTemplates.value.filter(t => templateMatches(t, search.value)).length
})
watch(scope, () => nextTick(() => searchInput.value?.focus()))

const ENERGY_FILTER_OPTIONS = [{ value: null, label: 'Toutes énergies' }, ...ENERGY_OPTIONS]
const ROLE_FILTER_OPTIONS = [{ value: null, label: 'Toutes fonctions' }, ...ROLE_OPTIONS]

async function add(t) {
  if (adding.value[t.id] || isUsed(t)) return
  adding.value = { ...adding.value, [t.id]: true }
  try {
    const { data } = await createBacsDevice(props.system.id, { equipment_template_id: t.id })
    success(`« ${t.name} » ajouté`)
    recentlyAdded.value = new Set([...recentlyAdded.value, t.id])
    emit('added', data)
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Ajout impossible')
  } finally {
    adding.value = { ...adding.value, [t.id]: false }
  }
}
</script>

<template>
  <BaseModal :title="`Ajouter un équipement — ${systemLabel}${zoneName ? ' / ' + zoneName : ''}`"
             size="xl" :dismiss-on-backdrop="false" @close="emit('close')">
    <div v-show="view === 'library'" class="flex flex-col gap-3" data-guided-add>
      <label class="flex items-center gap-2 rounded-xl border-2 border-indigo-600 px-3 py-2">
        <FontAwesomeIcon :icon="['fas', 'magnifying-glass']" class="w-4 h-4 text-indigo-600 shrink-0" />
        <span class="sr-only">{{ ADD_SEARCH_PLACEHOLDER }}</span>
        <input ref="searchInput" v-model="search" type="text" :placeholder="ADD_SEARCH_PLACEHOLDER"
               class="min-w-0 flex-1 bg-transparent text-sm text-gray-900 outline-none focus-visible:shadow-none" />
      </label>
      <div class="flex flex-wrap items-center gap-2">
        <div v-if="hasUsageScope" role="group" aria-label="Portée de la recherche" class="flex flex-wrap gap-1.5">
          <button type="button" :aria-pressed="scope === 'usage' ? 'true' : 'false'" @click="scope = 'usage'"
                  v-tooltip="ADD_SCOPE_TIPS.usage"
                  :class="['rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition',
                           scope === 'usage' ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50']">
            {{ usageModelsLabel(system.system_category) }}
          </button>
          <button type="button" :aria-pressed="scope === 'all' ? 'true' : 'false'" @click="scope = 'all'"
                  v-tooltip="ADD_SCOPE_TIPS.all"
                  :class="['rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition',
                           scope === 'all' ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50']">
            {{ ALL_LIBRARY_LABEL }}
          </button>
        </div>
        <span class="flex-1"></span>
        <div class="w-40">
          <SearchableSelect v-model="energyFilter" :options="ENERGY_FILTER_OPTIONS" placeholder="Toutes énergies" :clearable="false" size="sm" />
        </div>
        <div class="w-40">
          <SearchableSelect v-model="roleFilter" :options="ROLE_FILTER_OPTIONS" placeholder="Toutes fonctions" :clearable="false" size="sm" />
        </div>
      </div>

      <div v-if="loading" class="py-10 text-center text-sm text-gray-500">Chargement de la bibliothèque…</div>
      <div v-else-if="!filtered.length" class="py-8 text-center text-sm text-gray-500">
        {{ ADD_NO_MATCH }}
        <button v-if="elsewhere" type="button" @click="scope = 'all'" class="ml-1 font-medium text-indigo-700 underline underline-offset-2">
          {{ elsewhereLabel(elsewhere) }}
        </button>
      </div>
      <ul v-else aria-label="Modèles de la bibliothèque" class="max-h-[46vh] overflow-y-auto -mx-1 flex flex-col">
        <li v-for="t in filtered" :key="t.id"
            class="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50">
          <EquipmentIcon :template="t" class="shrink-0" />
          <span class="min-w-0 flex-1 truncate text-sm font-medium text-gray-900" v-tooltip.overflow>{{ t.name }}</span>
          <span class="hidden sm:inline-flex items-center gap-1.5 shrink-0">
            <EnergyPill :value="t.default_energy_source" size="xs" />
            <RolePills :roles="t.default_device_role" size="xs" />
          </span>
          <Tooltip :text="isUsed(t) ? TEMPLATE_ALREADY_ADDED_TIP : ADD_TEMPLATE_TIP">
            <button type="button" @click="add(t)" :disabled="!!adding[t.id] || isUsed(t)"
                    :class="['inline-flex items-center justify-center gap-1 rounded-lg px-3 py-1 text-xs font-medium whitespace-nowrap transition',
                             isUsed(t) ? 'bg-gray-50 text-gray-400 ring-1 ring-inset ring-gray-200 cursor-not-allowed'
                                       : 'bg-white text-indigo-700 ring-1 ring-inset ring-indigo-600 hover:bg-indigo-50 disabled:opacity-50']">
              <CheckIcon v-if="isUsed(t)" class="w-3.5 h-3.5 shrink-0" />
              {{ adding[t.id] ? 'Ajout…' : isUsed(t) ? 'Déjà ajouté' : 'Ajouter' }}
            </button>
          </Tooltip>
        </li>
      </ul>
      <p class="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">{{ GUIDE_TEXTS.addNote }}</p>
    </div>

    <div v-if="view === 'manual'" class="flex flex-col gap-2">
      <button type="button" @click="view = 'library'"
              class="self-start inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700 hover:underline">
        <FontAwesomeIcon :icon="['fas', 'arrow-left']" class="w-3 h-3" /> {{ ADD_BACK_LABEL }}
      </button>
      <AddDeviceModal
        embedded
        :system-id="system.id"
        :system-label="systemLabel"
        :system-category="system.system_category"
        :zone-name="zoneName"
        :energy-options="ENERGY_OPTIONS"
        :role-options="ROLE_OPTIONS"
        :comm-options="COMM_OPTIONS"
        @created="emit('created')"
        @close="emit('close')" />
    </div>

    <template #footer>
      <div class="flex w-full items-center gap-3">
        <button v-if="view === 'library'" type="button" @click="view = 'manual'" v-tooltip="ADD_FREE_ENTRY_TIP"
                class="text-sm text-indigo-700 underline underline-offset-2 hover:text-indigo-900">
          {{ ADD_FREE_ENTRY_LABEL }}
        </button>
        <span class="flex-1"></span>
        <button type="button" @click="emit('close')"
                class="h-9 px-4 text-sm font-medium text-gray-700 rounded-lg ring-1 ring-inset ring-gray-300 hover:bg-gray-50">
          Fermer
        </button>
      </div>
    </template>
  </BaseModal>
</template>
