<script setup>
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import {
  WrenchScrewdriverIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  TrashIcon,
  PlusIcon,
  BookOpenIcon,
} from '@heroicons/vue/24/outline'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import { updateBacsSystem, createBacsDevice, updateBacsDevice, deleteBacsDevice, updateBacsThermal } from '@/api'
import MobileField from './MobileField.vue'
import MobileSheet from './MobileSheet.vue'
import LibraryDevicePicker from '@/components/LibraryDevicePicker.vue'
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import SearchableSelect from '@/components/SearchableSelect.vue'
import {
  PRODUCTION_REGULATION_OPTIONS,
  DISTRIBUTION_REGULATION_OPTIONS,
  EMISSION_REGULATION_OPTIONS,
} from '@/composables/thermalRegulationOptions'

const audit = useAuditStore()
const { document, systems, devices, zones, powerSummary, thermal } = storeToRefs(audit)
const { error, success } = useNotification()
const { confirm } = useConfirm()

const isBacs = computed(() => (document.value?.kind || 'bacs_audit') === 'bacs_audit')

const REGULATION_OPTIONS = [
  { value: null, label: '— Sélectionner —' },
  { value: 'per_room', label: 'Par pièce' },
  { value: 'per_zone', label: 'Par zone' },
  { value: 'central_only', label: 'Centrale uniquement' },
  { value: 'none', label: 'Aucune' },
]
const GENERATOR_OPTIONS = [
  { value: null, label: '— Sélectionner —' },
  { value: 'gas', label: 'Gaz' },
  { value: 'electric', label: 'Effet Joule' },
  { value: 'heat_pump', label: 'Pompe à chaleur' },
  { value: 'wood_appliance', label: 'Appareil bois (exempté R175-6)' },
  { value: 'district_heating', label: 'Réseau de chaleur' },
  { value: 'other', label: 'Autre' },
]

let thermalSaveTimer = null
async function patchThermal(t, patch) {
  Object.assign(t, patch)
  clearTimeout(thermalSaveTimer)
  thermalSaveTimer = setTimeout(async () => {
    try {
      await updateBacsThermal(t.id, patch)
      await audit.refreshActionItems()
    } catch { error('Sauvegarde régulation impossible') }
  }, 400)
}

// Régulation thermique pour un (zone, catégorie) donné
function thermalFor(zoneId, category) {
  return thermal.value.find(t => t.zone_id === zoneId && (t.category || 'heating') === category)
}

// Options de devices (chaud/froid) d'une zone, formatées pour
// SearchableSelect. Sert aux 3 niveaux Production / Distribution / Émission.
function deviceOptions(zoneId, category) {
  const sysIds = systems.value
    .filter(s => s.zone_id === zoneId && s.present && s.system_category === category)
    .map(s => s.id)
  return devices.value
    .filter(d => sysIds.includes(d.system_id))
    .map(d => ({
      value: d.id,
      label: d.name || d.brand || d.model_reference || `Équipement #${d.id}`,
      hint: d.brand && d.model_reference ? `${d.brand} ${d.model_reference}` : (d.brand || d.model_reference || ''),
    }))
}

