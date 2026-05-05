<script setup>
import { onBeforeUnmount, watch } from 'vue'
import { XMarkIcon } from '@heroicons/vue/24/outline'

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
        <!-- Header style iOS-natif : Annuler texte + Titre + Enregistrer texte bold -->
        <header
          class="shrink-0 bg-white border-b border-gray-200"
          :style="{ paddingTop: 'env(safe-area-inset-top)' }"
        >
          <div class="flex items-center gap-2 h-14 px-3">
            <button
              @click="emit('close')"
              class="tap-target inline-flex items-center justify-center text-base text-gray-600 -ml-1"
              aria-label="Fermer"
            >
              <XMarkIcon class="w-7 h-7" />
            </button>
            <h2 class="flex-1 min-w-0 text-center text-base font-medium truncate text-gray-900">{{ title }}</h2>
            <button
              v-if="!hideSave"
              @click="emit('save')"
              :disabled="saving"
              class="tap-target inline-flex items-center justify-center px-2 text-base font-medium text-indigo-600 disabled:opacity-50 -mr-1"
            >
              {{ saving ? 'Sauv.…' : saveLabel }}
            </button>
            <span v-else class="w-7"></span>
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
