<script setup>
/**
 * Cellule d'un niveau (Production / Distribution / Émission) dans la card 06
 * « Régulation thermique automatique » (mig 187). Regroupe en une seule
 * cellule ce qui était auparavant éclaté sur 2 colonnes :
 *   - équipement principal du niveau
 *   - équipement de régulation (si déportée)
 *   - chip type de régulation déclaré sur l'équipement
 *   - bouton notes du niveau
 *
 * Si l'équipement principal a `regulation_integrated === 1` (= régulation
 * embarquée), on ne demande PAS de régulateur séparé — un chip neutre
 * indique « Régulation intégrée ». Sinon (déportée ou non répondue), on
 * affiche un second select compact « Régulateur ».
 */
import { computed } from 'vue'
import { PencilSquareIcon } from '@heroicons/vue/24/outline'
import SearchableSelect from '@/components/SearchableSelect.vue'

const props = defineProps({
  thermal: { type: Object, required: true },
  level: { type: String, required: true }, // 'production' | 'distribution' | 'emission'
  device: { type: Object, default: null },
  deviceOptions: { type: Array, default: () => [] },
  regulatorOptions: { type: Array, default: () => [] },
  regulationTypeLabel: { type: String, default: '' },
  integrated: { type: Boolean, default: false },
  noteHtml: { type: String, default: '' },
})
const emit = defineEmits(['patch-thermal', 'open-notes'])

const LEVEL_DEVICE_FIELD = {
  production:   'generator_device_id',
  distribution: 'distribution_device_id',
  emission:     'emission_device_id',
}
const LEVEL_REGULATION_FIELD = {
  production:   'production_regulation_device_id',
  distribution: 'distribution_regulation_device_id',
  emission:     'emission_regulation_device_id',
}

const deviceField = computed(() => LEVEL_DEVICE_FIELD[props.level])
const regulationField = computed(() => LEVEL_REGULATION_FIELD[props.level])
const deviceId = computed(() => props.thermal[deviceField.value])
const regulationDeviceId = computed(() => props.thermal[regulationField.value])

// Si l'éq. principal pilote sa propre régulation (intégrée), on n'affiche
// pas le 2e select. Si la valeur est répondue Déportée (false explicite)
// ou non répondue (null), on affiche le select pour pouvoir saisir le
// régulateur séparé.
const showSeparateRegulator = computed(() => !props.integrated)
// État UX du chip type de régulation. Vide → on n'affiche pas du tout
// (réduit le bruit visuel quand la card 03 n'a pas encore été remplie).
const hasTypeLabel = computed(() => !!(props.regulationTypeLabel && props.regulationTypeLabel.trim()))
const hasNote = computed(() => {
  if (!props.noteHtml) return false
  return props.noteHtml.replace(/<[^>]*>/g, '').trim().length > 0
})

function setDevice(v) {
  emit('patch-thermal', { [deviceField.value]: v != null ? parseInt(v, 10) : null })
}
function setRegulator(v) {
  emit('patch-thermal', { [regulationField.value]: v != null ? parseInt(v, 10) : null })
}
</script>

<template>
  <div class="min-w-44 space-y-1.5">
    <!-- Équipement principal du niveau -->
    <SearchableSelect
      :model-value="deviceId"
      :options="deviceOptions"
      :invalid="!deviceId"
      size="sm" placeholder="—" search-placeholder="Rechercher…"
      @update:modelValue="setDevice" />

    <!-- Bandeau bas : chip type de régulation + indicateur intégrée / select
         régulateur déporté + bouton notes. Compact, sur une ligne quand
         possible, wrap sinon. -->
    <div class="flex items-center gap-1 flex-wrap">
      <span v-if="hasTypeLabel"
            class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200"
            v-tooltip="`Type de régulation déclaré sur l'équipement. Modifier dans la card Systèmes.`">
        {{ regulationTypeLabel }}
      </span>
      <span v-if="integrated && deviceId"
            class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-50 text-sky-700 border border-sky-200"
            v-tooltip="`L'équipement embarque sa propre régulation — pas de régulateur séparé à saisir.`">
        Régulation intégrée
      </span>
      <button type="button"
              @click="emit('open-notes')"
              :class="['btn-icon ml-auto', hasNote && 'is-active']"
              v-tooltip="hasNote ? 'Note de ce niveau' : 'Ajouter une note pour ce niveau'">
        <PencilSquareIcon class="w-4 h-4" />
      </button>
    </div>

    <!-- Régulateur séparé : visible UNIQUEMENT si la régulation n'est pas
         déclarée comme intégrée à l'équipement. Évite le doublon « Chaudière /
         Chaudière » qui parasitait l'ancien layout. -->
    <div v-if="showSeparateRegulator && deviceId" class="mt-1">
      <label class="block text-[9px] uppercase tracking-wider text-gray-400 mb-0.5">Régulateur déporté</label>
      <SearchableSelect
        :model-value="regulationDeviceId"
        :options="regulatorOptions"
        size="sm" placeholder="Sonde, thermostat, GTB…"
        search-placeholder="Rechercher…"
        @update:modelValue="setRegulator" />
    </div>
  </div>
</template>