const SYSTEM_LABEL = {
  heating: 'Chauffage',
  cooling: 'Refroidissement',
  ventilation: 'Ventilation',
  dhw: 'ECS',
  lighting_indoor: 'Éclairage intérieur',
  lighting_outdoor: 'Éclairage extérieur',
  electricity_production: 'Production photovoltaïque',
}
// Phrase négative cohérente avec le label positif. Utilisée quand
// l'auditeur a marqué l'usage "Absent" (= not_concerned=true).
const SYSTEM_NEGATIVE_LABEL = {
  heating: 'Pas de chauffage dans cette zone',
  cooling: 'Pas de refroidissement',
  ventilation: 'Pas de ventilation mécanique',
  dhw: 'Pas d\'ECS',
  lighting_indoor: 'Pas d\'éclairage intérieur',
  lighting_outdoor: 'Pas d\'éclairage extérieur',
  electricity_production: 'Pas de production photovoltaïque',
}
const ENERGY_OPTIONS = [
  { value: null, label: '—' },
  { value: 'gas', label: 'Gaz' },
  { value: 'electric', label: 'Électrique' },
  { value: 'wood', label: 'Bois' },
  { value: 'heat_pump', label: 'PAC' },
  { value: 'district_heating', label: 'Réseau de chaleur' },
  { value: 'fuel_oil', label: 'Fioul' },
  { value: 'solar', label: 'Solaire' },
  { value: 'biomass', label: 'Biomasse' },
  { value: 'autre', label: 'Autre' },
]
const ROLE_OPTIONS = [
  { value: null, label: '—' },
  { value: 'production', label: 'Production' },
  { value: 'distribution', label: 'Distribution' },
  { value: 'emission', label: 'Émission' },
  { value: 'regulation', label: 'Régulation' },
  { value: 'autre', label: 'Autre' },
]

const collapsedZones = ref(new Set())
function toggleZone(zoneId) {
  const s = new Set(collapsedZones.value)
  if (s.has(zoneId)) s.delete(zoneId); else s.add(zoneId)
  collapsedZones.value = s
}

const systemsByZone = computed(() => {
  const groups = new Map()
  for (const s of systems.value) {
    // Garder les usages "non concerné" (= Absent dans le toggle mobile) :
    // ils sont rendus grisés / atténués dans le template au lieu d'être
    // cachés, pour que l'auditeur puisse les réactiver d'un clic.
    const k = s.zone_id
    if (!groups.has(k)) groups.set(k, { zone_id: s.zone_id, zone_name: s.zone_name, items: [] })
    groups.get(k).items.push(s)
  }
  return [...groups.values()]
})

function devicesOf(systemId) {
  return devices.value.filter(d => d.system_id === systemId)
}

async function patchSystem(s, patch) {
  Object.assign(s, patch)
  try {
    await updateBacsSystem(s.id, patch)
    await audit.refreshActionItems()
  } catch { error('Sauvegarde impossible') }
}

// Device sheet
const editingDevice = ref(null)
const deviceForm = ref({})
const savingDevice = ref(false)

// Libellés de catégories de systèmes (alignés sur SYSTEM_LABEL desktop).
const systemLabels = {
  heating: 'Chauffage',
  cooling: 'Refroidissement',
  ventilation: 'Ventilation',
  dhw: 'ECS',
  lighting_indoor: 'Éclairage intérieur',
  lighting_outdoor: 'Éclairage extérieur',
  electricity_production: 'Production photovoltaïque',
}

// Bibliothèque de modèles (préfiltrée par catégorie)
const libraryDevicePickerSystem = ref(null)
function openLibraryDevicePicker(system) {
  libraryDevicePickerSystem.value = {
    id: system.id,
    system_category: system.system_category,
    zone_name: zones.value.find(z => z.zone_id === system.zone_id)?.name || '',
  }
}

function openCreateDevice(system) {
  deviceForm.value = {
    name: '', brand: '', model_reference: '', power_kw: null,
    energy_source: null, device_role: null, location: '',
  }
  editingDevice.value = { mode: 'create', system }
}
function openEditDevice(d, system) {
  deviceForm.value = { ...d }
  editingDevice.value = { mode: 'edit', system, device: d }
}
function closeDevice() { editingDevice.value = null }

