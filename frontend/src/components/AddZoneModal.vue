<script setup>
import { ref, computed, watch } from 'vue'
import { QuestionMarkCircleIcon } from '@heroicons/vue/24/outline'
import BaseModal from './BaseModal.vue'
import SearchableSelect from './SearchableSelect.vue'
import ZoneMapPicker from './ZoneMapPicker.vue'
import ZoneFunctionalHelpModal from './audit/ZoneFunctionalHelpModal.vue'
import { isTechnicalNature, ZONE_OCCUPANCY_PROFILES } from '@/lib/audit-options'
import { useAuditStore } from '@/stores/audit'

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

const audit = useAuditStore()

const form = ref({
  name: '', nature: null, surface_m2: null, kind: props.kind,
  latitude: null, longitude: null, occupancy_profile: null, comfort_constraint: null,
  party_ids: [],
})
const submitting = ref(false)
const isTechnical = computed(() => form.value.kind === 'technical')
const showHelp = ref(false)

// Parties prenantes du site — liste partagée du store (item 5), pour
// affecter des occupants dès la création de la zone.
const parties = computed(() => audit.siteParties || [])
function toggleParty(id, checked) {
  if (checked) {
    if (!form.value.party_ids.includes(id)) form.value.party_ids.push(id)
  } else {
    form.value.party_ids = form.value.party_ids.filter(x => x !== id)
  }
}

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
      <!-- Type de zone : déplacé juste après le nom pour piloter la
           visibilité des champs suivants (les zones techniques masquent
           régime d'activité + occupants qui n'ont pas de sens hors BACS). -->
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
      <div v-if="!isTechnical" class="rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-2 flex items-center gap-2">
        <QuestionMarkCircleIcon class="w-5 h-5 text-indigo-600 shrink-0" />
        <span class="text-xs text-gray-700 flex-1">Une zone fonctionnelle n'est pas une pièce — c'est une unité de suivi énergétique.</span>
        <button type="button" @click="showHelp = true"
                class="text-xs font-medium text-indigo-700 hover:text-indigo-900 underline whitespace-nowrap shrink-0">
          En savoir plus
        </button>
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">Nature de la zone</label>
        <SearchableSelect
          v-model="form.nature"
          :options="zoneNatures"
          placeholder="Sélectionner une nature"
        />
      </div>
      <div v-if="!isTechnical">
        <label class="block text-xs font-medium text-gray-700 mb-1">Régime d'activité</label>
        <SearchableSelect
          v-model="form.occupancy_profile"
          :options="ZONE_OCCUPANCY_PROFILES"
          placeholder="Sélectionner un régime d'activité"
        />
        <p class="mt-1 text-xs text-gray-500">
          Caractérise l'usage temporel de la zone (24/7, heures de bureau, scolaire…).
        </p>
      </div>
      <div v-if="!isTechnical">
        <label class="block text-xs font-medium text-gray-700 mb-1">
          Contrainte de confort <span class="text-gray-400 font-normal">(optionnel)</span>
        </label>
        <input
          v-model="form.comfort_constraint"
          type="text"
          placeholder="ex : température minimale imposée 22 °C, qualité d'air…"
          class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
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
      <div v-if="!isTechnical && parties.length">
        <label class="block text-xs font-medium text-gray-700 mb-1">
          Occupants de la zone <span class="text-gray-400 font-normal">(optionnel)</span>
        </label>
        <ul class="space-y-0.5 border border-gray-200 rounded-lg p-2">
          <li v-for="p in parties" :key="p.id">
            <label class="flex items-center gap-2 cursor-pointer min-h-9 px-1 rounded hover:bg-gray-50">
              <input type="checkbox"
                     :checked="form.party_ids.includes(p.id)"
                     @change="e => toggleParty(p.id, e.target.checked)"
                     class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/30" />
              <span class="text-sm text-gray-700">{{ p.name }}</span>
            </label>
          </li>
        </ul>
        <p class="mt-1 text-xs text-gray-500">
          Rattache des parties prenantes (preneurs, propriétaires…) à cette zone.
        </p>
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
  <ZoneFunctionalHelpModal v-if="showHelp" @close="showHelp = false" />
</template>
