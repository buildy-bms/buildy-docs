<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch, provide } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { getSection, listEquipmentTemplates, moveAttachment } from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import { useAfStore } from '@/stores/af'
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

// Mode compact : sous 1280px, l'arbre des sections devient un drawer overlay
// declenche par un bouton (sinon les 3 colonnes deviennent illisibles sur
// laptop 13").
const isCompact = ref(false)
let mql = null
function updateCompact(e) { isCompact.value = e.matches }
if (typeof window !== 'undefined') {
  mql = window.matchMedia('(max-width: 1279px)')
  isCompact.value = mql.matches
  mql.addEventListener('change', updateCompact)
}
const treeDrawerOpen = ref(false)
// Garde le bandeau d'icone pour montrer comment ouvrir le drawer
const treeOpen = computed(() => !isCompact.value || treeDrawerOpen.value)
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

// Etat principal centralise dans le store Pinia (Lot A1).
const afStore = useAfStore()
const {
  af, sections, selectedSection, selectedId, loading, requiredLevelKey,
  liveSectionNumbering, orderedSections, breadcrumbTrail, sectionsCountByKind,
  verificationProgress,
} = storeToRefs(afStore)
provide('liveSectionNumbering', liveSectionNumbering)

// Mode presentation (lecture seule) — toggle via query param ?readonly=1.
// Les composants enfants peuvent injecter `presentationMode` pour adapter
// leur UI (cacher les boutons d'edition, desactiver les inputs).
const presentationMode = computed(() => route.query.readonly === '1')
provide('presentationMode', presentationMode)
function togglePresentation() {
  router.replace({
    path: route.path,
    query: presentationMode.value ? {} : { ...route.query, readonly: '1' },
  })
}
const showActivity = ref(false)
const activityRef = ref(null)
const sectionEditorRef = ref(null)
const { success: notifySuccess, error: notifyError } = useNotification()
const { confirm } = useConfirm()

function isEditableTarget(el) {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  return false
}

async function onKeydown(e) {
  // Cmd/Ctrl + S : flush autosave + toast (marche meme dans l'editeur)
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault()
    try {
      await sectionEditorRef.value?.flushAll?.()
      notifySuccess('Sauvegardé')
    } catch (err) {
      notifyError('Échec de sauvegarde')
    }
    return
  }
  // Pour les autres raccourcis : ignorer si on est dans un champ editable
  if (isEditableTarget(e.target)) return

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const list = orderedSections.value
    if (!list.length) return
    const idx = list.findIndex(s => s.id === selectedId.value)
    let next
    if (e.key === 'ArrowDown') next = list[Math.min(list.length - 1, idx + 1)]
    else next = list[Math.max(0, idx - 1)]
    if (next && next.id !== selectedId.value) {
      e.preventDefault()
      selectSection(next.id)
    }
  } else if (e.key === 'Delete') {
    if (selectedSection.value) {
      e.preventDefault()
      handleDeleteSection(selectedSection.value)
    }
  }
}

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
    const data = await afStore.createNewSection({
      parent_id: addParent.value?.id || null,
      title: addForm.value.title.trim(),
      kind: addForm.value.kind,
      equipment_template_id: addForm.value.kind === 'equipment' ? addForm.value.equipment_template_id : null,
    })
    notifySuccess(`Section "${data.title}" ajoutée`)
    showAddModal.value = false
    afStore.selectSection(data.id)
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de l\'ajout')
  }
}

async function handleDeleteSection(node) {
  const childCount = sections.value.filter(s => s.parent_id === node.id).length
  const message = childCount > 0
    ? `« ${node.title} » contient ${childCount} sous-section(s).\nCela supprimera aussi tous les overrides, instances et captures associés.`
    : `« ${node.title} »`
  const ok = await confirm({
    title: 'Supprimer la section ?',
    message,
    confirmLabel: 'Supprimer',
    danger: true,
  })
  if (!ok) return
  try {
    await afStore.removeSection(node.id)
    notifySuccess('Section supprimée')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec suppression')
  }
}

async function handleAttachmentDrop({ attachmentId, sectionId }) {
  // Pas de move si on drop sur la section actuelle (deja la, no-op).
  if (selectedSection.value?.id === sectionId) return
  try {
    await moveAttachment(attachmentId, sectionId)
    notifySuccess('Capture déplacée')
    // Refresh la section courante (capture retiree) — le composant
    // AttachmentsGrid se rafraichira via watch de sectionId.
    if (selectedSection.value) {
      const { data } = await getSection(selectedSection.value.id)
      afStore.applySectionUpdate(data)
    }
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec du déplacement')
  }
}

