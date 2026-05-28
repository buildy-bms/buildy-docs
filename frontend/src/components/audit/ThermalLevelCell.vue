<script setup>
/**
 * Cellule d'un niveau (Production / Distribution / Émission) dans la card 06
 * « Régulation thermique automatique » (mig 187 v3).
 *
 * Layout COMPACT 1 ligne :
 *   [MultiSelect device(s)] [chip type] [chip Intégrée] [bouton notes]
 *
 * Le MultiSelect regroupe en UNE seule liste l'équipement principal et son
 * régulateur déporté éventuel (au lieu de 2 lists séparées comme avant).
 *   - Premier item sélectionné → `*_device_id` (équipement principal)
 *   - Second item sélectionné  → `*_regulation_device_id` (régulateur déporté)
 *   - Pas de 3ᵉ item (le schéma DB n'expose qu'une paire). Si l'utilisateur
 *     pousse au-delà, on garde les 2 plus récents (slice -2).
 *
 * Le chip type de régulation (« Thermostat avec sonde déportée »…) et le
 * statut intégrée sont affichés à DROITE du select, sur la même ligne, en
 * exploitant l'espace horizontal disponible désormais que la card a été
 * découpée en sous-cards par zone.
 */
import { computed } from 'vue'
import SearchableSelect from '@/components/SearchableSelect.vue'

const props = defineProps({
  thermal: { type: Object, required: true },
  level: { type: String, required: true }, // 'production' | 'distribution' | 'emission'
  device: { type: Object, default: null },
  deviceOptions: { type: Array, default: () => [] },
  regulatorOptions: { type: Array, default: () => [] },
  // Mig 187 v10 — Type de régulation : options + handler d'édition.
  regulationTypeOptions: { type: Array, default: () => [] },
  integrated: { type: Boolean, default: false },
})
const emit = defineEmits(['patch-thermal', 'patch-device'])

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

// Modèle multi : tableau [device, régulateur déporté] limité à 2 entrées.
// Le régulateur n'est sémantiquement pertinent que si la régulation est
// déclarée Déportée (regulation_integrated=false). Si Intégrée par défaut,
// on ne POUSSE PAS le régulateur dans le multi (l'éq. principal pilote sa
// propre régulation). L'auditeur peut le faire apparaître en passant en
// Déportée dans la modale équipement.
const selectedDevices = computed(() => {
  const ids = []
  if (deviceId.value) ids.push(deviceId.value)
  if (!props.integrated && regulationDeviceId.value) ids.push(regulationDeviceId.value)
  return ids
})

// Combinaison des options device + régulateurs candidats (mêmes devices de
// la zone, mais filtrés par rôle régulation). Dédup par id (un device qui
// porte les 2 rôles ne doit apparaître qu'une fois dans la liste).
//
// Mig 187 v19 — les candidats régulateurs ne sont PROPOSÉS dans le dropdown
// de niveau QUE si le device principal est explicitement marqué « régulation
// déportée » (`regulation_integrated === false`). Sinon le dropdown est
// strict au niveau (un radiateur ne doit pas apparaître en Production sous
// prétexte qu'il porte aussi le rôle `regulation`). Le 2e slot du multi-
// select (regulator déporté) reste accessible uniquement après que
// l'auditeur a déclaré la régulation déportée dans la modale équipement.
const allOptions = computed(() => {
  const seen = new Set()
  const out = []
  for (const o of props.deviceOptions) {
    if (seen.has(o.value)) continue
    seen.add(o.value)
    out.push(o)
  }
  if (isDeported.value) {
    for (const o of props.regulatorOptions) {
      if (seen.has(o.value)) continue
      seen.add(o.value)
      out.push(o)
    }
  }
  return out
})

function setLevelDevices(ids) {
  const arr = Array.isArray(ids) ? ids : []
  // On garde les 2 derniers ids sélectionnés (FIFO) si l'utilisateur en
  // pousse plus que 2 — le 1er reste l'équipement principal, le 2e devient
  // le régulateur déporté. Pas de 3e column dans la DB.
  const limited = arr.length > 2 ? arr.slice(-2) : arr
  const [d, r] = limited
  emit('patch-thermal', {
    [deviceField.value]: d != null ? parseInt(d, 10) : null,
    [regulationField.value]: r != null ? parseInt(r, 10) : null,
  })
}

