<script setup>
/**
 * Sous-page tactile (drill-down) qui regroupe la saisie de la régulation
 * thermique R175-6 d'un système heating/cooling, sortie de la liste des
 * systèmes (jusque-là affichée inline dans un panneau ambré).
 *
 * Ouverte depuis MobileSystemsTab via un bouton « Régulation thermique »
 * sur chaque système heating/cooling présent en mode BACS.
 *
 * Conventions tactile iOS appliquées :
 * - Cartes cliquables plein-largeur pour les toggles (zone tap >= 44pt) ;
 *   la checkbox visuelle reste à droite mais c'est tout le bloc qui est
 *   un button.
 * - Granularité (4 options fixes) : <select> natif iOS.
 * - Type/régulations creatable : SearchableSelect (déjà tactile via
 *   min-h-11 cf. mémoire feedback_searchable_select_creatable).
 * - Inputs numériques : inputmode="numeric" pattern="[0-9]*".
 * - Auto-save 400 ms (identique au comportement précédent), donc le sheet
 *   n'a pas de bouton « Enregistrer » dans son header (hide-save).
 */
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { updateBacsThermal } from '@/api'
import MobileSheet from './MobileSheet.vue'
import MobileField from './MobileField.vue'
import SearchableSelect from '@/components/SearchableSelect.vue'
import {
  PRODUCTION_REGULATION_OPTIONS,
  DISTRIBUTION_REGULATION_OPTIONS,
  EMISSION_REGULATION_OPTIONS,
} from '@/composables/thermalRegulationOptions'

const props = defineProps({
  open: { type: Boolean, default: false },
  zoneId: { type: [Number, String], default: null },
  category: { type: String, default: 'heating' }, // 'heating' | 'cooling'
})
const emit = defineEmits(['close'])

const audit = useAuditStore()
const { systems, devices, thermal } = storeToRefs(audit)
const { error } = useNotification()

const thermalRow = computed(() =>
  thermal.value.find(t =>
    t.zone_id === props.zoneId && (t.category || 'heating') === props.category
  ) || null
)

const zoneName = computed(() => {
  if (thermalRow.value?.zone_name) return thermalRow.value.zone_name
  const sys = systems.value.find(s => s.zone_id === props.zoneId && s.system_category === props.category)
  return sys?.zone_name || ''
})

const sheetTitle = computed(() => {
  const cat = props.category === 'cooling' ? 'Refroidissement' : 'Chauffage'
  return zoneName.value ? `${cat} — ${zoneName.value}` : `Régulation ${cat.toLowerCase()}`
})

// Liste des équipements de la zone + catégorie (mêmes critères que la
// version inline qu'on remplace).
const deviceOptions = computed(() => {
  const sysIds = systems.value
    .filter(s => s.zone_id === props.zoneId && s.present && s.system_category === props.category)
    .map(s => s.id)
  return devices.value
    .filter(d => sysIds.includes(d.system_id))
    .map(d => ({
      value: d.id,
      label: d.name || d.brand || d.model_reference || `Équipement #${d.id}`,
      hint: d.brand && d.model_reference ? `${d.brand} ${d.model_reference}` : (d.brand || d.model_reference || ''),
    }))
})

const GENERATOR_OPTIONS = [
  { value: 'gas', label: 'Gaz' },
  { value: 'electric', label: 'Effet Joule' },
  { value: 'heat_pump', label: 'Pompe à chaleur' },
  { value: 'wood_appliance', label: 'Appareil bois (exempté R175-6)' },
  { value: 'district_heating', label: 'Réseau de chaleur' },
  { value: 'other', label: 'Autre' },
]

let saveTimer = null
async function patch(p) {
  const t = thermalRow.value
  if (!t) return
  Object.assign(t, p)
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      await updateBacsThermal(t.id, p)
      await audit.refreshActionItems()
    } catch { error('Sauvegarde régulation impossible') }
  }, 400)
}
</script>

