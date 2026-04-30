<script setup>
import { ref, computed, watch } from 'vue'
import { MagnifyingGlassIcon, MapPinIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { listZones } from '@/api'

/**
 * ZonePicker — autocomplete sur les zones d'un site donne.
 *
 * Props :
 *  - modelValue : zone_id (number | null)
 *  - siteId : site auquel sont rattachees les zones (recharge la liste a chaque changement)
 */
const props = defineProps({
  modelValue: { type: [Number, null], default: null },
  siteId: { type: [Number, null], required: true },
  required: { type: Boolean, default: false },
  placeholder: { type: String, default: 'Choisir une zone…' },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'change'])

const zones = ref([])
const loading = ref(false)
const open = ref(false)
const query = ref('')

const selected = computed(() => zones.value.find(z => z.zone_id === props.modelValue) || null)

function normalize(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const matches = computed(() => {
  const q = normalize(query.value)
  if (!q) return zones.value
  return zones.value.filter(z =>
    normalize(z.name).includes(q) || normalize(z.nature).includes(q)
  )
})

async function loadZones() {
  if (!props.siteId) {
    zones.value = []
    return
  }
  loading.value = true
  try {
    const { data } = await listZones(props.siteId)
    zones.value = data
  } finally {
    loading.value = false
  }
}

function pick(zone) {
  emit('update:modelValue', zone.zone_id)
  emit('change', zone)
  open.value = false
  query.value = ''
}

function clear() {
  emit('update:modelValue', null)
  emit('change', null)
}

function onBlur() {
  setTimeout(() => { open.value = false }, 150)
}

watch(() => props.siteId, () => {
  // Reset selection si le site change
  if (props.modelValue) emit('update:modelValue', null)
  loadZones()
}, { immediate: true })
</script>

<template>
  <div class="relative">
    <div
      v-if="selected && !open"
      class="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg bg-white cursor-pointer hover:border-indigo-300 transition"
      :class="disabled ? 'opacity-60 cursor-not-allowed' : ''"
      @click="!disabled && (open = true)"
    >
      <MapPinIcon class="w-4 h-4 text-indigo-500 shrink-0" />
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium text-gray-800 truncate">{{ selected.name }}</div>
        <div v-if="selected.nature" class="text-[11px] text-gray-500">{{ selected.nature }}</div>
      </div>
      <button
        v-if="!required"
        type="button"
        @click.stop="clear"
        class="text-gray-400 hover:text-red-600 p-1"
      >
        <XMarkIcon class="w-4 h-4" />
      </button>
    </div>

    <div v-else class="relative">
      <MagnifyingGlassIcon class="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
      <input
        v-model="query"
        type="text"
        :placeholder="!siteId ? 'Sélectionne d\'abord un site' : placeholder"
        :disabled="disabled || !siteId"
        autocomplete="off"
        @focus="open = true"
        @blur="onBlur"
        class="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition disabled:opacity-60 disabled:bg-gray-50"
      />
    </div>

    <div
      v-if="open && !selected && siteId"
      class="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto"
    >
      <div v-if="loading" class="px-3 py-2 text-xs text-gray-400">Chargement…</div>
      <div v-else-if="!matches.length" class="px-3 py-3 text-xs text-gray-500 text-center">
        Aucune zone définie pour ce site.
        <span class="text-gray-400 block mt-1">Crée-en une depuis l'audit BACS ou la fiche site.</span>
      </div>
      <button
        v-for="z in matches"
        :key="z.zone_id"
        type="button"
        @mousedown.prevent="pick(z)"
        class="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-gray-50 last:border-b-0 transition"
      >
        <div class="flex items-center gap-2">
          <MapPinIcon class="w-4 h-4 text-indigo-500 shrink-0" />
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-gray-800 truncate">{{ z.name }}</div>
            <div v-if="z.nature" class="text-[11px] text-gray-500">{{ z.nature }}</div>
          </div>
        </div>
      </button>
    </div>
  </div>
</template>
