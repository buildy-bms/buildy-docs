<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount, reactive } from 'vue'
import Sortable from 'sortablejs'
import { FireIcon, PencilSquareIcon, InformationCircleIcon, Bars3Icon, TrashIcon, SparklesIcon, ChevronDownIcon, ChevronRightIcon } from '@heroicons/vue/24/outline'
import {
  REGULATION_TYPES_PRODUCTION, REGULATION_TYPES_DISTRIBUTION, REGULATION_TYPES_EMISSION,
  derivedGranularity, resolveGranularity, GRANULARITY_LABELS_FR, GRANULARITY_TONES,
  GRANULARITY_OPTIONS,
} from '@/lib/audit-options'
import { buildPrefillPatch, regulationTypeLabel } from '@/lib/thermal-prefill'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import Tooltip from '@/components/Tooltip.vue'
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import SearchableSelect from '@/components/SearchableSelect.vue'
import ThermalLevelCell from '@/components/audit/ThermalLevelCell.vue'
import DataTableSortHeader from '@/components/DataTableSortHeader.vue'
import { useTableSort } from '@/composables/useTableSort'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { updateBacsThermal, reorderBacsThermal, updateBacsDevice } from '@/api'
import { filterAndSortByRole } from '@/composables/useDeviceRoleFilter'

// Niveaux R175-6 (Production / Distribution / Émission). Chaque niveau
// porte 4 saisies dans la table : équipement, équipement de régulation,
// (Production seul : type + âge), notes par niveau.
const LEVELS = [
  { key: 'production',   label: 'Production',   icon: '🔧' },
  { key: 'distribution', label: 'Distribution', icon: '🚰' },
  { key: 'emission',     label: 'Émission',     icon: '♨️' },
]
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
const LEVEL_NOTES_FIELD = {
  production:   'production_notes_html',
  distribution: 'distribution_notes_html',
  emission:     'emission_notes_html',
}

// Section 5 — Régulation thermique automatique (R175-6).
// 1 ligne par couple (zone, catégorie heating/cooling) avec un détail
// déplié (sonde / thermostat / robinets) si la régulation est active.
// Chaque couple a son propre <tbody> pour permettre un drag & drop
// (ligne principale + ligne détail réordonnées ensemble).
const props = defineProps({
  thermalFiltered: { type: Array, required: true },
  // Mig 180 : regulationOptions retiré (la granularité est dérivée).
  regulationOptions: { type: Array, required: false, default: () => [] },
  generatorOptions: { type: Array, required: true },
  generatorDevicesForZoneCategory: { type: Function, required: true },
  step: { type: Object, default: null },
  active: { type: Boolean, default: false },
})
const emit = defineEmits(['validate-step', 'invalidate-step', 'open-notes'])

function hasNotes(html) {
  if (!html) return false
  return html.replace(/<[^>]*>/g, '').trim().length > 0
}

const audit = useAuditStore()
const { error } = useNotification()

// Tri data-table : Zone, Usage, Type de régul.
const { sortKey, sortDir, toggleSort, sortedRows } = useTableSort()
function sortThermalValue(t, key) {
  if (key === 'zone') return (t.zone_name || '').toLowerCase()
  if (key === 'usage') return (t.category || 'heating')
  if (key === 'system') return (t.system_label || '').toLowerCase()
  return ''
}
const sortedThermal = computed(() => sortedRows(props.thermalFiltered, sortThermalValue))

// Mig 187 — regroupement par zone pour économiser de la largeur (suppression
// des colonnes Zone, Usage, Système redondantes sur des audits chargés). On
// produit une liste de groupes { zoneName, rows } préservant l'ordre stable
// de sortedThermal. Le DnD reste fonctionnel : chaque tbody.thermal-row a
// son data-id et Sortable n'a pas besoin de la notion de groupe (le réordo
// se fait à plat).
// Mig 187 v3 — état repli/dépli par zone. Map nomZone → boolean (true =
// replié). Par défaut tout déplié. Toggle individuel via clic header + 2
// boutons globaux « Tout replier » / « Tout déplier » au-dessus de la liste.
const collapsedZones = reactive({})
function toggleZone(name) { collapsedZones[name] = !collapsedZones[name] }
function collapseAll() {
  for (const g of thermalGroups.value) collapsedZones[g.zoneName] = true
}
function expandAll() {
  for (const g of thermalGroups.value) collapsedZones[g.zoneName] = false
}
const allCollapsed = computed(() => thermalGroups.value.length > 0 &&
  thermalGroups.value.every(g => collapsedZones[g.zoneName]))

