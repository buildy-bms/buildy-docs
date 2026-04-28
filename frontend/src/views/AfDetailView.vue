<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getAf, listSections, getSection, createSection, deleteSection, updateSection, listEquipmentTemplates } from '@/api'
import { useNotification } from '@/composables/useNotification'
import BaseModal from '@/components/BaseModal.vue'
import CycleBandeau from '@/components/CycleBandeau.vue'
import TemplatePropagationBanner from '@/components/TemplatePropagationBanner.vue'
import ActivityPanel from '@/components/ActivityPanel.vue'
import RequiredServiceLevelPanel from '@/components/RequiredServiceLevelPanel.vue'
import { useResizable } from '@/composables/useResizable'

const { width: treeWidth, onMouseDown: onTreeResize } = useResizable({
  storageKey: 'af-tree-width',
  defaultWidth: 320,
  minWidth: 220,
  maxWidth: 720,
})
import SectionTree from '@/components/editor/SectionTree.vue'
import SectionEditor from '@/components/editor/SectionEditor.vue'
import PointsTable from '@/components/editor/PointsTable.vue'
import EquipmentInstancesTable from '@/components/editor/EquipmentInstancesTable.vue'
import AttachmentsGrid from '@/components/editor/AttachmentsGrid.vue'
import ZonesTable from '@/components/editor/ZonesTable.vue'
import EquipmentDescriptionPanel from '@/components/editor/EquipmentDescriptionPanel.vue'
import EquipmentTemplatePicker from '@/components/EquipmentTemplatePicker.vue'

const route = useRoute()
const router = useRouter()
const af = ref(null)
const sections = ref([])
const selectedSection = ref(null)
const selectedId = ref(null)
const loading = ref(true)
const showActivity = ref(false)
const activityRef = ref(null)
const requiredLevelKey = ref(0) // bumpé pour forcer un recalcul du niveau requis
const { success: notifySuccess, error: notifyError } = useNotification()

// Modale ajout section (Lot 16)
const showAddModal = ref(false)
const addParent = ref(null) // null = section racine
const addForm = ref({ title: '', kind: 'standard', equipment_template_id: null })
const equipmentTemplates = ref([])

async function openAddSection(parentNode) {
  addParent.value = parentNode || null
  addForm.value = { title: '', kind: 'standard', equipment_template_id: null }
  if (!equipmentTemplates.value.length) {
    try { equipmentTemplates.value = (await listEquipmentTemplates()).data || [] }
    catch { /* ignore */ }
  }
  showAddModal.value = true
}

async function submitAddSection() {
  if (!addForm.value.title.trim()) return
  try {
    const { data } = await createSection(af.value.id, {
      parent_id: addParent.value?.id || null,
      title: addForm.value.title.trim(),
      kind: addForm.value.kind,
      equipment_template_id: addForm.value.kind === 'equipment' ? addForm.value.equipment_template_id : null,
    })
    notifySuccess(`Section "${data.title}" ajoutée`)
    showAddModal.value = false
    await refreshSections()
    selectSection(data.id)
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de l\'ajout')
  }
}

async function handleDeleteSection(node) {
  const childCount = sections.value.filter(s => s.parent_id === node.id).length
  const msg = childCount > 0
    ? `Supprimer "${node.title}" ET ses ${childCount} sous-section(s) ?\nCela supprimera aussi tous les overrides, instances et captures associés.`
    : `Supprimer la section "${node.title}" ?`
  if (!confirm(msg)) return
  try {
    await deleteSection(node.id)
    notifySuccess('Section supprimée')
    if (selectedId.value === node.id) {
      selectedId.value = null
      selectedSection.value = null
    }
    await refreshSections()
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec suppression')
  }
}

async function handleToggleInclude(node) {
  const newVal = node.included_in_export === 0 ? 1 : 0
  // Update optimiste de la liste plate pour feedback immediat
  const idx = sections.value.findIndex(s => s.id === node.id)
  if (idx >= 0) sections.value[idx] = { ...sections.value[idx], included_in_export: newVal }
  try {
    await updateSection(node.id, { included_in_export: !!newVal })
    if (selectedSection.value?.id === node.id) selectedSection.value = { ...selectedSection.value, included_in_export: newVal }
    requiredLevelKey.value++ // recalcul du niveau requis
  } catch (e) {
    // rollback
    if (idx >= 0) sections.value[idx] = { ...sections.value[idx], included_in_export: node.included_in_export }
    notifyError(e.response?.data?.detail || 'Échec mise à jour')
  }
}

function onGotoSection(payload) {
  // payload : { id?, number? } — preferer id, sinon resoudre par number
  if (payload?.id) return selectSection(payload.id)
  if (payload?.number) {
    const match = sections.value.find(s => s.number === payload.number)
    if (match) selectSection(match.id)
  }
}

