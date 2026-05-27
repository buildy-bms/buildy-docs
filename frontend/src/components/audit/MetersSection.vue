<script setup>
import { ref, computed, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { BoltIcon, PencilSquareIcon, PlusIcon, TrashIcon, DocumentDuplicateIcon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import MeterTypePill from '@/components/MeterTypePill.vue'
import MeterUsagePill from '@/components/MeterUsagePill.vue'
import ProtocolMultiPicker from '@/components/ProtocolMultiPicker.vue'
import SegmentedToggle from '@/components/SegmentedToggle.vue'
import MeterCoverageMatrix from '@/components/audit/MeterCoverageMatrix.vue'
import MeterEnergyGroup from '@/components/audit/MeterEnergyGroup.vue'
import { METER_TYPES as ENERGY_METAS } from '@/lib/meter-options'
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
const { meters, document, zones } = storeToRefs(audit)
const { error } = useNotification()
const { confirm } = useConfirm()

// ── Plan de comptage : agrégations par énergie pour les 5 sections ──
function metersOfEnergy(energy) {
  return meters.value.filter(m => m.meter_type === energy)
}
const energySections = computed(() =>
  ENERGY_METAS.map(et => ({ energy: et, meters: metersOfEnergy(et.value) })),
)
const globalStats = computed(() => {
  const arr = meters.value
  return {
    total: arr.length,
    present: arr.filter(m => m.present_actual).length,
    communicating: arr.filter(m => m.communicating).length,
    missing: arr.filter(m => m.required && !m.present_actual && !m.out_of_service).length,
  }
})

// Highlight temporaire d'une ligne quand l'utilisateur clique sur une
// pill de la matrice : on scrolle vers la section concernée et on met
// un ring ambre 2 s pour identifier visuellement la ligne.
const highlightId = ref(null)
function focusMeterFromMatrix(meter) {
  if (!meter?.id) return
  highlightId.value = meter.id
  nextTick(() => {
    const el = window.document.querySelector(`[data-id="${meter.id}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
  setTimeout(() => { highlightId.value = null }, 2000)
}

// Ajout d'un compteur avec préfill éventuel (clic sur cellule vide ou
// bouton « + Ajouter un compteur <énergie> »). Le parent (BacsAuditDetailView)
// reçoit le payload via `@add-meter` et l'utilise pour pré-remplir la modale.
function onAddMeter(payload) {
  emit('add-meter', payload || {})
}

async function patchMeter(m, patch) {
  Object.assign(m, patch)
  try {
    await updateBacsMeter(m.id, patch)
    await audit.refreshActionItems()
  } catch { error('Sauvegarde impossible') }
}

// Handlers pour MeterEnergyGroup (qui passe { meter, patch } en payload).
function onPatchMeterFromGroup({ meter, patch }) {
  return patchMeter(meter, patch)
}
function onOpenNotesFromGroup(m) {
  emit('open-notes', {
    title: 'Notes compteur',
    contextLabel: (m.zone_name || 'Compteur général') + ' — '
      + (props.meterUsages.find(u => u.value === m.usage)?.label || m.usage),
    entityType: 'meter',
    entityRef: m,
    currentHtml: m.notes_html || m.notes || '',
  })
}

// Réordonnage intra-énergie : on remet les compteurs de l'énergie dans
// l'ordre demandé puis on appelle reorderBacsMeters sur la liste complète
// (les autres énergies gardent leur ordre relatif).
async function onReorderFromGroup({ energy, ids }) {
  const idSet = new Set(ids)
  const others = meters.value.filter(m => m.meter_type !== energy || !idSet.has(m.id))
  const reordered = ids.map(id => meters.value.find(m => m.id === id)).filter(Boolean)
  const fullOrder = []
  let reorderedIdx = 0
  for (const m of meters.value) {
    if (m.meter_type === energy && idSet.has(m.id)) {
      fullOrder.push(reordered[reorderedIdx++])
    } else {
      fullOrder.push(m)
    }
  }
  // Note : on conserve les positions globales des autres énergies, on
  // ne réordonne que les compteurs de l'énergie active.
  try {
    await reorderBacsMeters(audit.docId, fullOrder.map(m => m.id))
    await audit.refreshAuditCore()
  } catch {
    error('Réorganisation impossible')
    await audit.refreshAuditCore()
  }
  void others // marqueur lint (variable construite pour la lisibilité)
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

function hasNotes(html) {
  if (!html) return false
  return html.replace(/<[^>]*>/g, '').trim().length > 0
}
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
    <!-- Desktop : « Plan de comptage » en 3 étages (≥768px) -->
    <div class="hidden md:block space-y-4 p-3">
      <!-- Étage 3 — Stats globales -->
      <div class="grid grid-cols-4 gap-3">
        <div class="bg-white rounded-2xl border border-gray-200 p-4">
          <p class="text-2xl font-semibold text-gray-900 leading-none">{{ globalStats.total }}</p>
          <p class="text-xs text-gray-500 mt-1.5">Compteurs total</p>
        </div>
        <div class="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
          <p class="text-2xl font-semibold text-emerald-700 leading-none">{{ globalStats.present }}</p>
          <p class="text-xs text-emerald-600 mt-1.5">Présents</p>
        </div>
        <div class="bg-indigo-50 border border-indigo-200 rounded-2xl p-4">
          <p class="text-2xl font-semibold text-indigo-700 leading-none">{{ globalStats.communicating }}</p>
          <p class="text-xs text-indigo-600 mt-1.5">Communicants</p>
        </div>
        <div :class="['rounded-2xl border p-4',
                      globalStats.missing > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200']">
          <p :class="['text-2xl font-semibold leading-none',
                      globalStats.missing > 0 ? 'text-red-700' : 'text-gray-700']">
            {{ globalStats.missing }}
          </p>
          <p :class="['text-xs mt-1.5', globalStats.missing > 0 ? 'text-red-600' : 'text-gray-500']">
            Requis manquants
          </p>
        </div>
      </div>

      <!-- Étage 1 — Matrice de couverture visuelle -->
      <MeterCoverageMatrix
        :meters="meters"
        :zones="zones"
        @cell-click="focusMeterFromMatrix"
        @add-meter="onAddMeter"
      />

      <!-- Étage 2 — Sections par énergie -->
      <div class="space-y-3">
        <MeterEnergyGroup
          v-for="section in energySections"
          :key="section.energy.value"
          :energy="section.energy"
          :meters="section.meters"
          :zones="zones"
          :document="document"
          :protocol-options="protocolOptions"
          :meter-usages="meterUsages"
          :highlight-id="highlightId"
          @patch-meter="onPatchMeterFromGroup"
          @duplicate-meter="dupMeter"
          @remove-meter="removeMeter"
          @open-notes="onOpenNotesFromGroup"
          @add-meter="onAddMeter"
          @reorder="onReorderFromGroup"
        />
      </div>

      <!-- Empty state (aucune zone créée encore) -->
      <div v-if="!meters.length && !zones.length"
           class="bg-white rounded-2xl border border-dashed border-gray-300 p-6 text-center text-xs text-gray-500">
        Crée d'abord des zones — le plan de comptage apparaîtra ensuite. Renseigne les
        compteurs requis (R175-3 1°) à mesure de la visite.
      </div>
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
