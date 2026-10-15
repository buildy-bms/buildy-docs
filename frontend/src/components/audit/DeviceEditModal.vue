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
import DevicePanelShell from '@/components/audit/DevicePanelShell.vue'
import SearchableSelect from '@/components/SearchableSelect.vue'
import ProtocolMultiPicker from '@/components/ProtocolMultiPicker.vue'
import SegmentedToggle from '@/components/audit/SegmentedToggle.vue'
import HelpTip from '@/components/HelpTip.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import DeviceSectionHeader from '@/components/audit/DeviceSectionHeader.vue'
import { updateBacsDevice, getEquipmentTemplate, moveBacsDevice, shareBacsDevice } from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useAuditStore } from '@/stores/audit'
import {
  ENERGY_OPTIONS, ROLE_OPTIONS, COMM_OPTIONS,
  regulationTypesForCategory, GRANULARITY_OPTIONS,
  isThermalCategory, isDeviceComplete, deviceMissingFields, deviceMissingItems, DEVICE_SECTIONS,
  systemUsageLabel, deviceRoleAllowsEnergySource,
} from '@/lib/audit-options'
import { missingShort } from '@/lib/systems-guide'
import { checkText, RUBRICS_ALL_TIPS, CHECK_RUBRIC } from '@/lib/audit-tips-systems-guide'
import { plural } from '@/lib/tooltip-content'
import {
  POWER_INFO_ONLY_TIP, POWER_CALC_TIP, GRANULARITY_TIP, GTB_SCOPE_OPTION_TIPS, DEVICE_BACKUP_TIP,
  DEVICE_OUT_OF_SERVICE_TIP, FORCE_VALIDATION_TIP, DEVICE_COMPLETE_TIP, deviceStatusTip, deviceProtocolsLockedTip,
} from '@/lib/audit-tips-systems'

const props = defineProps({
  device: { type: Object, required: true },
  system: { type: Object, required: true },
  systemLabel: { type: String, default: '' },
  zoneName: { type: String, default: '' },
  // Fiche équipement dans la page (étape Systèmes à onglets) plutôt qu'une
  // fenêtre : même formulaire, sans fond ni fenêtre (DevicePanelShell).
  panel: { type: Boolean, default: false },
  // Mise en page guidée : fiche en rubriques (état et résumé de chacune, voir plus bas) et
  // points « à vérifier » de l'équipement (pré-contrôle), rangés dans leur rubrique.
  rubrics: { type: Boolean, default: false },
  checks: { type: Array, default: () => [] },
})
const emit = defineEmits(['close', 'changed'])
const shell = computed(() => (props.panel ? DevicePanelShell : BaseModal))
const { error } = useNotification()
const audit = useAuditStore()

// Item 8 — type de calcul de puissance (guide PROFEEL p.8).
const POWER_CALC_OPTIONS = [
  { value: 'thermodynamic_max', label: 'Pompe à chaleur, climatisation (la plus forte des puissances)' },
  { value: 'boiler_sum', label: 'Chaudières (somme des puissances nominales)' },
  { value: 'joule_sum', label: 'Effet Joule (somme des puissances électriques)' },
  { value: 'district_heating_substation', label: 'Sous-station de réseau de chaleur' },
  { value: 'out_of_scope', label: 'Hors cumul (secours, procédés…)' },
]
const YESNO = [
  { value: true, label: 'Oui', tone: 'green' },
  { value: false, label: 'Non', tone: 'slate' },
]
// Mig 201 — exception par équipement du périmètre GTB. null = suit l'usage
// (« usages traités par la GTB »), true = forcé dans, false = forcé hors.
// Deux réponses seulement (Kévin, 2026-10-15 : « Selon l'usage » ne voulait rien dire) : « Oui »
// = cas normal (null) ; « Non, pas à raccorder » = exclu (false). Le « forcé dans » (true) n'est
// plus proposé : sur les 22 équipements qui l'avaient, l'usage était déjà traité par la GTB (aucun
// effet) ; il s'affiche comme « Oui » et reste compris par le serveur.
const SCOPE_OPTIONS = [
  { value: null,  label: 'Oui', tip: GTB_SCOPE_OPTION_TIPS.default },
  { value: false, label: 'Non, pas à raccorder', tip: GTB_SCOPE_OPTION_TIPS.no },
]
const gtbScopeSel = computed(() => {
  const v = props.device.gtb_scope_override
  return v === 0 || v === false ? false : null
})
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
// Élargi en 0.1.144 : la puissance est aussi pertinente pour lighting/PV
// dès lors que la fonction Production est cochée. Cumul R175-2 (thermique
// seul) reste géré par computeAutoPower côté backend — la puissance lighting
// saisie reste informative et n'entre pas dans le cumul d'assujettissement.
const POWER_RELEVANT = new Set(['heating', 'cooling', 'ventilation', 'dhw', 'lighting_indoor', 'lighting_outdoor', 'electricity_production'])

const showPower = computed(() => POWER_RELEVANT.has(props.system?.system_category))
// PV production = chaîne CVC inapplicable (l'équipement EST la production,
// pas de distribution/émission/régulation en aval BACS) + énergie non
// consommée + comptage par nature global (un seul compteur PV). On masque
// tous les champs qui ne s'appliquent pas pour éviter de piéger l'auditeur.
const isPvProduction = computed(() => props.system?.system_category === 'electricity_production')
// Catégories effectivement cumulées dans R175-2 (chauffage + climatisation +
// éventuellement ventilation/ECS via batterie). Le reste reste informatif.
const THERMAL_R175_CATEGORIES = new Set(['heating', 'cooling', 'ventilation', 'dhw'])
const isThermalForR175 = computed(() => THERMAL_R175_CATEGORIES.has(props.system?.system_category))
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
const heatPowerLabel = computed(() => {
  const cat = props.system?.system_category
  if (cat === 'lighting_indoor' || cat === 'lighting_outdoor') return 'Puissance installée (kW)'
  if (cat === 'electricity_production') return 'Puissance crête installée (kWc, valeur positive)'
  if (hasHeating.value) return 'Puissance chaud (kW)'
  return 'Puissance (kW)'
})
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

