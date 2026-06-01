<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
import { ref, computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import { createZone, updateZone, deleteZone, listZones, resyncBacsAudit } from '@/api'
import MobileField from './MobileField.vue'
import MobileSheet from './MobileSheet.vue'
import MobileSelectSheet from './MobileSelectSheet.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import VoiceNoteButton from '@/components/VoiceNoteButton.vue'
import ZoneMapPicker from '@/components/ZoneMapPicker.vue'
import ZoneFunctionalHelpModal from '@/components/audit/ZoneFunctionalHelpModal.vue'
import ZonePartiesPicker from '@/components/audit/ZonePartiesPicker.vue'
import { ZONE_NATURES as ZONE_NATURES_DECORATED, ZONE_OCCUPANCY_PROFILES, isTechnicalNature } from '@/lib/audit-options'

const audit = useAuditStore()
const { document, zones, siteParties } = storeToRefs(audit)
const { error, success } = useNotification()
const { confirm } = useConfirm()

// Décorées (icon + color) depuis lib/audit-options pour rendu visuel
// dans MobileSelectSheet. Liste partagée avec backend (bacs-requirements).
const ZONE_NATURES = ZONE_NATURES_DECORATED
function natureLabel(v) { return ZONE_NATURES.find(n => n.value === v)?.label || '—' }

// Zones réparties par type. Les zones techniques (local technique, TGBT…)
// sont hors décret BACS : listées à part, sans systèmes / compteurs auto.
const functionalZones = computed(() =>
  zones.value.filter(z => (z.kind || 'functional') !== 'technical'))
const technicalZones = computed(() =>
  zones.value.filter(z => (z.kind || 'functional') === 'technical'))

// Sheet state
const editing = ref(null) // { mode: 'create'|'edit', zone: {...} }
const editForm = ref({
  name: '', nature: null, surface_m2: null, kind: 'functional',
  latitude: null, longitude: null, occupancy_profile: null, comfort_constraint: null,
})
const saving = ref(false)

// Modale d'aide pédagogique « Comprendre la zone fonctionnelle » (item 7a).
const showHelp = ref(false)

// Pré-remplit le type quand la nature est technique (sens unique :
// jamais de rétrogradation auto vers « fonctionnelle »). Corrigeable.
const kindTouched = ref(false)
watch(() => editForm.value.nature, (nat) => {
  if (kindTouched.value || !nat) return
  if (isTechnicalNature(nat)) editForm.value.kind = 'technical'
})
function setKind(k) { kindTouched.value = true; editForm.value.kind = k }

function openCreate(kind = 'functional') {
  editForm.value = {
    name: '', nature: null, surface_m2: null, kind,
    latitude: null, longitude: null, occupancy_profile: null, comfort_constraint: null,
  }
  kindTouched.value = false
  editing.value = { mode: 'create' }
}
function openEdit(z) {
  editForm.value = {
    name: z.name, nature: z.nature, surface_m2: z.surface_m2,
    kind: z.kind || 'functional',
    latitude: z.latitude ?? null, longitude: z.longitude ?? null,
    occupancy_profile: z.occupancy_profile ?? null,
    comfort_constraint: z.comfort_constraint ?? null,
  }
  kindTouched.value = true
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
        kind: editForm.value.kind || 'functional',
        surface_m2: editForm.value.surface_m2 ?? null,
        latitude: editForm.value.latitude ?? null,
        longitude: editForm.value.longitude ?? null,
        occupancy_profile: editForm.value.occupancy_profile ?? null,
        comfort_constraint: editForm.value.comfort_constraint ?? null,
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
        kind: editForm.value.kind || 'functional',
        surface_m2: editForm.value.surface_m2 ?? null,
        latitude: editForm.value.latitude ?? null,
        longitude: editForm.value.longitude ?? null,
        occupancy_profile: editForm.value.occupancy_profile ?? null,
        comfort_constraint: editForm.value.comfort_constraint ?? null,
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
    await audit.refreshSiteParties()
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
        <FontAwesomeIcon :icon="['fas', 'table-cells-large']" class="w-7 h-7" />
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-3xl font-medium text-gray-900 leading-none">{{ zones.length }}</p>
        <p class="text-sm text-gray-500 mt-1.5">
          {{ zones.length > 1 ? 'zones' : 'zone' }}
          <span v-if="totalSurface"> · {{ totalSurface }} m² total</span>
        </p>
      </div>
    </div>

    <!-- Zones fonctionnelles -->
    <div>
      <p class="px-1 pb-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
        Zones fonctionnelles ({{ functionalZones.length }})
      </p>
      <div v-if="functionalZones.length" class="bg-white rounded-2xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
        <button
          v-for="z in functionalZones"
          :key="z.zone_id"
          type="button"
          @click="openEdit(z)"
          class="w-full flex items-center gap-3 px-4 py-4 text-left active:bg-gray-50"
        >
          <div class="flex-1 min-w-0">
            <p class="text-base font-semibold text-gray-900 truncate leading-tight">{{ z.name }}</p>
            <p class="text-sm text-gray-500 truncate mt-1">
              <span>{{ natureLabel(z.nature) }}</span>
              <span v-if="z.surface_m2"> · {{ z.surface_m2 }} m²</span>
            </p>
          </div>
          <FontAwesomeIcon :icon="['fas', 'chevron-right']" class="w-6 h-6 text-gray-300 shrink-0" />
        </button>
      </div>
      <p v-else class="text-sm text-gray-500 italic px-1 py-2">Aucune zone fonctionnelle</p>
      <button
        type="button"
        @click="openCreate('functional')"
        class="pwa-button pwa-button--add mt-2"
      >
        <FontAwesomeIcon :icon="['fas', 'plus']" class="w-5 h-5 shrink-0" />
        Ajouter une zone
      </button>
    </div>

    <!-- Zones techniques (hors décret BACS) -->
    <div>
      <div class="px-1 pb-1.5">
        <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Zones techniques ({{ technicalZones.length }})
        </p>
      </div>
      <div v-if="technicalZones.length" class="bg-white rounded-2xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
        <button
          v-for="z in technicalZones"
          :key="z.zone_id"
          type="button"
          @click="openEdit(z)"
          class="w-full flex items-center gap-3 px-4 py-4 text-left active:bg-gray-50"
        >
          <div class="flex-1 min-w-0">
            <p class="text-base font-semibold text-gray-900 truncate leading-tight">{{ z.name }}</p>
            <p class="text-sm text-gray-500 truncate mt-1">
              <span>{{ natureLabel(z.nature) }}</span>
              <span v-if="z.surface_m2"> · {{ z.surface_m2 }} m²</span>
            </p>
          </div>
          <FontAwesomeIcon :icon="['fas', 'chevron-right']" class="w-6 h-6 text-gray-300 shrink-0" />
        </button>
      </div>
      <p v-else class="text-sm text-gray-500 italic px-1 py-2">
        Aucune zone technique — locaux hors décret BACS (local technique, TGBT…).
      </p>
      <button
        type="button"
        @click="openCreate('technical')"
        class="pwa-button pwa-button--add mt-2"
      >
        <FontAwesomeIcon :icon="['fas', 'plus']" class="w-5 h-5 shrink-0" />
        Ajouter une zone technique
      </button>
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
        <div v-if="editing?.mode === 'edit' && document?.site_uuid"
             class="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p class="text-xs font-medium text-gray-600 uppercase tracking-wider mb-2">Notes vocales</p>
          <VoiceNoteButton
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
            class="pwa-input w-full"
          />
        </MobileField>

        <!-- Aide pédagogique zone fonctionnelle (item 7a) -->
        <button v-if="editForm.kind !== 'technical'" type="button" @click="showHelp = true"
                class="w-full flex items-center gap-2.5 px-4 py-3 rounded-xl bg-indigo-50 border border-indigo-200 text-left">
          <FontAwesomeIcon :icon="['fas', 'circle-question']" class="w-5 h-5 text-indigo-600 shrink-0" />
          <span class="flex-1 text-sm text-gray-700">Comprendre la zone fonctionnelle — ce n'est pas une pièce.</span>
          <FontAwesomeIcon :icon="['fas', 'chevron-right']" class="w-4 h-4 text-indigo-400 shrink-0" />
        </button>

        <MobileField label="Nature de la zone" hint="Type d'usage (R175-1 6°). Une zone fonctionnelle = un local ou regroupement de locaux ayant le même type d'utilisation.">
          <MobileSelectSheet
            v-model="editForm.nature"
            :options="ZONE_NATURES"
            title="Nature de la zone"
            placeholder="— Sélectionner —"
          />
        </MobileField>

        <MobileField v-if="editForm.kind !== 'technical'" label="Régime d'activité"
                     hint="Usage temporel de la zone (24/7, heures de bureau, scolaire…). Aide à juger si deux zones ont un usage homogène.">
          <MobileSelectSheet
            v-model="editForm.occupancy_profile"
            :options="ZONE_OCCUPANCY_PROFILES"
            title="Régime d'activité"
            placeholder="— Sélectionner —"
          />
        </MobileField>

        <MobileField v-if="editForm.kind !== 'technical'" label="Contrainte de confort"
                     hint="Contrainte spécifique éventuelle : température minimale imposée, exigence de qualité d'air…">
          <input
            v-model="editForm.comfort_constraint"
            type="text"
            placeholder="ex : température minimale 22 °C"
            autocapitalize="sentences"
            class="pwa-input w-full"
          />
        </MobileField>

        <MobileField label="Type de zone" hint="Une zone technique (local technique, TGBT, local compteurs…) est hors décret BACS : elle ne génère pas de système ni de compteur automatiquement.">
          <div class="flex gap-2">
            <button type="button" @click="setKind('functional')"
                    :class="editForm.kind !== 'technical'
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-600 border-gray-200'"
                    class="flex-1 min-h-11 px-3 rounded-lg border font-medium transition">Fonctionnelle</button>
            <button type="button" @click="setKind('technical')"
                    :class="editForm.kind === 'technical'
                      ? 'bg-slate-600 text-white border-slate-600'
                      : 'bg-white text-gray-600 border-gray-200'"
                    class="flex-1 min-h-11 px-3 rounded-lg border font-medium transition">Technique</button>
          </div>
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
            class="pwa-input w-full text-right font-medium"
          />
        </MobileField>

        <!-- Parties prenantes rattachées à la zone (édition uniquement :
             la zone doit exister pour porter des affectations). -->
        <MobileField v-if="editing?.mode === 'edit'" label="Parties prenantes"
                     hint="Propriétaires, preneurs à bail ou syndicat qui occupent ou contrôlent cette zone. À définir d'abord dans l'identification du site.">
          <ZonePartiesPicker
            :zone-id="editing.zone.zone_id"
            :site-parties="siteParties"
          />
        </MobileField>

        <MobileField label="Position sur la carte" hint="Place un repère sur le bâtiment. Touchez la carte pour positionner la zone, déplacez le pin pour ajuster.">
          <ZoneMapPicker
            v-model:latitude="editForm.latitude"
            v-model:longitude="editForm.longitude"
            :kind="editForm.kind"
            :zones="zones"
            :current-zone-id="editing?.zone?.zone_id ?? null"
            :site="audit.site || {}"
          />
        </MobileField>

        <!-- Suppression (édition uniquement) -->
        <template v-if="editing?.mode === 'edit' && document?.site_uuid">
          <div class="pt-4 border-t border-gray-200">
            <button
              @click="remove(editing.zone)"
              class="pwa-button pwa-button--danger w-full bg-red-50 text-red-600 border-red-200"
            >
              <FontAwesomeIcon :icon="['fas', 'trash']" class="w-5 h-5" />
              Supprimer la zone
            </button>
          </div>
        </template>
      </div>
    </MobileSheet>

    <!-- Aide pédagogique « Comprendre la zone fonctionnelle » (item 7a) -->
    <ZoneFunctionalHelpModal v-if="showHelp" @close="showHelp = false" />
  </div>
</template>
