<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch, nextTick } from 'vue'
import Sortable from 'sortablejs'
import { Bars3Icon } from '@heroicons/vue/24/outline'

// Quand integre dans LibrarySystemsView (onglet), on cache le titre/intro
defineProps({ embedded: { type: Boolean, default: false } })

import { ChevronLeftIcon, BookmarkIcon, TableCellsIcon, Squares2X2Icon, MagnifyingGlassIcon, XMarkIcon, PlusIcon, PencilSquareIcon, SparklesIcon, DocumentDuplicateIcon, ArrowUpIcon, ArrowDownIcon, TrashIcon } from '@heroicons/vue/24/outline'
import { listEquipmentTemplates, getEquipmentTemplate, getTemplateVersions, getTemplateAffectedAfs, updateEquipmentTemplate, uploadEquipmentTemplateAttachment, cloneEquipmentTemplate, reorderEquipmentTemplates, deleteEquipmentTemplate } from '@/api'
import { useConfirm } from '@/composables/useConfirm'
import ContentValidationDot from '@/components/ContentValidationDot.vue'
import { getValidationStatus } from '@/lib/content-validation'
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { faCamera } from '@fortawesome/pro-solid-svg-icons'
library.add(faCamera)
import EquipmentIcon from '@/components/EquipmentIcon.vue'
import ProtocolPills from '@/components/ProtocolPills.vue'
import BacsContextBox from '@/components/BacsContextBox.vue'
import EquipmentTemplateEditor from '@/components/EquipmentTemplateEditor.vue'
import EquipmentPointsEditor from '@/components/EquipmentPointsEditor.vue'
import BulkRegenerateModal from '@/components/BulkRegenerateModal.vue'
import TemplateAttachmentsGrid from '@/components/TemplateAttachmentsGrid.vue'
import BaseModal from '@/components/BaseModal.vue'
import BulkActionBar from '@/components/BulkActionBar.vue'
import { useBulkSelection } from '@/composables/useBulkSelection'
import { useNotification } from '@/composables/useNotification'
import { useSystemCategories } from '@/composables/useSystemCategories'
import { useRouter, useRoute } from 'vue-router'
import { ENERGY_OPTIONS, ROLE_OPTIONS } from '@/lib/audit-options'

// Helpers libellés FR pour les défauts énergie/niveau dans la table.
function energyLabel(value) {
  return ENERGY_OPTIONS.find(o => o.value === value)?.label || value
}
function roleLabel(value) {
  // Multi-rôle (mig 117) : value peut être array, scalaire (legacy) ou null.
  const arr = Array.isArray(value) ? value : (value ? [value] : [])
  return arr
    .map(v => ROLE_OPTIONS.find(o => o.value === v)?.label || v)
    .join(' / ')
}
function hasRole(value) {
  return Array.isArray(value) ? value.length > 0 : !!value
}

const { error: notifyError, success: notifySuccess } = useNotification()

// Catalogue dynamique : alimenté par le composable useSystemCategories
// (table `system_categories_db`). Source de vérité pour les libellés des
// catégories. Déclaré en tête du setup car référencé par les computed plus
// bas (groupedForTable, watch sur celui-ci, etc.) — sinon TDZ au setup.
const { categories: dbCategories, labelOf: categoryLabel } = useSystemCategories()

const router = useRouter()
const route = useRoute()
const versions = ref([])
const showEditor = ref(false)
const editorTemplate = ref(null)

function openCreate() { editorTemplate.value = null; showEditor.value = true }
function openEdit() { editorTemplate.value = selected.value; showEditor.value = true }

// Clonage : duplique le système technique avec ses points et captures.
const cloning = ref(null) // { id, name, originalName }
function openClone(t) {
  cloning.value = { id: t.id, name: `${t.name} (copie)`, originalName: t.name }
}
async function submitClone() {
  if (!cloning.value || !cloning.value.name.trim()) return
  try {
    const { data } = await cloneEquipmentTemplate(cloning.value.id, { name: cloning.value.name.trim() })
    const parts = []
    if (data.points_count) parts.push(`${data.points_count} point${data.points_count > 1 ? 's' : ''}`)
    if (data.attachments_count) parts.push(`${data.attachments_count} capture${data.attachments_count > 1 ? 's' : ''}`)
    notifySuccess(`« ${cloning.value.originalName} » dupliqué${parts.length ? ` (${parts.join(', ')})` : ''}`)
    cloning.value = null
    await refresh()
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec du clonage')
  }
}
async function onSaved(savedTpl) {
  showEditor.value = false
  await refresh()
  if (savedTpl?.id) {
    const fresh = templates.value.find(t => t.id === savedTpl.id)
    if (fresh) await openTemplate(fresh)
  }
}
// Save sans fermer : refresh la liste + synchronise la fiche detail si
// elle est ouverte. La modale d'edition reste affichee.
async function onSavedInline(savedTpl) {
  await refresh()
  if (savedTpl?.id && selected.value?.id === savedTpl.id) {
    await openTemplate(savedTpl)
  }
  // editorTemplate reactive : on lui passe la fraiche version pour que
  // le bandeau de validation et liveTemplate se synchronisent.
  if (savedTpl?.id && editorTemplate.value?.id === savedTpl.id) {
    editorTemplate.value = savedTpl
  }
}
async function onDeleted() {
  showEditor.value = false
  selected.value = null
  await refresh()
}

// ── Bulk selection sur la liste des modeles ─────────────────────────
const bulkBusy = ref(false)
// `bulkSel` = checkbox-driven selection, distinct du `selected` (template ouvert
// dans l'editeur a droite). bulkVisibleIds = ids visibles apres filtre+tri.
const bulkVisibleIds = computed(() => filteredSorted.value.map(t => t.id))
const bulkSel = useBulkSelection(() => bulkVisibleIds.value)

