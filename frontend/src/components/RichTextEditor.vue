<script setup>
/**
 * Mini-éditeur de texte riche basé sur Tiptap (StarterKit).
 * - v-model:html → HTML interne
 * - Toolbar minimale : gras, italique, listes, lien
 *
 * Pas conçu pour éditer un long contenu structuré (utiliser SectionEditor.vue
 * pour ça avec autosave). Idéal pour les champs courts comme description
 * fonctionnelle d'un template ou justification BACS.
 */
import { ref, watch, onBeforeUnmount, onMounted } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import {
  BoldIcon, ItalicIcon, ListBulletIcon, NumberedListIcon, LinkIcon, SparklesIcon,
  ChevronDownIcon,
} from '@heroicons/vue/24/outline'
import { claudeLibraryAssist } from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useClaudeUsage, formatUsageTooltip } from '@/composables/useClaudeUsage'
import LinkInputModal from './LinkInputModal.vue'

const LIBRARY_CONTEXT_LS_KEY = 'buildy-docs.claude.libraryContext'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: 'Commencez à écrire…' },
  minHeight: { type: String, default: '180px' },
  // Active le bouton Claude dans la toolbar (bibliotheque uniquement).
  // Si assistContext est fourni, le bouton adapte son libelle :
  //   - editeur vide  -> "Générer avec Claude" (mode=generate)
  //   - editeur rempli -> "Reformuler avec Claude" (mode=reformulate)
  // Le contexte (kind, title, parent_path, etc.) est transmis tel quel
  // au backend qui construit un prompt structure.
  assistContext: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue'])
const { success, error: notifyError } = useNotification()
const { usage: claudeUsage, refresh: refreshClaudeUsage } = useClaudeUsage()
const assisting = ref(false)
// Coût de la dernière requête Claude (affiché après l'appel)
const lastRequestCostEur = ref(null)

// Etat de l'enrichissement par corpus existant — persiste dans localStorage
// pour ne pas re-cocher a chaque appel.
const libraryContext = ref({ enabled: false, strategy: 'neighbors' })
const showLibraryMenu = ref(false)
function loadLibraryContext() {
  try {
    const raw = localStorage.getItem(LIBRARY_CONTEXT_LS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        libraryContext.value = {
          enabled: !!parsed.enabled,
          strategy: ['neighbors', 'summary', 'full'].includes(parsed.strategy)
            ? parsed.strategy : 'neighbors',
        }
      }
    }
  } catch { /* ignore */ }
}
function persistLibraryContext() {
  try {
    localStorage.setItem(LIBRARY_CONTEXT_LS_KEY, JSON.stringify(libraryContext.value))
  } catch { /* ignore */ }
}
onMounted(() => loadLibraryContext())

const isEmpty = ref(true)
function recomputeEmpty() {
  const html = editor.value?.getHTML() || ''
  isEmpty.value = !html.replace(/<[^>]*>/g, '').trim()
}

async function callClaude() {
  if (!editor.value || !props.assistContext) return
  const html = editor.value.getHTML()
  const empty = !html.replace(/<[^>]*>/g, '').trim()
  const mode = empty ? 'generate' : 'reformulate'
  assisting.value = true
  try {
    const { data } = await claudeLibraryAssist({
      mode,
      ...props.assistContext,
      html: empty ? undefined : html,
      library_context: libraryContext.value.enabled
        ? { enabled: true, strategy: libraryContext.value.strategy }
        : undefined,
    })
    if (data?.html) {
      editor.value.commands.setContent(data.html, false)
      emit('update:modelValue', data.html)
      recomputeEmpty()
      const cost = typeof data.cost_eur === 'number' ? data.cost_eur : null
      lastRequestCostEur.value = cost
      const costLabel = cost != null ? ` · ≈ ${cost.toFixed(4)} €` : ''
      success((empty ? 'Brouillon généré' : 'Texte reformulé') + costLabel)
      refreshClaudeUsage()
    }
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de la requête Claude')
  } finally {
    assisting.value = false
  }
}

const editor = useEditor({
  content: props.modelValue || '',
  extensions: [
    StarterKit.configure({
      heading: { levels: [3, 4] },
      link: { openOnClick: false, autolink: true, linkOnPaste: true },
    }),
    Placeholder.configure({
      placeholder: props.placeholder,
      emptyEditorClass: 'is-editor-empty',
    }),
  ],
  editorProps: {
    attributes: {
      class: 'prose prose-sm max-w-none focus:outline-none px-3 py-2 rich-prose',
      style: `min-height: ${props.minHeight}`,
    },
    // Si on colle du HTML brut sous forme de texte (cas typique : sortie Claude
    // copiee depuis claude.ai), detecter les balises et l'interpreter comme HTML.
    handlePaste: (view, event) => {
      const text = event.clipboardData?.getData('text/plain') || ''
      const looksLikeHtml = /^\s*<(p|div|ul|ol|h[1-6]|strong|em|br|table|blockquote)[\s>]/i.test(text)
      if (looksLikeHtml && text.includes('</')) {
        event.preventDefault()
        editor.value?.chain().focus().insertContent(text, { parseOptions: { preserveWhitespace: false } }).run()
        return true
      }
      return false
    },
  },
  onUpdate: ({ editor }) => {
    emit('update:modelValue', editor.getHTML())
    recomputeEmpty()
  },
  onCreate: () => recomputeEmpty(),
})

