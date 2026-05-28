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

// Mig 187 v20 — selectedDevices ne contient que des ids présents dans le
// dropdown strict du niveau. Les anciennes FK régulateur (pointant
// éventuellement vers un device d'un autre niveau, ex. aérotherme stocké
// dans `production_regulation_device_id`) ne sont plus affichées comme
// chips orphelins (id brut sans label) — elles restent en DB mais ne
// polluent plus l'UI. Le régulateur déporté est désormais documenté
// uniquement via les champs free-text de la modale équipement.
const selectedDevices = computed(() => {
  const validIds = new Set(props.deviceOptions.map(o => o.value))
  const seen = new Set()
  const ids = []
  const push = (id) => {
    if (id != null && validIds.has(id) && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  push(deviceId.value)
  if (!props.integrated) push(regulationDeviceId.value)
  return ids
})

// Mig 187 v20 — dropdown STRICT au niveau (Production / Distribution /
// Émission). On ne fusionne plus les candidats régulateurs : dans la
// pratique, l'auditeur tagge ses émetteurs / distributeurs / générateurs
// comme « regulation » aussi (régulation intégrée), ce qui les rendait
// candidats à être proposés comme régulateur déporté d'autres niveaux et
// polluait le dropdown (un radiateur proposé en Production, un circuit
// d'eau chaude proposé en Émission). Le régulateur déporté est désormais
// décrit via les champs free-text `regulator_brand` / `regulator_model_reference`
// / `regulator_location_<level>` saisis dans la modale équipement (visibles
// dans le tooltip de la pastille violette).
const allOptions = computed(() => {
  const seen = new Set()
  const out = []
  for (const o of props.deviceOptions) {
    if (seen.has(o.value)) continue
    seen.add(o.value)
    out.push(o)
  }
  return out
})

function setLevelDevices(ids) {
  const arr = Array.isArray(ids) ? ids : []
  // On garde les 2 derniers ids sélectionnés (FIFO) si l'utilisateur en
  // pousse plus que 2.
  const limited = arr.length > 2 ? arr.slice(-2) : arr
  const [d, r] = limited
  const patch = {
    [deviceField.value]: d != null ? parseInt(d, 10) : null,
  }
  // Mig 187 v20 — n'écrase regulationField QUE si l'utilisateur a
  // explicitement sélectionné un 2e item. En single-pick, on préserve la
  // FK régulateur historique en DB (les anciennes données ne sont plus
  // affichées par selectedDevices si elles pointent vers un device d'un
  // autre niveau, mais on évite d'écraser silencieusement).
  if (arr.length >= 2) {
    patch[regulationField.value] = r != null ? parseInt(r, 10) : null
  }
  emit('patch-thermal', patch)
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
