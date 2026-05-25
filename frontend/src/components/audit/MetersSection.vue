<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import Sortable from 'sortablejs'
import { BoltIcon, PencilSquareIcon, PlusIcon, TrashIcon, DocumentDuplicateIcon, Bars3Icon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import Tooltip from '@/components/Tooltip.vue'
import PhotoDropTr from '@/components/PhotoDropTr.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import VoiceNoteButton from '@/components/VoiceNoteButton.vue'
import MeterTypePill from '@/components/MeterTypePill.vue'
import MeterUsagePill from '@/components/MeterUsagePill.vue'
import ProtocolMultiPicker from '@/components/ProtocolMultiPicker.vue'
import DataTableSortHeader from '@/components/DataTableSortHeader.vue'
import SegmentedToggle from '@/components/SegmentedToggle.vue'
import { useTableSort } from '@/composables/useTableSort'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import { updateBacsMeter, deleteBacsMeter, duplicateBacsMeter, reorderBacsMeters } from '@/api'

// Section 4 — Compteurs et mesurage (R175-3 1°).
const props = defineProps({
  meterUsages: { type: Array, required: true },
  protocolOptions: { type: Array, required: true },
  step: { type: Object, default: null },
  active: { type: Boolean, default: false },
})
const emit = defineEmits([
  'open-notes', 'validate-step', 'invalidate-step',
  'add-meter',
])

const audit = useAuditStore()
const { meters, document } = storeToRefs(audit)
const { error } = useNotification()
const { confirm } = useConfirm()

async function patchMeter(m, patch) {
  Object.assign(m, patch)
  try {
    await updateBacsMeter(m.id, patch)
    await audit.refreshActionItems()
  } catch { error('Sauvegarde impossible') }
}

async function removeMeter(m) {
  const ok = await confirm({
    title: 'Supprimer ce compteur ?',
    message: `Compteur ${m.usage} ${m.meter_type} en zone « ${m.zone_name || 'général'} ».`,
    confirmLabel: 'Supprimer',
  })
  if (!ok) return
  try {
    await deleteBacsMeter(m.id)
    await audit.refreshAuditCore()
  } catch { error('Suppression impossible') }
}

async function dupMeter(m) {
  try {
    await duplicateBacsMeter(m.id)
    await audit.refreshAuditCore()
  } catch { error('Duplication impossible') }
}

function refreshAuditData() { return audit.refreshAuditCore() }

// Tri data-table (clic en-tête, asc → desc → off).
const { sortKey, sortDir, toggleSort, sortedRows } = useTableSort()
function sortMeterValue(m, key) {
  if (key === 'zone') return (m.zone_name || '').toLowerCase()
  if (key === 'meter_type') return (m.meter_type || '').toLowerCase()
  if (key === 'usage') return (m.usage || '').toLowerCase()
  return ''
}
const sortedMeters = computed(() => sortedRows(meters.value, sortMeterValue))

function hasNotes(html) {
  if (!html) return false
  return html.replace(/<[^>]*>/g, '').trim().length > 0
}

// Drag & drop des compteurs (desktop). API : reorderBacsMeters(docId, ids).
const metersBodyRef = ref(null)
let metersSortable = null
function teardownMetersSortable() {
  if (metersSortable) { try { metersSortable.destroy() } catch { /* ignore */ } metersSortable = null }
}
function setupMetersSortable() {
  teardownMetersSortable()
  const el = metersBodyRef.value
  if (!el) return
  metersSortable = Sortable.create(el, {
    draggable: 'tr.meter-row',
    handle: '.drag-handle',
    animation: 150,
    ghostClass: 'sortable-ghost',
    onEnd: async (evt) => {
      if (evt.oldIndex === evt.newIndex) return
      const ids = Array.from(el.querySelectorAll('tr.meter-row'))
        .map(tr => parseInt(tr.getAttribute('data-id'), 10))
        .filter(Boolean)
      try {
        await reorderBacsMeters(audit.docId, ids)
        await audit.refreshAuditCore()
      } catch {
        error('Réorganisation impossible')
        await audit.refreshAuditCore()
      }
    },
  })
}
watch(meters, async () => {
  await nextTick()
  setupMetersSortable()
}, { immediate: true, flush: 'post' })
onBeforeUnmount(teardownMetersSortable)
</script>

<template>
  <CollapsibleSection storage-key="meters" section-id="section-meters" :active="active">
    <template #header>
      <SectionHeader number="5" :title="'Compteurs et mesurage'"
                     :subtitle="audit.isBacs ? 'R175-3 1° — suivi continu, pas horaire, conservation 5 ans' : 'Compteurs présents et raccordés'"
                     :icon="BoltIcon" icon-color="text-emerald-600"
                     :step="step"
                     @validate="emit('validate-step', $event)"
                     @invalidate="emit('invalidate-step', $event)">
        <template v-if="audit.isBacs" #subtitle-extra><R175Tooltip article="R175-3 1°" /></template>
      </SectionHeader>
    </template>
    <template #summary>
      <span v-if="meters.length">
        {{ meters.length }} compteur{{ meters.length > 1 ? 's' : '' }}
        · {{ meters.filter(m => m.present_actual).length }} présent{{ meters.filter(m => m.present_actual).length > 1 ? 's' : '' }}
        · {{ meters.filter(m => m.communicating).length }} communicant{{ meters.filter(m => m.communicating).length > 1 ? 's' : '' }}
        · {{ meters.filter(m => m.required && !m.present_actual && !m.out_of_service).length }} requis manquant{{ meters.filter(m => m.required && !m.present_actual && !m.out_of_service).length > 1 ? 's' : '' }}
      </span>
      <span v-else class="italic">Aucun compteur listé</span>
    </template>
    <!-- Desktop : data-table aligné (>=768px). Flags split en 5 colonnes
         (Req. / Prés. / Comm. / Câbl. / HS), chacune triable visuellement
         et cliquable individuellement. -->
    <div class="hidden md:block overflow-x-auto">
    <table class="data-table w-full text-sm">
      <thead>
        <tr>
          <th class="w-8"></th>
          <DataTableSortHeader sort-key="zone" :active-key="sortKey" :dir="sortDir" @toggle="toggleSort">Zone</DataTableSortHeader>
          <DataTableSortHeader sort-key="meter_type" :active-key="sortKey" :dir="sortDir" @toggle="toggleSort">Énergie</DataTableSortHeader>
          <DataTableSortHeader sort-key="usage" :active-key="sortKey" :dir="sortDir" @toggle="toggleSort">Usage</DataTableSortHeader>
          <th>Requis</th>
          <th>Présent</th>
          <th>Communicant</th>
          <th>Câblé</th>
          <th>Hors service</th>
          <th>Protocoles</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody ref="metersBodyRef">
        <PhotoDropTr v-for="m in sortedMeters" :key="m.id"
                     :row-class="['meter-row',
                       m.out_of_service ? 'opacity-50' : '',
                       m.required && !m.present_actual && !m.out_of_service ? 'bg-red-50/40' : ''
                     ].join(' ')"
                     :data-id="m.id"
                     :site-uuid="document?.site_uuid || ''"
                     :attach-to="{ meter_id: m.id }"
                     :enabled="!!document?.site_uuid"
                     @changed="refreshAuditData">
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
          <td><MeterTypePill :type="m.meter_type" /></td>
          <td><MeterUsagePill :usage="m.usage" /></td>
          <td class="whitespace-nowrap">
            <SegmentedToggle compact :model-value="!!m.required"
                             tooltip="Compteur requis par le décret R175"
                             @update:model-value="v => patchMeter(m, { required: v })" />
          </td>
          <td class="whitespace-nowrap">
            <SegmentedToggle compact :model-value="!!m.present_actual"
                             tooltip="Compteur présent sur site ?"
                             @update:model-value="v => patchMeter(m, { present_actual: v })" />
          </td>
          <td class="whitespace-nowrap">
            <SegmentedToggle v-if="m.present_actual" compact :model-value="!!m.communicating"
                             tooltip="Compteur communicant ?"
                             @update:model-value="v => patchMeter(m, v
                               ? { communicating: true }
                               : { communicating: false, communication_protocols: null, communication_protocol: null })" />
            <span v-else class="text-gray-300">—</span>
          </td>
          <td class="whitespace-nowrap">
            <SegmentedToggle v-if="m.present_actual" compact :model-value="!!m.wired"
                             tooltip="Communication câblée vers la GTB ?"
                             @update:model-value="v => patchMeter(m, { wired: v })" />
            <span v-else class="text-gray-300">—</span>
          </td>
          <td class="whitespace-nowrap">
            <SegmentedToggle compact yes-danger :model-value="!!m.out_of_service"
                             tooltip="Compteur hors service ? (HS = ignoré du plan d'action)"
                             @update:model-value="v => patchMeter(m, { out_of_service: v })" />
          </td>
          <td>
            <div class="min-w-32">
              <ProtocolMultiPicker
                :model-value="m.communication_protocols || (m.communication_protocol && m.communication_protocol !== 'non_communicant' ? JSON.stringify([m.communication_protocol]) : null)"
                :disabled="!m.communicating"
                :options="protocolOptions"
                size="xs"
                @update:modelValue="v => patchMeter(m, { communication_protocols: v, communication_protocol: null })"
              />
            </div>
          </td>
          <td class="whitespace-nowrap">
            <div class="inline-flex items-center gap-1">
              <button
                type="button"
                @click="emit('open-notes', { title: 'Notes compteur', contextLabel: (m.zone_name || 'Compteur général') + ' — ' + (meterUsages.find(u => u.value === m.usage)?.label || m.usage), entityType: 'meter', entityRef: m, currentHtml: m.notes_html || m.notes || '' })"
                :class="['btn-icon', hasNotes(m.notes_html || m.notes) && 'is-active']"
                v-tooltip="hasNotes(m.notes_html || m.notes) ? 'Modifier les notes' : 'Ajouter une note'">
                <PencilSquareIcon class="w-4 h-4" />
              </button>
              <BacsPhotoButton
                v-if="document?.site_uuid"
                :site-uuid="document.site_uuid"
                :attach-to="{ meter_id: m.id }"
                :label="(m.zone_name || 'Général') + ' / ' + (meterUsages.find(u => u.value === m.usage)?.label || m.usage)"
              />
              <VoiceNoteButton
                v-if="document?.site_uuid"
                :site-uuid="document.site_uuid"
                :attach-to="{ meter_id: m.id }"
                :label="(m.zone_name || 'Général') + ' / ' + (meterUsages.find(u => u.value === m.usage)?.label || m.usage)"
              />
              <button @click="dupMeter(m)" class="btn-icon" v-tooltip="'Dupliquer'">
                <DocumentDuplicateIcon class="w-4 h-4" />
              </button>
              <button @click="removeMeter(m)" class="btn-icon btn-icon-danger" v-tooltip="'Supprimer'">
                <TrashIcon class="w-4 h-4" />
              </button>
            </div>
          </td>
        </PhotoDropTr>
        <tr>
          <td colspan="11" class="px-3 py-3">
            <button @click="emit('add-meter')" class="btn-add">
              <PlusIcon class="w-4 h-4 shrink-0" /> Ajouter un compteur
            </button>
          </td>
        </tr>
      </tbody>
      <tfoot v-if="!meters.length">
        <tr>
          <td colspan="11" class="px-5 py-6 text-center text-xs text-gray-500">
            Aucun compteur listé. Renseigne les compteurs requis (R175-3 1°) à mesure de la visite.
          </td>
        </tr>
      </tfoot>
    </table>
    </div>

    <!-- Mobile : cards empilées (<768px) -->
    <div class="md:hidden divide-y divide-gray-100">
      <div v-for="m in meters" :key="`m-${m.id}`"
           :class="['p-3 space-y-2',
             m.out_of_service ? 'opacity-60' : '',
             m.required && !m.present_actual && !m.out_of_service ? 'bg-red-50/40 border-l-4 border-l-red-300' : '']">
        <!-- Header card : zone + actions -->
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span v-if="m.required && !m.present_actual && !m.out_of_service"
                    class="text-red-600" v-tooltip="'Compteur requis non présent'">⚠</span>
              <span v-truncate-tooltip class="font-medium text-sm text-gray-800 truncate">
                {{ m.zone_name || 'Compteur général' }}
              </span>
            </div>
            <div class="flex items-center gap-1.5 mt-1">
              <MeterTypePill :type="m.meter_type" />
              <MeterUsagePill :usage="m.usage" />
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button @click="dupMeter(m)" class="tap-target inline-flex items-center justify-center text-gray-400 hover:text-indigo-600 rounded-lg" aria-label="Dupliquer">
              <DocumentDuplicateIcon class="w-5 h-5" />
            </button>
            <button @click="removeMeter(m)" class="tap-target inline-flex items-center justify-center text-gray-400 hover:text-red-600 rounded-lg" aria-label="Supprimer">
              <TrashIcon class="w-5 h-5" />
            </button>
          </div>
        </div>
        <!-- État compteur : segmented toggles (présent / absent explicite) -->
        <div class="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <label class="flex items-center justify-between gap-2">
            <span class="text-gray-700">Requis ?</span>
            <SegmentedToggle compact :model-value="!!m.required"
                             @update:model-value="v => patchMeter(m, { required: v })" />
          </label>
          <label class="flex items-center justify-between gap-2">
            <span class="text-gray-700">Présent ?</span>
            <SegmentedToggle compact :model-value="!!m.present_actual"
                             @update:model-value="v => patchMeter(m, { present_actual: v })" />
          </label>
          <label v-if="m.present_actual" class="flex items-center justify-between gap-2">
            <span class="text-gray-700">Communicant ?</span>
            <SegmentedToggle compact :model-value="!!m.communicating"
                             @update:model-value="v => patchMeter(m, v
                               ? { communicating: true }
                               : { communicating: false, communication_protocols: null, communication_protocol: null })" />
          </label>
          <label v-if="m.present_actual" class="flex items-center justify-between gap-2">
            <span class="text-gray-700">Câblé GTB ?</span>
            <SegmentedToggle compact :model-value="!!m.wired"
                             @update:model-value="v => patchMeter(m, { wired: v })" />
          </label>
          <label class="flex items-center justify-between gap-2 col-span-2">
            <span class="text-gray-700">Hors service ?</span>
            <SegmentedToggle compact yes-danger :model-value="!!m.out_of_service"
                             @update:model-value="v => patchMeter(m, { out_of_service: v })" />
          </label>
        </div>
        <!-- Protocole(s) -->
        <div v-if="m.communicating">
          <ProtocolMultiPicker
            :model-value="m.communication_protocols || (m.communication_protocol && m.communication_protocol !== 'non_communicant' ? JSON.stringify([m.communication_protocol]) : null)"
            :options="protocolOptions"
            size="xs"
            @update:modelValue="v => patchMeter(m, { communication_protocols: v, communication_protocol: null })"
          />
        </div>
        <!-- Notes + Photos -->
        <div class="flex items-center gap-2">
          <button
            type="button"
            @click="emit('open-notes', { title: 'Notes compteur', contextLabel: (m.zone_name || 'Compteur général') + ' — ' + (meterUsages.find(u => u.value === m.usage)?.label || m.usage), entityType: 'meter', entityRef: m, currentHtml: m.notes_html || m.notes || '' })"
            :class="['flex-1 tap-target inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition',
              hasNotes(m.notes_html || m.notes)
                ? 'border-indigo-300 text-indigo-700 bg-indigo-50'
                : 'border-gray-200 text-gray-600 bg-white']">
            <PencilSquareIcon class="w-4 h-4" />
            {{ hasNotes(m.notes_html || m.notes) ? 'Notes' : '+ Notes' }}
          </button>
          <BacsPhotoButton
            v-if="document?.site_uuid"
            :site-uuid="document.site_uuid"
            :attach-to="{ meter_id: m.id }"
            :label="(m.zone_name || 'Général') + ' / ' + (meterUsages.find(u => u.value === m.usage)?.label || m.usage)"
            class="flex-1"
          />
        </div>
      </div>
      <div v-if="!meters.length" class="px-5 py-6 text-center text-xs text-gray-500">
        Aucun compteur listé. Renseigne les compteurs requis à mesure de la visite.
      </div>
      <div class="p-3">
        <button @click="emit('add-meter')"
                class="btn-add">
          <PlusIcon class="w-4 h-4 shrink-0" /> Ajouter un compteur
        </button>
      </div>
    </div>
  </CollapsibleSection>
</template>
