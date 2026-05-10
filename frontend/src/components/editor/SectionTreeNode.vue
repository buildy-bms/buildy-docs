<script setup>
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount, inject } from 'vue'
import { ChevronRightIcon, ChevronDownIcon, PlusIcon, TrashIcon, EyeIcon, EyeSlashIcon, NoSymbolIcon, CheckCircleIcon, CheckBadgeIcon, ArrowUpOnSquareIcon, ArrowUpIcon, ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, Bars3Icon } from '@heroicons/vue/24/outline'
import Sortable from 'sortablejs'
import ServiceLevelBadge from '@/components/ServiceLevelBadge.vue'
import Tooltip from '@/components/Tooltip.vue'
import EquipmentIcon from '@/components/EquipmentIcon.vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
// Registre cure : evite d'embarquer les ~3000 icones FA Pro Solid dans le
// chunk principal. Les section_templates.icon_name hors registre tombent
// sur 'cube' (cf. equipment-icons.js).
import '@/lib/equipment-icons'
import { resolveFaIconName as _resolveFaIconName } from '@/lib/equipment-icons'

// Numerotation calculee live depuis l'AfDetailView. Fallback sur node.number
// (sections seedees avant le passage en numerotation auto).
const liveNumbering = inject('liveSectionNumbering', null)

defineOptions({ name: 'SectionTreeNode' })

const props = defineProps({
  node: { type: Object, required: true },
  level: { type: Number, default: 0 },
  selectedId: { type: Number, default: null },
  collapsed: { type: Set, required: true },
  kindIcon: { type: Object, required: true },
  isEmpty: { type: Function, required: true },
  search: { type: String, default: '' },
})
const emit = defineEmits(['select', 'toggle', 'add-child', 'delete', 'toggle-include', 'toggle-opt-out', 'toggle-demanded', 'toggle-optin-paid-option', 'move-up', 'move-down', 'indent', 'outdent', 'reorder-children', 'attachment-drop', 'promote-to-library'])

// Niveau de contrat de l'AF injecte par AfDetailView (mig 92). Sert a
// calculer la disponibilite de chaque feature au niveau choisi par le MOA.
const afServiceLevel = inject('afServiceLevel', ref(null))

// Drag-drop accueille les captures depuis l'editeur. On reagit uniquement
// si le payload contient 'application/x-buildy-attachment' (l'id de la
// capture). Ignore tout autre type de drag (ex : fichiers OS, qui sont
// pris en charge par AttachmentsGrid lui-meme).
const dragOver = ref(false)
function onDragOver(e) {
  if (!e.dataTransfer?.types?.includes('application/x-buildy-attachment')) return
  e.preventDefault()
  dragOver.value = true
}
function onDragLeave() { dragOver.value = false }
function onDrop(e) {
  dragOver.value = false
  const id = e.dataTransfer?.getData('application/x-buildy-attachment')
  if (!id) return
  e.preventDefault()
  emit('attachment-drop', { attachmentId: parseInt(id, 10), sectionId: props.node.id })
}

const excluded = computed(() => props.node.included_in_export === 0)

// Pas de numéro affiché pour les sections exclues (elles sortent de la
// numérotation, l'arbo doit être cohérente avec le PDF). Le fallback
// `node.number` est volontairement contourné car la valeur figée en DB
// au seed peut diverger fortement de la position courante.
const displayedNumber = computed(() => {
  if (excluded.value) return ''
  return (liveNumbering?.value && liveNumbering.value.get(props.node.id)) || ''
})

