<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { CheckCircleIcon, CloudArrowUpIcon, ExclamationTriangleIcon, ClockIcon, ArrowPathIcon } from '@heroicons/vue/24/outline'

const props = defineProps({
  state: { type: String, default: 'idle' }, // 'idle' | 'pending' | 'saving' | 'saved' | 'error'
  lastSaved: { type: Date, default: null },
  error: { type: Object, default: null },
  attempt: { type: Number, default: 0 },
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

// Heure absolue de la dernière sauvegarde validée — affichée en tooltip
// quand l'autosave est en erreur, pour que l'utilisateur sache combien
// de travail risque d'être perdu.
const absoluteSaved = computed(() => {
  if (!props.lastSaved) return null
  return props.lastSaved.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
})
</script>

<template>
  <div class="inline-flex items-center gap-1.5 text-xs">
    <template v-if="state === 'saving'">
      <CloudArrowUpIcon class="w-3.5 h-3.5 text-indigo-500 animate-pulse" />
      <span class="text-indigo-600">
        {{ attempt > 0 ? `Nouvelle tentative (${attempt})…` : 'Enregistrement…' }}
      </span>
    </template>
    <template v-else-if="state === 'pending'">
      <ClockIcon class="w-3.5 h-3.5 text-amber-500" />
      <span class="text-amber-600">Modifications en attente</span>
    </template>
    <template v-else-if="state === 'error'">
      <ExclamationTriangleIcon class="w-3.5 h-3.5 text-red-500" />
      <span class="text-red-600 font-medium" :title="error?.message">
        Sauvegarde impossible
        <span v-if="absoluteSaved" class="font-normal">— dernière validée {{ absoluteSaved }}</span>
      </span>
      <ArrowPathIcon v-if="attempt > 0" class="w-3 h-3 text-red-400 animate-spin" />
    </template>
    <template v-else-if="lastSaved">
      <CheckCircleIcon class="w-3.5 h-3.5 text-emerald-500" />
      <span class="text-gray-500" :title="absoluteSaved ? `Validée à ${absoluteSaved}` : ''">
        Enregistré {{ relativeSaved }}
      </span>
    </template>
    <template v-else>
      <span class="text-gray-400">—</span>
    </template>
  </div>
</template>