async function saveDevice() {
  savingDevice.value = true
  try {
    const payload = {
      name: deviceForm.value.name?.trim() || null,
      brand: deviceForm.value.brand?.trim() || null,
      model_reference: deviceForm.value.model_reference?.trim() || null,
      power_kw: deviceForm.value.power_kw === '' || deviceForm.value.power_kw === null ? null : Number(deviceForm.value.power_kw),
      energy_source: deviceForm.value.energy_source,
      device_role: deviceForm.value.device_role,
      location: deviceForm.value.location?.trim() || null,
    }
    if (!payload.name && !payload.brand && !payload.model_reference) {
      error('Renseigne au moins un nom, une marque ou une référence')
      return
    }
    if (editingDevice.value.mode === 'create') {
      await createBacsDevice(editingDevice.value.system.id, payload)
      await audit.refreshAuditCore()
      success('Équipement ajouté')
    } else {
      const { data } = await updateBacsDevice(editingDevice.value.device.id, payload)
      Object.assign(editingDevice.value.device, data)
      await audit.refreshAuditCore()
      success('Équipement mis à jour')
    }
    closeDevice()
  } catch (e) {
    error(e.response?.data?.detail || 'Sauvegarde impossible')
  } finally {
    savingDevice.value = false
  }
}

async function removeDevice(d) {
  const ok = await confirm({
    title: 'Supprimer cet équipement ?',
    message: `« ${d.name || d.brand || d.model_reference || `Équipement #${d.id}`} »`,
    confirmLabel: 'Supprimer', danger: true,
  })
  if (!ok) return
  try {
    await deleteBacsDevice(d.id)
    await audit.refreshAuditCore()
    if (editingDevice.value?.device?.id === d.id) closeDevice()
  } catch {
    error('Suppression impossible')
  }
}
</script>

