<script setup>
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import {
  Squares2X2Icon,
  ChevronRightIcon,
  TrashIcon,
  CameraIcon,
  PencilSquareIcon,
} from '@heroicons/vue/24/outline'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import { createZone, updateZone, deleteZone, listZones, resyncBacsAudit } from '@/api'
import MobileField from './MobileField.vue'
import MobileFab from './MobileFab.vue'
import MobileSheet from './MobileSheet.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'

const audit = useAuditStore()
const { document, zones } = storeToRefs(audit)
const { error, success } = useNotification()
const { confirm } = useConfirm()

const ZONE_NATURES = [
  { value: 'shared-office', label: 'Bureau partagé' },
  { value: 'private-office', label: 'Bureau privé' },
  { value: 'open-space', label: 'Open-space' },
  { value: 'commercial-space', label: 'Espace commercial' },
  { value: 'meeting-room', label: 'Salle de réunion' },
  { value: 'workshop', label: 'Atelier' },
  { value: 'switchboard', label: 'Tableau électrique' },
  { value: 'technical-area', label: 'Local technique' },
  { value: 'classroom', label: 'Salle de classe' },
  { value: 'leasure-space', label: 'Espace loisirs' },
  { value: 'foyer', label: 'Foyer' },
  { value: 'corridor', label: 'Couloir' },
  { value: 'outdoor', label: 'Extérieur' },
  { value: 'meters', label: 'Local compteurs' },
  { value: 'shared-space', label: 'Espace partagé' },
  { value: 'logistic-cell', label: 'Cellule logistique' },
  { value: 'stock', label: 'Stock' },
]
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
  <div class="p-3 pb-24 space-y-3">
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
    <div v-else class="bg-white rounded-2xl border border-dashed border-gray-300 p-8 text-center">
      <Squares2X2Icon class="w-10 h-10 text-gray-300 mx-auto" />
      <p class="text-sm text-gray-500 mt-3">Aucune zone définie</p>
      <p class="text-xs text-gray-400 mt-1">Tape le bouton + en bas pour ajouter une zone</p>
    </div>

    <!-- FAB Ajouter -->
    <MobileFab label="Ajouter une zone" @click="openCreate" />

    <!-- Sheet édition -->
    <MobileSheet
      :open="!!editing"
      :title="editing?.mode === 'create' ? 'Nouvelle zone' : (editing?.zone?.name || 'Zone')"
      :saving="saving"
      @close="close"
      @save="save"
    >
      <div class="p-4 space-y-4">
        <MobileField label="Nom" required>
          <input
            v-model="editForm.name"
            type="text"
            placeholder="ex : Bureaux R+1"
            autocapitalize="sentences"
            class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
          />
        </MobileField>

        <MobileField label="Nature de la zone">
          <select
            v-model="editForm.nature"
            class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
          >
            <option :value="null">— Sélectionner —</option>
            <option v-for="opt in ZONE_NATURES" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </MobileField>

        <MobileField label="Surface (m²)">
          <input
            v-model.number="editForm.surface_m2"
            type="number"
            inputmode="decimal"
            pattern="[0-9.,]*"
            min="0"
            step="1"
            placeholder="—"
            class="w-full px-4 py-3 border border-gray-200 rounded-xl bg-white text-right font-medium"
          />
        </MobileField>

        <!-- Photos (édition uniquement) -->
        <template v-if="editing?.mode === 'edit' && document?.site_uuid">
          <div class="pt-2">
            <p class="text-xs font-medium text-gray-600 uppercase tracking-wider mb-2">Photos</p>
            <BacsPhotoButton
              :site-uuid="document.site_uuid"
              :attach-to="{ zone_id: editing.zone.zone_id }"
              :label="editing.zone.name"
              size="md"
            />
          </div>

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