// Doctrine mig 194 — l'énergie primaire ne se renseigne que pour un
// équipement de production. Pour un radiateur ou un ventilo-convecteur
// (rôle émission seul), pas d'énergie : la chaleur vient d'ailleurs.
// showEnergyField pilote à la fois l'affichage du champ « Énergie primaire »
// et l'activation du champ Puissance (via la card « non saisissable »).
// Pour la production PV, la fonction Production est implicite (la section
// Fonctions est masquée) : on force à true pour que la puissance crête
// installée reste saisissable. Le champ Énergie primaire lui reste masqué
// via la section Fonctions hidden.
const showEnergyField = computed(() => isPvProduction.value || deviceRoleAllowsEnergySource(deviceRole.value))

// Aide pédagogique sur le rôle : un exemple court par catégorie d'usage
// pour ancrer la doctrine production/distribution/émission/régulation.
const roleHelpExample = computed(() => {
  const c = props.system?.system_category
  if (c === 'heating') return 'Ex. : une chaudière gaz → Production. Un radiateur à eau chaude → Émission seul. Un convecteur électrique → Production + Émission.'
  if (c === 'cooling') return 'Ex. : un groupe froid → Production. Un ventilo-convecteur → Émission. Une climatisation à débit de réfrigérant variable (DRV) → unité extérieure Production, unités intérieures Émission.'
  if (c === 'dhw')     return 'Ex. : un ballon d\'eau chaude électrique → Production. Le bouclage avec circulateur → Distribution seul (pas d\'énergie primaire).'
  if (c === 'ventilation') return 'Ex. : une centrale de traitement d\'air (CTA) double flux → Distribution + Émission + Régulation. Un simple extracteur → Production + Émission.'
  if (c === 'lighting_indoor' || c === 'lighting_outdoor') return 'Ex. : un luminaire LED → Production + Émission (la lampe transforme l\'électricité en lumière). Un détecteur de présence → Régulation seul.'
  if (c === 'electricity_production') return 'Ex. : panneaux solaires + onduleur → Production. Batterie → Production (stockage différé).'
  return 'Production = transforme une énergie primaire (gaz, électricité, soleil) en chaleur, froid ou lumière. Émission seule = reçoit un fluide d\'un autre équipement.'
})

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
    // Réponses devenues cachées : effacées, sinon elles compteraient encore (plan d'actions,
    // rapport : « régulation intégrée », types, échelle par pièce…).
    Object.assign(p, {
      regulator_brand: null, regulator_model_reference: null, regulator_location_zone_id: null,
      regulation_integrated: null, regulation_granularity: null,
      regulation_type_production: null, regulation_type_distribution: null, regulation_type_emission: null,
      regulator_location_production: null, regulator_location_distribution: null, regulator_location_emission: null,
    })
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

// Complétude — « validé » = complètement renseigné. Liste ce qu'il reste. Jugée sur l'usage
// d'ORIGINE de l'équipement, même ouvert depuis un usage qui le partage (comme le guide et le
// bandeau de l'étape).
const originCategory = computed(() =>
  (audit.systems || []).find(s => s.id === props.device.system_id)?.system_category || props.system?.system_category)
const missing = computed(() => deviceMissingFields(props.device, originCategory.value))
const forced = computed(() => !!props.device.validation_forced)
const complete = computed(() => isDeviceComplete(props.device, originCategory.value))

// ── Fiche en rubriques (mise en page guidée, maquette « piste D ») ──────────
// Chaque rubrique porte son état (✓, à compléter, à vérifier) ; seules celles où il reste à faire
// s'ouvrent d'emblée, les autres montrent leur résumé. « Toute la fiche » (mémorisé dans le
// navigateur) garde tout déplié, comme la mise en page actuelle.
const missingItems = computed(() => (forced.value ? [] : deviceMissingItems(props.device, originCategory.value)))
// Rubrique d'un point « à vérifier » du pré-contrôle ; DEV-008 (« Intégré à la GTB », réponse de
// l'étape GTB) est rangé dans « Communication et GTB ».
function sectionMissing(key) {
  return missingItems.value.filter(m => m.section === key).map(m => missingShort(m.label))
}
function sectionChecks(key) {
  return props.checks.filter(f => (CHECK_RUBRIC[f.code] || 'communication') === key).map(f => checkText(f.code).short)
}
const RUBRICS_KEY = 'bacs-device-rubrics'
const showAllRubrics = ref((() => { try { return localStorage.getItem(RUBRICS_KEY) === 'all' } catch { return false } })())
function setShowAllRubrics(v) {
  showAllRubrics.value = !!v
  try { localStorage.setItem(RUBRICS_KEY, v ? 'all' : 'todo') } catch { /* navigation privée */ }
}
const openRubrics = ref(new Set())
function defaultOpenRubrics() {
  return new Set(DEVICE_SECTIONS.filter(k => sectionMissing(k).length || sectionChecks(k).length))
}
watch(() => props.device.id, () => { openRubrics.value = defaultOpenRubrics() }, { immediate: true })
function showTodoRubrics() {
  setShowAllRubrics(false)
  openRubrics.value = defaultOpenRubrics()
}
// Ouvre une rubrique et l'amène à l'écran (bouton « Corriger dans … » d'un encadré à vérifier).
function openRubric(key) {
  if (!showAllRubrics.value) openRubrics.value = new Set([...openRubrics.value, key])
  requestAnimationFrame(() => {
    const body = document.getElementById(`dev-${props.device.id}-${key}`)
    const section = body?.closest('section')
    section?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  })
}
defineExpose({ openRubric })
// Cadre d'une rubrique : inchangé dans la mise en page actuelle ; en rubriques, carte dont le
// liseré se renforce quand elle est ouverte.
function sectionCls(key) {
  if (!props.rubrics) return 'rounded-xl border border-gray-200 overflow-hidden'
  return ['rounded-xl overflow-hidden bg-white ring-1 transition', isOpen(key) ? 'ring-indigo-600/30' : 'ring-slate-200']
}
function isOpen(key) {
  return !props.rubrics || showAllRubrics.value || openRubrics.value.has(key)
}
function toggleRubric(key) {
  const next = showAllRubrics.value ? new Set([...DEVICE_SECTIONS, 'share']) : new Set(openRubrics.value)
  if (showAllRubrics.value) setShowAllRubrics(false)
  if (next.has(key)) next.delete(key); else next.add(key)
  openRubrics.value = next
}

