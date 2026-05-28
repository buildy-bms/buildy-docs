<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import Sortable from 'sortablejs'
import { FireIcon, PencilSquareIcon, InformationCircleIcon, Bars3Icon, TrashIcon, SparklesIcon } from '@heroicons/vue/24/outline'
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

// Drag & drop des lignes thermiques. Sortable sur la <table> avec
// draggable="tbody" — chaque tbody contient la ligne principale + sa
// ligne de détail repliable, donc les deux suivent le drag ensemble.
const tableRef = ref(null)
let sortable = null
function teardownSortable() {
  if (sortable) { try { sortable.destroy() } catch { /* ignore */ } sortable = null }
}
function setupSortable() {
  teardownSortable()
  const el = tableRef.value
  if (!el) return
  sortable = Sortable.create(el, {
    draggable: 'tbody.thermal-row',
    handle: '.drag-handle',
    animation: 150,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onEnd: async (evt) => {
      if (evt.oldIndex === evt.newIndex) return
      const ids = Array.from(el.querySelectorAll('tbody.thermal-row'))
        .map(tb => parseInt(tb.getAttribute('data-id'), 10))
        .filter(Boolean)
      try {
        await reorderBacsThermal(audit.docId, ids)
        await audit.refreshAuditCore()
      } catch {
        error('Réorganisation impossible')
        await audit.refreshAuditCore()
      }
    },
  })
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

    <div class="overflow-x-auto">
    <table ref="tableRef" class="data-table w-full text-sm">
      <thead>
        <tr>
          <th class="w-8"></th>
          <DataTableSortHeader sort-key="zone" :active-key="sortKey" :dir="sortDir" @toggle="toggleSort">Zone</DataTableSortHeader>
          <DataTableSortHeader sort-key="usage" :active-key="sortKey" :dir="sortDir" @toggle="toggleSort">Usage</DataTableSortHeader>
          <DataTableSortHeader sort-key="system" :active-key="sortKey" :dir="sortDir" @toggle="toggleSort">Système</DataTableSortHeader>
          <th v-if="anyWoodExempt">Exempté bois</th>
          <th>Production</th>
          <th>Distribution</th>
          <th>Émission</th>
          <th>Granularité</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody v-for="t in sortedThermal" :key="t.id"
             :data-id="t.id"
             class="thermal-row">
        <!-- Ligne principale : 12 colonnes alignées + drag handle -->
        <tr>
          <td class="align-middle">
            <button type="button"
                    class="drag-handle inline-flex p-1 text-gray-300 hover:text-gray-600 cursor-grab active:cursor-grabbing"
                    v-tooltip="'Glisser pour réordonner'">
              <Bars3Icon class="w-4 h-4" />
            </button>
          </td>
          <td class="text-gray-700 font-medium whitespace-nowrap">{{ t.zone_name }}</td>
          <td class="whitespace-nowrap">
            <span class="inline-flex items-center gap-1.5 justify-center text-xs font-medium"
                  :class="(t.category || 'heating') === 'heating' ? 'text-red-600' : 'text-cyan-600'">
              <SystemCategoryIcon :category="t.category || 'heating'" size="sm" />
              {{ (t.category || 'heating') === 'heating' ? 'Chauffage' : 'Refroidissement' }}
            </span>
          </td>
          <!-- Mig 180 : Nom du système — lecture seule, vient de
               bacs_audit_systems.custom_label via le JOIN backend. Si vide,
               fallback sur le nom de l'équipement de production (plus
               parlant que « Chauffage » / « Refroidissement »), puis sur
               le libellé d'usage par défaut.
               L'édition se fait dans la card 03 « Systèmes ». -->
          <td class="align-middle text-sm text-gray-800 font-medium whitespace-nowrap">
            {{ systemDisplayName(t) }}
          </td>
          <td v-if="anyWoodExempt" class="align-middle">
            <!-- Exemption R175-6 II déduite automatiquement de l'énergie de
                 l'équipement de Production (bois). Lecture seule. -->
            <Tooltip v-if="exemptAutoFromWood(t)"
                     text="Exemption R175-6 II : l'équipement de Production est au bois.">
              <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap cursor-help">
                Exempté — bois
              </span>
            </Tooltip>
            <span v-else class="text-gray-300 text-xs">—</span>
          </td>
          <!-- Mig 187 — Layout regroupé : 1 colonne par niveau (Production /
               Distribution / Émission), chacune contenant équipement principal
               + chip type de régulation + équipement régulateur séparé SI
               régulation déportée (`regulation_integrated === 0` sur l'éq.).
               Sinon « Régulation intégrée » affiché en chip neutre = pas de
               double saisie. Notes par niveau accessibles via icône. -->
          <td v-for="level in LEVELS" :key="level.key" class="align-top">
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
          </td>
          <!-- Mig 187 — Granularité R175-6 désormais ÉDITABLE (saisie sur le
               device émetteur dans la modale équipement). Le SearchableSelect
               ci-dessous offre les options canoniques + creatable. Vide = on
               affiche la valeur dérivée du type d'émission. -->
          <td class="align-middle">
            <div class="min-w-32">
              <SearchableSelect
                :model-value="granularityForRow(t).key"
                @update:modelValue="(v) => patchGranularity(t, v)"
                :options="GRANULARITY_OPTIONS"
                :clearable="true" :creatable="true" size="sm" placeholder="—" />
              <span v-if="granularityForRow(t).deviceId && !deviceForLevel(t, 'emission')?.regulation_granularity"
                    class="mt-1 inline-block text-[9px] text-gray-400 italic"
                    v-tooltip="`Valeur dérivée automatiquement du type d'émission. Pour la fixer, choisis une valeur dans la liste.`">
                auto
              </span>
            </div>
          </td>
          <!-- Actions de l'entrée de régulation : notes globales + suppression -->
          <td class="align-middle">
            <div class="inline-flex items-center gap-1">
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
          </td>
        </tr>
      </tbody>
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
