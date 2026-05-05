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

// Suggestions de régulation par niveau (R175-6) — listes creatable :
// l'auditeur peut taper sa propre valeur si l'option n'est pas listée.
// Volontairement courtes : on documente les patterns les plus courants,
// la longue traîne passe par le champ libre.
const PRODUCTION_REGULATION_OPTIONS = [
  { value: 'sonde_exterieure', label: 'Sonde extérieure (loi d\'eau)' },
  { value: 'sonde_depart',     label: 'Sonde de départ' },
  { value: 'courbe_chauffe',   label: 'Courbe de chauffe / loi d\'eau réglée' },
  { value: 'thermostat_fixe',  label: 'Thermostat de consigne fixe' },
  { value: 'cascade',          label: 'Cascade de producteurs' },
  { value: 'gtb_optimisation', label: 'Optimisation par GTB (glissante)' },
  { value: 'aucune',           label: 'Aucune régulation au niveau production' },
]
const DISTRIBUTION_REGULATION_OPTIONS = [
  { value: 'pompe_dp_variable', label: 'Pompe à pression différentielle variable' },
  { value: 'pompe_vitesse_var', label: 'Pompe à vitesse variable' },
  { value: 'pompe_vitesse_fixe',label: 'Pompe à vitesse fixe' },
  { value: 'v3v_melange',       label: 'Vanne 3 voies mélangeuse' },
  { value: 'v2v_delestage',     label: 'Vanne 2 voies (délestage)' },
  { value: 'equilibrage_statique',  label: 'Équilibrage statique' },
  { value: 'equilibrage_dynamique', label: 'Équilibrage dynamique' },
  { value: 'aucune',            label: 'Aucune régulation au niveau distribution' },
]
const EMISSION_REGULATION_OPTIONS = [
  { value: 'robinets_thermo',     label: 'Robinets thermostatiques' },
  { value: 'vannes_2v_par_zone',  label: 'Vannes 2 voies pilotées par zone' },
  { value: 'thermostat_ambiance', label: 'Thermostat d\'ambiance' },
  { value: 'sonde_ambiance',      label: 'Sonde d\'ambiance + actionneur' },
  { value: 'pcrt_par_piece',      label: 'Plancher chauffant régulé pièce par pièce' },
  { value: 'pilotage_drv',        label: 'Pilotage centralisé DRV' },
  { value: 'aucune',              label: 'Aucune régulation au niveau émission' },
]

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