// Section ad-hoc = créée à la volée dans cette AF (« Ajouter une sous-section »)
// sans pendant biblio. La promotion vers la biblio en crée un section_template
// dédié et lie cette section au nouveau template.
const isAdHoc = computed(() =>
  !props.node.section_template_id &&
  !props.node.equipment_template_id &&
  props.node.kind === 'standard'
)
const optedOut = computed(() => props.node.opted_out_by_moa === 1)
const demanded = computed(() => props.node.demanded_by_moa === 1)
const optinPaid = computed(() => props.node.optin_paid_option === 1)
// Disponibilite de la feature au niveau de contrat choisi par le MOA.
// Renvoie 'included' | 'paid_option' | null. Sert au badge live et a la
// visibilite du bouton "Ajouter en option payante".
const availAtAfLevel = computed(() => {
  const lvl = afServiceLevel.value
  if (!lvl) return null
  if (lvl === 'E') return props.node.tpl_avail_e || null
  if (lvl === 'S') return props.node.tpl_avail_s || null
  if (lvl === 'P') return props.node.tpl_avail_p || null
  return null
})
// Disponibilites par niveau (depuis le section_template). Permet de
// distinguer les features "incluses" des "options payantes" (paid_option).
const availE = computed(() => props.node.tpl_avail_e || null)
const availS = computed(() => props.node.tpl_avail_s || null)
const availP = computed(() => props.node.tpl_avail_p || null)
// Une feature est une "option payante" si au moins un niveau l'expose en
// paid_option (typiquement Connectivite 4G, Plans 2D/3D, API Connect...).
const hasPaidOption = computed(() => [availE.value, availS.value, availP.value].includes('paid_option'))
// "Tout en option" = paid_option aux 3 niveaux (Serenite-style add-on).
const allPaidOption = computed(() =>
  availE.value === 'paid_option' && availS.value === 'paid_option' && availP.value === 'paid_option'
)
// Les toggles "écartée" et "demandée par MOA" n'ont de sens que pour les
// fonctionnalités optionnelles. Eligibilite :
//  - feature avec au moins un paid_option (Sérénité, Connectivité 4G…)
//  - OU feature au niveau Smart / Premium / Smart+Premium uniquement
const OPTIONAL_LEVELS = new Set(['S', 'P', 'S/P'])
const canOptOut = computed(() =>
  hasPaidOption.value || OPTIONAL_LEVELS.has((props.node.service_level || '').toUpperCase())
)
const canDemand = canOptOut

// Niveau minimum pour acceder a cette section (= niveau le plus accessible).
// Les valeurs service_level sont ordonnees E -> S -> P : on prend la premiere
// lettre du token. Ex : "E/S/P" -> "E", "S/P" -> "S", "P" -> "P".
const minServiceLevel = computed(() => {
  const lvl = (props.node.service_level || '').toUpperCase().trim()
  if (!lvl) return null
  return lvl.split('/')[0].trim() || null
})

const hasChildren = computed(() => Array.isArray(props.node.children) && props.node.children.length > 0)
const isCollapsed = computed(() => props.collapsed.has(props.node.id))
const isSelected = computed(() => props.selectedId === props.node.id)

// Drag-drop reorder : Sortable sur le conteneur des enfants directs.
// Chaque enfant porte data-id pour qu'on recupere les ids dans le nouvel
// ordre au onEnd. handle: '.drag-handle' (icone Bars3 sur chaque ligne).
// La fratrie ne peut etre droppee qu'au sein du meme parent (group local
// par defaut, pas de re-parentage).
const childrenContainerRef = ref(null)
let sortable = null
function teardownSortable() {
  if (sortable) { try { sortable.destroy() } catch { /* ignore */ } sortable = null }
}
function setupSortable() {
  teardownSortable()
  if (!childrenContainerRef.value) return
  // data-parent-id sur le container = parent dont les enfants sont
  // re-arranges. Permet au onEnd de detecter le re-parentage cross-fratries.
  childrenContainerRef.value.setAttribute('data-parent-id', String(props.node.id))
  sortable = Sortable.create(childrenContainerRef.value, {
    animation: 150,
    // Groupe partagé = drag-drop possible entre toutes les fratries du tree
    // (cf. SectionTree top-level). Re-parentage autorisé.
    group: 'sections-tree',
    handle: '.section-drag-handle',
    ghostClass: 'section-tree-ghost',
    chosenClass: 'section-tree-chosen',
    dragClass: 'section-tree-dragging',
    fallbackOnBody: true,
    onEnd: (evt) => {
      // Le drop a-t-il vraiment bouge l'element ?
      const sameContainer = evt.from === evt.to
      if (sameContainer && evt.oldIndex === evt.newIndex) return
      // evt.to est le container destination. On lit son data-parent-id pour
      // identifier le nouveau parent (null pour root, sinon section.id).
      const newParentAttr = evt.to.getAttribute('data-parent-id') || ''
      const newParentId = newParentAttr === '' ? null : parseInt(newParentAttr, 10)
      const ids = Array.from(evt.to.children)
        .map(el => parseInt(el.getAttribute('data-id'), 10))
        .filter(Boolean)
      emit('reorder-children', { parentId: newParentId, ids })
    },
  })
}
// Le conteneur enfants est rendu tant que !isCollapsed (cf. v-if dans le
// template) — même vide, pour autoriser le drop dans une section sans
// enfants ("ranger sous cette section").
watch(isCollapsed, async () => {
  await nextTick()
  if (!isCollapsed.value) setupSortable()
  else teardownSortable()
})
onMounted(async () => {
  await nextTick()
  if (!isCollapsed.value) setupSortable()
})
onBeforeUnmount(teardownSortable)

