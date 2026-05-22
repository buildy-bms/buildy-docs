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
import SystemDevicesTable from '@/components/SystemDevicesTable.vue'
import SystemPartiesPanel from '@/components/audit/SystemPartiesPanel.vue'
import SegmentedToggle from '@/components/audit/SegmentedToggle.vue'
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
  'add-device',
])

const audit = useAuditStore()
const { document, powerSummary } = storeToRefs(audit)
const { error } = useNotification()
const { confirm } = useConfirm()

// Libellé d'un usage : catégorie BACS, ou nom libre si usage manuel.
function usageLabel(s) { return systemUsageLabel(s) }

// Tri-état pour les SegmentedToggle : null → aucun bouton sélectionné.
const triState = (v) => (v == null ? null : !!v)

async function patchSystem(s, patch) {
  Object.assign(s, patch)
  try {
    await updateBacsSystem(s.id, patch)
    await audit.refreshActionItems()
  } catch { error('Sauvegarde système impossible') }
}

// Présence d'un usage : contrôle segmenté binaire « Présent / Non concerné »
// remplaçant les deux anciennes cases. Tant que rien n'est saisi, aucun
// bouton n'est sélectionné.
const PRESENCE_OPTIONS = [
  { value: 'present', label: 'Présent', tone: 'green' },
  { value: 'not_concerned', label: 'Non concerné', tone: 'slate' },
]
function presenceValue(s) {
  return s.not_concerned ? 'not_concerned' : (s.present ? 'present' : null)
}
function setPresence(s, val) {
  if (val === 'present') patchSystem(s, { present: true, not_concerned: false })
  else patchSystem(s, { present: false, not_concerned: true })
}

// Item 3 — bouclage ECS : 3 états.
const LOOP_OPTIONS = [
  { value: 'looped', label: 'Boucle ECS' },
  { value: 'not_looped', label: 'Pas de boucle' },
  { value: 'unknown', label: 'Inconnu' },
]

