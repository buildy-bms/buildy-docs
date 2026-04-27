<script setup>
import { useNotification } from '@/composables/useNotification'
const { notifications } = useNotification()
</script>

<template>
  <div class="fixed top-4 right-4 z-50 space-y-2">
    <TransitionGroup name="toast">
      <div
        v-for="n in notifications"
        :key="n.id"
        :class="[
          'px-4 py-3 rounded-lg shadow-lg text-sm font-medium max-w-sm',
          n.type === 'success' ? 'bg-emerald-600 text-white' : '',
          n.type === 'error' ? 'bg-red-600 text-white' : '',
          n.type === 'info' ? 'bg-blue-600 text-white' : '',
        ]"
      >
        {{ n.message }}
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active { transition: all 0.3s ease; }
.toast-leave-active { transition: all 0.2s ease; }
.toast-enter-from { opacity: 0; transform: translateX(30px); }
.toast-leave-to { opacity: 0; transform: translateX(30px); }
</style>
