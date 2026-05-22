<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import Sortable from 'sortablejs'
import { MapPinIcon, PencilSquareIcon, PlusIcon, TrashIcon, DocumentDuplicateIcon, Bars3Icon, QuestionMarkCircleIcon, UserGroupIcon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import BaseModal from '@/components/BaseModal.vue'
import ZoneMapPicker from '@/components/ZoneMapPicker.vue'
import ZoneFunctionalHelpModal from '@/components/audit/ZoneFunctionalHelpModal.vue'
import ZonePartiesModal from '@/components/audit/ZonePartiesModal.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import PhotoDropTr from '@/components/PhotoDropTr.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import VoiceNoteButton from '@/components/VoiceNoteButton.vue'
import SearchableSelect from '@/components/SearchableSelect.vue'
import DataTableSortHeader from '@/components/DataTableSortHeader.vue'
import { useTableSort } from '@/composables/useTableSort'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import { updateZone, deleteZone, listZones, resyncBacsAudit, reorderBacsZones } from '@/api'
import { ZONE_OCCUPANCY_PROFILES } from '@/lib/audit-options'

// Section Zones — rendue deux fois selon `kind` :
//   - 'functional' : zones fonctionnelles (R175-1 6°), assujetties BACS,
//     alimentent les cards Systèmes / Compteurs (card 2).
//   - 'technical'  : zones techniques (local technique, TGBT, local
//     compteurs…), hors périmètre BACS, simple inventaire (card 3).
const props = defineProps({
  zoneNatures: { type: Array, required: true },
  step: { type: Object, default: null },
  active: { type: Boolean, default: false },
  kind: { type: String, default: 'functional' }, // 'functional' | 'technical'
})
const emit = defineEmits([
  'open-notes', 'validate-step', 'invalidate-step', 'add-zone',
])

const audit = useAuditStore()
const { document, zones, site, siteParties } = storeToRefs(audit)

const isTechnical = computed(() => props.kind === 'technical')

// Modale d'aide pédagogique « Comprendre la zone fonctionnelle » (item 7a).
const showHelp = ref(false)

// Présentation propre à chaque type de card.
const KIND_UI = computed(() => isTechnical.value
  ? {
      number: '3',
      title: 'Zones techniques',
      subtitleBacs: 'Hors décret BACS — local technique, TGBT, local compteurs…',
      subtitleSite: 'Locaux techniques du site',
      storageKey: 'technical-zones',
      sectionId: 'section-technical-zones',
    }
  : {
      number: '2',
      title: 'Zones fonctionnelles',
      subtitleBacs: 'R175-1 6° — usages homogènes',
      subtitleSite: 'Découpage du site',
      storageKey: 'zones',
      sectionId: 'section-zones',
    })

// Zones de ce type uniquement (les zones sans `kind` sont fonctionnelles).
const kindZones = computed(() =>
  zones.value.filter(z => (z.kind || 'functional') === props.kind))

// Bascule une zone d'une card à l'autre (functional <-> technical).
async function patchZoneKind(z, kind) {
  if ((z.kind || 'functional') === kind) return
  await patchZone(z, { kind })
}
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
    // La zone supprimée a pu être affectée à des parties prenantes
    // (zone_parties supprimé en cascade) — resynchronise leurs zones.
    await audit.refreshSiteParties()
  } catch { error('Suppression impossible') }
}

async function dupZone(z) {
  // Simple : crée une nouvelle zone avec un nom suffixé, même type de zone.
  emit('add-zone', {
    name: `${z.name} (copie)`, nature: z.nature,
    surface_m2: z.surface_m2, kind: z.kind || 'functional',
  })
}

// Positionnement de la zone sur la carte Google Maps (modale dédiée).
const mapZone = ref(null)
const mapCoords = ref({ latitude: null, longitude: null })
function openZoneMap(z) {
  mapCoords.value = { latitude: z.latitude ?? null, longitude: z.longitude ?? null }
  mapZone.value = z
}
async function saveZoneMap() {
  if (!mapZone.value) return
  await patchZone(mapZone.value, {
    latitude: mapCoords.value.latitude,
    longitude: mapCoords.value.longitude,
  })
  mapZone.value = null
}