<template>
  <div class="p-3 space-y-3">
    <!-- Stat puissance -->
    <div class="bg-white rounded-2xl border border-gray-200 p-4 flex items-center gap-4">
      <div class="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 inline-flex items-center justify-center">
        <WrenchScrewdriverIcon class="w-6 h-6" />
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-2xl font-medium text-gray-900 leading-none">
          {{ powerSummary.heating_cooling_total_kw || 0 }} <span class="text-sm text-gray-500">kW</span>
        </p>
        <p class="text-xs text-gray-500 mt-1">Chauffage + climatisation cumulé</p>
      </div>
    </div>

    <!-- Liste par zone -->
    <div v-if="systemsByZone.length" class="space-y-3">
      <div
        v-for="g in systemsByZone"
        :key="g.zone_id"
        class="bg-white rounded-2xl border border-gray-200 overflow-hidden"
      >
        <!-- Header zone -->
        <button
          type="button"
          @click="toggleZone(g.zone_id)"
          class="w-full flex items-center gap-2 px-4 py-3 border-b border-gray-100 active:bg-gray-50"
        >
          <ChevronDownIcon
            :class="['w-4 h-4 text-gray-400 transition-transform shrink-0',
                     collapsedZones.has(g.zone_id) ? '-rotate-90' : '']"
          />
          <p class="flex-1 min-w-0 text-base font-medium text-gray-900 truncate text-left">{{ g.zone_name }}</p>
          <span class="text-xs text-gray-500 shrink-0">{{ g.items.filter(i => i.present).length }}/{{ g.items.length }}</span>
        </button>

        <!-- Systèmes -->
        <div v-show="!collapsedZones.has(g.zone_id)" class="divide-y divide-gray-100">
          <div v-for="s in g.items" :key="s.id"
               :class="['px-4 py-4 transition',
                        s.not_concerned ? 'opacity-50 bg-gray-50' : '']">
            <div class="flex items-center gap-3">
              <SystemCategoryIcon :category="s.system_category" size="md" />
              <div class="flex-1 min-w-0">
                <p class="text-base font-medium text-gray-900 truncate leading-tight">
                  {{ SYSTEM_LABEL[s.system_category] || s.system_category }}
                </p>
                <p v-if="s.not_concerned" class="text-sm text-gray-500 mt-1 italic">
                  {{ SYSTEM_NEGATIVE_LABEL[s.system_category] || 'Non concerné' }}
                </p>
                <p v-else-if="devicesOf(s.id).length" class="text-sm text-gray-500 mt-1">
                  {{ devicesOf(s.id).length }} équipement{{ devicesOf(s.id).length > 1 ? 's' : '' }}
                </p>
                <p v-else-if="s.present" class="text-xs text-emerald-600 mt-1">
                  Présent — ajoute des équipements ci-dessous
                </p>
                <p v-else class="text-xs text-gray-400 mt-1">
                  À renseigner : présent ou absent ?
                </p>
              </div>
            </div>
            <!-- Segmented control 2 états : Présent / Absent (= not_concerned).
                 Le 3e cas (rien de coché) est l'état initial par défaut. -->
            <div class="mt-3 grid grid-cols-2 gap-2">
              <button type="button"
                      @click="patchSystem(s, { present: true, not_concerned: false })"
                      :class="['py-3 px-3 text-sm font-medium rounded-xl border-2 transition',
                               s.present && !s.not_concerned
                                 ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                                 : 'border-gray-200 bg-white text-gray-600']">
                ✓ Présent
              </button>
              <button type="button"
                      @click="patchSystem(s, { present: false, not_concerned: true })"
                      :class="['py-3 px-3 text-sm font-medium rounded-xl border-2 transition',
                               s.not_concerned
                                 ? 'border-gray-400 bg-gray-100 text-gray-700'
                                 : 'border-gray-200 bg-white text-gray-600']">
                ✕ Absent
              </button>
            </div>

            <!-- Devices nested -->
            <div v-if="s.present" class="mt-3 pl-2 border-l-2 border-gray-100 space-y-1.5">
              <button
                v-for="d in devicesOf(s.id)"
                :key="d.id"
                @click="openEditDevice(d, s)"
                class="w-full flex items-center gap-2 px-3 py-3.5 bg-gray-50 hover:bg-gray-100 rounded-xl text-left"
              >
                <div class="flex-1 min-w-0">
                  <p class="text-base font-medium text-gray-800 truncate leading-tight">
                    {{ d.name || d.brand || d.model_reference || `Équipement #${d.id}` }}
                  </p>
                  <p class="text-sm text-gray-500 truncate mt-0.5">
                    <span v-if="d.brand">{{ d.brand }}</span>
                    <span v-if="d.power_kw"> · {{ d.power_kw }} kW</span>
                  </p>
                </div>
                <ChevronRightIcon class="w-5 h-5 text-gray-300" />
              </button>
              <div class="flex items-stretch gap-1.5">
                <button
                  @click="openCreateDevice(s)"
                  class="flex-1 inline-flex items-center justify-center gap-2 px-3 py-3.5 text-base text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-xl font-medium whitespace-nowrap"
                >
                  <PlusIcon class="w-5 h-5 shrink-0" /> Ajouter
                </button>
                <button
                  @click="openLibraryDevicePicker(s)"
                  class="flex-1 inline-flex items-center justify-center gap-2 px-3 py-3.5 text-base text-emerald-700 bg-white hover:bg-emerald-50 border border-emerald-200 rounded-xl font-medium whitespace-nowrap"
                >
                  <BookOpenIcon class="w-5 h-5 shrink-0" /> Bibliothèque
                </button>
              </div>
            </div>

            <!-- Régulation thermique R175-6 (heating + cooling présents en mode BACS) -->
            <div
              v-if="isBacs && s.present && (s.system_category === 'heating' || s.system_category === 'cooling') && thermalFor(s.zone_id, s.system_category)"
              class="mt-4 p-4 bg-amber-50/60 border border-amber-200 rounded-xl space-y-4"
            >
              <p class="text-sm font-semibold text-amber-800 uppercase tracking-wider">
                Régulation thermique <span class="font-normal opacity-70">— R175-6</span>
              </p>

              <!-- Régulation auto avec explication -->
              <label class="flex items-start justify-between gap-3 px-4 py-4 bg-white rounded-xl cursor-pointer border border-gray-100">
                <div class="flex-1 min-w-0">
                  <p class="text-base text-gray-900 font-medium">Régulation automatique présente ?</p>
                  <p class="text-sm text-gray-500 mt-1 leading-relaxed">
                    Système qui ajuste seul la température (thermostat connecté, sonde + vanne motorisée, GTB…).
                  </p>
                </div>
                <input
                  type="checkbox"
                  :checked="!!thermalFor(s.zone_id, s.system_category)?.has_automatic_regulation"
                  @change="e => patchThermal(thermalFor(s.zone_id, s.system_category), { has_automatic_regulation: e.target.checked })"
                  class="mt-1 shrink-0"
                />
              </label>

              <template v-if="thermalFor(s.zone_id, s.system_category)?.has_automatic_regulation">
                <div class="px-4 py-4 bg-white rounded-xl border border-gray-100 space-y-2">
                  <p class="text-sm font-semibold text-gray-700">Granularité</p>
                  <SearchableSelect
                    :model-value="thermalFor(s.zone_id, s.system_category)?.regulation_type"
                    @update:modelValue="v => patchThermal(thermalFor(s.zone_id, s.system_category), { regulation_type: v || null })"
                    :options="REGULATION_OPTIONS.filter(x => x.value)"
                    placeholder="— Sélectionner —" />
                </div>

                <!-- Production : équipement + (si rempli) Type, Âge, Régulation -->
                <div class="px-4 py-4 bg-white rounded-xl border border-gray-100 space-y-3">
                  <p class="text-sm font-semibold text-gray-700">🔧 Production</p>
                  <SearchableSelect
                    :model-value="thermalFor(s.zone_id, s.system_category)?.generator_device_id"
                    @update:modelValue="v => patchThermal(thermalFor(s.zone_id, s.system_category), { generator_device_id: v != null ? parseInt(v, 10) : null })"
                    :options="deviceOptions(s.zone_id, s.system_category)"
                    placeholder="— aucun équipement"
                    search-placeholder="Rechercher un équipement…" />
                  <div v-if="thermalFor(s.zone_id, s.system_category)?.generator_device_id" class="space-y-3 pl-4 border-l-4 border-amber-300">
                    <div class="space-y-1.5">
                      <p class="text-xs font-medium text-gray-500">Type de production</p>
                      <SearchableSelect
                        :model-value="thermalFor(s.zone_id, s.system_category)?.generator_type"
                        @update:modelValue="v => patchThermal(thermalFor(s.zone_id, s.system_category), { generator_type: v || null })"
                        :options="GENERATOR_OPTIONS.filter(x => x.value)"
                        creatable placeholder="ex : pompe à chaleur, chaudière…" />
                    </div>
                    <div class="space-y-1.5">
                      <p class="text-xs font-medium text-gray-500">Âge de l'équipement (ans)</p>
                      <input
                        type="number" inputmode="numeric" pattern="[0-9]*" min="0"
                        :value="thermalFor(s.zone_id, s.system_category)?.generator_age_years"
                        @blur="e => patchThermal(thermalFor(s.zone_id, s.system_category), { generator_age_years: e.target.value ? parseInt(e.target.value, 10) : null })"
                        placeholder="ex : 8"
                        class="w-full px-4 py-3 text-base border border-gray-200 rounded-lg bg-white" />
                    </div>
                    <div class="space-y-1.5">
                      <p class="text-xs font-medium text-gray-500">Régulation côté production</p>
                      <SearchableSelect
                        :model-value="thermalFor(s.zone_id, s.system_category)?.production_regulation"
                        @update:modelValue="v => patchThermal(thermalFor(s.zone_id, s.system_category), { production_regulation: v || null })"
                        :options="PRODUCTION_REGULATION_OPTIONS"
                        creatable placeholder="ex : sonde extérieure…" />
                    </div>
                  </div>
                </div>

                <!-- Distribution : équipement + (si rempli) Régulation -->
                <div class="px-4 py-4 bg-white rounded-xl border border-gray-100 space-y-3">
                  <p class="text-sm font-semibold text-gray-700">🚰 Distribution</p>
                  <SearchableSelect
                    :model-value="thermalFor(s.zone_id, s.system_category)?.distribution_device_id"
                    @update:modelValue="v => patchThermal(thermalFor(s.zone_id, s.system_category), { distribution_device_id: v != null ? parseInt(v, 10) : null })"
                    :options="deviceOptions(s.zone_id, s.system_category)"
                    placeholder="— aucune (DRV, poêle…)"
                    search-placeholder="Rechercher un équipement…" />
                  <div v-if="thermalFor(s.zone_id, s.system_category)?.distribution_device_id" class="space-y-1.5 pl-4 border-l-4 border-amber-300">
                    <p class="text-xs font-medium text-gray-500">Régulation côté distribution</p>
                    <SearchableSelect
                      :model-value="thermalFor(s.zone_id, s.system_category)?.distribution_regulation"
                      @update:modelValue="v => patchThermal(thermalFor(s.zone_id, s.system_category), { distribution_regulation: v || null })"
                      :options="DISTRIBUTION_REGULATION_OPTIONS"
                      creatable placeholder="ex : pompe ΔP variable…" />
                  </div>
                </div>

                <!-- Émission : équipement + (si rempli) Régulation -->
                <div class="px-4 py-4 bg-white rounded-xl border border-gray-100 space-y-3">
                  <p class="text-sm font-semibold text-gray-700">♨️ Émission</p>
                  <SearchableSelect
                    :model-value="thermalFor(s.zone_id, s.system_category)?.emission_device_id"
                    @update:modelValue="v => patchThermal(thermalFor(s.zone_id, s.system_category), { emission_device_id: v != null ? parseInt(v, 10) : null })"
                    :options="deviceOptions(s.zone_id, s.system_category)"
                    placeholder="— aucun"
                    search-placeholder="Rechercher un équipement…" />
                  <div v-if="thermalFor(s.zone_id, s.system_category)?.emission_device_id" class="space-y-1.5 pl-4 border-l-4 border-amber-300">
                    <p class="text-xs font-medium text-gray-500">Régulation côté émission</p>
                    <SearchableSelect
                      :model-value="thermalFor(s.zone_id, s.system_category)?.emission_regulation"
                      @update:modelValue="v => patchThermal(thermalFor(s.zone_id, s.system_category), { emission_regulation: v || null })"
                      :options="EMISSION_REGULATION_OPTIONS"
                      creatable placeholder="ex : robinets thermostatiques…" />
                  </div>
                </div>
              </template>

              <!-- Exempté bois — uniquement pour le chauffage (R175-6 II ne traite que les appareils de chauffage au bois) -->
              <label v-if="s.system_category === 'heating'"
                     class="flex items-start justify-between gap-3 px-4 py-4 bg-white rounded-xl cursor-pointer border border-gray-100">
                <div class="flex-1 min-w-0">
                  <p class="text-base text-gray-900 font-medium">Exempté — appareil bois</p>
                  <p class="text-sm text-gray-500 mt-1 leading-relaxed">
                    Cocher si la production est un appareil <strong>indépendant</strong> de chauffage au bois (poêle, insert). Exempté de R175-6 (II du décret).
                  </p>
                </div>
                <input
                  type="checkbox"
                  :checked="!!thermalFor(s.zone_id, s.system_category)?.generator_exempt_wood"
                  @change="e => patchThermal(thermalFor(s.zone_id, s.system_category), { generator_exempt_wood: e.target.checked })"
                  class="mt-1 shrink-0"
                />
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="bg-white rounded-2xl border border-dashed border-gray-300 p-8 text-center">
      <WrenchScrewdriverIcon class="w-10 h-10 text-gray-300 mx-auto" />
      <p class="text-sm text-gray-500 mt-3">Pas encore de systèmes</p>
      <p class="text-xs text-gray-400 mt-1">Crée d'abord des zones, les systèmes apparaîtront ici</p>
    </div>

    <!-- Sheet édition device -->
    <MobileSheet
      :open="!!editingDevice"
      :title="editingDevice?.mode === 'create' ? 'Nouvel équipement' : 'Équipement'"
      :saving="savingDevice"
      @close="closeDevice"
      @save="saveDevice"
    >
      <div class="p-4 space-y-4">
        <p v-if="editingDevice?.system" class="text-xs text-gray-500">
          {{ SYSTEM_LABEL[editingDevice.system.system_category] || editingDevice.system.system_category }} —
          {{ editingDevice.system.zone_name }}
        </p>

        <MobileField label="Nom">
          <input
            v-model="deviceForm.name"
            type="text"
            placeholder="ex : Chaudière gaz principale"
            autocapitalize="sentences"
            class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
          />
        </MobileField>

        <div class="grid grid-cols-2 gap-3">
          <MobileField label="Marque">
            <input
              v-model="deviceForm.brand"
              type="text"
              placeholder="ex : Atlantic"
              autocapitalize="words"
              class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
            />
          </MobileField>
          <MobileField label="Référence">
            <input
              v-model="deviceForm.model_reference"
              type="text"
              placeholder="ex : Varmax 70"
              class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
            />
          </MobileField>
        </div>

        <MobileField label="Puissance (kW)">
          <input
            v-model.number="deviceForm.power_kw"
            type="number"
            inputmode="decimal"
            pattern="[0-9.,]*"
            min="0"
            step="0.1"
            placeholder="—"
            class="w-full px-4 py-3 border border-gray-200 rounded-xl bg-white text-right font-medium"
          />
        </MobileField>

        <MobileField label="Énergie">
          <select
            v-model="deviceForm.energy_source"
            class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
          >
            <option v-for="o in ENERGY_OPTIONS" :key="o.value || 'null'" :value="o.value">{{ o.label }}</option>
          </select>
        </MobileField>

        <MobileField label="Nature">
          <select
            v-model="deviceForm.device_role"
            class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
          >
            <option v-for="o in ROLE_OPTIONS" :key="o.value || 'null'" :value="o.value">{{ o.label }}</option>
          </select>
        </MobileField>

        <MobileField label="Localisation">
          <input
            v-model="deviceForm.location"
            type="text"
            placeholder="ex : Local technique sous-sol"
            autocapitalize="sentences"
            class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
          />
        </MobileField>

        <template v-if="editingDevice?.mode === 'edit' && document?.site_uuid">
          <div class="pt-2">
            <p class="text-xs font-medium text-gray-600 uppercase tracking-wider mb-2">Photos</p>
            <BacsPhotoButton
              :site-uuid="document.site_uuid"
              :attach-to="{ device_id: editingDevice.device.id }"
              :label="editingDevice.device.name || editingDevice.device.brand || `Équipement #${editingDevice.device.id}`"
              size="md"
            />
          </div>

          <div class="pt-4 border-t border-gray-200">
            <button
              @click="removeDevice(editingDevice.device)"
              class="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-red-600 bg-red-50 border border-red-200 rounded-xl font-medium"
            >
              <TrashIcon class="w-5 h-5" />
              Supprimer l'équipement
            </button>
          </div>
        </template>
      </div>
    </MobileSheet>

    <!-- Modale bibliothèque (BaseModal s'adapte mobile via max-w-[92vw]) -->
    <LibraryDevicePicker
      v-if="libraryDevicePickerSystem"
      :system="libraryDevicePickerSystem"
      :system-label="systemLabels[libraryDevicePickerSystem.system_category] || libraryDevicePickerSystem.system_category"
      :zone-name="libraryDevicePickerSystem.zone_name || ''"
      @close="libraryDevicePickerSystem = null"
      @added="audit.refreshAuditCore()"
    />
  </div>
</template>
