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
      <div class="flex items-center gap-2 shrink-0">
        <button @click="previewOpen = true"
                class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 rounded-lg whitespace-nowrap">
          <EyeIcon class="w-4 h-4 shrink-0" /> Aperçu
        </button>
        <button @click="downloadPdf" :disabled="generating"
                class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg disabled:opacity-60 whitespace-nowrap">
          <DocumentArrowDownIcon class="w-4 h-4 shrink-0" />
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
            Un seul niveau peut être mis en avant (effet « offre vedette »). Le niveau choisi
            apparaît avec une bordure verte, un badge et un fond crème dans le tableau du PDF.
          </p>
        </header>

        <!-- Headers de colonnes alignes avec les rangees -->
        <div class="grid grid-cols-[200px_1fr_1fr_180px] gap-4 px-5 py-2 border-b border-gray-200 bg-gray-50/60">
          <div class="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Niveau</div>
          <div class="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Nom affiché</div>
          <div class="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Tagline</div>
          <div class="text-[10px] uppercase tracking-wider text-gray-500 font-semibold" title="« Décoy » marketing : niveau présenté comme l'offre vedette du tableau.">Mise en avant</div>
        </div>

        <div class="divide-y divide-gray-100">
          <div v-for="level in levels" :key="level.slug" class="px-5 py-3">
            <div class="grid grid-cols-[200px_1fr_1fr_180px] gap-4 items-center">
              <!-- Niveau : avatar + libelle complet -->
              <div class="flex items-center gap-3 min-w-0">
                <span class="inline-flex items-center justify-center w-9 h-9 rounded-full text-white font-bold font-mono text-sm shrink-0"
                      :style="{ background: level.color_hex || '#9ca3af' }">
                  {{ level.slug }}
                </span>
                <div class="min-w-0">
                  <div class="text-sm font-semibold text-gray-800 truncate">{{ level.name }}</div>
                  <div class="text-[10px] uppercase tracking-wider text-gray-400">Niveau {{ level.slug }}</div>
                </div>
              </div>
              <!-- Nom edite -->
              <input type="text" :value="level.name"
                     @input="e => scheduleSaveLevel(level, { name: e.target.value })"
                     class="input-base text-sm w-full" />
              <!-- Tagline -->
              <input type="text" :value="level.tagline"
                     @input="e => scheduleSaveLevel(level, { tagline: e.target.value })"
                     class="input-base text-sm w-full" placeholder="ex : Démarrer simple" />
              <!-- Mise en avant -->
              <button @click="setHighlighted(level)"
                      :class="['inline-flex items-center justify-center gap-1 px-3 py-2 text-xs font-medium rounded-lg border transition whitespace-nowrap',
                        level.is_highlighted
                          ? 'bg-emerald-500 text-white border-emerald-500'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50']">
                <StarIcon class="w-3.5 h-3.5 shrink-0" />
                {{ level.is_highlighted ? 'Offre vedette' : 'Mettre en avant' }}
              </button>
            </div>
            <!-- Champ "texte du badge" en dessous, aligne sous la colonne Mise en avant -->
            <div v-if="level.is_highlighted" class="mt-3 grid grid-cols-[200px_1fr_1fr_180px] gap-4">
              <div></div>
              <div class="col-span-2">
                <label class="block text-[10px] uppercase tracking-wider text-gray-500 mb-1 font-semibold">Texte du badge « offre vedette »</label>
                <input type="text" :value="level.highlight_label"
                       @input="e => scheduleSaveLevel(level, { highlight_label: e.target.value })"
                       class="input-base text-sm w-full" placeholder="ex : ★ Le plus choisi" />
              </div>
              <div></div>
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
      title="Aperçu — Tableau des fonctionnalités Buildy"
      :preview-url="previewOfferingsUrl()"
      :downloading="generating"
      download-label="Télécharger le PDF"
      @close="previewOpen = false"
      @download="downloadPdf"
    />
  </div>
</template>
