<script setup>
/**
 * Configuration du PDF "Offres Buildy" — niveaux E/S/P + textes
 * cover/CTA editables.
 *
 * Source de verite :
 *  - offering_levels : nom + tagline + decoy (is_highlighted) par niveau
 *  - pdf_boilerplate kinds 'offerings_*' : promesse cover, sous-titre,
 *    CTA titre, sub, contact
 *
 * Tout est lu a chaque generation PDF — modif ici = effet immediat sur
 * le prochain export.
 */
import { ref, onMounted } from 'vue'
import {
  listOfferingLevels, updateOfferingLevel,
  listPdfBoilerplate, updatePdfBoilerplate,
  previewOfferingsUrl, exportOfferingsPdfUrl,
} from '@/api'
import RichTextEditor from '@/components/RichTextEditor.vue'
import PdfPreviewModal from '@/components/PdfPreviewModal.vue'
import { EyeIcon, DocumentArrowDownIcon, StarIcon } from '@heroicons/vue/24/outline'
import { useNotification } from '@/composables/useNotification'

const { success, error } = useNotification()

const levels = ref([])
const boilerplates = ref({}) // { kind: { id, body_html } }
const loading = ref(true)
const previewOpen = ref(false)
const generating = ref(false)

const BOILERPLATE_KINDS = [
  { kind: 'offerings_cover_promise', label: 'Promesse en cover',
    hint: 'Phrase forte sous le titre. Activera le levier émotionnel chez le lecteur.' },
  { kind: 'offerings_cover_subtitle', label: 'Sous-titre cover',
    hint: 'Description plus posée du positionnement Buildy.' },
  { kind: 'offerings_cta_title', label: 'CTA — titre',
    hint: 'Question ou affirmation engageante en footer du tableau.' },
  { kind: 'offerings_cta_sub', label: 'CTA — sous-titre',
    hint: 'Engagement de service (ex: réponse sous 48h).' },
  { kind: 'offerings_cta_contact', label: 'CTA — contact',
    hint: 'Email + téléphone, en mono vert dans le PDF.' },
]

async function load() {
  loading.value = true
  try {
    const [levelsRes, boilerRes] = await Promise.all([
      listOfferingLevels(),
      listPdfBoilerplate(),
    ])
    levels.value = levelsRes.data
    // Map les boilerplates par kind, prend le 1er actif pour chaque
    const map = {}
    for (const b of boilerRes.data) {
      if (b.kind.startsWith('offerings_') && b.is_active && !map[b.kind]) {
        map[b.kind] = b
      }
    }
    boilerplates.value = map
  } catch (e) {
    error('Chargement impossible')
  } finally {
    loading.value = false
  }
}
onMounted(load)

const saveTimers = new Map()
function scheduleSaveLevel(level, patch) {
  Object.assign(level, patch)
  clearTimeout(saveTimers.get(`L:${level.slug}`))
  saveTimers.set(`L:${level.slug}`, setTimeout(async () => {
    try { await updateOfferingLevel(level.slug, patch) }
    catch (e) { error('Sauvegarde niveau impossible') }
  }, 400))
}

function scheduleSaveBoiler(kind, html) {
  const item = boilerplates.value[kind]
  if (!item) return
  item.body_html = html
  clearTimeout(saveTimers.get(`B:${kind}`))
  saveTimers.set(`B:${kind}`, setTimeout(async () => {
    try { await updatePdfBoilerplate(item.id, { body_html: html }) }
    catch (e) { error('Sauvegarde texte impossible') }
  }, 500))
}

async function setHighlighted(level) {
  // Un seul niveau peut etre mis en valeur. On les desactive tous puis
  // on active celui clicke.
  const others = levels.value.filter(l => l.slug !== level.slug && l.is_highlighted)
  try {
    await Promise.all([
      ...others.map(l => updateOfferingLevel(l.slug, { is_highlighted: false })),
      updateOfferingLevel(level.slug, { is_highlighted: true }),
    ])
    others.forEach(l => l.is_highlighted = 0)
    level.is_highlighted = 1
    success(`${level.name} mis en valeur (décoy)`)
  } catch (e) {
    error('Sauvegarde impossible')
  }
}

async function downloadPdf() {
  generating.value = true
  try {
    const { default: api } = await import('@/api')
    const response = await api.post('/offerings/export-pdf', {}, { responseType: 'blob' })
    const dispo = response.headers['content-disposition'] || ''
    const match = /filename="([^"]+)"/.exec(dispo)
    const filename = match ? match[1] : 'offres-buildy.pdf'
    const url = URL.createObjectURL(response.data)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (e) {
    error('Échec de la génération du PDF')
  } finally {
    generating.value = false
  }
}
</script>