<template>
  <MobileSheet :open="open" :title="sheetTitle" hide-save @close="emit('close')">
    <div v-if="thermalRow" class="p-4 space-y-4">
      <!-- Carte d'aide contextuelle -->
      <div class="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <p class="text-xs font-semibold text-amber-800 uppercase tracking-wider mb-1">
          R175-6
        </p>
        <p class="text-sm text-amber-900 leading-relaxed">
          Régulation automatique de la température, par pièce ou par zone homogène.
          Renseigne ci-dessous l'état réel constaté sur site.
        </p>
      </div>

      <!-- Toggle « Régulation automatique présente » : carte cliquable plein-largeur -->
      <button
        type="button"
        @click="patch({ has_automatic_regulation: !thermalRow.has_automatic_regulation })"
        class="w-full text-left tap-target flex items-start justify-between gap-3 px-4 py-4 bg-white rounded-xl border border-gray-200 active:bg-gray-50"
      >
        <div class="flex-1 min-w-0">
          <p class="text-base text-gray-900 font-medium">Régulation automatique présente ?</p>
          <p class="text-sm text-gray-500 mt-1 leading-relaxed">
            Système qui ajuste seul la température : thermostat connecté, sonde + vanne motorisée, GTB…
          </p>
        </div>
        <span
          :class="['mt-1 shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md border-2 transition',
                   thermalRow.has_automatic_regulation
                     ? 'bg-amber-500 border-amber-500 text-white'
                     : 'bg-white border-gray-300']"
          aria-hidden="true"
        >
          <svg v-if="thermalRow.has_automatic_regulation" viewBox="0 0 16 16" class="w-5 h-5">
            <path d="M3 8l3.5 3.5L13 4" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
      </button>

      <template v-if="thermalRow.has_automatic_regulation">
        <!-- Granularité : select natif iOS (4 options fixes) -->
        <div class="bg-white rounded-xl border border-gray-200 px-4 py-4 space-y-2">
          <MobileField label="Granularité de la régulation">
            <select
              :value="thermalRow.regulation_type || ''"
              @change="e => patch({ regulation_type: e.target.value || null })"
              class="w-full min-h-11 px-3 py-3 text-base bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
            >
              <option value="">— Sélectionner —</option>
              <option value="per_room">Par pièce</option>
              <option value="per_zone">Par zone</option>
              <option value="central_only">Centrale uniquement</option>
              <option value="none">Aucune</option>
            </select>
          </MobileField>
        </div>

        <!-- Production -->
        <div class="bg-white rounded-xl border border-gray-200 px-4 py-4 space-y-3">
          <p class="text-sm font-semibold text-gray-700">🔧 Production</p>
          <MobileField label="Équipement de production">
            <SearchableSelect
              :model-value="thermalRow.generator_device_id"
              @update:modelValue="v => patch({ generator_device_id: v != null ? parseInt(v, 10) : null })"
              :options="deviceOptions"
              placeholder="— aucun équipement"
              search-placeholder="Rechercher un équipement…"
            />
          </MobileField>
          <div v-if="thermalRow.generator_device_id" class="space-y-3 pl-4 border-l-4 border-amber-300">
            <MobileField label="Type de production">
              <SearchableSelect
                :model-value="thermalRow.generator_type"
                @update:modelValue="v => patch({ generator_type: v || null })"
                :options="GENERATOR_OPTIONS"
                creatable
                placeholder="ex : pompe à chaleur, chaudière…"
              />
            </MobileField>
            <MobileField label="Âge de l'équipement (années)">
              <input
                type="number" inputmode="numeric" pattern="[0-9]*" min="0"
                :value="thermalRow.generator_age_years ?? ''"
                @blur="e => patch({ generator_age_years: e.target.value ? parseInt(e.target.value, 10) : null })"
                placeholder="ex : 8"
                class="w-full min-h-11 px-3 py-3 text-base bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
              />
            </MobileField>
            <MobileField label="Régulation côté production">
              <SearchableSelect
                :model-value="thermalRow.production_regulation"
                @update:modelValue="v => patch({ production_regulation: v || null })"
                :options="PRODUCTION_REGULATION_OPTIONS"
                creatable
                placeholder="ex : sonde extérieure…"
              />
            </MobileField>
          </div>
        </div>

        <!-- Distribution -->
        <div class="bg-white rounded-xl border border-gray-200 px-4 py-4 space-y-3">
          <p class="text-sm font-semibold text-gray-700">🚰 Distribution</p>
          <MobileField label="Équipement de distribution">
            <SearchableSelect
              :model-value="thermalRow.distribution_device_id"
              @update:modelValue="v => patch({ distribution_device_id: v != null ? parseInt(v, 10) : null })"
              :options="deviceOptions"
              placeholder="— aucune (DRV, poêle…)"
              search-placeholder="Rechercher un équipement…"
            />
          </MobileField>
          <div v-if="thermalRow.distribution_device_id" class="pl-4 border-l-4 border-amber-300">
            <MobileField label="Régulation côté distribution">
              <SearchableSelect
                :model-value="thermalRow.distribution_regulation"
                @update:modelValue="v => patch({ distribution_regulation: v || null })"
                :options="DISTRIBUTION_REGULATION_OPTIONS"
                creatable
                placeholder="ex : pompe ΔP variable…"
              />
            </MobileField>
          </div>
        </div>

        <!-- Émission -->
        <div class="bg-white rounded-xl border border-gray-200 px-4 py-4 space-y-3">
          <p class="text-sm font-semibold text-gray-700">♨️ Émission</p>
          <MobileField label="Équipement d'émission">
            <SearchableSelect
              :model-value="thermalRow.emission_device_id"
              @update:modelValue="v => patch({ emission_device_id: v != null ? parseInt(v, 10) : null })"
              :options="deviceOptions"
              placeholder="— aucun"
              search-placeholder="Rechercher un équipement…"
            />
          </MobileField>
          <div v-if="thermalRow.emission_device_id" class="pl-4 border-l-4 border-amber-300">
            <MobileField label="Régulation côté émission">
              <SearchableSelect
                :model-value="thermalRow.emission_regulation"
                @update:modelValue="v => patch({ emission_regulation: v || null })"
                :options="EMISSION_REGULATION_OPTIONS"
                creatable
                placeholder="ex : robinets thermostatiques…"
              />
            </MobileField>
          </div>
        </div>
      </template>

      <!-- Exempté bois — uniquement chauffage -->
      <button
        v-if="category === 'heating'"
        type="button"
        @click="patch({ generator_exempt_wood: !thermalRow.generator_exempt_wood })"
        class="w-full text-left tap-target flex items-start justify-between gap-3 px-4 py-4 bg-white rounded-xl border border-gray-200 active:bg-gray-50"
      >
        <div class="flex-1 min-w-0">
          <p class="text-base text-gray-900 font-medium">Exempté — appareil bois</p>
          <p class="text-sm text-gray-500 mt-1 leading-relaxed">
            Production = appareil <strong>indépendant</strong> de chauffage au bois (poêle, insert).
            Exempté de R175-6 (II du décret).
          </p>
        </div>
        <span
          :class="['mt-1 shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md border-2 transition',
                   thermalRow.generator_exempt_wood
                     ? 'bg-amber-500 border-amber-500 text-white'
                     : 'bg-white border-gray-300']"
          aria-hidden="true"
        >
          <svg v-if="thermalRow.generator_exempt_wood" viewBox="0 0 16 16" class="w-5 h-5">
            <path d="M3 8l3.5 3.5L13 4" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
      </button>

      <p class="text-xs text-gray-400 text-center pt-2">
        Sauvegarde automatique. Tu peux fermer cette page à tout moment.
      </p>
    </div>

    <!-- Cas où aucune ligne n'existe encore (ne devrait pas arriver mais protège) -->
    <div v-else class="p-8 text-center text-sm text-gray-500">
      Aucune régulation thermique enregistrée pour cette zone.
    </div>
  </MobileSheet>
</template>
