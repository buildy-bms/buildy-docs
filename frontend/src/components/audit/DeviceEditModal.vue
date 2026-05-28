<script setup>
/**
 * Modale d'édition détaillée d'un équipement (« système » au sens métier).
 * Item 3 — saisie organisée en sections. Les états binaires sont des
 * boutons Oui / Non (SegmentedToggle, rien sélectionné tant que non
 * répondu), placés juste après la question. Un bandeau de complétude
 * indique si l'équipement est « validé » (= complètement renseigné).
 */
import { computed, ref, watch } from 'vue'
import BaseModal from '@/components/BaseModal.vue'
import SearchableSelect from '@/components/SearchableSelect.vue'
import ProtocolMultiPicker from '@/components/ProtocolMultiPicker.vue'
import SegmentedToggle from '@/components/audit/SegmentedToggle.vue'
import { updateBacsDevice, getEquipmentTemplate } from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useAuditStore } from '@/stores/audit'
import {
  ENERGY_OPTIONS, ROLE_OPTIONS, COMM_OPTIONS,
  regulationTypesForCategory, GRANULARITY_OPTIONS,
  isThermalCategory, isDeviceComplete, deviceMissingFields,
} from '@/lib/audit-options'

const props = defineProps({
  device: { type: Object, required: true },
  system: { type: Object, required: true },
  systemLabel: { type: String, default: '' },
  zoneName: { type: String, default: '' },
})
const emit = defineEmits(['close', 'changed'])
const { error } = useNotification()
const audit = useAuditStore()

// Item 8 — type de calcul de puissance (guide PROFEEL p.8).
const POWER_CALC_OPTIONS = [
  { value: 'thermodynamic_max', label: 'Thermodynamique (max chaud/froid)' },
  { value: 'boiler_sum', label: 'Chaudière (somme nominales)' },
  { value: 'joule_sum', label: 'Effet joule (somme élec.)' },
  { value: 'district_heating_substation', label: 'Sous-station réseau' },
  { value: 'out_of_scope', label: 'Hors cumul (secours, process…)' },
]
const YESNO = [
  { value: true, label: 'Oui', tone: 'green' },
  { value: false, label: 'Non', tone: 'slate' },
]
// Régulation intégrée à l'équipement (true) vs portée par un module
// déporté (false). Mig 183 — pilote l'affichage des champs régulateur.
const REGULATION_PLACEMENT_OPTS = [
  { value: true,  label: 'Intégrée', tone: 'green' },
  { value: false, label: 'Déportée', tone: 'slate' },
]
const METERING_OPTS = [
  { value: 'yes', label: 'Oui', tone: 'green' },
  { value: 'partial', label: 'Partiel', tone: 'amber' },
  { value: 'no', label: 'Non', tone: 'slate' },
]
const POWER_RELEVANT = new Set(['heating', 'cooling', 'ventilation', 'dhw'])

const showPower = computed(() => POWER_RELEVANT.has(props.system?.system_category))
const roleApplies = computed(() => isThermalCategory(props.system?.system_category))
const isShared = computed(() => Array.isArray(props.device.extra_system_ids) && props.device.extra_system_ids.length > 0)

// Usages desservis par l'équipement : système primaire + systèmes partagés
// (extra_system_ids). On n'affiche la puissance chaud / froid que pour
// l'usage concerné — les deux uniquement quand l'équipement sert à la fois
// le chauffage ET le refroidissement (équipement réversible partagé).
const servedCategories = computed(() => {
  const cats = new Set()
  if (props.system?.system_category) cats.add(props.system.system_category)
  const extra = props.device.extra_system_ids || []
  for (const s of (audit.systems || [])) {
    if (extra.includes(s.id) && s.system_category) cats.add(s.system_category)
  }
  return cats
})
const hasHeating = computed(() => servedCategories.value.has('heating'))
const hasCooling = computed(() => servedCategories.value.has('cooling'))
// Champ « chaud » : usages chauffage, mais aussi ventilation / ECS où il
// porte la puissance nominale. Masqué pour un usage refroidissement seul.
const showHeatPower = computed(() => showPower.value && (hasHeating.value || !hasCooling.value))
const showCoolPower = computed(() => showPower.value && hasCooling.value)
const heatPowerLabel = computed(() => (hasHeating.value ? 'Puissance chaud (kW)' : 'Puissance (kW)'))
// `power_kw` est LA colonne lue par le cumul R175-2 et le PDF. `power_kw_cooling`
// n'est qu'un complément, réservé aux équipements réversibles (chaud ET froid).
// Donc : usage refroidissement seul → la puissance froid va dans `power_kw` ;
// équipement réversible (les deux champs affichés) → le froid va dans
// `power_kw_cooling`, le chaud restant dans `power_kw`.
const coolPowerField = computed(() => (showHeatPower.value ? 'power_kw_cooling' : 'power_kw'))
const deviceRole = computed(() =>
  Array.isArray(props.device.device_role)
    ? props.device.device_role
    : (props.device.device_role ? [props.device.device_role] : []))

