<script setup>
/**
 * Bandeau « Nouvelle version disponible · Recharger » — fixe en haut de
 * l'app, sur toute la largeur. Pattern et couleur alignes sur Buildy Tools
 * (cf. buildy-tools/frontend/src/components/VersionBanner.vue). On
 * utilise la couleur indigo NATIVE Tailwind (#4f46e5) en hex explicite
 * car Docs remappe `indigo-600` -> navy `#1b2842` dans son theme @layer.
 */
import { ArrowPathIcon } from '@heroicons/vue/24/outline'
import { ref } from 'vue'
import { useVersionCheck } from '@/composables/useVersionCheck'

const { updateAvailable, newVersion, newBuildSha, reload } = useVersionCheck()
const reloading = ref(false)

async function onReload() {
  reloading.value = true
  await reload()
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="updateAvailable"
      class="fixed top-0 inset-x-0 z-150 bg-[#4f46e5] text-white text-sm shadow-md"
    >
      <div class="px-4 py-2 flex items-center gap-3">
        <ArrowPathIcon class="w-4 h-4 shrink-0" />
        <span class="flex-1">
          Une nouvelle version de Buildy Docs<span v-if="newVersion"> (v{{ newVersion }}<span v-if="newBuildSha"> · {{ newBuildSha }}</span>)</span>
          est disponible. Rechargez pour éviter les erreurs.
        </span>
        <button
          type="button"
          @click="onReload"
          :disabled="reloading"
          class="px-3 py-1 bg-white text-[#4f46e5] rounded font-medium hover:bg-indigo-50 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          <ArrowPathIcon :class="['w-4 h-4', reloading ? 'animate-spin' : '']" />
          {{ reloading ? 'Rechargement…' : 'Recharger' }}
        </button>
      </div>
    </div>
  </Teleport>
</template>
