<script setup>
/**
 * Déplacer / partager un système technique (device) entre usages et zones.
 *
 * - « Usage principal » : déplace le device vers un autre usage (zone ×
 *   catégorie). Il quitte son usage d'origine.
 * - « Aussi présent dans » : partage le device dans des usages
 *   supplémentaires (il y apparaît en plus, badge « partagé »).
 *
 * Émet `updated` après chaque modification (le parent rafraîchit son state).
 *
 * Props :
 *   device  : { id, system_id, extra_system_ids, name }
 *   systems : [{ id, zone_id, zone_name, system_category, custom_label, is_bacs }]
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { ArrowsRightLeftIcon, ShareIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons'
import {
  MOVE_SEARCH_PLACEHOLDER, MOVE_NO_MATCH, SAME_USAGE_TIP, sameUsageLabel,
  MOVE_SHARE_TABS, moveShareIntro, moveShareFooter,
} from '@/lib/audit-tips-systems-guide'
import { moveBacsDevice, shareBacsDevice } from '@/api'
import { systemUsageLabel } from '@/lib/audit-options'
import { resolveFaIconName } from '@/lib/equipment-icons'
import { plural } from '@/lib/tooltip-content'
import { useNotification } from '@/composables/useNotification'

// Aligné sur DeviceEditModal — icône + couleur par catégorie d'usage. Les
// icônes apportent une lecture instantanée de la catégorie ciblée (flamme
// rouge = chauffage, etc.). Pas centralisé pour éviter une dépendance
// circulaire avec SystemCategoryIcon.
const SYSTEM_CATEGORY_DECOR = {
  heating:                { icon: 'fa-fire',        color: '#dc2626' },
  cooling:                { icon: 'fa-snowflake',   color: '#0891b2' },
  ventilation:            { icon: 'fa-fan',         color: '#64748b' },
  dhw:                    { icon: 'fa-faucet',      color: '#0284c7' },
  lighting_indoor:        { icon: 'fa-lightbulb',   color: '#f59e0b' },
  lighting_outdoor:       { icon: 'fa-tower-cell',  color: '#f59e0b' },
  electricity_production: { icon: 'fa-solar-panel', color: '#16a34a' },
}
function decorOf(s) {
  return SYSTEM_CATEGORY_DECOR[s.system_category] || { icon: 'fa-cube', color: '#6b7280' }
}

const props = defineProps({
  device: { type: Object, required: true },
  systems: { type: Array, required: true },
  // Mise en page guidée de l'étape Systèmes : champ de recherche (zone ou usage) et case
  // « même usage seulement » en tête du menu. Sans elle : menu inchangé.
  searchable: { type: Boolean, default: false },
  // Une seule fenêtre « Déplacer ou partager » à deux onglets (maquette piste D), ouverte par
  // l'une ou l'autre icône sur l'onglet correspondant ; pied : zones desservies. Avec `searchable`.
  dialog: { type: Boolean, default: false },
})
const emit = defineEmits(['updated'])
const { error: notifyError, success } = useNotification()

library.add(faMagnifyingGlass)

// ─── Recherche (option `searchable`) ─────────────────────────────────────────
const query = ref('')
const sameUsageOnly = ref(false)
const searchInput = ref(null)
function norm(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}
const ownCategory = computed(() => (props.systems || []).find(s => s.id === props.device.system_id)?.system_category || null)
const ownUsageLabel = computed(() => {
  const s = (props.systems || []).find(x => x.id === props.device.system_id)
  return s ? systemUsageLabel(s) : ''
})
function matches(g, s) {
  if (sameUsageOnly.value && ownCategory.value && s.system_category !== ownCategory.value) return false
  const q = norm(query.value.trim())
  if (!q) return true
  return norm(g.zone_name).includes(q) || norm(labelOf(s)).includes(q)
}
function filterZones(zones) {
  if (!props.searchable) return zones
  return zones
    .map(g => ({ ...g, items: g.items.filter(s => matches(g, s)) }))
    .filter(g => g.items.length)
}

// Fenêtre (option `dialog`) : zone et usage d'origine, zones desservies en tout.
const ownSystem = computed(() => (props.systems || []).find(s => s.id === props.device.system_id) || null)
const ownZoneName = computed(() => ownSystem.value?.zone_name || '')
const zonesServed = computed(() => {
  const ids = new Set([props.device.system_id, ...(props.device.extra_system_ids || [])])
  return new Set((props.systems || []).filter(s => ids.has(s.id)).map(s => s.zone_id)).size
})
function onDialogKey(e) {
  if (e.key === 'Escape' && openKind.value) { e.stopPropagation(); close() }
}

// Un seul popover ouvert à la fois : 'move' | 'share' | null.
const openKind = ref(null)
const saving = ref(false)
const rootRef = ref(null)

const extraIds = computed(() => props.device.extra_system_ids || [])
const sharedCount = computed(() => extraIds.value.length)

// Systèmes groupés par zone, pour les optgroups / sections.
const systemsByZone = computed(() => {
  const map = new Map()
  for (const s of props.systems || []) {
    const k = s.zone_id
    if (!map.has(k)) map.set(k, { zone_id: k, zone_name: s.zone_name || `Zone #${k}`, items: [] })
    map.get(k).items.push(s)
  }
  return [...map.values()]
})

// Usages proposés au partage : on exclut l'usage principal du device et les
// usages « non concernés » (catégorie absente de la zone) ; les zones vidées
// sont retirées. Les usages déjà partagés restent visibles (cochés) pour
// pouvoir les retirer.
const shareZones = computed(() =>
  systemsByZone.value
    .map(g => ({ ...g, items: g.items.filter(s => s.id !== props.device.system_id && !s.not_concerned) }))
    .filter(g => g.items.length)
)

const moveZonesShown = computed(() => filterZones(systemsByZone.value))
const shareZonesShown = computed(() => filterZones(shareZones.value))

// Affiche le nom personnalisé du système en plus de l'usage quand il
// existe : « Chauffage — chaudière principale ». Pour les usages BACS
// standards sans nom personnalisé, on retombe sur l'usage seul.
function labelOf(s) {
  const usage = systemUsageLabel(s)
  if (s?.is_bacs && s?.custom_label && s.custom_label.trim() && s.custom_label.trim() !== usage) {
    return `${usage} — ${s.custom_label.trim()}`
  }
  return usage
}

async function onMove(targetId) {
  if (saving.value || !targetId || targetId === props.device.system_id) return
  saving.value = true
  try {
    await moveBacsDevice(props.device.id, targetId)
    success('Équipement déplacé')
    close()
    emit('updated')
  } catch (err) {
    notifyError(err.response?.data?.detail || 'Déplacement impossible')
  } finally {
    saving.value = false
  }
}

async function toggleShare(systemId, checked) {
  if (saving.value) return
  saving.value = true
  const next = new Set(extraIds.value)
  if (checked) next.add(systemId); else next.delete(systemId)
  try {
    await shareBacsDevice(props.device.id, [...next])
    success(checked ? 'Usage ajouté au partage' : 'Usage retiré du partage')
    emit('updated')
  } catch (err) {
    notifyError(err.response?.data?.detail || 'Partage impossible')
  } finally {
    saving.value = false
  }
}

function toggle(kind) { openKind.value = openKind.value === kind ? null : kind }
function close() { openKind.value = null }

// Popover téléporté au <body> pour échapper aux overflow:hidden des cartes.
const popupRef = ref(null)
const pos = ref({ top: 0, left: 0, maxHeight: 480 })
const DROPDOWN_W = 288
const MIN_PANEL_H = 220 // sous cette hauteur en bas, on flip vers le haut

function updatePos() {
  const r = rootRef.value?.getBoundingClientRect()
  if (!r) return
  const vh = window.innerHeight || document.documentElement.clientHeight
  const margin = 8
  const gap = 4
  const spaceBelow = vh - r.bottom - margin
  const spaceAbove = r.top - margin
  // Flip vers le haut quand l'espace en bas est insuffisant ET qu'il y a plus
  // de place en haut. Évite de tronquer la liste sous le viewport en bas de
  // page (incident 2026-06-08 sur l'audit Communay : « Bureaux 2 » coupé).
  const flipUp = spaceBelow < MIN_PANEL_H && spaceAbove > spaceBelow
  const maxAvail = flipUp ? spaceAbove - gap : spaceBelow - gap
  const maxHeight = Math.max(180, Math.min(480, maxAvail))
  pos.value = flipUp
    ? { top: Math.max(margin, r.top - gap - maxHeight), left: Math.max(8, r.right - DROPDOWN_W), maxHeight }
    : { top: r.bottom + gap, left: Math.max(8, r.right - DROPDOWN_W), maxHeight }
}
function onDocClick(e) {
  if (rootRef.value && rootRef.value.contains(e.target)) return
  if (popupRef.value && popupRef.value.contains(e.target)) return
  close()
}
watch(openKind, async (v, old) => {
  if (props.dialog) {
    if (v && !old) {
      await nextTick()
      query.value = ''
      searchInput.value?.focus?.()
      document.addEventListener('keydown', onDialogKey, true)
    } else if (!v) document.removeEventListener('keydown', onDialogKey, true)
    return
  }
  if (v) {
    await nextTick()
    updatePos()
    if (props.searchable) {
      query.value = ''
      searchInput.value?.focus?.()
    }
    window.addEventListener('scroll', updatePos, true)
    window.addEventListener('resize', updatePos)
  } else {
    window.removeEventListener('scroll', updatePos, true)
    window.removeEventListener('resize', updatePos)
  }
})
onMounted(() => document.addEventListener('mousedown', onDocClick))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDialogKey, true)
  document.removeEventListener('mousedown', onDocClick)
  window.removeEventListener('scroll', updatePos, true)
  window.removeEventListener('resize', updatePos)
})
</script>

<template>
  <div ref="rootRef" class="relative inline-flex items-center gap-1 shrink-0 whitespace-nowrap">
    <!-- Déplacer : change l'usage principal du système -->
    <button
      type="button"
      @click="toggle('move')"
      :class="['btn-icon', openKind === 'move' && 'is-active']"
      v-tooltip="'Déplacer vers un autre usage'"
    >
      <ArrowsRightLeftIcon class="w-4 h-4 shrink-0" />
    </button>
    <!-- Partager : rend le système présent dans d'autres usages -->
    <button
      type="button"
      @click="toggle('share')"
      :class="['btn-icon relative', (sharedCount > 0 || openKind === 'share') && 'is-success']"
      :aria-label="sharedCount > 0 ? `Partager : déjà dans ${plural(sharedCount, 'autre usage', 'autres usages')}` : 'Partager dans d’autres usages'"
      v-tooltip="sharedCount > 0 ? `Partager : déjà dans ${plural(sharedCount, 'autre usage', 'autres usages')}` : 'Partager dans d’autres usages'"
    >
      <ShareIcon class="w-4 h-4 shrink-0" />
      <span v-if="sharedCount > 0"
            class="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 inline-flex items-center justify-center text-[9px] font-semibold bg-emerald-600 text-white rounded-full">
        +{{ sharedCount }}
      </span>
    </button>
  </div>

  <Teleport to="body">
    <!-- Fenêtre (option `dialog`) : fond, fenêtre centrée ; sinon, menu sous les icônes. -->
    <div v-if="openKind" :class="dialog ? 'fixed inset-0 z-[115] flex items-center justify-center bg-slate-900/45 p-4' : 'contents'">
    <div
      ref="popupRef"
      :role="dialog ? 'dialog' : undefined"
      :aria-modal="dialog ? 'true' : undefined"
      :aria-labelledby="dialog ? `move-share-title-${device.id}` : undefined"
      :style="dialog ? null : { position: 'fixed', top: pos.top + 'px', left: pos.left + 'px', width: DROPDOWN_W + 'px', maxHeight: pos.maxHeight + 'px' }"
      :class="dialog
        ? 'w-full max-w-[640px] max-h-[min(700px,calc(100vh-32px))] bg-white rounded-2xl shadow-2xl text-sm flex flex-col overflow-hidden'
        : 'z-60 bg-white border border-gray-200 rounded-lg shadow-lg text-sm flex flex-col'"
    >
      <template v-if="dialog">
        <div class="px-5 pt-4 pb-3 flex items-start gap-3 shrink-0">
          <div class="min-w-0 flex-1">
            <h2 :id="`move-share-title-${device.id}`" class="text-[17px] font-semibold text-primary truncate" v-tooltip.overflow>
              {{ device.name || 'Équipement sans nom' }}
            </h2>
            <p v-if="ownSystem" class="mt-0.5 text-xs text-slate-600 truncate" v-tooltip.overflow>
              Saisi dans {{ ownZoneName }}, {{ ownUsageLabel.toLowerCase() }}
            </p>
          </div>
          <button type="button" class="btn-icon" @click="close" v-tooltip="'Fermer la fenêtre'">
            <XMarkIcon class="w-4 h-4" />
          </button>
        </div>
        <div class="px-5 pb-2 flex flex-col gap-2 shrink-0">
          <div role="tablist" aria-label="Déplacer ou partager" class="inline-flex self-start rounded-lg border border-slate-300 overflow-hidden">
            <button v-for="t in MOVE_SHARE_TABS" :key="t.key" type="button" role="tab" :aria-selected="openKind === t.key ? 'true' : 'false'"
                    @click="openKind = t.key"
                    :class="['px-3.5 py-1.5 text-xs font-medium whitespace-nowrap transition',
                             openKind === t.key ? 'bg-primary text-white' : 'bg-white text-slate-700 hover:bg-slate-50']">
              {{ t.label }}
            </button>
          </div>
          <p class="text-[13px] text-slate-700">{{ moveShareIntro(openKind, { zone: ownZoneName, usage: ownUsageLabel }) }}</p>
        </div>
      </template>
      <div v-else class="px-3 py-2 border-b border-gray-100 shrink-0">
        <p class="text-xs font-semibold uppercase tracking-wider text-gray-500">
          {{ openKind === 'move' ? 'Déplacer vers' : 'Partager dans d\'autres usages' }}
        </p>
        <p class="text-[11px] text-gray-400 mt-0.5 truncate" v-tooltip.overflow>
          {{ device.name || 'Équipement sans nom' }}
        </p>
      </div>
      <!-- Recherche (mise en page guidée) : zone ou usage, et « même usage seulement ». -->
      <div v-if="searchable || dialog" :class="['py-2 border-b border-gray-100 shrink-0 flex flex-col gap-1.5', dialog ? 'px-5' : 'px-3']">
        <label class="flex items-center gap-2 rounded-lg border border-gray-300 px-2.5 py-1.5 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/30">
          <FontAwesomeIcon :icon="['fas', 'magnifying-glass']" class="w-3 h-3 text-gray-500 shrink-0" />
          <span class="sr-only">{{ MOVE_SEARCH_PLACEHOLDER }}</span>
          <input ref="searchInput" v-model="query" type="text" :placeholder="MOVE_SEARCH_PLACEHOLDER"
                 class="min-w-0 flex-1 bg-transparent text-xs text-gray-800 outline-none focus-visible:shadow-none" />
        </label>
        <label v-if="ownUsageLabel" class="inline-flex items-center gap-2 text-[11px] text-gray-700 cursor-pointer select-none"
               v-tooltip="SAME_USAGE_TIP">
          <input v-model="sameUsageOnly" type="checkbox" class="w-3.5 h-3.5 accent-indigo-600" />
          {{ sameUsageLabel(ownUsageLabel) }}
        </label>
      </div>

      <div :class="['overflow-y-auto flex-1 py-2', dialog ? 'px-5' : 'px-3']">
        <p v-if="searchable && !(openKind === 'move' ? moveZonesShown : shareZonesShown).length && (openKind === 'move' || shareZones.length)"
           class="text-[11px] text-gray-500 italic px-1 py-2">{{ MOVE_NO_MATCH }}</p>
        <!-- Déplacer vers : liste cliquable d'usages, 1 clic = déplacement -->
        <template v-if="openKind === 'move'">
          <div v-for="g in moveZonesShown" :key="g.zone_id" class="mb-2 last:mb-0">
            <!-- Sticky en haut du scroller : le nom de la zone reste visible
                 tant qu'on scroll dans ses items, puis est remplacé par le
                 suivant. -mx-3 px-3 étend le bandeau bleuté jusqu'aux bords. -->
            <p :class="['sticky top-0 z-10 py-1 mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-700 bg-slate-100 border-y border-slate-200', dialog ? '-mx-5 px-5' : '-mx-3 px-3']">
              {{ g.zone_name }}
            </p>
            <button
              v-for="s in g.items"
              :key="s.id"
              type="button"
              :aria-disabled="s.id === device.system_id || saving ? 'true' : undefined"
              v-tooltip="s.id === device.system_id ? 'Usage actuel de l’équipement' : null"
              @click="onMove(s.id)"
              :class="['w-full text-left px-2 py-1.5 rounded flex items-center gap-2 transition',
                       s.id === device.system_id
                         ? 'bg-indigo-50 text-indigo-700 font-medium cursor-default'
                         : 'hover:bg-gray-50 text-gray-700']"
            >
              <FontAwesomeIcon
                :icon="['fas', resolveFaIconName(decorOf(s).icon)]"
                :style="{ color: decorOf(s).color }"
                class="w-3.5 h-3.5 shrink-0"
              />
              <span class="truncate flex-1" v-tooltip.overflow>{{ labelOf(s) }}</span>
              <span v-if="s.id === device.system_id" class="text-[10px] text-indigo-500 shrink-0"
                    v-tooltip="'Usage actuel de l’équipement'">actuel</span>
            </button>
          </div>
        </template>

        <!-- Partager : usages supplémentaires (multi-sélection). Les usages
             « non concernés » sont masqués. -->
        <template v-else>
          <div v-for="g in shareZonesShown" :key="g.zone_id" class="mb-2 last:mb-0">
            <p :class="['sticky top-0 z-10 py-1 mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-700 bg-slate-100 border-y border-slate-200', dialog ? '-mx-5 px-5' : '-mx-3 px-3']">
              {{ g.zone_name }}
            </p>
            <label
              v-for="s in g.items"
              :key="s.id"
              class="px-1 py-1 flex items-center gap-2 hover:bg-gray-50 cursor-pointer rounded"
            >
              <input
                type="checkbox"
                :checked="extraIds.includes(s.id)"
                :disabled="saving"
                @change="e => toggleShare(s.id, e.target.checked)"
                class="rounded border-gray-300 shrink-0"
              />
              <FontAwesomeIcon
                :icon="['fas', resolveFaIconName(decorOf(s).icon)]"
                :style="{ color: decorOf(s).color }"
                class="w-3.5 h-3.5 shrink-0"
              />
              <span class="text-gray-700 truncate" v-tooltip.overflow>{{ labelOf(s) }}</span>
            </label>
          </div>
          <p v-if="!shareZones.length" class="text-[11px] text-gray-400 italic px-1 py-2">
            Aucun autre usage présent où partager cet équipement.
          </p>
        </template>
      </div>
      <div v-if="dialog" class="px-5 py-3 border-t border-slate-200 flex items-center gap-3 shrink-0">
        <span class="min-w-0 flex-1 text-xs text-slate-600">{{ moveShareFooter(openKind, zonesServed) }}</span>
        <button type="button" @click="close"
                class="h-9 px-4 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition">Fermer</button>
      </div>
    </div>
    </div>
  </Teleport>
</template>