async function handleToggleInclude(node) {
  const newVal = node.included_in_export === 0 ? 1 : 0
  try {
    await afStore.patchSection(node.id, { included_in_export: !!newVal })
  } catch (e) {
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
  try {
    await afStore.patchSection(node.id, { opted_out_by_moa: !!newVal })
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec mise à jour')
  }
}

async function selectSection(id) {
  await afStore.selectSection(id)
  // En mode compact, fermer automatiquement le drawer apres selection
  if (isCompact.value) treeDrawerOpen.value = false
}

function onSectionUpdated(updated) {
  afStore.applySectionUpdate(updated)
  // Refresh panneau activite (autosave a possiblement insere une activite)
  activityRef.value?.refresh?.()
}

function onAfUpdated(updated) {
  afStore.patchSelectedAfUpdate(updated)
}

onMounted(async () => {
  await afStore.loadAf(route.params.id)
  window.addEventListener('keydown', onKeydown)
})

// Garde anti-perte : si une autosave est en cours / en attente / en erreur,
// on tente un flush synchrone avant de quitter la route, et on demande
// confirmation à l'utilisateur si le flush n'a pas pu valider.
function hasUnsavedWork() {
  const s = sectionEditorRef.value?.globalState?.value
  return s === 'pending' || s === 'saving' || s === 'error'
}

onBeforeRouteLeave(async () => {
  if (!hasUnsavedWork()) return true
  try { await sectionEditorRef.value?.flushAll?.() } catch { /* on tombera dans le confirm */ }
  if (!hasUnsavedWork()) return true
  return window.confirm(
    'Des modifications n\'ont pas pu être sauvegardées (connexion ?). Quitter quand même ?'
  )
})

function onBeforeUnload(e) {
  if (!hasUnsavedWork()) return
  // Tente un flush opportuniste — il peut être interrompu par la fermeture,
  // mais si le réseau répond vite, ça passe. Le navigateur affichera quand
  // même le prompt natif.
  try { sectionEditorRef.value?.flushAll?.() } catch { /* ignore */ }
  e.preventDefault()
  e.returnValue = ''
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', onBeforeUnload)
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', onBeforeUnload)
  if (mql) mql.removeEventListener('change', updateCompact)
})

watch(() => route.params.id, async (newId, oldId) => {
  // Si une autosave est en cours pour l'AF qu'on quitte, on flush avant de
  // basculer. Si ça a échoué, on demande confirmation et on revient en
  // arrière si l'utilisateur refuse.
  if (oldId && hasUnsavedWork()) {
    try { await sectionEditorRef.value?.flushAll?.() } catch { /* ignore */ }
    if (hasUnsavedWork()) {
      const ok = window.confirm(
        'Des modifications n\'ont pas pu être sauvegardées sur l\'AF précédente. Continuer ?'
      )
      if (!ok) {
        router.replace({ params: { id: oldId } })
        return
      }
    }
  }
  await afStore.loadAf(newId)
})
</script>

