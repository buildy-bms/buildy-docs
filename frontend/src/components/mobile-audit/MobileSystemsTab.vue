<script setup>
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import {
  WrenchScrewdriverIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  TrashIcon,
  PlusIcon,
} from '@heroicons/vue/24/outline'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import { updateBacsSystem, createBacsDevice, updateBacsDevice, deleteBacsDevice } from '@/api'
import MobileField from './MobileField.vue'
import MobileSheet from './MobileSheet.vue'
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'

const audit = useAuditStore()
const { document, systems, devices, zones, powerSummary } = storeToRefs(audit)
const { error, success } = useNotification()
const { confirm } = useConfirm()

const SYSTEM_LABEL = {
  heating: 'Chauffage',
  cooling: 'Refroidissement',
  ventilation: 'Ventilation',
  dhw: 'ECS',
  lighting_indoor: 'Éclairage intérieur',
  lighting_outdoor: 'Éclairage extérieur',
  electricity_production: 'Production photovoltaïque',
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
    if (s.not_concerned) continue
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
  <div class="p-3 pb-24 space-y-3">
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
          <div v-for="s in g.items" :key="s.id" class="px-4 py-3">
            <div class="flex items-center gap-3">
              <SystemCategoryIcon :category="s.system_category" size="md" />
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-gray-900 truncate">
                  {{ SYSTEM_LABEL[s.system_category] || s.system_category }}
                </p>
                <p v-if="devicesOf(s.id).length" class="text-xs text-gray-500 mt-0.5">
                  {{ devicesOf(s.id).length }} équipement{{ devicesOf(s.id).length > 1 ? 's' : '' }}
                </p>
              </div>
              <label class="inline-flex items-center gap-2 cursor-pointer shrink-0">
                <span class="text-xs text-gray-600">Présent</span>
                <input
                  type="checkbox"
                  :checked="!!s.present"
                  @change="e => patchSystem(s, { present: e.target.checked })"
                  class="w-5 h-5"
                />
              </label>
            </div>

            <!-- Devices nested -->
            <div v-if="s.present" class="mt-3 pl-2 border-l-2 border-gray-100 space-y-1.5">
              <button
                v-for="d in devicesOf(s.id)"
                :key="d.id"
                @click="openEditDevice(d, s)"
                class="w-full flex items-center gap-2 px-3 py-2.5 bg-gray-50 hover:bg-gray-100 rounded-xl text-left"
              >
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-gray-800 truncate">
                    {{ d.name || d.brand || d.model_reference || `Équipement #${d.id}` }}
                  </p>
                  <p class="text-xs text-gray-500 truncate">
                    <span v-if="d.brand">{{ d.brand }}</span>
                    <span v-if="d.power_kw"> · {{ d.power_kw }} kW</span>
                  </p>
                </div>
                <ChevronRightIcon class="w-4 h-4 text-gray-300" />
              </button>
              <button
                @click="openCreateDevice(s)"
                class="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-xl font-medium"
              >
                <PlusIcon class="w-4 h-4" /> Ajouter un équipement
              </button>
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
            class="w-full px-4 py-3 border border-gray-200 rounded-xl bg-white"
          />
        </MobileField>

        <div class="grid grid-cols-2 gap-3">
          <MobileField label="Marque">
            <input
              v-model="deviceForm.brand"
              type="text"
              placeholder="ex : Atlantic"
              autocapitalize="words"
              class="w-full px-4 py-3 border border-gray-200 rounded-xl bg-white"
            />
          </MobileField>
          <MobileField label="Référence">
            <input
              v-model="deviceForm.model_reference"
              type="text"
              placeholder="ex : Varmax 70"
              class="w-full px-4 py-3 border border-gray-200 rounded-xl bg-white"
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
            class="w-full px-4 py-3 border border-gray-200 rounded-xl bg-white"
          >
            <option v-for="o in ENERGY_OPTIONS" :key="o.value || 'null'" :value="o.value">{{ o.label }}</option>
          </select>
        </MobileField>

        <MobileField label="Nature">
          <select
            v-model="deviceForm.device_role"
            class="w-full px-4 py-3 border border-gray-200 rounded-xl bg-white"
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
            class="w-full px-4 py-3 border border-gray-200 rounded-xl bg-white"
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
  </div>
</template>
