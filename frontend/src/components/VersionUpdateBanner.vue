<script setup>
/**
 * Bandeau « Nouvelle version disponible · Recharger » — affiché sur le
 * dessus de l'app dès qu'un nouveau SHA git est détecté côté serveur.
 *
 * Visible desktop ET PWA. Pattern aligné sur Buildy Tools / Edge Fleet
 * Manager — l'utilisateur sait qu'il faut recharger pour voir le fix
 * qu'on vient de pousser, sans avoir à F5 manuellement.
 *
 * Mounted une seule fois dans App.vue (singleton).
 */
import { ArrowPathIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { ref } from 'vue'
import { useVersionCheck } from '@/composables/useVersionCheck'

const { updateAvailable, newVersion, newBuildSha, reload } = useVersionCheck()
const dismissed = ref(false)
const reloading = ref(false)

async function onReload() {
  reloading.value = true
  await reload()
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="updateAvailable && !dismissed"
      class="fixed inset-x-0 bottom-0 z-[200] px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 sm:bottom-3 sm:right-3 sm:left-auto sm:px-0 sm:pb-3 pointer-events-none"
    >
      <div class="pointer-events-auto bg-indigo-600 text-white rounded-2xl shadow-2xl px-4 py-3 sm:max-w-sm flex items-start gap-3">
        <span class="w-9 h-9 rounded-lg bg-white/15 inline-flex items-center justify-center shrink-0">
          <ArrowPathIcon class="w-5 h-5" />
        </span>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold leading-tight">Nouvelle version disponible</p>
          <p class="text-xs text-white/80 mt-0.5 leading-relaxed">
            Recharge pour profiter des dernières mises à jour.<span v-if="newVersion"> v{{ newVersion }}<span v-if="newBuildSha"> · {{ newBuildSha }}</span>.</span>
          </p>
          <div class="mt-2 flex items-center gap-2">
            <button
              type="button"
              @click="onReload"
              :disabled="reloading"
              class="inline-flex items-center gap-1.5 px-3 py-2 min-h-9 text-sm font-semibold bg-white text-indigo-700 rounded-lg active:bg-indigo-50 disabled:opacity-50"
            >
              <ArrowPathIcon :class="['w-4 h-4', reloading ? 'animate-spin' : '']" />
              {{ reloading ? 'Rechargement…' : 'Recharger' }}
            </button>
            <button
              type="button"
              @click="dismissed = true"
              class="px-3 py-2 min-h-9 text-sm text-white/80 active:text-white"
            >
              Plus tard
            </button>
          </div>
        </div>
        <button
          type="button"
          aria-label="Fermer"
          @click="dismissed = true"
          class="text-white/60 active:text-white p-1 -mr-1 -mt-1 shrink-0"
        >
          <XMarkIcon class="w-5 h-5" />
        </button>
      </div>
    </div>
  </Teleport>
</template>
