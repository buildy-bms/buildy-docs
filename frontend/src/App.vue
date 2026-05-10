<script setup>
import { computed, provide } from 'vue'
import { useRoute } from 'vue-router'
import { authReady } from './router'
import AppLayout from './components/AppLayout.vue'
import NotificationToast from './components/NotificationToast.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import InstallBanner from './components/InstallBanner.vue'
import VersionUpdateBanner from './components/VersionUpdateBanner.vue'
import { useViewport } from './composables/useViewport'
import { useOfflineQueue } from './composables/useOfflineQueue'

const route = useRoute()
const { isNarrow } = useViewport()

// Queue offline globale : drain auto au retour en ligne / focus, le
// compteur est mis à disposition des vues via injection (badge dans
// la topbar mobile / desktop pour signaler les modifs en attente).
const offlineQueue = useOfflineQueue()
provide('offlineQueue', offlineQueue)

// Skip AppLayout pour les routes publiques (login) ET pour les routes
// qui ont meta.fullscreenMobile=true en mode mobile (vue audit native).
// Sinon le mobile header navy d'AppLayout chevauche la vue plein-écran.
const skipAppLayout = computed(() =>
  route.meta.public || (isNarrow.value && route.meta.fullscreenMobile)
)
</script>

<template>
  <template v-if="authReady">
    <NotificationToast />
    <ConfirmDialog />
    <InstallBanner />
    <VersionUpdateBanner />
    <template v-if="skipAppLayout">
      <router-view />
    </template>
    <AppLayout v-else>
      <router-view />
    </AppLayout>
  </template>
</template>