async function bulkDelete() {
  if (!bulkSel.size.value) return
  const targets = filteredSorted.value.filter(t => bulkSel.has(t.id))
  const blocked = targets.filter(t => (t.sections_using_count || 0) > 0)
  const deletable = targets.filter(t => !((t.sections_using_count || 0) > 0))
  if (blocked.length) {
    notifyError(`${blocked.length} modèle${blocked.length > 1 ? 's sont' : ' est'} encore utilisé${blocked.length > 1 ? 's' : ''} dans des AF actives, ${blocked.length > 1 ? 'ils' : 'il'} ${blocked.length > 1 ? 'seront' : 'sera'} ignoré${blocked.length > 1 ? 's' : ''}.`)
  }
  if (!deletable.length) return
  const ok = await confirm({
    title: `Supprimer ${deletable.length} modèle${deletable.length > 1 ? 's' : ''} ?`,
    message: 'Suppression définitive (slug tombstoned). Action irréversible.',
    confirmLabel: 'Supprimer',
    danger: true,
  })
  if (!ok) return
  bulkBusy.value = true
  try {
    await Promise.all(deletable.map(t => deleteEquipmentTemplate(t.id).catch(() => null)))
    bulkSel.clear()
    await refresh()
    notifySuccess(`${deletable.length} modèle${deletable.length > 1 ? 's supprimés' : ' supprimé'}`)
  } catch { notifyError('Échec de la suppression en masse') }
  finally { bulkBusy.value = false }
}
async function bulkClone() {
  if (!bulkSel.size.value) return
  bulkBusy.value = true
  try {
    await Promise.all([...bulkSel.selected.value].map(id => cloneEquipmentTemplate(id).catch(() => null)))
    bulkSel.clear()
    await refresh()
    notifySuccess('Modèles dupliqués')
  } catch { notifyError('Échec de la duplication en masse') }
  finally { bulkBusy.value = false }
}

const { confirm } = useConfirm()
async function deleteFromList(t) {
  // Pre-check : si des AFs actives utilisent ce template, on prefixe le
  // message de confirmation avec le nombre d'AFs concernees pour eviter
  // les surprises (la route DELETE refuse de toute facon avec 409 dans
  // ce cas, mais l'UI doit prevenir avant le clic).
  const usedCount = t.sections_using_count || 0
  const msg = usedCount > 0
    ? `« ${t.name} » est utilisé dans ${usedCount} section(s) AF active(s). Détache-le d'abord avant de pouvoir le supprimer.`
    : `Supprimer définitivement « ${t.name} » de la bibliothèque ?\n\nCette action est irréversible. Le slug est tombstoned : il ne pourra pas être réinstancié au prochain boot du seeder.`
  if (usedCount > 0) {
    notifyError(msg)
    return
  }
  const ok = await confirm({
    title: `Supprimer « ${t.name} » ?`,
    message: msg,
    confirmLabel: 'Supprimer',
    danger: true,
  })
  if (!ok) return
  try {
    await deleteEquipmentTemplate(t.id)
    notifySuccess(`« ${t.name} » supprimé`)
    if (selected.value?.id === t.id) selected.value = null
    await refresh()
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de la suppression')
  }
}

const affectedAfs = ref([])
const templates = ref([])
const selected = ref(null)
const showBulk = ref(false)

// Items pour BulkRegenerateModal : 2 entrees par equipement (description + justification BACS)
const bulkItems = computed(() => {
  const out = []
  for (const t of templates.value) {
    if ((t.description_html || '').trim()) {
      out.push({
        id: `desc-${t.id}`,
        title: `${t.name} — description`,
        kind: 'equipment_description',
        _equipId: t.id,
        _field: 'description_html',
        payload: {
          category_label: t.category || null,
          category: t.category || null,
          bacs_articles: t.bacs_articles || null,
          current_template_id: t.id,
        },
      })
    }
    if ((t.bacs_justification || '').trim()) {
      out.push({
        id: `justif-${t.id}`,
        title: `${t.name} — justification BACS`,
        kind: 'equipment_bacs_justification',
        _equipId: t.id,
        _field: 'bacs_justification',
        payload: {
          category_label: t.category || null,
          category: t.category || null,
          bacs_articles: t.bacs_articles || null,
          current_template_id: t.id,
        },
      })
    }
  }
  return out
})
function bulkGetHtml(it) {
  const t = templates.value.find(x => x.id === it._equipId)
  return t?.[it._field] || ''
}
async function bulkSaveHtml(it, html) {
  await updateEquipmentTemplate(it._equipId, { [it._field]: html })
}

