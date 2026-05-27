<script setup>
// Section détaillée d'une énergie : header coloré + KPI + table compacte
// des compteurs de cette énergie, avec édition inline (toggles, protocoles)
// + actions secondaires (notes, photos, voice, dupliquer, supprimer).
//
// Cohérent avec la PWA (qui regroupe aussi par énergie) et la matrice de
// couverture au-dessus (qui scrolle ici quand on clique sur une pill).
// Drag-drop intra-énergie via SortableJS (on ne change pas un compteur
// d'énergie par drag — l'énergie est une propriété stable).
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import Sortable from 'sortablejs'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
import { PencilSquareIcon, TrashIcon, DocumentDuplicateIcon, PlusIcon, Bars3Icon, ChevronDownIcon } from '@heroicons/vue/24/outline'
import MeterUsagePill from '@/components/MeterUsagePill.vue'
import ProtocolMultiPicker from '@/components/ProtocolMultiPicker.vue'
import SegmentedToggle from '@/components/SegmentedToggle.vue'
import SearchableSelect from '@/components/SearchableSelect.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import VoiceNoteButton from '@/components/VoiceNoteButton.vue'
import { meterUsageLabel, METER_USAGES, getMeterUsageMeta } from '@/lib/meter-options'

const props = defineProps({
  energy: { type: Object, required: true }, // { value, label, icon, color }
  meters: { type: Array, required: true },
  zones: { type: Array, default: () => [] },
  document: { type: Object, default: null },
  protocolOptions: { type: Array, required: true },
  meterUsages: { type: Array, required: true }, // pour le contextLabel des notes
  highlightId: { type: Number, default: null }, // surligne temporairement une ligne
})

