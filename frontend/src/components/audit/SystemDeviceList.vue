<script setup>
/**
 * Liste des équipements d'un système, en lecture (étape Systèmes, page audit
 * à onglets). Une ligne par équipement : nom (+ marque, référence,
 * localisation, âge dessous), fonctions, puissance, énergie, communication
 * (protocoles, liaison câblée à la GTB), régulation (intégrée / déportée,
 * type), état (complet / points à compléter). Communication et Régulation
 * n'apparaissent que si la liste est assez large (requêtes de conteneur).
 * Un clic ouvre la fiche de l'équipement (panneau à droite, tous les
 * champs).
 *
 * Ordre : Production → Distribution → Émission → Régulation, puis nom
 * (même règle que le tableau), avec « └─ » pour les équipements aval.
 * Les équipements partagés depuis un autre système sont listés (teinte verte)
 * ; on peut déposer une photo directement sur une ligne.
 *
 * Un seul en-tête de colonnes pour toute la zone (`header-only`), colonne État réduite aux exceptions (à compléter, à vérifier ; un simple ✓
 * sinon), lignes « à vérifier » marquées, puissance manquante signalée, filtre
 * (`filter` : all | todo | check) et version compacte (`compact` : nom et état, fiche ouverte).
 */
import { computed } from 'vue'
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { faPlus, faShieldExclamation } from '@fortawesome/pro-solid-svg-icons'
import '@/lib/equipment-icons'
import PhotoDropzone from '@/components/PhotoDropzone.vue'
import { useAuditStore } from '@/stores/audit'
import {
  ENERGY_OPTIONS, ROLE_OPTIONS, COMM_OPTIONS, deviceMissingFields, deviceMissingItems, isDeviceComplete,
  deviceRoleAllowsEnergySource, regulationTypesForCategory,
} from '@/lib/audit-options'
import {
  DEVICE_COLUMN_TIPS, DEVICE_ROW_LABEL, DEVICE_BACKUP_TIP, DEVICE_OUT_OF_SERVICE_TIP, DEVICE_ROLE_MISSING_TIP,
  DEVICE_COMM_TIPS, DEVICE_WIRED_TIPS, roleTip, deviceStatusTip, deviceQuantityTip, deviceSharedTip,
  deviceAlsoInTip, devicePowerCellTip, deviceEnergyCellTip, deviceProtocolsTip, deviceRegulationTip,
} from '@/lib/audit-tips-systems'
import { deviceChecksTip, DEVICE_DONE_LABEL, checkCardTip, POWER_REQUIRED_TIP } from '@/lib/audit-tips-systems-guide'
import { MISSING_POWER_CODE } from '@/lib/systems-guide'

library.add(faPlus, faShieldExclamation)

const props = defineProps({
  system: { type: Object, required: true },
  devices: { type: Array, default: () => [] },   // équipements propres du système
  selectedId: { type: Number, default: null },
  siteUuid: { type: String, default: null },
  // Voir l'en-tête du fichier.
  headerOnly: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
  filter: { type: String, default: 'all' },        // all | todo | check
  checks: { type: Object, default: () => ({}) },   // id d'équipement → points à vérifier
})
const emit = defineEmits(['select', 'add-device', 'changed'])

const audit = useAuditStore()

const ROLE_PRIORITY = { production: 1, distribution: 2, emission: 3, regulation: 4 }
const ROLE_SHORT = { production: 'Prod.', distribution: 'Distrib.', emission: 'Émis.', regulation: 'Régul.', autre: 'Autre' }
const ROLE_BY_VALUE = Object.fromEntries(ROLE_OPTIONS.map(r => [r.value, r]))
const ENERGY_BY_VALUE = Object.fromEntries(ENERGY_OPTIONS.map(e => [e.value, e]))
const COMM_BY_VALUE = Object.fromEntries(COMM_OPTIONS.map(o => [o.value, o]))

function rolesOf(d) {
  return Array.isArray(d.device_role) ? d.device_role : (d.device_role ? [d.device_role] : [])
}
// Affichage : Production → Distribution → Émission → Régulation.
function sortedRoles(d) {
  return [...rolesOf(d)].sort((a, b) =>
    (ROLE_PRIORITY[String(a).toLowerCase()] || 5) - (ROLE_PRIORITY[String(b).toLowerCase()] || 5))
}
function rolePriority(d) {
  const roles = rolesOf(d)
  if (!roles.length) return 5
  return Math.min(...roles.map(r => ROLE_PRIORITY[String(r).toLowerCase()] || 5))
}

