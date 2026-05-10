<script setup>
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import Sortable from 'sortablejs'
import { WrenchScrewdriverIcon, MapPinIcon, ChevronDownIcon, ChevronUpIcon, PencilSquareIcon, Bars3Icon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import SystemDevicesTable from '@/components/SystemDevicesTable.vue'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { updateBacsSystem, reorderBacsSystems } from '@/api'

// Couleur d'accent par categorie de systeme : aligne avec
// SystemCategoryIcon, sert de border-l-4 pour mieux distinguer les
// categories quand plusieurs sont presentes dans une zone.
const CATEGORY_BORDER = {
  heating: 'border-l-red-400',
  cooling: 'border-l-cyan-400',
  ventilation: 'border-l-slate-400',
  dhw: 'border-l-blue-400',
  lighting_indoor: 'border-l-amber-400',
  lighting_outdoor: 'border-l-amber-500',
  electricity_production: 'border-l-emerald-500',
}

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
  'add-device', 'add-device-from-library',
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

// Drag & drop des cartes système, INTRA-zone uniquement (le système ne
// change pas de zone — la zone_id est une FK invariante ici). À chaque
// onEnd, on relit l'ordre du DOM sur l'ENSEMBLE des zones et on POST.
const zoneListRefs = ref({})
const sortables = []
function setZoneListRef(zoneId, el) {
  if (el) zoneListRefs.value[zoneId] = el
  else delete zoneListRefs.value[zoneId]
}
function teardownSortables() {
  while (sortables.length) { try { sortables.pop().destroy() } catch { /* ignore */ } }
}
function setupSortables() {
  teardownSortables()
  for (const [, el] of Object.entries(zoneListRefs.value)) {
    if (!el) continue
    const s = Sortable.create(el, {
      draggable: '.system-card',
      handle: '.drag-handle',
      animation: 150,
      ghostClass: 'sortable-ghost',
      onEnd: async (evt) => {
        if (evt.oldIndex === evt.newIndex) return
        // Récupère l'ordre global (toutes zones, dans l'ordre du DOM).
        const allIds = []
        for (const zoneEl of Object.values(zoneListRefs.value)) {
          if (!zoneEl) continue
          for (const card of zoneEl.querySelectorAll('.system-card')) {
            const id = parseInt(card.getAttribute('data-id'), 10)
            if (id) allIds.push(id)
          }
        }
        try {
          await reorderBacsSystems(audit.docId, allIds)
          await audit.refreshAuditCore()
        } catch {
          error('Réorganisation impossible')
          await audit.refreshAuditCore()
        }
      },
    })
    sortables.push(s)
  }
}
watch(() => props.systemsByZone, async () => {
  await nextTick()
  setupSortables()
}, { immediate: true, flush: 'post', deep: true })
onBeforeUnmount(teardownSortables)
</script>

<template>
  <CollapsibleSection storage-key="systems" section-id="section-systems" :active="active">
    <template #header>
      <SectionHeader number="3" :title="'Systèmes techniques par zone'"
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
      <!-- Les usages "non concerné" restent toujours visibles (grisés et
           atténués via la classe opacity-60 + bordure dashed sur la card),
           pour permettre à l'auditeur de les remettre actifs facilement
           sans avoir à toggle un flag d'affichage. -->
      <div class="space-y-3">
        <div v-for="g in systemsByZone" :key="g.zone_id"
             class="bg-slate-100/60 border border-slate-200 rounded-lg p-3">
          <div class="flex items-center gap-2 pb-2 border-b border-gray-100"
               :class="collapsedZones.has(g.zone_id) ? '' : 'mb-3'">
            <button type="button" @click="emit('toggle-zone-collapsed', g.zone_id)"
                    class="p-1 -ml-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition shrink-0"
                    v-tooltip="collapsedZones.has(g.zone_id) ? 'Déplier la zone' : 'Replier la zone'">
              <ChevronDownIcon v-if="collapsedZones.has(g.zone_id)" class="w-4 h-4" />
              <ChevronUpIcon v-else class="w-4 h-4" />
            </button>
            <MapPinIcon class="w-5 h-5 text-indigo-500" />
            <span class="font-semibold text-lg text-gray-900 cursor-pointer" @click="emit('toggle-zone-collapsed', g.zone_id)">{{ g.zone_name }}</span>
            <span v-if="g.zone_nature" class="text-xs text-gray-500 italic">— {{ zoneNatures.find(z => z.value === g.zone_nature)?.label || g.zone_nature }}</span>
            <span class="ml-auto text-[10px] text-gray-400">
              {{ g.items.filter(s => s.present).length }} actif{{ g.items.filter(s => s.present).length > 1 ? 's' : '' }}
              / {{ g.items.length }}
            </span>
          </div>
          <div v-show="!collapsedZones.has(g.zone_id)" class="space-y-2"
               :ref="el => setZoneListRef(g.zone_id, el)">
            <template v-for="s in g.items" :key="s.id">
              <!-- Pas de PhotoDropzone autour de la catégorie : drops scopés
                   au système (device card) uniquement, voir SystemDevicesTable.
                   Les usages "non concerné" restent visibles (grisés via
                   opacity-60 + bordure dashed dans le :class plus bas). -->
              <div :data-id="s.id"
                   :class="['system-card rounded-lg border bg-white',
                            s.present ? ['border-gray-200 border-l-4 shadow-sm', CATEGORY_BORDER[s.system_category] || 'border-l-indigo-400']
                                      : (s.not_concerned ? 'border-dashed border-gray-200 bg-gray-50/40 opacity-60'
                                                          : 'border-gray-200 bg-gray-50/40')]">
                <!-- Header de catégorie : grid à colonnes fixes pour aligner
                     PARFAITEMENT verticalement « Présent / Pas de XXX » à
                     travers les rows malgré les longueurs de label différentes.
                     Avec `auto`, les colonnes s'adaptaient au contenu et
                     décalaient les lignes entre elles. Largeurs fixes : icon
                     20px, picto 28px, label 240px (truncate), Présent 90px,
                     Pas de XXX 240px (couvre « Pas de production photovoltaïque »),
                     puis 1fr pour pousser les actions à droite. -->
                <div class="px-3 py-2 grid items-center gap-3 bg-white"
                     :style="'grid-template-columns: 20px 20px 28px 240px 90px 240px minmax(0, 1fr);'">
                  <button type="button"
                          class="drag-handle p-0.5 -ml-0.5 text-gray-300 hover:text-gray-600 cursor-grab active:cursor-grabbing"
                          v-tooltip="'Glisser pour réordonner'">
                    <Bars3Icon class="w-3.5 h-3.5" />
                  </button>
                  <button v-if="s.present" type="button" @click="emit('toggle-system-collapsed', s.id)"
                          class="p-0.5 -ml-0.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition shrink-0"
                          v-tooltip="collapsedSystems.has(s.id) ? 'Déplier la catégorie' : 'Replier la catégorie'">
                    <ChevronDownIcon v-if="collapsedSystems.has(s.id)" class="w-3.5 h-3.5" />
                    <ChevronUpIcon v-else class="w-3.5 h-3.5" />
                  </button>
                  <span v-else></span>
                  <SystemCategoryIcon :category="s.system_category" size="md" />
                  <span class="font-medium text-sm text-gray-800 whitespace-nowrap cursor-pointer truncate"
                        @click="s.present && emit('toggle-system-collapsed', s.id)">
                    {{ systemLabels[s.system_category] || s.system_category }}
                  </span>
                  <label class="inline-flex items-center gap-1.5 text-xs cursor-pointer whitespace-nowrap">
                    <input type="checkbox" :checked="!!s.present" :disabled="!!s.not_concerned"
                           @change="e => patchSystem(s, { present: e.target.checked })"
                           class="rounded border-gray-300" />
                    <span class="text-gray-700">Présent</span>
                  </label>
                  <!-- Toggle "Non concerne" : column 5 toujours fixée à 240px,
                       contenu invisible mais place réservée si système présent. -->
                  <label class="inline-flex items-center gap-1.5 text-xs whitespace-nowrap cursor-pointer truncate"
                         :class="s.present ? 'invisible' : ''">
                    <input type="checkbox" :checked="!!s.not_concerned"
                           @change="e => patchSystem(s, { not_concerned: e.target.checked })"
                           class="rounded border-gray-300 shrink-0" />
                    <span class="text-gray-500 italic truncate">{{ systemNegativeLabels[s.system_category] || 'Non concerné' }}</span>
                  </label>
                  <div class="flex items-center gap-2 shrink-0 justify-self-end">
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
                  @add-device="sys => emit('add-device', { id: sys.id, system_category: sys.system_category, zone_name: g.zone_name })"
                  @add-device-from-library="sys => emit('add-device-from-library', { id: sys.id, system_category: sys.system_category, zone_name: g.zone_name })" />
              </div>
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
