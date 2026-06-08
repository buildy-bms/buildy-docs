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
import { ArrowsRightLeftIcon, ShareIcon } from '@heroicons/vue/24/outline'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { moveBacsDevice, shareBacsDevice } from '@/api'
import { systemUsageLabel } from '@/lib/audit-options'
import { resolveFaIconName } from '@/lib/equipment-icons'
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
})
const emit = defineEmits(['updated'])
const { error: notifyError, success } = useNotification()

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
    success('Système déplacé')
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
watch(openKind, async (v) => {
  if (v) {
    await nextTick()
    updatePos()
    window.addEventListener('scroll', updatePos, true)
    window.addEventListener('resize', updatePos)
  } else {
    window.removeEventListener('scroll', updatePos, true)
    window.removeEventListener('resize', updatePos)
  }
})
onMounted(() => document.addEventListener('mousedown', onDocClick))
onBeforeUnmount(() => {
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
      v-tooltip="'Partager dans d\'autres usages'"
    >
      <ShareIcon class="w-4 h-4 shrink-0" />
      <span v-if="sharedCount > 0"
            class="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 inline-flex items-center justify-center text-[9px] font-semibold bg-emerald-600 text-white rounded-full">
        +{{ sharedCount }}
      </span>
    </button>
  </div>

  <Teleport to="body">
    <div
      v-if="openKind"
      ref="popupRef"
      :style="{ position: 'fixed', top: pos.top + 'px', left: pos.left + 'px', width: DROPDOWN_W + 'px', maxHeight: pos.maxHeight + 'px' }"
      class="z-60 bg-white border border-gray-200 rounded-lg shadow-lg text-sm flex flex-col"
    >
      <div class="px-3 py-2 border-b border-gray-100 shrink-0">
        <p class="text-xs font-semibold uppercase tracking-wider text-gray-500">
          {{ openKind === 'move' ? 'Déplacer vers' : 'Partager dans d\'autres usages' }}
        </p>
        <p class="text-[11px] text-gray-400 mt-0.5 truncate">
          {{ device.name || 'Système technique' }}
        </p>
      </div>

      <div class="overflow-y-auto flex-1 py-2 px-3">
        <!-- Déplacer vers : liste cliquable d'usages, 1 clic = déplacement -->
        <template v-if="openKind === 'move'">
          <div v-for="g in systemsByZone" :key="g.zone_id" class="mb-2 last:mb-0">
            <!-- Sticky en haut du scroller : le nom de la zone reste visible
                 tant qu'on scroll dans ses items, puis est remplacé par le
                 suivant. -mx-3 px-3 étend le bandeau bleuté jusqu'aux bords. -->
            <p class="sticky top-0 z-10 -mx-3 px-3 py-1 mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-700 bg-slate-100 border-y border-slate-200">
              {{ g.zone_name }}
            </p>
            <button
              v-for="s in g.items"
              :key="s.id"
              type="button"
              :disabled="saving || s.id === device.system_id"
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
              <span class="truncate flex-1">{{ labelOf(s) }}</span>
              <span v-if="s.id === device.system_id" class="text-[10px] text-indigo-500 shrink-0">actuel</span>
            </button>
          </div>
        </template>

        <!-- Partager : usages supplémentaires (multi-sélection). Les usages
             « non concernés » sont masqués. -->
        <template v-else>
          <div v-for="g in shareZones" :key="g.zone_id" class="mb-2 last:mb-0">
            <p class="sticky top-0 z-10 -mx-3 px-3 py-1 mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-700 bg-slate-100 border-y border-slate-200">
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
              <span class="text-gray-700 truncate">{{ labelOf(s) }}</span>
            </label>
          </div>
          <p v-if="!shareZones.length" class="text-[11px] text-gray-400 italic px-1 py-2">
            Aucun autre usage présent où partager ce système.
          </p>
        </template>
      </div>
    </div>
  </Teleport>
</template>
