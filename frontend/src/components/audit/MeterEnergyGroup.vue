<script setup>
// Section détaillée d'une énergie : header coloré + KPI + table compacte
// des compteurs de cette énergie, avec édition inline (toggles, protocoles)
// + actions secondaires (notes, photos, voice, dupliquer, supprimer).
//
// Cohérent avec la PWA (qui regroupe aussi par énergie) et la matrice de
// couverture au-dessus (qui scrolle ici quand on clique sur une pill).
// Drag-drop intra-énergie via SortableJS (on ne change pas un compteur
// d'énergie par drag — l'énergie est une propriété stable).
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import Sortable from 'sortablejs'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
import { PencilSquareIcon, TrashIcon, DocumentDuplicateIcon, PlusIcon, Bars3Icon, ChevronDownIcon } from '@heroicons/vue/24/outline'
import MeterUsagePill from '@/components/MeterUsagePill.vue'
import ProtocolMultiPicker from '@/components/ProtocolMultiPicker.vue'
import SegmentedToggle from '@/components/SegmentedToggle.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import VoiceNoteButton from '@/components/VoiceNoteButton.vue'
import { meterUsageLabel } from '@/lib/meter-options'

const props = defineProps({
  energy: { type: Object, required: true }, // { value, label, icon, color }
  meters: { type: Array, required: true },
  document: { type: Object, default: null },
  protocolOptions: { type: Array, required: true },
  meterUsages: { type: Array, required: true }, // pour le contextLabel des notes
  highlightId: { type: Number, default: null }, // surligne temporairement une ligne
})
const emit = defineEmits([
  'patch-meter', 'duplicate-meter', 'remove-meter', 'open-notes',
  'add-meter', 'reorder',
])

// Replié par défaut si 0 compteur (sections vides → moins de bruit).
const collapsed = ref(props.meters.length === 0)
watch(() => props.meters.length, (n, prev) => {
  // Quand le 1er compteur arrive, on déplie automatiquement la section.
  if (prev === 0 && n > 0) collapsed.value = false
})

function toggle() { collapsed.value = !collapsed.value }

const stats = computed(() => {
  const arr = props.meters
  return {
    total: arr.length,
    present: arr.filter(m => m.present_actual).length,
    missing: arr.filter(m => m.required && !m.present_actual && !m.out_of_service).length,
  }
})

function meterContextLabel(m) {
  return (m.zone_name || 'Compteur général') + ' — '
    + (props.meterUsages.find(u => u.value === m.usage)?.label || meterUsageLabel(m.usage))
}
function hasNotes(html) {
  if (!html) return false
  return html.replace(/<[^>]*>/g, '').trim().length > 0
}

// Drag-drop intra-énergie. On émet le tableau d'ids dans l'ordre actuel
// (parent applique reorderBacsMeters sur l'audit complet en mergeant).
const tbodyRef = ref(null)
let sortable = null
function teardownSortable() {
  if (sortable) { try { sortable.destroy() } catch { /* ignore */ } sortable = null }
}
function setupSortable() {
  teardownSortable()
  const el = tbodyRef.value
  if (!el || collapsed.value) return
  sortable = Sortable.create(el, {
    draggable: 'tr.meter-row',
    handle: '.drag-handle',
    animation: 150,
    ghostClass: 'sortable-ghost',
    onEnd: (evt) => {
      if (evt.oldIndex === evt.newIndex) return
      const ids = Array.from(el.querySelectorAll('tr.meter-row'))
        .map(tr => parseInt(tr.getAttribute('data-id'), 10))
        .filter(Boolean)
      emit('reorder', { energy: props.energy.value, ids })
    },
  })
}
watch([() => props.meters, collapsed], async () => {
  await nextTick()
  setupSortable()
}, { immediate: true, flush: 'post' })
onBeforeUnmount(teardownSortable)
</script>

