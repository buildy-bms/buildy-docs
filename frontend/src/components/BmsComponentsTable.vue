<script setup>
/**
 * Table des composants matériels de la GTB (passerelles, automates,
 * contrôleurs, modules IO, routeurs, switches, serveurs).
 * Saisie inline avec listes déroulantes, multi-protocoles, dup/delete.
 */
import { ref, onMounted, watch } from 'vue'
import {
  TrashIcon, PlusIcon, DocumentDuplicateIcon, ServerIcon, CpuChipIcon,
  ArrowsRightLeftIcon, Square3Stack3DIcon, BoltIcon, GlobeAltIcon,
} from '@heroicons/vue/24/outline'
import {
  getBacsBmsComponents, createBacsBmsComponent, updateBacsBmsComponent,
  duplicateBacsBmsComponent, deleteBacsBmsComponent,
} from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import ProtocolMultiPicker from './ProtocolMultiPicker.vue'
import Tooltip from './Tooltip.vue'

const props = defineProps({
  documentId: { type: Number, required: true },
})

const { error, success } = useNotification()
const { confirm } = useConfirm()

const components = ref([])

const TYPE_OPTIONS = [
  { value: 'gateway',    label: 'Passerelle',         icon: ArrowsRightLeftIcon, color: 'text-violet-600' },
  { value: 'plc',        label: 'Automate',           icon: CpuChipIcon,         color: 'text-emerald-600' },
  { value: 'controller', label: 'Contrôleur',         icon: BoltIcon,            color: 'text-amber-600' },
  { value: 'io_module',  label: 'Module IO',          icon: Square3Stack3DIcon,  color: 'text-blue-600' },
  { value: 'router',     label: 'Routeur',            icon: GlobeAltIcon,        color: 'text-indigo-600' },
  { value: 'switch',     label: 'Switch réseau',      icon: GlobeAltIcon,        color: 'text-sky-600' },
  { value: 'server',     label: 'Serveur supervision',icon: ServerIcon,          color: 'text-purple-600' },
  { value: 'other',      label: 'Autre',              icon: CpuChipIcon,         color: 'text-gray-600' },
]
function typeOf(val) { return TYPE_OPTIONS.find(t => t.value === val) || TYPE_OPTIONS[7] }

const PROTOCOL_OPTIONS = [
  { value: 'modbus_tcp', label: 'Modbus TCP' },
  { value: 'modbus_rtu', label: 'Modbus RTU' },
  { value: 'bacnet_ip', label: 'BACnet IP' },
  { value: 'bacnet_mstp', label: 'BACnet MS/TP' },
  { value: 'knx', label: 'KNX' },
  { value: 'mbus', label: 'M-Bus' },
  { value: 'lonworks', label: 'LonWorks' },
  { value: 'mqtt', label: 'MQTT' },
  { value: 'opcua', label: 'OPC-UA' },
  { value: 'rest', label: 'API REST' },
  { value: 'lorawan', label: 'LoRaWAN' },
  { value: 'autre', label: 'Autre' },
]

async function refresh() {
  try {
    const { data } = await getBacsBmsComponents(props.documentId)
    components.value = data || []
  } catch {
    error('Impossible de charger les composants GTB')
  }
}
onMounted(refresh)
watch(() => props.documentId, refresh)

async function addComponent(type = 'gateway') {
  try {
    const { data } = await createBacsBmsComponent(props.documentId, { component_type: type })
    components.value.push(data)
  } catch (e) {
    error(e.response?.data?.detail || 'Création impossible')
  }
}

async function patchComponent(c, patch) {
  try {
    const { data } = await updateBacsBmsComponent(c.id, patch)
    Object.assign(c, data)
  } catch {
    error('Sauvegarde impossible')
  }
}

async function dupComponent(c) {
  try {
    const { data } = await duplicateBacsBmsComponent(c.id)
    components.value.push(data)
    success('Composant dupliqué')
  } catch {
    error('Duplication impossible')
  }
}

async function removeComponent(c) {
  const ok = await confirm({
    title: 'Supprimer ce composant ?',
    message: `« ${typeOf(c.component_type).label}${c.brand ? ' · ' + c.brand : ''}${c.model ? ' · ' + c.model : ''} »`,
    confirmLabel: 'Supprimer', danger: true,
  })
  if (!ok) return
  try {
    await deleteBacsBmsComponent(c.id)
    components.value = components.value.filter(x => x.id !== c.id)
  } catch {
    error('Suppression impossible')
  }
}

