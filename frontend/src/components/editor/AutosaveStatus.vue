<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { CheckCircleIcon, CloudArrowUpIcon, ExclamationTriangleIcon, ClockIcon } from '@heroicons/vue/24/outline'

const props = defineProps({
  state: { type: String, default: 'idle' }, // 'idle' | 'pending' | 'saving' | 'saved' | 'error'
  lastSaved: { type: Date, default: null },
  error: { type: Object, default: null },
})

// Reactive "il y a Xs" qui se rafraîchit toutes les secondes
const now = ref(Date.now())
let timer = null
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 1000) })
onUnmounted(() => { if (timer) clearInterval(timer) })

const relativeSaved = computed(() => {
  if (!props.lastSaved) return null
  const diffSec = Math.max(0, Math.floor((now.value - props.lastSaved.getTime()) / 1000))
  if (diffSec < 5) return 'à l\'instant'
  if (diffSec < 60) return `il y a ${diffSec}s`
  const min = Math.floor(diffSec / 60)
  if (min < 60) return `il y a ${min} min`
  const h = Math.floor(min / 60)
  return `il y a ${h}h`
})
</script>

<template>
  <div class="inline-flex items-center gap-1.5 text-xs">
    <template v-if="state === 'saving'">
      <CloudArrowUpIcon class="w-3.5 h-3.5 text-indigo-500 animate-pulse" />
      <span class="text-indigo-600">Enregistrement…</span>
    </template>
    <template v-else-if="state === 'pending'">
      <ClockIcon class="w-3.5 h-3.5 text-amber-500" />
      <span class="text-amber-600">Modifications en attente</span>
    </template>
    <template v-else-if="state === 'error'">
      <ExclamationTriangleIcon class="w-3.5 h-3.5 text-red-500" />
      <span class="text-red-600" :title="error?.message">Échec — réessaie</span>
    </template>
    <template v-else-if="lastSaved">
      <CheckCircleIcon class="w-3.5 h-3.5 text-emerald-500" />
      <span class="text-gray-500">Enregistré {{ relativeSaved }}</span>
    </template>
    <template v-else>
      <span class="text-gray-400">—</span>
    </template>
  </div>
</template>