// Résumés d'une ligne (rubrique fermée).
const labelOf = (opts, v) => opts.find(o => o.value === v)?.label || v
const fmtKw = (v) => `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kW`
const yesNo = (v, yesText, noText) => (v == null ? null : (v === true || v === 1 ? yesText : noText))
const rubricSummaries = computed(() => {
  const d = props.device
  const join = (parts) => parts.filter(Boolean).join(' · ')
  const roles = deviceRole.value.map(r => labelOf(ROLE_OPTIONS, r))
  let protocols = []
  try { protocols = JSON.parse(d.communication_protocols || '[]').filter(p => p && p !== 'non_communicant') } catch { protocols = [] }
  const power = d.power_kw_unknown ? 'puissance inconnue'
    : [d.power_kw, d.power_kw_cooling].filter(v => Number(v) > 0).map(fmtKw).join(' / ')
  // Type de régulation affiché : celui de l'émission (verdict pièce par pièce), sinon production, sinon distribution.
  const regType = d.regulation_type_emission ? labelOf(regulationEmissionOptions.value, d.regulation_type_emission)
    : d.regulation_type_production ? labelOf(regulationProductionOptions.value, d.regulation_type_production)
      : d.regulation_type_distribution ? labelOf(regulationDistributionOptions.value, d.regulation_type_distribution) : null
  return {
    identification: join([
      [d.brand, d.model_reference].filter(Boolean).join(' ') || d.name,
      (d.quantity || 1) > 1 ? `× ${d.quantity}` : null,
      power, d.age_years != null ? `${d.age_years} ans` : null, d.location,
    ]),
    functions: join([roles.join(', '), d.energy_source ? labelOf(ENERGY_OPTIONS, d.energy_source) : null]),
    regulation: d.has_regulation == null ? ''
      : (d.has_regulation === true || d.has_regulation === 1)
        ? join([yesNo(d.regulation_integrated, 'Intégrée', 'Déportée') || 'Régulée', regType])
        : 'Aucune régulation',
    communication: join([
      isCommunicating.value === false ? 'Non communicant' : protocols.map(p => labelOf(COMM_OPTIONS, p)).join(', '),
      yesNo(d.wired, 'câblé à la GTB', 'non câblé'),
      yesNo(d.meets_r175_3_p4, 'arrêt à la main : oui', 'arrêt à la main : non'),
      yesNo(d.meets_r175_3_p4_autonomous, 'fonctionne seul : oui', 'fonctionne seul : non'),
    ]),
    metering: join([
      yesNo(d.serves_multiple_buildings, 'Dessert plusieurs bâtiments', 'Un seul bâtiment'),
      isShared.value && d.metering_separable ? `comptage séparable : ${labelOf(METERING_OPTS, d.metering_separable).toLowerCase()}` : null,
    ]),
    state: join([yesNo(d.out_of_service, 'Hors service', 'En service'), yesNo(d.is_backup, 'secours', null)]),
    share: join([
      usageLabel((audit.systems || []).find(s => s.id === d.system_id) || props.system),
      extraSystemIds.value.length ? plural(extraSystemIds.value.length, 'autre usage', 'autres usages') : null,
    ]),
  }
})

// ── Partage / déplacement entre usages (parité PWA mig 143) ──────────
// Aligne le desktop sur la PWA : permet à l'auditeur de déplacer un
// équipement vers un autre usage et de le marquer comme partagé entre
// plusieurs usages (chaudière qui sert à la fois chauffage + ECS, etc.)
function usageLabel(s) { return systemUsageLabel(s) }
const savingShare = ref(false)
// Mapping icônes/couleurs par catégorie d'usage (aligné SystemCategoryIcon).
const SYSTEM_CATEGORY_DECOR = {
  heating:                { icon: 'fa-fire',        color: '#dc2626' },
  cooling:                { icon: 'fa-snowflake',   color: '#0891b2' },
  ventilation:            { icon: 'fa-fan',         color: '#64748b' },
  dhw:                    { icon: 'fa-faucet',      color: '#0284c7' },
  lighting_indoor:        { icon: 'fa-lightbulb',   color: '#f59e0b' },
  lighting_outdoor:       { icon: 'fa-tower-cell',  color: '#f59e0b' },
  electricity_production: { icon: 'fa-solar-panel', color: '#16a34a' },
}
function decorateSystemOption(s) {
  const decor = SYSTEM_CATEGORY_DECOR[s.system_category] || { icon: 'fa-cube', color: '#6b7280' }
  const usage = usageLabel(s)
  const zone = s.zone_name || 'Zone non précisée'
  return {
    value: s.id,
    label: usage,                            // libellé court (popover groupé : la zone est déjà en sous-titre)
    chipLabel: `${zone} · ${usage}`,         // libellé complet pour le trigger / la pilule sélectionnée
    hint: zone,
    icon: decor.icon,
    color: decor.color,
    _zone: zone,
    _zoneOrder: (s.zone_position ?? 999),
  }
}
function sortByZoneThenUsage(a, b) {
  if (a._zoneOrder !== b._zoneOrder) return a._zoneOrder - b._zoneOrder
  if (a._zone !== b._zone) return a._zone.localeCompare(b._zone, 'fr')
  return a.label.localeCompare(b.label, 'fr')
}
const moveSystemOptions = computed(() =>
  (audit.systems || []).map(decorateSystemOption).sort(sortByZoneThenUsage))