// Scroll-into-view automatique quand cette ligne devient selectionnee
const btnRef = ref(null)
watch(isSelected, async (sel) => {
  if (!sel) return
  await nextTick()
  btnRef.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}, { immediate: true })
const Icon = computed(() => props.kindIcon[props.node.kind] || props.kindIcon.standard)
const empty = computed(() => props.isEmpty(props.node))

const indentStyle = computed(() => ({
  paddingLeft: `${0.5 + props.level * 0.75}rem`,
}))

const levelClasses = computed(() => {
  if (props.level === 0) return 'font-bold text-gray-900'
  if (props.level === 1) return 'font-semibold text-gray-700'
  return 'font-normal text-gray-600'
})
const numberClasses = computed(() => {
  if (props.level === 0) return 'text-gray-700 font-bold'
  if (props.level === 1) return 'text-gray-500 font-semibold'
  return 'text-gray-400 font-medium'
})

// Highlight des matches (recherche live)
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
function normalize(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}
const titleHtml = computed(() => {
  const q = props.search?.trim()
  if (!q || q.length < 2) return escapeHtml(props.node.title)
  const norm = normalize(props.node.title)
  const qn = normalize(q)
  const idx = norm.indexOf(qn)
  if (idx < 0) return escapeHtml(props.node.title)
  // re-mappe sur la chaîne d'origine en utilisant la même longueur (approximation)
  const original = props.node.title
  return escapeHtml(original.slice(0, idx)) +
    '<mark class="bg-yellow-200 text-gray-900 px-0.5">' + escapeHtml(original.slice(idx, idx + qn.length)) + '</mark>' +
    escapeHtml(original.slice(idx + qn.length))
})
</script>

