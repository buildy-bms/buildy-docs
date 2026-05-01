<script setup>
import { ref } from 'vue'
import BaseModal from './BaseModal.vue'
import MeterUsagePill from './MeterUsagePill.vue'
import MeterTypePill from './MeterTypePill.vue'

const props = defineProps({
  zones: { type: Array, required: true },
  usages: { type: Array, required: true },
  types: { type: Array, required: true },
})
const emit = defineEmits(['close', 'submit'])

const form = ref({
  zone_id: null,
  usage: 'heating',
  meter_type: 'thermal',
  required: true,
})
const submitting = ref(false)

async function submit() {
  if (submitting.value) return
  submitting.value = true
  try {
    await emit('submit', { ...form.value })
    emit('close')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <BaseModal title="Ajouter un compteur" size="md" @close="emit('close')">
    <form @submit.prevent="submit" class="space-y-4">
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">Zone</label>
        <select v-model="form.zone_id"
                class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500">
          <option :value="null">Compteur général (bâtiment)</option>
          <option v-for="z in zones" :key="z.zone_id" :value="z.zone_id">{{ z.name }}</option>
        </select>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Usage</label>
          <select v-model="form.usage"
                  class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500">
            <option v-for="u in usages" :key="u.value" :value="u.value">{{ u.label }}</option>
          </select>
          <div class="mt-2"><MeterUsagePill :usage="form.usage" /></div>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Type de compteur</label>
          <select v-model="form.meter_type"
                  class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500">
            <option v-for="t in types" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
          <div class="mt-2"><MeterTypePill :type="form.meter_type" /></div>
        </div>
      </div>
      <label class="inline-flex items-center gap-2 cursor-pointer text-sm text-gray-700">
        <input type="checkbox" v-model="form.required" class="rounded" />
        <span>Compteur requis par le décret BACS (R175-3 1°)</span>
      </label>
      <div class="flex items-center justify-end gap-2 pt-2">
        <button type="button" @click="emit('close')"
                class="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">
          Annuler
        </button>
        <button type="submit" :disabled="submitting"
                class="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg shadow-sm">
          {{ submitting ? 'Création…' : 'Ajouter le compteur' }}
        </button>
      </div>
    </form>
  </BaseModal>
</template>