const sharedDevices = computed(() => (audit.devices || []).filter(d =>
  d.system_id !== props.system.id && (d.extra_system_ids || []).includes(props.system.id)))
const allRows = computed(() => [...props.devices, ...sharedDevices.value].sort((a, b) => {
  const pa = rolePriority(a)
  const pb = rolePriority(b)
  if (pa !== pb) return pa - pb
  return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase())
}))
// Filtre « à compléter » / « à vérifier ».
function checksOf(d) { return props.checks?.[d.id] || [] }
const rows = computed(() => {
  if (props.filter === 'all') return allRows.value
  return allRows.value.filter(d => (props.filter === 'check' ? checksOf(d).length : missing(d).length))
})
// « manquante » : puissance exigée (production de chauffage ou de froid, « à compléter ») ou
// point « à vérifier » du cumul (autres productions comptées dans le seuil). null = rien à signaler.
function powerMissing(d) {
  if (!d.validation_forced && deviceMissingItems(d, systemCategoryOf(d)).some(m => m.key === 'power')) return 'required'
  return checksOf(d).some(f => f.code === MISSING_POWER_CODE) ? 'check' : null
}
function rowCheckTip(d) {
  const c = checksOf(d)
  return c.length === 1 ? checkCardTip(c[0], d, systemCategoryOf(d)) : deviceChecksTip(c, missing(d).length)
}
const minPriority = computed(() => allRows.value.reduce((m, d) => Math.min(m, rolePriority(d)), 5))
function showConnector(d) {
  const p = rolePriority(d)
  return p > minPriority.value && p <= 4
}
// Circuit de l'usage : un trait continu le long des lignes, un point plein sur
// la production (tête), un coude vers chaque équipement desservi ; le trait part de la 1re ligne et
// s'arrête à la dernière.
function circuitClasses(d) {
  const list = rows.value
  const i = list.indexOf(d)
  return [
    showConnector(d) ? 'is-down' : 'is-head',
    list.length <= 1 ? 'pipe-solo' : (i === 0 ? 'pipe-first' : (i === list.length - 1 ? 'pipe-last' : '')),
  ]
}

// Puissance : même champ que le tableau (froid des réversibles sur un
// système Refroidissement).
function powerField(d) {
  if (props.system?.system_category !== 'cooling') return 'power_kw'
  const ids = new Set([d.system_id, ...(d.extra_system_ids || [])])
  const reversible = (audit.systems || []).some(s => ids.has(s.id) && s.system_category === 'heating')
  return reversible ? 'power_kw_cooling' : 'power_kw'
}
function powerText(d) {
  if (!deviceRoleAllowsEnergySource(d.device_role)) return null
  if (d.power_kw_unknown) return 'Inconnue'
  const v = d[powerField(d)]
  if (v == null || v === '') return '—'
  const kw = Number(v).toLocaleString('fr-FR')
  const q = Number(d.quantity) || 1
  return q > 1 ? `${q} × ${kw} kW` : `${kw} kW`
}
function energyOf(d) {
  if (!deviceRoleAllowsEnergySource(d.device_role)) return null
  return ENERGY_BY_VALUE[d.energy_source] || null
}

// Quantité : déjà lisible dans « 2 × 12 kW » ; badge « × N » sinon
// (émetteurs sans puissance propre, puissance non saisie).
function qtyBadge(d) {
  const q = Number(d.quantity) || 1
  return q > 1 && !(powerText(d) || '').includes('×') ? q : null
}

// Ligne sous le nom : marque + référence (sauf si elles servent déjà de nom),
// localisation, âge.
function identityLine(d) {
  const brandRef = [d.brand, d.model_reference].filter(Boolean).join(' ')
  const age = d.age_years != null && d.age_years !== '' ? `${d.age_years} an${Number(d.age_years) > 1 ? 's' : ''}` : ''
  return [d.name ? brandRef : '', d.location || '', age].filter(Boolean).join(' · ')
}

