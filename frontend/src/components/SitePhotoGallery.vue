<script setup>
/**
 * Galerie des photos d'un site — grille chronologique avec lightbox.
 * Exploite les métadonnées EXIF stockées (date de prise de vue, GPS,
 * appareil). Les photos sont les `site_documents` de catégorie `photo`.
 */
import { ref, computed, onMounted } from 'vue'
import { CameraIcon, MapPinIcon } from '@heroicons/vue/24/outline'
import ImageLightbox from './ImageLightbox.vue'
import { listSiteDocuments, getSiteDocumentDownloadUrl } from '@/api'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({ uuid: { type: String, required: true } })
const { error: notifyError } = useNotification()

const photos = ref([])
const loading = ref(true)
const lightboxIndex = ref(null)

async function load() {
  loading.value = true
  try {
    const { data } = await listSiteDocuments(props.uuid, { category: 'photo' })
    photos.value = data
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Chargement des photos impossible')
  } finally {
    loading.value = false
  }
}
onMounted(load)

// Tri chronologique : date de prise de vue (EXIF) sinon date d'import.
const sorted = computed(() =>
  [...photos.value].sort((a, b) => {
    const da = a.taken_at || a.uploaded_at || ''
    const db = b.taken_at || b.uploaded_at || ''
    return db.localeCompare(da)
  }),
)

const lightboxImages = computed(() =>
  sorted.value.map(p => ({
    url: getSiteDocumentDownloadUrl(p.id),
    name: p.title || p.original_name || '',
  })),
)

function fmtDate(s) {
  if (!s) return null
  const d = new Date(s.replace(' ', 'T'))
  if (isNaN(d)) return null
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}
function captionDate(p) {
  return fmtDate(p.taken_at) || fmtDate(p.uploaded_at) || '—'
}
</script>

<template>
  <div class="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
    <div class="px-4 py-2.5 border-b border-gray-100">
      <h2 class="text-sm font-semibold text-gray-700 inline-flex items-center gap-1.5">
        <CameraIcon class="w-4 h-4 text-gray-400" /> Photos ({{ photos.length }})
      </h2>
    </div>

    <div v-if="loading" class="px-4 py-6 text-sm text-gray-400">Chargement…</div>

    <div v-else-if="sorted.length"
         class="p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
      <button v-for="(p, i) in sorted" :key="p.id" type="button"
              @click="lightboxIndex = i"
              class="group relative aspect-square rounded-lg overflow-hidden border border-gray-200 bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40">
        <img :src="getSiteDocumentDownloadUrl(p.id)" :alt="p.title || ''"
             loading="lazy"
             class="w-full h-full object-cover transition group-hover:scale-105" />
        <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pt-5 pb-1.5">
          <p class="text-[11px] text-white/90 leading-tight truncate">{{ captionDate(p) }}</p>
          <p v-if="p.gps_latitude != null" class="text-[10px] text-white/70 inline-flex items-center gap-0.5">
            <MapPinIcon class="w-3 h-3 shrink-0" /> Géolocalisée
          </p>
        </div>
      </button>
    </div>

    <p v-else class="px-4 py-6 text-sm text-gray-500 italic">
      Aucune photo pour ce site.
    </p>

    <ImageLightbox :images="lightboxImages" v-model:index="lightboxIndex" />
  </div>
</template>