const thermalGroups = computed(() => {
  const groups = []
  const byName = new Map()
  for (const t of sortedThermal.value) {
    const key = t.zone_name || 'Sans zone'
    if (!byName.has(key)) {
      const g = { zoneName: key, rows: [] }
      byName.set(key, g)
      groups.push(g)
    }
    byName.get(key).rows.push(t)
  }
  return groups
})

async function patchThermal(t, patch) {
  Object.assign(t, patch)
  try {
    await updateBacsThermal(t.id, patch)
    await audit.refreshActionItems()
  } catch { error('Sauvegarde impossible') }
}

// ── Pré-remplissage depuis les équipements (R175-6) ──
// Pour chaque (zone × catégorie), on relit les devices du système et on
// remplit les champs encore vides (générateur, distribution, émission,
// régulateur) avec le meilleur candidat. L'auditeur garde la main pour
// surcharger via le SearchableSelect.
const REGULATION_CATALOGS = {
  production:   REGULATION_TYPES_PRODUCTION,
  distribution: REGULATION_TYPES_DISTRIBUTION,
  emission:     REGULATION_TYPES_EMISSION,
}
const prefillCount = computed(() =>
  (props.thermalFiltered || [])
    .map(t => buildPrefillPatch(t, props.generatorDevicesForZoneCategory))
    .filter(Boolean)
    .reduce((acc, patch) => acc + Object.keys(patch).length, 0)
)
const prefillBusy = ref(false)
async function prefillAllFromDevices() {
  if (prefillBusy.value) return
  prefillBusy.value = true
  try {
    for (const t of (props.thermalFiltered || [])) {
      const patch = buildPrefillPatch(t, props.generatorDevicesForZoneCategory)
      if (patch) await patchThermal(t, patch)
    }
  } finally {
    prefillBusy.value = false
  }
}

// Trouve le device référencé par la ligne thermique pour un niveau donné
// (production/distribution/emission). Sert à afficher le type de régulation
// pré-rempli depuis l'équipement, en lecture seule.
function deviceForLevel(t, level) {
  const field = LEVEL_DEVICE_FIELD[level]
  const id = t[field]
  if (!id) return null
  const devs = props.generatorDevicesForZoneCategory(t.zone_id, t.category || 'heating') || []
  return devs.find(d => d.id === id) || null
}
function levelRegulationTypeLabel(t, level) {
  const d = deviceForLevel(t, level)
  if (!d) return null
  const val = d[`regulation_type_${level}`]
  return regulationTypeLabel(val, level, REGULATION_CATALOGS)
}

// Granularité R175-6 dérivée du type de régulation d'émission du device
// émetteur de la ligne. Mig 180 : on ne saisit plus la granularité côté
// card 06 — elle découle automatiquement de ce qui est renseigné sur
// l'équipement (modale équipement → section Régulation → type d'émission).
function systemDisplayName(t) {
  if (t.system_label && t.system_label.trim()) return t.system_label.trim()
  const prod = deviceForLevel(t, 'production')
  if (prod) return prod.name || prod.brand || prod.model_reference || `Équipement #${prod.id}`
  return defaultLabel(t)
}
// Mig 187 — granularité désormais SAISIE explicitement sur le device
// émetteur (`regulation_granularity`). Fallback sur la dérivée pour les
// rows historiques sans valeur explicite. Le label/tone n'est connu que
// pour les 3 valeurs canoniques (per_room / per_zone / central_only) ;
// pour les valeurs custom créées par l'auditeur, on affiche la valeur
// telle quelle avec un ton neutre.
function granularityForRow(t) {
  const emitter = deviceForLevel(t, 'emission')
  const key = resolveGranularity(emitter)
  return {
    key,
    label: GRANULARITY_LABELS_FR[key] || key,
    tone: GRANULARITY_TONES[key] || 'bg-gray-50 text-gray-700 border-gray-200',
    deviceId: emitter?.id || null,
    derivedKey: derivedGranularity(emitter?.regulation_type_emission || null),
  }
}
// Patch granularité explicite sur le device émetteur. Si l'utilisateur
// repasse à la valeur dérivée par défaut, on remet le champ à null pour
// signaler « pas de surcharge » (l'UI re-tombera sur la dérivée).
async function patchGranularity(t, value) {
  const info = granularityForRow(t)
  if (!info.deviceId) return
  const next = (value && value !== info.derivedKey) ? value : null
  try {
    await updateBacsDevice(info.deviceId, { regulation_granularity: next })
    // Synchro state local : on cherche le device dans le store et on
    // l'updaite à la volée (sinon il faudrait refresh complet).
    const dev = (audit.devices || []).find(d => d.id === info.deviceId)
    if (dev) dev.regulation_granularity = next
    await audit.refreshActionItems()
  } catch { error('Sauvegarde granularité impossible') }
}

