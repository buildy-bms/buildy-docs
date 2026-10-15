<script setup>
/**
 * Tableau de présence des usages (étape Systèmes, page audit à onglets).
 * Lignes = zones, colonnes = usages BACS (+ « Autres » pour les usages hors
 * décret). Chaque case :
 *  - ✓ / ✗ = Présent / Non concerné (répond directement, 1 clic) ;
 *  - pastille = nombre d'équipements (propres + partagés), point ambré s'il
 *    reste quelque chose à faire (usage présent sans équipement, équipement
 *    incomplet) ; un clic ouvre la zone sur cet usage ;
 *  - « + » : pas d'usage de ce type dans la zone (zones techniques…) ;
 *    un clic ouvre « Ajouter un système » pré-rempli.
 * Plusieurs systèmes du même usage dans une zone : pas de ✓/✗ agrégé
 * (on répond dans la liste), la pastille donne le total.
 */
import { computed, ref } from 'vue'
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import CompactToggle from '@/components/SegmentedToggle.vue'
import HelpTip from '@/components/HelpTip.vue'
import { isDeviceComplete } from '@/lib/audit-options'
import {
  PRESENCE_TOGGLE_TIP, PRESENCE_ZONE_LABEL, PRESENCE_OTHER_COLUMN_TIP, PRESENCE_LEGEND_TIP, TECHNICAL_ZONE_TIP,
  presenceCellTip, presenceAddTip,
} from '@/lib/audit-tips-systems'
import {
  synthesisTotals, zoneTodoParts, RESUME_ALL_LABEL, RESUME_ALL_TIP, TODO_COLUMN_TIP, CHECK_CELL_TIP,
} from '@/lib/audit-tips-systems-guide'

// Couleurs des totaux et de la colonne « Reste à faire ».
const TOTAL_TONE = {
  amber: 'bg-amber-50 ring-amber-300 text-amber-900',
  rose: 'bg-rose-50 ring-rose-200 text-rose-800',
  dashed: 'bg-white ring-0 border border-dashed border-slate-500 text-slate-700',
}
const PART_TONE = { amber: 'text-amber-800', rose: 'text-rose-700', slate: 'text-slate-600', green: 'text-emerald-700' }

const props = defineProps({
  groups: { type: Array, required: true },            // systemsByZone (vue)
  devicesBySystem: { type: Object, required: true },
  allDevices: { type: Array, default: () => [] },     // équipements partagés
  activeZoneId: { type: [Number, String], default: null },
  // Faux dans l'onglet « Synthèse des systèmes » : le tableau en est le contenu,
  // toujours affiché (pas de « Masquer le tableau »), plus haut avant de défiler.
  collapsible: { type: Boolean, default: true },
  // { byZone: { [zoneId]: zoneGuide() }, totals: guideTotals(), checkCells: Set('zoneId:catégorie'),
  // stops: nombre de points à reprendre } : totaux, « Reprendre le parcours », colonne « Reste à
  // faire » et repère « ! ».
  guide: { type: Object, required: true },
})
const emit = defineEmits(['select', 'set-presence', 'add-system', 'resume'])

const COLUMNS = [
  { cat: 'heating', label: 'Chauffage' },
  { cat: 'cooling', label: 'Refroid.', full: 'Refroidissement' },
  { cat: 'ventilation', label: 'Ventilation' },
  { cat: 'dhw', label: 'ECS', full: 'Eau chaude sanitaire' },
  { cat: 'lighting_indoor', label: 'Écl. int.', full: 'Éclairage intérieur' },
  { cat: 'lighting_outdoor', label: 'Écl. ext.', full: 'Éclairage extérieur' },
  { cat: 'electricity_production', label: 'PV', full: 'Production photovoltaïque' },
  { cat: '__other', label: 'Autres', full: 'Autres usages' },
]

// En-tête : nom complet d'une colonne abrégée ; « Autres » a sa carte (usages hors décret).
function columnTip(col) {
  if (col.cat === '__other') return PRESENCE_OTHER_COLUMN_TIP
  return col.full || null
}

// Tableau replié / déplié (mémorisé, tous audits).
const COLLAPSE_KEY = 'bacs-systems-matrix-collapsed'
const collapsed = ref((() => { try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false } })())
function toggleCollapsed() {
  collapsed.value = !collapsed.value
  try { localStorage.setItem(COLLAPSE_KEY, collapsed.value ? '1' : '0') } catch { /* navigation privée */ }
}

function devicesOf(s) {
  const own = props.devicesBySystem[s.id] || []
  const shared = props.allDevices.filter(d =>
    d.system_id !== s.id && (d.extra_system_ids || []).includes(s.id))
  return [...own, ...shared]
}

