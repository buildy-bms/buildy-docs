<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
/**
 * Onglet « Docs » mobile (6e tab) — check-list de collecte.
 * Couverture photo des entités + pièces jointes du dossier.
 *
 * Le sheet d'édition d'un item permet :
 *  - Choisir le statut (À collecter / Collecté / Non disponible)
 *  - Prendre une photo (caméra native)
 *  - Importer un fichier
 *  - Saisir une note libre
 *  - Si Non disponible : raison libre
 */
import { ref, computed, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import {
  getBacsChecklist, getBacsPhotoCoverage, updateBacsChecklistItem,
  listSiteDocuments, uploadSiteDocument, deleteSiteDocument,
  getSiteDocumentDownloadUrl,
} from '@/api'
import MobileSheet from './MobileSheet.vue'
import EquipmentIcon from '@/components/EquipmentIcon.vue'
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import MeterUsagePill from '@/components/MeterUsagePill.vue'
import MeterTypePill from '@/components/MeterTypePill.vue'
const emit = defineEmits(['navigate'])

// Labels FR des natures de zone (pour le sheet KPI). Reste minimaliste :
// pour les natures absentes du mapping, on retombe sur la valeur brute.
const ZONE_NATURE_LABEL = {
  offices: 'Bureaux',
  meeting_rooms: 'Salles de réunion',
  open_space: 'Open space',
  reception: 'Accueil',
  retail: 'Commerce',
  it_room: 'Local informatique',
  technical_room: 'Local technique',
  warehouse: 'Stockage',
  logistic_cell: 'Cellule logistique',
  parking_indoor: 'Parking intérieur',
  parking_outdoor: 'Parking extérieur',
  circulation: 'Circulation',
  basement: 'Sous-sol',
  rooftop: 'Toiture',
}
const SYSTEM_CAT_LABEL = {
  heating: 'Chauffage',
  cooling: 'Refroidissement',
  ventilation: 'Ventilation',
  dhw: 'ECS',
  lighting_indoor: 'Éclairage intérieur',
  lighting_outdoor: 'Éclairage extérieur',
  electricity_production: 'Production photovoltaïque',
}

function navigateAndClose(kind, entityId) {
  emit('navigate', { kind, entityId })
  closeCoverage()
}

const audit = useAuditStore()
const { document } = storeToRefs(audit)
const { error, success } = useNotification()

const items = ref([])
const coverage = ref({
  site: { total: 0, covered: 0 },
  zones: { total: 0, covered: 0, missing: [] }, systems: { total: 0, covered: 0, missing: [] },
  meters: { total: 0, covered: 0, missing: [] }, bms: { total: 0, covered: 0 },
})
const loading = ref(true)

// KPI cliquable : ouvre un sheet avec la liste des entités manquantes
// (sans photo) ou un message « ✓ Couvert » si tout est en règle.
const coverageDetail = ref(null) // { kind, label, items }
function openCoverage(kind) {
  const labels = { site: 'Site', zones: 'Zones', systems: 'Systèmes', meters: 'Compteurs', bms: 'GTB' }
  const cov = coverage.value[kind]
  coverageDetail.value = {
    kind,
    label: labels[kind],
    total: cov.total,
    covered: cov.covered,
    missing: cov.missing || [],
  }
}
function closeCoverage() { coverageDetail.value = null }

async function load() {
  loading.value = true
  try {
    const [c, cov] = await Promise.all([
      getBacsChecklist(audit.docId),
      getBacsPhotoCoverage(audit.docId),
    ])
    items.value = c.data
    coverage.value = cov.data
  } catch { error('Chargement impossible') }
  finally { loading.value = false }
}
onMounted(load)
watch(() => audit.docId, load)

const totalCovered = computed(() =>
  (coverage.value.site?.covered || 0) +
  coverage.value.zones.covered + coverage.value.systems.covered + coverage.value.meters.covered + coverage.value.bms.covered,
)
const totalEntities = computed(() =>
  (coverage.value.site?.total || 0) +
  coverage.value.zones.total + coverage.value.systems.total + coverage.value.meters.total + coverage.value.bms.total,
)
const itemsHandled = computed(() => items.value.filter(i => i.status !== 'pending').length)
const totalScore = computed(() => totalCovered.value + itemsHandled.value)
const totalPossible = computed(() => totalEntities.value + items.value.length)
const completionPct = computed(() =>
  totalPossible.value === 0 ? 0 : Math.round((totalScore.value / totalPossible.value) * 100),
)

// Sheet édition
const editing = ref(null)
const editingFiles = ref([])
const editingStatus = ref('pending')
const editingNotes = ref('')
const editingReason = ref('')
const saving = ref(false)
const fileInput = ref(null)
const cameraInput = ref(null)

async function openItem(it) {
  editing.value = it
  editingStatus.value = it.status
  editingNotes.value = it.notes_html || ''
  editingReason.value = it.not_available_reason || ''
  await refreshFiles()
}
function closeItem() { editing.value = null; editingFiles.value = [] }

async function refreshFiles() {
  if (!editing.value?.id || !document.value?.site_uuid) {
    editingFiles.value = []
    return
  }
  try {
    const { data } = await listSiteDocuments(document.value.site_uuid, {
      bacs_audit_checklist_id: editing.value.id,
    })
    editingFiles.value = data
  } catch { editingFiles.value = [] }
}

async function persist({ close = false } = {}) {
  if (!editing.value) return
  saving.value = true
  try {
    await updateBacsChecklistItem(audit.docId, editing.value.catalog_key, {
      status: editingStatus.value,
      notes_html: editingNotes.value || null,
      not_available_reason: editingStatus.value === 'not_available' ? (editingReason.value || null) : null,
    })
    await load()
    editing.value = items.value.find(i => i.catalog_key === editing.value.catalog_key) || null
    success('Mis à jour')
    if (close) closeItem()
  } catch (e) {
    error(e.response?.data?.detail || 'Sauvegarde impossible')
  } finally {
    saving.value = false
  }
}

async function onFileSelected(e) {
  const files = Array.from(e.target.files || [])
  e.target.value = ''
  if (!files.length || !editing.value) return
  if (!editing.value.id) {
    await persist({ close: false })
    if (!editing.value?.id) return
  }
  if (!document.value?.site_uuid) { error('Pas de site rattaché'); return }
  for (const file of files) {
    try {
      const fd = new FormData()
      fd.append('file', file)
      await uploadSiteDocument(document.value.site_uuid, fd, {
        title: file.name,
        category: 'autre',
        bacs_audit_checklist_id: editing.value.id,
      })
    } catch { error(`Upload « ${file.name} » impossible`) }
  }
  await refreshFiles()
  await load()
  if (editingStatus.value === 'pending') {
    editingStatus.value = 'available'
    await persist({ close: false })
  }
}

async function removeFile(f) {
  try {
    await deleteSiteDocument(f.id)
    await refreshFiles()
    await load()
  } catch { error('Suppression impossible') }
}

function statusClass(s) {
  return {
    pending:        'bg-white border-gray-200',
    available:      'bg-emerald-50 border-emerald-200',
    not_available:  'bg-gray-100 border-gray-200 opacity-70',
  }[s] || 'bg-white border-gray-200'
}

// Quick toggle « Non disponible » avec optimistic update (anti-clignotement).
async function quickToggleNotAvailable(it) {
  const newStatus = it.status === 'not_available' ? 'pending' : 'not_available'
  const prev = it.status
  it.status = newStatus
  try {
    const { data } = await updateBacsChecklistItem(audit.docId, it.catalog_key, { status: newStatus })
    it.id = data.id
    it.status = data.status
  } catch {
    it.status = prev
    error('Mise à jour impossible')
  }
}
</script>

<template>
  <div class="p-3 space-y-3">
    <!-- Stat globale -->
    <div class="bg-white rounded-2xl border border-gray-200 p-4 flex items-center gap-4">
      <div class="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 inline-flex items-center justify-center">
        <FontAwesomeIcon :icon="['fas', 'check']" class="w-6 h-6" />
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-2xl font-medium text-gray-900 leading-none">
          {{ totalScore }}<span class="text-sm text-gray-500"> / {{ totalPossible }}</span>
        </p>
        <p class="text-xs text-gray-500 mt-1">Documents & photos collectés ({{ completionPct }}%)</p>
      </div>
    </div>

    <!-- Couverture photo : KPIs cliquables → ouvre un sheet listant les
         entités sans photo (ou un message « tout couvert » si OK). -->
    <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div class="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <FontAwesomeIcon :icon="['fas', 'camera']" class="w-5 h-5 text-emerald-600" />
        <h3 class="text-base font-medium text-gray-900">Couverture photo des entités</h3>
      </div>
      <div class="grid grid-cols-2 divide-x divide-y divide-gray-100">
        <button
          v-for="kind in ['site', 'zones', 'systems', 'meters', 'bms']" :key="kind"
          type="button"
          @click="openCoverage(kind)"
          class="p-4 text-left tap-target active:bg-gray-50 transition"
        >
          <p class="text-xs uppercase tracking-wider text-gray-500">
            {{ { site: 'Site', zones: 'Zones', systems: 'Systèmes', meters: 'Compteurs', bms: 'GTB' }[kind] }}
          </p>
          <p class="text-2xl font-medium text-gray-900 mt-1 leading-none">
            {{ coverage[kind].covered }}<span class="text-base text-gray-400 font-normal"> / {{ coverage[kind].total }}</span>
          </p>
          <p v-if="coverage[kind].total === 0" class="text-[11px] text-gray-400 italic mt-1">Aucun</p>
          <p v-else-if="coverage[kind].covered === coverage[kind].total" class="text-[11px] text-emerald-700 mt-1">✓ Couvert</p>
          <p v-else class="text-[11px] text-amber-700 mt-1">⚠ {{ coverage[kind].total - coverage[kind].covered }} sans photo</p>
        </button>
      </div>
    </div>

    <!-- Sheet détail couverture : liste des entités d'un KPI -->
    <MobileSheet
      :open="!!coverageDetail"
      :title="coverageDetail ? `${coverageDetail.label} · couverture photo` : ''"
      hide-save
      @close="closeCoverage"
    >
      <div v-if="coverageDetail" class="p-4 space-y-3">
        <div class="bg-gray-50 rounded-xl px-4 py-3">
          <p class="text-xs uppercase tracking-wider text-gray-500">Couverture</p>
          <p class="text-2xl font-medium text-gray-900 mt-1">
            {{ coverageDetail.covered }} <span class="text-gray-400 text-base font-normal">/ {{ coverageDetail.total }}</span>
          </p>
        </div>

        <!-- Cas particuliers Site / GTB : 1 entité unique → on propose juste
             un raccourci vers l'onglet correspondant pour prendre la photo. -->
        <button
          v-if="(coverageDetail.kind === 'site' || coverageDetail.kind === 'bms') && coverageDetail.total > 0 && coverageDetail.covered === 0"
          type="button"
          @click="navigateAndClose(coverageDetail.kind)"
          class="w-full flex items-center gap-3 px-4 py-4 bg-white rounded-xl border border-gray-200 active:bg-gray-50"
        >
          <span class="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 inline-flex items-center justify-center shrink-0">
            <FontAwesomeIcon :icon="['fas', 'building']" v-if="coverageDetail.kind === 'site'" class="w-5 h-5" />
            <FontAwesomeIcon :icon="['fas', 'clipboard-list']" v-else class="w-5 h-5" />
          </span>
          <span class="flex-1 text-left">
            <span class="block text-base text-gray-900 font-medium">
              {{ coverageDetail.kind === 'site' ? 'Aller à la page Site' : 'Aller à la page GTB' }}
            </span>
            <span class="block text-xs text-amber-700 mt-0.5">Aucune photo · à prendre</span>
          </span>
          <FontAwesomeIcon :icon="['fas', 'chevron-right']" class="w-5 h-5 text-gray-400 shrink-0" />
        </button>
        <button
          v-else-if="(coverageDetail.kind === 'site' || coverageDetail.kind === 'bms') && coverageDetail.covered > 0"
          type="button"
          @click="navigateAndClose(coverageDetail.kind)"
          class="w-full flex items-center gap-3 px-4 py-4 bg-white rounded-xl border border-gray-200 active:bg-gray-50"
        >
          <span class="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 inline-flex items-center justify-center shrink-0">
            <FontAwesomeIcon :icon="['fas', 'building']" v-if="coverageDetail.kind === 'site'" class="w-5 h-5" />
            <FontAwesomeIcon :icon="['fas', 'clipboard-list']" v-else class="w-5 h-5" />
          </span>
          <span class="flex-1 text-left">
            <span class="block text-base text-gray-900 font-medium">
              {{ coverageDetail.kind === 'site' ? 'Voir / ajouter des photos du site' : 'Voir / ajouter des photos GTB' }}
            </span>
            <span class="block text-xs text-emerald-700 mt-0.5">✓ Couvert</span>
          </span>
          <FontAwesomeIcon :icon="['fas', 'chevron-right']" class="w-5 h-5 text-gray-400 shrink-0" />
        </button>

        <!-- Site / GTB sans entité (cas vide impossible normalement) -->
        <p v-else-if="coverageDetail.total === 0" class="text-sm text-gray-500 text-center py-6">
          Aucune entité de ce type dans l'audit.
        </p>

        <!-- Toutes les entités sont couvertes : message + raccourci vers l'onglet -->
        <template v-else-if="coverageDetail.covered === coverageDetail.total">
          <p class="text-sm text-emerald-700 text-center py-3">
            ✓ Toutes les entités ont au moins une photo.
          </p>
          <button
            type="button"
            @click="navigateAndClose(coverageDetail.kind)"
            class="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white rounded-xl border border-gray-200 text-base text-gray-700 active:bg-gray-50"
          >
            Aller à l'onglet {{ coverageDetail.label }}
            <FontAwesomeIcon :icon="['fas', 'chevron-right']" class="w-5 h-5 text-gray-400 shrink-0" />
          </button>
        </template>

        <!-- Liste des entités sans photo, cliquables (zones / systems / meters) -->
        <template v-else-if="coverageDetail.missing && coverageDetail.missing.length">
          <p class="text-xs font-semibold text-gray-600 uppercase tracking-wider">
            {{ coverageDetail.missing.length }} sans photo
          </p>
          <ul class="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            <li v-for="m in coverageDetail.missing" :key="m.id">
              <button
                type="button"
                @click="navigateAndClose(coverageDetail.kind, m.id)"
                class="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-gray-50"
              >
                <!-- Icône / pictogramme selon le type d'entité -->
                <span class="shrink-0">
                  <FontAwesomeIcon :icon="['fas', 'map-pin']" v-if="coverageDetail.kind === 'zones'" class="w-6 h-6 text-indigo-600" />
                  <SystemCategoryIcon
                    v-else-if="coverageDetail.kind === 'systems'"
                    :category="m.category"
                    size="md"
                  />
                  <FontAwesomeIcon :icon="['fas', 'bolt']" v-else-if="coverageDetail.kind === 'meters'" class="w-6 h-6 text-amber-600" />
                </span>
                <div class="flex-1 min-w-0">
                  <!-- Zones : nom + nature -->
                  <template v-if="coverageDetail.kind === 'zones'">
                    <p class="text-base text-gray-900 font-medium truncate">{{ m.name }}</p>
                    <p v-if="m.nature" class="text-xs text-gray-500 truncate">{{ ZONE_NATURE_LABEL[m.nature] || m.nature }}</p>
                  </template>
                  <!-- Systèmes : catégorie + zone -->
                  <template v-else-if="coverageDetail.kind === 'systems'">
                    <p class="text-base text-gray-900 font-medium truncate">{{ SYSTEM_CAT_LABEL[m.category] || m.category }}</p>
                    <p v-if="m.zone_name" class="text-xs text-gray-500 truncate">📍 {{ m.zone_name }}</p>
                  </template>
                  <!-- Compteurs : pills usage + type, zone en sous-titre -->
                  <template v-else-if="coverageDetail.kind === 'meters'">
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <MeterUsagePill :usage="m.usage" />
                      <MeterTypePill :type="m.meter_type" />
                    </div>
                    <p class="text-xs text-gray-500 mt-0.5 truncate">
                      📍 {{ m.zone_name || 'Compteur général' }}
                    </p>
                  </template>
                  <!-- Fallback (jamais utilisé en pratique) -->
                  <p v-else class="text-base text-gray-900 truncate">{{ m.name }}</p>
                </div>
                <FontAwesomeIcon :icon="['fas', 'chevron-right']" class="w-5 h-5 text-gray-400 shrink-0" />
              </button>
            </li>
          </ul>
        </template>
        <p v-else class="text-sm text-gray-500 text-center py-4">
          {{ coverageDetail.total - coverageDetail.covered }} sans photo. Détail non disponible.
        </p>
      </div>
    </MobileSheet>

    <!-- Pièces jointes -->
    <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div class="px-4 py-3 border-b border-gray-100">
        <h3 class="text-base font-medium text-gray-900">Pièces jointes du dossier</h3>
        <p class="text-xs text-gray-500 mt-0.5">{{ itemsHandled }} / {{ items.length }} traités</p>
      </div>
      <div v-if="loading" class="px-4 py-6 text-sm text-gray-400 text-center">Chargement…</div>
      <div v-else-if="!items.length" class="px-4 py-6 text-sm text-gray-400 italic text-center">
        Aucun item dans le catalogue.
      </div>
      <div v-else class="divide-y divide-gray-100">
        <div v-for="it in items" :key="it.catalog_key"
             :class="['flex items-center gap-2 px-4 py-3 active:bg-gray-50', statusClass(it.status)]">
          <button type="button" @click="openItem(it)"
                  class="flex items-center gap-3 flex-1 min-w-0 text-left">
            <EquipmentIcon :template="{ icon_kind: 'fa', icon_value: it.icon_value || 'fa-file', icon_color: it.icon_color || '#6b7280' }" size="md" class="shrink-0" />
            <div class="flex-1 min-w-0">
              <p :class="['text-base font-medium leading-tight', it.status === 'not_available' ? 'line-through text-gray-500' : 'text-gray-900']">
                {{ it.label }}
              </p>
              <p class="text-xs mt-0.5 flex items-center gap-1">
                <FontAwesomeIcon :icon="['fas', 'check']" v-if="it.status === 'available'" class="w-3.5 h-3.5 text-emerald-600" />
                <FontAwesomeIcon :icon="['fas', 'ban']" v-else-if="it.status === 'not_available'" class="w-3.5 h-3.5 text-gray-400" />
                <FontAwesomeIcon :icon="['fas', 'circle-exclamation']" v-else class="w-3.5 h-3.5 text-amber-500" />
                <span :class="{
                  'text-emerald-700': it.status === 'available',
                  'text-gray-500':    it.status === 'not_available',
                  'text-amber-700':   it.status === 'pending',
                }">
                  <template v-if="it.status === 'available'">{{ it.files_count }} fichier{{ it.files_count > 1 ? 's' : '' }}</template>
                  <template v-else-if="it.status === 'not_available'">{{ it.not_available_reason || 'Non disponible' }}</template>
                  <template v-else>À collecter</template>
                </span>
            </p>
            </div>
            <FontAwesomeIcon :icon="['fas', 'chevron-right']" class="w-5 h-5 text-gray-300 shrink-0" />
          </button>
          <!-- Bouton Non dispo inline (ne ouvre pas le sheet) -->
          <button type="button" @click.stop="quickToggleNotAvailable(it)"
                  :class="['shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-xl border',
                           it.status === 'not_available'
                             ? 'text-gray-700 bg-gray-100 border-gray-300 active:bg-gray-200'
                             : 'text-gray-500 bg-white border-gray-200 active:bg-gray-50']">
            <FontAwesomeIcon :icon="['fas', 'ban']" class="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>

    <!-- Sheet édition item -->
    <MobileSheet
      :open="!!editing"
      :title="editing?.label || ''"
      :saving="saving"
      save-label="Enregistrer"
      @close="closeItem"
      @save="persist({ close: true })"
    >
      <div v-if="editing" class="p-4 space-y-4">
        <!-- Statut -->
        <div class="grid grid-cols-3 gap-2">
          <button v-for="opt in [
            { v: 'pending',       label: 'À collecter',  icon: 'circle-exclamation' },
            { v: 'available',     label: 'Collecté',     icon: 'check' },
            { v: 'not_available', label: 'Non dispo.',   icon: 'ban' },
          ]" :key="opt.v" type="button" @click="editingStatus = opt.v"
            :class="['flex flex-col items-center gap-1 px-2 py-3 text-xs font-medium rounded-xl border-2',
                     editingStatus === opt.v
                       ? 'border-indigo-500 bg-indigo-50 text-indigo-800'
                       : 'border-gray-200 bg-white text-gray-600']">
            <FontAwesomeIcon :icon="['fas', opt.icon]" class="w-5 h-5" />
            {{ opt.label }}
          </button>
        </div>

        <!-- Raison non dispo -->
        <div v-if="editingStatus === 'not_available'">
          <label class="block text-xs font-medium text-gray-700 mb-1.5">Pourquoi ?</label>
          <input v-model="editingReason" type="text"
                 placeholder="Ex : Le client n'a pas retrouvé les originaux"
                 class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white" />
        </div>

        <!-- Photos / fichiers -->
        <div v-if="editingStatus !== 'not_available'">
          <p class="text-xs font-medium text-gray-600 uppercase tracking-wider mb-2">
            Fichiers ({{ editingFiles.length }})
          </p>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" @click="cameraInput?.click()"
                    class="inline-flex items-center justify-center gap-2 px-4 py-4 text-base font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 active:bg-indigo-100 rounded-xl">
              <FontAwesomeIcon :icon="['fas', 'camera']" class="w-5 h-5" /> Photo
            </button>
            <input ref="cameraInput" type="file" accept="image/*" capture="environment"
                   class="hidden" @change="onFileSelected" />
            <button type="button" @click="fileInput?.click()"
                    class="inline-flex items-center justify-center gap-2 px-4 py-4 text-base font-medium text-gray-700 bg-white border border-gray-200 active:bg-gray-50 rounded-xl">
              <FontAwesomeIcon :icon="['fas', 'file']" class="w-5 h-5" /> Fichier
            </button>
            <input ref="fileInput" type="file" multiple class="hidden" @change="onFileSelected" />
          </div>
          <ul v-if="editingFiles.length" class="mt-2 divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
            <li v-for="f in editingFiles" :key="f.id"
                class="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
              <a :href="getSiteDocumentDownloadUrl(f.id)" target="_blank" class="flex-1 truncate text-indigo-700">{{ f.title }}</a>
              <button type="button" @click="removeFile(f)" class="text-gray-400 active:text-red-600 p-1.5">
                <FontAwesomeIcon :icon="['fas', 'trash']" class="w-4 h-4" />
              </button>
            </li>
          </ul>
        </div>

        <!-- Notes -->
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1.5">Notes</label>
          <textarea v-model="editingNotes" rows="4"
                    placeholder="Observations, contacts, références…"
                    class="w-full px-4 py-3 text-base border border-gray-200 rounded-xl bg-white"></textarea>
        </div>
      </div>
    </MobileSheet>
  </div>
</template>