// Mig 187 — détecte si la régulation est intégrée à l'équipement.
// Logique « intégrée par défaut » :
//   - device explicitement marqué Déportée (regulation_integrated === 0/false) → NON intégrée (on affiche le régulateur séparé)
//   - tous les autres cas (null = non répondu, true = explicite, device absent…) → on suppose intégrée
// Ça épargne 90% des cellules « régulateur déporté » qui dupliquaient
// l'équipement principal quand l'auditeur n'avait pas encore cliqué.
// L'auditeur peut basculer en Déportée dans la modale équipement pour
// faire apparaître le second select.
function regulationIsIntegrated(device) {
  if (!device) return true
  return !(device.regulation_integrated === 0 || device.regulation_integrated === false)
}

// ── Ajout / suppression d'entrées de régulation (mig 170) ──
// Une zone peut porter plusieurs systèmes de chauffage / refroidissement,
// chacun avec son libellé et son générateur. Les options d'ajout = couples
// (zone × usage) ayant au moins un système présent dans l'audit.
function defaultLabel(t) {
  return (t.category || 'heating') === 'cooling' ? 'Refroidissement' : 'Chauffage'
}

// Mig 180 : les lignes sont auto-créées côté backend depuis les systèmes
// présents (heating/cooling). L'ajout manuel a disparu — on garde
// uniquement la suppression d'une ligne (équivaut à dire "ce système ne
// dispose pas de régulation thermique R175-6").

async function removeEntry(t) {
  if (!confirm(`Supprimer la ligne régulation thermique pour le système « ${t.system_label || defaultLabel(t)} » de la zone « ${t.zone_name} » ?`)) return
  try {
    await audit.removeThermalEntry(t.id)
  } catch (e) {
    error(e.response?.data?.detail || 'Suppression impossible')
  }
}

// Adapte les devices d'une zone × catégorie au format SearchableSelect,
// filtrés par rôle requis (production / distribution / emission).
// Mode tolérant : équipements pertinents en tête, équipements sans rôle
// en bas, équipements avec rôle incompatible masqués.
function deviceOptionsForLevel(t, level) {
  const devices = props.generatorDevicesForZoneCategory(t.zone_id, t.category || 'heating') || []
  return filterAndSortByRole(devices, level).map(d => ({
    value: d.id,
    label: d.name || d.brand || d.model_reference || `Équipement #${d.id}`,
    hint: d.brand && d.model_reference ? `${d.brand} ${d.model_reference}` : (d.brand || d.model_reference || ''),
  }))
}

// R175-6 II : exemption auto si le device pointé en Production utilise
// le bois (`energy_source === 'wood'`). Affichée en lecture seule grisée
// dans la cellule « Exempté bois » pour signaler à l'auditeur que c'est
// dérivé du système — pas besoin de cocher manuellement.
function exemptAutoFromWood(t) {
  if (!t.generator_device_id) return false
  const devices = props.generatorDevicesForZoneCategory(t.zone_id, t.category || 'heating') || []
  const d = devices.find(dd => dd.id === t.generator_device_id)
  return d?.energy_source === 'wood'
}
// La colonne « Exempté bois » n'est affichée que si au moins une ligne
// est concernée (gain de largeur sinon).
const anyWoodExempt = computed(() =>
  (props.thermalFiltered || []).some(t => exemptAutoFromWood(t)),
)
// Nombre de zones avec une régulation effective (type renseigné ≠ none).
const regulatedCount = computed(() =>
  (props.thermalFiltered || []).filter(t => t.regulation_type && t.regulation_type !== 'none').length,
)
const woodExemptCount = computed(() =>
  (props.thermalFiltered || []).filter(t => exemptAutoFromWood(t)).length,
)

