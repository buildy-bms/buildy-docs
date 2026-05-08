<script setup>
/**
 * Modale "Générer un article FAQ depuis une question" — Partie 1.A.
 *
 * Évolution : sélecteur de type d'article (5 types), drag-drop de captures
 * (max 8, compression client + WebP), annotations textuelles par capture,
 * éditeur d'annotations Konva (Cleanshot-like) optionnel, prévisualisation
 * du HTML généré + Régénérer / Créer ou Insérer / Modifier.
 *
 * Modes :
 *   - mode 'create' (défaut) : "Créer l'article" → POST /faq/articles + redirection
 *     vers /faq/articles/:id.
 *   - mode 'insert' (depuis l'éditeur d'un article existant) : "Insérer ici"
 *     → emit('insert', { html, suggested_title }) pour insertion au curseur.
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  PlusIcon, XMarkIcon, SparklesIcon, ArrowPathIcon, PhotoIcon, PencilSquareIcon,
  ListBulletIcon, ChatBubbleLeftRightIcon, BookOpenIcon, WrenchScrewdriverIcon, LightBulbIcon,
  ArrowUturnLeftIcon, CheckIcon,
} from '@heroicons/vue/24/outline'
import BaseModal from './BaseModal.vue'
import SafeHtml from './SafeHtml.vue'
import AnnotationEditor from './faq-annotations/AnnotationEditor.vue'
import { useFaqStore } from '@/stores/faq'
import { useNotification } from '@/composables/useNotification'
import { compressImage, estimateVisionCost } from '@/composables/useImageCompression'

const props = defineProps({
  mode: { type: String, default: 'create' }, // 'create' | 'insert'
  defaultCategoryId: { type: [Number, null], default: null },
  defaultType: { type: String, default: 'howto' },
  articleId: { type: [Number, null], default: null }, // requis en mode insert pour le contexte
})
const emit = defineEmits(['close', 'created', 'insert'])

const router = useRouter()
const store = useFaqStore()
const { success, error: notifyError } = useNotification()

// ── Types d'articles ─────────────────────────────────────────────────
const TYPES = [
  { key: 'howto', label: 'Procédure pas à pas', desc: 'Étapes numérotées (How-to)', icon: ListBulletIcon, includeImagesByDefault: true,
    placeholder: 'Comment configurer une alerte sur un compteur ?' },
  { key: 'faq', label: 'Question / Réponse', desc: 'Réponse courte directe', icon: ChatBubbleLeftRightIcon, includeImagesByDefault: false,
    placeholder: 'Buildy propose-t-il un export Excel des consommations ?' },
  { key: 'concept', label: 'Concept / Définition', desc: 'Qu\'est-ce que… ?', icon: BookOpenIcon, includeImagesByDefault: false,
    placeholder: 'Qu\'est-ce qu\'une dérive de consommation ?' },
  { key: 'troubleshooting', label: 'Résolution de problème', desc: 'Symptôme → diagnostic → solution', icon: WrenchScrewdriverIcon, includeImagesByDefault: true,
    placeholder: 'L\'application Gojee se fige au démarrage' },
  { key: 'bestpractice', label: 'Cas d\'usage / Bonne pratique', desc: 'Comment exploiter au mieux X', icon: LightBulbIcon, includeImagesByDefault: false,
    placeholder: 'Comment bien organiser ses sites pour faciliter la supervision ?' },
]

// ── État ─────────────────────────────────────────────────────────────
const articleType = ref(props.defaultType || 'howto')
const question = ref('')
const categoryId = ref(props.defaultCategoryId || null)
const includeInContent = ref(true)
const images = ref([]) // { id, file, preview, width, height, mediaType, annotation, annotated, sourceFile }
const generating = ref(false)
const result = ref(null) // { html, suggested_title, usage, meta }
const annotationTarget = ref(null) // image en cours d'annotation

const currentType = computed(() => TYPES.find((t) => t.key === articleType.value))

// Au changement de type, recalcule includeInContent par défaut sauf si l'utilisateur l'a forcé
const userTouchedInclude = ref(false)
function onTypeChange(key) {
  articleType.value = key
  if (!userTouchedInclude.value) {
    includeInContent.value = TYPES.find((t) => t.key === key)?.includeImagesByDefault ?? false
  }
}
function toggleInclude() {
  includeInContent.value = !includeInContent.value
  userTouchedInclude.value = true
}

const visionCost = computed(() => estimateVisionCost(images.value.length))

// ── Drag-drop ───────────────────────────────────────────────────────
const dragActive = ref(false)
const fileInputRef = ref(null)

function onDrop(e) {
  e.preventDefault()
  dragActive.value = false
  const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'))
  if (files.length) addFiles(files)
}
function onPickerChange(e) {
  const files = [...(e.target.files || [])]
  e.target.value = ''
  if (files.length) addFiles(files)
}
async function addFiles(files) {
  for (const f of files) {
    if (images.value.length >= 8) {
      notifyError('8 captures max par génération')
      break
    }
    try {
      const c = await compressImage(f)
      images.value.push({
        id: crypto.randomUUID(),
        file: c.file,
        preview: c.dataUrl,
        width: c.width,
        height: c.height,
        mediaType: c.file.type,
        annotation: '',
        annotated: false,
        sourceFile: c.file, // Original compressé (pour ré-éditer l'annotation)
      })
    } catch (err) {
      notifyError(`Échec compression "${f.name}" : ${err.message}`)
    }
  }
}
function removeImage(id) {
  images.value = images.value.filter((i) => i.id !== id)
}

// ── Annotation Konva ─────────────────────────────────────────────────
function openAnnotation(img) {
  annotationTarget.value = img
}
async function onAnnotationSaved(blob) {
  const target = annotationTarget.value
  if (!target) return
  const file = new File([blob], target.file.name.replace(/\.[^.]+$/, '-annoté.png'), { type: 'image/png' })
  // Re-compresse pour rester économe en tokens (l'annotation a peut-être agrandi)
  try {
    const c = await compressImage(file)
    target.file = c.file
    target.preview = c.dataUrl
    target.width = c.width
    target.height = c.height
    target.mediaType = c.file.type
    target.annotated = true
  } catch (e) {
    notifyError('Échec post-traitement annotation : ' + e.message)
  }
  annotationTarget.value = null
}

// ── Génération ───────────────────────────────────────────────────────
async function generate() {
  if (!question.value.trim()) {
    notifyError('Question requise')
    return
  }
  generating.value = true
  try {
    const data = await store.aiGenerate({
      question: question.value.trim(),
      category_id: categoryId.value,
      article_type: articleType.value,
      include_images_in_content: includeInContent.value,
      images: images.value.map((i) => i.file),
      annotations: images.value.map((i) => i.annotation || ''),
    })
    result.value = data
    success(`Article généré (${data?.usage?.input_tokens || 0} tokens in / ${data?.usage?.output_tokens || 0} out)`)
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de la génération')
  } finally {
    generating.value = false
  }
}

function backToInputs() {
  result.value = null
}

async function createArticle() {
  if (!result.value) return
  try {
    const created = await store.createArticle({
      title: result.value.suggested_title || question.value.slice(0, 80),
      content_html: result.value.html,
      category_id: categoryId.value,
      status: 'draft',
      visibility: 'public',
    })
    success(`Article créé`)
    emit('created', { id: created.id })
    emit('close')
    if (props.mode === 'create') router.push(`/faq/articles/${created.id}`)
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec création')
  }
}
function insertHere() {
  if (!result.value) return
  emit('insert', {
    html: result.value.html,
    suggested_title: result.value.suggested_title,
  })
  emit('close')
}

onMounted(() => {
  if (props.defaultType) onTypeChange(props.defaultType)
})
</script>

<template>
  <BaseModal size="xl" :dismiss-on-backdrop="false"
             :title="mode === 'insert' ? 'Insérer du contenu généré par IA' : 'Générer un article depuis une question'"
             @close="emit('close')">

    <!-- Étape 1 : inputs (avant génération ou retour) -->
    <div v-if="!result">
      <p class="text-sm text-gray-500 mb-4 -mt-1">
        L'IA s'appuie sur le corpus Buildy + tes captures d'écran pour générer un article structuré selon le type choisi.
      </p>

      <!-- Type d'article -->
      <label class="block text-sm font-medium text-gray-700 mb-2">Type d'article</label>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-2 mb-5">
        <button v-for="t in TYPES" :key="t.key" type="button" @click="onTypeChange(t.key)"
                :class="['flex items-start gap-2 px-3 py-2.5 rounded-lg border text-left transition',
                         articleType === t.key
                           ? 'border-indigo-500 bg-indigo-50 text-indigo-900'
                           : 'border-gray-200 hover:border-indigo-300 text-gray-700']">
          <component :is="t.icon" class="w-5 h-5 shrink-0 mt-0.5" />
          <div class="min-w-0">
            <div class="text-sm font-medium leading-tight">{{ t.label }}</div>
            <div class="text-xs text-gray-500 mt-0.5">{{ t.desc }}</div>
          </div>
        </button>
      </div>

      <!-- Question -->
      <label class="block text-sm font-medium text-gray-700 mb-1.5">
        Quelle question veux-tu documenter ?
      </label>
      <textarea v-model="question" rows="3" :placeholder="currentType?.placeholder"
                class="w-full px-3.5 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition resize-y mb-5" />

      <!-- Catégorie -->
      <label class="block text-sm font-medium text-gray-700 mb-1.5">
        Catégorie cible <span class="text-gray-400 font-normal">(optionnel)</span>
      </label>
      <select v-model="categoryId"
              class="w-full px-3.5 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition bg-white mb-5">
        <option :value="null">— Aucune —</option>
        <option v-for="c in store.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>

      <!-- Captures -->
      <label class="block text-sm font-medium text-gray-700 mb-1.5">
        Captures d'écran <span class="text-gray-400 font-normal">({{ images.length }}/8)</span>
      </label>
      <div @dragover.prevent="dragActive = true" @dragleave="dragActive = false" @drop="onDrop"
           :class="['border-2 border-dashed rounded-lg p-4 transition mb-2',
                    dragActive ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 bg-gray-50/50']">
        <div v-if="!images.length" class="text-center py-6">
          <PhotoIcon class="w-8 h-8 mx-auto text-gray-400" />
          <p class="text-sm text-gray-600 mt-2">
            Glisse jusqu'à 8 captures ici, ou
            <button type="button" @click="fileInputRef.click()" class="text-indigo-600 hover:underline">parcours tes fichiers</button>
          </p>
          <p class="text-xs text-gray-400 mt-1">PNG, JPG, WebP, GIF — compressées automatiquement à 1600px max</p>
        </div>
        <div v-else class="grid grid-cols-3 md:grid-cols-4 gap-3">
          <div v-for="img in images" :key="img.id" class="relative group bg-white rounded-lg border border-gray-200 overflow-hidden">
            <img :src="img.preview" class="w-full h-24 object-cover" />
            <span v-if="img.annotated" class="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 text-xs font-medium">Annotée</span>
            <button type="button" @click="removeImage(img.id)"
                    class="absolute top-1 right-1 p-1 bg-white/90 hover:bg-red-50 text-red-500 rounded transition opacity-0 group-hover:opacity-100"
                    v-tooltip="'Retirer'">
              <XMarkIcon class="w-3.5 h-3.5" />
            </button>
            <button type="button" @click="openAnnotation(img)"
                    class="absolute bottom-1 left-1 p-1 bg-white/90 hover:bg-indigo-50 text-indigo-600 rounded transition opacity-0 group-hover:opacity-100"
                    v-tooltip="'Annoter'">
              <PencilSquareIcon class="w-3.5 h-3.5" />
            </button>
            <textarea v-model="img.annotation" rows="1" placeholder="Élément à mettre en évidence (optionnel)"
                      class="w-full px-2 py-1 text-xs border-t border-gray-200 focus:outline-none focus:bg-indigo-50/30" />
          </div>
          <button v-if="images.length < 8" type="button" @click="fileInputRef.click()"
                  class="flex flex-col items-center justify-center h-24 rounded-lg border-2 border-dashed border-gray-300 text-gray-500 hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50/30 transition">
            <PlusIcon class="w-5 h-5" />
            <span class="text-xs mt-1">Ajouter</span>
          </button>
        </div>
        <input ref="fileInputRef" type="file" accept="image/*" multiple class="hidden" @change="onPickerChange" />
      </div>
      <div v-if="images.length" class="flex items-center justify-between text-xs text-gray-500 mb-4">
        <label class="inline-flex items-center gap-2">
          <input type="checkbox" :checked="includeInContent" @change="toggleInclude" class="rounded" />
          Inclure ces captures dans l'article publié sur Crisp
        </label>
        <span>~{{ visionCost.tokens }} tokens (≈ {{ visionCost.eur }} €)</span>
      </div>

      <!-- Boutons -->
      <div class="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
        <button type="button" @click="emit('close')"
                class="px-4 py-2 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-100 transition whitespace-nowrap">
          Annuler
        </button>
        <button type="button" @click="generate" :disabled="generating || !question.trim()"
                class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition whitespace-nowrap disabled:opacity-50 shadow-sm">
          <SparklesIcon class="w-4 h-4 shrink-0" :class="generating ? 'animate-pulse' : ''" />
          {{ generating ? 'Génération…' : 'Générer l\'article' }}
        </button>
      </div>
    </div>

    <!-- Étape 2 : preview + Régénérer / Créer / Modifier inputs -->
    <div v-else>
      <div class="flex items-start justify-between mb-4">
        <div>
          <h3 class="text-base font-semibold text-gray-800">{{ result.suggested_title || 'Article généré' }}</h3>
          <p class="text-xs text-gray-500 mt-0.5">
            {{ result.usage?.input_tokens || 0 }} tokens in · {{ result.usage?.output_tokens || 0 }} tokens out
            <span v-if="result.meta?.images_count"> · {{ result.meta.images_count }} capture(s)</span>
          </p>
        </div>
      </div>
      <div class="border border-gray-200 rounded-lg p-4 max-h-[55vh] overflow-y-auto bg-white prose prose-sm max-w-none">
        <SafeHtml :html="result.html" />
      </div>
      <div class="flex items-center justify-between gap-2 pt-3 mt-3 border-t border-gray-100">
        <button type="button" @click="backToInputs"
                class="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 transition whitespace-nowrap text-gray-700">
          <ArrowUturnLeftIcon class="w-4 h-4 shrink-0" /> Modifier les inputs
        </button>
        <div class="flex items-center gap-2">
          <button type="button" @click="generate" :disabled="generating"
                  class="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-violet-200 text-violet-700 hover:bg-violet-50 transition whitespace-nowrap disabled:opacity-50">
            <ArrowPathIcon class="w-4 h-4 shrink-0" :class="generating ? 'animate-spin' : ''" />
            {{ generating ? 'Régénération…' : 'Régénérer' }}
          </button>
          <button v-if="mode === 'insert'" type="button" @click="insertHere"
                  class="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition whitespace-nowrap shadow-sm">
            <CheckIcon class="w-4 h-4 shrink-0" /> Insérer ici
          </button>
          <button v-else type="button" @click="createArticle"
                  class="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition whitespace-nowrap shadow-sm">
            <CheckIcon class="w-4 h-4 shrink-0" /> Créer l'article
          </button>
        </div>
      </div>
    </div>

    <!-- Modale d'annotation Konva -->
    <AnnotationEditor v-if="annotationTarget" :image-blob="annotationTarget.sourceFile"
                      @close="annotationTarget = null" @save="onAnnotationSaved" />
  </BaseModal>
</template>