const viewMode = ref(localStorage.getItem('library-view-mode') || 'table')
const searchQuery = ref('')
// Tri par defaut : `null` (ordre canonique du backend = ORDER BY
// system_categories_db.position, equipment_templates.position, name).
// Cliquer sur une colonne du tableau switche vers ce tri (alpha, etc.).
// Le drag-drop / les fleches up/down fonctionnent uniquement sur l'ordre
// canonique (sinon les changements de position seraient invisibles,
// ecrases par le tri courant).
const sortBy = ref(null)
const sortDir = ref('asc')
const validationFilter = ref('all') // 'all'|'pending'|'empty'|'draft'|'validated'
function setViewMode(m) { viewMode.value = m; localStorage.setItem('library-view-mode', m) }
function toggleSort(c) {
  if (sortBy.value === c) {
    if (sortDir.value === 'asc') { sortDir.value = 'desc' }
    else { sortBy.value = null; sortDir.value = 'asc' } // 3e clic = retour ordre canonique
  } else { sortBy.value = c; sortDir.value = 'asc' }
}
function normalize(s) { return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') }

// Compteurs de validation, sur la liste brute (avant filtre) — KPI haut.
const validationCounts = computed(() => {
  const counts = { empty: 0, draft: 0, validated: 0 }
  for (const t of templates.value) counts[getValidationStatus(t, 'description_html')]++
  return counts
})

const filteredSorted = computed(() => {
  const q = normalize(searchQuery.value)
  let list = templates.value
  if (q.length >= 2) {
    list = list.filter(t =>
      normalize(t.name).includes(q) ||
      normalize(t.slug).includes(q) ||
      normalize(t.category).includes(q) ||
      normalize(t.preferred_protocols).includes(q)
    )
  }
  // Filtre statut de validation (sur description_html)
  if (validationFilter.value !== 'all') {
    list = list.filter(t => {
      const s = getValidationStatus(t, 'description_html')
      if (validationFilter.value === 'pending') return s !== 'validated'
      return s === validationFilter.value
    })
  }
  // Tri canonique (sortBy === null) : ne re-trie pas, on garde l'ordre du
  // backend qui est deja `system_categories_db.position`, puis
  // `equipment_templates.position`, puis `name`. C'est sur cet ordre que les
  // fleches up/down + drag-drop appliquent leurs changements de position.
  if (sortBy.value !== null) {
    list = [...list].sort((a, b) => {
      let av, bv
      if (sortBy.value === 'points_count' || sortBy.value === 'sections_using_count' || sortBy.value === 'current_version') {
        av = a[sortBy.value] || 0; bv = b[sortBy.value] || 0
      } else {
        av = (a[sortBy.value] || '').toString().toLowerCase()
        bv = (b[sortBy.value] || '').toString().toLowerCase()
      }
      if (av < bv) return sortDir.value === 'asc' ? -1 : 1
      if (av > bv) return sortDir.value === 'asc' ? 1 : -1
      return 0
    })
  }
  return list
})

// (flatEquipmentItems et grouped retirés : le tableau est maintenant rendu
// soit en mode canonique via groupedForTable + N tbody, soit en mode plat
// via filteredSorted directement. Cf. setupSortables / template.)

// Modal Captures + drag-drop d'images sur les lignes equipements
const photosModalTemplate = ref(null)
function openPhotos(t) { photosModalTemplate.value = t }
async function closePhotos() {
  photosModalTemplate.value = null
  await refresh()
}
const dragOverRowId = ref(null)
function onRowDragOver(e, t) {
  if (!e.dataTransfer?.types?.includes('Files')) return
  e.preventDefault()
  dragOverRowId.value = t.id
}
function onRowDragLeave() { dragOverRowId.value = null }
async function onRowDrop(e, t) {
  dragOverRowId.value = null
  const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'))
  if (!files.length) return
  e.preventDefault()
  try {
    for (const f of files) await uploadEquipmentTemplateAttachment(t.id, f)
    notifySuccess(`${files.length} capture${files.length > 1 ? 's' : ''} ajoutée${files.length > 1 ? 's' : ''} à « ${t.name} »`)
    await refresh()
  } catch {
    notifyError('Échec de l\'upload')
  }
}
const loading = ref(false)

const TYPE_COLORS = {
  Mesure:   { bg: 'bg-blue-50',     text: 'text-blue-700' },
  'État':   { bg: 'bg-gray-100',    text: 'text-gray-700' },
  Alarme:   { bg: 'bg-red-50',      text: 'text-red-700' },
  Commande: { bg: 'bg-emerald-50',  text: 'text-emerald-700' },
  Consigne: { bg: 'bg-amber-50',    text: 'text-amber-700' },
}

// Pilules nature : Booléen=vert, Numérique=violet, Enum=orange, Chaîne=gris
const NATURE_COLORS = {
  'Booléen':   'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Numérique': 'bg-violet-50 text-violet-700 border-violet-200',
  'Enum':      'bg-orange-50 text-orange-700 border-orange-200',
  'Chaîne de caractères':    'bg-gray-100 text-gray-700 border-gray-200',
}

const grouped = computed(() => {
  const groups = {}
  // Utilise filteredSorted pour que les filtres recherche / validation
  // s'appliquent aussi a la vue grille (cohérent avec la vue tableau).
  for (const t of filteredSorted.value) {
    const cat = t.category || 'autres'
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(t)
  }
  return groups
})

// Reorder : drag-drop SortableJS + boutons up/down. Activé uniquement
// quand `sortBy === null` (ordre canonique du backend) et hors recherche
// (sinon le réordonnancement serait écrasé par le tri courant).
const reordering = ref(false)
const canDrag = computed(() =>
  sortBy.value === null && normalize(searchQuery.value).length < 2
)

// 1 tbody par catégorie en mode canonique. Refs collectées via setTbodyRef.
// Cette structure rend impossible un drop cross-cat (chaque tbody ne contient
// qu'une seule cat) -- pas de filter ni onMove à gérer.
const tbodyRefsByCat = new Map() // cat -> HTMLTableSectionElement
const sortablesByCat = new Map() // cat -> Sortable instance

function setTbodyRef(cat, el) {
  if (el) tbodyRefsByCat.set(cat, el)
  else tbodyRefsByCat.delete(cat)
}

// Groupage pour le mode canonique : groupes ordonnés selon l'ordre serveur
// (templates est déjà retourné ORDER BY system_categories_db.position,
// equipment_templates.position, name). Filtres recherche / validation
// continuent de s'appliquer en amont via filteredSorted.
const groupedForTable = computed(() => {
  if (!canDrag.value) return []
  const groups = []
  const seen = new Map()
  for (const t of filteredSorted.value) {
    const cat = t.category || 'autres'
    if (!seen.has(cat)) {
      const grp = { cat, label: categoryLabel(cat), items: [] }
      seen.set(cat, grp)
      groups.push(grp)
    }
    seen.get(cat).items.push(t)
  }
  return groups
})

async function applyReorderFromDom(category) {
  if (reordering.value) return
  const tbody = tbodyRefsByCat.get(category)
  if (!tbody) return
  const ids = Array.from(tbody.querySelectorAll('tr[data-id]'))
    .map(tr => parseInt(tr.dataset.id, 10))
    .filter(Boolean)
  if (!ids.length) return
  // Skip si pas de changement
  const currentOrder = templates.value
    .filter(t => (t.category || 'autres') === category)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(t => t.id)
  if (currentOrder.length === ids.length && currentOrder.every((v, i) => v === ids[i])) return
  reordering.value = true
  try {
    await reorderEquipmentTemplates(category, ids)
    await refresh()
  } catch (e) {
    notifyError(e?.response?.data?.detail || 'Échec du réordonnancement')
    await refresh()
  } finally {
    reordering.value = false
  }
}

function destroySortables() {
  for (const s of sortablesByCat.values()) {
    try { s.destroy() } catch { /* ignore */ }
  }
  sortablesByCat.clear()
}

function setupSortables() {
  destroySortables()
  if (!canDrag.value) return
  for (const [cat, tbody] of tbodyRefsByCat) {
    if (!tbody) continue
    const inst = Sortable.create(tbody, {
      handle: '.drag-handle',
      draggable: 'tr[data-id]',
      animation: 150,
      ghostClass: 'opacity-40',
      chosenClass: 'bg-indigo-50',
      onEnd: () => { applyReorderFromDom(cat) },
    })
    sortablesByCat.set(cat, inst)
  }
}

watch([canDrag, groupedForTable], () => {
  nextTick(() => setupSortables())
}, { flush: 'post' })
onMounted(() => nextTick(() => setupSortables()))
onBeforeUnmount(() => destroySortables())
async function moveInCategory(template, direction) {
  if (reordering.value) return
  // Liste des templates de la meme categorie dans l'ordre canonique courant
  // (ignore filtres recherche/validation pour eviter les sauts visuels).
  const peers = templates.value
    .filter(t => (t.category || 'autres') === (template.category || 'autres'))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name, 'fr'))
  const idx = peers.findIndex(t => t.id === template.id)
  if (idx < 0) return
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1
  if (targetIdx < 0 || targetIdx >= peers.length) return
  const next = [...peers]
  ;[next[idx], next[targetIdx]] = [next[targetIdx], next[idx]]
  reordering.value = true
  try {
    await reorderEquipmentTemplates(template.category || 'autres', next.map(t => t.id))
    await refresh()
  } catch (e) {
    notifyError(e?.response?.data?.detail || 'Échec du réordonnancement')
  } finally {
    reordering.value = false
  }
}
function isFirstInCategory(t) {
  const peers = templates.value
    .filter(p => (p.category || 'autres') === (t.category || 'autres'))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name, 'fr'))
  return peers[0]?.id === t.id
}
function isLastInCategory(t) {
  const peers = templates.value
    .filter(p => (p.category || 'autres') === (t.category || 'autres'))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name, 'fr'))
  return peers[peers.length - 1]?.id === t.id
}

