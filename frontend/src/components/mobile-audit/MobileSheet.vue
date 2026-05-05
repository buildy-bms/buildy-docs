<script setup>
import { onMounted, onBeforeUnmount, watch } from 'vue'
import { XMarkIcon, CheckIcon } from '@heroicons/vue/24/outline'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, required: true },
  saveLabel: { type: String, default: 'Enregistrer' },
  saving: { type: Boolean, default: false },
  hideSave: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'save'])

// Bloque le scroll du body quand le sheet est ouvert
watch(() => props.open, (v) => {
  if (typeof document === 'undefined') return
  document.body.style.overflow = v ? 'hidden' : ''
})
onBeforeUnmount(() => {
  if (typeof document !== 'undefined') document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <transition name="slide-up">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex flex-col bg-gray-50"
      >
        <!-- Header -->
        <header
          class="shrink-0 bg-white border-b border-gray-200"
          :style="{ paddingTop: 'env(safe-area-inset-top)' }"
        >
          <div class="flex items-center gap-2 h-12 px-2">
            <button
              @click="emit('close')"
              class="tap-target inline-flex items-center justify-center text-gray-600 hover:text-gray-900"
              aria-label="Fermer"
            >
              <XMarkIcon class="w-6 h-6" />
            </button>
            <h2 class="flex-1 min-w-0 text-base font-medium truncate text-gray-900">{{ title }}</h2>
            <button
              v-if="!hideSave"
              @click="emit('save')"
              :disabled="saving"
              class="tap-target inline-flex items-center justify-center gap-1 px-3 text-sm font-medium text-white bg-indigo-600 rounded-lg disabled:opacity-50"
            >
              <CheckIcon class="w-4 h-4" />
              {{ saving ? '…' : saveLabel }}
            </button>
          </div>
        </header>

        <!-- Content scrollable -->
        <div
          class="flex-1 overflow-y-auto overscroll-contain"
          :style="{ paddingBottom: 'env(safe-area-inset-bottom)' }"
        >
          <slot />
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 220ms ease-out;
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
}
</style>