function refreshAuditData() { return audit.refreshAuditCore() }
function hasNotes(html) {
  if (!html) return false
  return html.replace(/<[^>]*>/g, '').trim().length > 0
}

// Parties prenantes du site (item 4) : lues depuis le store partagé
// (`audit.siteParties`) — la carte Structure juridique et cette section
// pointent ainsi la même liste, toujours à jour. Un bouton par zone ouvre
// une modale dédiée pour gérer les parties rattachées.
const partiesModalZone = ref(null)
function openPartiesModal(z) { partiesModalZone.value = z }
function zoneHasParties(z) {
  return siteParties.value.some(p => (p.zone_ids || []).includes(z.zone_id))
}

// Tri data-table (clic en-tête, asc → desc → off).
const { sortKey, sortDir, toggleSort, sortedRows } = useTableSort()
function sortZoneValue(z, key) {
  if (key === 'name') return (z.name || '').toLowerCase()
  if (key === 'surface_m2') return Number(z.surface_m2) || 0
  return ''
}
const sortedZones = computed(() => sortedRows(kindZones.value, sortZoneValue))

// Drag & drop des zones (desktop uniquement). Sortable sur le <tbody>,
// la ligne « + Ajouter une zone » est filtrée. L'API persiste via
// `reorderBacsZones(docId, ids)` puis on refresh les zones du store.
const zonesBodyRef = ref(null)
let zonesSortable = null
function teardownZonesSortable() {
  if (zonesSortable) { try { zonesSortable.destroy() } catch { /* ignore */ } zonesSortable = null }
}
function setupZonesSortable() {
  teardownZonesSortable()
  const el = zonesBodyRef.value
  if (!el) return
  zonesSortable = Sortable.create(el, {
    draggable: 'tr.zone-row',
    handle: '.drag-handle',
    animation: 150,
    ghostClass: 'sortable-ghost',
    onEnd: async (evt) => {
      if (evt.oldIndex === evt.newIndex) return
      const ids = Array.from(el.querySelectorAll('tr.zone-row'))
        .map(tr => parseInt(tr.getAttribute('data-id'), 10))
        .filter(Boolean)
      try {
        await reorderBacsZones(audit.docId, ids)
        if (document.value?.site_id) {
          const r = await listZones(document.value.site_id)
          zones.value = r.data
        }
      } catch {
        error('Réorganisation impossible')
        if (document.value?.site_id) {
          const r = await listZones(document.value.site_id)
          zones.value = r.data
        }
      }
    },
  })
}
watch(zones, async () => {
  await nextTick()
  setupZonesSortable()
}, { immediate: true, flush: 'post' })
onBeforeUnmount(teardownZonesSortable)
</script>

