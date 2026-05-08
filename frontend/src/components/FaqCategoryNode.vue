<script setup>
import { ref } from 'vue'
import {
  FolderIcon, FolderOpenIcon, EllipsisHorizontalIcon, ArrowUpOnSquareIcon,
  PencilSquareIcon, TrashIcon, PlusIcon,
} from '@heroicons/vue/24/outline'

defineProps({
  category: { type: Object, required: true },
  selected: { type: [Number, null], default: null },
})
const emit = defineEmits(['select', 'edit', 'push', 'delete', 'new-child'])

const expanded = ref(true)
const menuOpen = ref(false)

function onClickAway(e) {
  if (!e.target.closest('[data-faq-cat-menu]')) menuOpen.value = false
}
</script>

<template>
  <div>
    <div class="group flex items-center gap-1 hover:bg-gray-50 rounded">
      <button v-if="category.children?.length" @click="expanded = !expanded" class="p-0.5 shrink-0">
        <FolderOpenIcon v-if="expanded" class="w-3.5 h-3.5 text-gray-400" />
        <FolderIcon v-else class="w-3.5 h-3.5 text-gray-400" />
      </button>
      <span v-else class="w-4 shrink-0" />
      <button @click="emit('select', category.id)"
              :class="['flex-1 text-left px-2 py-1 text-sm transition rounded truncate',
                       selected === category.id ? 'text-indigo-700 font-medium' : 'text-gray-700']">
        {{ category.name }}
        <span v-if="category.dirty" class="w-1.5 h-1.5 rounded-full bg-orange-400 inline-block ml-1 align-middle" v-tooltip="'Modifiée localement'" />
      </button>
      <div class="relative opacity-0 group-hover:opacity-100 transition" data-faq-cat-menu>
        <button @click.stop="menuOpen = !menuOpen" class="p-1 hover:bg-gray-100 rounded shrink-0">
          <EllipsisHorizontalIcon class="w-4 h-4 text-gray-400" />
        </button>
        <Teleport to="body">
          <div v-if="menuOpen" class="fixed inset-0 z-40" @click="menuOpen = false" />
        </Teleport>
        <div v-if="menuOpen"
             class="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg w-48 py-1">
          <button @click="emit('new-child', category.id); menuOpen = false"
                  class="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 inline-flex items-center gap-2 whitespace-nowrap">
            <PlusIcon class="w-3.5 h-3.5 shrink-0" /> Sous-catégorie
          </button>
          <button @click="emit('edit', category); menuOpen = false"
                  class="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 inline-flex items-center gap-2 whitespace-nowrap">
            <PencilSquareIcon class="w-3.5 h-3.5 shrink-0" /> Renommer
          </button>
          <button @click="emit('push', category); menuOpen = false"
                  class="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 inline-flex items-center gap-2 whitespace-nowrap">
            <ArrowUpOnSquareIcon class="w-3.5 h-3.5 shrink-0" /> Publier vers Crisp
          </button>
          <div class="border-t border-gray-100 my-1" />
          <button @click="emit('delete', category); menuOpen = false"
                  class="w-full text-left px-3 py-1.5 text-sm hover:bg-red-50 text-red-600 inline-flex items-center gap-2 whitespace-nowrap">
            <TrashIcon class="w-3.5 h-3.5 shrink-0" /> Supprimer
          </button>
        </div>
      </div>
    </div>
    <ul v-if="expanded && category.children?.length" class="ml-4 mt-0.5 space-y-0.5">
      <li v-for="child in category.children" :key="child.id">
        <FaqCategoryNode :category="child" :selected="selected"
                         @select="(id) => emit('select', id)"
                         @edit="(c) => emit('edit', c)"
                         @push="(c) => emit('push', c)"
                         @delete="(c) => emit('delete', c)"
                         @new-child="(id) => emit('new-child', id)" />
      </li>
    </ul>
  </div>
</template>
