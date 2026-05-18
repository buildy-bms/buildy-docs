<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import Sortable from 'sortablejs'
import { FireIcon, PencilSquareIcon, InformationCircleIcon, Bars3Icon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import Tooltip from '@/components/Tooltip.vue'
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import SearchableSelect from '@/components/SearchableSelect.vue'
import DataTableSortHeader from '@/components/DataTableSortHeader.vue'
import { useTableSort } from '@/composables/useTableSort'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { updateBacsThermal, reorderBacsThermal } from '@/api'
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
  regulationOptions: { type: Array, required: true },
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
  if (key === 'regulation_type') return (t.regulation_type || '').toLowerCase()
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
          <DataTableSortHeader sort-key="regulation_type" :active-key="sortKey" :dir="sortDir" @toggle="toggleSort">Type de régulation</DataTableSortHeader>
          <th v-if="anyWoodExempt">Exempté bois</th>
          <th>Production</th>
          <th>Régulation production</th>
          <th>Distribution</th>
          <th>Régulation distribution</th>
          <th>Émission</th>
          <th>Régulation émission</th>
          <th>Notes</th>
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
          <td class="align-middle">
            <div class="min-w-32">
              <SearchableSelect
                :model-value="t.regulation_type"
                @update:modelValue="v => patchThermal(t, { regulation_type: v || null })"
                :options="(regulationOptions || []).filter(o => o.value)"
                :invalid="!t.regulation_type"
                size="sm" placeholder="—"
                search-placeholder="Filtrer ou ajouter…" />
            </div>
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
          <!-- Production : équipement (sans type/âge, ils sont sur le device Card 03) -->
          <td class="align-middle">
            <div class="min-w-40">
              <SearchableSelect
                :model-value="t.generator_device_id"
                @update:modelValue="v => patchThermal(t, { generator_device_id: v != null ? parseInt(v, 10) : null })"
                :options="deviceOptionsForLevel(t, 'production')"
                :invalid="!t.generator_device_id"
                size="sm" placeholder="—"
                search-placeholder="Rechercher…" />
            </div>
          </td>
          <!-- Équipement de régulation Production + icône notes Production -->
          <td class="align-middle">
            <div class="flex items-center gap-1 min-w-40">
              <div class="flex-1 min-w-0">
                <SearchableSelect
                  :model-value="t.production_regulation_device_id"
                  @update:modelValue="v => patchThermal(t, { production_regulation_device_id: v != null ? parseInt(v, 10) : null })"
                  :options="deviceOptionsForLevel(t, 'regulation')"
                  :invalid="!t.production_regulation_device_id"
                  size="sm" placeholder="—"
                  search-placeholder="Sonde, thermo…" />
              </div>
              <button type="button"
                      @click="emit('open-notes', { title: 'Notes Production — ' + t.zone_name, contextLabel: t.zone_name + ' · Production', entityType: 'thermal', entityRef: t, currentHtml: t.production_notes_html || '', noteField: 'production_notes_html' })"
                      :class="['shrink-0 p-1 rounded-md',
                        hasNotes(t.production_notes_html)
                          ? 'text-indigo-700 bg-indigo-50'
                          : 'text-gray-300 hover:text-gray-600']"
                      v-tooltip="hasNotes(t.production_notes_html) ? 'Note production' : 'Ajouter une note production'">
                <PencilSquareIcon class="w-3.5 h-3.5" />
              </button>
            </div>
          </td>
          <!-- Distribution : équipement -->
          <td class="align-middle">
            <div class="min-w-40">
              <SearchableSelect
                :model-value="t.distribution_device_id"
                @update:modelValue="v => patchThermal(t, { distribution_device_id: v != null ? parseInt(v, 10) : null })"
                :options="deviceOptionsForLevel(t, 'distribution')"
                :invalid="!t.distribution_device_id"
                size="sm" placeholder="—"
                search-placeholder="Rechercher…" />
            </div>
          </td>
          <!-- Équipement de régulation Distribution + icône notes -->
          <td class="align-middle">
            <div class="flex items-center gap-1 min-w-40">
              <div class="flex-1 min-w-0">
                <SearchableSelect
                  :model-value="t.distribution_regulation_device_id"
                  @update:modelValue="v => patchThermal(t, { distribution_regulation_device_id: v != null ? parseInt(v, 10) : null })"
                  :options="deviceOptionsForLevel(t, 'regulation')"
                  :invalid="!t.distribution_regulation_device_id"
                  size="sm" placeholder="—"
                  search-placeholder="Sonde, thermo…" />
              </div>
              <button type="button"
                      @click="emit('open-notes', { title: 'Notes Distribution — ' + t.zone_name, contextLabel: t.zone_name + ' · Distribution', entityType: 'thermal', entityRef: t, currentHtml: t.distribution_notes_html || '', noteField: 'distribution_notes_html' })"
                      :class="['shrink-0 p-1 rounded-md',
                        hasNotes(t.distribution_notes_html)
                          ? 'text-indigo-700 bg-indigo-50'
                          : 'text-gray-300 hover:text-gray-600']"
                      v-tooltip="hasNotes(t.distribution_notes_html) ? 'Note distribution' : 'Ajouter une note distribution'">
                <PencilSquareIcon class="w-3.5 h-3.5" />
              </button>
            </div>
          </td>
          <!-- Émission : équipement -->
          <td class="align-middle">
            <div class="min-w-40">
              <SearchableSelect
                :model-value="t.emission_device_id"
                @update:modelValue="v => patchThermal(t, { emission_device_id: v != null ? parseInt(v, 10) : null })"
                :options="deviceOptionsForLevel(t, 'emission')"
                :invalid="!t.emission_device_id"
                size="sm" placeholder="—"
                search-placeholder="Rechercher…" />
            </div>
          </td>
          <!-- Équipement de régulation Émission + icône notes -->
          <td class="align-middle">
            <div class="flex items-center gap-1 min-w-40">
              <div class="flex-1 min-w-0">
                <SearchableSelect
                  :model-value="t.emission_regulation_device_id"
                  @update:modelValue="v => patchThermal(t, { emission_regulation_device_id: v != null ? parseInt(v, 10) : null })"
                  :options="deviceOptionsForLevel(t, 'regulation')"
                  :invalid="!t.emission_regulation_device_id"
                  size="sm" placeholder="—"
                  search-placeholder="Sonde, thermo…" />
              </div>
              <button type="button"
                      @click="emit('open-notes', { title: 'Notes Émission — ' + t.zone_name, contextLabel: t.zone_name + ' · Émission', entityType: 'thermal', entityRef: t, currentHtml: t.emission_notes_html || '', noteField: 'emission_notes_html' })"
                      :class="['shrink-0 p-1 rounded-md',
                        hasNotes(t.emission_notes_html)
                          ? 'text-indigo-700 bg-indigo-50'
                          : 'text-gray-300 hover:text-gray-600']"
                      v-tooltip="hasNotes(t.emission_notes_html) ? 'Note émission' : 'Ajouter une note émission'">
                <PencilSquareIcon class="w-3.5 h-3.5" />
              </button>
            </div>
          </td>
          <!-- Notes globales du couple -->
          <td class="align-middle">
            <button type="button"
                    @click="emit('open-notes', {
                      title: 'Notes régulation thermique',
                      contextLabel: t.zone_name + ' — ' + ((t.category || 'heating') === 'heating' ? 'Chauffage' : 'Refroidissement'),
                      entityType: 'thermal',
                      entityRef: t,
                      currentHtml: t.notes_html || t.notes || '',
                      noteField: 'notes_html',
                    })"
                    :class="['inline-flex items-center justify-center p-1.5 rounded-md transition',
                      hasNotes(t.notes_html || t.notes)
                        ? 'text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                        : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100']"
                    v-tooltip="hasNotes(t.notes_html || t.notes) ? 'Modifier les notes globales' : 'Ajouter une note globale'">
              <PencilSquareIcon class="w-4 h-4 shrink-0" />
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    </div>
  </CollapsibleSection>
</template>
