<script setup>
import { onMounted, onUnmounted } from 'vue'
import { XMarkIcon } from '@heroicons/vue/24/outline'

const props = defineProps({
  title: { type: String, required: true },
  size: { type: String, default: 'md' }, // 'sm' | 'md' | 'lg'
})

const emit = defineEmits(['close'])

const sizeClass = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
}[props.size] || 'max-w-md'

function onEsc(e) { if (e.key === 'Escape') emit('close') }
onMounted(() => document.addEventListener('keydown', onEsc))
onUnmounted(() => document.removeEventListener('keydown', onEsc))
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-40 bg-black/50 flex items-center justify-center px-4 py-6" @click.self="emit('close')">
      <div :class="['bg-white rounded-xl shadow-xl w-full flex flex-col max-h-[92vh] overflow-hidden', sizeClass]">
        <div class="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100 shrink-0">
          <h2 class="text-base font-semibold text-gray-800">{{ title }}</h2>
          <button @click="emit('close')" class="text-gray-400 hover:text-gray-700 p-1 -mr-1">
            <XMarkIcon class="w-5 h-5" />
          </button>
        </div>
        <div class="px-7 py-6 overflow-y-auto flex-1 min-h-0">
          <slot />
        </div>
        <div v-if="$slots.footer" class="px-6 py-4 bg-gray-50 flex items-center justify-end gap-2 shrink-0 border-t border-gray-100">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
