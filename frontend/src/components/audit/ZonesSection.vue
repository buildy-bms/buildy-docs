<script setup>
import { storeToRefs } from 'pinia'
import { MapPinIcon, PencilSquareIcon, PlusIcon, TrashIcon, DocumentDuplicateIcon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import StepValidateBadge from '@/components/StepValidateBadge.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import PhotoDropTr from '@/components/PhotoDropTr.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import { updateZone, deleteZone, listZones, resyncBacsAudit } from '@/api'

// Section 2 — Zones fonctionnelles (R175-1 6°). Editable in-situ.
const props = defineProps({
  zoneNatures: { type: Array, required: true },
  step: { type: Object, default: null },
})
const emit = defineEmits([
  'open-notes', 'validate-step', 'invalidate-step', 'add-zone',
])

const audit = useAuditStore()
const { document, zones } = storeToRefs(audit)
const { error } = useNotification()
const { confirm } = useConfirm()

async function patchZone(z, patch) {
  Object.assign(z, patch)
  try {
    await updateZone(z.zone_id, patch)
    await audit.refreshAuditCore()
  } catch { error('Sauvegarde zone impossible') }
}

async function removeZone(z) {
  const ok = await confirm({
    title: `Supprimer la zone « ${z.name} » ?`,
    message: 'La zone sera retirée du site, ainsi que les systèmes / compteurs / régulations rattachés.',
    confirmLabel: 'Supprimer',
    danger: true,
  })
  if (!ok) return
  try {
    await deleteZone(z.zone_id)
    if (document.value?.site_id) {
      const r = await listZones(document.value.site_id)
      zones.value = r.data
    }
    await resyncBacsAudit(audit.docId)
    await audit.refreshAuditCore()
  } catch { error('Suppression impossible') }
}

async function dupZone(z) {
  // Simple : crée une nouvelle zone avec un nom suffixé.
  emit('add-zone', { name: `${z.name} (copie)`, nature: z.nature, surface_m2: z.surface_m2 })
}

function refreshAuditData() { return audit.refreshAuditCore() }
function hasNotes(html) {
  if (!html) return false
  return html.replace(/<[^>]*>/g, '').trim().length > 0
}
</script>

<template>
  <CollapsibleSection storage-key="zones" section-id="section-zones">
    <template #header>
      <MapPinIcon class="w-5 h-5 text-indigo-600" />
      <h2 class="text-base font-semibold text-gray-800">2. Zones fonctionnelles</h2>
      <span v-if="audit.isBacs" class="text-xs text-gray-500">R175-1 6° — usages homogènes</span>
      <R175Tooltip v-if="audit.isBacs" article="R175-1 6°" />
      <span class="ml-auto text-[11px] text-gray-500">{{ zones.length }} zone{{ zones.length > 1 ? 's' : '' }} sur ce site</span>
      <StepValidateBadge :step="step" @validate="emit('validate-step', $event)" @invalidate="emit('invalidate-step', $event)" />
    </template>
    <template #summary>
      <span v-if="zones.length">
        {{ zones.length }} zone{{ zones.length > 1 ? 's' : '' }}
        · surface totale {{ zones.reduce((s,z) => s + (z.surface_m2 || 0), 0) || '—' }} m²
        · {{ zones.slice(0,4).map(z => z.name).join(' · ') }}{{ zones.length > 4 ? ' …' : '' }}
      </span>
      <span v-else class="italic">Aucune zone définie</span>
    </template>
    <table class="w-full text-sm">
      <thead class="text-xs uppercase text-gray-500 tracking-wider bg-gray-50">
        <tr>
          <th class="text-center px-5 py-2">Nom</th>
          <th class="text-center py-2 w-48">Nature</th>
          <th class="text-center py-2 w-24">Surface (m²)</th>
          <th class="text-center py-2 w-32">Notes</th>
          <th class="text-center py-2 w-24">Photos</th>
          <th class="text-center px-5 py-2 w-12"></th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100">
        <PhotoDropTr v-for="z in zones" :key="z.zone_id" row-class="group"
                     :site-uuid="document?.site_uuid || ''"
                     :attach-to="{ zone_id: z.zone_id }"
                     :enabled="!!document?.site_uuid"
                     @changed="refreshAuditData">
          <td class="px-5 py-2">
            <input type="text" :value="z.name"
                   @blur="e => e.target.value !== z.name && patchZone(z, { name: e.target.value })"
                   class="w-full text-sm px-2 py-1 border border-transparent hover:border-gray-200 focus:border-indigo-500 focus:outline-none rounded" />
          </td>
          <td class="py-2">
            <select :value="z.nature"
                    @change="e => patchZone(z, { nature: e.target.value || null })"
                    class="text-xs px-2 py-1 border border-gray-200 rounded">
              <option :value="null">—</option>
              <option v-for="opt in zoneNatures" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
          </td>
          <td class="py-2">
            <input type="number" min="0" step="1" :value="z.surface_m2" placeholder="—"
                   @blur="e => patchZone(z, { surface_m2: e.target.value === '' ? null : parseFloat(e.target.value) })"
                   class="w-full text-xs px-2 py-1 border border-transparent hover:border-gray-200 focus:border-indigo-500 focus:outline-none rounded" />
          </td>
          <td class="py-2 text-center">
            <button
              type="button"
              @click="emit('open-notes', { title: 'Notes - ' + z.name, contextLabel: 'Zone : ' + z.name, entityType: 'zone', entityRef: z, currentHtml: z.notes_html || z.notes || '' })"
              :class="['inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md border transition',
                hasNotes(z.notes_html || z.notes)
                  ? 'border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50']"
              title="Editer les notes (avec assistance Claude)">
              <PencilSquareIcon class="w-4 h-4" />
              {{ hasNotes(z.notes_html || z.notes) ? 'Notes' : '+ Notes' }}
            </button>
          </td>
          <td class="py-2 text-center">
            <BacsPhotoButton
              v-if="document?.site_uuid"
              :site-uuid="document.site_uuid"
              :attach-to="{ zone_id: z.zone_id }"
              :label="z.name" />
          </td>
          <td class="px-5 py-2 text-right whitespace-nowrap">
            <button @click="dupZone(z)" class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-indigo-600 p-1 transition" title="Dupliquer">
              <DocumentDuplicateIcon class="w-4 h-4" />
            </button>
            <button @click="removeZone(z)" class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 p-1 transition" title="Supprimer">
              <TrashIcon class="w-4 h-4" />
            </button>
          </td>
        </PhotoDropTr>
        <tr class="bg-emerald-50/30">
          <td colspan="6" class="px-5 py-3 text-center">
            <button @click="emit('add-zone')" class="btn-success">
              <PlusIcon class="w-4 h-4" /> Ajouter une zone
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </CollapsibleSection>
</template>
