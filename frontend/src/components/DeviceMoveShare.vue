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
import { ArrowsRightLeftIcon } from '@heroicons/vue/24/outline'
import { moveBacsDevice, shareBacsDevice } from '@/api'
import { systemUsageLabel } from '@/lib/audit-options'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  device: { type: Object, required: true },
  systems: { type: Array, required: true },
})
const emit = defineEmits(['updated'])
const { error: notifyError, success } = useNotification()

const open = ref(false)
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

function labelOf(s) { return systemUsageLabel(s) }

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

function toggleOpen() { open.value = !open.value }
function close() { open.value = false }

// Popover téléporté au <body> pour échapper aux overflow:hidden des cartes.
const popupRef = ref(null)
const pos = ref({ top: 0, left: 0 })
const DROPDOWN_W = 288

function updatePos() {
  const r = rootRef.value?.getBoundingClientRect()
  if (!r) return
  pos.value = { top: r.bottom + 4, left: Math.max(8, r.right - DROPDOWN_W) }
}
function onDocClick(e) {
  if (rootRef.value && rootRef.value.contains(e.target)) return
  if (popupRef.value && popupRef.value.contains(e.target)) return
  close()
}
watch(open, async (v) => {
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
  <div ref="rootRef" class="relative inline-flex shrink-0 whitespace-nowrap">
    <button
      type="button"
      @click="toggleOpen"
      :class="[
        'relative p-1.5 rounded-md transition',
        sharedCount > 0
          ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
          : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100',
      ]"
      v-tooltip="'Déplacer vers un autre usage / partager'"
    >
      <ArrowsRightLeftIcon class="w-4 h-4 shrink-0" />
      <span v-if="sharedCount > 0"
            class="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 inline-flex items-center justify-center text-[9px] font-semibold bg-emerald-600 text-white rounded-full">
        +{{ sharedCount }}
      </span>
    </button>
  </div>

  <Teleport to="body">
    <div
      v-if="open"
      ref="popupRef"
      :style="{ position: 'fixed', top: pos.top + 'px', left: pos.left + 'px', width: DROPDOWN_W + 'px' }"
      class="z-60 bg-white border border-gray-200 rounded-lg shadow-lg text-sm flex flex-col max-h-112"
    >
      <div class="px-3 py-2 border-b border-gray-100 shrink-0">
        <p class="text-xs font-semibold uppercase tracking-wider text-gray-500">Déplacer / partager</p>
        <p class="text-[11px] text-gray-400 mt-0.5 truncate">
          {{ device.name || 'Système technique' }}
        </p>
      </div>

      <div class="overflow-y-auto flex-1 py-2 px-3 space-y-3">
        <!-- Déplacer vers : liste cliquable d'usages, 1 clic = déplacement -->
        <div>
          <p class="text-[11px] font-medium text-gray-600 mb-1">Déplacer vers…</p>
          <div v-for="g in systemsByZone" :key="g.zone_id" class="mb-1.5 last:mb-0">
            <p class="text-[10px] uppercase tracking-wider text-gray-400 px-1">{{ g.zone_name }}</p>
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
              <span class="truncate flex-1">{{ labelOf(s) }}</span>
              <span v-if="s.id === device.system_id" class="text-[10px] text-indigo-500 shrink-0">actuel</span>
            </button>
          </div>
        </div>

        <!-- Aussi présent dans : partage multi-usages -->
        <div class="border-t border-gray-100 pt-2">
          <p class="text-[11px] font-medium text-gray-600 mb-1">Aussi présent dans</p>
          <div v-for="g in systemsByZone" :key="g.zone_id" class="mb-1.5 last:mb-0">
            <p class="text-[10px] uppercase tracking-wider text-gray-400 px-1">{{ g.zone_name }}</p>
            <label
              v-for="s in g.items.filter(x => x.id !== device.system_id)"
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
              <span class="text-gray-700 truncate">{{ labelOf(s) }}</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