// Adapte les devices d'une zone × catégorie au format SearchableSelect.
// Réutilise le filtrage existant fourni par le parent (BacsAuditDetailView).
function deviceOptionsForRow(t) {
  const devices = props.generatorDevicesForZoneCategory(t.zone_id, t.category || 'heating') || []
  return devices.map(d => ({
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
      <SectionHeader number="5" title="Régulation thermique automatique"
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
          intérieure</strong> de la zone qu'il dessert. Pour chaque couple <em>(zone × usage chaud/froid)</em>,
          documenter : la régulation est-elle déjà en place ? Quel équipement (générateur) la pilote ? Si oui,
          renseigner le détail (sonde, thermostat, robinets) en bas de la ligne. Les <strong>appareils indépendants
          de chauffage au bois</strong> sont exemptés (R175-6 II).
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
            <Tooltip text="Chauffage ou refroidissement — chaque ligne = 1 usage thermique sur 1 zone. Une zone peut donc apparaître 2 fois (1 ligne chaud + 1 ligne froid)."><span>Usage</span></Tooltip>
          </th>
          <th class="text-center py-2 w-28">
            <Tooltip text="La zone dispose-t-elle d'une régulation automatique en fonction de la température intérieure ? Cocher uniquement si une boucle de régulation est effectivement en place."><span>Régul auto ?</span></Tooltip>
          </th>
          <th class="text-center py-2 w-40">
            <Tooltip text="Granularité de la régulation : zone unique, par pièce, par étage… Plus la granularité est fine, plus le confort et l'économie d'énergie sont optimisés (R175-6 II §2)."><span>Granularité</span></Tooltip>
          </th>
          <th class="text-left px-2 py-2 w-56">
            <Tooltip text="Équipement qui produit le chaud/froid : chaudière, PAC, unité extérieure DRV, rooftop. Le type, l'âge et la régulation associée s'affichent sous cet équipement."><span>Production</span></Tooltip>
          </th>
          <th class="text-left px-2 py-2 w-56">
            <Tooltip text="Équipement qui transporte l'énergie de la production aux émetteurs : pompes, AHU… Laisser vide si pas de distribution séparée (DRV, poêle)."><span>Distribution</span></Tooltip>
          </th>
          <th class="text-left px-2 py-2 w-56">
            <Tooltip text="Équipement qui restitue l'énergie dans la zone : radiateurs, ventilo-convecteurs, unités intérieures DRV, plancher chauffant…"><span>Émission</span></Tooltip>
          </th>
          <th class="text-center py-2 w-24">
            <Tooltip text="Appareil indépendant de chauffage au bois (poêle, insert, cheminée fermée) → exempté de R175-6 (II du décret). Non applicable au refroidissement."><span>Exempté bois</span></Tooltip>
          </th>
          <th class="text-center px-3 py-2 w-24">Notes</th>
        </tr>
      </thead>
      <tbody v-for="t in thermalFiltered" :key="t.id"
             :data-id="t.id"
             class="thermal-row divide-y divide-gray-100 border-b border-gray-100">
        <tr class="hover:bg-gray-50/40">
          <td class="text-center align-middle">
            <button type="button"
                    class="drag-handle inline-flex p-1 text-gray-300 hover:text-gray-600 cursor-grab active:cursor-grabbing"
                    title="Glisser pour réordonner">
              <Bars3Icon class="w-4 h-4" />
            </button>
          </td>
          <td class="px-3 py-2 text-gray-700 text-center align-top">{{ t.zone_name }}</td>
          <td class="py-2 text-center align-top">
            <span class="inline-flex items-center gap-1.5 justify-center text-xs font-medium"
                  :class="(t.category || 'heating') === 'heating' ? 'text-red-600' : 'text-cyan-600'">
              <SystemCategoryIcon :category="t.category || 'heating'" size="sm" />
              {{ (t.category || 'heating') === 'heating' ? 'Chauffage' : 'Refroidissement' }}
            </span>
          </td>
          <td class="py-2 text-center align-top">
            <input type="checkbox" :checked="!!t.has_automatic_regulation"
                   @change="e => patchThermal(t, { has_automatic_regulation: e.target.checked })"
                   class="rounded border-gray-300" />
          </td>
          <td class="py-2 px-1 align-top">
            <SearchableSelect
              :model-value="t.regulation_type"
              @update:modelValue="v => patchThermal(t, { regulation_type: v || null })"
              :options="(regulationOptions || []).filter(o => o.value)"
              size="sm" placeholder="— granularité"
              search-placeholder="Filtrer ou ajouter…" />
          </td>
          <!-- Production : équipement + (si rempli) type, âge et régulation -->
          <td class="py-2 px-2 align-top">
            <SearchableSelect
              :model-value="t.generator_device_id"
              @update:modelValue="v => patchThermal(t, { generator_device_id: v != null ? parseInt(v, 10) : null })"
              :options="deviceOptionsForRow(t)"
              size="sm" placeholder="— aucun"
              search-placeholder="Rechercher un équipement…" />
            <div v-if="t.generator_device_id" class="mt-1.5 space-y-1.5">
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
              <SearchableSelect
                :model-value="t.production_regulation"
                @update:modelValue="v => patchThermal(t, { production_regulation: v || null })"
                :options="PRODUCTION_REGULATION_OPTIONS"
                creatable size="sm" placeholder="Régulation production…"
                search-placeholder="Filtrer ou ajouter…" />
            </div>
          </td>
          <!-- Distribution : équipement + (si rempli) régulation -->
          <td class="py-2 px-2 align-top">
            <SearchableSelect
              :model-value="t.distribution_device_id"
              @update:modelValue="v => patchThermal(t, { distribution_device_id: v != null ? parseInt(v, 10) : null })"
              :options="deviceOptionsForRow(t)"
              size="sm" placeholder="— aucune"
              search-placeholder="Rechercher un équipement…" />
            <div v-if="t.distribution_device_id" class="mt-1.5">
              <SearchableSelect
                :model-value="t.distribution_regulation"
                @update:modelValue="v => patchThermal(t, { distribution_regulation: v || null })"
                :options="DISTRIBUTION_REGULATION_OPTIONS"
                creatable size="sm" placeholder="Régulation distribution…"
                search-placeholder="Filtrer ou ajouter…" />
            </div>
          </td>
          <!-- Émission : équipement + (si rempli) régulation -->
          <td class="py-2 px-2 align-top">
            <SearchableSelect
              :model-value="t.emission_device_id"
              @update:modelValue="v => patchThermal(t, { emission_device_id: v != null ? parseInt(v, 10) : null })"
              :options="deviceOptionsForRow(t)"
              size="sm" placeholder="— aucun"
              search-placeholder="Rechercher un équipement…" />
            <div v-if="t.emission_device_id" class="mt-1.5">
              <SearchableSelect
                :model-value="t.emission_regulation"
                @update:modelValue="v => patchThermal(t, { emission_regulation: v || null })"
                :options="EMISSION_REGULATION_OPTIONS"
                creatable size="sm" placeholder="Régulation émission…"
                search-placeholder="Filtrer ou ajouter…" />
            </div>
          </td>
          <td class="py-2 text-center align-top">
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
          <td class="px-5 py-2 text-center">
            <button type="button"
                    @click="emit('open-notes', {
                      title: 'Notes régulation thermique',
                      contextLabel: t.zone_name + ' — ' + ((t.category || 'heating') === 'heating' ? 'Chauffage' : 'Refroidissement'),
                      entityType: 'thermal',
                      entityRef: t,
                      currentHtml: t.notes_html || t.notes || '',
                    })"
                    :class="['inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border transition',
                      hasNotes(t.notes_html || t.notes)
                        ? 'border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                        : 'border-gray-200 text-gray-500 bg-white hover:border-gray-300 hover:text-gray-700']"
                    :title="hasNotes(t.notes_html || t.notes) ? 'Modifier les notes' : 'Ajouter une note'">
              <PencilSquareIcon class="w-3.5 h-3.5" />
              {{ hasNotes(t.notes_html || t.notes) ? 'Notes' : '+ Notes' }}
            </button>
          </td>
        </tr>
        <!-- Détail R175-6 — placé directement sous sa ligne parent pour
             que l'utilisateur sache à quelle zone/usage ça se rapporte.
             Affiché uniquement si la régulation auto est cochée. Layout
             en flex compact avec labels inline (vs grid 3 cols qui faisait
             des champs trop larges et illisibles). -->
        <tr v-if="t.has_automatic_regulation" class="bg-amber-50/30 text-xs">
          <td colspan="10" class="px-5 py-2.5">
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
