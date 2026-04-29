<script setup>
/**
 * Nœud récursif de l'arbre des sections types (Library).
 * Affiche un nœud + ses enfants (qui sont eux-mêmes des LibrarySectionNode).
 *
 * Le drag-and-drop est géré côté view (LibrarySectionsView) avec sortablejs
 * appliqué à chaque <ul class="children"> et un group commun pour autoriser
 * le re-parenting cross-niveau.
 */
import { computed } from 'vue'
import {
  RectangleStackIcon, GlobeAltIcon, ChartBarSquareIcon, DocumentTextIcon,
  Squares2X2Icon, SparklesIcon, ChevronRightIcon, ChevronDownIcon,
  Bars3Icon, PencilIcon, BookmarkIcon,
} from '@heroicons/vue/24/outline'
import ServiceLevelBadge from './ServiceLevelBadge.vue'
import BacsBadge from './BacsBadge.vue'

defineOptions({ name: 'LibrarySectionNode' })

const props = defineProps({
  node: { type: Object, required: true },
  level: { type: Number, default: 0 },
  collapsed: { type: Set, required: true },
  // Numerotation calculee par la vue parent (Map<id, '1.2.3'>).
  numbering: { type: Map, default: () => new Map() },
})
const emit = defineEmits(['edit', 'toggle'])

const KIND_ICON = {
  standard: DocumentTextIcon,
  equipment: RectangleStackIcon,
  zones: Squares2X2Icon,
  synthesis: ChartBarSquareIcon,
  hyperveez_page: GlobeAltIcon,
}

const Icon = computed(() => KIND_ICON[props.node.kind] || DocumentTextIcon)
const hasChildren = computed(() => Array.isArray(props.node.children) && props.node.children.length > 0)
const isCollapsed = computed(() => props.collapsed.has(props.node.id))
const indentStyle = computed(() => ({ paddingLeft: `${0.5 + props.level * 1}rem` }))
const computedNumber = computed(() => props.numbering.get(props.node.id) || '')
const isFunctionality = computed(() => props.node.is_functionality === 1)
</script>

<template>
  <li :data-id="node.id" class="select-none">
    <div :style="indentStyle"
         class="flex items-center gap-2 px-2 py-1.5 hover:bg-indigo-50/40 group cursor-pointer border-b border-gray-50"
         @click="emit('edit', node)">
      <span class="drag-handle cursor-grab text-gray-300 hover:text-gray-500" @click.stop>
        <Bars3Icon class="w-4 h-4" />
      </span>

      <button v-if="hasChildren" type="button" @click.stop="emit('toggle', node.id)"
              class="text-gray-500 hover:text-gray-700">
        <ChevronRightIcon v-if="isCollapsed" class="w-3.5 h-3.5" />
        <ChevronDownIcon v-else class="w-3.5 h-3.5" />
      </button>
      <span v-else class="w-3.5 h-3.5 shrink-0"></span>

      <component :is="Icon" :class="['w-4 h-4 shrink-0', isFunctionality ? 'text-violet-500' : 'text-gray-400']" />

      <span v-if="computedNumber" class="text-[11px] font-mono text-gray-400 shrink-0 w-10">{{ computedNumber }}</span>

      <span class="flex-1 min-w-0 truncate text-sm text-gray-800">{{ node.title }}</span>

      <SparklesIcon v-if="isFunctionality" class="w-3.5 h-3.5 text-violet-400 shrink-0"
                    title="Marquée comme fonctionnalité" />
      <ServiceLevelBadge v-if="node.service_level" :level="node.service_level" />
      <BacsBadge v-if="node.bacs_articles" :reference="node.bacs_articles" />

      <span
        v-if="node.affected_afs_count > 0"
        class="text-[11px] text-gray-500 tabular-nums shrink-0 inline-flex items-center gap-0.5"
        :title="`Utilisée dans ${node.affected_afs_count} AF${node.affected_afs_count > 1 ? 's' : ''}` + (node.outdated_count > 0 ? ` — ${node.outdated_count} avec maj en attente` : '')"
      >
        <BookmarkIcon class="w-3 h-3" />
        {{ node.affected_afs_count }}
        <span v-if="node.outdated_count > 0" class="text-amber-600">↻{{ node.outdated_count }}</span>
      </span>
      <span v-else class="text-[11px] text-gray-300 italic shrink-0" title="Jamais utilisée — candidate au nettoyage">
        ∅ inutilisée
      </span>

      <PencilIcon class="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-600 shrink-0" />
    </div>

    <!-- Enfants : liste sortable, drop-zone par parent. data-parent permet a la
         view de retrouver le parent_template_id au drop. -->
    <ul v-show="!isCollapsed" :data-parent="node.id" class="children sortable-list">
      <LibrarySectionNode v-for="child in node.children"
                          :key="child.id"
                          :node="child"
                          :level="level + 1"
                          :collapsed="collapsed"
                          :numbering="numbering"
                          @edit="emit('edit', $event)"
                          @toggle="emit('toggle', $event)" />
    </ul>
  </li>
</template>
