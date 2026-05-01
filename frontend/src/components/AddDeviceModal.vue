<script setup>
import { ref } from 'vue'
import BaseModal from './BaseModal.vue'

const props = defineProps({
  systemLabel: { type: String, required: true },
  zoneName: { type: String, default: '' },
  energyOptions: { type: Array, required: true },
  roleOptions: { type: Array, required: true },
  commOptions: { type: Array, required: true },
})
const emit = defineEmits(['close', 'submit'])

const form = ref({
  name: '', brand: '', model_reference: '', power_kw: null,
  energy_source: null, device_role: null, communication_protocol: null,
  location: '', notes: '',
})
const submitting = ref(false)

const canSubmit = () => !!(form.value.name?.trim() || form.value.brand?.trim() || form.value.model_reference?.trim())

async function submit() {
  if (!canSubmit() || submitting.value) return
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
  <BaseModal :title="`Ajouter un équipement — ${systemLabel}${zoneName ? ' / ' + zoneName : ''}`" size="xl" @close="emit('close')">
    <form @submit.prevent="submit" class="space-y-4">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Nom de l'équipement</label>
          <input v-model="form.name" type="text" autofocus
                 placeholder="ex : Chaudière gaz principale, Groupe DRV…"
                 class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Localisation</label>
          <input v-model="form.location" type="text"
                 placeholder="ex : Local technique sous-sol, Toiture…"
                 class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Marque</label>
          <input v-model="form.brand" type="text" placeholder="ex : Atlantic, Daikin, Aldes…"
                 class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Référence / modèle</label>
          <input v-model="form.model_reference" type="text" placeholder="ex : Varmax 70, VRV-IV 75…"
                 class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Énergie</label>
          <select v-model="form.energy_source"
                  class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500">
            <option v-for="o in energyOptions" :key="o.value || 'null'" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Puissance (kW)</label>
          <input v-model.number="form.power_kw" type="number" min="0" step="0.1"
                 placeholder="—"
                 class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Nature</label>
          <select v-model="form.device_role"
                  class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500">
            <option v-for="o in roleOptions" :key="o.value || 'null'" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Protocole de communication</label>
          <select v-model="form.communication_protocol"
                  class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500">
            <option v-for="o in commOptions" :key="o.value || 'null'" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="col-span-2">
          <label class="block text-xs font-medium text-gray-700 mb-1">Notes <span class="text-gray-400 font-normal">(optionnel)</span></label>
          <textarea v-model="form.notes" rows="2" placeholder="Observations terrain (état, mise en service, particularités…)"
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"></textarea>
        </div>
      </div>
      <div class="flex items-center justify-end gap-2 pt-2">
        <button type="button" @click="emit('close')"
                class="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">
          Annuler
        </button>
        <button type="submit" :disabled="!canSubmit() || submitting"
                class="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg shadow-sm">
          {{ submitting ? 'Création…' : 'Ajouter l\'équipement' }}
        </button>
      </div>
    </form>
  </BaseModal>
</template>