// Communication : même lecture que la fiche (is_communicating, repli sur
// les anciennes colonnes de protocole).
function protocolsOf(d) {
  let arr = []
  try { arr = JSON.parse(d.communication_protocols || '[]') } catch { arr = [] }
  arr = Array.isArray(arr) ? arr.filter(v => v && v !== 'non_communicant') : []
  if (!arr.length && d.communication_protocol && d.communication_protocol !== 'non_communicant') arr = [d.communication_protocol]
  return arr.map(v => COMM_BY_VALUE[v]?.label || v)
}
function commState(d) {
  const protos = protocolsOf(d)
  if (d.is_communicating === 1 || d.is_communicating === true) return protos.length ? 'yes' : 'missing'
  if (d.is_communicating === 0 || d.is_communicating === false) return 'no'
  if (protos.length) return 'yes'
  if (d.communication_protocol === 'non_communicant' || (d.communication_protocols || '').includes('non_communicant')) return 'no'
  return null
}
function wiredText(d) {
  if (d.wired === 1 || d.wired === true) return 'Câblé à la GTB'
  if (d.wired === 0 || d.wired === false) return 'Non câblé à la GTB'
  return ''
}

// Régulation : présence, intégrée / déportée, types saisis par niveau
// (libellés de la fiche ; « Autre » seulement s'il n'y a rien de plus
// précis), sinon marque du régulateur.
function systemCategoryOf(d) {
  return (audit.systems || []).find(s => s.id === d.system_id)?.system_category || props.system.system_category
}
function regulationInfo(d) {
  if (d.has_regulation === 0 || d.has_regulation === false) return { label: 'Aucune', detail: '', none: true }
  if (d.has_regulation !== 1 && d.has_regulation !== true) return null
  const label = d.regulation_integrated === 1 || d.regulation_integrated === true ? 'Intégrée'
    : (d.regulation_integrated === 0 || d.regulation_integrated === false ? 'Déportée' : 'Oui')
  const cat = systemCategoryOf(d)
  const levels = [
    ['production', d.regulation_type_production],
    ['distribution', d.regulation_type_distribution],
    ['emission', d.regulation_type_emission],
  ].filter(([, v]) => v)
  const specific = levels.filter(([, v]) => v !== 'autre')
  const types = (specific.length ? specific : levels)
    .map(([lvl, v]) => regulationTypesForCategory(lvl, cat).find(o => o.value === v)?.label || v)
  const regulator = [d.regulator_brand, d.regulator_model_reference].filter(Boolean).join(' ')
  return { label, detail: types.length ? types.join(', ') : regulator, none: false }
}

function isShared(d) { return d.system_id !== props.system.id }
function originZone(d) {
  return (audit.systems || []).find(s => s.id === d.system_id)?.zone_name || 'autre zone'
}
function isBackup(d) { return d.is_backup === 1 || d.is_backup === true }
function missing(d) {
  const cat = systemCategoryOf(d)
  return isDeviceComplete(d, cat) ? [] : deviceMissingFields(d, cat)
}
// Carte de la colonne État : complet, forcé, ou la liste de ce qu'il reste à renseigner.
function statusTip(d) {
  const m = missing(d)
  return deviceStatusTip(m, { forced: !m.length && !!d.validation_forced })
}
// Bulles des cellules vides (« — ») : sans objet, inconnue ou pas encore renseignée.
function powerTip(d) {
  const t = powerText(d)
  if (t == null) return devicePowerCellTip('not_applicable')
  if (d.power_kw_unknown) return devicePowerCellTip('unknown')
  return t === '—' ? devicePowerCellTip('empty') : null
}
function energyTip(d) {
  if (!deviceRoleAllowsEnergySource(d.device_role)) return deviceEnergyCellTip('not_applicable')
  return energyOf(d) ? null : deviceEnergyCellTip('empty')
}
</script>