const hasProductionRole   = computed(() => deviceRole.value.includes('production'))
const hasDistributionRole = computed(() => deviceRole.value.includes('distribution'))
const hasEmissionRole     = computed(() => deviceRole.value.includes('emission'))

// Mig 184 — listes de suggestions de types de régulation. Priorité :
//   1. surcharge du modèle d'équipement (equipment_templates.regulation_*_types)
//   2. défauts par catégorie d'usage du système
//   3. fallback minimal { autre }
// Le template est fetché à l'ouverture de la modale via getEquipmentTemplate
// (1 seul appel — pas de cache audit car la modale est éphémère).
const template = ref(null)
watch(() => props.device.equipment_template_id, async (id) => {
  if (!id) { template.value = null; return }
  try { const { data } = await getEquipmentTemplate(id); template.value = data } catch { template.value = null }
}, { immediate: true })

const cat = computed(() => props.system?.system_category || null)
const regulationProductionOptions   = computed(() => regulationTypesForCategory('production',   cat.value, template.value?.regulation_production_types))
const regulationDistributionOptions = computed(() => regulationTypesForCategory('distribution', cat.value, template.value?.regulation_distribution_types))
const regulationEmissionOptions     = computed(() => regulationTypesForCategory('emission',     cat.value, template.value?.regulation_emission_types))

// Mig 183 — masquage des détails régulateur quand la régulation est
// explicitement « Intégrée ». Par défaut (null = pas répondu) ou si
// « Déportée », on affiche marque/référence/localisations pour que
// l'auditeur puisse renseigner.
const showRegulatorDetails = computed(() =>
  !(props.device.regulation_integrated === 1 || props.device.regulation_integrated === true)
)

// Options de zones (nom comme value ET label) pour la localisation par
// niveau de régulation. Mig 181 : on stocke en TEXT libre (creatable
// côté UI), donc le `value` doit être le NOM de la zone (pas son id) —
// l'utilisateur peut aussi saisir une localisation libre qui n'est pas
// une zone du site. Les zones techniques (kind ∋ 'technique' / 'lt')
// remontent en tête de la liste de suggestion.
const zoneOptions = computed(() => {
  const all = audit.zones || []
  const isTech = z => /techn|local.*technique|lt/i.test(`${z.kind || ''} ${z.name || ''}`)
  const tech = all.filter(isTech)
  const rest = all.filter(z => !isTech(z))
  return [...tech, ...rest]
    .filter(z => z.name)
    .map(z => ({ value: z.name, label: z.name }))
})