// Mig 187 — drag & drop des systèmes thermiques. Maintenant 1 Sortable
// par zone (chaque zone est sa propre sous-card avec sa liste d'articles)
// pour empêcher de glisser un système hors de sa zone (= contrainte métier
// implicite : un système Chauffage de Bureaux 1 n'a aucun sens dans Bureaux 2).
const tableRef = ref(null)
const sortables = []
function teardownSortable() {
  while (sortables.length) {
    const s = sortables.pop()
    try { s.destroy() } catch { /* ignore */ }
  }
}
function setupSortable() {
  teardownSortable()
  const root = tableRef.value
  if (!root) return
  // Mig 187 v8 — 1 seule table dans la card → 1 seul Sortable sur la table
  // entière, draggable cible les `tbody.thermal-row` (= systèmes). Permet
  // de réordonner les systèmes y compris cross-zone si l'utilisateur le
  // souhaite (rare, mais pas bloqué).
  const table = root.querySelector('table.thermal-card-table')
  if (!table) return
  sortables.push(Sortable.create(table, {
    draggable: 'tbody.thermal-row',
    handle: '.drag-handle',
    animation: 150,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onEnd: async (evt) => {
      if (evt.oldIndex === evt.newIndex) return
      const ids = Array.from(table.querySelectorAll('tbody.thermal-row'))
        .map(el => parseInt(el.getAttribute('data-id'), 10))
        .filter(Boolean)
      try {
        await reorderBacsThermal(audit.docId, ids)
        await audit.refreshAuditCore()
      } catch {
        error('Réorganisation impossible')
        await audit.refreshAuditCore()
      }
    },
  }))
}
watch(() => props.thermalFiltered, async () => {
  await nextTick()
  setupSortable()
}, { immediate: true, flush: 'post' })
onBeforeUnmount(teardownSortable)
</script>