function cellFor(g, col) {
  const systems = col.cat === '__other'
    ? g.items.filter(s => !s.is_bacs)
    : g.items.filter(s => s.is_bacs && s.system_category === col.cat)
  if (!systems.length) return { kind: 'none' }
  const present = systems.filter(s => s.present)
  const count = present.reduce((n, s) => n + devicesOf(s).length, 0)
  const incomplete = present.reduce((n, s) =>
    n + (props.devicesBySystem[s.id] || []).filter(d => !isDeviceComplete(d, s.system_category)).length, 0)
  const withoutDevice = present.filter(s => !devicesOf(s).length).length
  const unanswered = systems.filter(s => !s.present && !s.not_concerned).length
  const base = { systems, count, incomplete, withoutDevice, unanswered, warn: incomplete > 0 || withoutDevice > 0 }
  if (systems.length === 1 && col.cat !== '__other') {
    const s = systems[0]
    return { ...base, kind: 'single', system: s, state: s.not_concerned ? false : (s.present ? true : null) }
  }
  return { ...base, kind: 'multi', anyPresent: present.length > 0 }
}

const rows = computed(() => props.groups.map(g => ({
  g,
  cells: COLUMNS.map(col => ({ col, cell: cellFor(g, col) })),
})))

// Carte d'une case (lib/audit-tips-systems.js) : réponse, équipements, ce qui reste à reprendre.
function cellTip(g, col, cell) {
  return presenceCellTip({
    zone: g.zone_name || 'Zone sans nom',
    usage: col.full || col.label,
    category: col.cat,
    kind: cell.kind,
    state: cell.state,
    systems: cell.systems.length,
    count: cell.count,
    withoutDevice: cell.withoutDevice,
    incomplete: cell.incomplete,
    unanswered: cell.unanswered,
  })
}

function setPresence(cell, v) {
  if (!cell.system) return
  emit('set-presence', { system: cell.system, value: v ? 'present' : 'not_concerned' })
}

const totals = computed(() => synthesisTotals(props.guide.totals || {}))
function hasCheck(g, col) { return !!props.guide.checkCells?.has(`${g.zone_id}:${col.cat}`) }
function todoParts(g) {
  const z = props.guide.byZone?.[g.zone_id]
  return z ? zoneTodoParts(z) : []
}
</script>

