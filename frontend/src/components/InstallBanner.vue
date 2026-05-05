<script setup>
import { ref, onMounted } from 'vue'
import { XMarkIcon, ArrowUpOnSquareIcon, PlusCircleIcon } from '@heroicons/vue/24/outline'

/**
 * Bannière "Ajouter à l'écran d'accueil" pour iPhone / iPad Safari.
 *
 * Conditions d'affichage :
 * - Mode mobile (largeur < 1024px)
 * - iOS Safari (pas Chrome iOS / Firefox iOS qui n'ont pas le bouton de partage)
 * - Pas déjà en mode standalone (déjà installé)
 * - Pas dismissé récemment (durée mémorisée en localStorage)
 *
 * Sur Android Chrome, on capture beforeinstallprompt et on propose un bouton
 * d'installation 1-clic (vrai prompt natif).
 */

const STORAGE_KEY = 'buildy-docs.install-banner.dismissed'
const DISMISS_DAYS = 30

const visible = ref(false)
const platform = ref('ios') // 'ios' | 'android'
const deferredPrompt = ref(null)

function shouldShow() {
  if (typeof window === 'undefined') return false
  // Pas si on est déjà installé
  const inStandaloneIOS = window.navigator.standalone === true
  const inStandaloneAndroid = window.matchMedia('(display-mode: standalone)').matches
  if (inStandaloneIOS || inStandaloneAndroid) return false
  // Pas si dismissé récemment
  const dismissedAt = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10)
  if (dismissedAt && (Date.now() - dismissedAt) < DISMISS_DAYS * 86400_000) return false
  // Pas en desktop
  if (window.innerWidth >= 1024) return false
  return true
}

function isIOSSafari() {
  const ua = window.navigator.userAgent || ''
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  // Exclure Chrome iOS (CriOS), Firefox iOS (FxiOS), Edge iOS (EdgiOS)
  const isIOSWebKit = isIOS && !/CriOS|FxiOS|EdgiOS/.test(ua)
  return isIOSWebKit
}

function dismiss() {
  localStorage.setItem(STORAGE_KEY, Date.now().toString())
  visible.value = false
}

async function installAndroid() {
  if (!deferredPrompt.value) return
  deferredPrompt.value.prompt()
  try {
    await deferredPrompt.value.userChoice
  } finally {
    deferredPrompt.value = null
    visible.value = false
  }
}

onMounted(() => {
  if (!shouldShow()) return
  if (isIOSSafari()) {
    platform.value = 'ios'
    // Délai de 5s pour ne pas être intrusif au premier load
    setTimeout(() => { visible.value = true }, 5000)
    return
  }
  // Android : on attend l'event beforeinstallprompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt.value = e
    platform.value = 'android'
    visible.value = true
  })
})
</script>

<template>
  <transition name="slide-up">
    <div
      v-if="visible"
      class="fixed inset-x-0 z-40 px-3 lg:hidden"
      :style="{ bottom: 'calc(72px + env(safe-area-inset-bottom))' }"
    >
      <div class="bg-white border border-gray-200 rounded-2xl shadow-lg p-3 flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 inline-flex items-center justify-center shrink-0">
          <PlusCircleIcon class="w-6 h-6" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-900">Installer Buildy Audit</p>
          <p v-if="platform === 'ios'" class="text-xs text-gray-600 mt-0.5 leading-relaxed">
            Pour une vraie expérience plein-écran : tape
            <ArrowUpOnSquareIcon class="w-4 h-4 inline-block -mb-0.5 mx-0.5 text-blue-600" />
            puis « Sur l'écran d'accueil ».
          </p>
          <p v-else class="text-xs text-gray-600 mt-0.5">
            Lance plein-écran depuis ton home screen.
          </p>
          <button
            v-if="platform === 'android'"
            @click="installAndroid"
            class="mt-2 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-emerald-600 rounded-lg"
          >
            Installer
          </button>
        </div>
        <button
          @click="dismiss"
          class="tap-target inline-flex items-center justify-center text-gray-400 shrink-0 -m-2"
          aria-label="Fermer"
        >
          <XMarkIcon class="w-5 h-5" />
        </button>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 280ms ease-out, opacity 200ms;
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(120%);
  opacity: 0;
}
</style>
