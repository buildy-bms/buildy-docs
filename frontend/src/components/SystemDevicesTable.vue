<script setup>
import { ref, computed } from 'vue'
import { TrashIcon, PlusIcon } from '@heroicons/vue/24/outline'
import {
  createBacsDevice, updateBacsDevice, deleteBacsDevice,
} from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'

/**
 * Sous-table éditable des équipements (devices) d'un système BACS donné.
 * Affichée sous chaque ligne (catégorie × zone) de la section 3.
 *
 * Affiche aussi les 2 cases R175-3 §3 (interopérabilité) et §4 (arrêt
 * manuel + autonome) au niveau du système (cf m38 — déplacées de GTB
 * vers system).
 */
const props = defineProps({
  system: { type: Object, required: true },           // bacs_audit_systems row
  devices: { type: Array, required: true, default: () => [] },  // bacs_audit_system_devices rows
  systemLabel: { type: String, required: true },      // libellé FR de la catégorie
})
const emit = defineEmits(['changed', 'system-updated'])

const { success, error } = useNotification()
const { confirm } = useConfirm()

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
  { value: 'autre', label: 'Autre' },
]

const newDevice = ref({
  brand: '', model_reference: '', power_kw: null,
  energy_source: null, device_role: null, location: '', notes: '',
})

const totalPowerKw = computed(() =>
  props.devices.reduce((s, d) => s + (Number(d.power_kw) || 0), 0)
)

async function addDevice() {
  if (!newDevice.value.brand && !newDevice.value.model_reference && !newDevice.value.power_kw) {
    error('Renseigne au moins une marque, une référence ou une puissance')
    return
  }
  try {
    await createBacsDevice(props.system.id, {
      brand: newDevice.value.brand || null,
      model_reference: newDevice.value.model_reference || null,
      power_kw: newDevice.value.power_kw === '' ? null : Number(newDevice.value.power_kw),
      energy_source: newDevice.value.energy_source,
      device_role: newDevice.value.device_role,
      location: newDevice.value.location || null,
      notes: newDevice.value.notes || null,
    })
    newDevice.value = {
      brand: '', model_reference: '', power_kw: null,
      energy_source: null, device_role: null, location: '', notes: '',
    }
    emit('changed')
  } catch (e) {
    error(e.response?.data?.detail || 'Création impossible')
  }
}

async function patchDevice(d, patch) {
  try {
    const { data } = await updateBacsDevice(d.id, patch)
    Object.assign(d, data)
    emit('changed')
  } catch {
    error('Sauvegarde impossible')
  }
}

async function removeDevice(d) {
  const ok = await confirm({
    title: 'Supprimer cet équipement ?',
    message: `« ${d.brand || d.model_reference || `Équipement #${d.id}`} »`,
    confirmLabel: 'Supprimer', danger: true,
  })
  if (!ok) return
  try {
    await deleteBacsDevice(d.id)
    emit('changed')
  } catch {
    error('Suppression impossible')
  }
}
</script>