<template>
  <CollapsibleSection :storage-key="KIND_UI.storageKey" :section-id="KIND_UI.sectionId" :active="active">
    <template #header>
      <SectionHeader :number="KIND_UI.number" :title="KIND_UI.title"
                     :subtitle="audit.isBacs ? KIND_UI.subtitleBacs : KIND_UI.subtitleSite"
                     :icon="MapPinIcon" :icon-color="isTechnical ? 'text-slate-500' : 'text-indigo-600'"
                     :step="step"
                     @validate="emit('validate-step', $event)"
                     @invalidate="emit('invalidate-step', $event)">
        <template v-if="audit.isBacs && !isTechnical" #subtitle-extra><R175Tooltip article="R175-1 6°" /></template>
        <template #actions>
          <button v-if="!isTechnical" type="button" @click.stop="showHelp = true"
                  v-tooltip="'Comprendre la zone fonctionnelle'"
                  class="inline-flex items-center justify-center p-1 rounded-md text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 transition"
                  aria-label="Aide : comprendre la zone fonctionnelle">
            <QuestionMarkCircleIcon class="w-5 h-5" />
          </button>
          <span class="text-[11px] text-gray-500 whitespace-nowrap">{{ kindZones.length }} zone{{ kindZones.length > 1 ? 's' : '' }}</span>
        </template>
      </SectionHeader>
    </template>
    <template #summary>
      <span v-if="kindZones.length">
        {{ kindZones.length }} zone{{ kindZones.length > 1 ? 's' : '' }}
        · surface totale {{ kindZones.reduce((s,z) => s + (z.surface_m2 || 0), 0) || '—' }} m²
        · {{ kindZones.slice(0,4).map(z => z.name).join(' · ') }}{{ kindZones.length > 4 ? ' …' : '' }}
      </span>
      <span v-else class="italic">{{ isTechnical ? 'Aucune zone technique définie' : 'Aucune zone définie' }}</span>
    </template>
    <p v-if="isTechnical" class="px-1 pb-2 text-xs text-gray-500">
      Locaux hors périmètre du décret BACS. Inventoriés ici, ils ne génèrent
      pas de systèmes ni de compteurs dans les cards suivantes.
    </p>
    <!-- Desktop : data-table aligné (>=768px) -->
    <div class="hidden md:block overflow-x-auto">
      <table class="data-table w-full text-sm">
        <thead>
          <tr>
            <th class="w-8"></th>
            <DataTableSortHeader sort-key="name" :active-key="sortKey" :dir="sortDir" @toggle="toggleSort">Nom</DataTableSortHeader>
            <th>Nature</th>
            <th v-if="!isTechnical">Régime d'activité</th>
            <th>Type</th>
            <DataTableSortHeader sort-key="surface_m2" :active-key="sortKey" :dir="sortDir" @toggle="toggleSort">Surface (m²)</DataTableSortHeader>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody ref="zonesBodyRef">
          <template v-for="z in sortedZones" :key="z.zone_id">
          <PhotoDropTr :row-class="'zone-row'"
                       :data-id="z.zone_id"
                       :site-uuid="document?.site_uuid || ''"
                       :attach-to="{ zone_id: z.zone_id }"
                       :enabled="!!document?.site_uuid"
                       @changed="refreshAuditData">
            <td class="align-middle">
              <button type="button"
                      class="drag-handle inline-flex p-1 text-gray-300 hover:text-gray-600 cursor-grab active:cursor-grabbing"
                      v-tooltip="'Glisser pour réordonner'">
                <Bars3Icon class="w-4 h-4" />
              </button>
            </td>
            <td>
              <input type="text" :value="z.name"
                     @blur="e => e.target.value !== z.name && patchZone(z, { name: e.target.value })"
                     class="w-full text-sm px-2 py-1 border border-gray-200 rounded-md hover:border-gray-300 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition bg-white font-semibold text-gray-900" />
            </td>
            <td class="min-w-44">
              <SearchableSelect
                :model-value="z.nature"
                @update:model-value="v => patchZone(z, { nature: v || null })"
                :options="zoneNatures"
                placeholder="Nature de la zone"
              />
            </td>
            <td v-if="!isTechnical" class="min-w-44">
              <SearchableSelect
                :model-value="z.occupancy_profile"
                @update:model-value="v => patchZone(z, { occupancy_profile: v || null })"
                :options="ZONE_OCCUPANCY_PROFILES"
                placeholder="Régime d'activité"
              />
            </td>
            <td class="whitespace-nowrap">
              <div class="inline-flex rounded-md border border-gray-200 overflow-hidden text-xs">
                <button type="button" @click="patchZoneKind(z, 'functional')"
                        v-tooltip="'Zone fonctionnelle — assujettie au décret BACS'"
                        :class="(z.kind || 'functional') === 'functional'
                          ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'"
                        class="px-2.5 py-1 font-medium transition whitespace-nowrap">Fonctionnelle</button>
                <button type="button" @click="patchZoneKind(z, 'technical')"
                        v-tooltip="'Zone technique — hors décret BACS'"
                        :class="(z.kind || 'functional') === 'technical'
                          ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'"
                        class="px-2.5 py-1 font-medium transition whitespace-nowrap border-l border-gray-200">Technique</button>
              </div>
            </td>
            <td class="whitespace-nowrap">
              <div class="w-24 mx-auto">
                <input type="number" min="0" step="1" :value="z.surface_m2" placeholder="—"
                       @blur="e => patchZone(z, { surface_m2: e.target.value === '' ? null : parseFloat(e.target.value) })"
                       class="w-full text-sm px-2 py-1 border border-transparent hover:border-gray-200 focus:border-indigo-500 focus:outline-none rounded bg-transparent" />
              </div>
            </td>
            <td class="whitespace-nowrap">
              <div class="inline-flex items-center gap-1">
                <button
                  type="button"
                  @click="emit('open-notes', { title: 'Notes - ' + z.name, contextLabel: 'Zone : ' + z.name, entityType: 'zone', entityRef: z, currentHtml: z.notes_html || z.notes || '' })"
                  :class="['btn-icon', hasNotes(z.notes_html || z.notes) && 'is-active']"
                  v-tooltip="hasNotes(z.notes_html || z.notes) ? 'Modifier les notes' : 'Ajouter une note'">
                  <PencilSquareIcon class="w-4 h-4" />
                </button>
                <BacsPhotoButton
                  v-if="document?.site_uuid"
                  :site-uuid="document.site_uuid"
                  :attach-to="{ zone_id: z.zone_id }"
                  :label="z.name" />
                <VoiceNoteButton
                  v-if="document?.site_uuid"
                  :site-uuid="document.site_uuid"
                  :attach-to="{ zone_id: z.zone_id }"
                  :label="z.name" />
                <button @click="openPartiesModal(z)"
                        :class="['btn-icon', zoneHasParties(z) && 'is-active']"
                        v-tooltip="'Parties prenantes de la zone'"
                        aria-label="Parties prenantes de la zone">
                  <UserGroupIcon class="w-4 h-4" />
                </button>
                <button @click="openZoneMap(z)"
                        :class="['btn-icon', z.latitude != null && 'is-active']"
                        v-tooltip="z.latitude != null ? 'Position sur la carte' : 'Positionner sur la carte'">
                  <MapPinIcon class="w-4 h-4" />
                </button>
                <button @click="dupZone(z)" class="btn-icon" v-tooltip="'Dupliquer'">
                  <DocumentDuplicateIcon class="w-4 h-4" />
                </button>
                <button @click="removeZone(z)" class="btn-icon btn-icon-danger" v-tooltip="'Supprimer'">
                  <TrashIcon class="w-4 h-4" />
                </button>
              </div>
            </td>
          </PhotoDropTr>
          </template>
          <tr>
            <td :colspan="isTechnical ? 6 : 7" class="px-3 py-3">
              <button @click="emit('add-zone', { kind })"
                      class="btn-add">
                <PlusIcon class="w-4 h-4 shrink-0" />
                {{ isTechnical ? 'Ajouter une zone technique' : 'Ajouter une zone' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Mobile : cards empilées (<768px) -->
    <div class="md:hidden divide-y divide-gray-100">
      <div v-for="z in kindZones" :key="`m-${z.zone_id}`" class="p-3 space-y-2">
        <div class="flex items-start gap-2">
          <input type="text" :value="z.name" placeholder="Nom de la zone"
                 @blur="e => e.target.value !== z.name && patchZone(z, { name: e.target.value })"
                 class="flex-1 px-3 py-1 border border-gray-200 rounded-lg" />
          <button @click="removeZone(z)"
                  class="tap-target inline-flex items-center justify-center text-gray-400 hover:text-red-600 rounded-lg"
                  aria-label="Supprimer la zone">
            <TrashIcon class="w-5 h-5" />
          </button>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <SearchableSelect
            :model-value="z.nature"
            @update:model-value="v => patchZone(z, { nature: v || null })"
            :options="zoneNatures"
            placeholder="Nature…"
          />
          <input type="number" inputmode="decimal" pattern="[0-9.,]*" min="0" step="1"
                 :value="z.surface_m2" placeholder="Surface m²"
                 @blur="e => patchZone(z, { surface_m2: e.target.value === '' ? null : parseFloat(e.target.value) })"
                 class="w-full px-3 py-1 border border-gray-200 rounded-lg" />
        </div>
        <SearchableSelect
          v-if="!isTechnical"
          :model-value="z.occupancy_profile"
          @update:model-value="v => patchZone(z, { occupancy_profile: v || null })"
          :options="ZONE_OCCUPANCY_PROFILES"
          placeholder="Régime d'activité…"
        />
        <div class="inline-flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          <button type="button" @click="patchZoneKind(z, 'functional')"
                  :class="(z.kind || 'functional') === 'functional'
                    ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500'"
                  class="px-3 py-1.5 font-medium transition">Fonctionnelle</button>
          <button type="button" @click="patchZoneKind(z, 'technical')"
                  :class="(z.kind || 'functional') === 'technical'
                    ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500'"
                  class="px-3 py-1.5 font-medium transition border-l border-gray-200">Technique</button>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            @click="emit('open-notes', { title: 'Notes - ' + z.name, contextLabel: 'Zone : ' + z.name, entityType: 'zone', entityRef: z, currentHtml: z.notes_html || z.notes || '' })"
            :class="['flex-1 tap-target inline-flex items-center justify-center gap-1.5 px-3 py-1 text-sm font-medium rounded-lg border transition',
              hasNotes(z.notes_html || z.notes)
                ? 'border-indigo-300 text-indigo-700 bg-indigo-50'
                : 'border-gray-200 text-gray-600 bg-white']">
            <PencilSquareIcon class="w-4 h-4" />
            {{ hasNotes(z.notes_html || z.notes) ? 'Notes' : '+ Notes' }}
          </button>
          <BacsPhotoButton
            v-if="document?.site_uuid"
            :site-uuid="document.site_uuid"
            :attach-to="{ zone_id: z.zone_id }"
            :label="z.name"
            class="flex-1" />
          <button @click="openZoneMap(z)"
                  class="tap-target inline-flex items-center justify-center rounded-lg border border-gray-200 px-3"
                  :class="z.latitude != null ? 'text-indigo-600' : 'text-gray-400 hover:text-indigo-600'"
                  aria-label="Positionner sur la carte">
            <MapPinIcon class="w-4 h-4" />
          </button>
          <button @click="dupZone(z)"
                  class="tap-target inline-flex items-center justify-center text-gray-400 hover:text-indigo-600 rounded-lg border border-gray-200 px-3"
                  aria-label="Dupliquer">
            <DocumentDuplicateIcon class="w-4 h-4" />
          </button>
        </div>
      </div>
      <div class="p-3">
        <button @click="emit('add-zone', { kind })"
                class="btn-add">
          <PlusIcon class="w-4 h-4 shrink-0" />
          {{ isTechnical ? 'Ajouter une zone technique' : 'Ajouter une zone' }}
        </button>
      </div>
    </div>
  </CollapsibleSection>

  <!-- Positionnement de la zone sur la carte Google Maps -->
  <BaseModal
    v-if="mapZone"
    :title="`Positionner « ${mapZone.name} » sur la carte`"
    size="full"
    @close="mapZone = null"
  >
    <ZoneMapPicker
      large
      v-model:latitude="mapCoords.latitude"
      v-model:longitude="mapCoords.longitude"
      :kind="mapZone.kind || 'functional'"
      :zones="zones"
      :current-zone-id="mapZone.zone_id"
      :site="site || {}"
    />
    <template #footer>
      <button type="button" @click="mapZone = null"
              class="px-4 py-2 text-sm rounded-lg text-gray-700 hover:bg-gray-100 transition-colors">
        Annuler
      </button>
      <button type="button" @click="saveZoneMap"
              class="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">
        Enregistrer la position
      </button>
    </template>
  </BaseModal>

  <!-- Aide pédagogique « Comprendre la zone fonctionnelle » (item 7a) -->
  <ZoneFunctionalHelpModal v-if="showHelp" @close="showHelp = false" />

  <!-- Parties prenantes rattachées à une zone (item 4/5) -->
  <ZonePartiesModal
    v-if="partiesModalZone"
    :zone="partiesModalZone"
    :site-parties="siteParties"
    @close="partiesModalZone = null"
  />
</template>
