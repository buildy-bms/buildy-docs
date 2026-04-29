<script setup>
import { computed, watch, onUnmounted } from 'vue'
import BaseModal from './BaseModal.vue'
import { useConfirm } from '@/composables/useConfirm'

const { state, resolve } = useConfirm()

const visible = computed(() => state.value !== null)

function onEnter(e) {
  if (!visible.value) return
  if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault()
    resolve(true)
  }
}

watch(visible, (v) => {
  if (v) document.addEventListener('keydown', onEnter)
  else document.removeEventListener('keydown', onEnter)
})

onUnmounted(() => document.removeEventListener('keydown', onEnter))
</script>

<template>
  <BaseModal v-if="visible" :title="state.title" size="sm" @close="resolve(false)">
    <p class="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{{ state.message }}</p>
    <template #footer>
      <button
        @click="resolve(false)"
        class="px-4 py-2 text-sm rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
      >{{ state.cancelLabel }}</button>
      <button
        @click="resolve(true)"
        :class="[
          'px-4 py-2 text-sm rounded-lg text-white transition-colors',
          state.danger
            ? 'bg-red-600 hover:bg-red-700'
            : 'bg-indigo-600 hover:bg-indigo-700',
        ]"
        autofocus
      >{{ state.confirmLabel }}</button>
    </template>
  </BaseModal>
</template>
