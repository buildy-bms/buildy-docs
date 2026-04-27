<script setup>
import { useRoute } from 'vue-router'
import { authReady } from './router'
import AppLayout from './components/AppLayout.vue'
import NotificationToast from './components/NotificationToast.vue'

const route = useRoute()
</script>

<template>
  <template v-if="authReady">
    <NotificationToast />
    <template v-if="route.meta.public">
      <router-view />
    </template>
    <AppLayout v-else>
      <router-view />
    </AppLayout>
  </template>
</template>