// Options du SearchableSelect « Localisation » : zones techniques d'abord
// (un compteur est généralement installé dans un local technique / TGBT /
// armoire), puis zones fonctionnelles. Le hint affiche le type pour la
// recherche au clavier.
const locationOptions = computed(() => {
  const tech = []
  const fnal = []
  for (const z of (props.zones || [])) {
    if ((z.kind || 'functional') === 'technical') tech.push(z)
    else fnal.push(z)
  }
  return [
    ...tech.map(z => ({ value: z.zone_id, label: z.name, icon: 'fa-screwdriver-wrench', color: '#64748b' })),
    ...fnal.map(z => ({ value: z.zone_id, label: z.name, icon: 'fa-map-pin', color: '#6366f1' })),
  ]
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

// ── Groupage interne de la table : aucun (= liste à plat), par zone, ou
// par usage. Aide à structurer l'audit quand une énergie a beaucoup de
// compteurs (~10+ électriques). Persisté par énergie pour ne pas pénaliser
// les énergies qui n'ont que quelques compteurs.
const GROUP_KEY = `audit.meters.section.groupBy.${props.energy.value}`
const groupBy = ref('zone') // 'none' | 'zone' | 'usage' — défaut zone (lecture terrain par local)
onMounted(() => {
  try {
    const v = window.localStorage.getItem(GROUP_KEY)
    if (v === 'none' || v === 'zone' || v === 'usage') groupBy.value = v
  } catch { /* indispo */ }
})
function setGroupBy(v) {
  groupBy.value = v
  try { window.localStorage.setItem(GROUP_KEY, v) } catch { /* indispo */ }
}

// Construit la liste affichée : soit à plat (groupBy = 'none'), soit
// avec des subheaders inline (un objet { kind: 'header', label, count }
// suivi des compteurs du groupe). Le drag-drop n'est actif qu'en mode
// 'none' (sinon il faudrait reranger en respectant les groupes).
const displayRows = computed(() => {
  if (groupBy.value === 'none') {
    return props.meters.map(m => ({ kind: 'meter', meter: m }))
  }
  const groups = new Map()
  if (groupBy.value === 'zone') {
    for (const m of props.meters) {
      const key = m.zone_id || '__general__'
      const label = m.zone_name || 'Compteur général'
      const isGeneral = !m.zone_id
      if (!groups.has(key)) groups.set(key, {
        label,
        icon: isGeneral ? 'fa-building-circle-arrow-right' : null,
        color: isGeneral ? '#6b7280' : null,
        items: [],
      })
      groups.get(key).items.push(m)
    }
  } else { // 'usage'
    for (const m of props.meters) {
      const key = m.usage || 'other'
      const meta = getMeterUsageMeta(key) || { label: key, icon: 'fa-circle-question', color: '#6b7280' }
      if (!groups.has(key)) groups.set(key, { label: meta.label, icon: meta.icon, color: meta.color, items: [] })
      groups.get(key).items.push(m)
    }
  }
  // Tri stable des groupes : usages dans l'ordre canonique BACS. Pour
  // les zones, on force « Compteur général » (zone_id NULL) en tête,
  // puis les autres zones dans leur ordre d'insertion.
  let orderedKeys
  if (groupBy.value === 'usage') {
    orderedKeys = METER_USAGES.map(u => u.value).filter(k => groups.has(k))
  } else {
    const allKeys = Array.from(groups.keys())
    orderedKeys = allKeys.includes('__general__')
      ? ['__general__', ...allKeys.filter(k => k !== '__general__')]
      : allKeys
  }
  const rows = []
  for (const key of orderedKeys) {
    const g = groups.get(key)
    if (!g) continue
    rows.push({ kind: 'header', label: g.label, count: g.items.length, icon: g.icon, color: g.color })
    for (const m of g.items) rows.push({ kind: 'meter', meter: m })
  }
  return rows
})

// Drag-drop : désactivé quand un groupage est appliqué (sinon les
// subheaders se mélangent et l'expérience devient confuse).
const dragEnabled = computed(() => groupBy.value === 'none')

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
  if (!el || collapsed.value || !dragEnabled.value) return
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
watch([() => props.meters, collapsed, groupBy], async () => {
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
      <!-- Mini toolbar : groupage interne -->
      <div v-if="meters.length > 1" class="px-3 py-2 bg-gray-50/60 border-b border-gray-100 flex items-center gap-2 text-xs">
        <span class="text-gray-500">Grouper&nbsp;:</span>
        <div class="inline-flex gap-0.5 p-0.5 bg-white border border-gray-200 rounded-md">
          <button type="button" @click="setGroupBy('none')"
                  :class="['px-2 py-1 text-xs font-medium rounded transition',
                           groupBy === 'none' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700']">
            Aucun
          </button>
          <button type="button" @click="setGroupBy('zone')"
                  :class="['px-2 py-1 text-xs font-medium rounded transition',
                           groupBy === 'zone' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700']">
            Par zone
          </button>
          <button type="button" @click="setGroupBy('usage')"
                  :class="['px-2 py-1 text-xs font-medium rounded transition',
                           groupBy === 'usage' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700']">
            Par usage
          </button>
        </div>
      </div>
      <div v-if="meters.length" class="overflow-x-auto">
        <table class="data-table w-full text-sm">
          <thead>
            <tr>
              <th class="w-8"></th>
              <th>Zone</th>
              <th>Usage</th>
              <th>Requis</th>
              <th>Présent</th>
              <th>Localisation</th>
              <th>Communicant</th>
              <th>Protocoles</th>
              <th>Câblé</th>
              <th>Hors service</th>
              <th class="text-center">Actions</th>
            </tr>
          </thead>
          <tbody ref="tbodyRef">
            <template v-for="(row, idx) in displayRows" :key="row.kind === 'header' ? 'h-' + row.label + '-' + idx : 'm-' + row.meter.id">
              <!-- Subheader de groupe (zone ou usage) -->
              <tr v-if="row.kind === 'header'" class="group-header">
                <td colspan="11" class="px-3 py-2 bg-gray-100/70 border-t border-gray-200 text-left">
                  <div class="flex items-center gap-2">
                    <span v-if="row.icon"
                          class="w-5 h-5 rounded-md inline-flex items-center justify-center shrink-0"
                          :style="{ background: row.color + '1a', color: row.color }">
                      <FontAwesomeIcon :icon="['fas', row.icon.replace(/^fa-/, '')]" class="w-3 h-3" />
                    </span>
                    <span class="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      {{ row.label }}
                    </span>
                    <span class="text-xs text-gray-400">— {{ row.count }} compteur{{ row.count > 1 ? 's' : '' }}</span>
                  </div>
                </td>
              </tr>
              <!-- Ligne compteur -->
              <tr v-else
                :data-id="row.meter.id"
                :class="['meter-row',
                  row.meter.out_of_service ? 'opacity-50' : '',
                  row.meter.required && !row.meter.present_actual && !row.meter.out_of_service ? 'bg-red-50/40' : '',
                  highlightId === row.meter.id ? 'ring-2 ring-amber-300 bg-amber-50/40' : '']">
              <td class="align-middle">
                <button type="button"
                        class="drag-handle inline-flex p-1 text-gray-300 hover:text-gray-600 cursor-grab active:cursor-grabbing"
                        v-tooltip="'Glisser pour réordonner'">
                  <Bars3Icon class="w-4 h-4" />
                </button>
              </td>
              <td class="text-gray-700 whitespace-nowrap">
                <span v-if="row.meter.required && !row.meter.present_actual && !row.meter.out_of_service"
                      class="text-red-600 mr-1" v-tooltip="'Compteur requis non présent'">⚠</span>
                {{ row.meter.zone_name || 'Compteur général' }}
              </td>
              <td>
                <MeterUsagePill v-if="row.meter.zone_id" :usage="row.meter.usage" />
                <span v-else class="text-xs text-gray-400 italic">—</span>
              </td>
              <td class="whitespace-nowrap">
                <SegmentedToggle compact :model-value="!!row.meter.required"
                                 tooltip="Compteur requis par le décret R175"
                                 @update:model-value="v => emit('patch-meter', { meter: row.meter, patch: { required: v } })" />
              </td>
              <td class="whitespace-nowrap">
                <SegmentedToggle compact :model-value="!!row.meter.present_actual"
                                 tooltip="Compteur présent sur site ?"
                                 @update:model-value="v => emit('patch-meter', { meter: row.meter, patch: { present_actual: v } })" />
              </td>
              <td class="whitespace-nowrap min-w-44">
                <SearchableSelect v-if="row.meter.present_actual"
                  :model-value="row.meter.location_zone_id ?? null"
                  :options="locationOptions"
                  size="sm"
                  placeholder="— Non précisée"
                  search-placeholder="Rechercher un local…"
                  @update:model-value="v => emit('patch-meter', { meter: row.meter, patch: { location_zone_id: v ?? null } })"
                />
                <span v-else class="text-gray-300 text-xs">—</span>
              </td>
              <td class="whitespace-nowrap">
                <SegmentedToggle v-if="row.meter.present_actual" compact :model-value="!!row.meter.communicating"
                                 tooltip="Compteur communicant ?"
                                 @update:model-value="v => emit('patch-meter', { meter: row.meter, patch: v
                                   ? { communicating: true }
                                   : { communicating: false, communication_protocols: null, communication_protocol: null } })" />
                <span v-else class="text-gray-300">—</span>
              </td>
              <td>
                <div class="min-w-32">
                  <ProtocolMultiPicker
                    :model-value="row.meter.communication_protocols || (row.meter.communication_protocol && row.meter.communication_protocol !== 'non_communicant' ? JSON.stringify([row.meter.communication_protocol]) : null)"
                    :disabled="!row.meter.communicating"
                    :options="protocolOptions"
                    size="xs"
                    @update:modelValue="v => emit('patch-meter', { meter: row.meter, patch: { communication_protocols: v, communication_protocol: null } })"
                  />
                </div>
              </td>
              <td class="whitespace-nowrap">
                <SegmentedToggle v-if="row.meter.present_actual" compact :model-value="!!row.meter.wired"
                                 tooltip="Communication câblée vers la GTB ?"
                                 @update:model-value="v => emit('patch-meter', { meter: row.meter, patch: { wired: v } })" />
                <span v-else class="text-gray-300">—</span>
              </td>
              <td class="whitespace-nowrap">
                <SegmentedToggle compact yes-danger :model-value="!!row.meter.out_of_service"
                                 tooltip="Compteur hors service ? (HS = ignoré du plan d'action)"
                                 @update:model-value="v => emit('patch-meter', { meter: row.meter, patch: { out_of_service: v } })" />
              </td>
              <td class="whitespace-nowrap text-center">
                <div class="inline-flex items-center gap-1">
                  <button
                    type="button"
                    @click="emit('open-notes', row.meter)"
                    :class="['btn-icon', hasNotes(row.meter.notes_html || row.meter.notes) && 'is-active']"
                    v-tooltip="hasNotes(row.meter.notes_html || row.meter.notes) ? 'Modifier les notes' : 'Ajouter une note'">
                    <PencilSquareIcon class="w-4 h-4" />
                  </button>
                  <BacsPhotoButton
                    v-if="document?.site_uuid"
                    :site-uuid="document.site_uuid"
                    :attach-to="{ meter_id: row.meter.id }"
                    :label="meterContextLabel(row.meter)"
                  />
                  <VoiceNoteButton
                    v-if="document?.site_uuid"
                    :site-uuid="document.site_uuid"
                    :attach-to="{ meter_id: row.meter.id }"
                    :label="meterContextLabel(row.meter)"
                  />
                  <button @click="emit('duplicate-meter', row.meter)" class="btn-icon" v-tooltip="'Dupliquer'">
                    <DocumentDuplicateIcon class="w-4 h-4" />
                  </button>
                  <button @click="emit('remove-meter', row.meter)" class="btn-icon btn-icon-danger" v-tooltip="'Supprimer'">
                    <TrashIcon class="w-4 h-4" />
                  </button>
                </div>
              </td>
            </tr>
            </template>
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