<template>
  <div class="rounded-xl border border-slate-200 bg-white overflow-hidden" data-systems-presence-matrix>
    <!-- Totaux de l'étape et reprise du parcours. -->
    <div class="flex items-center gap-3 px-4 py-3 border-b border-slate-100 flex-wrap" data-guide-totals>
      <h3 class="flex-1 min-w-[14rem] text-[15px] font-semibold text-indigo-600">Présence des usages par zone</h3>
      <div class="flex flex-wrap items-center gap-2">
        <span v-for="t in totals" :key="t.tone"
              :class="['inline-flex items-baseline gap-1.5 rounded-lg px-2.5 py-1 ring-1 ring-inset', TOTAL_TONE[t.tone]]"
              v-tooltip="t.tip">
          <span class="text-[15px] font-semibold">{{ t.value }}</span>
          <span class="text-xs">{{ t.label }}</span>
        </span>
      </div>
      <button v-if="guide.stops" type="button" @click="emit('resume')" v-tooltip="RESUME_ALL_TIP"
              class="inline-flex items-center rounded-lg bg-indigo-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-indigo-700 transition">
        {{ RESUME_ALL_LABEL }}
      </button>
    </div>
    <div class="flex items-center gap-3 px-3 py-2 border-b border-slate-100 flex-wrap">
      <div class="ml-auto flex items-center gap-3 text-[11px] text-gray-500">
        <span class="hidden xl:inline"><span class="font-bold text-emerald-700">✓</span> présent</span>
        <span class="hidden xl:inline"><span class="font-bold text-slate-600">✗</span> non concerné</span>
        <span class="hidden xl:inline-flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-amber-400"></span> à compléter</span>
        <span class="hidden xl:inline"><span class="font-bold text-rose-700">!</span> à vérifier</span>
        <span class="hidden xl:inline"><span class="inline-block rounded border border-dashed border-slate-500 px-1">✓ ✗</span> sans réponse</span>
        <span class="hidden xl:inline"><span class="font-bold text-gray-400">+</span> absent de la zone (clic : ajouter)</span>
        <!-- Légende masquée sous 1280 px : un ⓘ l'ouvre en carte. -->
        <HelpTip class="xl:hidden" :tip="PRESENCE_LEGEND_TIP" />
        <button v-if="collapsible" type="button" @click="toggleCollapsed"
                class="text-gray-500 hover:text-gray-800 underline underline-offset-2">
          {{ collapsed ? 'Afficher le tableau' : 'Masquer le tableau' }}
        </button>
      </div>
    </div>
    <div v-show="!collapsible || !collapsed" :class="['overflow-auto', collapsible ? 'max-h-[360px]' : 'max-h-[70vh]']">
      <table class="w-full text-xs border-separate border-spacing-0">
        <thead>
          <tr>
            <th class="sticky top-0 z-10 bg-slate-50 text-left font-medium text-gray-600 px-3 py-2 border-b border-slate-200">Zone</th>
            <!-- Bulle sur les en-têtes abrégés seulement (nom complet) ; l'icône n'a pas la
                 sienne, pour que tout l'en-tête affiche la même. -->
            <th v-for="col in COLUMNS" :key="col.cat"
                class="sticky top-0 z-10 bg-slate-50 font-medium text-gray-600 px-2 py-2 border-b border-slate-200 whitespace-nowrap"
                v-tooltip="columnTip(col)">
              <span class="inline-flex items-center gap-1">
                <SystemCategoryIcon v-if="col.cat !== '__other'" :category="col.cat" size="sm" :with-tooltip="false" />
                {{ col.label }}
              </span>
            </th>
            <th class="sticky top-0 z-10 bg-slate-50 text-left font-medium text-gray-600 px-3 py-2 border-b border-slate-200 whitespace-nowrap"
                v-tooltip="TODO_COLUMN_TIP">Reste à faire</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.g.zone_id"
              :class="r.g.zone_id === activeZoneId ? 'bg-indigo-50' : 'hover:bg-slate-50'">
            <th scope="row" class="text-left font-normal px-3 py-1.5 border-b border-slate-100 whitespace-nowrap">
              <button type="button" @click="emit('select', { zoneId: r.g.zone_id })"
                      :class="['inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 -mx-1.5 transition',
                               r.g.zone_id === activeZoneId ? 'text-indigo-700 font-medium' : 'text-gray-800 hover:text-indigo-700']"
                      v-tooltip="PRESENCE_ZONE_LABEL">
                {{ r.g.zone_name || 'Zone sans nom' }}
                <span v-if="r.g.zone_kind === 'technical'" class="text-[10px] px-1 py-px rounded bg-slate-200 text-slate-600"
                      v-tooltip="TECHNICAL_ZONE_TIP">tech.</span>
              </button>
            </th>
            <td v-for="{ col, cell } in r.cells" :key="col.cat"
                class="px-1.5 py-1 border-b border-slate-100 text-center whitespace-nowrap"
                :data-matrix-cell="`${r.g.zone_id}:${col.cat}`">
              <!-- Usage absent de la zone (zones techniques, usage non prévu
                   pour cette nature de zone) : rien à cocher, mais on peut
                   l'ajouter (fenêtre « Ajouter un système » pré-remplie). -->
              <button v-if="cell.kind === 'none'" type="button"
                      @click="emit('add-system', { zoneId: r.g.zone_id, zoneName: r.g.zone_name, category: col.cat })"
                      class="inline-flex items-center justify-center w-6 h-[22px] rounded-md border border-dashed border-gray-300 text-gray-400 font-bold hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700 transition"
                      v-tooltip="presenceAddTip({ zone: r.g.zone_name || 'Zone sans nom', usage: col.full || col.label, technical: r.g.zone_kind === 'technical' })">
                +
              </button>
              <span v-else class="inline-flex items-center gap-1">
                <!-- Sans réponse = toggle en pointillés. -->
                <span v-if="cell.kind === 'single'"
                      :class="cell.state == null ? 'rounded-lg outline-1 outline-dashed outline-slate-500 outline-offset-1' : 'contents'">
                  <CompactToggle compact neutral-no size="xs"
                                 :model-value="cell.state"
                                 :tooltip="PRESENCE_TOGGLE_TIP"
                                 @update:model-value="v => setPresence(cell, v)" />
                </span>
                <button type="button"
                        @click="emit('select', { zoneId: r.g.zone_id, category: col.cat })"
                        v-tooltip="() => cellTip(r.g, col, cell)"
                        :class="['relative inline-flex items-center justify-center min-w-6 h-[22px] px-1.5 rounded-md text-[11px] font-medium transition',
                                 (cell.kind === 'single' ? cell.state === true : cell.anyPresent)
                                   ? 'bg-slate-100 text-slate-700 hover:bg-indigo-100 hover:text-indigo-800'
                                   : 'text-gray-300 hover:bg-slate-100 hover:text-gray-500']">
                  {{ (cell.kind === 'single' ? cell.state === true : cell.anyPresent) ? cell.count : (cell.systems.length > 1 ? `${cell.systems.length} s.` : '·') }}
                  <span v-if="cell.warn || (cell.kind === 'multi' && cell.unanswered)"
                        class="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-white"></span>
                </button>
                <span v-if="hasCheck(r.g, col)" class="text-[12px] font-bold leading-none text-rose-700"
                      v-tooltip="CHECK_CELL_TIP">!</span>
              </span>
            </td>
            <td class="px-3 py-1 border-b border-slate-100 whitespace-nowrap">
              <button type="button" @click="emit('select', { zoneId: r.g.zone_id })"
                      class="text-left text-xs hover:underline" v-tooltip="PRESENCE_ZONE_LABEL">
                <template v-for="(p, i) in todoParts(r.g)" :key="p.text">
                  <span v-if="i" class="text-slate-400">, </span><span :class="PART_TONE[p.tone]">{{ p.text }}</span>
                </template>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