async function handleToggleOptOut(node) {
  const newVal = node.opted_out_by_moa === 1 ? 0 : 1
  const idx = sections.value.findIndex(s => s.id === node.id)
  if (idx >= 0) sections.value[idx] = { ...sections.value[idx], opted_out_by_moa: newVal }
  try {
    await updateSection(node.id, { opted_out_by_moa: !!newVal })
    if (selectedSection.value?.id === node.id) selectedSection.value = { ...selectedSection.value, opted_out_by_moa: newVal }
    requiredLevelKey.value++ // recalcul du niveau requis
  } catch (e) {
    if (idx >= 0) sections.value[idx] = { ...sections.value[idx], opted_out_by_moa: node.opted_out_by_moa }
    notifyError(e.response?.data?.detail || 'Échec mise à jour')
  }
}

const sectionsCountByKind = computed(() => {
  const c = { standard: 0, equipment: 0, hyperveez_page: 0, synthesis: 0 }
  for (const s of sections.value) c[s.kind] = (c[s.kind] || 0) + 1
  return c
})

async function refreshAf() {
  af.value = (await getAf(route.params.id)).data
}

async function refreshSections() {
  sections.value = (await listSections(route.params.id)).data
  // Si rien de sélectionné encore, prendre la 1ère section root
  if (!selectedId.value && sections.value.length) {
    selectSection(sections.value[0].id)
  }
}

async function selectSection(id) {
  selectedId.value = id
  const { data } = await getSection(id)
  selectedSection.value = data
}

function onSectionUpdated(updated) {
  // Mettre à jour la liste plate (titre, body_html, service_level, etc.)
  const idx = sections.value.findIndex(s => s.id === updated.id)
  if (idx !== -1) {
    sections.value[idx] = { ...sections.value[idx], ...updated }
  }
  // Garder selectedSection en sync
  if (selectedSection.value?.id === updated.id) {
    selectedSection.value = { ...selectedSection.value, ...updated }
  }
  // Refresh panneau activite + recalcul niveau requis si service_level a pu changer
  activityRef.value?.refresh?.()
  requiredLevelKey.value++
}

function onAfUpdated(updated) {
  af.value = { ...af.value, ...updated }
}

onMounted(async () => {
  loading.value = true
  try {
    await Promise.all([refreshAf(), refreshSections()])
  } finally {
    loading.value = false
  }
})

