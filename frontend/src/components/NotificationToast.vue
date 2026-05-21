<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { useNotification } from '@/composables/useNotification'
import { XMarkIcon } from '@heroicons/vue/24/outline'

// Bandeaux de notification empiles en haut de l'ecran (full width).
// Convention Buildy partagee entre buildy-tools / buildy-docs / fleet-manager.
// Couleurs : success #00cd92, warning #f5c259, error #e95369, info #1b2842.
const { notifications, dismiss } = useNotification()

const STYLES = {
  success: { bg: '#00cd92', fg: '#ffffff' },
  warning: { bg: '#f5c259', fg: '#1b2842' },
  error: { bg: '#e95369', fg: '#ffffff' },
  info: { bg: '#1b2842', fg: '#ffffff' },
}
function styleFor(type) {
  return STYLES[type] || STYLES.info
}

// Publie la hauteur du bandeau dans --buildy-banner-h pour que les drawers /
// panneaux plein ecran (.banner-safe-top) se decalent dessous et ne se fassent
// pas masquer leur croix de fermeture. 0px quand aucune notification.
const bannerEl = ref(null)
let ro = null
function publishHeight() {
  const h = bannerEl.value ? bannerEl.value.offsetHeight : 0
  document.documentElement.style.setProperty('--buildy-banner-h', `${h}px`)
}
onMounted(() => {
  ro = new ResizeObserver(publishHeight)
  if (bannerEl.value) ro.observe(bannerEl.value)
  publishHeight()
})
onUnmounted(() => {
  if (ro) ro.disconnect()
  document.documentElement.style.setProperty('--buildy-banner-h', '0px')
})
</script>

<template>
  <div ref="bannerEl" class="fixed top-0 inset-x-0 z-200 pointer-events-none flex flex-col">
    <TransitionGroup name="banner">
      <div
        v-for="n in notifications"
        :key="n.id"
        class="pointer-events-auto w-full px-4 py-2.5 shadow-md flex items-center gap-3"
        :style="{ background: styleFor(n.type).bg, color: styleFor(n.type).fg }"
        role="alert"
        aria-live="assertive"
      >
        <span class="flex-1 text-sm font-medium text-center">{{ n.message }}</span>
        <button
          @click="dismiss(n.id)"
          class="opacity-70 hover:opacity-100 shrink-0"
          title="Fermer"
          :style="{ color: styleFor(n.type).fg }"
        >
          <XMarkIcon class="w-4 h-4" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.banner-enter-active,
.banner-leave-active {
  transition: all 0.25s ease;
}
.banner-enter-from {
  opacity: 0;
  transform: translateY(-100%);
}
.banner-leave-to {
  opacity: 0;
  transform: translateY(-100%);
}
</style>
