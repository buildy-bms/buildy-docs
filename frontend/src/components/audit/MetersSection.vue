<script setup>
import { storeToRefs } from 'pinia'
import { BoltIcon, PencilSquareIcon, PlusIcon, TrashIcon, DocumentDuplicateIcon } from '@heroicons/vue/24/outline'
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
import { updateBacsMeter, deleteBacsMeter, duplicateBacsMeter } from '@/api'

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
</script>

<template>
  <CollapsibleSection storage-key="meters" section-id="section-meters" :active="active">
    <template #header>
      <SectionHeader number="4" title="Compteurs et mesurage"
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
    <table class="w-full text-sm">
      <thead class="text-xs text-gray-500 font-medium bg-gray-50">
        <tr>
          <th class="text-center px-5 py-2.5 w-44">Zone</th>
          <th class="text-center py-2.5 w-32">Usage</th>
          <th class="text-center py-2.5 w-40">Type</th>
          <th class="text-left py-2.5 w-72">État compteur</th>
          <th class="text-center py-2.5 w-44">Protocoles</th>
          <th class="text-center py-2.5 w-24">Notes</th>
          <th class="text-center py-2.5 w-24">Photos</th>
          <th class="text-center py-2.5 w-16" title="Compteur Hors-Service — ignoré dans le plan d'action">HS</th>
          <th class="text-center px-5 py-2.5 w-12"></th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100">
        <PhotoDropTr v-for="m in meters" :key="m.id"
                     :row-class="['group', m.out_of_service ? 'opacity-50' : ''].join(' ')"
                     :site-uuid="document?.site_uuid || ''"
                     :attach-to="{ meter_id: m.id }"
                     :enabled="!!document?.site_uuid"
                     @changed="refreshAuditData">
          <td class="px-5 py-2 text-gray-700 text-center">{{ m.zone_name || 'Compteur général' }}</td>
          <td class="py-2.5 text-center"><MeterUsagePill :usage="m.usage" /></td>
          <td class="py-2.5 text-center"><MeterTypePill :type="m.meter_type" /></td>
          <td class="py-2.5 px-2">
            <div class="flex flex-wrap items-center gap-1.5">
              <button type="button"
                      @click="patchMeter(m, { required: !m.required })"
                      :class="['pill border', m.required ? 'tone-info' : 'tone-muted']"
                      :title="m.required ? 'Compteur requis (cliquer pour décocher)' : 'Compteur non requis'">
                <span>{{ m.required ? '✓' : '○' }}</span> Requis
              </button>
              <button type="button"
                      @click="patchMeter(m, { present_actual: !m.present_actual })"
                      :class="['pill border', m.present_actual ? 'tone-success' : 'tone-muted']"
                      :title="m.present_actual ? 'Présent sur site (cliquer pour décocher)' : 'Pas présent sur site'">
                <span>{{ m.present_actual ? '✓' : '○' }}</span> Présent
              </button>
              <button type="button" :disabled="!m.present_actual"
                      @click="patchMeter(m, m.communicating
                        ? { communicating: false, communication_protocols: null, communication_protocol: null }
                        : { communicating: true })"
                      :class="['pill border', m.communicating ? 'tone-success' : 'tone-muted',
                               !m.present_actual ? 'opacity-40 cursor-not-allowed' : '']">
                <span>{{ m.communicating ? '✓' : '○' }}</span> Comm.
              </button>
              <button type="button" :disabled="!m.present_actual"
                      @click="patchMeter(m, { wired: !m.wired })"
                      :class="['pill border', m.wired ? 'tone-success' : 'tone-muted',
                               !m.present_actual ? 'opacity-40 cursor-not-allowed' : '']"
                      title="Communication câblée vers la GTB">
                <span>{{ m.wired ? '✓' : '○' }}</span> Câblé
              </button>
              <span v-if="m.required && !m.present_actual && !m.out_of_service"
                    class="pill sev-major" title="Compteur requis non présent">
                ⚠ manquant
              </span>
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
              title="Editer les notes">
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
            <button @click="dupMeter(m)" class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-indigo-600 p-1 transition" title="Dupliquer">
              <DocumentDuplicateIcon class="w-4 h-4" />
            </button>
            <button @click="removeMeter(m)" class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 p-1 transition" title="Supprimer">
              <TrashIcon class="w-4 h-4" />
            </button>
          </td>
        </PhotoDropTr>
        <tr class="bg-emerald-50/30">
          <td colspan="9" class="px-5 py-3 text-center">
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
  </CollapsibleSection>
</template>