<template>
  <div :class="['bg-white rounded-2xl border overflow-hidden transition',
                meters.length === 0 ? 'border-gray-200 opacity-80' : 'border-gray-200']">
    <!-- Header énergie : couleur + KPI + toggle -->
    <button type="button" @click="toggle"
            class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition">
      <span class="w-10 h-10 rounded-xl inline-flex items-center justify-center shrink-0"
            :style="{ background: energy.color + '1a', color: energy.color }">
        <FontAwesomeIcon :icon="['fas', energy.icon.replace(/^fa-/, '')]" class="w-5 h-5" />
      </span>
      <div class="flex-1 min-w-0">
        <p class="text-base font-semibold text-gray-900 leading-tight">{{ energy.label }}</p>
        <p class="text-xs text-gray-500 mt-0.5">
          <span v-if="!stats.total">Aucun compteur</span>
          <template v-else>
            <span>{{ stats.total }} compteur{{ stats.total > 1 ? 's' : '' }}</span>
            <span class="mx-1 text-gray-300">·</span>
            <span class="text-emerald-700 font-medium">{{ stats.present }} présent{{ stats.present > 1 ? 's' : '' }}</span>
            <template v-if="stats.missing > 0">
              <span class="mx-1 text-gray-300">·</span>
              <span class="text-red-700 font-medium">{{ stats.missing }} requis manquant{{ stats.missing > 1 ? 's' : '' }}</span>
            </template>
          </template>
        </p>
      </div>
      <ChevronDownIcon :class="['w-5 h-5 text-gray-400 transition-transform shrink-0',
                                collapsed ? '-rotate-90' : '']" />
    </button>

    <!-- Table compacte des compteurs (visible si déplié) -->
    <div v-show="!collapsed" class="border-t border-gray-100">
      <div v-if="meters.length" class="overflow-x-auto">
        <table class="data-table w-full text-sm">
          <thead>
            <tr>
              <th class="w-8"></th>
              <th>Zone</th>
              <th>Usage</th>
              <th>Requis</th>
              <th>Présent</th>
              <th>Communicant</th>
              <th>Câblé</th>
              <th>Hors service</th>
              <th>Protocoles</th>
              <th class="text-right">Actions</th>
            </tr>
          </thead>
          <tbody ref="tbodyRef">
            <tr v-for="m in meters" :key="m.id"
                :data-id="m.id"
                :class="['meter-row',
                  m.out_of_service ? 'opacity-50' : '',
                  m.required && !m.present_actual && !m.out_of_service ? 'bg-red-50/40' : '',
                  highlightId === m.id ? 'ring-2 ring-amber-300 bg-amber-50/40' : '']">
              <td class="align-middle">
                <button type="button"
                        class="drag-handle inline-flex p-1 text-gray-300 hover:text-gray-600 cursor-grab active:cursor-grabbing"
                        v-tooltip="'Glisser pour réordonner'">
                  <Bars3Icon class="w-4 h-4" />
                </button>
              </td>
              <td class="text-gray-700 whitespace-nowrap">
                <span v-if="m.required && !m.present_actual && !m.out_of_service"
                      class="text-red-600 mr-1" v-tooltip="'Compteur requis non présent'">⚠</span>
                {{ m.zone_name || 'Compteur général' }}
              </td>
              <td><MeterUsagePill :usage="m.usage" /></td>
              <td class="whitespace-nowrap">
                <SegmentedToggle compact :model-value="!!m.required"
                                 tooltip="Compteur requis par le décret R175"
                                 @update:model-value="v => emit('patch-meter', { meter: m, patch: { required: v } })" />
              </td>
              <td class="whitespace-nowrap">
                <SegmentedToggle compact :model-value="!!m.present_actual"
                                 tooltip="Compteur présent sur site ?"
                                 @update:model-value="v => emit('patch-meter', { meter: m, patch: { present_actual: v } })" />
              </td>
              <td class="whitespace-nowrap">
                <SegmentedToggle v-if="m.present_actual" compact :model-value="!!m.communicating"
                                 tooltip="Compteur communicant ?"
                                 @update:model-value="v => emit('patch-meter', { meter: m, patch: v
                                   ? { communicating: true }
                                   : { communicating: false, communication_protocols: null, communication_protocol: null } })" />
                <span v-else class="text-gray-300">—</span>
              </td>
              <td class="whitespace-nowrap">
                <SegmentedToggle v-if="m.present_actual" compact :model-value="!!m.wired"
                                 tooltip="Communication câblée vers la GTB ?"
                                 @update:model-value="v => emit('patch-meter', { meter: m, patch: { wired: v } })" />
                <span v-else class="text-gray-300">—</span>
              </td>
              <td class="whitespace-nowrap">
                <SegmentedToggle compact yes-danger :model-value="!!m.out_of_service"
                                 tooltip="Compteur hors service ? (HS = ignoré du plan d'action)"
                                 @update:model-value="v => emit('patch-meter', { meter: m, patch: { out_of_service: v } })" />
              </td>
              <td>
                <div class="min-w-32">
                  <ProtocolMultiPicker
                    :model-value="m.communication_protocols || (m.communication_protocol && m.communication_protocol !== 'non_communicant' ? JSON.stringify([m.communication_protocol]) : null)"
                    :disabled="!m.communicating"
                    :options="protocolOptions"
                    size="xs"
                    @update:modelValue="v => emit('patch-meter', { meter: m, patch: { communication_protocols: v, communication_protocol: null } })"
                  />
                </div>
              </td>
              <td class="whitespace-nowrap text-right">
                <div class="inline-flex items-center gap-1">
                  <button
                    type="button"
                    @click="emit('open-notes', m)"
                    :class="['btn-icon', hasNotes(m.notes_html || m.notes) && 'is-active']"
                    v-tooltip="hasNotes(m.notes_html || m.notes) ? 'Modifier les notes' : 'Ajouter une note'">
                    <PencilSquareIcon class="w-4 h-4" />
                  </button>
                  <BacsPhotoButton
                    v-if="document?.site_uuid"
                    :site-uuid="document.site_uuid"
                    :attach-to="{ meter_id: m.id }"
                    :label="meterContextLabel(m)"
                  />
                  <VoiceNoteButton
                    v-if="document?.site_uuid"
                    :site-uuid="document.site_uuid"
                    :attach-to="{ meter_id: m.id }"
                    :label="meterContextLabel(m)"
                  />
                  <button @click="emit('duplicate-meter', m)" class="btn-icon" v-tooltip="'Dupliquer'">
                    <DocumentDuplicateIcon class="w-4 h-4" />
                  </button>
                  <button @click="emit('remove-meter', m)" class="btn-icon btn-icon-danger" v-tooltip="'Supprimer'">
                    <TrashIcon class="w-4 h-4" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Footer : bouton ajouter dans cette énergie -->
      <div class="px-3 py-3 border-t border-gray-100 bg-gray-50/40">
        <button type="button"
                @click="emit('add-meter', { meter_type: energy.value })"
                class="btn-add">
          <PlusIcon class="w-4 h-4 shrink-0" /> Ajouter un compteur {{ energy.label.toLowerCase() }}
        </button>
      </div>
    </div>
  </div>
</template>
