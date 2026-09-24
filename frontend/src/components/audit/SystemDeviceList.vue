<script setup>
/**
 * Liste des équipements d'un système, en lecture (étape Systèmes, page audit
 * à onglets). Une ligne par équipement : nom (+ marque, référence,
 * localisation, âge dessous), fonctions, puissance, énergie, communication
 * (protocoles, liaison câblée à la GTB), régulation (intégrée / déportée,
 * type), état (complet / points à compléter). Communication et Régulation
 * n'apparaissent que si la liste est assez large (requêtes de conteneur).
 * Un clic ouvre la fiche de l'équipement (panneau à droite, tous les
 * champs). Remplace, en mode étape, le tableau à saisie directe
 * (SystemDevicesTable, conservé ailleurs).
 *
 * Ordre : Production → Distribution → Émission → Régulation, puis nom
 * (même règle que le tableau), avec « └─ » pour les équipements aval.
 * Les équipements partagés depuis un autre système sont listés (teinte verte)
 * ; on peut déposer une photo directement sur une ligne.
 */
import { computed } from 'vue'
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { faPlus, faShieldExclamation } from '@fortawesome/pro-solid-svg-icons'
import '@/lib/equipment-icons'
import PhotoDropzone from '@/components/PhotoDropzone.vue'
import { useAuditStore } from '@/stores/audit'
import {
  ENERGY_OPTIONS, ROLE_OPTIONS, COMM_OPTIONS, deviceMissingFields, isDeviceComplete,
  deviceRoleAllowsEnergySource, regulationTypesForCategory,
} from '@/lib/audit-options'

library.add(faPlus, faShieldExclamation)