<template>
  <div :class="['dev-list', 'dev-guided', compact && 'dev-compact']">
    <!-- En-têtes de colonnes centrés, comme dans tous les tableaux (carte d'aide au survol) : un
         seul en-tête pour toute la zone (header-only). -->
    <div v-if="headerOnly"
         class="dev-grid px-3 text-center text-[10px] font-medium uppercase tracking-wider py-2 text-slate-600 border-b border-slate-200">
      <span v-tooltip="DEVICE_COLUMN_TIPS.name" class="text-left">Équipement</span>
      <span class="dev-opt" v-tooltip="DEVICE_COLUMN_TIPS.roles">Fonctions</span>
      <span class="dev-opt" v-tooltip="DEVICE_COLUMN_TIPS.power">Puissance</span>
      <span class="dev-opt" v-tooltip="DEVICE_COLUMN_TIPS.energy">Énergie</span>
      <span class="dev-col-comm dev-opt" v-tooltip="DEVICE_COLUMN_TIPS.communication">Communication</span>
      <span class="dev-col-reg dev-opt" v-tooltip="DEVICE_COLUMN_TIPS.regulation">Régulation</span>
      <span v-tooltip="DEVICE_COLUMN_TIPS.status">État</span>
    </div>
    <template v-if="!headerOnly">
    <PhotoDropzone
      v-for="d in rows" :key="d.id"
      :site-uuid="siteUuid || ''"
      :attach-to="{ device_id: d.id, system_id: system.id }"
      :enabled="!!siteUuid"
      @changed="emit('changed')">
      <button type="button"
              :data-device-id="d.id"
              @click="emit('select', d)"
              :class="['dev-grid w-full px-3 text-left text-sm transition',
                       'py-2.5 border-b border-slate-100',
                       d.id === selectedId
                         ? 'bg-indigo-50/70 shadow-[inset_3px_0_0_#1b2842]'
                         : (checksOf(d).length ? 'bg-rose-50/60 hover:bg-rose-50 shadow-[inset_3px_0_0_#fb7185]'
                           : (isShared(d) ? 'bg-emerald-50/40 hover:bg-emerald-50' : 'hover:bg-slate-50')),
                       d.out_of_service ? 'opacity-60' : '']"
              v-tooltip="DEVICE_ROW_LABEL">
        <!-- Nom (+ connecteur aval, quantité, secours, partage, hors service),
             puis marque · référence · localisation · âge. Chaque pastille a sa carte ; la
             ligne garde une étiquette courte (affichée hors des pastilles). -->
        <!-- Circuit de l'usage (trait de sa couleur) ; production en tête (point plein, nom en
             gras), équipements desservis en dessous (coude, décalés). -->
        <span :class="['flex items-start gap-1.5 min-w-0', ['guide-dev-name', ...circuitClasses(d)]]">
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-1.5 min-w-0">
              <span v-tooltip.overflow
                    :class="['truncate', !d.name ? 'italic text-gray-400'
                      : (showConnector(d) ? 'font-medium text-[13px] text-slate-700' : 'font-semibold text-[13.5px] text-slate-900')]">
                {{ d.name || [d.brand, d.model_reference].filter(Boolean).join(' ') || 'Sans nom' }}
              </span>
              <span v-if="qtyBadge(d)" class="shrink-0 text-[10px] px-1.5 py-px rounded-full bg-slate-100 text-slate-700"
                    v-tooltip="deviceQuantityTip(qtyBadge(d))">
                × {{ qtyBadge(d) }}
              </span>
              <span v-if="isBackup(d)" class="shrink-0 inline-flex" v-tooltip="DEVICE_BACKUP_TIP">
                <FontAwesomeIcon :icon="['fas', 'shield-exclamation']" class="w-3 h-3 text-amber-600" />
              </span>
              <span v-if="isShared(d)" class="shrink-0 text-[10px] px-1.5 py-px rounded-full bg-emerald-100 text-emerald-800"
                    v-tooltip="deviceSharedTip(originZone(d))">
                partagé
              </span>
              <span v-else-if="(d.extra_system_ids || []).length" class="shrink-0 text-[10px] px-1.5 py-px rounded-full bg-emerald-100 text-emerald-800"
                    v-tooltip="deviceAlsoInTip((d.extra_system_ids || []).length)">
                +{{ (d.extra_system_ids || []).length }}
              </span>
              <span v-if="d.out_of_service" class="shrink-0 text-[10px] px-1.5 py-px rounded-full bg-red-100 text-red-700"
                    v-tooltip="DEVICE_OUT_OF_SERVICE_TIP">Hors service</span>
            </span>
            <span v-if="identityLine(d)" v-tooltip.overflow class="block truncate text-[11px] text-gray-500 mt-0.5">{{ identityLine(d) }}</span>
          </span>
        </span>
        <!-- Fonctions (abréviations expliquées par la carte de chaque fonction) -->
        <span class="dev-opt flex flex-wrap items-center gap-1 min-w-0">
          <span v-for="r in sortedRoles(d)" :key="r"
                class="inline-flex items-center gap-1 text-[11px] text-gray-700 whitespace-nowrap"
                v-tooltip="roleTip(r)">
            <span class="w-1.5 h-1.5 rounded-full shrink-0" :style="{ background: ROLE_BY_VALUE[r]?.color || '#6b7280' }"></span>
            {{ ROLE_SHORT[r] || r }}
          </span>
          <span v-if="!rolesOf(d).length" class="text-[11px] text-gray-400 italic"
                v-tooltip="DEVICE_ROLE_MISSING_TIP">à préciser</span>
        </span>
        <!-- Puissance (mise en page guidée : « manquante » pour une production sans puissance) -->
        <span v-if="powerMissing(d)" class="dev-opt text-right text-xs whitespace-nowrap"
              :class="powerMissing(d) === 'required' ? 'text-amber-700' : 'text-rose-700'"
              v-tooltip="() => (powerMissing(d) === 'required' ? POWER_REQUIRED_TIP : checkCardTip({ code: MISSING_POWER_CODE }))">
          manquante
        </span>
        <span v-else class="dev-opt text-right text-xs whitespace-nowrap"
              :class="powerText(d) && powerText(d) !== '—' ? 'text-gray-800' : 'text-gray-300'"
              v-tooltip="() => powerTip(d)">
          {{ powerText(d) ?? '—' }}
        </span>
        <!-- Énergie -->
        <span class="dev-opt flex items-center gap-1.5 text-xs text-gray-700 min-w-0">
          <template v-if="energyOf(d)">
            <FontAwesomeIcon :icon="['fas', energyOf(d).icon.replace(/^fa-/, '')]" class="w-3 h-3 shrink-0" :style="{ color: energyOf(d).color }" />
            <span class="truncate" v-tooltip.overflow>{{ energyOf(d).label }}</span>
          </template>
          <span v-else class="text-gray-300" v-tooltip="() => energyTip(d)">—</span>
        </span>
        <!-- Communication : protocole(s), puis liaison câblée à la GTB -->
        <span class="dev-col-comm dev-opt flex-col justify-center min-w-0 text-xs">
          <span v-if="commState(d) === 'yes'" class="flex items-center gap-1 min-w-0"
                v-tooltip="() => deviceProtocolsTip(protocolsOf(d))">
            <span class="truncate px-1.5 py-px rounded-md text-[11px] bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200">{{ protocolsOf(d)[0] }}</span>
            <span v-if="protocolsOf(d).length > 1" class="shrink-0 text-[11px] text-gray-500">+{{ protocolsOf(d).length - 1 }}</span>
          </span>
          <span v-else-if="commState(d) === 'missing'" class="text-amber-700" v-tooltip="DEVICE_COMM_TIPS.missing">Protocole à préciser</span>
          <span v-else-if="commState(d) === 'no'" class="text-gray-500" v-tooltip="DEVICE_COMM_TIPS.no">Non communicant</span>
          <span v-else class="text-gray-300" v-tooltip="DEVICE_COMM_TIPS.unknown">—</span>
          <span v-if="(commState(d) === 'yes' || commState(d) === 'missing') && wiredText(d)"
                :class="['truncate text-[11px] mt-0.5', d.wired === 1 || d.wired === true ? 'text-emerald-700' : 'text-gray-500']"
                v-tooltip="d.wired === 1 || d.wired === true ? DEVICE_WIRED_TIPS.yes : DEVICE_WIRED_TIPS.no">
            {{ wiredText(d) }}
          </span>
        </span>
        <!-- Régulation : intégrée / déportée / aucune, puis type(s) -->
        <span class="dev-col-reg dev-opt flex-col justify-center min-w-0 text-xs">
          <template v-if="regulationInfo(d)">
            <span :class="regulationInfo(d).none ? 'text-gray-500' : 'text-gray-800'"
                  v-tooltip="() => deviceRegulationTip(regulationInfo(d))">{{ regulationInfo(d).label }}</span>
            <span v-if="regulationInfo(d).detail" class="truncate text-[11px] text-gray-500 mt-0.5"
                  v-tooltip.overflow>{{ regulationInfo(d).detail }}</span>
          </template>
          <span v-else class="text-gray-300" v-tooltip="'Régulation pas encore renseignée'">—</span>
        </span>
        <!-- État : seulement les exceptions, un ✓ discret sinon -->
        <span :class="['flex gap-1 text-xs', compact ? 'flex-col items-end' : 'flex-wrap items-center']"
              v-tooltip="() => (checksOf(d).length ? rowCheckTip(d) : statusTip(d))">
          <span v-if="missing(d).length"
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full whitespace-nowrap bg-amber-100/70 text-amber-900 font-medium">
            <span class="w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden="true"></span>
            {{ missing(d).length }} à compléter
          </span>
          <span v-if="checksOf(d).length"
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full whitespace-nowrap bg-rose-100/70 text-rose-800 font-medium">
            <span class="w-1.5 h-1.5 rounded-full bg-rose-500" aria-hidden="true"></span>
            à vérifier
          </span>
          <span v-if="!missing(d).length && !checksOf(d).length"
                class="inline-flex items-center gap-1 text-emerald-700 whitespace-nowrap">
            <span class="font-bold" aria-hidden="true">✓</span>
            <span :class="d.validation_forced ? '' : 'sr-only'">{{ d.validation_forced ? 'Forcé' : DEVICE_DONE_LABEL }}</span>
          </span>
        </span>
      </button>
    </PhotoDropzone>
    <div class="px-2 py-1.5">
      <button type="button" @click="emit('add-device', system)"
              class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-indigo-700 rounded-lg hover:bg-indigo-50 transition">
        <FontAwesomeIcon :icon="['fas', 'plus']" class="w-3 h-3 shrink-0" /> Ajouter un équipement
      </button>
    </div>
    </template>
  </div>
