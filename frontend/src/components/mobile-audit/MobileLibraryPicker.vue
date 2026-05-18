<script setup>
/**
 * Page plein écran PWA pour ajouter un équipement depuis la bibliothèque
 * à un système d'audit BACS. Remplace LibraryDevicePicker (modale
 * BaseModal) en mobile pour aligner l'UX sur l'ajout manuel d'équipement
 * qui s'ouvre déjà dans un MobileSheet plein écran.
 *
 * Mêmes props/emits que LibraryDevicePicker : drop-in replacement.
 * Reste ouverte après chaque ajout pour enchaîner plusieurs équipements.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
import MobileSheet from './MobileSheet.vue'
import MobileField from './MobileField.vue'
import MobileSelectSheet from './MobileSelectSheet.vue'
import EquipmentIcon from '@/components/EquipmentIcon.vue'
import { listEquipmentTemplates, createBacsDevice } from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useAuditStore } from '@/stores/audit'
import { ENERGY_OPTIONS, ROLE_OPTIONS } from '@/lib/audit-options'

const props = defineProps({
  system: { type: Object, required: true },
  systemLabel: { type: String, required: true },
  zoneName: { type: String, default: '' },
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

// Mapping côté front cohérent avec
// backend-node/src/lib/system-categories.js::libraryCategoriesForBacsCategory.
const LIBRARY_CATS_FOR_BACS = {
  heating: ['chauffage', 'thermique_mixte'],
  cooling: ['climatisation', 'thermique_mixte'],
  ventilation: ['ventilation', 'thermique_mixte'],
  dhw: ['ecs'],
  lighting_indoor: ['eclairage_int', 'eclairage'],
  lighting_outdoor: ['eclairage_ext', 'eclairage'],
  electricity_production: ['pv', 'electricite'],
}

const templates = ref([])
const loading = ref(false)
const search = ref('')
const energyFilter = ref(null)
const roleFilter = ref(null)
const adding = ref({})
const recentlyAdded = ref(new Set())

// usage BACS → catégories mappées ; usage manuel rattaché → sa catégorie ;
// usage manuel libre → null (toute la bibliothèque).
const allowedCategories = computed(() => {
  if (props.system.is_bacs === 0) {
    return props.system.library_category_key ? [props.system.library_category_key] : null
  }
  return LIBRARY_CATS_FOR_BACS[props.system.system_category] || []
})

async function loadTemplates() {
  loading.value = true
  try {
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

// ROLE_OPTIONS décorées avec pilule colorée (cohérent avec convention
// _cover-level-band des PDF audit) : production indigo, distribution
// blue, émission amber, régulation violet, autre gray.
const ROLE_PILL_TONES = {
  production: 'indigo',
  distribution: 'blue',
  emission: 'amber',
  regulation: 'violet',
  autre: 'slate',
}
const ENERGY_FILTER_OPTIONS = computed(() =>
  ENERGY_OPTIONS.map(o => ({ ...o })), // déjà décorées avec icon/color
)
const ROLE_FILTER_OPTIONS = computed(() =>
  ROLE_OPTIONS.map(o => ({
    value: o.value,
    label: o.label,
    pill: o.label,
    pillTone: ROLE_PILL_TONES[o.value] || 'slate',
  })),
)

function normalize(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}
function rolesArr(v) {
  return Array.isArray(v) ? v : (v ? [v] : [])
}
const filtered = computed(() => {
  const q = normalize(search.value.trim())
  return templates.value.filter(t => {
    if (q && !normalize(t.name).includes(q)) return false
    if (energyFilter.value && t.default_energy_source !== energyFilter.value) return false
    if (roleFilter.value && !rolesArr(t.default_device_role).includes(roleFilter.value)) return false
    return true
  })
})

function energyLabel(value) {
  return ENERGY_OPTIONS.find(o => o.value === value)?.label || ''
}
function roleLabel(value) {
  return rolesArr(value)
    .map(v => ROLE_OPTIONS.find(o => o.value === v)?.label || v)
    .join(' / ')
}
function hasRole(value) {
  return rolesArr(value).length > 0
}

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

const title = computed(() =>
  `Bibliothèque — ${props.systemLabel}${props.zoneName ? ' / ' + props.zoneName : ''}`,
)
</script>

<template>
  <MobileSheet
    :open="true"
    :title="title"
    hide-save
    @close="emit('close')"
  >
    <div class="px-4 py-4 space-y-4">
      <p class="text-sm text-gray-600 leading-relaxed">
        Choisis un modèle pour ajouter un équipement préconfiguré (énergie, niveau).
        Tu pourras ensuite renseigner marque, référence et puissance directement sur l'équipement.
      </p>

      <!-- Recherche -->
      <div class="relative">
        <FontAwesomeIcon :icon="['fas', 'magnifying-glass']" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          v-model="search"
          type="search"
          inputmode="search"
          placeholder="Rechercher un modèle…"
          class="touch-control w-full pl-10"
        />
      </div>

      <!-- Filtres énergie + niveau -->
      <div class="grid grid-cols-2 gap-2">
        <MobileField label="Énergie">
          <MobileSelectSheet
            v-model="energyFilter"
            :options="ENERGY_FILTER_OPTIONS"
            title="Filtrer par énergie"
            placeholder="Toutes énergies"
          />
        </MobileField>
        <MobileField label="Niveau">
          <MobileSelectSheet
            v-model="roleFilter"
            :options="ROLE_FILTER_OPTIONS"
            title="Filtrer par niveau"
            placeholder="Tous niveaux"
          />
        </MobileField>
      </div>

      <!-- États -->
      <div v-if="loading" class="py-12 text-center text-sm text-gray-500">
        Chargement de la bibliothèque…
      </div>
      <div
        v-else-if="!templates.length"
        class="py-12 px-4 text-center text-sm text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200"
      >
        <FontAwesomeIcon :icon="['fas', 'book-open']" class="w-8 h-8 mx-auto mb-2 text-gray-300" />
        Aucun modèle dans la bibliothèque pour « {{ systemLabel }} » pour le moment.
      </div>
      <div
        v-else-if="!filtered.length"
        class="py-12 text-center text-sm text-gray-500"
      >
        Aucun modèle ne correspond aux filtres.
      </div>

      <!-- Liste de cards -->
      <ul v-else class="space-y-2">
        <li
          v-for="t in filtered"
          :key="t.id"
          class="bg-white border border-gray-200 rounded-xl overflow-hidden"
        >
          <!-- Card complète tappable + bouton Ajouter dédié -->
          <button
            type="button"
            @click="pickTemplate(t)"
            :disabled="!!adding[t.id] || isUsed(t)"
            class="w-full flex items-start gap-3 px-3 py-3 text-left active:bg-gray-50 disabled:opacity-60"
          >
            <EquipmentIcon :template="t" size="md" class="mt-0.5" />
            <div class="min-w-0 flex-1">
              <div class="font-medium text-base text-gray-900 leading-snug">{{ t.name }}</div>
              <div class="mt-1 text-xs text-gray-500 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span v-if="t.default_energy_source">{{ energyLabel(t.default_energy_source) }}</span>
                <span v-if="t.default_energy_source && hasRole(t.default_device_role)" class="text-gray-300">·</span>
                <span v-if="hasRole(t.default_device_role)">{{ roleLabel(t.default_device_role) }}</span>
                <span v-if="!t.default_energy_source && !hasRole(t.default_device_role)" class="text-gray-300">—</span>
              </div>
            </div>
          </button>
          <div
            :class="[
              'px-3 pb-3',
              recentlyAdded.has(t.id) ? '' : '',
            ]"
          >
            <button
              type="button"
              @click="pickTemplate(t)"
              :disabled="!!adding[t.id] || isUsed(t)"
              :class="[
                'w-full min-h-11 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-base font-medium rounded-lg transition',
                isUsed(t)
                  ? 'bg-gray-50 text-gray-400 border border-gray-200'
                  : 'bg-emerald-600 text-white active:bg-emerald-700 disabled:opacity-50',
              ]"
            >
              <FontAwesomeIcon v-if="isUsed(t)" :icon="['fas', 'check']" class="w-4 h-4 shrink-0" />
              {{ adding[t.id] ? 'Ajout…' : isUsed(t) ? 'Déjà ajouté' : 'Ajouter' }}
            </button>
          </div>
        </li>
      </ul>

      <!-- Espace de respiration en bas -->
      <div class="h-2"></div>
    </div>
  </MobileSheet>
</template>