// Item 1 — poids estimé d'un poste (puissance système / puissance totale
// site). Aide à la décision : > 10 % → l'auditeur est averti avant
// d'activer le flag « négligeable ».
function systemPowerKw(s) {
  const devs = props.devicesBySystem[s.id] || []
  return devs.reduce((sum, d) => sum + (Number(d.power_kw) || 0) * (Number(d.quantity) || 1), 0)
}
function sitePowerKw() {
  let total = 0
  for (const g of props.systemsByZone) {
    for (const s of g.items) total += systemPowerKw(s)
  }
  return total
}
function systemWeightPct(s) {
  const total = sitePowerKw()
  if (total <= 0) return null
  const pct = systemPowerKw(s) / total * 100
  return Math.round(pct * 10) / 10
}
async function toggleNegligible(s, checked) {
  // Avertissement si le poids estimé dépasse 10 % — l'auditeur peut quand
  // même confirmer (la règle des 5 % se base sur la conso réelle, pas la
  // puissance ; le poids par puissance n'est qu'une approximation).
  if (checked) {
    const pct = systemWeightPct(s)
    if (pct != null && pct > 10) {
      const ok = await confirm({
        title: 'Poste potentiellement significatif',
        message: `Ce poste représente environ ${pct} % de la puissance du site (estimation par puissance). La règle des 5 % se base sur la consommation réelle — vérifiez avant de l'exempter.`,
        confirmLabel: 'Marquer quand même négligeable',
      })
      if (!ok) return
    }
  }
  await patchSystem(s, {
    marked_negligible_under_5pct: checked,
    ...(checked ? {} : { negligible_justification: null }),
  })
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
          <!-- Item 5 — cumul automatique des puissances chaud / froid -->
          <span v-if="powerSummary.power_summary" class="text-xs text-gray-600 whitespace-nowrap flex items-center gap-2">
            <span>Chaud <strong class="font-mono text-red-600">{{ powerSummary.power_summary.heatKw }} kW</strong></span>
            <span class="text-gray-300">·</span>
            <span>Froid <strong class="font-mono text-cyan-600">{{ powerSummary.power_summary.coolKw }} kW</strong></span>
            <span class="text-gray-300">·</span>
            <span>Retenue <strong class="font-mono text-emerald-700">{{ powerSummary.power_summary.retainedKw }} kW</strong></span>
            <span v-if="powerSummary.power_summary.discrepancy"
                  class="text-amber-600 font-medium"
                  v-tooltip="`Écart de ${powerSummary.power_summary.discrepancyPct} % entre la valeur saisie (${powerSummary.power_summary.manualKw} kW) et le cumul calculé (${powerSummary.power_summary.autoKw} kW).`">
              ⚠ écart {{ powerSummary.power_summary.discrepancyPct }} %
            </span>
          </span>
          <span v-else class="text-xs text-gray-600 whitespace-nowrap">
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
                <!-- Header de catégorie : grid à colonnes fixes. Largeurs :
                     drag 20px, chevron 20px, picto 28px, label 240px (truncate),
                     contrôle segmenté présence en auto, puis 1fr pour pousser
                     les actions à droite. -->
                <div class="px-3 py-2 grid items-center gap-3 bg-white"
                     :style="'grid-template-columns: 20px 20px 28px 240px auto minmax(0, 1fr);'">
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
                  <SegmentedToggle :model-value="presenceValue(s)" :options="PRESENCE_OPTIONS"
                                   @update:model-value="v => setPresence(s, v)" />
                  <div class="flex items-center gap-1 shrink-0 justify-self-end">
                    <button
                      type="button"
                      :disabled="!s.present"
                      @click="emit('open-notes', { title: 'Notes systeme', contextLabel: (usageLabel(s)) + ' - ' + g.zone_name, entityType: 'system', entityRef: s, currentHtml: s.notes_html || s.notes || '' })"
                      :class="['btn-icon', hasNotes(s.notes_html || s.notes) && 'is-active']"
                      v-tooltip="hasNotes(s.notes_html || s.notes) ? 'Modifier les notes' : 'Ajouter une note'">
                      <PencilSquareIcon class="w-4 h-4" />
                    </button>
                    <!-- Suppression : usages manuels (non BACS) uniquement. -->
                    <button v-if="s.is_bacs === 0" type="button"
                            @click="removeUsage(s)"
                            class="btn-icon btn-icon-danger"
                            v-tooltip="'Supprimer cet usage'">
                      <TrashIcon class="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <!-- Items 1 & 3 — caractérisation BACS du système (visible
                     quand le système est présent et déplié) :
                     · bouclage ECS (catégorie dhw uniquement)
                     · règle des 5 % — poste considéré négligeable -->
                <div v-if="s.present && !collapsedSystems.has(s.id)"
                     class="px-3 py-2.5 border-t border-gray-100 bg-slate-50/60 space-y-2.5">
                  <!-- Item 3 — bouclage ECS -->
                  <div v-if="s.system_category === 'dhw'" class="flex items-center gap-2 flex-wrap">
                    <span class="text-xs font-medium text-gray-600 whitespace-nowrap">Bouclage ECS :</span>
                    <div class="inline-flex rounded-md overflow-hidden border border-gray-200">
                      <button v-for="opt in LOOP_OPTIONS" :key="opt.value" type="button"
                              @click="patchSystem(s, { is_looped: opt.value })"
                              :class="['px-2.5 py-1 text-xs whitespace-nowrap transition',
                                       s.is_looped === opt.value
                                         ? 'bg-indigo-600 text-white font-medium'
                                         : 'bg-white text-gray-600 hover:bg-gray-50']">
                        {{ opt.label }}
                      </button>
                    </div>
                    <span v-if="s.is_looped === 'looped'" class="text-[11px] text-amber-700 italic">
                      Boucle ECS : arrêt interdit (arrêté du 30 nov. 2005 — risque légionelle).
                    </span>
                  </div>
                  <!-- Item 1 — règle des 5 % -->
                  <div class="space-y-1.5">
                    <div class="flex items-center gap-3">
                      <span class="text-xs text-gray-700">Ce poste est-il négligeable (moins de 5 % de la consommation totale) ?
                        <template v-if="systemWeightPct(s) != null">
                          <span :class="['ml-1 font-mono text-[11px]', systemWeightPct(s) > 10 ? 'text-amber-600 font-semibold' : 'text-gray-400']">
                            (poids estimé ~{{ systemWeightPct(s) }} %)
                          </span>
                          <R175Tooltip class="ml-0.5 align-middle">
                            <div class="font-semibold text-gray-800 mb-1.5">Comment le poids est-il estimé ?</div>
                            <div class="text-xs text-gray-600 leading-relaxed space-y-2">
                              <p>Faute de relevés de consommation réels, le poids est approximé à partir de la <strong>puissance installée</strong> :</p>
                              <div class="rounded-md bg-slate-50 border border-slate-200 px-2.5 py-2 text-center text-[11px] text-slate-700">
                                <div class="font-medium">puissance cumulée des équipements de ce système</div>
                                <div class="text-slate-400">(puissance × quantité)</div>
                                <div class="my-1 border-t border-slate-300"></div>
                                <div class="font-medium">puissance installée totale de tous les systèmes du site</div>
                              </div>
                              <p class="rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-amber-800">
                                La règle des 5 % du décret repose sur la <strong>consommation réelle</strong> : ce pourcentage n'en est qu'une approximation indicative.
                              </p>
                            </div>
                          </R175Tooltip>
                        </template>
                      </span>
                      <SegmentedToggle :model-value="triState(s.marked_negligible_under_5pct)"
                                       @update:model-value="v => toggleNegligible(s, v)" />
                    </div>
                    <input v-if="s.marked_negligible_under_5pct"
                           type="text"
                           :value="s.negligible_justification || ''"
                           @change="e => patchSystem(s, { negligible_justification: e.target.value })"
                           placeholder="Justification (ex : petits ballons ECS individuels, groupe de secours…)"
                           class="w-full text-xs rounded-md border-gray-200 focus:border-indigo-400 focus:ring-indigo-400/30 py-1.5 px-2.5" />
                  </div>
                  <!-- Item 4 — assujettissement : parties + flags cas E/F -->
                  <div class="border-t border-gray-100 pt-2.5">
                    <SystemPartiesPanel :system="s" />
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
                  @add-device="sys => emit('add-device', { id: sys.id, system_category: sys.system_category, zone_name: g.zone_name, is_bacs: sys.is_bacs, custom_label: sys.custom_label, library_category_key: sys.library_category_key })" />
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
                    class="btn-add">
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
