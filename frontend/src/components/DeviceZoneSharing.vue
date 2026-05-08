<script setup>
/**
 * Sélecteur multi-zones pour partager un équipement physique entre plusieurs
 * zones fonctionnelles (chaufferie commune Logistique + Ateliers, CTA mutualisée,
 * luminaire qui éclaire 2 plateaux…).
 *
 * Affiche :
 * - Un badge « Partagé · +N » si l'équipement dessert plus d'une zone
 * - Un dropdown checkboxes pour ajouter / retirer des zones supplémentaires
 *   (la zone d'origine du système parent est marquée et non décochable)
 *
 * Émet `updated` après un patch réussi (le parent rafraîchit son state).
 *
 * Props :
 *   device : { id, extra_zone_ids }
 *   originZoneId : id de la zone d'origine (du système parent)
 *   zones : [{ zone_id, name, ... }]   liste de zones du document
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { ShareIcon, CheckIcon } from '@heroicons/vue/24/outline'
import { updateBacsDeviceZones } from '@/api'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  device: { type: Object, required: true },
  originZoneId: { type: Number, required: true },
  zones: { type: Array, required: true },
})
const emit = defineEmits(['updated'])
const { error: notifyError, success } = useNotification()

const open = ref(false)
const saving = ref(false)
const rootRef = ref(null)

const extraIds = computed(() => props.device.extra_zone_ids || [])
const sharedCount = computed(() => extraIds.value.length)

const candidateZones = computed(() =>
  props.zones.filter(z => z.zone_id !== props.originZoneId),
)
const originZone = computed(() =>
  props.zones.find(z => z.zone_id === props.originZoneId),
)

function toggleOpen() { open.value = !open.value }
function close() { open.value = false }

async function toggleZone(zoneId, checked) {
  if (saving.value) return
  saving.value = true
  const next = new Set(extraIds.value)
  if (checked) next.add(zoneId); else next.delete(zoneId)
  try {
    await updateBacsDeviceZones(props.device.id, [...next])
    success(checked ? 'Zone ajoutée au partage' : 'Zone retirée du partage')
    emit('updated')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Mise à jour des zones impossible')
  } finally {
    saving.value = false
  }
}

const allChecked = computed(() =>
  candidateZones.value.length > 0 &&
  candidateZones.value.every(z => extraIds.value.includes(z.zone_id)),
)

async function toggleAll() {
  if (saving.value) return
  saving.value = true
  try {
    const next = allChecked.value ? [] : candidateZones.value.map(z => z.zone_id)
    await updateBacsDeviceZones(props.device.id, next)
    success(allChecked.value ? 'Toutes les zones retirées' : 'Toutes les zones ajoutées')
    emit('updated')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Mise à jour des zones impossible')
  } finally {
    saving.value = false
  }
}

// Le dropdown est téléporté au <body> pour échapper aux conteneurs en
// overflow:hidden des cartes système (qui clippaient la liste après 1-2 zones).
// Position fixed calculée depuis getBoundingClientRect du bouton.
const popupRef = ref(null)
const pos = ref({ top: 0, left: 0 })
const DROPDOWN_W = 256 // w-64 en px (Tailwind)

function updatePos() {
  const r = rootRef.value?.getBoundingClientRect()
  if (!r) return
  // Aligné à droite du bouton, sous le bouton, avec 4px d'espace.
  pos.value = {
    top: r.bottom + 4,
    left: Math.max(8, r.right - DROPDOWN_W),
  }
}

function onDocClick(e) {
  // Click en dehors du bouton ET en dehors du popup téléporté = fermer.
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
        'inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border transition whitespace-nowrap',
        sharedCount > 0
          ? 'border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
          : 'border-gray-200 text-gray-500 bg-white hover:border-gray-300 hover:text-gray-700',
      ]"
      v-tooltip="sharedCount > 0
        ? `Équipement partagé avec ${sharedCount} autre zone${sharedCount > 1 ? 's' : ''}`
        : 'Partager cet équipement avec d\'autres zones'"
    >
      <ShareIcon class="w-3.5 h-3.5 shrink-0" />
      <span v-if="sharedCount > 0">Partagé · +{{ sharedCount }}</span>
      <span v-else>+ Partager</span>
    </button>

  </div>

  <!-- Téléporté au <body> pour échapper au overflow:hidden des cartes parentes
       (qui clippait la liste après 1-2 zones visibles). -->
  <Teleport to="body">
    <div
      v-if="open"
      ref="popupRef"
      :style="{ position: 'fixed', top: pos.top + 'px', left: pos.left + 'px', width: DROPDOWN_W + 'px' }"
      class="z-60 bg-white border border-gray-200 rounded-lg shadow-lg text-sm flex flex-col max-h-112"
    >
      <!-- Header sticky -->
      <div class="px-3 py-2 border-b border-gray-100 shrink-0">
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs font-semibold uppercase tracking-wider text-gray-500">Zones desservies</p>
          <button
            v-if="candidateZones.length"
            type="button"
            @click="toggleAll"
            :disabled="saving"
            class="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50 whitespace-nowrap"
          >
            {{ allChecked ? 'Tout décocher' : 'Tout cocher' }}
          </button>
        </div>
        <p class="text-[11px] text-gray-400 mt-0.5">
          Cet équipement alimente / éclaire / ventile plusieurs zones ?
        </p>
      </div>
      <!-- Liste scrollable (zone d'origine + candidates) -->
      <div class="overflow-y-auto flex-1 py-1">
        <!-- Zone d'origine, marquée en lecture seule -->
        <div class="px-3 py-2 flex items-center gap-2 bg-gray-50 cursor-default">
          <CheckIcon class="w-4 h-4 text-gray-400 shrink-0" />
          <span class="text-gray-700 truncate">{{ originZone?.name || 'Zone d\'origine' }}</span>
          <span class="ml-auto text-[10px] text-gray-400 italic">Origine</span>
        </div>
        <!-- Zones candidates -->
        <div v-if="!candidateZones.length" class="px-3 py-2 text-xs text-gray-400 italic">
          Aucune autre zone à partager.
        </div>
        <label
          v-for="z in candidateZones"
          :key="z.zone_id"
          class="px-3 py-2 flex items-center gap-2 hover:bg-gray-50 cursor-pointer"
        >
          <input
            type="checkbox"
            :checked="extraIds.includes(z.zone_id)"
            :disabled="saving"
            @change="e => toggleZone(z.zone_id, e.target.checked)"
            class="rounded border-gray-300 shrink-0"
          />
          <span class="text-gray-700 truncate">{{ z.name }}</span>
        </label>
      </div>
    </div>
  </Teleport>
</template>
