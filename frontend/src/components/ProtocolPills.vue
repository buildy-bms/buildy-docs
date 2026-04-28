<script setup>
import { computed } from 'vue'

const props = defineProps({
  // CSV : "Modbus TCP,BACnet/IP" ou tableau
  protocols: { type: [String, Array, null], default: null },
  // Affiche le préfixe "Protocoles exigés :" (utile dans la fiche template,
  // inutile dans une cellule de tableau dont l'en-tête le dit déjà)
  showLabel: { type: Boolean, default: true },
})

const list = computed(() => {
  if (!props.protocols) return []
  const arr = Array.isArray(props.protocols)
    ? props.protocols
    : props.protocols.split(',').map(s => s.trim()).filter(Boolean)
  return arr
})

// Couleurs par famille de protocole (cohérent avec le style Buildy)
const COLORS = {
  'Modbus TCP':    'bg-blue-100 text-blue-800 border-blue-200',
  'Modbus RTU':    'bg-blue-50 text-blue-700 border-blue-200',
  'BACnet/IP':     'bg-purple-100 text-purple-800 border-purple-200',
  'BACnet MS/TP':  'bg-purple-50 text-purple-700 border-purple-200',
  'KNX/IP':        'bg-orange-100 text-orange-800 border-orange-200',
  'KNX TP':        'bg-orange-50 text-orange-700 border-orange-200',
  'M-Bus IP':      'bg-emerald-100 text-emerald-800 border-emerald-200',
  'M-Bus filaire': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'MQTT':          'bg-rose-100 text-rose-800 border-rose-200',
  'OPC-UA':        'bg-indigo-100 text-indigo-800 border-indigo-200',
  'LoRaWAN':       'bg-teal-100 text-teal-800 border-teal-200',
}
function colorFor(p) {
  return COLORS[p] || 'bg-gray-100 text-gray-700 border-gray-200'
}
</script>

<template>
  <div v-if="list.length" class="flex items-center gap-1 flex-wrap">
    <span v-if="showLabel" class="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mr-1 whitespace-nowrap">Protocoles exigés :</span>
    <span
      v-for="p in list"
      :key="p"
      :class="['inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-full border whitespace-nowrap', colorFor(p)]"
    >
      {{ p }}
    </span>
  </div>
</template>