</template>

<style scoped>
/* Largeurs fixes (hors nom) : les colonnes s'alignent d'un système à
   l'autre. Communication puis Régulation n'apparaissent que si la liste est
   assez large (écran étroit avec la fiche ouverte à droite). */
/* Liste étroite (1024 px, fiche ouverte à droite) : les colonnes fixes ne tiennent plus ; la
   liste défile alors horizontalement (toutes les colonnes gardées) au lieu de passer sous la
   fiche, où « État » et sa bulle devenaient inaccessibles et les en-têtes se chevauchaient. */
.dev-list { container-type: inline-size; overflow-x: auto; }
.dev-grid {
  display: grid;
  align-items: center;
  column-gap: 0.75rem;
  grid-template-columns: minmax(0, 1fr) 7rem 6rem 7rem 7.5rem;
  min-width: 40rem;
}
.dev-col-comm, .dev-col-reg { display: none; }
@container (min-width: 52rem) {
  .dev-grid { grid-template-columns: minmax(0, 1fr) 7rem 6rem 7rem 8.5rem 7.5rem; }
  .dev-col-comm { display: flex; }
}
@container (min-width: 64rem) {
  .dev-grid { grid-template-columns: minmax(0, 1fr) 7rem 6rem 7rem 8.5rem 8.5rem 7.5rem; }
  .dev-col-reg { display: flex; }
}
/* Colonne État plus large (« 5 à compléter » + « à vérifier »). Mêmes
   largeurs dans toutes les listes de la zone et dans l'en-tête unique : colonnes alignées. */
