<script setup>
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import {
  BoltIcon,
  ChevronRightIcon,
  TrashIcon,
  ExclamationTriangleIcon,
} from '@heroicons/vue/24/outline'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import { createBacsMeter, updateBacsMeter, deleteBacsMeter } from '@/api'
import MobileField from './MobileField.vue'
import MobileFab from './MobileFab.vue'
import MobileSheet from './MobileSheet.vue'
import MeterTypePill from '@/components/MeterTypePill.vue'
import MeterUsagePill from '@/components/MeterUsagePill.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'

const audit = useAuditStore()
const { document, meters, zones } = storeToRefs(audit)
const { error, success } = useNotification()
const { confirm } = useConfirm()

const METER_USAGES = [
  { value: 'heating', label: 'Chauffage' },
  { value: 'cooling', label: 'Climatisation' },
  { value: 'dhw', label: 'ECS' },
  { value: 'pv', label: 'Production PV' },
  { value: 'lighting', label: 'Éclairage' },
  { value: 'other', label: 'Autre' },
]
const METER_TYPES = [
  { value: 'electric', label: 'Électrique' },
  { value: 'electric_production', label: 'Électrique production' },
  { value: 'gas', label: 'Gaz' },
  { value: 'water', label: 'Eau' },
  { value: 'thermal', label: 'Thermique' },
]
const PROTOCOLS = [
  { value: 'modbus_tcp', label: 'Modbus TCP' },
  { value: 'modbus_rtu', label: 'Modbus RTU' },
  { value: 'bacnet_ip', label: 'BACnet IP' },
  { value: 'bacnet_mstp', label: 'BACnet MS/TP' },
  { value: 'knx', label: 'KNX' },
  { value: 'mbus', label: 'M-Bus' },
  { value: 'mqtt', label: 'MQTT' },
  { value: 'lorawan', label: 'LoRaWAN' },
  { value: 'autre', label: 'Autre' },
]
function usageLabel(v) { return METER_USAGES.find(u => u.value === v)?.label || v }

const stats = computed(() => ({
  total: meters.value.length,
  present: meters.value.filter(m => m.present_actual).length,
  missing: meters.value.filter(m => m.required && !m.present_actual && !m.out_of_service).length,
}))

// Sheet
const editing = ref(null)
const editForm = ref({})
const saving = ref(false)

function openCreate() {
  editForm.value = {
    zone_id: zones.value[0]?.zone_id || null,
    usage: 'heating',
    meter_type: 'thermal',
    required: true,
  }
  editing.value = { mode: 'create' }
}
function openEdit(m) {
  editForm.value = { ...m }
  editing.value = { mode: 'edit', meter: m }
}
function close() { editing.value = null }

async function save() {
  saving.value = true
  try {
    if (editing.value.mode === 'create') {
      await createBacsMeter(document.value.id, {
        zone_id: editForm.value.zone_id || null,
        usage: editForm.value.usage,
        meter_type: editForm.value.meter_type,
        required: !!editForm.value.required,
      })
      await audit.refreshAuditCore()
      success('Compteur ajouté')
    } else {
      const patch = {
        zone_id: editForm.value.zone_id || null,
        usage: editForm.value.usage,
        meter_type: editForm.value.meter_type,
        required: !!editForm.value.required,
        present_actual: !!editForm.value.present_actual,
        communicating: !!editForm.value.communicating,
        wired: !!editForm.value.wired,
        out_of_service: !!editForm.value.out_of_service,
        communication_protocols: editForm.value.communication_protocols || null,
        notes_html: editForm.value.notes_html || null,
      }
      const { data } = await updateBacsMeter(editing.value.meter.id, patch)
      Object.assign(editing.value.meter, data)
      await audit.refreshActionItems()
      success('Compteur mis à jour')
    }
    close()
  } catch (e) {
    error(e.response?.data?.detail || 'Sauvegarde impossible')
  } finally {
    saving.value = false
  }
}

