<script setup>
import { storeToRefs } from 'pinia'
import { WrenchScrewdriverIcon, MapPinIcon, ChevronDownIcon, ChevronUpIcon, PencilSquareIcon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import PhotoDropzone from '@/components/PhotoDropzone.vue'
import SystemDevicesTable from '@/components/SystemDevicesTable.vue'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { updateBacsSystem } from '@/api'

// Section 3 — Systèmes techniques par zone (R175-1 4° + R175-3 3°/4°).
const props = defineProps({
  systemsByZone: { type: Array, required: true },
  devicesBySystem: { type: Object, required: true },
  hiddenNotConcernedCount: { type: Number, default: 0 },
  collapsedZones: { type: Set, required: true },
  collapsedSystems: { type: Set, required: true },
  systemLabels: { type: Object, required: true },
  systemNegativeLabels: { type: Object, required: true },
  zoneNatures: { type: Array, required: true },
  step: { type: Object, default: null },
  active: { type: Boolean, default: false },
})
const showNotConcernedSystems = defineModel('showNotConcernedSystems', { type: Boolean, default: false })
const emit = defineEmits([
  'open-notes', 'validate-step', 'invalidate-step',
  'toggle-zone-collapsed', 'toggle-system-collapsed',
  'add-device',
])

const audit = useAuditStore()
const { document, powerSummary } = storeToRefs(audit)
const { error } = useNotification()

async function patchSystem(s, patch) {
  Object.assign(s, patch)
  try {
    await updateBacsSystem(s.id, patch)
    await audit.refreshActionItems()
  } catch { error('Sauvegarde système impossible') }
}

function refreshAuditData() { return audit.refreshAuditCore() }
function hasNotes(html) {
  if (!html) return false
  return html.replace(/<[^>]*>/g, '').trim().length > 0
}
</script>

<template>
  <CollapsibleSection storage-key="systems" section-id="section-systems" :active="active">
    <template #header>
      <SectionHeader number="3" title="Systèmes techniques par zone"
                     :subtitle="audit.isBacs ? 'R175-1 4° + R175-3 3°, 4°' : 'Inventaire des systèmes'"
                     :icon="WrenchScrewdriverIcon" icon-color="text-indigo-600"
                     :step="step"
                     @validate="emit('validate-step', $event)"
                     @invalidate="emit('invalidate-step', $event)">
        <template v-if="audit.isBacs" #subtitle-extra>
          <R175Tooltip article="R175-1 4°" />
          <R175Tooltip article="R175-3" />
        </template>
        <template #actions>
          <span class="text-xs text-gray-600 whitespace-nowrap">
            Chauffage + clim :
            <strong class="font-mono text-emerald-700">{{ powerSummary.heating_cooling_total_kw || 0 }} kW</strong>
          </span>
        </template>
      </SectionHeader>
    </template>
    <template #summary>
      <span v-if="systemsByZone.length">
        {{ systemsByZone.flatMap(g => g.items).filter(s => s.present).length }} système{{ systemsByZone.flatMap(g => g.items).filter(s => s.present).length > 1 ? 's' : '' }} actif{{ systemsByZone.flatMap(g => g.items).filter(s => s.present).length > 1 ? 's' : '' }}
        · total chauffage + clim {{ powerSummary.heating_cooling_total_kw || 0 }} kW
        <span v-if="hiddenNotConcernedCount"> · {{ hiddenNotConcernedCount }} non concerné{{ hiddenNotConcernedCount > 1 ? 's' : '' }}</span>
      </span>
      <span v-else class="italic">Pas encore de systèmes saisis</span>
    </template>
    <div class="px-3 py-3 bg-gray-50">
      <div v-if="hiddenNotConcernedCount" class="flex items-center justify-end mb-2 gap-2">
        <label class="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" v-model="showNotConcernedSystems" class="rounded border-gray-300" />
          Afficher les {{ hiddenNotConcernedCount }} usage{{ hiddenNotConcernedCount > 1 ? 's' : '' }} marqué{{ hiddenNotConcernedCount > 1 ? 's' : '' }} « non concerné{{ hiddenNotConcernedCount > 1 ? 's' : '' }} »
        </label>
      </div>
      <div class="space-y-3">
        <div v-for="g in systemsByZone" :key="g.zone_id"
             class="bg-white border border-gray-200 rounded-lg shadow-sm p-3">
          <div class="flex items-center gap-2 pb-2 border-b border-gray-100"
               :class="collapsedZones.has(g.zone_id) ? '' : 'mb-3'">
            <button type="button" @click="emit('toggle-zone-collapsed', g.zone_id)"
                    class="p-1 -ml-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition shrink-0"
                    :title="collapsedZones.has(g.zone_id) ? 'Déplier la zone' : 'Replier la zone'">
              <ChevronDownIcon v-if="collapsedZones.has(g.zone_id)" class="w-4 h-4" />
              <ChevronUpIcon v-else class="w-4 h-4" />
            </button>
            <MapPinIcon class="w-5 h-5 text-indigo-500" />
            <span class="font-semibold text-lg text-gray-900 cursor-pointer" @click="emit('toggle-zone-collapsed', g.zone_id)">{{ g.zone_name }}</span>
            <span v-if="g.zone_nature" class="text-xs text-gray-500 italic">— {{ zoneNatures.find(z => z.value === g.zone_nature)?.label || g.zone_nature }}</span>
            <span class="ml-auto text-[10px] text-gray-400">
              {{ g.items.filter(s => s.present).length }} actif{{ g.items.filter(s => s.present).length > 1 ? 's' : '' }}
              / {{ g.items.filter(s => !s.not_concerned || showNotConcernedSystems).length }}
            </span>
          </div>
          <div v-show="!collapsedZones.has(g.zone_id)" class="space-y-2">
            <template v-for="s in g.items" :key="s.id">
              <PhotoDropzone
                v-if="!s.not_concerned || showNotConcernedSystems"
                :site-uuid="document?.site_uuid || ''"
                :attach-to="{ system_id: s.id }"
                :enabled="!!document?.site_uuid"
                @changed="refreshAuditData">
                <div :class="['border rounded-lg overflow-hidden',
                              s.not_concerned ? 'border-dashed border-gray-200 bg-gray-50/40 opacity-60'
                                              : (s.present ? 'border-gray-200' : 'border-gray-200 bg-gray-50/30')]">
                  <div class="px-3 py-2 flex items-center gap-3 bg-white">
                    <button v-if="s.present" type="button" @click="emit('toggle-system-collapsed', s.id)"
                            class="p-0.5 -ml-0.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition shrink-0"
                            :title="collapsedSystems.has(s.id) ? 'Déplier la catégorie' : 'Replier la catégorie'">
                      <ChevronDownIcon v-if="collapsedSystems.has(s.id)" class="w-3.5 h-3.5" />
                      <ChevronUpIcon v-else class="w-3.5 h-3.5" />
                    </button>
                    <SystemCategoryIcon :category="s.system_category" size="md" />
                    <span class="font-medium text-sm text-gray-800 whitespace-nowrap min-w-45 cursor-pointer"
                          @click="s.present && emit('toggle-system-collapsed', s.id)">
                      {{ systemLabels[s.system_category] || s.system_category }}
                    </span>
                    <label class="inline-flex items-center gap-1.5 text-xs cursor-pointer whitespace-nowrap">
                      <input type="checkbox" :checked="!!s.present" :disabled="!!s.not_concerned"
                             @change="e => patchSystem(s, { present: e.target.checked })"
                             class="rounded border-gray-300" />
                      <span class="text-gray-700">Présent</span>
                    </label>
                    <!-- Toggle "Non concerne" cache si systeme present : evite le bruit visuel.
                         Quand le systeme est marque present, ce flag n'a pas de sens. -->
                    <label v-if="!s.present"
                           class="inline-flex items-center gap-1.5 text-xs whitespace-nowrap cursor-pointer">
                      <input type="checkbox" :checked="!!s.not_concerned"
                             @change="e => patchSystem(s, { not_concerned: e.target.checked })"
                             class="rounded border-gray-300" />
                      <span class="text-gray-500 italic">{{ systemNegativeLabels[s.system_category] || 'Non concerné' }}</span>
                    </label>
                    <button
                      type="button"
                      :disabled="!s.present"
                      @click="emit('open-notes', { title: 'Notes systeme', contextLabel: (systemLabels[s.system_category] || s.system_category) + ' - ' + g.zone_name, entityType: 'system', entityRef: s, currentHtml: s.notes_html || s.notes || '' })"
                      :class="['inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md border transition disabled:opacity-30 disabled:cursor-not-allowed',
                        hasNotes(s.notes_html || s.notes)
                          ? 'border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                          : 'border-gray-300 text-gray-600 hover:bg-gray-50']">
                      <PencilSquareIcon class="w-4 h-4" />
                      {{ hasNotes(s.notes_html || s.notes) ? 'Notes' : '+ Notes' }}
                    </button>
                    <BacsPhotoButton
                      v-if="document?.site_uuid && s.present"
                      :site-uuid="document.site_uuid"
                      :attach-to="{ system_id: s.id }"
                      :label="(systemLabels[s.system_category] || s.system_category) + ' - ' + g.zone_name" />
                  </div>
                  <SystemDevicesTable
                    v-if="s.present && !collapsedSystems.has(s.id)"
                    :system="s"
                    :devices="devicesBySystem[s.id] || []"
                    :system-label="systemLabels[s.system_category] || s.system_category"
                    :site-uuid="document?.site_uuid"
                    @changed="refreshAuditData"
                    @system-updated="patch => patchSystem(s, patch)"
                    @open-device-notes="d => emit('open-notes', {
                      title: 'Notes equipement',
                      contextLabel: (d.name || 'Equipement') + ' - ' + (systemLabels[s.system_category] || s.system_category) + ' / ' + g.zone_name,
                      entityType: 'device', entityRef: d,
                      currentHtml: d.notes_html || d.notes || ''
                    })"
                    @add-device="sys => emit('add-device', { id: sys.id, system_category: sys.system_category, zone_name: g.zone_name })" />
                </div>
              </PhotoDropzone>
            </template>
          </div>
        </div>
      </div>
      <div v-if="!systemsByZone.length" class="px-5 py-6 text-center text-sm text-gray-500">
        Aucune zone définie pour ce site. Ajoute-en depuis la section ci-dessus.
      </div>
    </div>
  </CollapsibleSection>
</template>
