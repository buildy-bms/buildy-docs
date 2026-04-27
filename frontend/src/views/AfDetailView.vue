<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeftIcon,
  MapPinIcon,
  UserCircleIcon,
  ClockIcon,
  DocumentTextIcon,
  RectangleStackIcon,
  GlobeAltIcon,
  ChartBarSquareIcon,
} from '@heroicons/vue/24/outline'
import { getAf, listSections } from '@/api'
import StatusBadge from '@/components/StatusBadge.vue'
import ServiceLevelBadge from '@/components/ServiceLevelBadge.vue'

const route = useRoute()
const router = useRouter()
const af = ref(null)
const sections = ref([])
const loading = ref(true)

const counts = computed(() => {
  const c = { standard: 0, equipment: 0, hyperveez_page: 0, synthesis: 0 }
  for (const s of sections.value) c[s.kind] = (c[s.kind] || 0) + 1
  return c
})

onMounted(async () => {
  try {
    const id = route.params.id
    const [a, s] = await Promise.all([getAf(id), listSections(id)])
    af.value = a.data
    sections.value = s.data
  } finally {
    loading.value = false
  }
})

function formatDate(s) {
  if (!s) return '—'
  return new Date(s.replace(' ', 'T')).toLocaleString('fr-FR')
}
</script>

<template>
  <div class="max-w-5xl mx-auto">
    <button @click="router.push('/')" class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
      <ArrowLeftIcon class="w-4 h-4" /> Retour aux AFs
    </button>

    <div v-if="loading" class="text-center py-12 text-gray-400 text-sm">Chargement...</div>

    <template v-else-if="af">
      <!-- Header -->
      <div class="flex items-start justify-between mb-6">
        <div class="min-w-0">
          <h1 class="text-2xl font-semibold text-gray-800 truncate">{{ af.client_name }}</h1>
          <p class="text-base text-gray-700 mt-1">{{ af.project_name }}</p>
          <div v-if="af.site_address" class="flex items-center gap-1.5 text-sm text-gray-500 mt-2">
            <MapPinIcon class="w-4 h-4" /> {{ af.site_address }}
          </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <ServiceLevelBadge :level="af.service_level" />
          <StatusBadge :status="af.status" />
        </div>
      </div>

      <!-- Meta -->
      <div class="flex items-center gap-4 text-xs text-gray-500 mb-6 pb-4 border-b border-gray-200">
        <span class="inline-flex items-center gap-1">
          <UserCircleIcon class="w-3.5 h-3.5" /> Créée par {{ af.created_by_name || 'Inconnu' }}
        </span>
        <span class="inline-flex items-center gap-1">
          <ClockIcon class="w-3.5 h-3.5" /> Modifiée le {{ formatDate(af.updated_at) }}
          {{ af.updated_by_name ? ` par ${af.updated_by_name}` : '' }}
        </span>
      </div>

      <!-- Sections summary cards -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <div class="bg-white rounded-xl border border-gray-200 p-4">
          <div class="flex items-center gap-2 text-xs text-gray-500"><DocumentTextIcon class="w-4 h-4" /> Sections texte</div>
          <p class="text-2xl font-semibold text-gray-800 mt-1">{{ counts.standard }}</p>
        </div>
        <div class="bg-white rounded-xl border border-gray-200 p-4">
          <div class="flex items-center gap-2 text-xs text-gray-500"><RectangleStackIcon class="w-4 h-4" /> Équipements</div>
          <p class="text-2xl font-semibold text-gray-800 mt-1">{{ counts.equipment }}</p>
        </div>
        <div class="bg-white rounded-xl border border-gray-200 p-4">
          <div class="flex items-center gap-2 text-xs text-gray-500"><GlobeAltIcon class="w-4 h-4" /> Pages Hyperveez</div>
          <p class="text-2xl font-semibold text-gray-800 mt-1">{{ counts.hyperveez_page }}</p>
        </div>
        <div class="bg-white rounded-xl border border-gray-200 p-4">
          <div class="flex items-center gap-2 text-xs text-gray-500"><ChartBarSquareIcon class="w-4 h-4" /> Synthèse</div>
          <p class="text-2xl font-semibold text-gray-800 mt-1">{{ counts.synthesis }}</p>
        </div>
      </div>

      <!-- Placeholder éditeur -->
      <div class="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <p class="text-sm text-gray-500 max-w-md mx-auto">
          L'éditeur de sections (arborescence + Tiptap + tableau de points résolus + instances)
          arrive au <strong>Lot 3</strong>. La structure des {{ af.sections_count }} sections seedées
          est déjà en place dans la base.
        </p>
      </div>
    </template>
  </div>
</template>