<template>
  <CollapsibleSection storage-key="thermal" section-id="section-thermal" :active="active">
    <template #header>
      <SectionHeader number="6" :title="'Régulation thermique automatique'"
                     subtitle="R175-6"
                     :icon="FireIcon" icon-color="text-red-500"
                     :step="step"
                     @validate="emit('validate-step', $event)"
                     @invalidate="emit('invalidate-step', $event)">
        <template #subtitle-extra><R175Tooltip article="R175-6" /></template>
      </SectionHeader>
    </template>
    <template #summary>
      <span v-if="thermalFiltered.length">
        {{ thermalFiltered.length }} zone{{ thermalFiltered.length > 1 ? 's' : '' }} thermique{{ thermalFiltered.length > 1 ? 's' : '' }}
        · {{ regulatedCount }} régulation{{ regulatedCount > 1 ? 's' : '' }} auto
        <span v-if="woodExemptCount">
          · {{ woodExemptCount }} exempté{{ woodExemptCount > 1 ? 's' : '' }} bois
        </span>
      </span>
      <span v-else class="italic">Aucune régulation thermique relevée</span>
    </template>
    <!-- Intro pédagogique : qu'est-ce qu'on demande au lecteur de saisir
         et pourquoi. Sans ce contexte, l'auditeur novice se perd entre
         « régulation auto », « type de régulation », « générateur lié »… -->
    <!-- Pré-remplir depuis les équipements : remplit en un clic les champs
         Production / Distribution / Émission / Régulateur encore vides à
         partir des devices du système (rôles + has_regulation). Source de
         vérité = card 03 « Systèmes ». -->
    <div v-if="prefillCount > 0" class="mx-3 mt-2 flex items-center justify-between gap-2 p-2.5 bg-emerald-50/60 border border-emerald-200 rounded-lg">
      <div class="text-xs text-gray-700">
        <strong class="text-emerald-700">{{ prefillCount }} champ{{ prefillCount > 1 ? 's' : '' }}</strong>
        peu{{ prefillCount > 1 ? 'vent' : 't' }} être pré-rempli{{ prefillCount > 1 ? 's' : '' }} automatiquement depuis les équipements saisis dans la card « Systèmes ».
      </div>
      <button type="button" :disabled="prefillBusy"
              @click="prefillAllFromDevices"
              class="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-3 py-1.5 rounded-lg transition whitespace-nowrap shrink-0">
        <SparklesIcon class="w-4 h-4" />
        Pré-remplir depuis les équipements
      </button>
    </div>
    <div class="mx-3 mt-2 mb-3 p-3 bg-amber-50/50 border border-amber-100 rounded-lg text-xs text-gray-700 leading-relaxed">
      <p class="flex items-start gap-1.5">
        <InformationCircleIcon class="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <span>
          <strong>R175-6</strong> impose qu'à compter du <strong>1ᵉʳ janvier 2027</strong>, chaque émetteur de chauffage et
          de refroidissement soit équipé d'une <strong>régulation thermique automatique en fonction de la température
          intérieure</strong> de la zone qu'il dessert. Pour chaque couple <em>(zone × usage chaud/froid)</em>, on déroule
          <strong>trois sous-lignes</strong> — Production, Distribution, Émission — qui précisent l'équipement concerné, son
          équipement de régulation (sonde, thermostat, GTB) et des notes spécifiques. La liste des équipements proposés
          est filtrée selon le rôle requis. Les <strong>appareils indépendants de chauffage au bois</strong> sont exemptés (R175-6 II).
        </span>
      </p>
    </div>

    <!-- Mig 187 v3 — boutons globaux + sous-cards par zone repliables.
         L'en-tête de zone est cliquable pour replier/déplier sa liste de
         systèmes. Plus une ligne globale au-dessus pour tout basculer. -->
    <div class="px-3 pb-2 flex items-center justify-end">
      <button v-if="thermalGroups.length"
              type="button"
              @click="allCollapsed ? expandAll() : collapseAll()"
              class="inline-flex items-center gap-1 text-[11px] font-medium text-gray-600 hover:text-gray-900 px-2 py-1 rounded transition">
        <ChevronRightIcon v-if="allCollapsed" class="w-3.5 h-3.5" />
        <ChevronDownIcon v-else class="w-3.5 h-3.5" />
        {{ allCollapsed ? 'Tout déplier' : 'Tout replier' }}
      </button>
    </div>
    <!-- Mig 187 v8 — UNE SEULE table pour TOUTE la card, pour que les
         largeurs de colonnes (Production / Distribution / Émission) soient
         calculées sur le contenu MAXIMUM de toute la card, pas par zone.
         Sinon chaque zone calculait ses propres largeurs et les colonnes
         étaient inconsistantes d'une zone à l'autre.
         Les zones sont matérialisées par des tbody (zone-header cliquable
         + zone-content masquable en v-show). -->
    <div ref="tableRef" class="px-3 pb-3">
      <table class="thermal-card-table border border-gray-200 rounded-xl overflow-hidden">
        <!-- En-tête de colonnes affiché UNE FOIS en haut de la table : ne
             se répète plus pour chaque système (gain de bruit visuel). -->
        <thead class="bg-gray-50">
          <tr>
            <th v-for="level in LEVELS" :key="level.key"
                class="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-gray-500 font-semibold border-b border-gray-200">
              {{ level.label }}
              <!-- Mig 187 v5 — Granularité collée à l'Émission (dérive du
                   type d'émission). -->
              <span v-if="level.key === 'emission'" class="ml-2 normal-case font-normal text-gray-400">·</span>
              <span v-if="level.key === 'emission'" class="normal-case font-semibold text-gray-500">Granularité</span>
            </th>
          </tr>
        </thead>
        <template v-for="g in thermalGroups" :key="g.zoneName">
          <!-- tbody zone-header — bande grise cliquable pour replier la zone. -->
          <tbody class="thermal-zone-header">
            <tr @click="toggleZone(g.zoneName)"
                class="bg-gray-50 border-t border-gray-200 cursor-pointer hover:bg-gray-100 transition select-none">
              <td colspan="3" class="px-4 py-2">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <ChevronRightIcon v-if="collapsedZones[g.zoneName]" class="w-4 h-4 text-gray-500" />
                    <ChevronDownIcon v-else class="w-4 h-4 text-gray-500" />
                    <h3 class="text-sm font-semibold text-gray-800">{{ g.zoneName }}</h3>
                  </div>
                  <span class="text-[11px] text-gray-500">{{ g.rows.length }} système{{ g.rows.length > 1 ? 's' : '' }}</span>
                </div>
              </td>
            </tr>
          </tbody>
          <!-- tbody par système (regroupe les rows identification + data
               sous un même drag handle / data-id pour Sortable). -->
          <tbody v-for="t in g.rows" :key="t.id"
                 v-show="!collapsedZones[g.zoneName]"
                 :data-id="t.id"
                 class="thermal-row border-t border-gray-100">
            <!-- Ligne 1 — identification (colspan 3) + actions -->
            <tr>
              <td colspan="3" class="px-4 pt-3 pb-1">
                <div class="flex items-center gap-3 flex-wrap">
                  <button type="button"
                          class="drag-handle inline-flex p-1 text-gray-300 hover:text-gray-600 cursor-grab active:cursor-grabbing shrink-0"
                          v-tooltip="'Glisser pour réordonner ce système'">
                    <Bars3Icon class="w-4 h-4" />
                  </button>
                  <SystemCategoryIcon :category="t.category || 'heating'" size="sm" />
                  <span class="text-xs font-semibold uppercase tracking-wider"
                        :class="(t.category || 'heating') === 'heating' ? 'text-red-600' : 'text-cyan-600'">
                    {{ (t.category || 'heating') === 'heating' ? 'Chauffage' : 'Refroidissement' }}
                  </span>
                  <span class="text-gray-400">·</span>
                  <span class="text-sm font-semibold text-gray-800">{{ systemDisplayName(t) }}</span>
                  <Tooltip v-if="exemptAutoFromWood(t)"
                           text="Exemption R175-6 II : l'équipement de Production est au bois.">
                    <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap cursor-help">
                      Exempté — bois
                    </span>
                  </Tooltip>
                  <div class="ml-auto flex items-center gap-1 shrink-0">
                    <button type="button"
                            @click="emit('open-notes', {
                              title: 'Notes régulation thermique',
                              contextLabel: t.zone_name + ' — ' + ((t.category || 'heating') === 'heating' ? 'Chauffage' : 'Refroidissement'),
                              entityType: 'thermal',
                              entityRef: t,
                              currentHtml: t.notes_html || t.notes || '',
                              noteField: 'notes_html',
                            })"
                            :class="['btn-icon', hasNotes(t.notes_html || t.notes) && 'is-active']"
                            v-tooltip="hasNotes(t.notes_html || t.notes) ? 'Modifier les notes globales' : 'Ajouter une note globale'">
                      <PencilSquareIcon class="w-4 h-4 shrink-0" />
                    </button>
                    <button type="button" @click="removeEntry(t)"
                            class="btn-icon btn-icon-danger"
                            v-tooltip="'Supprimer ce système de régulation'">
                      <TrashIcon class="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </td>
            </tr>
            <!-- Ligne 2 — 3 cellules niveaux. Largeurs auto par contenu max
                 sur TOUTE la card (vrai bénéfice du single-table). -->
            <tr>
              <td v-for="level in LEVELS" :key="level.key"
                  class="px-4 pb-3 align-top">
                <ThermalLevelCell
                  :thermal="t"
                  :level="level.key"
                  :device="deviceForLevel(t, level.key)"
                  :device-options="deviceOptionsForLevel(t, level.key)"
                  :regulator-options="deviceOptionsForLevel(t, 'regulation')"
                  :regulation-type-label="levelRegulationTypeLabel(t, level.key)"
                  :integrated="regulationIsIntegrated(deviceForLevel(t, level.key))"
                  :note-html="t[LEVEL_NOTES_FIELD[level.key]] || ''"
                  @patch-thermal="(p) => patchThermal(t, p)"
                  @open-notes="emit('open-notes', {
                    title: 'Notes ' + level.label + ' — ' + t.zone_name,
                    contextLabel: t.zone_name + ' · ' + level.label,
                    entityType: 'thermal', entityRef: t,
                    currentHtml: t[LEVEL_NOTES_FIELD[level.key]] || '',
                    noteField: LEVEL_NOTES_FIELD[level.key],
                  })" />
                <!-- Granularité dans la cellule Émission, juste sous le
                     multiselect du device émetteur. -->
                <div v-if="level.key === 'emission'" class="mt-2 flex items-center gap-1.5 flex-wrap">
                  <SearchableSelect
                    :model-value="granularityForRow(t).key"
                    @update:modelValue="(v) => patchGranularity(t, v)"
                    :options="GRANULARITY_OPTIONS"
                    :clearable="true" :creatable="true" :auto-width="true"
                    size="sm" placeholder="Granularité…" />
                  <span v-if="granularityForRow(t).deviceId && !deviceForLevel(t, 'emission')?.regulation_granularity"
                        class="text-[9px] text-gray-400 italic"
                        v-tooltip="`Valeur dérivée automatiquement du type d'émission. Choisis une valeur pour la fixer.`">
                    auto
                  </span>
                </div>
              </td>
            </tr>
          </tbody>
        </template>
      </table>
    </div>

    <!-- Mig 180 : les lignes sont créées automatiquement depuis les
         systèmes présents (heating/cooling). Pour ajouter une régulation,
         on ajoute un système dans la card 03. -->
    <p class="px-3 pb-3 pt-1 text-[11px] text-gray-500 italic">
      Une ligne par système chauffage / refroidissement présent dans la card « Systèmes ».
      Pour ajouter une régulation, créer un système dans la card 03.
    </p>
  </CollapsibleSection>
</template>