<template>
  <div class="bg-gray-50/40 border-l-2 border-indigo-200 ml-3 pl-4 py-2">
    <!-- Header avec puissance totale + cases R175-3 §3/§4 -->
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-3 text-xs text-gray-600">
        <span class="font-semibold text-gray-700">{{ systemLabel }}</span>
        <span v-if="totalPowerKw > 0" class="text-emerald-700 font-mono">
          {{ totalPowerKw }} kW total ({{ devices.length }} {{ devices.length > 1 ? 'équipements' : 'équipement' }})
        </span>
        <span v-else class="text-gray-400 italic">aucun équipement saisi</span>
      </div>
      <div class="flex items-center gap-3 text-xs">
        <label class="inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
               title="R175-3 §3 — Interopérabilité (BACnet/Modbus/KNX/M-Bus/MQTT)">
          <input type="checkbox" :checked="system.meets_r175_3_p3 === 1"
                 :indeterminate.prop="system.meets_r175_3_p3 == null"
                 @change="e => emit('system-updated', { meets_r175_3_p3: e.target.checked })"
                 class="rounded border-gray-300" />
          <span class="text-gray-700">Interop. R175-3 §3</span>
        </label>
        <label class="inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
               title="R175-3 §4 — Arrêt manuel + reprise autonome par la GTB">
          <input type="checkbox" :checked="system.meets_r175_3_p4 === 1"
                 :indeterminate.prop="system.meets_r175_3_p4 == null"
                 @change="e => emit('system-updated', { meets_r175_3_p4: e.target.checked })"
                 class="rounded border-gray-300" />
          <span class="text-gray-700">Arrêt manuel R175-3 §4</span>
        </label>
      </div>
    </div>

    <!-- Table devices -->
    <table v-if="devices.length || true" class="w-full text-xs">
      <thead v-if="devices.length" class="text-[10px] uppercase text-gray-500 tracking-wider">
        <tr>
          <th class="text-left py-1 whitespace-nowrap">Marque</th>
          <th class="text-left py-1 whitespace-nowrap">Référence</th>
          <th class="text-left py-1 whitespace-nowrap w-28">Énergie</th>
          <th class="text-left py-1 whitespace-nowrap w-24">Puissance (kW)</th>
          <th class="text-left py-1 whitespace-nowrap w-32">Rôle</th>
          <th class="text-left py-1 whitespace-nowrap">Localisation</th>
          <th class="text-left py-1 whitespace-nowrap">Notes</th>
          <th class="text-right py-1 w-8"></th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-200">
        <tr v-for="d in devices" :key="d.id" class="group">
          <td class="py-1 pr-2">
            <input type="text" :value="d.brand" placeholder="—"
                   @blur="e => e.target.value !== (d.brand || '') && patchDevice(d, { brand: e.target.value || null })"
                   class="w-full px-1.5 py-0.5 border border-transparent hover:border-gray-200 focus:border-indigo-500 focus:outline-none rounded" />
          </td>
          <td class="py-1 pr-2">
            <input type="text" :value="d.model_reference" placeholder="—"
                   @blur="e => e.target.value !== (d.model_reference || '') && patchDevice(d, { model_reference: e.target.value || null })"
                   class="w-full px-1.5 py-0.5 border border-transparent hover:border-gray-200 focus:border-indigo-500 focus:outline-none rounded" />
          </td>
          <td class="py-1 pr-2">
            <select :value="d.energy_source"
                    @change="e => patchDevice(d, { energy_source: e.target.value || null })"
                    class="w-full px-1.5 py-0.5 border border-gray-200 rounded">
              <option v-for="o in ENERGY_OPTIONS" :key="o.value || 'null'" :value="o.value">{{ o.label }}</option>
            </select>
          </td>
          <td class="py-1 pr-2">
            <input type="number" min="0" step="0.1" :value="d.power_kw" placeholder="—"
                   @blur="e => patchDevice(d, { power_kw: e.target.value === '' ? null : parseFloat(e.target.value) })"
                   class="w-full px-1.5 py-0.5 border border-transparent hover:border-gray-200 focus:border-indigo-500 focus:outline-none rounded" />
          </td>
          <td class="py-1 pr-2">
            <select :value="d.device_role"
                    @change="e => patchDevice(d, { device_role: e.target.value || null })"
                    class="w-full px-1.5 py-0.5 border border-gray-200 rounded">
              <option v-for="o in ROLE_OPTIONS" :key="o.value || 'null'" :value="o.value">{{ o.label }}</option>
            </select>
          </td>
          <td class="py-1 pr-2">
            <input type="text" :value="d.location" placeholder="—"
                   @blur="e => e.target.value !== (d.location || '') && patchDevice(d, { location: e.target.value || null })"
                   class="w-full px-1.5 py-0.5 border border-transparent hover:border-gray-200 focus:border-indigo-500 focus:outline-none rounded" />
          </td>
          <td class="py-1 pr-2">
            <input type="text" :value="d.notes" placeholder="—"
                   @blur="e => e.target.value !== (d.notes || '') && patchDevice(d, { notes: e.target.value || null })"
                   class="w-full px-1.5 py-0.5 border border-transparent hover:border-gray-200 focus:border-indigo-500 focus:outline-none rounded" />
          </td>
          <td class="py-1 text-right">
            <button @click="removeDevice(d)" class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 transition" title="Supprimer">
              <TrashIcon class="w-3.5 h-3.5" />
            </button>
          </td>
        </tr>
        <!-- Ligne d'ajout inline -->
        <tr class="bg-indigo-50/40">
          <td class="py-1 pr-2">
            <input v-model="newDevice.brand" type="text" placeholder="Marque"
                   class="w-full px-1.5 py-0.5 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500/30" />
          </td>
          <td class="py-1 pr-2">
            <input v-model="newDevice.model_reference" type="text" placeholder="Référence"
                   class="w-full px-1.5 py-0.5 border border-gray-200 rounded" />
          </td>
          <td class="py-1 pr-2">
            <select v-model="newDevice.energy_source" class="w-full px-1.5 py-0.5 border border-gray-200 rounded">
              <option v-for="o in ENERGY_OPTIONS" :key="o.value || 'null'" :value="o.value">{{ o.label }}</option>
            </select>
          </td>
          <td class="py-1 pr-2">
            <input v-model.number="newDevice.power_kw" type="number" min="0" step="0.1" placeholder="kW"
                   class="w-full px-1.5 py-0.5 border border-gray-200 rounded" />
          </td>
          <td class="py-1 pr-2">
            <select v-model="newDevice.device_role" class="w-full px-1.5 py-0.5 border border-gray-200 rounded">
              <option v-for="o in ROLE_OPTIONS" :key="o.value || 'null'" :value="o.value">{{ o.label }}</option>
            </select>
          </td>
          <td class="py-1 pr-2">
            <input v-model="newDevice.location" type="text" placeholder="Local"
                   class="w-full px-1.5 py-0.5 border border-gray-200 rounded" />
          </td>
          <td colspan="2" class="py-1 pr-2">
            <button @click="addDevice"
                    class="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 whitespace-nowrap">
              <PlusIcon class="w-3 h-3" /> Ajouter un équipement
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
