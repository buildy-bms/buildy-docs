<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { authReady } from './router'
import AppLayout from './components/AppLayout.vue'
import NotificationToast from './components/NotificationToast.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import InstallBanner from './components/InstallBanner.vue'
import { useViewport } from './composables/useViewport'

const route = useRoute()
const { isNarrow } = useViewport()

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
    <template v-if="skipAppLayout">
      <router-view />
    </template>
    <AppLayout v-else>
      <router-view />
    </AppLayout>
  </template>
</template>