const shareSystemOptions = computed(() =>
  (audit.systems || [])
    .filter(s => s.id !== props.device.system_id)
    .map(decorateSystemOption)
    .sort(sortByZoneThenUsage))
const extraSystemIds = computed(() =>
  Array.isArray(props.device.extra_system_ids) ? props.device.extra_system_ids : [])
async function updateExtraSystemIds(nextIds) {
  if (savingShare.value) return
  savingShare.value = true
  try {
    const { data } = await shareBacsDevice(props.device.id, nextIds || [])
    Object.assign(props.device, data)
    await audit.refreshAuditCore()
    emit('changed')
  } catch (e) {
    error(e.response?.data?.detail || 'Partage impossible')
  } finally {
    savingShare.value = false
  }
}
function shareCandidateSystems() {
  return (audit.systems || []).filter(s => s.id !== props.device.system_id)
}
async function moveDeviceToSystem(systemId) {
  if (savingShare.value || systemId === props.device.system_id) return
  savingShare.value = true
  try {
    const { data } = await moveBacsDevice(props.device.id, systemId)
    Object.assign(props.device, data)
    await audit.refreshAuditCore()
    emit('changed')
  } catch (e) {
    error(e.response?.data?.detail || 'Déplacement impossible')
  } finally {
    savingShare.value = false
  }
}
async function toggleShareDeviceSystem(systemId, checked) {
  if (savingShare.value) return
  savingShare.value = true
  const next = new Set(props.device.extra_system_ids || [])
  if (checked) next.add(systemId); else next.delete(systemId)
  try {
    const { data } = await shareBacsDevice(props.device.id, [...next])
    Object.assign(props.device, data)
    await audit.refreshAuditCore()
    emit('changed')
  } catch (e) {
    error(e.response?.data?.detail || 'Partage impossible')
  } finally {
    savingShare.value = false
  }
}

const inputCls = 'h-9 px-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition'
const headCls = 'px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-700 uppercase tracking-wider'
</script>

