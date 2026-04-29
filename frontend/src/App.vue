<script setup>
import { useRoute } from 'vue-router'
import { authReady } from './router'
import AppLayout from './components/AppLayout.vue'
import NotificationToast from './components/NotificationToast.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'

const route = useRoute()
</script>

<template>
  <template v-if="authReady">
    <NotificationToast />
    <ConfirmDialog />
    <template v-if="route.meta.public">
      <router-view />
    </template>
    <AppLayout v-else>
      <router-view />
    </AppLayout>
  </template>
</template>
