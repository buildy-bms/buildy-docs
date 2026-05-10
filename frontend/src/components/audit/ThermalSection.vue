<script setup>
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import Sortable from 'sortablejs'
import { FireIcon, PencilSquareIcon, InformationCircleIcon, Bars3Icon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import Tooltip from '@/components/Tooltip.vue'
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import SearchableSelect from '@/components/SearchableSelect.vue'
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
      <SectionHeader number="5" :title="'Régulation thermique automatique'"
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
        · {{ thermalFiltered.filter(t => t.has_automatic_regulation).length }} régulation{{ thermalFiltered.filter(t => t.has_automatic_regulation).length > 1 ? 's' : '' }} auto
        <span v-if="thermalFiltered.filter(t => t.generator_exempt_wood).length">
          · {{ thermalFiltered.filter(t => t.generator_exempt_wood).length }} exempté{{ thermalFiltered.filter(t => t.generator_exempt_wood).length > 1 ? 's' : '' }} bois
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
    <table ref="tableRef" class="w-full text-sm min-w-225">
      <thead class="text-xs text-gray-500 font-medium bg-gray-50">
        <tr>
          <th class="w-8"></th>
          <th class="text-center px-3 py-2 w-32">Zone</th>
          <th class="text-center py-2 w-32">
            <Tooltip text="Chauffage ou refroidissement — chaque bloc = 1 usage thermique sur 1 zone. Une zone peut apparaître 2 fois (1 bloc chaud + 1 bloc froid)."><span>Usage</span></Tooltip>
          </th>
          <th class="text-center py-2 w-28">
            <Tooltip text="La zone dispose-t-elle d'une régulation automatique en fonction de la température intérieure ? Cocher uniquement si une boucle de régulation est effectivement en place."><span>Régul auto ?</span></Tooltip>
          </th>
          <th class="text-center py-2 w-40">
            <Tooltip text="Granularité de la régulation : zone unique, par pièce, par étage… Plus la granularité est fine, plus le confort et l'économie d'énergie sont optimisés (R175-6 II §2)."><span>Granularité</span></Tooltip>
          </th>
          <th class="text-center py-2 w-32">
            <Tooltip text="Appareil indépendant de chauffage au bois (poêle, insert, cheminée fermée) → exempté de R175-6 (II du décret). Non applicable au refroidissement."><span>Exempté bois</span></Tooltip>
          </th>
          <th class="text-center px-3 py-2 w-24">Notes globales</th>
        </tr>
      </thead>
      <tbody v-for="t in thermalFiltered" :key="t.id"
             :data-id="t.id"
             class="thermal-row divide-y divide-gray-100 border-b-2 border-gray-200">
        <!-- Ligne d'en-tête : champs communs au couple (zone × catégorie) -->
        <tr class="bg-gray-50/40">
          <td class="text-center align-middle">
            <button type="button"
                    class="drag-handle inline-flex p-1 text-gray-300 hover:text-gray-600 cursor-grab active:cursor-grabbing"
                    v-tooltip="'Glisser pour réordonner'">
              <Bars3Icon class="w-4 h-4" />
            </button>
          </td>
          <td class="px-3 py-2 text-gray-700 text-center align-middle font-medium">{{ t.zone_name }}</td>
          <td class="py-2 text-center align-middle">
            <span class="inline-flex items-center gap-1.5 justify-center text-xs font-medium"
                  :class="(t.category || 'heating') === 'heating' ? 'text-red-600' : 'text-cyan-600'">
              <SystemCategoryIcon :category="t.category || 'heating'" size="sm" />
              {{ (t.category || 'heating') === 'heating' ? 'Chauffage' : 'Refroidissement' }}
            </span>
          </td>
          <td class="py-2 text-center align-middle">
            <input type="checkbox" :checked="!!t.has_automatic_regulation"
                   @change="e => patchThermal(t, { has_automatic_regulation: e.target.checked })"
                   class="rounded border-gray-300" />
          </td>
          <td class="py-2 px-1 align-middle">
            <SearchableSelect
              :model-value="t.regulation_type"
              @update:modelValue="v => patchThermal(t, { regulation_type: v || null })"
              :options="(regulationOptions || []).filter(o => o.value)"
              size="sm" placeholder="— granularité"
              search-placeholder="Filtrer ou ajouter…" />
          </td>
          <td class="py-2 text-center align-middle">
            <!-- Exempté bois : applicable uniquement au chauffage (R175-6 II
                 ne traite que les appareils de chauffage au bois). -->
            <Tooltip v-if="(t.category || 'heating') === 'heating'"
                     text="Si coché : production = appareil indépendant de chauffage au bois → exempté R175-6 (cf décret R175-6 II)">
              <input type="checkbox" :checked="!!t.generator_exempt_wood"
                     @change="e => patchThermal(t, { generator_exempt_wood: e.target.checked })"
                     class="rounded border-gray-300" />
            </Tooltip>
            <span v-else class="text-gray-300 text-xs">—</span>
          </td>
          <td class="px-3 py-2 text-center align-middle">
            <button type="button"
                    @click="emit('open-notes', {
                      title: 'Notes régulation thermique',
                      contextLabel: t.zone_name + ' — ' + ((t.category || 'heating') === 'heating' ? 'Chauffage' : 'Refroidissement'),
                      entityType: 'thermal',
                      entityRef: t,
                      currentHtml: t.notes_html || t.notes || '',
                      noteField: 'notes_html',
                    })"
                    :class="['inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border transition whitespace-nowrap',
                      hasNotes(t.notes_html || t.notes)
                        ? 'border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                        : 'border-gray-200 text-gray-500 bg-white hover:border-gray-300 hover:text-gray-700']"
                    v-tooltip="hasNotes(t.notes_html || t.notes) ? 'Modifier les notes globales' : 'Ajouter une note globale'">
              <PencilSquareIcon class="w-3.5 h-3.5 shrink-0" />
              {{ hasNotes(t.notes_html || t.notes) ? 'Notes' : '+ Notes' }}
            </button>
          </td>
        </tr>
        <!-- 3 sous-lignes : une par niveau R175-6 (Production / Distribution
             / Émission). Chaque sous-ligne occupe toute la largeur via
             colspan, avec une grille interne 4 colonnes : libellé · équipement
             du niveau · équipement de régulation · bouton notes. -->
        <tr v-for="lvl in LEVELS" :key="lvl.key"
            class="thermal-level-row hover:bg-amber-50/20">
          <td colspan="7" class="px-3 py-2">
            <div class="grid grid-cols-12 gap-3 items-start">
              <!-- 1) Libellé du niveau (col 1-2) -->
              <div class="col-span-2 flex items-center gap-1.5 pt-1.5">
                <span class="text-base">{{ lvl.icon }}</span>
                <span class="text-xs font-semibold text-gray-700">{{ lvl.label }}</span>
              </div>
              <!-- 2) Équipement du niveau (col 3-6) -->
              <div class="col-span-4 space-y-1.5">
                <span class="block text-[10px] uppercase tracking-wider text-gray-400">Équipement</span>
                <SearchableSelect
                  :model-value="t[LEVEL_DEVICE_FIELD[lvl.key]]"
                  @update:modelValue="v => patchThermal(t, { [LEVEL_DEVICE_FIELD[lvl.key]]: v != null ? parseInt(v, 10) : null })"
                  :options="deviceOptionsForLevel(t, lvl.key)"
                  size="sm" placeholder="— aucun"
                  search-placeholder="Rechercher un équipement…" />
                <!-- Type + âge spécifiques au niveau Production -->
                <template v-if="lvl.key === 'production' && t.generator_device_id">
                  <SearchableSelect
                    :model-value="t.generator_type"
                    @update:modelValue="v => patchThermal(t, { generator_type: v || null })"
                    :options="(generatorOptions || []).filter(o => o.value)"
                    creatable size="sm" placeholder="Type production…"
                    search-placeholder="Filtrer ou ajouter…" />
                  <div class="flex items-center gap-1.5">
                    <label class="text-[10px] text-gray-500 shrink-0">Âge</label>
                    <input type="number" :value="t.generator_age_years" min="0" placeholder="ans"
                           @blur="e => patchThermal(t, { generator_age_years: e.target.value ? parseInt(e.target.value, 10) : null })"
                           class="w-16 text-xs px-2 py-1 border border-gray-200 rounded" />
                  </div>
                </template>
              </div>
              <!-- 3) Équipement de régulation (col 7-10) -->
              <div class="col-span-4 space-y-1.5">
                <span class="block text-[10px] uppercase tracking-wider text-gray-400">Équipement de régulation</span>
                <SearchableSelect
                  :model-value="t[LEVEL_REGULATION_FIELD[lvl.key]]"
                  @update:modelValue="v => patchThermal(t, { [LEVEL_REGULATION_FIELD[lvl.key]]: v != null ? parseInt(v, 10) : null })"
                  :options="deviceOptionsForLevel(t, 'regulation')"
                  size="sm" placeholder="— aucun"
                  search-placeholder="Sonde, thermostat, GTB…" />
              </div>
              <!-- 4) Bouton notes par niveau (col 11-12) -->
              <div class="col-span-2 flex justify-end pt-5">
                <button type="button"
                        @click="emit('open-notes', {
                          title: 'Notes ' + lvl.label.toLowerCase() + ' — ' + t.zone_name,
                          contextLabel: t.zone_name + ' — ' + ((t.category || 'heating') === 'heating' ? 'Chauffage' : 'Refroidissement') + ' · ' + lvl.label,
                          entityType: 'thermal',
                          entityRef: t,
                          currentHtml: t[LEVEL_NOTES_FIELD[lvl.key]] || '',
                          noteField: LEVEL_NOTES_FIELD[lvl.key],
                        })"
                        :class="['inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border transition whitespace-nowrap',
                          hasNotes(t[LEVEL_NOTES_FIELD[lvl.key]])
                            ? 'border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                            : 'border-gray-200 text-gray-500 bg-white hover:border-gray-300 hover:text-gray-700']"
                        v-tooltip="hasNotes(t[LEVEL_NOTES_FIELD[lvl.key]]) ? 'Modifier la note ' + lvl.label.toLowerCase() : 'Ajouter une note ' + lvl.label.toLowerCase()">
                  <PencilSquareIcon class="w-3.5 h-3.5 shrink-0" />
                  {{ hasNotes(t[LEVEL_NOTES_FIELD[lvl.key]]) ? 'Notes' : '+ Notes' }}
                </button>
              </div>
            </div>
          </td>
        </tr>
        <!-- Détail R175-6 — placé directement sous sa ligne parent pour
             que l'utilisateur sache à quelle zone/usage ça se rapporte.
             Affiché uniquement si la régulation auto est cochée. Layout
             en flex compact avec labels inline (vs grid 3 cols qui faisait
             des champs trop larges et illisibles). -->
        <tr v-if="t.has_automatic_regulation" class="bg-amber-50/30 text-xs">
          <td colspan="7" class="px-5 py-2.5">
            <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span class="text-[11px] text-gray-400 italic shrink-0">
                ↳ détail R175-6 · {{ t.zone_name }} · {{ (t.category || 'heating') === 'heating' ? 'Chauffage' : 'Refroidissement' }}
              </span>
              <div class="flex items-center gap-1.5">
                <Tooltip text="Où est physiquement placée la sonde de température ? Murale 1,5m, gaine de reprise, plancher… Le décret n'impose pas une position précise mais une régulation effective.">
                  <label class="text-[11px] font-medium text-gray-600 inline-flex items-center gap-0.5 cursor-help">
                    Sonde
                    <InformationCircleIcon class="w-3 h-3 text-gray-400" />
                  </label>
                </Tooltip>
                <input type="text" :value="t.sensor_position" placeholder="ex : murale 1,5m, gaine reprise…"
                       @blur="e => patchThermal(t, { sensor_position: e.target.value || null })"
                       class="w-56 px-2 py-1 border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 placeholder:italic placeholder:text-gray-300" />
              </div>
              <div class="flex items-center gap-1.5">
                <Tooltip text="Manuel = molette sans programmation. Programmable = plages horaires. Adaptatif = auto-apprentissage. Connecté = smart, pilotable à distance.">
                  <label class="text-[11px] font-medium text-gray-600 inline-flex items-center gap-0.5 cursor-help">
                    Thermostat
                    <InformationCircleIcon class="w-3 h-3 text-gray-400" />
                  </label>
                </Tooltip>
                <select :value="t.thermostat_type"
                        @change="e => patchThermal(t, { thermostat_type: e.target.value || null })"
                        class="w-44 px-2 py-1 border border-gray-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500">
                  <option :value="null">— à choisir</option>
                  <option value="manual">Manuel</option>
                  <option value="programmable">Programmable</option>
                  <option value="adaptive">Adaptatif</option>
                  <option value="connected">Connecté</option>
                </select>
              </div>
              <Tooltip text="Robinets thermostatiques sur les radiateurs ? Comptent comme régulation R175-6 si présents et fonctionnels sur tous les émetteurs.">
                <label class="flex items-center gap-1.5 cursor-pointer text-gray-700 text-xs">
                  <input type="checkbox" :checked="!!t.has_thermostatic_valves"
                         @change="e => patchThermal(t, { has_thermostatic_valves: e.target.checked })"
                         class="rounded border-gray-300" />
                  <span class="inline-flex items-center gap-0.5">
                    Robinets thermostatiques
                    <InformationCircleIcon class="w-3 h-3 text-gray-400" />
                  </span>
                </label>
              </Tooltip>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    </div>
  </CollapsibleSection>
</template>
