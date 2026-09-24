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
import { isDeviceComplete } from '@/lib/audit-options'

const props = defineProps({
  groups: { type: Array, required: true },            // systemsByZone (vue)
  devicesBySystem: { type: Object, required: true },
  allDevices: { type: Array, default: () => [] },     // équipements partagés
  activeZoneId: { type: [Number, String], default: null },
})
const emit = defineEmits(['select', 'set-presence', 'add-system'])

const COLUMNS = [
  { cat: 'heating', label: 'Chauffage' },
  { cat: 'cooling', label: 'Refroid.', full: 'Refroidissement' },
  { cat: 'ventilation', label: 'Ventilation' },
  { cat: 'dhw', label: 'ECS', full: 'Eau chaude sanitaire' },
  { cat: 'lighting_indoor', label: 'Écl. int.', full: 'Éclairage intérieur' },
  { cat: 'lighting_outdoor', label: 'Écl. ext.', full: 'Éclairage extérieur' },
  { cat: 'electricity_production', label: 'PV', full: 'Production photovoltaïque' },
  { cat: '__other', label: 'Autres', full: 'Usages hors décret (bornes de recharge, process…)' },
]

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

const summary = computed(() => {
  let unanswered = 0
  let toFix = 0
  for (const r of rows.value) {
    for (const { cell } of r.cells) {
      if (cell.kind === 'none') continue
      unanswered += cell.unanswered
      if (cell.warn) toFix++
    }
  }
  return { zones: rows.value.length, unanswered, toFix }
})

function cellTooltip(g, col, cell) {
  const name = col.full || col.label
  const parts = [`${g.zone_name} · ${name}`]
  if (cell.kind === 'single') {
    parts.push(cell.state === true ? 'Présent' : cell.state === false ? 'Non concerné' : 'Sans réponse (Présent / Non concerné ?)')
  } else if (cell.systems.length > 1) {
    parts.push(`${cell.systems.length} systèmes — réponds dans la liste de la zone`)
  }
  if (cell.count) parts.push(`${cell.count} équipement${cell.count > 1 ? 's' : ''}`)
  if (cell.withoutDevice) parts.push('Présent sans équipement saisi')
  if (cell.incomplete) parts.push(`${cell.incomplete} équipement${cell.incomplete > 1 ? 's' : ''} incomplet${cell.incomplete > 1 ? 's' : ''}`)
  parts.push('Clic sur le nombre : ouvrir cet usage')
  return parts.join('\n')
}

function setPresence(cell, v) {
  if (!cell.system) return
  emit('set-presence', { system: cell.system, value: v ? 'present' : 'not_concerned' })
}
</script>

<template>
  <div class="rounded-xl border border-slate-200 bg-white overflow-hidden" data-systems-presence-matrix>
    <div class="flex items-center gap-3 px-3 py-2 border-b border-slate-100 flex-wrap">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-700">Présence des usages par zone</h3>
      <span class="text-[11px] text-gray-500">
        {{ summary.zones }} zone{{ summary.zones > 1 ? 's' : '' }}
        <template v-if="summary.unanswered"> · <span class="text-amber-700">{{ summary.unanswered }} sans réponse</span></template>
        <template v-if="summary.toFix"> · <span class="text-amber-700">{{ summary.toFix }} à reprendre</span></template>
      </span>
      <div class="ml-auto flex items-center gap-3 text-[11px] text-gray-500">
        <span class="hidden xl:inline"><span class="font-bold text-emerald-700">✓</span> présent</span>
        <span class="hidden xl:inline"><span class="font-bold text-slate-600">✗</span> non concerné</span>
        <span class="hidden xl:inline-flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-amber-400"></span> à reprendre</span>
        <span class="hidden xl:inline"><span class="font-bold text-gray-400">+</span> absent de la zone (clic : ajouter)</span>
        <button type="button" @click="toggleCollapsed"
                class="text-gray-500 hover:text-gray-800 underline underline-offset-2">
          {{ collapsed ? 'Afficher le tableau' : 'Masquer le tableau' }}
        </button>
      </div>
    </div>
    <div v-show="!collapsed" class="overflow-auto max-h-[360px]">
      <table class="w-full text-xs border-separate border-spacing-0">
        <thead>
          <tr>
            <th class="sticky top-0 z-10 bg-slate-50 text-left font-medium text-gray-600 px-3 py-2 border-b border-slate-200">Zone</th>
            <th v-for="col in COLUMNS" :key="col.cat"
                class="sticky top-0 z-10 bg-slate-50 font-medium text-gray-600 px-2 py-2 border-b border-slate-200 whitespace-nowrap"
                v-tooltip="col.full || col.label">
              <span class="inline-flex items-center gap-1">
                <SystemCategoryIcon v-if="col.cat !== '__other'" :category="col.cat" size="sm" />
                {{ col.label }}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.g.zone_id"
              :class="r.g.zone_id === activeZoneId ? 'bg-indigo-50' : 'hover:bg-slate-50'">
            <th scope="row" class="text-left font-normal px-3 py-1.5 border-b border-slate-100 whitespace-nowrap">
              <button type="button" @click="emit('select', { zoneId: r.g.zone_id })"
                      :class="['inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 -mx-1.5 transition',
                               r.g.zone_id === activeZoneId ? 'text-indigo-700 font-medium' : 'text-gray-800 hover:text-indigo-700']"
                      v-tooltip="'Afficher les usages et équipements de cette zone'">
                {{ r.g.zone_name || 'Zone sans nom' }}
                <span v-if="r.g.zone_kind === 'technical'" class="text-[10px] px-1 py-px rounded bg-slate-200 text-slate-600">tech.</span>
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
                      v-tooltip="`Pas d'usage « ${col.full || col.label} » dans ${r.g.zone_name}${r.g.zone_kind === 'technical' ? ' (zone technique, hors décret BACS)' : ''}.\nCliquer pour l'ajouter.`">
                +
              </button>
              <span v-else class="inline-flex items-center gap-1">
                <CompactToggle v-if="cell.kind === 'single'" compact neutral-no size="xs"
                               :model-value="cell.state"
                               @update:model-value="v => setPresence(cell, v)" />
                <button type="button"
                        @click="emit('select', { zoneId: r.g.zone_id, category: col.cat })"
                        v-tooltip="cellTooltip(r.g, col, cell)"
                        :class="['relative inline-flex items-center justify-center min-w-6 h-[22px] px-1.5 rounded-md text-[11px] font-medium transition',
                                 (cell.kind === 'single' ? cell.state === true : cell.anyPresent)
                                   ? 'bg-slate-100 text-slate-700 hover:bg-indigo-100 hover:text-indigo-800'
                                   : 'text-gray-300 hover:bg-slate-100 hover:text-gray-500']">
                  {{ (cell.kind === 'single' ? cell.state === true : cell.anyPresent) ? cell.count : (cell.systems.length > 1 ? `${cell.systems.length} s.` : '·') }}
                  <span v-if="cell.warn || (cell.kind === 'multi' && cell.unanswered)"
                        class="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-white"></span>
                </button>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
