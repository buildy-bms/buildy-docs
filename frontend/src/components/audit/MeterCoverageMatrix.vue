<script setup>
// Matrice visuelle « Plan de comptage » : grille (zones × énergies) ou
// (usages × zones) selon le pivot choisi par l'auditeur. Pour chaque
// intersection, on affiche les compteurs qui correspondent sous forme
// de pills colorées (réutilise MeterUsagePill / MeterTypePill).
//
// Le rôle de cette matrice est purement « scan » : on voit d'un coup
// d'œil la couverture du plan de comptage, et l'auditeur ouvre le détail
// d'un compteur (= scroll/highlight de la section détaillée plus bas)
// par clic. Les cellules vides exposent un mini « + » au survol pour
// ajouter un compteur avec zone et énergie pré-remplies.
import { computed, ref, onMounted } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
import MeterTypePill from '@/components/MeterTypePill.vue'
import MeterUsagePill from '@/components/MeterUsagePill.vue'
import { METER_TYPES, METER_USAGES } from '@/lib/meter-options'

const props = defineProps({
  meters: { type: Array, required: true },
  zones: { type: Array, required: true },
})
const emit = defineEmits(['cell-click', 'add-meter'])

// Toggle « Par énergie » (= rows zones, cols énergies) / « Par zone »
// (= rows usages, cols zones). Persistance localStorage pour cohérence
// avec la PWA (qui utilise déjà 'audit.meters.groupBy').
const PIVOT_KEY = 'audit.meters.matrix.pivot'
const pivot = ref('energy') // 'energy' | 'zone'
onMounted(() => {
  try {
    const v = window.localStorage.getItem(PIVOT_KEY)
    if (v === 'energy' || v === 'zone') pivot.value = v
  } catch { /* indispo */ }
})
function setPivot(v) {
  pivot.value = v
  try { window.localStorage.setItem(PIVOT_KEY, v) } catch { /* indispo */ }
}

// Zones triées : Général (zone_id null) en premier, puis fonctionnelles,
// puis techniques. On garde l'ordre déclaré dans le store pour les vraies
// zones (pas d'alphabétique).
const orderedZones = computed(() => {
  const fnal = []
  const tech = []
  for (const z of (props.zones || [])) {
    if ((z.kind || 'functional') === 'technical') tech.push(z)
    else fnal.push(z)
  }
  return [
    { zone_id: null, name: 'Compteur général', kind: 'general' },
    ...fnal,
    ...tech,
  ]
})

// Mode « énergie » : pour chaque zone × chaque énergie, liste les compteurs.
const matrixByEnergy = computed(() => {
  const rows = []
  for (const z of orderedZones.value) {
    const cells = METER_TYPES.map(et => {
      const items = (props.meters || []).filter(m =>
        (m.zone_id || null) === (z.zone_id || null) && m.meter_type === et.value,
      )
      return { energy: et, meters: items }
    })
    rows.push({ zone: z, cells })
  }
  return rows
})

// Mode « zone » : pour chaque usage × chaque zone, liste les compteurs.
// Les usages sans aucun compteur sont masqués pour éviter le bruit.
const usagesWithData = computed(() => {
  const seen = new Set((props.meters || []).map(m => m.usage || 'other'))
  return METER_USAGES.filter(u => seen.has(u.value))
})
const matrixByZone = computed(() => {
  const rows = []
  for (const u of usagesWithData.value) {
    const cells = orderedZones.value.map(z => {
      const items = (props.meters || []).filter(m =>
        (m.usage || 'other') === u.value && (m.zone_id || null) === (z.zone_id || null),
      )
      return { zone: z, meters: items }
    })
    rows.push({ usage: u, cells })
  }
  return rows
})

// État d'une cellule pour le code couleur.
//   missing : ≥ 1 compteur required mais non présent et non HS → rouge
//   present : ≥ 1 compteur présent → vert
//   neutral : compteur présent mais marqué « non requis » → gris léger
//   empty   : aucun compteur (placeholder « + »)
function cellState(meters) {
  if (!meters.length) return 'empty'
  if (meters.some(m => m.required && !m.present_actual && !m.out_of_service)) return 'missing'
  if (meters.some(m => m.present_actual)) return 'present'
  return 'neutral'
}