const inputCls = 'w-full px-2 py-1 text-xs border border-gray-200 rounded hover:border-gray-300 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 bg-white transition placeholder:italic placeholder:text-gray-400'
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider">
        Composants matériels GTB
        <span class="font-normal normal-case text-gray-500 text-[10px]">
          — passerelles, automates, contrôleurs, modules IO…
        </span>
      </h3>
      <div class="flex items-center gap-1">
        <Tooltip text="Ajouter une passerelle (ex : Niagara JACE)">
          <button @click="addComponent('gateway')"
                  class="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded">
            <PlusIcon class="w-3 h-3" /> Passerelle
          </button>
        </Tooltip>
        <Tooltip text="Ajouter un automate (PLC)">
          <button @click="addComponent('plc')"
                  class="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded">
            <PlusIcon class="w-3 h-3" /> Automate
          </button>
        </Tooltip>
        <Tooltip text="Ajouter un contrôleur (régulation)">
          <button @click="addComponent('controller')"
                  class="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded">
            <PlusIcon class="w-3 h-3" /> Contrôleur
          </button>
        </Tooltip>
        <Tooltip text="Ajouter un autre composant (module IO, routeur, switch…)">
          <button @click="addComponent('other')"
                  class="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded">
            <PlusIcon class="w-3 h-3" /> Autre
          </button>
        </Tooltip>
      </div>
    </div>

    <div v-if="!components.length" class="text-xs text-gray-500 italic text-center py-4 border border-dashed border-gray-200 rounded">
      Aucun composant matériel renseigné. Clique sur un bouton ci-dessus pour en ajouter
      (passerelle Niagara, automate Schneider M340, contrôleur Distech…).
    </div>

    <table v-else class="w-full text-xs">
      <thead class="text-[10px] uppercase text-gray-500 tracking-wider bg-gray-50">
        <tr>
          <th class="text-left px-2 py-1.5 font-semibold w-32">Type</th>
          <th class="text-left py-1.5 px-2 font-semibold">Marque</th>
          <th class="text-left py-1.5 px-2 font-semibold">Modèle</th>
          <th class="text-left py-1.5 px-2 font-semibold">Localisation</th>
          <th class="text-left py-1.5 px-2 font-semibold w-32">IP / Adresse</th>
          <th class="text-left py-1.5 px-2 font-semibold w-44">Protocoles exposés</th>
          <th class="text-left py-1.5 px-2 font-semibold w-24">Firmware</th>
          <th class="text-left py-1.5 px-2 font-semibold">Notes</th>
          <th class="text-center py-1.5 px-1 font-semibold w-16"></th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100">
        <tr v-for="c in components" :key="c.id" class="group hover:bg-gray-50/40">
          <td class="px-2 py-1">
            <select :value="c.component_type"
                    @change="e => patchComponent(c, { component_type: e.target.value || null })"
                    class="text-xs px-1.5 py-1 border border-gray-200 rounded bg-white"
                    :class="typeOf(c.component_type).color">
              <option v-for="t in TYPE_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </td>
          <td class="py-1 px-1">
            <input type="text" :value="c.brand" placeholder="Niagara, Schneider, Distech…"
                   @blur="e => e.target.value !== (c.brand || '') && patchComponent(c, { brand: e.target.value || null })"
                   :class="inputCls" />
          </td>
          <td class="py-1 px-1">
            <input type="text" :value="c.model" placeholder="JACE 8000, M340…"
                   @blur="e => e.target.value !== (c.model || '') && patchComponent(c, { model: e.target.value || null })"
                   :class="inputCls" />
          </td>
          <td class="py-1 px-1">
            <input type="text" :value="c.location" placeholder="Local technique RDC…"
                   @blur="e => e.target.value !== (c.location || '') && patchComponent(c, { location: e.target.value || null })"
                   :class="inputCls" />
          </td>
          <td class="py-1 px-1">
            <input type="text" :value="c.ip_address" placeholder="192.168.1.10"
                   @blur="e => e.target.value !== (c.ip_address || '') && patchComponent(c, { ip_address: e.target.value || null })"
                   :class="inputCls + ' font-mono'" />
          </td>
          <td class="py-1 px-1">
            <ProtocolMultiPicker
              :model-value="c.protocols"
              :options="PROTOCOL_OPTIONS"
              size="xs"
              @update:modelValue="v => patchComponent(c, { protocols: v })"
            />
          </td>
          <td class="py-1 px-1">
            <input type="text" :value="c.firmware_version" placeholder="—"
                   @blur="e => e.target.value !== (c.firmware_version || '') && patchComponent(c, { firmware_version: e.target.value || null })"
                   :class="inputCls + ' font-mono'" />
          </td>
          <td class="py-1 px-1">
            <input type="text" :value="c.notes" placeholder="—"
                   @blur="e => e.target.value !== (c.notes || '') && patchComponent(c, { notes: e.target.value || null })"
                   :class="inputCls" />
          </td>
          <td class="py-1 px-1 text-right whitespace-nowrap">
            <Tooltip text="Dupliquer">
              <button @click="dupComponent(c)" class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-indigo-600 transition mr-1">
                <DocumentDuplicateIcon class="w-3.5 h-3.5" />
              </button>
            </Tooltip>
            <Tooltip text="Supprimer">
              <button @click="removeComponent(c)" class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 transition">
                <TrashIcon class="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
