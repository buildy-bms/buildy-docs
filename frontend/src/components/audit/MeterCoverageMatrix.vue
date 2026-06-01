<script setup>
// Matrice visuelle « Plan de comptage » : grille zones × énergies.
// Pour chaque
// intersection, on affiche les compteurs qui correspondent sous forme
// de pills colorées (réutilise MeterUsagePill / MeterTypePill).
//
// Le rôle de cette matrice est purement « scan » : on voit d'un coup
// d'œil la couverture du plan de comptage, et l'auditeur ouvre le détail
// d'un compteur (= scroll/highlight de la section détaillée plus bas)
// par clic. Les cellules vides exposent un mini « + » au survol pour
// ajouter un compteur avec zone et énergie pré-remplies.
import { computed } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
import { METER_TYPES, getMeterUsageMeta } from '@/lib/meter-options'

const props = defineProps({
  meters: { type: Array, required: true },
  zones: { type: Array, required: true },
  systems: { type: Array, default: () => [] },
})

// Mapping usage compteur → system_category(s) du système bacs correspondant.
const METER_USAGE_TO_SYSTEM_CATS = {
  heating: ['heating'],
  cooling: ['cooling'],
  dhw: ['dhw'],
  pv: ['electricity_production'],
  lighting: ['lighting_indoor', 'lighting_outdoor'],
}
function systemNameForMeter(m) {
  if (!m || m.zone_id == null) return null
  const cats = METER_USAGE_TO_SYSTEM_CATS[m.usage] || []
  if (!cats.length) return null
  const names = props.systems
    .filter(s => s.zone_id === m.zone_id && cats.includes(s.system_category)
      && s.custom_label && s.custom_label.trim())
    .map(s => s.custom_label.trim())
  return names.length ? names.join(' / ') : null
}
const emit = defineEmits(['cell-click', 'add-meter'])

// Zones triées : Général (zone_id null) en premier, puis fonctionnelles,
// puis techniques. On masque les zones qui n'ont AUCUN compteur (sinon la
// matrice se remplit de lignes vides pour les locaux techniques sans
// comptage). Le « Compteur général » reste toujours affiché car c'est
// le point d'entrée naturel pour ajouter un compteur de tête.
const orderedZones = computed(() => {
  const occupiedZoneIds = new Set(
    (props.meters || []).map(m => m.zone_id ?? null),
  )
  const keep = (z) => occupiedZoneIds.has(z.zone_id) || z.kind === 'general'
  const fnal = []
  const tech = []
  for (const z of (props.zones || [])) {
    if ((z.kind || 'functional') === 'technical') tech.push(z)
    else fnal.push(z)
  }
  return [
    { zone_id: null, name: 'Compteur général', kind: 'general' },
    ...fnal.filter(keep),
    ...tech.filter(keep),
  ]
})

// Mode « énergie » : pour chaque zone × chaque énergie, liste les compteurs.
// Énergies présentes au moins une fois dans l'audit : utilisé pour
// distinguer visuellement (couleur normale vs grisée) les colonnes qui
// n'ont aucun compteur. L'auditeur peut quand même ajouter un compteur
// dans une colonne grisée via le bouton « + » au hover.
const energiesUsed = computed(() => {
  const seen = new Set((props.meters || []).map(m => m.meter_type))
  return seen
})
function isEnergyUsed(value) {
  return energiesUsed.value.has(value)
}

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

// État d'une cellule pour le code couleur global (légende).
function cellState(meters) {
  if (!meters.length) return 'empty'
  if (meters.some(m => m.required && !m.present_actual && !m.out_of_service)) return 'missing'
  if (meters.some(m => m.present_actual)) return 'present'
  return 'neutral'
}

// État d'un compteur individuel pour le style du badge / chip.
//   present : présent physiquement (= « rempli »)
//   missing : requis mais pas présent (= « à faire », style contour)
//   hs      : hors service (= grisé)
//   neutral : tout autre cas (compteur déclaré mais ni présent ni HS)
function meterState(m) {
  if (m.out_of_service) return 'hs'
  if (m.present_actual) return 'present'
  if (m.required) return 'missing'
  return 'neutral'
}

// Style inline pour un badge / chip selon l'état + la couleur de base.
// Présent → fond pastel coloré (= rempli, vif)
// Manquant → fond pastel coloré + dot rouge en absolute (cf. template)
// HS → grisé
// Neutre → fond gris très pâle (= déclaré mais pas répondu)
function meterStyle(m, color) {
  const state = meterState(m)
  if (state === 'present') return { background: color + '1a', color, border: '1px solid transparent' }
  if (state === 'missing') return { background: color + '1a', color, border: '1px solid transparent' }
  if (state === 'hs') return { background: '#f3f4f6', color: '#9ca3af', border: '1px solid transparent' }
  return { background: '#f9fafb', color: '#6b7280', border: `1px solid ${color}33` }
}

// Dot d'état affiché en haut-droite du badge : vert si présent, rouge
// si requis manquant, noir si hors service. Rien sinon (état neutre).
function statusDotClass(m) {
  const s = meterState(m)
  if (s === 'present') return 'bg-emerald-500'
  if (s === 'missing') return 'bg-red-500'
  if (s === 'hs') return 'bg-gray-900'
  return null
}

function onCellClick(meter) {
  if (meter?.id != null) emit('cell-click', meter)
}