// Question « L'équipement est-il communicant ? » — désormais portée par la
// colonne dédiée `is_communicating` (mig 185), ternaire (null/false/true).
// Avant la mig 185, l'état était dérivé de la présence d'un protocole, ce
// qui empêchait l'auditeur de répondre Oui tant qu'aucun protocole n'avait
// été sélectionné (UX bloquante). Désormais : Oui/Non d'abord, puis si Oui
// la sélection du ou des protocoles devient un champ obligatoire (signalé
// par deviceMissingFields).
//
// Fallback de lecture pour les rows antérieures à la mig 185 (transitoire) :
// si `is_communicating` est null mais qu'on a un protocole, on l'interprète
// comme Oui ; si `non_communicant` est posé, comme Non.
const hasAnyProtocol = computed(() => {
  const raw = props.device.communication_protocols
  if (raw) {
    try {
      const arr = JSON.parse(raw)
      const real = Array.isArray(arr) ? arr.filter(v => v && v !== 'non_communicant') : []
      if (real.length) return true
    } catch { /* ignore */ }
  }
  return !!(props.device.communication_protocol && props.device.communication_protocol !== 'non_communicant')
})
const isCommunicating = computed(() => {
  if (props.device.is_communicating === 1 || props.device.is_communicating === true)  return true
  if (props.device.is_communicating === 0 || props.device.is_communicating === false) return false
  // Fallback legacy.
  const raw = props.device.communication_protocols
  if (raw) {
    try {
      const arr = JSON.parse(raw)
      const real = Array.isArray(arr) ? arr.filter(v => v && v !== 'non_communicant') : []
      if (real.length) return true
      if (Array.isArray(arr) && arr.includes('non_communicant')) return false
    } catch { /* fall through */ }
  }
  if (props.device.communication_protocol === 'non_communicant') return false
  if (props.device.communication_protocol) return true
  return null
})
function setCommunicating(v) {
  if (v === true) {
    // Oui → on persiste l'état, on efface le marqueur legacy « non_communicant »
    // s'il était posé. Les protocoles ne sont PAS pré-sélectionnés — l'auditeur
    // doit en choisir un (signalé en champ manquant).
    const p = { is_communicating: true }
    if (props.device.communication_protocol === 'non_communicant') {
      p.communication_protocol = null
    }
    patch(p)
  } else if (v === false) {
    // Non → on vide tous les protocoles + marque legacy + état persistant.
    patch({ is_communicating: false, communication_protocols: null, communication_protocol: 'non_communicant' })
  } else {
    patch({ is_communicating: null, communication_protocols: null, communication_protocol: null })
  }
}

// Toggle Oui/Non « L'équipement dispose-t-il d'une régulation ? ». Quand Oui,
// on ajoute automatiquement le niveau `regulation` dans device_role (et donc
// la section niveaux). Quand Non, on retire `regulation` (sans toucher aux
// autres niveaux) et on efface les champs régulateur.
function setHasRegulation(v) {
  const roles = new Set(deviceRole.value)
  const p = { has_regulation: v }
  if (v === true) {
    roles.add('regulation')
    p.device_role = [...roles]
  } else if (v === false) {
    roles.delete('regulation')
    p.device_role = [...roles]
    p.regulator_brand = null
    p.regulator_model_reference = null
    p.regulator_location_zone_id = null
  }
  patch(p)
}

// Tri-état : null/undefined → aucun bouton sélectionné ; 0/1 → Non/Oui.
const triState = (v) => (v == null ? null : !!v)

async function patch(p) {
  try {
    const { data } = await updateBacsDevice(props.device.id, p)
    Object.assign(props.device, data)
    emit('changed')
  } catch {
    error('Sauvegarde impossible')
  }
}
function patchInput(field, value) {
  const v = (value === '' || value == null) ? null : value
  if (v !== (props.device[field] ?? null)) patch({ [field]: v })
}

// Complétude — « validé » = complètement renseigné. Liste ce qu'il reste.
const missing = computed(() => deviceMissingFields(props.device, props.system?.system_category))
const forced = computed(() => !!props.device.validation_forced)
const complete = computed(() => isDeviceComplete(props.device, props.system?.system_category))

const inputCls = 'h-9 px-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition'
const headCls = 'px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-700 uppercase tracking-wider'
</script>