<template>
  <div :data-id="node.id" :data-parent-id="node.parent_id || ''">
    <button
      ref="btnRef"
      :style="indentStyle"
      :class="[
        'group w-full text-left flex items-center gap-1.5 py-1.5 pr-2 rounded-md transition-colors',
        isSelected ? 'bg-indigo-50 text-indigo-900' : 'hover:bg-gray-100 text-gray-700',
        dragOver ? 'ring-2 ring-emerald-400 bg-emerald-50' : '',
      ]"
      @click="emit('select', node.id)"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <!-- Drag handle : visible au hover, declenche le drag SortableJS. -->
      <span class="section-drag-handle shrink-0 opacity-0 group-hover:opacity-100 cursor-grab text-gray-400 hover:text-gray-700 -ml-0.5"
            @click.stop @mousedown.stop>
        <Bars3Icon class="w-3 h-3" />
      </span>
      <!-- Slot statut "verifie" : toujours rendu (place fixe la plus a gauche)
           pour aligner verticalement les ✓ d'une ligne a l'autre. -->
      <Tooltip :text="node.fact_check_status === 'verified' ? 'Section vérifiée' : 'À vérifier'">
        <CheckCircleIcon
          :class="['w-3.5 h-3.5 shrink-0',
            node.fact_check_status === 'verified' ? 'text-emerald-500' : 'text-gray-300']"
        />
      </Tooltip>

      <button
        v-if="hasChildren"
        type="button"
        @click.stop="emit('toggle', node)"
        class="shrink-0 p-0.5 -my-0.5 rounded hover:bg-gray-200"
      >
        <ChevronRightIcon v-if="isCollapsed" class="w-3 h-3 text-gray-500" />
        <ChevronDownIcon v-else class="w-3 h-3 text-gray-500" />
      </button>
      <span v-else class="w-4 h-3 shrink-0"></span>

      <component :is="Icon" :class="['w-3.5 h-3.5 shrink-0', isSelected ? 'text-indigo-600' : 'text-gray-400']" />

      <span v-if="displayedNumber"
            :class="['text-[11px] shrink-0', isSelected ? 'text-indigo-700 font-bold' : numberClasses]">
        {{ displayedNumber }}
      </span>

      <!-- Indicateurs de niveau (a cote du numero) : on n'affiche que le
           niveau MINIMUM requis pour acceder a la section (gain de place
           dans l'arborescence). Le detail complet reste visible dans la
           fiche section et l'annexe Tableau des fonctionnalites. -->
      <ServiceLevelBadge v-if="minServiceLevel" :level="minServiceLevel" />
      <Tooltip
        v-if="hasPaidOption"
        :text="allPaidOption
          ? 'Option payante à tous les niveaux (add-on facturé séparément, type Sérénité, Connectivité 4G, API Connect)'
          : 'Option payante — facturée en plus du contrat de base'"
      >
        <span :class="['inline-flex items-center px-1 py-0 text-[9px] font-bold rounded border whitespace-nowrap shrink-0',
          allPaidOption
            ? 'bg-orange-100 text-orange-800 border-orange-300'
            : 'bg-orange-50 text-orange-700 border-orange-200']">
          €
        </span>
      </Tooltip>

      <!-- Noeud catégorie système (refactor categories) : icone depuis system_categories_db -->
      <EquipmentIcon
        v-if="node.system_category_key && node.cat_icon_value"
        :template="{ icon_kind: 'fa', icon_value: node.cat_icon_value, icon_color: node.cat_icon_color }"
        size="xs"
      />
      <!-- Icone equipement coloree (kind='equipment') prioritaire sur tpl_icon_name. -->
      <EquipmentIcon
        v-else-if="node.kind === 'equipment' && node.eq_icon_value"
        :template="{ icon_kind: node.eq_icon_kind, icon_value: node.eq_icon_value, icon_color: node.eq_icon_color }"
        size="xs"
      />
      <FontAwesomeIcon
        v-else-if="node.tpl_icon_name"
        :icon="['fas', _resolveFaIconName(node.tpl_icon_name)]"
        class="w-3 h-3 shrink-0 text-gray-500"
        :class="isSelected ? 'text-indigo-700' : ''"
      />
      <span :class="['flex-1 min-w-0 truncate text-[12px]', isSelected ? 'font-semibold text-indigo-900' : levelClasses, excluded ? 'line-through text-gray-400 italic' : '', optedOut ? 'line-through text-amber-700 italic' : '', (demanded || optinPaid) ? 'text-emerald-700 font-semibold' : '']" v-html="titleHtml"></span>

      <!-- Actions au survol : demande/refuse MOA + inclure/exclure + ajouter enfant + supprimer.
           hidden plutot qu'opacity-0 pour ne pas voler de largeur au titre.
           Tooltips via <Tooltip> (instantanes, fond sombre) pour remplacer les
           native title= qui ont un delai de ~500ms et un style basique. -->
      <span class="hidden group-hover:flex items-center gap-0.5 shrink-0">
        <Tooltip
          v-if="canDemand"
          :text="demanded ? 'Annuler la validation MOA' : 'Marquer comme fonction exigée par la MOA (à inclure dans l\'avenant contractuel)'"
        >
          <button
            type="button"
            @click.stop="emit('toggle-demanded', node)"
            :class="['p-0.5 rounded', demanded ? 'hover:bg-gray-200 text-emerald-700' : 'hover:bg-emerald-200 text-emerald-600']"
          >
            <CheckBadgeIcon class="w-3 h-3" />
          </button>
        </Tooltip>
        <Tooltip
          v-if="canOptOut"
          :text="optedOut ? 'Réactiver cette fonctionnalité' : 'Écarter cette fonctionnalité (par la MOA — visible dans le PDF avec encart)'"
        >
          <button
            type="button"
            @click.stop="emit('toggle-opt-out', node)"
            :class="['p-0.5 rounded', optedOut ? 'hover:bg-emerald-200 text-emerald-600' : 'hover:bg-amber-200 text-amber-600']"
          >
            <NoSymbolIcon class="w-3 h-3" />
          </button>
        </Tooltip>
        <!-- Lot 92 — Bouton "Ajouter en option payante au contrat".
             Visible uniquement quand la feature est en avail_<af.service_level>='paid_option'. -->
        <Tooltip
          v-if="availAtAfLevel === 'paid_option'"
          :text="optinPaid ? 'Retirer du contrat (ne plus inclure comme option payante)' : 'Ajouter au contrat comme option payante (sans changer de niveau d\'offre)'"
        >
          <button
            type="button"
            @click.stop="emit('toggle-optin-paid-option', node)"
            :class="['p-0.5 rounded font-bold text-[10px] leading-none w-3.5 h-3.5 flex items-center justify-center', optinPaid ? 'bg-emerald-600 text-white' : 'hover:bg-emerald-200 text-emerald-700']"
          >
            €
          </button>
        </Tooltip>
        <Tooltip :text="excluded ? 'Inclure cette section dans les exports' : 'Exclure cette section des exports'">
          <button
            type="button"
            @click.stop="emit('toggle-include', node)"
            :class="['p-0.5 rounded', excluded ? 'hover:bg-emerald-200 text-emerald-600' : 'hover:bg-amber-200 text-amber-600']"
          >
            <EyeIcon v-if="excluded" class="w-3 h-3" />
            <EyeSlashIcon v-else class="w-3 h-3" />
          </button>
        </Tooltip>
        <Tooltip text="Remonter d'un cran (↑)">
          <button
            type="button"
            @click.stop="emit('move-up', node)"
            class="p-0.5 rounded hover:bg-gray-200 text-gray-500"
          >
            <ArrowUpIcon class="w-3 h-3" />
          </button>
        </Tooltip>
        <Tooltip text="Descendre d'un cran (↓)">
          <button
            type="button"
            @click.stop="emit('move-down', node)"
            class="p-0.5 rounded hover:bg-gray-200 text-gray-500"
          >
            <ArrowDownIcon class="w-3 h-3" />
          </button>
        </Tooltip>
        <Tooltip text="Sortir d'un niveau (← outdent)">
          <button
            type="button"
            @click.stop="emit('outdent', node)"
            class="p-0.5 rounded hover:bg-gray-200 text-gray-500"
          >
            <ArrowLeftIcon class="w-3 h-3" />
          </button>
        </Tooltip>
        <Tooltip text="Indenter dans le précédent (→ indent)">
          <button
            type="button"
            @click.stop="emit('indent', node)"
            class="p-0.5 rounded hover:bg-gray-200 text-gray-500"
          >
            <ArrowRightIcon class="w-3 h-3" />
          </button>
        </Tooltip>
        <Tooltip text="Ajouter une sous-section">
          <button
            type="button"
            @click.stop="emit('add-child', node)"
            class="p-0.5 rounded hover:bg-indigo-200 text-indigo-600"
          >
            <PlusIcon class="w-3 h-3" />
          </button>
        </Tooltip>
        <Tooltip
          v-if="isAdHoc"
          text="Promouvoir cette section dans la bibliothèque (création d'un section type)"
        >
          <button
            type="button"
            @click.stop="emit('promote-to-library', node)"
            class="p-0.5 rounded hover:bg-violet-200 text-violet-600"
          >
            <ArrowUpOnSquareIcon class="w-3 h-3" />
          </button>
        </Tooltip>
        <Tooltip text="Supprimer cette section (et ses enfants)">
          <button
            type="button"
            @click.stop="emit('delete', node)"
            class="p-0.5 rounded hover:bg-red-200 text-red-500"
          >
            <TrashIcon class="w-3 h-3" />
          </button>
        </Tooltip>
      </span>
      <!-- Badge permanent : section ad-hoc (sans pendant biblio). -->
      <Tooltip v-if="isAdHoc" text="Spécifique à cette AF — sans pendant dans la bibliothèque">
        <span class="shrink-0 px-1 py-0 text-[9px] font-medium bg-violet-100 text-violet-700 rounded uppercase tracking-wide">AF</span>
      </Tooltip>
      <!-- Indicateur permanent si section demandee, en option payante,
           ecartee, ou exclue. Lot 92 : pastille € verte pour optin_paid_option. -->
      <Tooltip v-if="optinPaid" text="Option payante ajoutée au contrat (sans changement de niveau d'offre)">
        <span class="shrink-0 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-emerald-600 text-white text-[9px] font-bold leading-none">€</span>
      </Tooltip>
      <Tooltip v-else-if="demanded" text="Fonction exigée par la MOA — à inclure dans l'avenant contractuel">
        <span class="shrink-0 text-emerald-700">
          <CheckBadgeIcon class="w-3 h-3" />
        </span>
      </Tooltip>
      <Tooltip v-else-if="optedOut" text="Écartée par la MOA — visible dans le PDF avec encart">
        <span class="shrink-0 text-amber-700">
          <NoSymbolIcon class="w-3 h-3" />
        </span>
      </Tooltip>
      <Tooltip v-else-if="excluded" text="Exclue des exports">
        <span class="shrink-0 text-amber-600">
          <EyeSlashIcon class="w-3 h-3" />
        </span>
      </Tooltip>
    </button>

    <!-- Conteneur enfants : rendu meme sans enfants (tant que la section
         n'est pas collapsed) pour permettre le drag-drop "ranger ici" dans
         une section vide. La min-height (cf. style scoped) assure une zone
         droppable de quelques pixels en absence d'enfants. -->
    <div v-if="!isCollapsed"
         ref="childrenContainerRef"
         :class="['section-tree-children', !hasChildren && 'section-tree-empty-dropzone']">
      <SectionTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :level="level + 1"
        :selected-id="selectedId"
        :collapsed="collapsed"
        :kind-icon="kindIcon"
        :is-empty="isEmpty"
        :search="search"
        @select="emit('select', $event)"
        @toggle="emit('toggle', $event)"
        @add-child="emit('add-child', $event)"
        @delete="emit('delete', $event)"
        @toggle-include="emit('toggle-include', $event)"
        @toggle-opt-out="emit('toggle-opt-out', $event)"
        @toggle-demanded="emit('toggle-demanded', $event)"
        @toggle-optin-paid-option="emit('toggle-optin-paid-option', $event)"
        @move-up="emit('move-up', $event)"
        @move-down="emit('move-down', $event)"
        @indent="emit('indent', $event)"
        @outdent="emit('outdent', $event)"
        @reorder-children="emit('reorder-children', $event)"
        @attachment-drop="emit('attachment-drop', $event)"
        @promote-to-library="emit('promote-to-library', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
/* Drag-drop : ghost = barre horizontale verte indiquant la position de
   drop. Element dragge legerement transparent avec ombre. */
:deep(.section-tree-ghost) {
  position: relative;
  opacity: 0.4;
}
:deep(.section-tree-ghost) > button {
  background: #d1fae5;
  outline: 2px dashed #10b981;
  outline-offset: -2px;
  height: 4px !important;
  padding: 0 !important;
  overflow: hidden;
}
:deep(.section-tree-ghost) > button > * { display: none !important; }
:deep(.section-tree-chosen) {
  background: rgba(16, 185, 129, 0.05);
}
:deep(.section-tree-dragging) {
  opacity: 0.95;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  background: white;
  border-radius: 6px;
}
/* Zone de drop pour une section deplie sans enfants : 6px de hauteur
   minimale pour permettre au user de relacher l'element dedans. */
.section-tree-empty-dropzone {
  min-height: 6px;
}
</style>
