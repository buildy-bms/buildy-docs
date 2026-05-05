<script setup>
import { ref } from 'vue'
import BaseModal from './BaseModal.vue'
import SearchableSelect from './SearchableSelect.vue'

const props = defineProps({
  zoneNatures: { type: Array, required: true },
})
const emit = defineEmits(['close', 'submit'])

const form = ref({ name: '', nature: null, surface_m2: null })
const submitting = ref(false)

async function submit() {
  if (!form.value.name.trim() || submitting.value) return
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
  <BaseModal title="Ajouter une zone fonctionnelle" size="md" @close="emit('close')">
    <form @submit.prevent="submit" class="space-y-4">
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">Nom de la zone *</label>
        <input
          v-model="form.name"
          type="text"
          autofocus
          placeholder="ex : Open-space niveau 1, Salles de réunion…"
          @keydown.enter.prevent="submit"
          class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
        />
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">Nature de la zone</label>
        <SearchableSelect
          v-model="form.nature"
          :options="zoneNatures"
          placeholder="Sélectionner une nature"
        />
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">Surface (m²)</label>
        <input
          v-model.number="form.surface_m2"
          type="number" min="0" step="1"
          placeholder="—"
          class="w-full max-w-xs px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
        />
      </div>
      <div class="flex items-center justify-end gap-2 pt-2">
        <button type="button" @click="emit('close')"
                class="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">
          Annuler
        </button>
        <button type="submit" :disabled="!form.name.trim() || submitting"
                class="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg shadow-sm">
          {{ submitting ? 'Création…' : 'Ajouter la zone' }}
        </button>
      </div>
    </form>
  </BaseModal>
</template>