async function remove(m) {
  const ok = await confirm({
    title: 'Supprimer ce compteur ?',
    message: `${m.zone_name || 'Compteur général'} — ${usageLabel(m.usage)}`,
    confirmLabel: 'Supprimer',
    danger: true,
  })
  if (!ok) return
  try {
    await deleteBacsMeter(m.id)
    await audit.refreshAuditCore()
    if (editing.value?.meter?.id === m.id) close()
  } catch {
    error('Suppression impossible')
  }
}

// Toggle protocol single value (mobile-friendly UI)
const editProtocols = computed({
  get: () => {
    const raw = editForm.value.communication_protocols
    if (!raw) return []
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return [] }
  },
  set: (v) => {
    editForm.value.communication_protocols = v && v.length ? JSON.stringify(v) : null
  }
})
function toggleProtocol(p) {
  const arr = [...editProtocols.value]
  const idx = arr.indexOf(p)
  if (idx >= 0) arr.splice(idx, 1)
  else arr.push(p)
  editProtocols.value = arr
}
</script>

<template>
  <div class="p-3 pb-24 space-y-3">
    <!-- Stats -->
    <div class="grid grid-cols-3 gap-2">
      <div class="bg-white rounded-xl border border-gray-200 p-4 text-center">
        <p class="text-3xl font-medium text-gray-900 leading-none">{{ stats.total }}</p>
        <p class="text-sm text-gray-500 mt-1.5">Total</p>
      </div>
      <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
        <p class="text-3xl font-medium text-emerald-700 leading-none">{{ stats.present }}</p>
        <p class="text-sm text-emerald-600 mt-1.5">Présents</p>
      </div>
      <div :class="['rounded-xl border p-4 text-center',
                    stats.missing > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200']">
        <p :class="['text-3xl font-medium leading-none', stats.missing > 0 ? 'text-red-700' : 'text-gray-700']">
          {{ stats.missing }}
        </p>
        <p :class="['text-sm mt-1.5', stats.missing > 0 ? 'text-red-600' : 'text-gray-500']">Manquants</p>
      </div>
    </div>

    <!-- Liste -->
    <div v-if="meters.length" class="bg-white rounded-2xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
      <button
        v-for="m in meters"
        :key="m.id"
        type="button"
        @click="openEdit(m)"
        :class="['w-full flex items-center gap-3 px-4 py-4 text-left active:bg-gray-50',
                 m.out_of_service ? 'opacity-50' : '',
                 m.required && !m.present_actual && !m.out_of_service ? 'bg-red-50/40' : '']"
      >
        <ExclamationTriangleIcon
          v-if="m.required && !m.present_actual && !m.out_of_service"
          class="w-6 h-6 text-red-500 shrink-0"
        />
        <div class="flex-1 min-w-0">
          <p class="text-lg font-medium text-gray-900 truncate leading-tight">{{ m.zone_name || 'Compteur général' }}</p>
          <div class="flex items-center gap-1.5 mt-2 flex-wrap">
            <MeterUsagePill :usage="m.usage" />
            <MeterTypePill :type="m.meter_type" />
            <span v-if="m.present_actual" class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700">Présent</span>
            <span v-if="m.communicating" class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-indigo-100 text-indigo-700">Communicant</span>
            <span v-if="m.out_of_service" class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-gray-200 text-gray-600">HS</span>
          </div>
        </div>
        <ChevronRightIcon class="w-6 h-6 text-gray-300 shrink-0" />
      </button>
    </div>
    <div v-else class="bg-white rounded-2xl border border-dashed border-gray-300 p-8 text-center">
      <BoltIcon class="w-10 h-10 text-gray-300 mx-auto" />
      <p class="text-sm text-gray-500 mt-3">Aucun compteur listé</p>
      <p class="text-xs text-gray-400 mt-1">Tape le bouton + en bas pour ajouter</p>
    </div>

    <MobileFab label="Ajouter un compteur" @click="openCreate" />

    <MobileSheet
      :open="!!editing"
      :title="editing?.mode === 'create' ? 'Nouveau compteur' : 'Compteur'"
      :saving="saving"
      @close="close"
      @save="save"
    >
      <div class="p-4 space-y-4">
        <MobileField label="Zone">
          <select
            v-model="editForm.zone_id"
            class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
          >
            <option :value="null">Compteur général</option>
            <option v-for="z in zones" :key="z.zone_id" :value="z.zone_id">{{ z.name }}</option>
          </select>
        </MobileField>

        <MobileField label="Usage">
          <select
            v-model="editForm.usage"
            class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
          >
            <option v-for="opt in METER_USAGES" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </MobileField>

        <MobileField label="Type">
          <select
            v-model="editForm.meter_type"
            class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
          >
            <option v-for="opt in METER_TYPES" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </MobileField>

        <MobileField label="État">
          <div class="space-y-2">
            <label class="flex items-center justify-between gap-3 px-4 py-4 bg-white border border-gray-200 rounded-xl cursor-pointer">
              <span class="text-sm font-medium text-gray-700">Requis (R175)</span>
              <input v-model="editForm.required" type="checkbox" class="w-5 h-5" />
            </label>
            <template v-if="editing?.mode === 'edit'">
              <label class="flex items-center justify-between gap-3 px-4 py-4 bg-white border border-gray-200 rounded-xl cursor-pointer">
                <span class="text-sm font-medium text-gray-700">Présent sur site</span>
                <input v-model="editForm.present_actual" type="checkbox" class="w-5 h-5" />
              </label>
              <label v-if="editForm.present_actual"
                     class="flex items-center justify-between gap-3 px-4 py-4 bg-white border border-gray-200 rounded-xl cursor-pointer">
                <span class="text-sm font-medium text-gray-700">Communicant</span>
                <input v-model="editForm.communicating" type="checkbox" class="w-5 h-5" />
              </label>
              <label v-if="editForm.present_actual"
                     class="flex items-center justify-between gap-3 px-4 py-4 bg-white border border-gray-200 rounded-xl cursor-pointer">
                <span class="text-sm font-medium text-gray-700">Câblé vers GTB</span>
                <input v-model="editForm.wired" type="checkbox" class="w-5 h-5" />
              </label>
              <label class="flex items-center justify-between gap-3 px-4 py-4 bg-white border border-gray-200 rounded-xl cursor-pointer">
                <span class="text-sm font-medium text-red-600">Hors service</span>
                <input v-model="editForm.out_of_service" type="checkbox" class="w-5 h-5" />
              </label>
            </template>
          </div>
        </MobileField>

        <MobileField v-if="editing?.mode === 'edit' && editForm.communicating" label="Protocoles">
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="p in PROTOCOLS"
              :key="p.value"
              type="button"
              @click="toggleProtocol(p.value)"
              :class="['px-3 py-2.5 text-sm rounded-xl border transition',
                editProtocols.includes(p.value)
                  ? 'bg-indigo-50 border-indigo-300 text-indigo-700 font-medium'
                  : 'bg-white border-gray-200 text-gray-600']"
            >
              {{ p.label }}
            </button>
          </div>
        </MobileField>

        <template v-if="editing?.mode === 'edit' && document?.site_uuid">
          <div class="pt-2">
            <p class="text-xs font-medium text-gray-600 uppercase tracking-wider mb-2">Photos</p>
            <BacsPhotoButton
              :site-uuid="document.site_uuid"
              :attach-to="{ meter_id: editing.meter.id }"
              :label="(editing.meter.zone_name || 'Général') + ' / ' + usageLabel(editing.meter.usage)"
              size="md"
            />
          </div>

          <div class="pt-4 border-t border-gray-200">
            <button
              @click="remove(editing.meter)"
              class="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-red-600 bg-red-50 border border-red-200 rounded-xl font-medium"
            >
              <TrashIcon class="w-5 h-5" />
              Supprimer le compteur
            </button>
          </div>
        </template>
      </div>
    </MobileSheet>
  </div>
</template>
