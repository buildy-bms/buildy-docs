<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import Sortable from 'sortablejs'
import { WrenchScrewdriverIcon, MapPinIcon, ChevronDownIcon, ChevronUpIcon, PencilSquareIcon, Bars3Icon, PlusIcon, TrashIcon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import SearchableSelect from '@/components/SearchableSelect.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import SystemDevicesTable from '@/components/SystemDevicesTable.vue'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import { systemUsageLabel } from '@/lib/audit-options'
import { updateBacsSystem, reorderBacsSystems, createBacsSystem, deleteBacsSystem, listSystemCategories } from '@/api'

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
const { confirm } = useConfirm()

// Libellé d'un usage : catégorie BACS, ou nom libre si usage manuel.
function usageLabel(s) { return systemUsageLabel(s) }

async function patchSystem(s, patch) {
  Object.assign(s, patch)
  try {
    await updateBacsSystem(s.id, patch)
    await audit.refreshActionItems()
  } catch { error('Sauvegarde système impossible') }
}

// ─── Ajout / suppression d'un usage manuel (non BACS) ────────────────
// L'auditeur choisit un usage dans la bibliothèque de catégories, ou
// saisit un nom libre (option "creatable" du SearchableSelect).
const categoryLibrary = ref([])
onMounted(async () => {
  try {
    const { data } = await listSystemCategories()
    categoryLibrary.value = data || []
  } catch { /* silencieux — on retombe sur la saisie libre */ }
})
const categoryOptions = computed(() => categoryLibrary.value.map(c => ({
  value: c.key,
  label: c.label,
  icon: c.icon_value,
  color: c.icon_color,
})))

const addingUsageZone = ref(null)   // zone_id en cours de saisie
const newUsageValue = ref(null)     // key de catégorie OU texte libre
function startAddUsage(zoneId) {
  addingUsageZone.value = zoneId
  newUsageValue.value = null
}
function cancelAddUsage() {
  addingUsageZone.value = null
  newUsageValue.value = null
}
async function confirmAddUsage(zoneId) {
  const v = (newUsageValue.value || '').toString().trim()
  if (!v) return
  // Si la valeur correspond à une catégorie de la bibliothèque, on rattache
  // l'usage à cette catégorie (filtre la bibliothèque d'équipements) ;
  // sinon c'est un nom libre.
  const cat = categoryLibrary.value.find(c => c.key === v)
  const payload = cat
    ? { zone_id: zoneId, label: cat.label, library_category_key: cat.key }
    : { zone_id: zoneId, label: v }
  try {
    await createBacsSystem(audit.docId, payload)
    cancelAddUsage()
    await audit.refreshAuditCore()
  } catch (e) {
    error(e.response?.data?.detail || 'Ajout de l\'usage impossible')
  }
}
async function removeUsage(s) {
  const ok = await confirm({
    title: 'Supprimer cet usage ?',
    message: `« ${usageLabel(s)} » et tous ses systèmes techniques seront supprimés.`,
    confirmLabel: 'Supprimer', danger: true,
  })
  if (!ok) return
  try {
    await deleteBacsSystem(s.id)
    await audit.refreshAuditCore()
  } catch (e) {
    error(e.response?.data?.detail || 'Suppression impossible')
  }
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
      <SectionHeader number="4" :title="'Systèmes techniques par zone'"
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
            <span v-if="g.zone_kind === 'technical'"
                  class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 whitespace-nowrap">
              hors décret BACS
            </span>
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
                    {{ usageLabel(s) }}
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
                      @click="emit('open-notes', { title: 'Notes systeme', contextLabel: (usageLabel(s)) + ' - ' + g.zone_name, entityType: 'system', entityRef: s, currentHtml: s.notes_html || s.notes || '' })"
                      :class="['inline-flex items-center justify-center p-1.5 rounded-md transition disabled:opacity-30 disabled:cursor-not-allowed',
                        hasNotes(s.notes_html || s.notes)
                          ? 'text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                          : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100']"
                      v-tooltip="hasNotes(s.notes_html || s.notes) ? 'Modifier les notes' : 'Ajouter une note'">
                      <PencilSquareIcon class="w-4 h-4" />
                    </button>
                    <BacsPhotoButton
                      v-if="document?.site_uuid && s.present"
                      :site-uuid="document.site_uuid"
                      :attach-to="{ system_id: s.id }"
                      :label="(usageLabel(s)) + ' - ' + g.zone_name" />
                    <!-- Suppression : usages manuels (non BACS) uniquement. -->
                    <button v-if="s.is_bacs === 0" type="button"
                            @click="removeUsage(s)"
                            class="inline-flex items-center justify-center p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
                            v-tooltip="'Supprimer cet usage'">
                      <TrashIcon class="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <SystemDevicesTable
                  v-if="s.present && !collapsedSystems.has(s.id)"
                  :system="s"
                  :devices="devicesBySystem[s.id] || []"
                  :system-label="usageLabel(s)"
                  :site-uuid="document?.site_uuid"
                  @changed="refreshAuditData"
                  @system-updated="patch => patchSystem(s, patch)"
                  @open-device-notes="d => emit('open-notes', {
                    title: 'Notes equipement',
                    contextLabel: (d.name || 'Equipement') + ' - ' + (usageLabel(s)) + ' / ' + g.zone_name,
                    entityType: 'device', entityRef: d,
                    currentHtml: d.notes_html || d.notes || ''
                  })"
                  @add-device="sys => emit('add-device', { id: sys.id, system_category: sys.system_category, zone_name: g.zone_name, is_bacs: sys.is_bacs, custom_label: sys.custom_label, library_category_key: sys.library_category_key })"
                  @add-device-from-library="sys => emit('add-device-from-library', { id: sys.id, system_category: sys.system_category, zone_name: g.zone_name, is_bacs: sys.is_bacs, custom_label: sys.custom_label, library_category_key: sys.library_category_key })" />
              </div>
            </template>
            <!-- Ajout manuel d'un usage (hors matrice BACS) — choisir une
                 catégorie de la bibliothèque ou saisir un nom libre. -->
            <div v-if="addingUsageZone === g.zone_id"
                 class="rounded-lg border border-dashed border-indigo-300 bg-indigo-50/40 px-3 py-2.5 space-y-2">
              <p class="text-[11px] font-medium text-gray-600">
                Choisir une catégorie de la bibliothèque, ou saisir un nom libre
              </p>
              <div class="flex items-center gap-2">
                <div class="flex-1 min-w-0">
                  <SearchableSelect
                    v-model="newUsageValue"
                    :options="categoryOptions"
                    :creatable="true"
                    placeholder="Catégorie ou nom d'usage…"
                    search-placeholder="Filtrer ou saisir un nom libre…" />
                </div>
                <button type="button" @click="confirmAddUsage(g.zone_id)" :disabled="!newUsageValue"
                        class="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-md whitespace-nowrap shrink-0">
                  Ajouter
                </button>
                <button type="button" @click="cancelAddUsage"
                        class="px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-md whitespace-nowrap shrink-0">
                  Annuler
                </button>
              </div>
            </div>
            <button v-else type="button" @click="startAddUsage(g.zone_id)"
                    class="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-700 border-2 border-dashed border-indigo-300 hover:border-indigo-400 hover:bg-indigo-50 rounded-lg whitespace-nowrap transition">
              <PlusIcon class="w-4 h-4 shrink-0" /> Ajouter un usage
            </button>
          </div>
        </div>
      </div>
      <div v-if="!systemsByZone.length" class="px-5 py-6 text-center text-sm text-gray-500">
        Aucune zone définie pour ce site. Ajoute-en depuis la section ci-dessus.
      </div>
    </div>
  </CollapsibleSection>
</template>