<template>
  <BaseModal
    :title="`Modifier l'équipement — ${systemLabel}${zoneName ? ' / ' + zoneName : ''}`"
    size="2xl"
    :dismiss-on-backdrop="false"
    @close="emit('close')"
  >
    <div class="space-y-3 pb-2">
      <!-- Identification de l'équipement — grille 2-cols unique, plus de
           split en 2 sections (causait des row mismatches inévitables dès
           que les sections n'avaient pas le même nombre de champs).
           Chaque ligne pose 2 inputs côte à côte de même hauteur — pas de
           cellule vide, pas de section secondaire qui se termine plus tôt. -->
      <section class="rounded-xl border border-gray-200 overflow-hidden">
        <h4 :class="headCls">Identification</h4>
        <div class="p-3 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-3">
          <div class="sm:col-span-2">
            <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Nom</label>
            <input type="text" :value="device.name || ''" placeholder="ex : Chaudière gaz principale"
                   @blur="e => patchInput('name', e.target.value)" :class="inputCls" class="w-full" />
          </div>
          <div>
            <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Marque</label>
            <input type="text" :value="device.brand || ''" placeholder="Atlantic"
                   @blur="e => patchInput('brand', e.target.value)" :class="inputCls" class="w-full" />
          </div>
          <div>
            <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Référence</label>
            <input type="text" :value="device.model_reference || ''" placeholder="Varmax 70"
                   @blur="e => patchInput('model_reference', e.target.value)" :class="inputCls" class="w-full" />
          </div>
          <div>
            <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Énergie</label>
            <SearchableSelect :model-value="device.energy_source" :options="ENERGY_OPTIONS"
                              :clearable="false" size="sm" placeholder="Énergie"
                              @update:model-value="v => patch({ energy_source: v || null })" />
          </div>
          <div>
            <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Localisation</label>
            <input type="text" :value="device.location || ''" placeholder="ex : Local technique sous-sol"
                   @blur="e => patchInput('location', e.target.value)" :class="inputCls" class="w-full" />
          </div>
          <div>
            <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Quantité</label>
            <input type="number" min="1" step="1" :value="device.quantity ?? 1"
                   @blur="e => patch({ quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })"
                   :class="inputCls" class="w-full" />
          </div>
          <div>
            <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Âge (années)</label>
            <input type="number" min="0" step="1" :value="device.age_years ?? ''" placeholder="—"
                   @blur="e => patch({ age_years: e.target.value === '' ? null : Math.max(0, parseInt(e.target.value, 10) || 0) })"
                   :class="inputCls" class="w-full" />
          </div>
          <template v-if="showPower">
            <div v-if="showHeatPower">
              <label class="block text-[11px] font-medium text-gray-600 mb-0.5">{{ heatPowerLabel }}</label>
              <input type="number" min="0" step="0.1" :value="device.power_kw ?? ''" placeholder="—"
                     @blur="e => patch({ power_kw: e.target.value === '' ? null : parseFloat(e.target.value) })"
                     :class="inputCls" class="w-full" />
            </div>
            <div v-if="showCoolPower" :class="{ 'sm:col-span-2': !showHeatPower }">
              <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Puissance froid (kW)</label>
              <input type="number" min="0" step="0.1" :value="device[coolPowerField] ?? ''" placeholder="—"
                     @blur="e => patch({ [coolPowerField]: e.target.value === '' ? null : parseFloat(e.target.value) })"
                     :class="inputCls" class="w-full" />
            </div>
            <div class="sm:col-span-2">
              <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Type de calcul de puissance</label>
              <SearchableSelect :model-value="device.power_calculation_type" :options="POWER_CALC_OPTIONS"
                                :clearable="true" size="sm" placeholder="Calcul automatique"
                                @update:model-value="v => patch({ power_calculation_type: v || null })" />
            </div>
          </template>
        </div>
      </section>

      <!-- Fonctions intégrées — pleine largeur pour ne pas casser l'alignement
           horizontal des sections Identité / Énergie au-dessus (les pilules
           multi-select sont de hauteur variable). -->
      <section class="rounded-xl border border-gray-200 overflow-hidden">
        <h4 :class="headCls">Fonctions intégrées</h4>
        <div class="p-3">
          <SearchableSelect :model-value="deviceRole" :options="ROLE_OPTIONS"
                            :multiple="true" :clearable="true" :creatable="true" size="sm"
                            placeholder="Production / Distribution / Émission / Régulation…"
                            @update:model-value="v => patch({ device_role: Array.isArray(v) ? v : [] })" />
        </div>
      </section>

      <!-- Régulation (équipement) -->
      <section class="rounded-xl border border-gray-200 overflow-hidden">
        <h4 :class="headCls">Régulation</h4>
        <div class="p-3 space-y-3">
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm">
              <div class="font-medium text-gray-800">L'équipement dispose-t-il d'une régulation ?</div>
              <div class="text-xs text-gray-500 mt-0.5">
                Régulation intégrée (thermostat embarqué) ou externe (régulateur séparé). Si Oui, la fonction « Régulation » est ajoutée automatiquement.
              </div>
            </div>
            <SegmentedToggle :model-value="triState(device.has_regulation)" :options="YESNO"
                             @update:model-value="setHasRegulation" />
          </div>

          <div v-if="device.has_regulation === 1 || device.has_regulation === true" class="space-y-3 pt-1">
            <!-- Intégrée à l'équipement ou déportée ? Pilote l'affichage des
                 champs marque / référence / localisation : si intégrée, ces
                 infos sont implicitement celles de l'équipement principal et
                 on évite la double saisie. -->
            <div class="flex items-center justify-between gap-3">
              <div class="text-sm flex-1">
                <div class="font-medium text-gray-800">La régulation est-elle intégrée à l'équipement ou déportée ?</div>
                <div class="text-xs text-gray-500 mt-0.5">
                  Intégrée = thermostat embarqué, contrôle natif PAC, électronique sur la chaudière. Déportée = régulateur séparé (Siemens, GTB, sonde déportée…). Si intégrée, marque, référence et localisation sont les mêmes que l'équipement.
                </div>
              </div>
              <SegmentedToggle :model-value="triState(device.regulation_integrated)"
                               :options="REGULATION_PLACEMENT_OPTS"
                               @update:model-value="v => patch({ regulation_integrated: v })" />
            </div>

            <!-- Régulateur — marque + référence. Masqués UNIQUEMENT quand
                 la régulation est explicitement Intégrée. -->
            <div v-if="showRegulatorDetails"
                 class="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-3">
              <div>
                <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Marque du régulateur</label>
                <input type="text" :value="device.regulator_brand || ''" placeholder="ex : Siemens"
                       @blur="e => patchInput('regulator_brand', e.target.value)" :class="inputCls" class="w-full" />
              </div>
              <div>
                <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Référence</label>
                <input type="text" :value="device.regulator_model_reference || ''" placeholder="ex : RVS43.143"
                       @blur="e => patchInput('regulator_model_reference', e.target.value)" :class="inputCls" class="w-full" />
              </div>
            </div>

            <!-- Par niveau présent : Type de régulation + Localisation (si
                 régulation déportée). Localisation cachée si intégrée
                 (l'emplacement est implicitement celui de l'équipement).
                 Mig 187 v12 — type de régulation visible dès qu'on a
                 répondu Oui à has_regulation, indépendamment du choix
                 Intégrée / Déportée. -->
            <div v-if="hasProductionRole" :class="['grid gap-x-3 gap-y-3', showRegulatorDetails ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1']">
              <div>
                <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Type de régulation de production</label>
                <SearchableSelect :model-value="device.regulation_type_production"
                                  :options="regulationProductionOptions"
                                  :clearable="true" :creatable="true" size="sm" placeholder="Loi d'eau, cascade…"
                                  @update:model-value="v => patch({ regulation_type_production: v || null })" />
              </div>
              <div v-if="showRegulatorDetails">
                <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Localisation de la régulation de production</label>
                <SearchableSelect :model-value="device.regulator_location_production"
                                  :options="zoneOptions"
                                  :clearable="true" :creatable="true" size="sm"
                                  placeholder="Chaufferie, local technique…"
                                  @update:model-value="v => patch({ regulator_location_production: v || null })" />
              </div>
            </div>
            <div v-if="hasDistributionRole" :class="['grid gap-x-3 gap-y-3', showRegulatorDetails ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1']">
              <div>
                <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Type de régulation de distribution</label>
                <SearchableSelect :model-value="device.regulation_type_distribution"
                                  :options="regulationDistributionOptions"
                                  :clearable="true" :creatable="true" size="sm" placeholder="Vanne 3 voies, débit variable…"
                                  @update:model-value="v => patch({ regulation_type_distribution: v || null })" />
              </div>
              <div v-if="showRegulatorDetails">
                <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Localisation de la régulation de distribution</label>
                <SearchableSelect :model-value="device.regulator_location_distribution"
                                  :options="zoneOptions"
                                  :clearable="true" :creatable="true" size="sm"
                                  placeholder="Gaine technique, sous-sol…"
                                  @update:model-value="v => patch({ regulator_location_distribution: v || null })" />
              </div>
            </div>
            <div v-if="hasEmissionRole" class="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-3">
              <div>
                <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Type de régulation d'émission</label>
                <SearchableSelect :model-value="device.regulation_type_emission"
                                  :options="regulationEmissionOptions"
                                  :clearable="true" :creatable="true" size="sm" placeholder="Thermostat, présence, lumière constante…"
                                  @update:model-value="v => patch({ regulation_type_emission: v || null })" />
              </div>
              <div>
                <label class="block text-[11px] font-medium text-gray-600 mb-0.5">
                  Granularité R175-6
                  <span class="text-gray-400 font-normal">— précision spatiale</span>
                </label>
                <SearchableSelect :model-value="device.regulation_granularity"
                                  :options="GRANULARITY_OPTIONS"
                                  :clearable="true" :creatable="true" size="sm"
                                  placeholder="Par pièce / Par zone / Centralisée…"
                                  @update:model-value="v => patch({ regulation_granularity: v || null })" />
              </div>
              <div v-if="showRegulatorDetails" class="sm:col-span-2">
                <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Localisation de la régulation d'émission</label>
                <SearchableSelect :model-value="device.regulator_location_emission"
                                  :options="zoneOptions"
                                  :clearable="true" :creatable="true" size="sm"
                                  placeholder="Bureau, salle de réunion…"
                                  @update:model-value="v => patch({ regulator_location_emission: v || null })" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Communication & conformité R175-3 -->
      <section class="rounded-xl border border-gray-200 overflow-hidden">
        <h4 :class="headCls">Communication &amp; conformité R175-3</h4>
        <div class="p-3">
          <div class="grid grid-cols-1 sm:grid-cols-12 gap-3 items-stretch">
            <div class="sm:col-span-4 flex flex-col">
              <label class="block text-[11px] font-medium text-gray-600 mb-0.5">L'équipement est-il communicant ?</label>
              <div class="flex-1 flex items-center">
                <SegmentedToggle :model-value="isCommunicating" :options="YESNO"
                                 @update:model-value="setCommunicating" />
              </div>
            </div>
            <div class="sm:col-span-8 flex flex-col"
                 :class="{ 'opacity-50 pointer-events-none': isCommunicating !== true }">
              <label class="block text-[11px] font-medium text-gray-600 mb-0.5">
                Protocole(s) de communication
                <span v-if="isCommunicating === true && !hasAnyProtocol" class="text-rose-600 font-semibold">·  obligatoire</span>
              </label>
              <ProtocolMultiPicker
                :model-value="device.communication_protocols || (device.communication_protocol && device.communication_protocol !== 'non_communicant' ? JSON.stringify([device.communication_protocol]) : null)"
                :options="COMM_OPTIONS" placeholder="Sélectionner un ou plusieurs protocoles…" size="md"
                :exclude-non-communicant="true"
                @update:modelValue="v => patch({ communication_protocols: v, communication_protocol: v ? null : device.communication_protocol })" />
            </div>
          </div>
          <p class="text-xs text-gray-500 leading-snug mt-1">
            Réponds d'abord <strong>Oui</strong> ou <strong>Non</strong> à la question. Si Oui,
            sélectionne au moins un protocole : un équipement qui ne communique avec aucun protocole
            ne peut être ni piloté ni suivi à distance.
          </p>
        </div>
        <div class="border-t border-gray-100 px-3 py-3 space-y-3">
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm flex-1">
              <div class="font-medium text-gray-800">
                L'équipement est-il relié à la GTB par une liaison câblée ?
                <span class="font-normal text-gray-400 ml-1">· R175-3 §3</span>
              </div>
              <div class="text-xs text-gray-500 mt-0.5">L'équipement est relié à la supervision par un câble dédié — la base de l'interopérabilité exigée par le décret.</div>
            </div>
            <SegmentedToggle :model-value="triState(device.wired)" :options="YESNO"
                             @update:model-value="v => patch({ wired: v })" />
          </div>
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm flex-1">
              <div class="font-medium text-gray-800">
                Peut-on arrêter l'équipement manuellement, sur place ?
                <span class="font-normal text-gray-400 ml-1">· R175-3 §4</span>
              </div>
              <div class="text-xs text-gray-500 mt-0.5">On peut arrêter l'équipement directement sur place, sans passer par la supervision.</div>
            </div>
            <SegmentedToggle :model-value="triState(device.meets_r175_3_p4)" :options="YESNO"
                             @update:model-value="v => patch({ meets_r175_3_p4: v })" />
          </div>
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm flex-1">
              <div class="font-medium text-gray-800">
                L'équipement redémarre-t-il de façon autonome après une coupure ?
                <span class="font-normal text-gray-400 ml-1">· R175-3 §4</span>
              </div>
              <div class="text-xs text-gray-500 mt-0.5">Après une coupure de courant ou un redémarrage de la GTB, l'équipement repart seul, sans intervention d'un technicien.</div>
            </div>
            <SegmentedToggle :model-value="triState(device.meets_r175_3_p4_autonomous)" :options="YESNO"
                             @update:model-value="v => patch({ meets_r175_3_p4_autonomous: v })" />
          </div>
        </div>
      </section>

      <!-- Suivi énergétique BACS — comptage séparable + équipement centralisé multi-bâtiments -->
      <section class="rounded-xl border border-gray-200 overflow-hidden">
        <h4 :class="headCls">Suivi énergétique BACS</h4>
        <div class="p-3 space-y-3">
          <!-- Comptage séparable : visible uniquement pour les équipements
               partagés entre plusieurs systèmes/zones. -->
          <div v-if="isShared" class="flex items-center justify-between gap-3">
            <div class="text-sm flex-1">
              <div class="font-medium text-gray-800">Le comptage de cet équipement est-il séparable par zone fonctionnelle ?</div>
              <div class="text-xs text-gray-500 mt-0.5">La consommation de chaque zone desservie par cet équipement partagé peut être relevée séparément.</div>
            </div>
            <SegmentedToggle :model-value="device.metering_separable || null" :options="METERING_OPTS"
                             @update:model-value="v => patch({ metering_separable: v })" />
          </div>
          <!-- Multi-bâtiments — visible sur tous les équipements (chaudière
               centrale, GPC, sous-station…). Déplacé depuis le niveau
               système (refactor 2026-05-26, mig 175). Détermine le cas F
               d'assujettissement : tous les propriétaires du site sont
               assujettis ensemble. -->
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm flex-1">
              <div class="font-medium text-gray-800">Cet équipement dessert-il plusieurs bâtiments du site ?</div>
              <div class="text-xs text-gray-500 mt-0.5">Chaudière commune, groupe de production de chaleur, sous-station : un équipement central qui sert plusieurs bâtiments du site. Tous les propriétaires du site deviennent alors assujettis ensemble (cas F du décret).</div>
            </div>
            <SegmentedToggle :model-value="triState(device.serves_multiple_buildings)" :options="YESNO"
                             @update:model-value="v => patch({ serves_multiple_buildings: v })" />
          </div>
          <input v-if="isShared" type="text" :value="device.metering_separable_note || ''"
                 placeholder="Justification courte sur la séparabilité du comptage…"
                 @blur="e => patchInput('metering_separable_note', e.target.value)"
                 :class="inputCls" class="w-full" />
        </div>
      </section>

      <!-- État de l'équipement -->
      <section class="rounded-xl border border-gray-200 overflow-hidden">
        <h4 :class="headCls">État de l'équipement</h4>
        <div class="p-3 space-y-3">
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm flex-1">
              <div class="font-medium text-gray-800">Est-ce un équipement de secours ?</div>
              <div class="text-xs text-gray-500 mt-0.5">Équipement de secours, non utilisé en fonctionnement normal — sa puissance n'entre pas dans le calcul d'assujettissement au décret.</div>
            </div>
            <SegmentedToggle :model-value="triState(device.is_backup)" :options="YESNO"
                             @update:model-value="v => patch({ is_backup: v })" />
          </div>
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm flex-1">
              <div class="font-medium text-gray-800">L'équipement est-il hors service ?</div>
              <div class="text-xs text-gray-500 mt-0.5">Équipement hors d'usage : il n'est pas pris en compte dans le plan de mise en conformité.</div>
            </div>
            <SegmentedToggle :model-value="triState(device.out_of_service)" :options="YESNO"
                             @update:model-value="v => patch({ out_of_service: v })" />
          </div>
        </div>
      </section>

    </div>

    <template #footer>
      <div class="flex items-center justify-between gap-3 flex-wrap w-full">
        <div class="flex items-center gap-3 flex-wrap">
          <span v-if="complete && !forced"
                class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium">
            ✓ Équipement complet
          </span>
          <span v-else-if="forced"
                class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-xs font-medium"
                :title="missing.length ? `Champs non renseignés : ${missing.join(', ')}` : ''">
            ⚠ Validation forcée
          </span>
          <template v-else>
            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-xs font-medium"
                  :title="`À renseigner : ${missing.join(', ')}`">
              ⚠ Incomplet
              <span class="text-amber-700/80 font-normal">— {{ missing.length }} champ{{ missing.length > 1 ? 's' : '' }}</span>
            </span>
            <label class="inline-flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input type="checkbox" :checked="!!device.validation_forced"
                     @change="e => patch({ validation_forced: e.target.checked })"
                     class="w-4 h-4 accent-amber-500" />
              Forcer la validation
            </label>
          </template>
        </div>
        <button type="button" @click="emit('close')"
                class="h-9 px-4 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition">
          Fermer
        </button>
      </div>
    </template>
  </BaseModal>
</template>
