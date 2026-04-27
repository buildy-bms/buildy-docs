<script setup>
import { computed, ref } from 'vue'
import { CheckBadgeIcon, ClipboardDocumentCheckIcon, ArrowLeftIcon } from '@heroicons/vue/24/outline'
import { updateAf } from '@/api'
import { useNotification } from '@/composables/useNotification'
import StatusBadge from './StatusBadge.vue'
import ServiceLevelBadge from './ServiceLevelBadge.vue'

const props = defineProps({
  af: { type: Object, required: true },
})
const emit = defineEmits(['updated', 'back'])

const { success, error } = useNotification()
const submitting = ref(false)

const canDeliver = computed(() => ['setup', 'chantier'].includes(props.af.status))
const canInspect = computed(() => ['livree', 'revision'].includes(props.af.status))

async function markDelivered() {
  if (!confirm(`Marquer "${props.af.client_name} — ${props.af.project_name}" comme LIVRÉE ?\nUn snapshot sera figé pour les futures comparaisons d'inspection.`)) return
  submitting.value = true
  try {
    const { data } = await updateAf(props.af.id, { status: 'livree' })
    success('AF marquée comme livrée')
    emit('updated', data)
  } catch (e) {
    error('Échec de la mise à jour')
  } finally {
    submitting.value = false
  }
}

function prepareInspection() {
  alert('Préparation d\'inspection BACS — disponible au Lot 7b (génère un PDF horodaté + tag Git d\'inspection).')
}
</script>

<template>
  <div class="bg-white rounded-none border border-gray-200 px-5 py-3 flex items-center gap-3 mb-4">
    <button @click="emit('back')" class="p-1 -ml-1 text-gray-500 hover:text-gray-800">
      <ArrowLeftIcon class="w-4 h-4" />
    </button>
    <div class="min-w-0 flex-1">
      <h2 class="text-sm font-semibold text-gray-800 truncate">
        {{ af.client_name }} — {{ af.project_name }}
      </h2>
      <p v-if="af.site_address" class="text-xs text-gray-500 truncate">{{ af.site_address }}</p>
    </div>
    <ServiceLevelBadge :level="af.service_level" />
    <StatusBadge :status="af.status" />
    <div class="w-px h-6 bg-gray-200"></div>
    <button
      v-if="canDeliver"
      @click="markDelivered"
      :disabled="submitting"
      class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50"
    >
      <CheckBadgeIcon class="w-4 h-4" />
      Marquer comme livrée
    </button>
    <button
      v-if="canInspect"
      @click="prepareInspection"
      class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700"
    >
      <ClipboardDocumentCheckIcon class="w-4 h-4" />
      Préparer inspection BACS
    </button>
  </div>
</template>