<template>
  <component
    :is="shell"
    :title="`Modifier l'équipement — ${systemLabel}${zoneName ? ' / ' + zoneName : ''}`"
    size="2xl"
    :dismiss-on-backdrop="false"
    @close="emit('close')"
  >
    <div class="space-y-3 pb-2">
      <!-- Fiche en rubriques : le reste à faire d'abord, ou toute la fiche (choix mémorisé). -->
      <div v-if="rubrics" class="flex items-center justify-end gap-2">
        <span class="text-[11px] text-gray-500">Afficher</span>
        <div class="inline-flex rounded-md overflow-hidden border border-gray-200" role="group" aria-label="Rubriques affichées">
          <button type="button" :aria-pressed="!showAllRubrics" v-tooltip="RUBRICS_ALL_TIPS.todo" @click="showTodoRubrics"
                  :class="['px-2.5 py-1 text-xs whitespace-nowrap transition',
                           !showAllRubrics ? 'bg-primary text-white font-medium' : 'bg-white text-gray-600 hover:bg-gray-50']">
            Le reste à faire
          </button>
          <button type="button" :aria-pressed="showAllRubrics" v-tooltip="RUBRICS_ALL_TIPS.all" @click="setShowAllRubrics(true)"
                  :class="['px-2.5 py-1 text-xs whitespace-nowrap transition',
                           showAllRubrics ? 'bg-primary text-white font-medium' : 'bg-white text-gray-600 hover:bg-gray-50']">
            Toute la fiche
          </button>
        </div>
      </div>
      <!-- Identification de l'équipement — grille 2-cols unique, plus de
           split en 2 sections (causait des row mismatches inévitables dès
           que les sections n'avaient pas le même nombre de champs).
           Chaque ligne pose 2 inputs côte à côte de même hauteur — pas de
           cellule vide, pas de section secondaire qui se termine plus tôt. -->
      <section :class="sectionCls('identification')">
        <DeviceSectionHeader title="Identification" :head-class="headCls" :rubrics="rubrics" :open="isOpen('identification')" icon="id-card"
                             :missing="sectionMissing('identification')" :checks="sectionChecks('identification')"
                             :summary="rubricSummaries.identification" :body-id="`dev-${device.id}-identification`" @toggle="toggleRubric('identification')" />
        <div class="p-3 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-3" v-show="isOpen('identification')" :id="`dev-${device.id}-identification`">
          <div class="sm:col-span-2">
            <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Nom</label>
            <input type="text" :value="device.name || ''" placeholder="ex : Chaudière gaz principale"
                   @blur="e => patchInput('name', e.target.value)" :class="inputCls" class="w-full" />
          </div>
          <div>
            <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Marque</label>
            <input type="text" :value="device.brand || ''" placeholder="ex : Atlantic"
                   @blur="e => patchInput('brand', e.target.value)" :class="inputCls" class="w-full" />
          </div>
          <div>
            <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Référence</label>
            <input type="text" :value="device.model_reference || ''" placeholder="ex : Varmax 70"
                   @blur="e => patchInput('model_reference', e.target.value)" :class="inputCls" class="w-full" />
          </div>
          <div class="sm:col-span-2">
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
            <!-- Doctrine 0.1.135 — la puissance R175-2 est portée par les
                 producteurs (UE DRV, chiller, chaudière, sous-station). Pour
                 un émetteur passif (UI DRV, FCU, radiateur eau chaude), saisir
                 une puissance ici ferait du double comptage avec le producteur
                 amont. Champ désactivé + encart explicatif. -->
            <div v-if="!showEnergyField" class="sm:col-span-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600 leading-snug">
              <strong class="text-gray-700">Puissance non saisissable</strong> — cet équipement diffuse dans la pièce la chaleur ou le froid produits par un autre équipement (unité extérieure de climatisation, groupe d'eau glacée, chaudière, sous-station). Cette puissance est déjà comptée sur l'équipement de production : la saisir ici la compterait deux fois. Pour activer ces champs, ajoute la fonction <strong>Production</strong> à l'équipement.
            </div>
            <template v-else>
              <div v-if="showHeatPower">
                <label class="block text-[11px] font-medium text-gray-600 mb-0.5">
                  {{ heatPowerLabel }}
                  <span v-if="!isThermalForR175" class="text-gray-400 font-normal" v-tooltip="POWER_INFO_ONLY_TIP">— pour information, hors cumul</span>
                </label>
                <input type="number" min="0" step="0.1"
                       :value="device.power_kw_unknown ? '' : (device.power_kw ?? '')"
                       :placeholder="device.power_kw_unknown ? 'Inconnue (déclarée)' : '—'"
                       :disabled="!!device.power_kw_unknown"
                       @blur="e => patch({ power_kw: e.target.value === '' ? null : parseFloat(e.target.value) })"
                       :class="[inputCls, device.power_kw_unknown ? 'bg-gray-50 italic placeholder:text-gray-500' : '']"
                       class="w-full" />
              </div>
              <div v-if="showCoolPower" :class="{ 'sm:col-span-2': !showHeatPower }">
                <label class="block text-[11px] font-medium text-gray-600 mb-0.5">
                  Puissance froid (kW)
                  <span v-if="!isThermalForR175" class="text-gray-400 font-normal" v-tooltip="POWER_INFO_ONLY_TIP">— pour information, hors cumul</span>
                </label>
                <input type="number" min="0" step="0.1"
                       :value="device.power_kw_unknown ? '' : (device[coolPowerField] ?? '')"
                       :placeholder="device.power_kw_unknown ? 'Inconnue (déclarée)' : '—'"
                       :disabled="!!device.power_kw_unknown"
                       @blur="e => patch({ [coolPowerField]: e.target.value === '' ? null : parseFloat(e.target.value) })"
                       :class="[inputCls, device.power_kw_unknown ? 'bg-gray-50 italic placeholder:text-gray-500' : '']"
                       class="w-full" />
              </div>
              <!-- Toggle « Puissance inconnue » (mig 197) — sur toutes catégories. -->
              <div class="sm:col-span-2">
                <label class="inline-flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
                  <input type="checkbox" :checked="!!device.power_kw_unknown"
                         @change="e => patch({ power_kw_unknown: e.target.checked, ...(e.target.checked ? { power_kw: null, power_kw_cooling: null } : {}) })"
                         class="w-4 h-4 accent-amber-500" />
                  <span><strong>Puissance déclarée inconnue</strong> — aucune indication disponible sur le terrain (luminaire sans plaque, vieux radiateur électrique…). Permet de valider l'étape Systèmes sans saisir de valeur.</span>
                </label>
              </div>
              <div v-if="isThermalForR175" class="sm:col-span-2">
                <label class="flex items-center gap-1 text-[11px] font-medium text-gray-600 mb-0.5">
                  Type de calcul de puissance
                  <HelpTip size="xs" :tip="POWER_CALC_TIP" />
                </label>
                <SearchableSelect :model-value="device.power_calculation_type" :options="POWER_CALC_OPTIONS"
                                  :clearable="true" size="sm" placeholder="Calcul automatique"
                                  @update:model-value="v => patch({ power_calculation_type: v || null })" />
              </div>
            </template>
          </template>
        </div>
      </section>

      <!-- Fonction(s) de l'équipement & énergie primaire — section clé pour
           la cohérence métier. L'énergie n'apparaît QUE si la fonction
           contient Production (doctrine mig 194 : un radiateur à eau chaude
           n'a pas d'énergie primaire propre, c'est l'équipement amont qui la
           porte).
           Masquée entièrement pour la production PV : la chaîne CVC amont/aval
           ne s'applique pas (l'équipement EST la production, il n'y a pas de
           distribution/émission BACS en aval) et l'énergie primaire consommée
           n'a pas de sens (le PV produit, ne consomme pas). -->
      <section v-if="!isPvProduction" :class="sectionCls('functions')">
        <DeviceSectionHeader title="Fonctions de l'équipement" :head-class="headCls" :rubrics="rubrics" :open="isOpen('functions')" icon="sitemap"
                             :missing="sectionMissing('functions')" :checks="sectionChecks('functions')"
                             :summary="rubricSummaries.functions" :body-id="`dev-${device.id}-functions`" @toggle="toggleRubric('functions')" />
        <div class="p-3 space-y-3" v-show="isOpen('functions')" :id="`dev-${device.id}-functions`">
          <SearchableSelect :model-value="deviceRole" :options="ROLE_OPTIONS"
                            :multiple="true" :clearable="true" :creatable="true" size="sm"
                            placeholder="Production / Distribution / Émission / Régulation…"
                            @update:model-value="v => patch({ device_role: Array.isArray(v) ? v : [] })" />
          <!-- Aide pédagogique : cartes synthétiques des 4 fonctions, exemple
               contextualisé selon la catégorie d'usage. -->
          <div class="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-900 space-y-2">
            <div class="font-semibold flex items-center gap-1.5">
              <span class="text-base">💡</span>
              <span>Comment choisir les fonctions ?</span>
            </div>
            <ul class="space-y-1 pl-1">
              <li><strong class="text-rose-700">Production</strong> — l'équipement transforme une énergie primaire (gaz, électricité, soleil, bois…) en chaleur, froid ou lumière sur place. <em>Une énergie primaire devra être renseignée.</em></li>
              <li><strong class="text-sky-700">Distribution</strong> — l'équipement transporte un fluide (eau chaude, eau glacée, air, électricité) de la production vers l'émetteur. Ex. : circuit d'eau chaude, gaines de soufflage, bouclage d'eau chaude sanitaire.</li>
              <li><strong class="text-blue-700">Émission</strong> — l'équipement restitue dans la pièce la chaleur ou le froid produits par un autre équipement. Ex. : radiateur à eau chaude, ventilo-convecteur, unité intérieure de climatisation, bouches d'air. <em>La puissance et l'énergie sont portées par l'équipement de production, pas par l'émetteur.</em></li>
              <li><strong class="text-purple-700">Régulation</strong> — l'équipement pilote (thermostat, détecteur, sonde, régulateur de chaufferie).</li>
            </ul>
            <div class="pt-1 border-t border-blue-200/60 text-blue-800/90 italic">{{ roleHelpExample }}</div>
          </div>
          <!-- Énergie primaire — visible UNIQUEMENT si le rôle inclut Production.
               Pour un émetteur ou distributeur passif (radiateur à eau, FCU,
               unité intérieure DRV), l'énergie est portée par l'équipement
               amont qui produit la chaleur/le froid, pas par celui-ci. -->
          <div v-if="showEnergyField" class="pt-1">
            <label class="block text-[11px] font-medium text-gray-600 mb-1">
              Énergie primaire consommée
              <span class="text-gray-400 font-normal">— ce que l'équipement transforme en chaleur, froid, lumière ou électricité</span>
            </label>
            <SearchableSelect :model-value="device.energy_source" :options="ENERGY_OPTIONS"
                              :clearable="true" size="sm" placeholder="Sélectionne l'énergie primaire…"
                              @update:model-value="v => patch({ energy_source: v || null })" />
          </div>
          <div v-else class="pt-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600 leading-snug">
            <strong class="text-gray-700">Énergie non saisissable ici</strong> — cet équipement diffuse dans la pièce une chaleur ou un froid déjà comptés sur l'équipement de production (unité extérieure de climatisation, groupe d'eau glacée, chaudière, sous-station…) : les saisir ici les compterait deux fois. L'énergie primaire et la puissance se renseignent sur l'équipement de production, pas sur les émetteurs, distributeurs ou régulateurs.<br/><br/>
            <em>Si cet équipement transforme directement une énergie primaire en chaleur, froid ou lumière sur place</em> (convecteur électrique, aérotherme gaz autonome, ventilation mécanique qui consomme de l'électricité pour son moteur, luminaire LED…), ajoute la fonction <strong>Production</strong> ci-dessus : les champs Énergie et Puissance deviendront actifs.
          </div>
        </div>
      </section>

      <!-- Régulation (équipement) -->
      <section :class="sectionCls('regulation')">
        <DeviceSectionHeader title="Régulation" :head-class="headCls" :rubrics="rubrics" :open="isOpen('regulation')" icon="sliders"
                             :missing="sectionMissing('regulation')" :checks="sectionChecks('regulation')"
                             :summary="rubricSummaries.regulation" :body-id="`dev-${device.id}-regulation`" @toggle="toggleRubric('regulation')" />
        <div class="p-3 space-y-3" v-show="isOpen('regulation')" :id="`dev-${device.id}-regulation`">
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm">
              <div class="font-medium text-gray-800">L'équipement dispose-t-il d'une régulation ?</div>
              <div class="text-xs text-gray-500 mt-0.5">
                Régulation intégrée (thermostat embarqué) ou déportée (régulateur séparé). Si Oui, la fonction « Régulation » est ajoutée automatiquement.
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
                  Intégrée = thermostat embarqué, régulation d'origine de la pompe à chaleur, électronique de la chaudière. Déportée = régulateur séparé (Siemens, GTB, sonde déportée…). Si intégrée, marque, référence et localisation sont celles de l'équipement.
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
                <label class="flex items-center gap-1 text-[11px] font-medium text-gray-600 mb-0.5">
                  Échelle de la régulation
                  <span class="text-gray-400 font-normal">— pièce, zone ou centralisée</span>
                  <HelpTip size="xs" :tip="GRANULARITY_TIP" />
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

      <!-- Communication et lien avec la GTB (R175-3) -->
      <section :class="sectionCls('communication')">
        <DeviceSectionHeader title="Communication et lien avec la GTB" :head-class="headCls" :rubrics="rubrics" :open="isOpen('communication')" icon="network-wired"
                             :missing="sectionMissing('communication')" :checks="sectionChecks('communication')"
                             :summary="rubricSummaries.communication" :body-id="`dev-${device.id}-communication`" @toggle="toggleRubric('communication')" />
        <div class="p-3" v-show="isOpen('communication')" :id="`dev-${device.id}-communication`">
          <div class="grid grid-cols-1 sm:grid-cols-12 gap-3 items-stretch">
            <div class="sm:col-span-4 flex flex-col">
              <label class="block text-[11px] font-medium text-gray-600 mb-0.5">L'équipement est-il communicant ?</label>
              <div class="flex-1 flex items-center">
                <SegmentedToggle :model-value="isCommunicating" :options="YESNO"
                                 @update:model-value="setCommunicating" />
              </div>
            </div>
            <!-- Grisé tant que « communicant » n'est pas Oui : la bulle (portée par le bloc,
                 le contenu ne reçoit plus le pointeur) dit pourquoi et quoi faire. -->
            <div class="sm:col-span-8"
                 :class="{ 'opacity-50': isCommunicating !== true }"
                 v-tooltip="deviceProtocolsLockedTip(isCommunicating)">
              <div class="h-full flex flex-col" :class="{ 'pointer-events-none': isCommunicating !== true }">
                <label class="block text-[11px] font-medium text-gray-600 mb-0.5">
                  Protocoles de communication
                  <span v-if="isCommunicating === true && !hasAnyProtocol" class="text-rose-600 font-semibold">·  obligatoire</span>
                </label>
                <ProtocolMultiPicker
                  :model-value="device.communication_protocols || (device.communication_protocol && device.communication_protocol !== 'non_communicant' ? JSON.stringify([device.communication_protocol]) : null)"
                  :options="COMM_OPTIONS" placeholder="Sélectionner un ou plusieurs protocoles…" size="md"
                  :exclude-non-communicant="true"
                  @update:modelValue="v => patch({ communication_protocols: v, communication_protocol: v ? null : device.communication_protocol })" />
              </div>
            </div>
          </div>
          <p class="text-xs text-gray-500 leading-snug mt-1">
            Réponds d'abord <strong>Oui</strong> ou <strong>Non</strong> à la question. Si Oui,
            sélectionne au moins un protocole : un équipement qui ne communique avec aucun protocole
            ne peut être ni piloté ni suivi à distance.
          </p>
        </div>
        <div class="border-t border-gray-100 px-3 py-3 space-y-3" v-show="isOpen('communication')">
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm flex-1">
              <div class="font-medium text-gray-800">
                Faut-il raccorder cet équipement à la GTB ?
              </div>
              <div class="text-xs text-gray-500 mt-0.5">« Oui » dans le cas normal : le décret demande de raccorder les équipements des systèmes reliés, et le rapport évalue son raccordement. Réponds « Non » seulement s'il n'a pas à être raccordé lui-même (émetteur passif, unité extérieure pilotée par des unités intérieures raccordées…) : il n'est alors pas évalué.</div>
            </div>
            <div class="inline-flex rounded-md overflow-hidden border border-gray-200 shrink-0">
              <button v-for="opt in SCOPE_OPTIONS" :key="String(opt.value)" type="button"
                      @click="patch({ gtb_scope_override: opt.value })"
                      :class="['px-2.5 py-1 text-xs whitespace-nowrap transition',
                               gtbScopeSel === opt.value ? 'bg-indigo-600 text-white font-medium' : 'bg-white text-gray-600 hover:bg-gray-50']"
                      v-tooltip="opt.tip">
                {{ opt.label }}
              </button>
            </div>
          </div>
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm flex-1">
              <div class="font-medium text-gray-800 inline-flex items-center gap-1">
                L'équipement est-il relié à la GTB par une liaison câblée ?
                <R175Tooltip article="R175-3 3°" />
              </div>
              <div class="text-xs text-gray-500 mt-0.5">Un câble dédié relie l'équipement à la GTB : c'est la base pour qu'ils dialoguent, comme l'exige le décret.</div>
            </div>
            <SegmentedToggle :model-value="triState(device.wired)" :options="YESNO"
                             @update:model-value="v => patch({ wired: v })" />
          </div>
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm flex-1">
              <div class="font-medium text-gray-800 inline-flex items-center gap-1">
                La GTB permet-elle d'arrêter l'équipement manuellement ?
                <R175Tooltip article="R175-3 4°" />
              </div>
              <div class="text-xs text-gray-500 mt-0.5">Depuis la GTB, on peut arrêter puis remettre en marche l'équipement, ou le passer en hors gel (par exemple pendant une période d'inoccupation).</div>
            </div>
            <SegmentedToggle :model-value="triState(device.meets_r175_3_p4)" :options="YESNO"
                             @update:model-value="v => patch({ meets_r175_3_p4: v })" />
          </div>
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm flex-1">
              <div class="font-medium text-gray-800 inline-flex items-center gap-1">
                L'équipement fonctionne-t-il seul si la GTB est arrêtée ?
                <R175Tooltip article="R175-3 4°" />
              </div>
              <div class="text-xs text-gray-500 mt-0.5">Si la GTB est arrêtée ou la communication coupée, l'équipement continue de fonctionner avec sa régulation locale, et repart seul après une coupure.</div>
            </div>
            <SegmentedToggle :model-value="triState(device.meets_r175_3_p4_autonomous)" :options="YESNO"
                             @update:model-value="v => patch({ meets_r175_3_p4_autonomous: v })" />
          </div>
        </div>
      </section>

      <!-- Suivi énergétique BACS — comptage séparable + équipement centralisé multi-bâtiments -->
      <section :class="sectionCls('metering')">
        <DeviceSectionHeader title="Suivi des consommations" :head-class="headCls" :rubrics="rubrics" :open="isOpen('metering')" icon="gauge-high"
                             :missing="sectionMissing('metering')" :checks="sectionChecks('metering')"
                             :summary="rubricSummaries.metering" :body-id="`dev-${device.id}-metering`" @toggle="toggleRubric('metering')" />
        <div class="p-3 space-y-3" v-show="isOpen('metering')" :id="`dev-${device.id}-metering`">
          <!-- Comptage séparable : visible uniquement pour les équipements
               partagés entre plusieurs systèmes/zones.
               Masqué pour la production PV : le décret impose un comptage
               global unique de la production sur site (R175-3 §1), pas de
               fractionnement par zone. -->
          <div v-if="isShared && !isPvProduction" class="flex items-center justify-between gap-3">
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
              <div class="text-xs text-gray-500 mt-0.5">Chaudière commune, groupe de production de chaleur, sous-station : un équipement central qui sert plusieurs bâtiments du site. Tous les propriétaires du site sont alors responsables ensemble de sa mise en conformité.</div>
            </div>
            <SegmentedToggle :model-value="triState(device.serves_multiple_buildings)" :options="YESNO"
                             @update:model-value="v => patch({ serves_multiple_buildings: v })" />
          </div>
          <input v-if="isShared && !isPvProduction" type="text" :value="device.metering_separable_note || ''"
                 placeholder="Justification courte sur la séparabilité du comptage…"
                 @blur="e => patchInput('metering_separable_note', e.target.value)"
                 :class="inputCls" class="w-full" />
        </div>
      </section>

      <!-- État de l'équipement -->
      <section :class="sectionCls('state')">
        <DeviceSectionHeader title="État de l'équipement" :head-class="headCls" :rubrics="rubrics" :open="isOpen('state')" icon="power-off"
                             :missing="sectionMissing('state')" :checks="sectionChecks('state')"
                             :summary="rubricSummaries.state" :body-id="`dev-${device.id}-state`" @toggle="toggleRubric('state')" />
        <div class="p-3 space-y-3" v-show="isOpen('state')" :id="`dev-${device.id}-state`">
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm flex-1">
              <div class="font-medium text-gray-800 inline-flex items-center gap-1">
                Est-ce un équipement de secours ?
                <HelpTip size="xs" :tip="DEVICE_BACKUP_TIP" />
              </div>
              <div class="text-xs text-gray-500 mt-0.5">Équipement normalement à l'arrêt, qui ne démarre qu'en cas de panne de l'équipement principal. Un générateur appelé en cascade ou en renfort lors des pointes <strong>n'est pas</strong> un secours : sa puissance compte. Seule la puissance d'un vrai secours est <strong>retirée du cumul</strong> qui dit si le bâtiment est concerné (seuils de 70 et 290 kW).</div>
            </div>
            <SegmentedToggle :model-value="triState(device.is_backup)" :options="YESNO"
                             @update:model-value="v => patch({ is_backup: v })" />
          </div>
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm flex-1">
              <div class="font-medium text-gray-800 inline-flex items-center gap-1">
                L'équipement est-il hors service ?
                <HelpTip size="xs" :tip="DEVICE_OUT_OF_SERVICE_TIP" />
              </div>
              <div class="text-xs text-gray-500 mt-0.5">Équipement hors d'usage : il n'est pas pris en compte dans le plan de mise en conformité.</div>
            </div>
            <SegmentedToggle :model-value="triState(device.out_of_service)" :options="YESNO"
                             @update:model-value="v => patch({ out_of_service: v })" />
          </div>
        </div>
      </section>

      <!-- Partage / déplacement entre usages (parité PWA mig 143).
           Permet de déplacer un équipement vers un autre usage du site
           et de marquer une multi-présence (chaudière qui sert à la fois
           chauffage et ECS, etc.). -->
      <section v-if="device.id"
               :class="rubrics ? sectionCls('share') : 'space-y-3 pt-4 mt-2 border-t border-gray-100'">
        <h3 v-if="!rubrics" class="text-sm font-semibold text-gray-800">Partage entre usages</h3>
        <DeviceSectionHeader v-else title="Partage entre usages" rubrics icon="share-nodes" :open="isOpen('share')"
                             :summary="rubricSummaries.share" :body-id="`dev-${device.id}-share`" @toggle="toggleRubric('share')" />
        <div v-show="isOpen('share')" :id="`dev-${device.id}-share`"
             :class="['grid grid-cols-1 md:grid-cols-2 gap-3', rubrics ? 'p-3' : '']">
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">Usage principal</label>
            <SearchableSelect
              :model-value="device.system_id"
              :options="moveSystemOptions"
              :group-by-hint="true"
              placeholder="— Usage —"
              :disabled="savingShare"
              @update:model-value="moveDeviceToSystem"
            />
            <p class="text-[11px] text-gray-500 mt-1">Déplace l'équipement vers un autre usage. Options groupées par zone, icône colorée par catégorie.</p>
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">Aussi présent dans</label>
            <SearchableSelect
              v-if="shareSystemOptions.length"
              :model-value="extraSystemIds"
              :options="shareSystemOptions"
              :multiple="true"
              :clearable="true"
              :group-by-hint="true"
              placeholder="— Aucun partage —"
              :disabled="savingShare"
              @update:model-value="updateExtraSystemIds"
            />
            <p v-else class="text-xs text-gray-500 italic">Aucun autre usage disponible.</p>
            <p class="text-[11px] text-gray-500 mt-1">Options regroupées par zone et décorées par catégorie d'usage (icône colorée).</p>
          </div>
        </div>
      </section>

    </div>

    <template #footer>
      <div class="flex items-center justify-between gap-3 flex-wrap w-full">
        <div class="flex items-center gap-3 flex-wrap">
          <!-- Indicateur de complétude :
               · complet + non forcé → badge vert (rien d'autre)
               · forcé + incomplet → badge "Validation forcée" + toggle pour défaire
               · non forcé + incomplet → badge "Incomplet" + toggle pour forcer
               · complet + forcé → badge vert (le forçage n'a plus lieu d'être,
                 on retire le toggle silencieusement) -->
          <span v-if="complete"
                class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium"
                v-tooltip="forced && missing.length ? deviceStatusTip(missing, { forced: true }) : DEVICE_COMPLETE_TIP">
            ✓ Équipement complet
          </span>
          <template v-else>
            <span v-if="forced"
                  class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-xs font-medium"
                  v-tooltip="deviceStatusTip(missing, { forced: true })">
              ⚠ Validation forcée
            </span>
            <span v-else
                  class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-xs font-medium"
                  v-tooltip="deviceStatusTip(missing)">
              ⚠ Incomplet
              <span class="text-amber-700/80 font-normal">— {{ missing.length }} champ{{ missing.length > 1 ? 's' : '' }}</span>
            </span>
            <label class="inline-flex items-center gap-2 text-xs text-gray-600 cursor-pointer"
                   v-tooltip="FORCE_VALIDATION_TIP">
              <input type="checkbox" :checked="!!device.validation_forced"
                     @change="e => patch({ validation_forced: e.target.checked })"
                     class="w-4 h-4 accent-amber-500" />
              Forcer la validation
            </label>
          </template>
        </div>
        <!-- Mise en page guidée : « Suivant à reprendre » à la place de « Fermer » (la croix
             de l'en-tête de la fiche ferme toujours). -->
        <slot name="footer-action">
          <button type="button" @click="emit('close')"
                  class="h-9 px-4 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition">
            Fermer
          </button>
        </slot>
      </div>
    </template>
  </component>
</template>
