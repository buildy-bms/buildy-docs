<script setup>
import { ref, computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import {
  Squares2X2Icon,
  ChevronRightIcon,
  TrashIcon,
  CameraIcon,
  PencilSquareIcon,
  PlusIcon,
} from '@heroicons/vue/24/outline'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import { createZone, updateZone, deleteZone, listZones, resyncBacsAudit } from '@/api'
import MobileField from './MobileField.vue'
import MobileSheet from './MobileSheet.vue'
import MobileSelectSheet from './MobileSelectSheet.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import { ZONE_NATURES as ZONE_NATURES_DECORATED } from '@/lib/audit-options'

const audit = useAuditStore()
const { document, zones } = storeToRefs(audit)
const { error, success } = useNotification()
const { confirm } = useConfirm()

// Décorées (icon + color) depuis lib/audit-options pour rendu visuel
// dans MobileSelectSheet. Liste partagée avec backend (bacs-requirements).
const ZONE_NATURES = ZONE_NATURES_DECORATED
function natureLabel(v) { return ZONE_NATURES.find(n => n.value === v)?.label || '—' }

// Sheet state
const editing = ref(null) // { mode: 'create'|'edit', zone: {...} }
const editForm = ref({ name: '', nature: null, surface_m2: null })
const saving = ref(false)

function openCreate() {
  editForm.value = { name: '', nature: null, surface_m2: null }
  editing.value = { mode: 'create' }
}
function openEdit(z) {
  editForm.value = { name: z.name, nature: z.nature, surface_m2: z.surface_m2 }
  editing.value = { mode: 'edit', zone: z }
}
function close() {
  editing.value = null
}

// Ouverture directe depuis l'onglet Docs (KPIs couverture photo) :
// MobileChecklistTab set audit.pendingFocus = { kind: 'zones', id }
// puis bascule l'onglet ; on l'observe ici pour ouvrir le sheet d'édition.
watch(() => audit.pendingFocus, (focus) => {
  if (!focus || focus.kind !== 'zones' || focus.id == null) return
  const zone = zones.value.find(z => z.zone_id === focus.id)
  if (zone) openEdit(zone)
  audit.pendingFocus = null
}, { immediate: true })

async function save() {
  if (!editForm.value.name?.trim()) {
    error('Le nom est requis')
    return
  }
  saving.value = true
  try {
    if (editing.value.mode === 'create') {
      await createZone({
        site_id: document.value.site_id,
        name: editForm.value.name.trim(),
        nature: editForm.value.nature,
        surface_m2: editForm.value.surface_m2 ?? null,
      })
      const r = await listZones(document.value.site_id)
      zones.value = r.data
      await resyncBacsAudit(document.value.id)
      await audit.refreshAuditCore()
      success('Zone ajoutée')
    } else {
      const patch = {
        name: editForm.value.name.trim(),
        nature: editForm.value.nature,
        surface_m2: editForm.value.surface_m2 ?? null,
      }
      const { data } = await updateZone(editing.value.zone.zone_id, patch)
      Object.assign(editing.value.zone, data)
      await audit.refreshAuditCore()
      success('Zone mise à jour')
    }
    close()
  } catch (e) {
    error(e.response?.data?.detail || 'Sauvegarde impossible')
  } finally {
    saving.value = false
  }
}

async function remove(z) {
  const ok = await confirm({
    title: `Supprimer « ${z.name} » ?`,
    message: 'La zone sera retirée du site, ainsi que les systèmes / compteurs / régulations rattachés.',
    confirmLabel: 'Supprimer',
    danger: true,
  })
  if (!ok) return
  try {
    await deleteZone(z.zone_id)
    const r = await listZones(document.value.site_id)
    zones.value = r.data
    await resyncBacsAudit(document.value.id)
    await audit.refreshAuditCore()
    if (editing.value?.zone?.zone_id === z.zone_id) close()
  } catch {
    error('Suppression impossible')
  }
}

const totalSurface = computed(() =>
  zones.value.reduce((s, z) => s + (z.surface_m2 || 0), 0)
)
</script>

<template>
  <div class="p-3 space-y-3">
    <!-- Stats résumé -->
    <div class="bg-white rounded-2xl border border-gray-200 p-4 flex items-center gap-4">
      <div class="w-14 h-14 rounded-xl bg-indigo-50 text-indigo-600 inline-flex items-center justify-center">
        <Squares2X2Icon class="w-7 h-7" />
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-3xl font-medium text-gray-900 leading-none">{{ zones.length }}</p>
        <p class="text-sm text-gray-500 mt-1.5">
          {{ zones.length > 1 ? 'zones' : 'zone' }}
          <span v-if="totalSurface"> · {{ totalSurface }} m² total</span>
        </p>
      </div>
    </div>

    <!-- Bouton Ajouter prominent en haut -->
    <button
      type="button"
      @click="openCreate"
      class="w-full flex items-center justify-center gap-2 px-4 py-4 text-base font-medium text-white bg-emerald-600 active:bg-emerald-700 rounded-2xl shadow-sm"
    >
      <PlusIcon class="w-5 h-5" />
      Ajouter une zone
    </button>

    <!-- Liste -->
    <div v-if="zones.length" class="bg-white rounded-2xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
      <button
        v-for="z in zones"
        :key="z.zone_id"
        type="button"
        @click="openEdit(z)"
        class="w-full flex items-center gap-3 px-4 py-4 text-left active:bg-gray-50"
      >
        <div class="flex-1 min-w-0">
          <p class="text-lg font-medium text-gray-900 truncate leading-tight">{{ z.name }}</p>
          <p class="text-sm text-gray-500 truncate mt-1">
            <span>{{ natureLabel(z.nature) }}</span>
            <span v-if="z.surface_m2"> · {{ z.surface_m2 }} m²</span>
          </p>
        </div>
        <ChevronRightIcon class="w-6 h-6 text-gray-300 shrink-0" />
      </button>
    </div>
    <div v-else class="text-center py-6">
      <Squares2X2Icon class="w-10 h-10 text-gray-300 mx-auto" />
      <p class="text-sm text-gray-500 mt-2">Aucune zone définie pour l'instant</p>
    </div>

    <!-- Sheet édition -->
    <MobileSheet
      :open="!!editing"
      :title="editing?.mode === 'create' ? 'Nouvelle zone' : (editing?.zone?.name || 'Zone')"
      :saving="saving"
      @close="close"
      @save="save"
    >
      <div class="p-4 space-y-4">
        <!-- Photos terrain en TÊTE (mode édition uniquement). -->
        <div v-if="editing?.mode === 'edit' && document?.site_uuid"
             class="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p class="text-xs font-medium text-gray-600 uppercase tracking-wider mb-2">Photos</p>
          <BacsPhotoButton
            :site-uuid="document.site_uuid"
            :attach-to="{ zone_id: editing.zone.zone_id }"
            :label="editing.zone.name"
            size="md"
          />
        </div>

        <MobileField label="Nom" hint="Nom court qui identifie la zone dans tout l'audit. Reste cohérent avec les plans du bâtiment si possible." required>
          <input
            v-model="editForm.name"
            type="text"
            placeholder="ex : Bureaux R+1"
            autocapitalize="sentences"
            class="touch-control w-full"
          />
        </MobileField>

        <MobileField label="Nature de la zone" hint="Type d'usage (R175-1 6°). Une zone fonctionnelle = un local ou regroupement de locaux ayant le même type d'utilisation.">
          <MobileSelectSheet
            v-model="editForm.nature"
            :options="ZONE_NATURES"
            title="Nature de la zone"
            placeholder="— Sélectionner —"
          />
        </MobileField>

        <MobileField label="Surface (m²)" hint="Surface au sol approximative de la zone.">
          <input
            v-model.number="editForm.surface_m2"
            type="number"
            inputmode="decimal"
            pattern="[0-9.,]*"
            min="0"
            step="1"
            placeholder="—"
            class="touch-control w-full text-right font-medium"
          />
        </MobileField>

        <!-- Suppression (édition uniquement) -->
        <template v-if="editing?.mode === 'edit' && document?.site_uuid">
          <div class="pt-4 border-t border-gray-200">
            <button
              @click="remove(editing.zone)"
              class="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-red-600 bg-red-50 border border-red-200 rounded-xl font-medium"
            >
              <TrashIcon class="w-5 h-5" />
              Supprimer la zone
            </button>
          </div>
        </template>
      </div>
    </MobileSheet>
  </div>
</template>
