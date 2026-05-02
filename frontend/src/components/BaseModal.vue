<script setup>
import { onMounted, onUnmounted, ref, computed } from 'vue'
import { XMarkIcon } from '@heroicons/vue/24/outline'
import { useFocusTrap } from '@/composables/useFocusTrap'

const props = defineProps({
  title: { type: String, required: true },
  size: { type: String, default: 'md' }, // 'sm' | 'md' | 'lg' | 'xl'
})

const emit = defineEmits(['close'])

const sizeClass = {
  sm: 'min-w-[18rem] max-w-[28rem]',
  md: 'min-w-[24rem] max-w-[36rem]',
  lg: 'min-w-[28rem] max-w-[48rem]',
  xl: 'min-w-[36rem] max-w-[64rem]',
}[props.size] || 'min-w-[24rem] max-w-[36rem]'

const dialogRef = ref(null)
const titleId = computed(() => `modal-title-${Math.random().toString(36).slice(2, 9)}`)
useFocusTrap(dialogRef)

function onEsc(e) { if (e.key === 'Escape') emit('close') }
onMounted(() => document.addEventListener('keydown', onEsc))
onUnmounted(() => document.removeEventListener('keydown', onEsc))
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-40 bg-black/50 flex items-center justify-center px-4 py-6" @click.self="emit('close')">
      <div ref="dialogRef"
           role="dialog" aria-modal="true" :aria-labelledby="titleId"
           tabindex="-1"
           :class="['bg-white rounded-xl shadow-xl w-fit max-w-[92vw] flex flex-col max-h-[92vh] overflow-hidden focus:outline-none', sizeClass]">
        <div class="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100 shrink-0">
          <h2 :id="titleId" class="text-base font-semibold text-gray-800">{{ title }}</h2>
          <button @click="emit('close')" aria-label="Fermer la fenêtre"
                  class="text-gray-400 hover:text-gray-700 p-1 -mr-1">
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