.dev-guided .dev-grid { grid-template-columns: minmax(0, 1fr) 7rem 6rem 7rem 10.5rem; }
@container (min-width: 52rem) {
  .dev-guided .dev-grid { grid-template-columns: minmax(0, 1fr) 7rem 6rem 7rem 8.5rem 10.5rem; }
}
@container (min-width: 64rem) {
  .dev-guided .dev-grid { grid-template-columns: minmax(0, 1fr) 7rem 6rem 7rem 8.5rem 8.5rem 10.5rem; }
}
/* Circuit de l'usage : --fluid vient de la carte d'usage (SystemsSection). */
.guide-dev-name { position: relative; padding-left: 1.35rem; }
.guide-dev-name.is-down { padding-left: 2.35rem; }
.guide-dev-name::before {
  content: ''; position: absolute; left: 0.4rem; width: 2px; border-radius: 1px;
  top: calc(-0.625rem - 1px); bottom: calc(-0.625rem - 1px);
  background: color-mix(in srgb, var(--fluid, #94a3b8) 40%, transparent);
}
.guide-dev-name.pipe-first::before { top: 0.7rem; }
.guide-dev-name.pipe-last::before { bottom: calc(100% - 0.7rem); }
.guide-dev-name.pipe-solo::before { display: none; }
.guide-dev-name::after { content: ''; position: absolute; }
.guide-dev-name.is-head::after {
  left: calc(0.4rem - 4px); top: calc(0.7rem - 5px); width: 10px; height: 10px; border-radius: 9999px;
  background: var(--fluid, #94a3b8); box-shadow: 0 0 0 2px #fff;
}
.guide-dev-name.is-down::after {
  left: 0.4rem; top: calc(0.7rem - 1px); width: 1.6rem; height: 2px; border-radius: 1px;
  background: color-mix(in srgb, var(--fluid, #94a3b8) 40%, transparent);
}
/* Fiche ouverte : nom et état seulement (le reste est dans la fiche). */
.dev-compact { overflow-x: visible; }
.dev-compact .dev-opt { display: none !important; }
.dev-compact .dev-grid { grid-template-columns: minmax(0, 1fr) max-content !important; min-width: 0; }
</style>
