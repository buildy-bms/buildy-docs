<script setup>
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import Sortable from 'sortablejs'
import { BoltIcon, PencilSquareIcon, PlusIcon, TrashIcon, DocumentDuplicateIcon, Bars3Icon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import Tooltip from '@/components/Tooltip.vue'
import PhotoDropTr from '@/components/PhotoDropTr.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import MeterTypePill from '@/components/MeterTypePill.vue'
import MeterUsagePill from '@/components/MeterUsagePill.vue'
import ProtocolMultiPicker from '@/components/ProtocolMultiPicker.vue'
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
      <SectionHeader number="4" v-tooltip="'Compteurs et mesurage'"
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
    <!-- Desktop : tableau (>=768px) -->
    <table class="hidden md:table w-full text-sm">
      <thead class="text-xs text-gray-500 font-medium bg-gray-50">
        <tr>
          <th class="w-8"></th>
          <th class="text-center px-5 py-2.5 w-44">Zone</th>
          <th class="text-center py-2.5 w-40">Énergie</th>
          <th class="text-center py-2.5 w-32">Usage</th>
          <th class="text-left py-2.5 w-72">État compteur</th>
          <th class="text-center py-2.5 w-44">Protocole(s)</th>
          <th class="text-center py-2.5 w-24">Notes</th>
          <th class="text-center py-2.5 w-24">Photos</th>
          <th class="text-center py-2.5 w-16" title="Compteur Hors-Service — ignoré dans le plan d'action">HS</th>
          <th class="text-center px-5 py-2.5 w-12"></th>
        </tr>
      </thead>
      <tbody ref="metersBodyRef" class="divide-y divide-gray-100">
        <PhotoDropTr v-for="m in meters" :key="m.id"
                     :row-class="['group meter-row',
                       m.out_of_service ? 'opacity-50' : '',
                       m.required && !m.present_actual && !m.out_of_service ? 'bg-red-50/40 border-l-2 border-l-red-300' : ''
                     ].join(' ')"
                     :data-id="m.id"
                     :site-uuid="document?.site_uuid || ''"
                     :attach-to="{ meter_id: m.id }"
                     :enabled="!!document?.site_uuid"
                     @changed="refreshAuditData">
          <td class="text-center align-middle">
            <button type="button"
                    class="drag-handle inline-flex p-1 text-gray-300 hover:text-gray-600 cursor-grab active:cursor-grabbing"
                    v-tooltip="'Glisser pour réordonner'">
              <Bars3Icon class="w-4 h-4" />
            </button>
          </td>
          <td class="px-5 py-2 text-gray-700 text-center">
            <span v-if="m.required && !m.present_actual && !m.out_of_service"
                  class="text-red-600 mr-1" v-tooltip="'Compteur requis non présent'">⚠</span>
            {{ m.zone_name || 'Compteur général' }}
          </td>
          <td class="py-2.5 text-center"><MeterTypePill :type="m.meter_type" /></td>
          <td class="py-2.5 text-center"><MeterUsagePill :usage="m.usage" /></td>
          <td class="py-2.5 px-2">
            <div class="flex flex-wrap items-center gap-1.5">
              <button type="button"
                      @click="patchMeter(m, { required: !m.required })"
                      :class="['flag-pill', m.required ? 'flag-on' : 'flag-off']"
                      v-tooltip="m.required ? 'Compteur requis (cliquer pour décocher)' : 'Compteur non requis'">
                <span class="flag-ico">{{ m.required ? '✓' : '✗' }}</span> Requis
              </button>
              <button type="button"
                      @click="patchMeter(m, { present_actual: !m.present_actual })"
                      :class="['flag-pill', m.present_actual ? 'flag-on' : 'flag-off']"
                      v-tooltip="m.present_actual ? 'Présent sur site (cliquer pour décocher)' : 'Pas présent sur site'">
                <span class="flag-ico">{{ m.present_actual ? '✓' : '✗' }}</span> Présent
              </button>
              <button v-if="m.present_actual" type="button"
                      @click="patchMeter(m, m.communicating
                        ? { communicating: false, communication_protocols: null, communication_protocol: null }
                        : { communicating: true })"
                      :class="['flag-pill', m.communicating ? 'flag-on' : 'flag-off']">
                <span class="flag-ico">{{ m.communicating ? '✓' : '✗' }}</span> Comm.
              </button>
              <button v-if="m.present_actual" type="button"
                      @click="patchMeter(m, { wired: !m.wired })"
                      :class="['flag-pill', m.wired ? 'flag-on' : 'flag-off']"
                      v-tooltip="'Communication câblée vers la GTB'">
                <span class="flag-ico">{{ m.wired ? '✓' : '✗' }}</span> Câblé
              </button>
            </div>
          </td>
          <td class="py-2.5 px-2">
            <ProtocolMultiPicker
              :model-value="m.communication_protocols || (m.communication_protocol && m.communication_protocol !== 'non_communicant' ? JSON.stringify([m.communication_protocol]) : null)"
              :disabled="!m.communicating"
              :options="protocolOptions"
              size="xs"
              @update:modelValue="v => patchMeter(m, { communication_protocols: v, communication_protocol: null })"
            />
          </td>
          <td class="py-2.5 text-center">
            <button
              type="button"
              @click="emit('open-notes', { title: 'Notes compteur', contextLabel: (m.zone_name || 'Compteur général') + ' — ' + (meterUsages.find(u => u.value === m.usage)?.label || m.usage), entityType: 'meter', entityRef: m, currentHtml: m.notes_html || m.notes || '' })"
              :class="['inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md border transition',
                hasNotes(m.notes_html || m.notes)
                  ? 'border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50']"
              v-tooltip="'Editer les notes'">
              <PencilSquareIcon class="w-4 h-4" />
              {{ hasNotes(m.notes_html || m.notes) ? 'Notes' : '+ Notes' }}
            </button>
          </td>
          <td class="py-2.5 text-center">
            <BacsPhotoButton
              v-if="document?.site_uuid"
              :site-uuid="document.site_uuid"
              :attach-to="{ meter_id: m.id }"
              :label="(m.zone_name || 'Général') + ' / ' + (meterUsages.find(u => u.value === m.usage)?.label || m.usage)"
            />
          </td>
          <td class="py-2.5 text-center">
            <input type="checkbox" :checked="!!m.out_of_service"
                   @change="e => patchMeter(m, { out_of_service: e.target.checked })"
                   class="rounded border-gray-300" />
          </td>
          <td class="px-5 py-2.5 text-right whitespace-nowrap">
            <button @click="dupMeter(m)" class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-indigo-600 p-1 transition" v-tooltip="'Dupliquer'">
              <DocumentDuplicateIcon class="w-4 h-4" />
            </button>
            <button @click="removeMeter(m)" class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 p-1 transition" v-tooltip="'Supprimer'">
              <TrashIcon class="w-4 h-4" />
            </button>
          </td>
        </PhotoDropTr>
        <tr class="bg-emerald-50/30">
          <td colspan="10" class="px-5 py-3 text-center">
            <button @click="emit('add-meter')" class="btn-success">
              <PlusIcon class="w-4 h-4" /> Ajouter un compteur
            </button>
          </td>
        </tr>
      </tbody>
      <tfoot v-if="!meters.length">
        <tr>
          <td colspan="9" class="px-5 py-6 text-center text-xs text-gray-500">
            Aucun compteur listé. Renseigne les compteurs requis (R175-3 1°) à mesure de la visite.
          </td>
        </tr>
      </tfoot>
    </table>

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
              <span class="font-medium text-sm text-gray-800 truncate">
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
        <!-- État compteur : flags -->
        <div class="flex flex-wrap gap-1.5">
          <button type="button"
                  @click="patchMeter(m, { required: !m.required })"
                  :class="['flag-pill', m.required ? 'flag-on' : 'flag-off']">
            <span class="flag-ico">{{ m.required ? '✓' : '✗' }}</span> Requis
          </button>
          <button type="button"
                  @click="patchMeter(m, { present_actual: !m.present_actual })"
                  :class="['flag-pill', m.present_actual ? 'flag-on' : 'flag-off']">
            <span class="flag-ico">{{ m.present_actual ? '✓' : '✗' }}</span> Présent
          </button>
          <button v-if="m.present_actual" type="button"
                  @click="patchMeter(m, m.communicating
                    ? { communicating: false, communication_protocols: null, communication_protocol: null }
                    : { communicating: true })"
                  :class="['flag-pill', m.communicating ? 'flag-on' : 'flag-off']">
            <span class="flag-ico">{{ m.communicating ? '✓' : '✗' }}</span> Comm.
          </button>
          <button v-if="m.present_actual" type="button"
                  @click="patchMeter(m, { wired: !m.wired })"
                  :class="['flag-pill', m.wired ? 'flag-on' : 'flag-off']">
            <span class="flag-ico">{{ m.wired ? '✓' : '✗' }}</span> Câblé
          </button>
          <label class="flag-pill flag-off cursor-pointer">
            <input type="checkbox" :checked="!!m.out_of_service"
                   @change="e => patchMeter(m, { out_of_service: e.target.checked })"
                   class="w-3! h-3!" />
            HS
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
        <button @click="emit('add-meter')" class="w-full tap-target btn-success justify-center">
          <PlusIcon class="w-4 h-4" /> Ajouter un compteur
        </button>
      </div>
    </div>
  </CollapsibleSection>
</template>