// Sync externe → éditeur (par exemple quand on charge un nouveau template)
watch(() => props.modelValue, (val) => {
  if (!editor.value) return
  if (val !== editor.value.getHTML()) {
    editor.value.commands.setContent(val || '', false)
  }
})

// Ferme le popover des options corpus si on clique en dehors.
function onDocClick(ev) {
  if (!showLibraryMenu.value) return
  const root = ev.target?.closest?.('.rte-library-popover-root')
  if (!root) showLibraryMenu.value = false
}
onMounted(() => document.addEventListener('mousedown', onDocClick))
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick)
  editor.value?.destroy()
})

const isActive = (name, attrs) => editor.value?.isActive(name, attrs) || false

// Modale insertion / édition de lien (remplace window.prompt)
const showLinkModal = ref(false)
const linkInitialUrl = ref('')
function setLink() {
  linkInitialUrl.value = editor.value?.getAttributes('link').href || ''
  showLinkModal.value = true
}
function onSaveLink(url) {
  if (!editor.value) return
  if (url === '') editor.value.chain().focus().extendMarkRange('link').unsetLink().run()
  else editor.value.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  showLinkModal.value = false
}
</script>

<template>
  <div class="border border-gray-200 rounded-lg bg-white shadow-sm">
    <div v-if="editor" class="flex items-center gap-0.5 px-1.5 py-1 border-b border-gray-200 bg-gray-50 rounded-t-lg">
      <button type="button" @click="editor.chain().focus().toggleBold().run()"
              :class="['p-1 rounded hover:bg-gray-200', isActive('bold') ? 'bg-gray-200 text-indigo-700' : 'text-gray-600']"
              title="Gras"><BoldIcon class="w-3.5 h-3.5" /></button>
      <button type="button" @click="editor.chain().focus().toggleItalic().run()"
              :class="['p-1 rounded hover:bg-gray-200', isActive('italic') ? 'bg-gray-200 text-indigo-700' : 'text-gray-600']"
              title="Italique"><ItalicIcon class="w-3.5 h-3.5" /></button>
      <span class="w-px h-4 bg-gray-300 mx-0.5"></span>
      <button type="button" @click="editor.chain().focus().toggleBulletList().run()"
              :class="['p-1 rounded hover:bg-gray-200', isActive('bulletList') ? 'bg-gray-200 text-indigo-700' : 'text-gray-600']"
              title="Liste à puces"><ListBulletIcon class="w-3.5 h-3.5" /></button>
      <button type="button" @click="editor.chain().focus().toggleOrderedList().run()"
              :class="['p-1 rounded hover:bg-gray-200', isActive('orderedList') ? 'bg-gray-200 text-indigo-700' : 'text-gray-600']"
              title="Liste numérotée"><NumberedListIcon class="w-3.5 h-3.5" /></button>
      <span class="w-px h-4 bg-gray-300 mx-0.5"></span>
      <button type="button" @click="setLink"
              :class="['p-1 rounded hover:bg-gray-200', isActive('link') ? 'bg-gray-200 text-indigo-700' : 'text-gray-600']"
              title="Lien"><LinkIcon class="w-3.5 h-3.5" /></button>

      <div v-if="assistContext" class="rte-library-popover-root ml-auto relative flex items-center">
        <button type="button" @click="callClaude" :disabled="assisting"
                class="inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 text-[11px] font-medium text-violet-700 hover:text-violet-900 hover:bg-violet-50 disabled:opacity-50 rounded-l-md transition"
                :title="formatUsageTooltip(claudeUsage)">
          <SparklesIcon class="w-3.5 h-3.5" :class="assisting ? 'animate-pulse' : ''" />
          {{ assisting
              ? (isEmpty ? 'Génération…' : 'Reformulation…')
              : (isEmpty ? 'Générer avec Claude' : 'Reformuler avec Claude') }}
          <span v-if="claudeUsage" class="ml-1 text-[10px] text-violet-500 font-mono">
            ≈{{ (claudeUsage.avg_cost_eur || 0).toFixed(3) }}€
          </span>
          <span v-if="libraryContext.enabled"
                class="ml-1 inline-flex items-center px-1 rounded bg-violet-100 text-violet-700 text-[9px] font-semibold uppercase tracking-wide">
            corpus
          </span>
        </button>
        <button type="button" @click="showLibraryMenu = !showLibraryMenu" :disabled="assisting"
                class="px-1 py-0.5 text-violet-700 hover:text-violet-900 hover:bg-violet-50 disabled:opacity-50 rounded-r-md transition border-l border-violet-200"
                title="Options de contexte bibliothèque">
          <ChevronDownIcon class="w-3 h-3" />
        </button>
        <!-- Popover options corpus -->
        <div v-if="showLibraryMenu"
             class="absolute right-0 top-full mt-1 z-50 w-72 rounded-lg border border-gray-200 bg-white shadow-xl p-3 text-[12px] text-gray-700">
          <label class="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" v-model="libraryContext.enabled"
                   @change="persistLibraryContext"
                   class="mt-0.5 rounded border-gray-300 text-violet-600 focus:ring-violet-500" />
            <span>
              <span class="font-medium">Inclure le corpus existant</span>
              <span class="block text-gray-500 text-[11px] leading-snug mt-0.5">
                Claude lit les autres fonctionnalités/équipements déjà rédigés pour aligner vocabulaire et niveau de détail.
              </span>
            </span>
          </label>
          <div :class="['mt-3 pl-6 space-y-1.5', libraryContext.enabled ? '' : 'opacity-40 pointer-events-none']">
            <div class="text-[11px] font-medium text-gray-600">Stratégie</div>
            <label class="flex items-start gap-2 cursor-pointer">
              <input type="radio" value="neighbors" v-model="libraryContext.strategy"
                     @change="persistLibraryContext"
                     class="mt-0.5 border-gray-300 text-violet-600 focus:ring-violet-500" />
              <span>
                <span class="font-medium">Voisins</span>
                <span class="block text-gray-500 text-[11px]">Entrées proches uniquement (rapide).</span>
              </span>
            </label>
            <label class="flex items-start gap-2 cursor-pointer">
              <input type="radio" value="summary" v-model="libraryContext.strategy"
                     @change="persistLibraryContext"
                     class="mt-0.5 border-gray-300 text-violet-600 focus:ring-violet-500" />
              <span>
                <span class="font-medium">Résumé complet</span>
                <span class="block text-gray-500 text-[11px]">Toute la bibliothèque, en résumé court.</span>
              </span>
            </label>
            <label class="flex items-start gap-2 cursor-pointer">
              <input type="radio" value="full" v-model="libraryContext.strategy"
                     @change="persistLibraryContext"
                     class="mt-0.5 border-gray-300 text-violet-600 focus:ring-violet-500" />
              <span>
                <span class="font-medium">Corpus complet</span>
                <span class="block text-gray-500 text-[11px]">Tous les contenus en entier (plus lent / plus coûteux).</span>
              </span>
            </label>
          </div>
          <!-- Coût + budget -->
          <div v-if="claudeUsage" class="mt-3 pt-2 border-t border-gray-100 space-y-0.5 text-[11px] text-gray-600">
            <div class="flex items-center justify-between">
              <span>Coût moyen / requête</span>
              <span class="font-mono">≈ {{ (claudeUsage.avg_cost_eur || 0).toFixed(3) }} €</span>
            </div>
            <div v-if="lastRequestCostEur != null" class="flex items-center justify-between">
              <span>Dernière requête</span>
              <span class="font-mono text-violet-700">≈ {{ lastRequestCostEur.toFixed(4) }} €</span>
            </div>
            <div v-if="claudeUsage.month_cost_eur != null" class="flex items-center justify-between">
              <span>Consommé ce mois</span>
              <span class="font-mono">{{ (claudeUsage.month_cost_eur || 0).toFixed(2) }} €</span>
            </div>
            <div v-if="claudeUsage.monthly_budget_eur && claudeUsage.remaining_eur != null"
                 class="flex items-center justify-between">
              <span>Crédit restant <span class="text-gray-400">(budget local)</span></span>
              <span class="font-mono"
                    :class="claudeUsage.remaining_eur < (claudeUsage.monthly_budget_eur * 0.2) ? 'text-amber-700' : 'text-emerald-700'">
                {{ claudeUsage.remaining_eur.toFixed(2) }} €
              </span>
            </div>
          </div>
          <div class="mt-3 pt-2 border-t border-gray-100 flex justify-end">
            <button type="button" @click="showLibraryMenu = false"
                    class="text-[11px] text-gray-500 hover:text-gray-700">Fermer</button>
          </div>
        </div>
      </div>
    </div>
    <EditorContent :editor="editor" />
    <LinkInputModal
      v-if="showLinkModal"
      :initial-url="linkInitialUrl"
      @save="onSaveLink"
      @close="showLinkModal = false"
    />
  </div>
</template>

<style scoped>
:deep(.rich-prose p) { margin: 0 0 0.75rem; line-height: 1.55; font-size: 13px; color: #374151; }
:deep(.rich-prose p:last-child) { margin-bottom: 0; }
:deep(.rich-prose strong) { color: #1f2937; font-weight: 500; }
:deep(.rich-prose ul), :deep(.rich-prose ol) { padding-left: 1.4rem; margin: 0.5rem 0; }
:deep(.rich-prose ul) { list-style-type: disc; }
:deep(.rich-prose ol) { list-style-type: decimal; }
:deep(.rich-prose li) { margin: 0.25rem 0; line-height: 1.5; }
:deep(.rich-prose a) { color: #4f46e5; text-decoration: underline; }
:deep(.rich-prose .is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: #9ca3af;
  pointer-events: none;
  height: 0;
  font-style: italic;
  font-size: 13px;
}
</style>