<template>
  <div v-if="loading" class="text-center py-12 text-gray-400 text-sm">Chargement…</div>

  <div v-else-if="af" class="-mx-5 lg:-mx-6 -mt-4 lg:-mt-5 h-[calc(100vh-1rem)] flex flex-col">
    <!-- Bandeau mode presentation (lecture seule pour reunions client) -->
    <div v-if="presentationMode" class="bg-amber-100 border-b-2 border-amber-300 px-5 lg:px-6 py-2 flex items-center justify-between">
      <p class="text-xs font-semibold text-amber-900 inline-flex items-center gap-2">
        <span>👁️</span> Mode présentation — lecture seule
      </p>
      <button
        @click="togglePresentation"
        class="text-xs text-amber-900 hover:text-amber-700 underline"
      >Quitter le mode présentation</button>
    </div>

    <!-- Bandeau cycle de vie (en haut, full-width). pb-5 = même rythme
         vertical (20px) que le gap-5 entre les cards de l'editeur. -->
    <div class="px-5 lg:px-6 pt-4 pb-5 space-y-2">
      <CycleBandeau :af="af" @updated="onAfUpdated" @back="router.push('/')" @toggle-activity="showActivity = !showActivity" @toggle-presentation="togglePresentation" @goto-section="selectSection" />
      <RequiredServiceLevelPanel :af-id="af.id" :contract-level="af.service_level" :refresh-key="requiredLevelKey" @goto-section="onGotoSection" />
      <TemplatePropagationBanner :af-id="af.id" @updated="afStore.refreshSections" />
    </div>

    <!-- Bouton mobile pour ouvrir l'arbre (visible uniquement en mode compact) -->
    <div v-if="isCompact" class="px-5 lg:px-6 pb-2">
      <button
        @click="treeDrawerOpen = !treeDrawerOpen"
        class="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 inline-flex items-center gap-2"
      >
        <span class="i-heroicons-bars-3 w-4 h-4">☰</span>
        {{ treeDrawerOpen ? 'Masquer' : 'Afficher' }} l'arbre des sections ({{ sections.length }})
      </button>
    </div>

    <!-- Layout split : arbre 320px + éditeur flex -->
    <div class="flex-1 min-h-0 flex gap-4 px-5 lg:px-6 pb-4 relative">
      <!-- Backdrop pour fermer le drawer en mode compact -->
      <div
        v-if="isCompact && treeDrawerOpen"
        class="fixed inset-0 bg-black/30 z-30"
        @click="treeDrawerOpen = false"
      ></div>

      <!-- Sidebar arbre des sections (redimensionnable, drawer en compact) -->
      <aside
        v-show="treeOpen"
        :style="{ width: treeWidth + 'px' }"
        :class="[
          'shrink-0 bg-white rounded-lg border border-gray-200 overflow-y-auto relative',
          isCompact ? 'fixed left-3 top-3 bottom-3 z-40 shadow-2xl' : '',
        ]"
      >
        <div class="px-4 py-3 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div class="flex items-baseline justify-between gap-2">
            <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Sections ({{ sections.length }})
            </h3>
            <span v-if="verificationProgress.total > 0"
                  :class="['text-[11px] font-medium tabular-nums',
                    verificationProgress.ratio === 1 ? 'text-emerald-600'
                    : verificationProgress.ratio >= 0.5 ? 'text-emerald-700'
                    : 'text-gray-500']"
                  :title="`${verificationProgress.verified} sections vérifiées sur ${verificationProgress.total} sections incluses dans l'export`">
              ✓ {{ verificationProgress.verified }} / {{ verificationProgress.total }}
            </span>
          </div>
          <p class="text-[11px] text-gray-400 mt-0.5">
            {{ sectionsCountByKind.standard }} texte ·
            {{ sectionsCountByKind.equipment }} équip. ·
            {{ sectionsCountByKind.hyperveez_page }} Hyperveez ·
            {{ sectionsCountByKind.synthesis }} synth.
          </p>
          <!-- Barre de progression : ratio des sections verifiees -->
          <div v-if="verificationProgress.total > 0"
               class="mt-1.5 h-1 bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full bg-emerald-500 transition-all duration-300"
                 :style="{ width: (verificationProgress.ratio * 100) + '%' }" />
          </div>
        </div>
        <div class="p-2">
          <SectionTree
            :sections="sections"
            :selected-id="selectedId"
            :af-id="af?.id"
            @select="selectSection"
            @add-root="openAddSection(null)"
            @add-child="openAddSection"
            @delete="handleDeleteSection"
            @toggle-include="handleToggleInclude"
            @toggle-opt-out="handleToggleOptOut"
            @attachment-drop="handleAttachmentDrop"
          />
        </div>
        <!-- Poignée de drag-resize (cachee en compact) -->
        <div
          v-if="!isCompact"
          @mousedown="onTreeResize"
          class="absolute top-0 right-0 h-full w-1.5 cursor-col-resize bg-transparent hover:bg-indigo-300 transition-colors z-20"
          title="Glisser pour redimensionner"
        ></div>
      </aside>

      <!-- Éditeur principal (scrollable). flex+gap garantit un espacement
           uniforme entre toutes les cards, robuste aux v-if conditionnels
           qui laissent des markers de commentaire (space-y-* peut s'y faire piéger). -->
      <div class="flex-1 min-w-0 overflow-y-auto pr-1 flex flex-col gap-5">
        <template v-if="selectedSection">
          <!-- Fil d'Ariane des ancêtres : affiché seulement si la section a au
               moins un parent (sinon la section racine est déjà visible dans le titre). -->
          <nav
            v-if="breadcrumbTrail.length"
            aria-label="Fil d'Ariane"
            class="flex items-center flex-wrap gap-x-1 gap-y-0.5 text-xs text-gray-500 -mb-2 px-1"
          >
            <button
              type="button"
              @click="selectSection(sections[0]?.id)"
              class="hover:text-indigo-700 transition-colors"
            >
              {{ af?.client_name }}<span v-if="af?.project_name"> — {{ af.project_name }}</span>
            </button>
            <template v-for="(ancestor, idx) in breadcrumbTrail" :key="ancestor.id">
              <span class="text-gray-300">/</span>
              <button
                type="button"
                @click="selectSection(ancestor.id)"
                class="hover:text-indigo-700 transition-colors truncate max-w-xs"
                :title="ancestor.title"
              >
                <span v-if="ancestor.number" class="font-mono text-gray-400 mr-1">§{{ ancestor.number }}</span>
                {{ ancestor.title }}
              </button>
            </template>
          </nav>

          <SectionEditor
            ref="sectionEditorRef"
            :key="selectedSection.id"
            :section="selectedSection"
            @updated="onSectionUpdated"
          />

          <!-- Pour kind='zones' : tableau des zones fonctionnelles -->
          <ZonesTable v-if="selectedSection.kind === 'zones'" :section-id="selectedSection.id" :af-id="af.id" />

          <!-- Pour kind='equipment' : description + tableaux points + instances -->
          <template v-if="selectedSection.kind === 'equipment'">
            <EquipmentDescriptionPanel v-if="selectedSection.equipment_template_id" :template-id="selectedSection.equipment_template_id" />
            <PointsTable :section-id="selectedSection.id" :equipment-template-id="selectedSection.equipment_template_id" />
            <EquipmentInstancesTable :section-id="selectedSection.id" :af-id="af.id" :template-id="selectedSection.equipment_template_id" />
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

          <!-- Captures (toutes sections sauf synthesis auto-généré et zones
               qui n'a pas vocation à porter des captures projet). -->
          <AttachmentsGrid
            v-if="!['synthesis', 'zones'].includes(selectedSection.kind)"
            :section-id="selectedSection.id"
            :af-id="af.id"
          />
        </template>
        <div v-else class="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <div class="max-w-md mx-auto space-y-3">
            <div class="w-14 h-14 rounded-full bg-indigo-50 flex items-center justify-center mx-auto">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-7 h-7 text-indigo-500"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>
            </div>
            <h3 class="text-base font-semibold text-gray-800">
              {{ sections.length ? 'Sélectionne une section' : 'Aucune section pour cette AF' }}
            </h3>
            <p class="text-sm text-gray-500 leading-relaxed">
              <template v-if="sections.length">
                Choisis une section dans l'arbre à gauche pour commencer la rédaction.<br>
                Astuce : tu peux naviguer entre sections avec les flèches <kbd class="px-1.5 py-0.5 bg-gray-100 rounded font-mono text-xs">↑ ↓</kbd>.
              </template>
              <template v-else>
                Le plan AF Buildy n'a pas encore été seedé. Vérifie que la création de l'AF a bien déclenché le seed canonique.
              </template>
            </p>
            <button
              v-if="sections.length"
              @click="openAddSection(null)"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-indigo-700 hover:bg-indigo-50 rounded-lg border border-indigo-200"
            >+ Ajouter une section racine</button>
          </div>
        </div>
      </div>

      <!-- Sidebar activité (collapsible, overlay en compact) -->
      <aside
        v-if="showActivity"
        :class="[
          'shrink-0 relative overflow-hidden',
          isCompact ? 'fixed right-3 top-3 bottom-3 w-72 z-40 shadow-2xl bg-white rounded-lg' : 'w-72',
        ]"
      >
        <ActivityPanel
          ref="activityRef"
          :af-id="af.id"
          :kind="af.kind || 'af'"
          closable
          @close="showActivity = false"
        />
      </aside>
      <div
        v-if="isCompact && showActivity"
        class="fixed inset-0 bg-black/30 z-30"
        @click="showActivity = false"
      ></div>
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
                 class="w-full px-3 py-2 border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Type de section</label>
          <select v-model="addForm.kind" class="w-full px-3 py-2 border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
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