// Helper de rendu : pour un compteur donné, on récupère le pictogramme
// à afficher dans la cellule (zone × énergie).
//   - Compteur en zone : icône de l'usage (chauffage, clim, ECS…)
//   - Compteur général (zone_id null) : icône de l'énergie de la colonne
//     (la notion d'usage n'a pas de sens pour un compteur de tête de site,
//     ce qui compte c'est l'énergie comptée).
function cellBadge(meter, energy) {
  if (!meter.zone_id) {
    return { icon: energy.icon, color: energy.color, label: 'Compteur général ' + energy.label.toLowerCase() }
  }
  return getMeterUsageMeta(meter.usage) || { icon: 'fa-circle-question', color: '#6b7280', label: meter.usage || 'Autre' }
}
function badgeTitle(meter, meta) {
  const parts = []
  if (meta?.label) parts.push(meta.label)
  if (meter.zone_name) parts.push(meter.zone_name)
  const sysName = systemNameForMeter(meter)
  if (sysName) parts.push(sysName)
  if (meter.required && !meter.present_actual && !meter.out_of_service) parts.push('Requis manquant')
  if (meter.out_of_service) parts.push('Hors service')
  return parts.join(' · ')
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
    <div class="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
      <FontAwesomeIcon :icon="['fas', 'gauge']" class="w-4 h-4 text-emerald-600 shrink-0" />
      <h3 class="text-sm font-semibold text-gray-800">Plan de comptage</h3>
      <span class="text-xs text-gray-500">— vue d'ensemble de la couverture</span>
    </div>

    <!-- Lignes = zones, colonnes = énergies (lecture physique du site) -->
    <div class="overflow-x-auto">
      <table class="meter-matrix w-full text-sm">
        <thead>
          <tr>
            <th class="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2 bg-gray-50">
              Zone
            </th>
            <th v-for="et in METER_TYPES" :key="et.value"
                :class="['px-2 py-2 text-center',
                         isEnergyUsed(et.value) ? 'bg-gray-50' : 'bg-gray-100/50']">
              <div :class="['inline-flex items-center gap-1.5 text-xs font-semibold',
                            isEnergyUsed(et.value) ? 'text-gray-700' : 'text-gray-400']">
                <span class="w-5 h-5 rounded-md inline-flex items-center justify-center"
                      :style="isEnergyUsed(et.value)
                        ? { background: et.color + '1a', color: et.color }
                        : { background: '#f3f4f6', color: '#9ca3af' }">
                  <FontAwesomeIcon :icon="['fas', et.icon.replace(/^fa-/, '')]" class="w-3 h-3" />
                </span>
                <span>{{ et.label }}</span>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, idx) in matrixByEnergy" :key="row.zone.zone_id || '__general'"
              :class="row.zone.kind === 'general' ? 'bg-gray-50/60' : (idx % 2 ? 'bg-gray-50/40' : 'bg-white')">
            <td class="px-3 py-2 align-middle whitespace-nowrap">
              <span class="inline-flex items-center gap-2">
                <FontAwesomeIcon v-if="row.zone.kind === 'general'"
                                 :icon="['fas', 'building-circle-arrow-right']"
                                 class="w-4 h-4 text-gray-500" />
                <span class="text-sm font-medium text-gray-800">{{ row.zone.name }}</span>
                <span v-if="row.zone.kind === 'technical'"
                      class="ml-0.5 text-xs text-gray-400">(technique)</span>
              </span>
            </td>
            <td v-for="cell in row.cells" :key="(row.zone.zone_id || 0) + '-' + cell.energy.value"
                :class="['px-2 py-1.5 align-middle text-center group',
                         !isEnergyUsed(cell.energy.value) ? 'bg-gray-50/40' : '']">
              <div v-if="cell.meters.length" class="inline-flex flex-wrap items-center justify-center gap-1.5">
                <button v-for="m in cell.meters" :key="m.id"
                        type="button"
                        @click="onCellClick(m)"
                        class="relative w-7 h-7 rounded-lg inline-flex items-center justify-center transition hover:scale-110"
                        :style="meterStyle(m, cellBadge(m, cell.energy).color)"
                        v-tooltip="badgeTitle(m, cellBadge(m, cell.energy))">
                  <FontAwesomeIcon :icon="['fas', cellBadge(m, cell.energy).icon.replace(/^fa-/, '')]" class="w-4 h-4" />
                  <span v-if="statusDotClass(m)"
                        :class="['absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white', statusDotClass(m)]"
                        aria-hidden="true"></span>
                </button>
              </div>
              <button v-else type="button"
                      @click="onAddInCell({ zone: row.zone, energy: cell.energy })"
                      class="opacity-0 group-hover:opacity-30 hover:opacity-100! w-5 h-5 inline-flex items-center justify-center rounded text-gray-300 hover:text-indigo-600 transition"
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

    <!-- Légende compacte -->
    <div class="px-4 py-2 border-t border-gray-100 bg-gray-50/40 flex items-center gap-4 text-xs text-gray-500 flex-wrap">
      <span class="inline-flex items-center gap-1.5">
        <span class="relative inline-block w-3 h-3 rounded bg-gray-200">
          <span class="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-white"></span>
        </span>
        Présent
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span class="relative inline-block w-3 h-3 rounded bg-gray-200">
          <span class="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 border border-white"></span>
        </span>
        Requis manquant
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span class="relative inline-block w-3 h-3 rounded bg-gray-200">
          <span class="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-gray-900 border border-white"></span>
        </span>
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
