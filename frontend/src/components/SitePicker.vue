<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { MagnifyingGlassIcon, BuildingOffice2Icon, MapPinIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { listSites } from '@/api'

/**
 * SitePicker — autocomplete sur les sites locaux Buildy Docs.
 *
 * v-model = site_id (number | null). Emet 'change' avec l'objet site complet
 * pour les composants qui ont besoin du nom/uuid sans refaire un GET.
 */
const props = defineProps({
  modelValue: { type: [Number, null], default: null },
  required: { type: Boolean, default: false },
  placeholder: { type: String, default: 'Choisir un site…' },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'change'])

const sites = ref([])
const loading = ref(false)
const open = ref(false)
const query = ref('')
const inputRef = ref(null)

const selected = computed(() => sites.value.find(s => s.site_id === props.modelValue) || null)

function normalize(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const matches = computed(() => {
  const q = normalize(query.value)
  if (!q) return sites.value.slice(0, 20)
  return sites.value
    .filter(s =>
      normalize(s.name).includes(q) ||
      normalize(s.customer_name).includes(q) ||
      normalize(s.address).includes(q)
    )
    .slice(0, 20)
})

async function loadSites() {
  loading.value = true
  try {
    const { data } = await listSites()
    sites.value = data
  } finally {
    loading.value = false
  }
}

function pick(site) {
  emit('update:modelValue', site.site_id)
  emit('change', site)
  open.value = false
  query.value = ''
}

function clear() {
  emit('update:modelValue', null)
  emit('change', null)
  query.value = ''
}

function onFocus() {
  if (!props.disabled) open.value = true
}

// Permet de fermer en cliquant ailleurs
function onBlur() {
  setTimeout(() => { open.value = false }, 150)
}

watch(() => props.modelValue, (id) => {
  if (id && !sites.value.find(s => s.site_id === id)) {
    loadSites()
  }
})

onMounted(loadSites)
</script>

<template>
  <div class="relative">
    <!-- Site selectionne -->
    <div
      v-if="selected && !open"
      class="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg bg-white cursor-pointer hover:border-indigo-300 transition"
      :class="disabled ? 'opacity-60 cursor-not-allowed' : ''"
      @click="!disabled && (open = true)"
    >
      <BuildingOffice2Icon class="w-4 h-4 text-indigo-500 shrink-0" />
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium text-gray-800 truncate">{{ selected.name }}</div>
        <div class="flex items-center gap-2 text-[11px] text-gray-500 truncate">
          <span v-if="selected.customer_name">{{ selected.customer_name }}</span>
          <span v-if="selected.address" class="flex items-center gap-1 truncate">
            <MapPinIcon class="w-3 h-3 shrink-0" />{{ selected.address }}
          </span>
        </div>
      </div>
      <button
        v-if="!required"
        type="button"
        @click.stop="clear"
        class="text-gray-400 hover:text-red-600 p-1"
        title="Retirer"
      >
        <XMarkIcon class="w-4 h-4" />
      </button>
    </div>

    <!-- Champ de recherche -->
    <div v-else class="relative">
      <MagnifyingGlassIcon class="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
      <input
        ref="inputRef"
        v-model="query"
        type="text"
        :placeholder="placeholder"
        :disabled="disabled"
        autocomplete="off"
        @focus="onFocus"
        @blur="onBlur"
        class="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition disabled:opacity-60"
      />
    </div>

    <!-- Dropdown de suggestions -->
    <div
      v-if="open && !selected"
      class="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-y-auto"
    >
      <div v-if="loading" class="px-3 py-2 text-xs text-gray-400">Chargement…</div>
      <div v-else-if="!matches.length" class="px-3 py-3 text-xs text-gray-500 text-center">
        Aucun site ne correspond.
        <span class="text-gray-400 block mt-1">Crée-le d'abord depuis « Mes Sites ».</span>
      </div>
      <button
        v-for="s in matches"
        :key="s.site_uuid"
        type="button"
        @mousedown.prevent="pick(s)"
        class="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-gray-50 last:border-b-0 transition"
      >
        <div class="flex items-start gap-2">
          <BuildingOffice2Icon class="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-gray-800 truncate">{{ s.name }}</div>
            <div class="text-[11px] text-gray-500 truncate">
              <span v-if="s.customer_name">{{ s.customer_name }}</span>
              <span v-if="s.customer_name && s.address"> — </span>
              <span v-if="s.address">{{ s.address }}</span>
            </div>
          </div>
        </div>
      </button>
    </div>
  </div>
</template>
