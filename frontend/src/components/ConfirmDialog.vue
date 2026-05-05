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
    <p class="text-base sm:text-sm text-gray-700 whitespace-pre-line leading-relaxed">{{ state.message }}</p>
    <template #footer>
      <!-- Mobile : 2 boutons en grid full-width pour cible tactile large.
           Desktop : layout compact aligné à droite (default flex du footer). -->
      <div class="grid grid-cols-2 gap-2 w-full sm:flex sm:w-auto sm:gap-2">
        <button
          @click="resolve(false)"
          class="order-1 px-4 py-3 sm:py-2 text-base sm:text-sm font-medium rounded-lg text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors min-h-11 sm:min-h-0"
        >{{ state.cancelLabel }}</button>
        <button
          @click="resolve(true)"
          :class="[
            'order-2 px-4 py-3 sm:py-2 text-base sm:text-sm font-medium rounded-lg text-white transition-colors min-h-11 sm:min-h-0',
            state.danger
              ? 'bg-red-600 hover:bg-red-700'
              : 'bg-indigo-600 hover:bg-indigo-700',
          ]"
          autofocus
        >{{ state.confirmLabel }}</button>
      </div>
    </template>
  </BaseModal>
</template>