// (dbCategories + categoryLabel sont déclarés en tête du setup.)

async function refresh() {
  loading.value = true
  try {
    const { data } = await listEquipmentTemplates()
    templates.value = data
  } finally {
    loading.value = false
  }
}

async function openTemplate(t) {
  const [tplRes, verRes, afsRes] = await Promise.all([
    getEquipmentTemplate(t.id),
    getTemplateVersions(t.id).catch(() => ({ data: { versions: [] } })),
    getTemplateAffectedAfs(t.id).catch(() => ({ data: { afs: [] } })),
  ])
  selected.value = tplRes.data
  versions.value = verRes.data.versions || []
  affectedAfs.value = afsRes.data.afs || []
}

// Recharge le modele courant apres une modif inline des points (depuis
// le composant EquipmentPointsEditor).
async function refreshSelected() {
  if (!selected.value?.id) return
  const { data } = await getEquipmentTemplate(selected.value.id)
  selected.value = data
}

onMounted(async () => {
  await refresh()
  if (route.query.open) {
    const t = templates.value.find(x => x.slug === route.query.open)
    if (t) await openTemplate(t)
  }
})
</script>

<template>
  <div class="max-w-screen-2xl mx-auto">
    <!-- Vue liste -->
    <template v-if="!selected">
      <div class="mb-6 flex items-end justify-between gap-3">
        <div v-if="!embedded">
          <h1 class="text-2xl font-semibold text-gray-800">Bibliothèque d'équipements</h1>
          <p class="text-sm text-gray-500 mt-1">
            {{ templates.length }} template{{ templates.length > 1 ? 's' : '' }} partagé{{ templates.length > 1 ? 's' : '' }}
            entre toutes les AFs. Édite un template pour propager les changements.
          </p>
        </div>
        <p v-else class="text-sm text-gray-500">
          {{ templates.length }} modèle{{ templates.length > 1 ? 's' : '' }} d'équipement partagé{{ templates.length > 1 ? 's' : '' }}.
        </p>
        <div class="flex items-center gap-2">
          <button @click="showBulk = true" :disabled="!bulkItems.length"
                  class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-violet-700 hover:text-violet-900 hover:bg-violet-50 rounded-lg whitespace-nowrap transition disabled:opacity-50">
            <SparklesIcon class="w-4 h-4" /> Régénérer avec Claude
          </button>
          <button @click="openCreate"
                  class="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg shadow-sm whitespace-nowrap transition">
            <PlusIcon class="w-4 h-4" />
            Nouveau modèle
          </button>
        </div>
      </div>

      <div v-if="templates.length" class="flex items-center gap-3 mb-4 flex-wrap">
        <div class="relative flex-1 max-w-md min-w-65">
          <MagnifyingGlassIcon class="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input v-model="searchQuery" type="text" placeholder="Rechercher (nom, slug, catégorie, protocole)…"
                 autocomplete="off" data-1p-ignore="true" data-bwignore="true" data-lpignore="true"
                 class="w-full pl-9 pr-9 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
          <button v-if="searchQuery" @click="searchQuery = ''" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
            <XMarkIcon class="w-4 h-4" />
          </button>
        </div>
        <div class="inline-flex items-center bg-gray-50 border border-gray-200 rounded-lg p-1 text-xs whitespace-nowrap">
          <button @click="validationFilter = 'all'"
                  :class="['px-2.5 py-1 rounded-md transition font-medium',
                           validationFilter === 'all' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700']">
            Tous
          </button>
          <button @click="validationFilter = 'validated'"
                  :class="['px-2.5 py-1 rounded-md transition font-medium inline-flex items-center gap-1.5',
                           validationFilter === 'validated' ? 'bg-white shadow-sm text-emerald-700' : 'text-gray-500 hover:text-gray-700']">
            <span class="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
            Validés <span class="text-gray-400 font-normal">{{ validationCounts.validated }}</span>
          </button>
          <button @click="validationFilter = 'draft'"
                  :class="['px-2.5 py-1 rounded-md transition font-medium inline-flex items-center gap-1.5',
                           validationFilter === 'draft' ? 'bg-white shadow-sm text-amber-700' : 'text-gray-500 hover:text-gray-700']">
            <span class="inline-block w-2 h-2 rounded-full bg-amber-400"></span>
            Brouillons <span class="text-gray-400 font-normal">{{ validationCounts.draft }}</span>
          </button>
          <button @click="validationFilter = 'empty'"
                  :class="['px-2.5 py-1 rounded-md transition font-medium inline-flex items-center gap-1.5',
                           validationFilter === 'empty' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700']">
            <span class="inline-block w-2 h-2 rounded-full bg-gray-300"></span>
            Vides <span class="text-gray-400 font-normal">{{ validationCounts.empty }}</span>
          </button>
          <button @click="validationFilter = 'pending'"
                  title="Vide + brouillon (tout ce qui n'est pas encore validé)"
                  :class="['px-2.5 py-1 rounded-md transition font-medium',
                           validationFilter === 'pending' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700']">
            À traiter <span class="text-gray-400 font-normal">{{ validationCounts.empty + validationCounts.draft }}</span>
          </button>
        </div>
        <div class="inline-flex items-center border border-gray-200 rounded overflow-hidden text-xs ml-auto">
          <button @click="setViewMode('table')" :class="['px-3 py-1.5 inline-flex items-center gap-1', viewMode === 'table' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50']">
            <TableCellsIcon class="w-3.5 h-3.5" /> Tableau
          </button>
          <button @click="setViewMode('grid')" :class="['px-3 py-1.5 inline-flex items-center gap-1', viewMode === 'grid' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50']">
            <Squares2X2Icon class="w-3.5 h-3.5" /> Grille
          </button>
        </div>
      </div>

      <div v-if="loading" class="text-center py-12 text-gray-400 text-sm">Chargement...</div>

      <div v-else-if="viewMode === 'table'" class="bg-white border border-gray-200 rounded-lg shadow-sm overflow-x-auto">
        <table class="w-full text-sm" style="table-layout: auto">
          <thead class="bg-gray-50 text-xs uppercase text-gray-500 tracking-wider">
            <tr>
              <th class="text-center px-3 py-2.5 w-9">
                <input type="checkbox" :checked="bulkSel.allChecked.value" @change="bulkSel.toggleAll()"
                       v-tooltip="'Tout cocher / décocher'"
                       class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/30" />
              </th>
              <th class="text-center px-4 py-2.5 whitespace-nowrap w-10"></th>
              <th class="text-left px-4 py-2.5 whitespace-nowrap cursor-pointer hover:text-gray-700" @click="toggleSort('name')">
                Nom {{ sortBy === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-center px-2 py-2.5 w-10" title="Captures d'écran (cliquer pour ouvrir, glisser une image dessus pour ajouter)">Photos</th>
              <th class="text-center px-4 py-2.5 whitespace-nowrap">Slug</th>
              <th class="text-center px-4 py-2.5 whitespace-nowrap cursor-pointer hover:text-gray-700" @click="toggleSort('default_energy_source')">
                Énergie {{ sortBy === 'default_energy_source' ? (sortDir === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-center px-4 py-2.5 whitespace-nowrap cursor-pointer hover:text-gray-700" @click="toggleSort('default_device_role')">
                Niveau {{ sortBy === 'default_device_role' ? (sortDir === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-center px-4 py-2.5 whitespace-nowrap cursor-pointer hover:text-gray-700" @click="toggleSort('points_count')">
                Points {{ sortBy === 'points_count' ? (sortDir === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-center px-4 py-2.5 whitespace-nowrap cursor-pointer hover:text-gray-700" @click="toggleSort('sections_using_count')">
                AFs {{ sortBy === 'sections_using_count' ? (sortDir === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-center px-4 py-2.5 whitespace-nowrap">Protocoles exigés</th>
              <th class="text-center px-4 py-2.5 whitespace-nowrap cursor-pointer hover:text-gray-700" @click="toggleSort('current_version')">
                Version {{ sortBy === 'current_version' ? (sortDir === 'asc' ? '↑' : '↓') : '' }}
              </th>
              <th class="text-center px-4 py-2.5 whitespace-nowrap"></th>
            </tr>
          </thead>
          <!-- Mode recherche : tbody plat sans drag (tri courant ou recherche).
               Mode canonique (canDrag=true) : N tbody, un par catégorie, avec
               Sortable.create sur chacun. Pas de filter ni onMove cross-cat
               à gérer — chaque tbody = 1 catégorie, structurellement clean. -->
          <template v-if="canDrag">
            <template v-for="grp in groupedForTable" :key="`grp-${grp.cat}`">
              <tbody>
                <tr class="border-t border-gray-100 bg-gray-50/40">
                  <td class="px-3 py-1.5"></td>
                  <td class="px-4 py-1.5"></td>
                  <td class="px-4 py-1.5 font-semibold text-gray-700 text-[11px] uppercase tracking-wider whitespace-nowrap" colspan="10">
                    {{ grp.label }}
                    <span class="text-gray-400 normal-case font-normal ml-2">· {{ grp.items.length }}</span>
                  </td>
                </tr>
              </tbody>
              <tbody :data-cat="grp.cat" :ref="el => setTbodyRef(grp.cat, el)">
                <tr v-for="t in grp.items" :key="`tpl-${t.id}`" :data-id="t.id" :data-cat="grp.cat"
                    :class="['border-t border-gray-100 hover:bg-indigo-50/40 cursor-pointer transition-colors',
                             dragOverRowId === t.id ? 'bg-indigo-100 ring-2 ring-indigo-400 ring-inset' : '',
                             bulkSel.has(t.id) ? 'bg-indigo-50/40' : '']"
                    @click="openTemplate(t)"
                    @dragover="onRowDragOver($event, t)"
                    @dragleave="onRowDragLeave"
                    @drop="onRowDrop($event, t)">
                  <td class="px-3 py-2 text-center whitespace-nowrap" @click.stop>
                    <input type="checkbox" :checked="bulkSel.has(t.id)" @change="bulkSel.toggle(t.id)"
                           class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/30" />
                  </td>
                  <td class="px-4 py-2 text-center whitespace-nowrap">
                    <div class="inline-flex items-center gap-1.5">
                      <span class="drag-handle cursor-move text-gray-300 hover:text-gray-500" @click.stop title="Glisser pour réorganiser dans la catégorie">
                        <Bars3Icon class="w-3.5 h-3.5" />
                      </span>
                      <EquipmentIcon :template="t" size="sm" />
                    </div>
                  </td>
                  <td class="px-4 py-2 font-semibold text-gray-800 whitespace-nowrap pl-8">
                    <span class="text-gray-400 mr-1.5">↳</span>
                    <ContentValidationDot :status="getValidationStatus(t, 'description_html')" :validated-at="t.content_validated_at" :validated-by="t.content_validated_by_name" class="mr-2 align-middle" />
                    {{ t.name }}
                  </td>
                  <td class="px-2 py-2 text-center align-middle" @click.stop>
                    <button type="button" @click="openPhotos(t)"
                      :class="['inline-flex items-center gap-1 px-1.5 py-1 rounded-md transition', t.attachments_count > 0 ? 'text-emerald-600 hover:bg-emerald-100' : 'text-gray-300 hover:bg-gray-100 hover:text-gray-500']"
                      :title="t.attachments_count > 0 ? `${t.attachments_count} capture${t.attachments_count > 1 ? 's' : ''}` : 'Aucune capture'">
                      <FontAwesomeIcon :icon="['fas', 'camera']" class="w-4 h-4" />
                      <span v-if="t.attachments_count > 0" class="text-[11px] font-semibold">{{ t.attachments_count }}</span>
                    </button>
                  </td>
                  <td class="px-4 py-2 text-center whitespace-nowrap"><code class="text-[11px] bg-gray-100 px-1.5 py-0.5 rounded">{{ t.slug }}</code></td>
                  <td class="px-4 py-2 text-center whitespace-nowrap">
                    <span v-if="t.default_energy_source" class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">{{ energyLabel(t.default_energy_source) }}</span>
                    <span v-else class="text-[11px] text-gray-300 italic">—</span>
                  </td>
                  <td class="px-4 py-2 text-center whitespace-nowrap">
                    <span v-if="hasRole(t.default_device_role)" class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-sky-50 text-sky-700 border border-sky-200">{{ roleLabel(t.default_device_role) }}</span>
                    <span v-else class="text-[11px] text-gray-300 italic">—</span>
                  </td>
                  <td class="px-4 py-2 text-center whitespace-nowrap">
                    <span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-600 text-white text-xs font-medium tabular-nums">{{ t.points_count }}</span>
                  </td>
                  <td class="px-4 py-2 text-center whitespace-nowrap">
                    <span v-if="t.sections_using_count > 0" class="inline-flex items-center gap-1 text-xs text-gray-500" v-tooltip="`Utilisé dans ${t.sections_using_count} section(s) AF`">
                      <BookmarkIcon class="w-3 h-3" /> {{ t.sections_using_count }}
                    </span>
                    <span v-else class="text-[11px] text-gray-300 italic" v-tooltip="'Jamais utilisé'">∅ inutilisé</span>
                  </td>
                  <td class="px-4 py-2 whitespace-nowrap">
                    <ProtocolPills v-if="t.preferred_protocols" :protocols="t.preferred_protocols" :show-label="false" :max="2" />
                    <span v-else class="text-[11px] text-gray-300 italic block text-center">—</span>
                  </td>
                  <td class="px-4 py-2 text-center text-[11px] text-gray-400 font-mono whitespace-nowrap">v{{ t.current_version }}</td>
                  <td class="px-4 py-2 text-center whitespace-nowrap" @click.stop>
                    <div class="inline-flex items-center gap-0.5">
                      <button type="button" @click="moveInCategory(t, 'up')" :disabled="reordering || isFirstInCategory(t)"
                              class="inline-flex items-center justify-center w-6 h-6 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                              v-tooltip="'Monter dans la catégorie'"><ArrowUpIcon class="w-3.5 h-3.5" /></button>
                      <button type="button" @click="moveInCategory(t, 'down')" :disabled="reordering || isLastInCategory(t)"
                              class="inline-flex items-center justify-center w-6 h-6 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                              v-tooltip="'Descendre dans la catégorie'"><ArrowDownIcon class="w-3.5 h-3.5" /></button>
                      <button type="button" @click="openClone(t)"
                              class="inline-flex items-center justify-center w-7 h-7 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition"
                              v-tooltip="'Dupliquer ce système technique'"><DocumentDuplicateIcon class="w-4 h-4" /></button>
                      <button type="button" @click="deleteFromList(t)"
                              :disabled="t.sections_using_count > 0"
                              class="inline-flex items-center justify-center w-7 h-7 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 disabled:cursor-not-allowed"
                              :title="t.sections_using_count > 0
                                ? `Utilisé dans ${t.sections_using_count} section(s) AF active(s) — détache d'abord pour pouvoir supprimer`
                                : 'Supprimer ce système technique'"
                              v-tooltip="t.sections_using_count > 0 ? null : 'Supprimer ce système technique'">
                        <TrashIcon class="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </template>
          </template>
          <tbody v-else>
            <tr v-for="t in filteredSorted" :key="`flat-${t.id}`" :data-id="t.id"
                :class="['border-t border-gray-100 hover:bg-indigo-50/40 cursor-pointer transition-colors',
                         dragOverRowId === t.id ? 'bg-indigo-100 ring-2 ring-indigo-400 ring-inset' : '',
                         bulkSel.has(t.id) ? 'bg-indigo-50/40' : '']"
                @click="openTemplate(t)"
                @dragover="onRowDragOver($event, t)"
                @dragleave="onRowDragLeave"
                @drop="onRowDrop($event, t)">
              <td class="px-3 py-2 text-center whitespace-nowrap" @click.stop>
                <input type="checkbox" :checked="bulkSel.has(t.id)" @change="bulkSel.toggle(t.id)"
                       class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/30" />
              </td>
              <td class="px-4 py-2 text-center whitespace-nowrap"><EquipmentIcon :template="t" size="sm" /></td>
              <td class="px-4 py-2 font-semibold text-gray-800 whitespace-nowrap">
                <ContentValidationDot :status="getValidationStatus(t, 'description_html')" :validated-at="t.content_validated_at" :validated-by="t.content_validated_by_name" class="mr-2 align-middle" />
                {{ t.name }}
              </td>
              <td class="px-2 py-2 text-center align-middle" @click.stop>
                <button type="button" @click="openPhotos(t)"
                  :class="['inline-flex items-center gap-1 px-1.5 py-1 rounded-md transition', t.attachments_count > 0 ? 'text-emerald-600 hover:bg-emerald-100' : 'text-gray-300 hover:bg-gray-100 hover:text-gray-500']">
                  <FontAwesomeIcon :icon="['fas', 'camera']" class="w-4 h-4" />
                  <span v-if="t.attachments_count > 0" class="text-[11px] font-semibold">{{ t.attachments_count }}</span>
                </button>
              </td>
              <td class="px-4 py-2 text-center whitespace-nowrap"><code class="text-[11px] bg-gray-100 px-1.5 py-0.5 rounded">{{ t.slug }}</code></td>
              <td class="px-4 py-2 text-center whitespace-nowrap">
                <span v-if="t.default_energy_source" class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">{{ energyLabel(t.default_energy_source) }}</span>
                <span v-else class="text-[11px] text-gray-300 italic">—</span>
              </td>
              <td class="px-4 py-2 text-center whitespace-nowrap">
                <span v-if="hasRole(t.default_device_role)" class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-sky-50 text-sky-700 border border-sky-200">{{ roleLabel(t.default_device_role) }}</span>
                <span v-else class="text-[11px] text-gray-300 italic">—</span>
              </td>
              <td class="px-4 py-2 text-center whitespace-nowrap">
                <span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-600 text-white text-xs font-medium tabular-nums">{{ t.points_count }}</span>
              </td>
              <td class="px-4 py-2 text-center whitespace-nowrap">
                <span v-if="t.sections_using_count > 0" class="inline-flex items-center gap-1 text-xs text-gray-500" v-tooltip="`Utilisé dans ${t.sections_using_count} section(s) AF`">
                  <BookmarkIcon class="w-3 h-3" /> {{ t.sections_using_count }}
                </span>
                <span v-else class="text-[11px] text-gray-300 italic" v-tooltip="'Jamais utilisé'">∅ inutilisé</span>
              </td>
              <td class="px-4 py-2 whitespace-nowrap">
                <ProtocolPills v-if="t.preferred_protocols" :protocols="t.preferred_protocols" :show-label="false" :max="2" />
                <span v-else class="text-[11px] text-gray-300 italic block text-center">—</span>
              </td>
              <td class="px-4 py-2 text-center text-[11px] text-gray-400 font-mono whitespace-nowrap">v{{ t.current_version }}</td>
              <td class="px-4 py-2 text-center whitespace-nowrap" @click.stop>
                <div class="inline-flex items-center gap-0.5">
                  <button type="button" @click="openClone(t)"
                          class="inline-flex items-center justify-center w-7 h-7 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition"
                          v-tooltip="'Dupliquer ce système technique'"><DocumentDuplicateIcon class="w-4 h-4" /></button>
                  <button type="button" @click="deleteFromList(t)"
                          :disabled="t.sections_using_count > 0"
                          class="inline-flex items-center justify-center w-7 h-7 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 disabled:cursor-not-allowed"
                          :title="t.sections_using_count > 0
                            ? `Utilisé dans ${t.sections_using_count} section(s) AF active(s) — détache d'abord pour pouvoir supprimer`
                            : 'Supprimer ce système technique'"
                          v-tooltip="t.sections_using_count > 0 ? null : 'Supprimer ce système technique'">
                    <TrashIcon class="w-4 h-4" />
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="!filteredSorted.length">
              <td colspan="12" class="px-4 py-8 text-center text-sm text-gray-400 italic">
                {{ searchQuery ? `Aucun template ne correspond à « ${searchQuery} ».` : 'Aucun template.' }}
              </td>
            </tr>
          </tbody>
        </table>

        <BulkActionBar :count="bulkSel.size.value" noun="modèle" @clear="bulkSel.clear()">
          <button @click="bulkClone" :disabled="bulkBusy"
                  class="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-white/10 hover:bg-white/20 rounded-md disabled:opacity-50 whitespace-nowrap">
            <DocumentDuplicateIcon class="w-4 h-4" />
            Dupliquer
          </button>
          <button @click="bulkDelete" :disabled="bulkBusy"
                  class="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-rose-500 hover:bg-rose-600 rounded-md disabled:opacity-50 whitespace-nowrap">
            <TrashIcon class="w-4 h-4" />
            Supprimer
          </button>
        </BulkActionBar>
      </div>

      <div v-else v-for="(items, cat) in grouped" :key="cat" class="mb-8">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
          {{ categoryLabel(cat) }} <span class="text-gray-400">· {{ items.length }}</span>
        </h3>
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <button v-for="t in items" :key="t.id" @click="openTemplate(t)"
                  class="text-left bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md hover:border-indigo-300 transition group relative">
            <ContentValidationDot :status="getValidationStatus(t, 'description_html')"
                                  :validated-at="t.content_validated_at"
                                  :validated-by="t.content_validated_by_name"
                                  class="absolute top-2 right-2" />
            <div class="flex items-center justify-between mb-2">
              <EquipmentIcon :template="t" size="lg" />
              <span class="text-[10px] text-gray-400">v{{ t.current_version }}</span>
            </div>
            <p class="text-sm font-semibold text-gray-800 leading-tight mb-1">{{ t.name }}</p>
            <div class="flex items-center justify-between text-[11px] text-gray-500 mt-2 pt-2 border-t border-gray-100">
              <span>{{ t.points_count }} point{{ t.points_count > 1 ? 's' : '' }}</span>
              <span class="inline-flex items-center gap-0.5">
                <BookmarkIcon class="w-3 h-3" /> {{ t.sections_using_count }}
              </span>
            </div>
          </button>
        </div>
      </div>
    </template>

    <!-- Vue détail -->
    <template v-else>
      <button @click="selected = null" class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ChevronLeftIcon class="w-4 h-4" /> Retour à la bibliothèque
      </button>

      <div class="flex items-start gap-4 mb-6">
        <EquipmentIcon :template="selected" size="lg" />
        <div class="min-w-0 flex-1">
          <h1 class="text-2xl font-semibold text-gray-800">{{ selected.name }}</h1>
          <p class="text-sm text-gray-500 mt-1">
            <span class="capitalize">{{ categoryLabel(selected.category) }}</span>
            · v{{ selected.current_version }} · slug <code class="bg-gray-100 px-1.5 py-0.5 rounded">{{ selected.slug }}</code>
          </p>
          <div v-if="selected.preferred_protocols" class="mt-3">
            <ProtocolPills :protocols="selected.preferred_protocols" />
          </div>
        </div>
        <button @click="openEdit"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 text-gray-700 hover:bg-gray-50 rounded shrink-0">
          <PencilSquareIcon class="w-3.5 h-3.5" />
          Éditer le modèle
        </button>
      </div>

      <div v-if="selected.bacs_articles" class="mb-6">
        <BacsContextBox
          :reference="selected.bacs_articles"
          :justification="selected.bacs_justification"
          :template-id="selected.id"
          context="equipment"
          editable
          @updated="selected = { ...selected, ...$event }"
        />
      </div>

      <div class="mb-6">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Description fonctionnelle</h3>
        <div v-if="selected.description_html" v-html="selected.description_html" class="prose prose-sm max-w-none text-gray-700 bg-white border border-gray-200 rounded-lg p-6 equipment-desc"></div>
        <div v-else class="bg-white border border-dashed border-gray-200 rounded-lg p-5 text-sm text-gray-400 italic">
          Pas encore de description rédigée pour ce template. Édite-le depuis une AF puis promeus tes modifications dans la bibliothèque.
        </div>
      </div>

      <!-- Edition inline des points (lectures + ecritures) directement
           depuis la vue detail, plus besoin d'ouvrir la modale d'edition -->
      <div class="mb-6">
        <EquipmentPointsEditor :template-id="selected.id" @updated="refreshSelected" />
      </div>

      <!-- Anciens tableaux read-only conserves uniquement pour les sections
           qui n'existent pas (placeholder vide quand 0 ecriture). Cache. -->
      <div v-if="false">
        <div v-if="selected.points.filter(p => p.direction === 'write').length" class="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th class="text-left px-4 py-2 font-medium">Donnée</th>
                <th class="text-left px-4 py-2 font-medium w-44">Nom technique</th>
                <th class="text-left px-4 py-2 font-medium w-28">Type</th>
                <th class="text-left px-4 py-2 font-medium w-24">Nature</th>
                <th class="text-left px-4 py-2 font-medium w-20">Unité</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in selected.points.filter(p => p.direction === 'write')" :key="p.id" class="border-t border-gray-100" :class="p.is_optional ? 'bg-gray-50/50' : ''">
                <td class="px-4 py-2" :class="p.is_optional ? 'text-gray-500 italic' : 'text-gray-800'">
                  {{ p.label }}
                  <span v-if="p.is_optional" class="ml-1 text-[10px] text-gray-400 not-italic">(optionnel)</span>
                </td>
                <td class="px-4 py-2 text-xs">
                  <code v-if="p.tech_name" class="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-[11px] text-gray-700">{{ p.tech_name }}</code>
                  <span v-else class="text-gray-300 italic">—</span>
                </td>
                <td class="px-4 py-2">
                  <span :class="['inline-block px-1.5 py-0.5 text-[10px] font-semibold rounded', TYPE_COLORS[p.data_type]?.bg, TYPE_COLORS[p.data_type]?.text]">{{ p.data_type }}</span>
                </td>
                <td class="px-4 py-2">
                  <span v-if="p.nature" :class="['inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full border', NATURE_COLORS[p.nature] || 'bg-gray-50 text-gray-600 border-gray-200']">
                    {{ p.nature }}
                  </span>
                  <span v-else class="text-gray-300 text-xs">—</span>
                </td>
                <td class="px-4 py-2 text-gray-500 text-center font-variant-numeric tabular-nums">{{ p.unit || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="text-sm text-gray-400 italic">Aucun point d'écriture défini.</div>
      </div>

      <div class="mt-8" v-if="versions.length">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Historique des versions ({{ versions.length }})
        </h3>
        <div class="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th class="text-left px-4 py-2 font-medium w-20">Version</th>
                <th class="text-left px-4 py-2 font-medium">Changelog</th>
                <th class="text-left px-4 py-2 font-medium w-40">Auteur</th>
                <th class="text-left px-4 py-2 font-medium w-44">Date</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in versions" :key="v.id" class="border-t border-gray-100">
                <td class="px-4 py-2">
                  <span class="font-mono text-xs">v{{ v.version }}</span>
                  <span v-if="v.version === selected.current_version" class="ml-1 inline-block px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-800">actuelle</span>
                </td>
                <td class="px-4 py-2 text-gray-700">{{ v.changelog || '—' }}</td>
                <td class="px-4 py-2 text-gray-500 text-xs">{{ v.author_name || '—' }}</td>
                <td class="px-4 py-2 text-gray-500 text-xs">{{ new Date(v.created_at + 'Z').toLocaleString('fr-FR') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="mt-8" v-if="affectedAfs.length">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          AFs qui utilisent ce template ({{ affectedAfs.length }})
        </h3>
        <div class="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th class="text-left px-4 py-2 font-medium">Projet</th>
                <th class="text-left px-4 py-2 font-medium w-28">Statut</th>
                <th class="text-left px-4 py-2 font-medium w-44">Sections</th>
                <th class="text-left px-4 py-2 font-medium w-32">Synchro</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="af in affectedAfs" :key="af.af_id" class="border-t border-gray-100">
                <td class="px-4 py-2">
                  <button @click="router.push(`/afs/${af.af_id}`)" class="text-left hover:text-indigo-700">
                    <p class="font-semibold text-gray-800">{{ af.client_name }}</p>
                    <p class="text-xs text-gray-500">{{ af.project_name }}</p>
                  </button>
                </td>
                <td class="px-4 py-2 text-xs text-gray-600 capitalize">{{ af.status }}</td>
                <td class="px-4 py-2 text-xs text-gray-600">
                  <span v-for="(s, i) in af.sections" :key="s.section_id">
                    <span :class="s.is_outdated ? 'text-amber-700' : 'text-gray-500'">
                      § {{ s.number || '?' }} (v{{ s.equipment_template_version || 0 }})
                    </span><span v-if="i < af.sections.length - 1">, </span>
                  </span>
                </td>
                <td class="px-4 py-2">
                  <span v-if="af.outdated_count === 0" class="inline-block px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-800">à jour</span>
                  <span v-else class="inline-block px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-800">{{ af.outdated_count }} en retard</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <EquipmentTemplateEditor
      v-if="showEditor"
      :template="editorTemplate"
      @close="showEditor = false"
      @saved="onSaved"
      @saved-inline="onSavedInline"
      @deleted="onDeleted"
    />

    <BulkRegenerateModal
      v-if="showBulk"
      v-tooltip="'Régénérer les systèmes techniques avec Claude'"
      :items="bulkItems"
      :get-html="bulkGetHtml"
      :on-save-html="bulkSaveHtml"
      @close="showBulk = false; refresh()"
      @done="refresh()"
    />

    <!-- Modal Captures d'écran (heritees automatiquement par toutes les
         sections AF qui referencent ce modele d'equipement). -->
    <BaseModal
      v-if="photosModalTemplate"
      :title="`Captures d'écran — ${photosModalTemplate.name}`"
      size="lg"
      @close="closePhotos"
    >
      <TemplateAttachmentsGrid
        template-kind="equipment"
        :template-id="photosModalTemplate.id"
      />
      <template #footer>
        <button @click="closePhotos"
                class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition">
          Fermer
        </button>
      </template>
    </BaseModal>

    <BaseModal
      v-if="cloning"
      :title="'Dupliquer le système technique'"
      size="md"
      @close="cloning = null"
    >
      <form @submit.prevent="submitClone" class="space-y-3">
        <p class="text-xs text-gray-600">
          Le système
          <span class="font-medium text-gray-800">« {{ cloning.originalName }} »</span>
          sera dupliqué avec ses points et ses captures d'écran.
        </p>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Nom de la copie</label>
          <input v-model="cloning.name" type="text" required autocomplete="off"
                 class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
        </div>
      </form>
      <template #footer>
        <button @click="cloning = null"
                class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition whitespace-nowrap">
          Annuler
        </button>
        <button @click="submitClone" :disabled="!cloning.name.trim()"
                class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition disabled:opacity-50 whitespace-nowrap">
          Dupliquer
        </button>
      </template>
    </BaseModal>
  </div>
</template>

<style scoped>
.equipment-desc :deep(p) { margin: 0 0 1rem; line-height: 1.65; }
.equipment-desc :deep(p:last-child) { margin-bottom: 0; }
.equipment-desc :deep(ul), .equipment-desc :deep(ol) { padding-left: 1.4rem; margin: 0.75rem 0 1rem; list-style-position: outside; }
.equipment-desc :deep(ul) { list-style-type: disc; }
.equipment-desc :deep(ol) { list-style-type: decimal; }
.equipment-desc :deep(li) { margin: 0.4rem 0; line-height: 1.55; }
.equipment-desc :deep(strong) { color: #1f2937; font-weight: 500; }
</style>