const props = defineProps({
  system: { type: Object, required: true },
  devices: { type: Array, default: () => [] },   // équipements propres du système
  selectedId: { type: Number, default: null },
  siteUuid: { type: String, default: null },
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
const rows = computed(() => [...props.devices, ...sharedDevices.value].sort((a, b) => {
  const pa = rolePriority(a)
  const pb = rolePriority(b)
  if (pa !== pb) return pa - pb
  return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase())
}))
const minPriority = computed(() => rows.value.reduce((m, d) => Math.min(m, rolePriority(d)), 5))
function showConnector(d) {
  const p = rolePriority(d)
  return p > minPriority.value && p <= 4
}
function connectorColor(d) {
  switch (rolePriority(d)) {
    case 2: return 'text-indigo-400'
    case 3: return 'text-rose-400'
    case 4: return 'text-violet-400'
    default: return 'text-gray-300'
  }
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
function statusTooltip(d) {
  const m = missing(d)
  if (!m.length) return d.validation_forced ? 'Validation forcée par l\'auditeur' : 'Équipement complet'
  return `À compléter :\n${m.map(x => `• ${x}`).join('\n')}`
}
</script>

<template>
  <div class="dev-list border-t border-gray-100 bg-white">
    <!-- En-têtes de colonnes centrés, comme dans tous les tableaux. -->
    <div v-if="rows.length"
         class="dev-grid px-3 py-1.5 text-center text-[10px] font-medium uppercase tracking-wider text-gray-400 border-b border-gray-100">
      <span>Équipement</span><span>Fonctions</span><span>Puissance</span><span>Énergie</span>
      <span class="dev-col-comm">Communication</span><span class="dev-col-reg">Régulation</span><span>État</span>
    </div>
    <PhotoDropzone
      v-for="d in rows" :key="d.id"
      :site-uuid="siteUuid || ''"
      :attach-to="{ device_id: d.id, system_id: system.id }"
      :enabled="!!siteUuid"
      @changed="emit('changed')">
      <button type="button"
              :data-device-id="d.id"
              @click="emit('select', d)"
              :class="['dev-grid w-full px-3 py-2 text-left text-sm border-b border-gray-50 transition',
                       d.id === selectedId ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-300'
                         : (isShared(d) ? 'bg-emerald-50/40 hover:bg-emerald-50' : 'hover:bg-slate-50'),
                       d.out_of_service ? 'opacity-60' : '']"
              v-tooltip="{ text: `Ouvrir la fiche${isShared(d) ? ` — partagé depuis ${originZone(d)}` : ''}`, placement: 'top' }">
        <!-- Nom (+ connecteur aval, quantité, secours, partage, hors service),
             puis marque · référence · localisation · âge -->
        <span class="flex items-start gap-1.5 min-w-0"
              :style="{ paddingLeft: Math.max(0, rolePriority(d) - minPriority) * 8 + 'px' }">
          <span v-if="showConnector(d)" :class="['select-none leading-5 shrink-0', connectorColor(d)]" aria-hidden="true">└─</span>
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-1.5 min-w-0">
              <span :class="['truncate', d.name ? 'font-medium text-gray-900' : 'italic text-gray-400']">
                {{ d.name || [d.brand, d.model_reference].filter(Boolean).join(' ') || 'Sans nom' }}
              </span>
              <span v-if="qtyBadge(d)" class="shrink-0 text-[10px] px-1.5 py-px rounded-full bg-slate-100 text-slate-700"
                    v-tooltip="`${qtyBadge(d)} unités identiques`">
                × {{ qtyBadge(d) }}
              </span>
              <span v-if="isBackup(d)" class="shrink-0 inline-flex" v-tooltip="'Équipement de secours — puissance exclue du cumul BACS'">
                <FontAwesomeIcon :icon="['fas', 'shield-exclamation']" class="w-3 h-3 text-amber-600" />
              </span>
              <span v-if="isShared(d)" class="shrink-0 text-[10px] px-1.5 py-px rounded-full bg-emerald-100 text-emerald-800">
                partagé
              </span>
              <span v-else-if="(d.extra_system_ids || []).length" class="shrink-0 text-[10px] px-1.5 py-px rounded-full bg-emerald-100 text-emerald-800"
                    v-tooltip="`Aussi présent dans ${(d.extra_system_ids || []).length} autre${(d.extra_system_ids || []).length > 1 ? 's' : ''} système${(d.extra_system_ids || []).length > 1 ? 's' : ''}`">
                +{{ (d.extra_system_ids || []).length }}
              </span>
              <span v-if="d.out_of_service" class="shrink-0 text-[10px] px-1.5 py-px rounded-full bg-red-100 text-red-700">HS</span>
            </span>
            <span v-if="identityLine(d)" class="block truncate text-[11px] text-gray-500 mt-0.5">{{ identityLine(d) }}</span>
          </span>
        </span>
        <!-- Fonctions -->
        <span class="flex flex-wrap items-center gap-1 min-w-0">
          <span v-for="r in sortedRoles(d)" :key="r"
                class="inline-flex items-center gap-1 text-[11px] text-gray-700 whitespace-nowrap"
                v-tooltip="ROLE_BY_VALUE[r]?.label || r">
            <span class="w-1.5 h-1.5 rounded-full shrink-0" :style="{ background: ROLE_BY_VALUE[r]?.color || '#6b7280' }"></span>
            {{ ROLE_SHORT[r] || r }}
          </span>
          <span v-if="!rolesOf(d).length" class="text-[11px] text-gray-400 italic">à préciser</span>
        </span>
        <!-- Puissance -->
        <span class="text-right text-xs whitespace-nowrap"
              :class="powerText(d) && powerText(d) !== '—' ? 'text-gray-800' : 'text-gray-300'">
          {{ powerText(d) ?? '—' }}
        </span>
        <!-- Énergie -->
        <span class="flex items-center gap-1.5 text-xs text-gray-700 min-w-0">
          <template v-if="energyOf(d)">
            <FontAwesomeIcon :icon="['fas', energyOf(d).icon.replace(/^fa-/, '')]" class="w-3 h-3 shrink-0" :style="{ color: energyOf(d).color }" />
            <span class="truncate">{{ energyOf(d).label }}</span>
          </template>
          <span v-else class="text-gray-300">—</span>
        </span>
        <!-- Communication : protocole(s), puis liaison câblée à la GTB -->
        <span class="dev-col-comm flex-col justify-center min-w-0 text-xs">
          <span v-if="commState(d) === 'yes'" class="flex items-center gap-1 min-w-0">
            <span class="truncate px-1.5 py-px rounded-md text-[11px] bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200"
                  v-tooltip="protocolsOf(d).join(', ')">{{ protocolsOf(d)[0] }}</span>
            <span v-if="protocolsOf(d).length > 1" class="shrink-0 text-[11px] text-gray-500">+{{ protocolsOf(d).length - 1 }}</span>
          </span>
          <span v-else-if="commState(d) === 'missing'" class="text-amber-700">Protocole à préciser</span>
          <span v-else-if="commState(d) === 'no'" class="text-gray-500">Non communicant</span>
          <span v-else class="text-gray-300">—</span>
          <span v-if="(commState(d) === 'yes' || commState(d) === 'missing') && wiredText(d)"
                :class="['truncate text-[11px] mt-0.5', d.wired === 1 || d.wired === true ? 'text-emerald-700' : 'text-gray-500']">
            {{ wiredText(d) }}
          </span>
        </span>
        <!-- Régulation : intégrée / déportée / aucune, puis type(s) -->
        <span class="dev-col-reg flex-col justify-center min-w-0 text-xs">
          <template v-if="regulationInfo(d)">
            <span :class="regulationInfo(d).none ? 'text-gray-500' : 'text-gray-800'">{{ regulationInfo(d).label }}</span>
            <span v-if="regulationInfo(d).detail" class="truncate text-[11px] text-gray-500 mt-0.5"
                  v-tooltip="regulationInfo(d).detail">{{ regulationInfo(d).detail }}</span>
          </template>
          <span v-else class="text-gray-300">—</span>
        </span>
        <!-- État -->
        <span class="text-xs whitespace-nowrap" v-tooltip="statusTooltip(d)">
          <span v-if="!missing(d).length" class="inline-flex items-center gap-1 text-emerald-700">
            <span class="font-bold">✓</span> {{ d.validation_forced ? 'Forcé' : 'Complet' }}
          </span>
          <span v-else class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200">
            {{ missing(d).length }} à compléter
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
  </div>
</template>

<style scoped>
/* Largeurs fixes (hors nom) : les colonnes s'alignent d'un système à
   l'autre. Communication puis Régulation n'apparaissent que si la liste est
   assez large (écran étroit avec la fiche ouverte à droite). */
.dev-list { container-type: inline-size; }
.dev-grid {
  display: grid;
  align-items: center;
  column-gap: 0.75rem;
  grid-template-columns: minmax(0, 1fr) 7rem 6rem 7rem 7.5rem;
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
</style>