// Mig 187 v10 — type de régulation lu et écrit directement sur le device.
const regulationTypeField = computed(() => `regulation_type_${props.level}`)
const regulationTypeValue = computed(() => props.device?.[regulationTypeField.value] || null)
function setRegulationType(v) {
  if (!props.device) return
  emit('patch-device', {
    deviceId: props.device.id,
    patch: { [regulationTypeField.value]: v || null },
  })
}

// Mig 187 v18 — pastilles intégrée (bleue) / déportée (#7033d9). Au survol
// de la pastille déportée, on affiche les infos du régulateur (marque,
// référence, localisation) sourcées depuis le device émetteur lui-même
// (`regulator_brand`, `regulator_model_reference`, `regulator_location_X`).
const isDeported = computed(() =>
  props.device && (props.device.regulation_integrated === 0 || props.device.regulation_integrated === false))
// Libellé floatlabel "Équipements de <fonction>" (production / distribution /
// émission). « d'émission » avec apostrophe sur émission.
const LEVEL_LABEL = {
  production:   'Équipements de production',
  distribution: 'Équipements de distribution',
  emission:     "Équipements d'émission",
}
const devicesLabel = computed(() => LEVEL_LABEL[props.level] || 'Équipements')

const deportedTooltip = computed(() => {
  if (!isDeported.value || !props.device) return ''
  const lines = ['Régulation déportée']
  const brand = props.device.regulator_brand
  const ref = props.device.regulator_model_reference
  const loc = props.device[`regulator_location_${props.level}`]
  if (brand) lines.push(`• Marque : ${brand}`)
  if (ref)   lines.push(`• Référence : ${ref}`)
  if (loc)   lines.push(`• Localisation : ${loc}`)
  if (lines.length === 1) lines.push('Détails non renseignés — à compléter dans la modale équipement.')
  // Le tooltip directive transforme '\n' → <br> (cf. tooltip-directive.js).
  return lines.join('\n')
})
</script>

<template>
  <!-- Mig 187 v16 — ligne unique compacte avec mini-floatlabels au-dessus
       de chaque liste déroulante (lecture rapide du rôle de chaque champ
       sans ambiguïté). Chaque "groupe" (label + select) reste sur sa
       colonne flex. -->
  <div class="flex items-end gap-2 flex-nowrap">
    <div class="flex flex-col gap-0.5 shrink-0">
      <span class="text-[9px] uppercase tracking-wider text-gray-400 font-semibold">{{ devicesLabel }}</span>
      <SearchableSelect
        :model-value="selectedDevices"
        :options="allOptions"
        :multiple="true"
        :invalid="!deviceId"
        :auto-width="true"
        :chip-limit="1"
        chip-label="équipement"
        chip-label-plural="équipements"
        size="sm"
        placeholder="Ajouter un équipement…"
        search-placeholder="Rechercher…"
        @update:modelValue="setLevelDevices" />
    </div>
    <!-- Type de régulation — icône bleue préfixe si la régulation est
         intégrée à l'équipement. -->
    <div v-if="device" class="flex flex-col gap-0.5 shrink-0">
      <span class="text-[9px] uppercase tracking-wider text-gray-400 font-semibold">Type de régulation</span>
      <div class="flex items-center gap-1">
        <span v-if="integrated"
              class="inline-block w-2 h-2 rounded-full bg-sky-500 shrink-0"
              v-tooltip="`L'équipement embarque sa propre régulation (intégrée).`"></span>
        <span v-else-if="isDeported"
              class="inline-block w-2 h-2 rounded-full shrink-0"
              :style="{ background: '#7033d9' }"
              v-tooltip="deportedTooltip"></span>
        <SearchableSelect
          :model-value="regulationTypeValue"
          :options="regulationTypeOptions"
          :invalid="!regulationTypeValue"
          :clearable="true" :creatable="true" :auto-width="true"
          size="sm" placeholder="Type de régulation…"
          @update:modelValue="setRegulationType" />
      </div>
    </div>
    <slot name="after" />
  </div>
</template>
