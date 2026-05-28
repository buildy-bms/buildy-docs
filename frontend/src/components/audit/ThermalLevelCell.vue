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
// Tooltip = nom complet de l'équipement sélectionné. Compense la troncature
// visuelle du SearchableSelect quand le label dépasse la largeur dispo.
const selectedDeviceName = computed(() => {
  const opt = props.deviceOptions.find(o => o.value === deviceId.value)
  if (!opt) return ''
  return opt.hint ? `${opt.label} — ${opt.hint}` : opt.label
})

function setDevice(v) {
  emit('patch-thermal', { [deviceField.value]: v != null ? parseInt(v, 10) : null })
}
function setRegulator(v) {
  emit('patch-thermal', { [regulationField.value]: v != null ? parseInt(v, 10) : null })
}
</script>

<template>
  <!-- Mig 187 — cellule par niveau : équipement principal en haut (large pour
       éviter la troncature des longs noms), métadonnées en pied (chip type +
       intégrée + bouton notes), et 2e select « Régulateur déporté » UNIQUEMENT
       si l'auditeur a explicitement coché Déportée. -->
  <div class="min-w-64 max-w-80 space-y-1">
    <!-- Équipement principal du niveau. Tooltip = nom complet (compense la
         troncature visuelle du SearchableSelect). -->
    <div v-tooltip="selectedDeviceName">
      <SearchableSelect
        :model-value="deviceId"
        :options="deviceOptions"
        :invalid="!deviceId"
        size="sm" placeholder="—" search-placeholder="Rechercher un équipement…"
        @update:modelValue="setDevice" />
    </div>

    <!-- Bandeau bas COMPACT : visible uniquement si on a quelque chose à
         dire (type de régulation déclaré, statut intégrée explicite, ou
         note existante). Plus de chips parasites sur une cellule vide. -->
    <div v-if="hasTypeLabel || (integrated && deviceId) || hasNote || deviceId"
         class="flex items-center gap-1 flex-wrap min-h-[20px]">
      <span v-if="hasTypeLabel"
            class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 max-w-full truncate"
            v-tooltip="`Type de régulation déclaré sur l'équipement : ${regulationTypeLabel}. Modifier dans la modale équipement.`">
        {{ regulationTypeLabel }}
      </span>
      <span v-if="deviceId && integrated && !showSeparateRegulator"
            class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-50 text-sky-700 border border-sky-200"
            v-tooltip="`L'équipement embarque sa propre régulation — pas de régulateur séparé à saisir.`">
        Intégrée
      </span>
      <button v-if="deviceId" type="button"
              @click="emit('open-notes')"
              :class="['btn-icon ml-auto', hasNote && 'is-active']"
              v-tooltip="hasNote ? 'Note de ce niveau' : 'Ajouter une note pour ce niveau'">
        <PencilSquareIcon class="w-4 h-4" />
      </button>
    </div>

    <!-- Régulateur séparé : visible UNIQUEMENT si la régulation a été cochée
         Déportée dans la modale équipement. Sinon le device pilote sa propre
         régulation et on ne demande pas de second équipement. -->
    <div v-if="showSeparateRegulator && deviceId" class="pt-1 border-t border-gray-100">
      <div class="text-[9px] uppercase tracking-wider text-gray-400 mb-0.5">Régulateur déporté</div>
      <SearchableSelect
        :model-value="regulationDeviceId"
        :options="regulatorOptions"
        size="sm" placeholder="Sonde, thermostat, GTB…"
        search-placeholder="Rechercher…"
        @update:modelValue="setRegulator" />
    </div>
  </div>
</template>
