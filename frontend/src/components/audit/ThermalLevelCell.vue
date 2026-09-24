<script setup>
/**
 * Cellule d'un niveau (Production / Distribution / Émission) dans la card 06
 * « Régulation thermique automatique » (mig 187 v3).
 *
 * Layout COMPACT 1 ligne, en grille partagée avec l'en-tête du tableau
 * (`.thermal-level-grid`, main.css) pour que les colonnes s'alignent d'une
 * ligne à l'autre ; les libellés sont portés une seule fois par l'en-tête :
 *   [MultiSelect device(s)] [pastille + type] [granularité (émission)] [note]
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
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { faPenToSquare } from '@fortawesome/pro-solid-svg-icons'
import SearchableSelect from '@/components/SearchableSelect.vue'

library.add(faPenToSquare)

const props = defineProps({
  thermal: { type: Object, required: true },
  level: { type: String, required: true }, // 'production' | 'distribution' | 'emission'
  device: { type: Object, default: null },
  deviceOptions: { type: Array, default: () => [] },
  regulatorOptions: { type: Array, default: () => [] },
  // Mig 187 v10 — Type de régulation : options + handler d'édition.
  regulationTypeOptions: { type: Array, default: () => [] },
  integrated: { type: Boolean, default: false },
  // Note du niveau (production_notes_html / distribution_notes_html /
  // emission_notes_html) : éditée via la modale de notes partagée (la vue),
  // reprise dans le PDF et sur la PWA.
  noteHtml: { type: String, default: '' },
})
const emit = defineEmits(['patch-thermal', 'patch-device', 'open-notes'])

const LEVEL_SHORT = { production: 'production', distribution: 'distribution', emission: 'émission' }
// Aperçu texte de la note (DOMParser : n'exécute aucun script, ne charge
// aucune image, contrairement à innerHTML sur un élément détaché).
const noteText = computed(() => {
  if (!props.noteHtml) return ''
  const doc = new DOMParser().parseFromString(props.noteHtml, 'text/html')
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
})
const noteTooltip = computed(() => {
  const lvl = LEVEL_SHORT[props.level] || props.level
  if (!noteText.value) return `Ajouter une note (${lvl})`
  const t = noteText.value.length > 160 ? noteText.value.slice(0, 157) + '…' : noteText.value
  return `Note ${lvl} :\n${t}`
})

const LEVEL_DEVICE_FIELD = {
  production:   'generator_device_id',
  distribution: 'distribution_device_id',
  emission:     'emission_device_id',
}
// Mig 193 — colonne TEXT JSON pour les équipements additionnels par niveau.
// La FK primaire (LEVEL_DEVICE_FIELD) reste source de vérité pour R175-6.
const LEVEL_EXTRA_FIELD = {
  production:   'production_extra_device_ids',
  distribution: 'distribution_extra_device_ids',
  emission:     'emission_extra_device_ids',
}

const deviceField = computed(() => LEVEL_DEVICE_FIELD[props.level])
const extraField = computed(() => LEVEL_EXTRA_FIELD[props.level])
const deviceId = computed(() => props.thermal[deviceField.value])
const extraIds = computed(() => {
  const raw = props.thermal[extraField.value]
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.map(n => parseInt(n, 10)).filter(n => !Number.isNaN(n)) : []
  } catch { return [] }
})

// Multi-sélection illimitée : premier item = device_id (FK primaire),
// les suivants = JSON array dans la colonne *_extra_device_ids (mig 193).
// Filtré sur les ids présents dans le dropdown strict du niveau pour
// ne pas afficher de chips orphelins.
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
  for (const id of extraIds.value) push(id)
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
  // Mig 193 — multi-sélection illimitée par niveau.
  // ids[0] → FK primaire `*_device_id` (source de vérité R175-6)
  // ids[1..N] → JSON dans `*_extra_device_ids`
  const arr = Array.isArray(ids)
    ? ids.map(n => parseInt(n, 10)).filter(n => !Number.isNaN(n))
    : []
  const [primary, ...extra] = arr
  emit('patch-thermal', {
    [deviceField.value]: primary != null ? primary : null,
    [extraField.value]: extra.length ? JSON.stringify(extra) : null,
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
  <!-- Une ligne alignée sur l'en-tête du tableau : équipement(s) · type de
       régulation · [granularité, slot « after », pour l'émission] · note.
       Info manquante = ambre « à compléter » (le rouge reste réservé aux
       non-conformités, ex. granularité centralisée). -->
  <div :class="['thermal-level-grid', level === 'emission' ? 'is-emission' : '']">
    <SearchableSelect
      class="tl-eq"
      :model-value="selectedDevices"
      :options="allOptions"
      :multiple="true"
      :invalid="!deviceId"
      invalid-tone="amber"
      :clearable="false"
      :chip-limit="1"
      chip-label="équipement"
      chip-label-plural="équipements"
      size="sm"
      placeholder="Équipement…"
      search-placeholder="Rechercher…"
      @update:modelValue="setLevelDevices" />
    <!-- Type de régulation (porté par l'équipement) — pastille bleue si la
         régulation est intégrée, violette si déportée (détails au survol). -->
    <div v-if="device" class="tl-type flex items-center gap-1.5">
      <span v-if="integrated"
            class="inline-block w-2 h-2 rounded-full bg-sky-500 shrink-0"
            v-tooltip="`L'équipement embarque sa propre régulation (intégrée).`"></span>
      <span v-else-if="isDeported"
            class="inline-block w-2 h-2 rounded-full shrink-0"
            :style="{ background: '#7033d9' }"
            v-tooltip="deportedTooltip"></span>
      <SearchableSelect
        class="flex-1 min-w-0"
        :model-value="regulationTypeValue"
        :options="regulationTypeOptions"
        :invalid="!regulationTypeValue"
        invalid-tone="amber"
        :clearable="true" :creatable="true"
        size="sm" placeholder="Type…"
        @update:modelValue="setRegulationType" />
    </div>
    <span v-else class="tl-type px-2 text-xs text-gray-300"
          v-tooltip="`Choisis d'abord l'équipement (${LEVEL_SHORT[level] || level})`">—</span>
    <slot name="after" />
    <!-- Note du niveau (ex. « sonde d'ambiance à déplacer ») -->
    <button type="button"
            :class="['tl-note inline-flex items-center justify-center w-7 h-7 rounded-md transition',
                     noteText ? 'text-indigo-700 bg-indigo-50 hover:bg-indigo-100' : 'text-gray-300 hover:text-gray-600 hover:bg-slate-100']"
            v-tooltip="noteTooltip"
            :aria-label="noteTooltip"
            @click="emit('open-notes')">
      <FontAwesomeIcon :icon="['fas', 'pen-to-square']" class="w-3.5 h-3.5" />
    </button>
  </div>
</template>