<template>
  <div class="max-w-5xl mx-auto px-5 lg:px-6 py-6">
    <header class="mb-6 flex items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-gray-900">Configuration du PDF Offres</h1>
        <p class="text-sm text-gray-500 mt-1">
          Édite les noms, taglines et le niveau mis en valeur (décoy
          marketing). Les modifications s'appliquent immédiatement au
          prochain export PDF.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button @click="previewOpen = true"
                class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 rounded-lg">
          <EyeIcon class="w-4 h-4" /> Aperçu
        </button>
        <button @click="downloadPdf" :disabled="generating"
                class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg disabled:opacity-60">
          <DocumentArrowDownIcon class="w-4 h-4" />
          {{ generating ? 'Génération…' : 'Télécharger PDF' }}
        </button>
      </div>
    </header>

    <div v-if="loading" class="text-center py-12 text-gray-400 text-sm">Chargement…</div>

    <div v-else class="space-y-6">
      <!-- ── Niveaux d'offre ── -->
      <section class="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <header class="px-5 py-3 border-b border-gray-200 bg-gray-50">
          <h2 class="text-sm font-semibold text-gray-800">Niveaux d'offre</h2>
          <p class="text-[11px] text-gray-500 mt-0.5">
            Un seul niveau peut être mis en valeur (décoy). Le niveau choisi
            apparaît avec une bordure verte épaisse, un badge personnalisable,
            et un fond crème dans tout le tableau du PDF.
          </p>
        </header>
        <div class="divide-y divide-gray-100">
          <div v-for="level in levels" :key="level.slug" class="p-4">
            <div class="grid grid-cols-1 md:grid-cols-[80px_1fr_1fr_auto] gap-4 items-start">
              <!-- Slug + badge couleur -->
              <div class="flex items-center gap-2">
                <span class="inline-flex items-center justify-center w-8 h-8 rounded-full text-white font-bold font-mono text-sm"
                      :style="{ background: level.color_hex || '#9ca3af' }">
                  {{ level.slug }}
                </span>
              </div>
              <!-- Nom -->
              <div>
                <label class="block text-[10px] uppercase tracking-wider text-gray-500 mb-1 font-semibold">Nom affiché</label>
                <input type="text" :value="level.name"
                       @input="e => scheduleSaveLevel(level, { name: e.target.value })"
                       class="input-base text-sm" />
              </div>
              <!-- Tagline -->
              <div>
                <label class="block text-[10px] uppercase tracking-wider text-gray-500 mb-1 font-semibold">Tagline</label>
                <input type="text" :value="level.tagline"
                       @input="e => scheduleSaveLevel(level, { tagline: e.target.value })"
                       class="input-base text-sm" placeholder="ex : Démarrer simple" />
              </div>
              <!-- Decoy -->
              <div class="flex flex-col gap-1.5">
                <label class="block text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Décoy</label>
                <button @click="setHighlighted(level)"
                        :class="['inline-flex items-center gap-1 px-3 py-2 text-xs font-medium rounded-lg border transition',
                          level.is_highlighted
                            ? 'bg-emerald-500 text-white border-emerald-500'
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50']">
                  <StarIcon class="w-3.5 h-3.5" />
                  {{ level.is_highlighted ? 'Mis en valeur' : 'Mettre en valeur' }}
                </button>
              </div>
            </div>
            <div v-if="level.is_highlighted" class="mt-3 ml-[96px] grid grid-cols-1 gap-2">
              <label class="block text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Texte du badge décoy</label>
              <input type="text" :value="level.highlight_label"
                     @input="e => scheduleSaveLevel(level, { highlight_label: e.target.value })"
                     class="input-base text-sm" placeholder="ex : ★ Le plus choisi" />
            </div>
          </div>
        </div>
      </section>

      <!-- ── Textes éditables ── -->
      <section class="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <header class="px-5 py-3 border-b border-gray-200 bg-gray-50">
          <h2 class="text-sm font-semibold text-gray-800">Textes du PDF</h2>
          <p class="text-[11px] text-gray-500 mt-0.5">
            Promesse cover et call-to-action en footer. Leviers émotionnels.
          </p>
        </header>
        <div class="divide-y divide-gray-100">
          <div v-for="b in BOILERPLATE_KINDS" :key="b.kind" class="p-4">
            <div class="space-y-1.5">
              <div class="flex items-baseline gap-2">
                <h3 class="text-sm font-semibold text-gray-800">{{ b.label }}</h3>
                <span class="text-[10px] text-gray-400 font-mono">{{ b.kind }}</span>
              </div>
              <p class="text-[11px] text-gray-500">{{ b.hint }}</p>
              <RichTextEditor v-if="boilerplates[b.kind]"
                              :model-value="boilerplates[b.kind].body_html"
                              @update:model-value="v => scheduleSaveBoiler(b.kind, v)"
                              min-height="80px" />
              <p v-else class="text-xs text-gray-400 italic">Texte non initialisé en base.</p>
            </div>
          </div>
        </div>
      </section>
    </div>

    <PdfPreviewModal
      v-if="previewOpen"
      title="Aperçu — Tableau des offres Buildy"
      :preview-url="previewOfferingsUrl()"
      :downloading="generating"
      download-label="Télécharger le PDF"
      @close="previewOpen = false"
      @download="downloadPdf"
    />
  </div>
</template>
