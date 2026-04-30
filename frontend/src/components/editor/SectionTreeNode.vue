<script setup>
import { computed, ref, watch, nextTick, inject } from 'vue'
import { ChevronRightIcon, ChevronDownIcon, PlusIcon, TrashIcon, EyeIcon, EyeSlashIcon, NoSymbolIcon, CheckCircleIcon } from '@heroicons/vue/24/outline'
import ServiceLevelBadge from '@/components/ServiceLevelBadge.vue'
import Tooltip from '@/components/Tooltip.vue'

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
const emit = defineEmits(['select', 'toggle', 'add-child', 'delete', 'toggle-include', 'toggle-opt-out', 'attachment-drop'])

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

const displayedNumber = computed(() =>
  (liveNumbering?.value && liveNumbering.value.get(props.node.id)) || props.node.number || ''
)

const excluded = computed(() => props.node.included_in_export === 0)
const optedOut = computed(() => props.node.opted_out_by_moa === 1)
// L'option "écartée par la MOA" n'a de sens que pour des sections dont le niveau requis est S ou P.
const canOptOut = computed(() => {
  const lvl = (props.node.service_level || '').toUpperCase()
  return lvl.includes('S') || lvl.includes('P')
})

const hasChildren = computed(() => Array.isArray(props.node.children) && props.node.children.length > 0)
const isCollapsed = computed(() => props.collapsed.has(props.node.id))
const isSelected = computed(() => props.selectedId === props.node.id)

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
  <div>
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

      <!-- Indicateurs de statut (gauche du titre) : niveau de service +
           état de vérification + section vide. À gauche pour scan rapide. -->
      <ServiceLevelBadge v-if="node.service_level" :level="node.service_level" />

      <Tooltip
        v-if="node.fact_check_status === 'verified'"
        text="Section vérifiée"
      >
        <CheckCircleIcon class="w-3.5 h-3.5 text-emerald-500 shrink-0" />
      </Tooltip>
      <Tooltip
        v-else
        text="À vérifier"
      >
        <CheckCircleIcon class="w-3.5 h-3.5 text-gray-300 shrink-0" />
      </Tooltip>

      <Tooltip v-if="empty && !excluded" text="Section vide — à rédiger" placement="top">
        <span class="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 block"></span>
      </Tooltip>

      <span :class="['flex-1 min-w-0 truncate text-[13px]', isSelected ? 'font-semibold text-indigo-900' : levelClasses, excluded ? 'line-through text-gray-400 italic' : '', optedOut ? 'line-through text-amber-700 italic' : '']" v-html="titleHtml"></span>

      <!-- Actions au survol : ecarter MOA + inclure/exclure + ajouter enfant + supprimer -->
      <span class="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0">
        <button
          v-if="canOptOut"
          type="button"
          @click.stop="emit('toggle-opt-out', node)"
          :class="['p-0.5 rounded', optedOut ? 'hover:bg-emerald-200 text-emerald-600' : 'hover:bg-amber-200 text-amber-600']"
          :title="optedOut ? 'Réactiver cette fonctionnalité' : 'Marquer comme écartée par la maîtrise d\'ouvrage (visible dans le PDF avec encart)'"
        >
          <NoSymbolIcon class="w-3 h-3" />
        </button>
        <button
          type="button"
          @click.stop="emit('toggle-include', node)"
          :class="['p-0.5 rounded', excluded ? 'hover:bg-emerald-200 text-emerald-600' : 'hover:bg-amber-200 text-amber-600']"
          :title="excluded ? 'Inclure cette section dans les exports' : 'Exclure cette section des exports'"
        >
          <EyeIcon v-if="excluded" class="w-3 h-3" />
          <EyeSlashIcon v-else class="w-3 h-3" />
        </button>
        <button
          type="button"
          @click.stop="emit('add-child', node)"
          class="p-0.5 rounded hover:bg-indigo-200 text-indigo-600"
          title="Ajouter une sous-section"
        >
          <PlusIcon class="w-3 h-3" />
        </button>
        <button
          type="button"
          @click.stop="emit('delete', node)"
          class="p-0.5 rounded hover:bg-red-200 text-red-500"
          title="Supprimer cette section (et ses enfants)"
        >
          <TrashIcon class="w-3 h-3" />
        </button>
      </span>
      <!-- Indicateur permanent si section exclue ou ecartee -->
      <span v-if="optedOut" class="shrink-0 text-amber-700" title="Écartée par la MOA — visible dans le PDF avec encart">
        <NoSymbolIcon class="w-3 h-3" />
      </span>
      <span v-else-if="excluded" class="shrink-0 text-amber-600" title="Exclue des exports">
        <EyeSlashIcon class="w-3 h-3" />
      </span>
    </button>

    <div v-if="hasChildren && !isCollapsed">
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
        @attachment-drop="emit('attachment-drop', $event)"
      />
    </div>
  </div>
</template>