watch(() => route.params.id, async () => {
  selectedId.value = null
  selectedSection.value = null
  loading.value = true
  try {
    await Promise.all([refreshAf(), refreshSections()])
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div v-if="loading" class="text-center py-12 text-gray-400 text-sm">Chargement…</div>

  <div v-else-if="af" class="-mx-5 lg:-mx-6 -mt-4 lg:-mt-5 h-[calc(100vh-1rem)] flex flex-col">
    <!-- Bandeau cycle de vie (en haut, full-width) -->
    <div class="px-5 lg:px-6 pt-4 space-y-2">
      <CycleBandeau :af="af" @updated="onAfUpdated" @back="router.push('/')" @toggle-activity="showActivity = !showActivity" @goto-section="selectSection" />
      <RequiredServiceLevelPanel :af-id="af.id" :contract-level="af.service_level" :refresh-key="requiredLevelKey" @goto-section="onGotoSection" />
      <TemplatePropagationBanner :af-id="af.id" @updated="refreshSections" />
    </div>

    <!-- Layout split : arbre 320px + éditeur flex -->
    <div class="flex-1 min-h-0 flex gap-4 px-5 lg:px-6 pb-4">
      <!-- Sidebar arbre des sections (redimensionnable) -->
      <aside
        :style="{ width: treeWidth + 'px' }"
        class="shrink-0 bg-white rounded-none border border-gray-200 overflow-y-auto relative"
      >
        <div class="px-4 py-3 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Sections ({{ sections.length }})
          </h3>
          <p class="text-[11px] text-gray-400 mt-0.5">
            {{ sectionsCountByKind.standard }} texte ·
            {{ sectionsCountByKind.equipment }} équip. ·
            {{ sectionsCountByKind.hyperveez_page }} Hyperveez ·
            {{ sectionsCountByKind.synthesis }} synth.
          </p>
        </div>
        <div class="p-2">
          <SectionTree
            :sections="sections"
            :selected-id="selectedId"
            @select="selectSection"
            @add-root="openAddSection(null)"
            @add-child="openAddSection"
            @delete="handleDeleteSection"
            @toggle-include="handleToggleInclude"
            @toggle-opt-out="handleToggleOptOut"
          />
        </div>
        <!-- Poignée de drag-resize -->
        <div
          @mousedown="onTreeResize"
          class="absolute top-0 right-0 h-full w-1.5 cursor-col-resize bg-transparent hover:bg-indigo-300 transition-colors z-20"
          title="Glisser pour redimensionner"
        ></div>
      </aside>

      <!-- Éditeur principal (scrollable) -->
      <div class="flex-1 min-w-0 overflow-y-auto pr-1 space-y-4">
        <template v-if="selectedSection">
          <SectionEditor
            :key="selectedSection.id"
            :section="selectedSection"
            @updated="onSectionUpdated"
          />

          <!-- Pour kind='zones' : tableau des zones fonctionnelles -->
          <ZonesTable v-if="selectedSection.kind === 'zones'" :section-id="selectedSection.id" />

          <!-- Pour kind='equipment' : description + tableaux points + instances -->
          <template v-if="selectedSection.kind === 'equipment'">
            <EquipmentDescriptionPanel v-if="selectedSection.equipment_template_id" :template-id="selectedSection.equipment_template_id" />
            <PointsTable :section-id="selectedSection.id" :equipment-template-id="selectedSection.equipment_template_id" />
            <EquipmentInstancesTable :section-id="selectedSection.id" :af-id="af.id" />
          </template>

          <!-- Pour kind='hyperveez_page' : info de la page Hyperveez -->
          <div v-if="selectedSection.kind === 'hyperveez_page' && selectedSection.hyperveez_page_slug" class="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
            <p class="font-semibold mb-1">📖 Page Hyperveez : <code class="bg-blue-100 px-1.5 py-0.5 rounded text-xs">{{ selectedSection.hyperveez_page_slug }}</code></p>
            <p class="text-xs text-blue-800">
              Cette section décrit une page réelle de l'UI Hyperveez. La description est pré-remplie depuis le code Hyperveez.
              Tu peux la peaufiner pour le contexte du projet.
            </p>
          </div>

          <!-- Pour kind='synthesis' : note auto-generation -->
          <div v-if="selectedSection.kind === 'synthesis'" class="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
            <p class="font-semibold mb-1">📊 Tableau de synthèse</p>
            <p class="text-xs text-amber-800">
              Ce tableau matriciel sera auto-généré à l'export PDF (Lot 6) depuis le contenu des chapitres précédents.
              Tu peux ajuster la note d'introduction si besoin.
            </p>
          </div>

          <!-- Captures (toutes sections sauf synthesis qui est auto-généré) -->
          <AttachmentsGrid
            v-if="selectedSection.kind !== 'synthesis'"
            :section-id="selectedSection.id"
            :af-id="af.id"
          />
        </template>
        <div v-else class="bg-white rounded-none border border-gray-200 p-12 text-center text-sm text-gray-400">
          Sélectionne une section dans l'arbre à gauche pour commencer.
        </div>
      </div>

      <!-- Sidebar activité (collapsible) -->
      <aside v-if="showActivity" class="w-72 shrink-0 relative">
        <button
          @click="showActivity = false"
          class="absolute top-2 right-2 text-gray-400 hover:text-gray-700 text-xs z-10"
          title="Replier"
        >✕</button>
        <ActivityPanel ref="activityRef" :af-id="af.id" />
      </aside>
    </div>
  </div>

  <!-- Modale ajout section (Lot 16) -->
  <BaseModal v-if="showAddModal" :title="addParent ? `Ajouter une sous-section dans « ${addParent.title} »` : 'Ajouter une section racine'" size="lg" @close="showAddModal = false">
    <form @submit.prevent="submitAddSection" class="space-y-4">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Titre *</label>
          <input v-model="addForm.title" type="text" required autocomplete="off" data-1p-ignore="true" data-bwignore="true" data-lpignore="true"
                 placeholder="Ex : Architecture réseau, Schéma de principe…"
                 class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Type de section</label>
          <select v-model="addForm.kind" class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="standard">Texte standard</option>
            <option value="equipment">Équipement (rattaché à un template)</option>
          </select>
        </div>
      </div>
      <div v-if="addForm.kind === 'equipment'">
        <label class="block text-xs font-medium text-gray-700 mb-2">Template équipement</label>
        <EquipmentTemplatePicker
          :model-value="addForm.equipment_template_id"
          @update:model-value="addForm.equipment_template_id = $event"
          :templates="equipmentTemplates"
        />
      </div>
      <p class="text-[11px] text-gray-500">
        Le numéro de section est laissé vide pour l'instant — tu peux l'éditer manuellement ensuite.
      </p>
    </form>
    <template #footer>
      <button @click="showAddModal = false" class="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">Annuler</button>
      <button @click="submitAddSection" :disabled="!addForm.title.trim() || (addForm.kind === 'equipment' && !addForm.equipment_template_id)"
              class="px-3 py-1.5 text-xs bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
        Ajouter
      </button>
    </template>
  </BaseModal>
</template>
