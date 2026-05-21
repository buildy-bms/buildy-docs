<script setup>
import { ref, computed, watch } from 'vue'
import BaseModal from './BaseModal.vue'
import SearchableSelect from './SearchableSelect.vue'
import ZoneMapPicker from './ZoneMapPicker.vue'
import { isTechnicalNature } from '@/lib/audit-options'

const props = defineProps({
  zoneNatures: { type: Array, required: true },
  // Type pré-sélectionné selon la card d'origine ('functional' | 'technical').
  kind: { type: String, default: 'functional' },
  // Zones existantes du site (pins de contexte sur la carte).
  zones: { type: Array, default: () => [] },
  // Site rattaché { address, latitude, longitude } — centrage de la carte.
  site: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['close', 'submit'])

const form = ref({ name: '', nature: null, surface_m2: null, kind: props.kind, latitude: null, longitude: null })
const submitting = ref(false)
const isTechnical = computed(() => form.value.kind === 'technical')

// Pré-remplit le type de zone quand la nature choisie est technique
// (Local technique, TGBT, local compteurs…). Pré-remplissage à sens
// unique (jamais de rétrogradation auto vers « fonctionnelle » : on ne
// contredit pas la card d'origine ni un choix manuel).
const kindTouched = ref(false)
watch(() => form.value.nature, (nat) => {
  if (kindTouched.value || !nat) return
  if (isTechnicalNature(nat)) form.value.kind = 'technical'
})
function setKind(k) { kindTouched.value = true; form.value.kind = k }

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
  <BaseModal :title="isTechnical ? 'Ajouter une zone technique' : 'Ajouter une zone fonctionnelle'"
             size="lg" :dismiss-on-backdrop="false" @close="emit('close')">
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
        <label class="block text-xs font-medium text-gray-700 mb-1">Type de zone</label>
        <div class="inline-flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          <button type="button" @click="setKind('functional')"
                  :class="!isTechnical ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'"
                  class="px-4 py-2 font-medium transition">Fonctionnelle</button>
          <button type="button" @click="setKind('technical')"
                  :class="isTechnical ? 'bg-slate-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'"
                  class="px-4 py-2 font-medium transition border-l border-gray-200">Technique</button>
        </div>
        <p class="mt-1 text-xs text-gray-500">
          {{ isTechnical
            ? 'Local hors décret BACS : pas de système ni compteur généré automatiquement.'
            : 'Zone assujettie au décret BACS : alimente les cards Systèmes et Compteurs.' }}
        </p>
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
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">
          Position sur la carte <span class="text-gray-400 font-normal">(optionnel)</span>
        </label>
        <ZoneMapPicker
          v-model:latitude="form.latitude"
          v-model:longitude="form.longitude"
          :kind="form.kind"
          :zones="zones"
          :site="site"
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