function onCellClick(meter) {
  if (meter?.id != null) emit('cell-click', meter)
}
function onAddInCell({ zone, energy, usage }) {
  emit('add-meter', {
    zone_id: zone?.zone_id ?? null,
    meter_type: energy?.value || null,
    usage: usage?.value || null,
  })
}
</script>

<template>
  <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
    <!-- Header de la matrice -->
    <div class="px-4 py-3 border-b border-gray-200 flex items-center gap-3 flex-wrap">
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <FontAwesomeIcon :icon="['fas', 'gauge']" class="w-4 h-4 text-emerald-600" />
        <h3 class="text-sm font-semibold text-gray-800">Plan de comptage</h3>
        <span class="text-xs text-gray-500">— vue d'ensemble de la couverture</span>
      </div>
      <!-- Toggle pivot (cohérent avec la PWA) -->
      <div class="inline-flex p-1 bg-gray-100 rounded-lg gap-0.5">
        <button type="button" @click="setPivot('energy')"
                :class="['px-3 py-1.5 text-xs font-medium rounded-md transition',
                         pivot === 'energy' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900']">
          Par énergie
        </button>
        <button type="button" @click="setPivot('zone')"
                :class="['px-3 py-1.5 text-xs font-medium rounded-md transition',
                         pivot === 'zone' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900']">
          Par zone
        </button>
      </div>
    </div>

    <!-- Mode énergie : lignes = zones, colonnes = énergies -->
    <div v-if="pivot === 'energy'" class="overflow-x-auto">
      <table class="meter-matrix w-full text-sm">
        <thead>
          <tr>
            <th class="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2 bg-gray-50">
              Zone
            </th>
            <th v-for="et in METER_TYPES" :key="et.value"
                class="px-2 py-2 bg-gray-50 text-center">
              <div class="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700">
                <span class="w-5 h-5 rounded-md inline-flex items-center justify-center"
                      :style="{ background: et.color + '1a', color: et.color }">
                  <FontAwesomeIcon :icon="['fas', et.icon.replace(/^fa-/, '')]" class="w-3 h-3" />
                </span>
                <span>{{ et.label }}</span>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in matrixByEnergy" :key="row.zone.zone_id || '__general'"
              :class="row.zone.kind === 'general' ? 'bg-gray-50/60' : ''">
            <td class="px-3 py-2 align-middle whitespace-nowrap">
              <span class="text-sm font-medium text-gray-800">{{ row.zone.name }}</span>
              <span v-if="row.zone.kind === 'technical'"
                    class="ml-1.5 text-xs text-gray-400">(technique)</span>
            </td>
            <td v-for="cell in row.cells" :key="(row.zone.zone_id || 0) + '-' + cell.energy.value"
                class="px-2 py-1.5 align-middle text-center group">
              <div v-if="cell.meters.length" class="inline-flex flex-wrap items-center justify-center gap-1">
                <button v-for="m in cell.meters" :key="m.id"
                        type="button"
                        @click="onCellClick(m)"
                        :class="['inline-flex items-center px-0.5 py-0.5 rounded-md transition',
                                 cellState([m]) === 'missing' ? 'ring-1 ring-red-300 ring-offset-1' : '',
                                 cellState([m]) === 'present' ? '' : '',
                                 m.out_of_service ? 'opacity-50' : '']"
                        :title="(m.zone_name || 'Général') + ' — ' + (m.usage || '')">
                  <MeterUsagePill :usage="m.usage" />
                </button>
              </div>
              <button v-else type="button"
                      @click="onAddInCell({ zone: row.zone, energy: cell.energy })"
                      class="opacity-0 group-hover:opacity-100 w-6 h-6 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition"
                      v-tooltip="`Ajouter un compteur ${cell.energy.label.toLowerCase()} en zone ${row.zone.name}`">
                <FontAwesomeIcon :icon="['fas', 'plus']" class="w-3 h-3" />
              </button>
            </td>
          </tr>
          <tr v-if="!matrixByEnergy.length">
            <td :colspan="METER_TYPES.length + 1" class="px-3 py-6 text-center text-xs text-gray-500">
              Crée d'abord des zones — la matrice apparaîtra ensuite.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Mode zone : lignes = usages, colonnes = zones -->
    <div v-else class="overflow-x-auto">
      <table class="meter-matrix w-full text-sm">
        <thead>
          <tr>
            <th class="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2 bg-gray-50">
              Usage
            </th>
            <th v-for="z in orderedZones" :key="z.zone_id || '__general'"
                class="px-2 py-2 bg-gray-50 text-center text-xs font-semibold text-gray-700 whitespace-nowrap">
              <span :class="z.kind === 'general' ? 'text-gray-600' : z.kind === 'technical' ? 'text-slate-500' : 'text-gray-700'">
                {{ z.name }}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in matrixByZone" :key="row.usage.value">
            <td class="px-3 py-2 align-middle whitespace-nowrap">
              <div class="inline-flex items-center gap-2">
                <span class="w-6 h-6 rounded-md inline-flex items-center justify-center"
                      :style="{ background: row.usage.color + '1a', color: row.usage.color }">
                  <FontAwesomeIcon :icon="['fas', row.usage.icon.replace(/^fa-/, '')]" class="w-3.5 h-3.5" />
                </span>
                <span class="text-sm font-medium text-gray-800">{{ row.usage.label }}</span>
              </div>
            </td>
            <td v-for="cell in row.cells" :key="row.usage.value + '-' + (cell.zone.zone_id || 0)"
                :class="['px-2 py-1.5 align-middle text-center group',
                         cell.zone.kind === 'general' ? 'bg-gray-50/60' : '']">
              <div v-if="cell.meters.length" class="inline-flex flex-wrap items-center justify-center gap-1">
                <button v-for="m in cell.meters" :key="m.id"
                        type="button"
                        @click="onCellClick(m)"
                        :class="['inline-flex items-center px-0.5 py-0.5 rounded-md transition',
                                 cellState([m]) === 'missing' ? 'ring-1 ring-red-300 ring-offset-1' : '',
                                 m.out_of_service ? 'opacity-50' : '']"
                        :title="(m.zone_name || 'Général') + ' — ' + (m.meter_type || '')">
                  <MeterTypePill :type="m.meter_type" />
                </button>
              </div>
              <button v-else type="button"
                      @click="onAddInCell({ zone: cell.zone, usage: row.usage })"
                      class="opacity-0 group-hover:opacity-100 w-6 h-6 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition"
                      v-tooltip="`Ajouter un compteur ${row.usage.label.toLowerCase()} en zone ${cell.zone.name}`">
                <FontAwesomeIcon :icon="['fas', 'plus']" class="w-3 h-3" />
              </button>
            </td>
          </tr>
          <tr v-if="!matrixByZone.length">
            <td :colspan="orderedZones.length + 1" class="px-3 py-6 text-center text-xs text-gray-500">
              Aucun compteur — ajoute-en pour voir apparaître le plan de comptage par zone.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Légende compacte -->
    <div class="px-4 py-2 border-t border-gray-100 bg-gray-50/40 flex items-center gap-4 text-xs text-gray-500 flex-wrap">
      <span class="inline-flex items-center gap-1.5">
        <span class="w-3 h-3 rounded ring-1 ring-red-300 ring-offset-1 bg-white"></span>
        Requis manquant
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span class="w-3 h-3 rounded bg-gray-300 opacity-50"></span>
        Hors service
      </span>
      <span class="text-gray-400">Clic sur un compteur pour ouvrir son détail</span>
    </div>
  </div>
</template>

<style scoped>
.meter-matrix {
  border-collapse: separate;
  border-spacing: 0;
}
.meter-matrix th,
.meter-matrix td {
  border-bottom: 1px solid #f3f4f6;
}
.meter-matrix tbody tr:last-child td {
  border-bottom: none;
}
</style>
