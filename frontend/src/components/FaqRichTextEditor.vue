<script setup>
/**
 * Éditeur Tiptap dédié à la FAQ Buildy / Crisp Knowledge Base.
 *
 * - Headings H1-H4 (Crisp KB supporte H1-H6, on en expose 4)
 * - Underline + Highlight (équivalents `__` et `++` du markdown Crisp)
 * - Upload d'images via /api/faq/upload-image
 * - Placeholders d'images suggérés par l'IA (data-placeholder="true") :
 *   affichés en zone grise « image à uploader », click ouvre le file picker
 *   et remplace le placeholder. Ignorés au push Crisp.
 * - Bouton "Réécrire avec IA" intégré à la toolbar (appelle /api/faq/ai/rewrite).
 */
import { ref, watch, onBeforeUnmount, computed } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import StarterKit from '@tiptap/starter-kit'
import Blockquote from '@tiptap/extension-blockquote'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import {
  BoldIcon, ItalicIcon, UnderlineIcon, ListBulletIcon, NumberedListIcon,
  LinkIcon, PhotoIcon, CodeBracketIcon, ChatBubbleBottomCenterTextIcon,
  H1Icon, H2Icon, H3Icon, SparklesIcon, BookOpenIcon,
  LightBulbIcon, InformationCircleIcon, ExclamationTriangleIcon,
} from '@heroicons/vue/24/outline'
import api from '@/api'
import { useNotification } from '@/composables/useNotification'
import LinkInputModal from './LinkInputModal.vue'
import FaqArticleLinkModal from './FaqArticleLinkModal.vue'
import FaqRewriteSelectionModal from './FaqRewriteSelectionModal.vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: 'Rédigez l\'article…' },
  minHeight: { type: String, default: '320px' },
  // Si fourni, le bouton "Réécrire avec IA" est actif et appelle /api/faq/ai/rewrite
  // avec cet articleId. Si null, le bouton est masqué.
  articleId: { type: [Number, String, null], default: null },
})
const emit = defineEmits(['update:modelValue', 'suggested-title', 'rewritten'])
const { success, error: notifyError } = useNotification()

// ── Extension Image custom : ajoute data-placeholder + width ────────
const FaqImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => el.getAttribute('width'),
        renderHTML: (attrs) => attrs.width ? { width: attrs.width } : {},
      },
      'data-placeholder': {
        default: null,
        parseHTML: (el) => el.getAttribute('data-placeholder'),
        renderHTML: (attrs) => attrs['data-placeholder']
          ? { 'data-placeholder': attrs['data-placeholder'], class: 'faq-img-placeholder' }
          : {},
      },
    }
  },
})

// ── Blockquote custom : variantes Crisp tip / info / warning ────────
// Crisp KB rend les blockquotes "| ...", "|| ...", "||| ..." comme des
// callouts colorés (astuce / information / avertissement). On les expose
// dans l'éditeur via la classe CSS `callout-{variant}` que notre converter
// markdown <-> HTML (lib/crisp-markdown.js) sait remapper aux préfixes pipe.
const FaqBlockquote = Blockquote.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      variant: {
        default: null,
        parseHTML: (el) => {
          const cls = el.getAttribute('class') || ''
          if (cls.includes('callout-tip')) return 'tip'
          if (cls.includes('callout-info')) return 'info'
          if (cls.includes('callout-warning')) return 'warning'
          return null
        },
        renderHTML: (attrs) => attrs.variant
          ? { class: `callout-${attrs.variant}`, 'data-variant': attrs.variant }
          : {},
      },
    }
  },
  addCommands() {
    return {
      ...(this.parent?.() || {}),
      // Toggle d'une variante :
      // - hors blockquote -> wrap avec la variante demandée
      // - dans blockquote autre variante -> change de variante
      // - dans blockquote même variante -> unwrap (retour paragraphe)
      toggleCalloutVariant: (variant) => ({ commands, editor }) => {
        if (!editor.isActive('blockquote')) {
          return commands.wrapIn('blockquote', { variant })
        }
        const current = editor.getAttributes('blockquote').variant
        if (current === variant) {
          return commands.lift('blockquote')
        }
        return commands.updateAttributes('blockquote', { variant })
      },
    }
  },
})

const editor = useEditor({
  content: props.modelValue || '',
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: false,
      underline: false,
      blockquote: false, // remplacé par notre FaqBlockquote avec variantes
    }),
    Placeholder.configure({ placeholder: props.placeholder }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      // Tiptap @link v3 strip silencieusement mailto:/tel:/#anchor par défaut.
      // On élargit les protocoles + on remplace isAllowedUri pour accepter
      // toute URL bien formée (http(s), mailto, tel, ancres, chemins relatifs).
      protocols: ['mailto', 'tel', 'http', 'https', 'ftp'],
      isAllowedUri: (uri) => /^(https?:\/\/|mailto:|tel:|#|\/)/i.test(uri),
    }),
    FaqImage.configure({ inline: false, allowBase64: false }),
    FaqBlockquote,
    Underline,
    Highlight,
  ],
  onUpdate({ editor }) {
    emit('update:modelValue', editor.getHTML())
  },
})

watch(() => props.modelValue, (val) => {
  if (!editor.value) return
  if (val === editor.value.getHTML()) return
  editor.value.commands.setContent(val || '', false)
})

onBeforeUnmount(() => editor.value?.destroy())

// ── Toolbar actions ────────────────────────────────────────────────
const linkModalOpen = ref(false)
const linkPrefill = ref('')
const articleLinkModalOpen = ref(false)

function isActive(name, attrs) {
  return editor.value?.isActive(name, attrs) || false
}
function isCalloutVariant(variant) {
  if (!editor.value?.isActive('blockquote')) return false
  return editor.value.getAttributes('blockquote').variant === variant
}
function toggleCallout(variant) {
  editor.value?.chain().focus().toggleCalloutVariant(variant).run()
}
function setHeading(level) {
  editor.value?.chain().focus().toggleHeading({ level }).run()
}
function openLink() {
  linkPrefill.value = editor.value?.getAttributes('link')?.href || ''
  linkModalOpen.value = true
}
function openArticleLink() {
  articleLinkModalOpen.value = true
}
function onArticleLinkSelect({ url, title }) {
  articleLinkModalOpen.value = false
  if (!editor.value || !url) return
  const { from, to } = editor.value.state.selection
  if (from === to) {
    // Pas de sélection : on insère le titre comme texte du lien.
    editor.value
      .chain()
      .focus()
      .insertContent({
        type: 'text',
        text: title || url,
        marks: [{ type: 'link', attrs: { href: url } }],
      })
      .run()
  } else {
    // Sélection active : on enveloppe le texte sélectionné dans un lien.
    editor.value.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }
}
function applyLink(href) {
  if (!editor.value) return
  if (!href) editor.value.chain().focus().extendMarkRange('link').unsetLink().run()
  else editor.value.chain().focus().extendMarkRange('link').setLink({ href }).run()
  linkModalOpen.value = false
}

// ── Image upload ────────────────────────────────────────────────────
const imageInputRef = ref(null)
const uploading = ref(false)
// Position du placeholder à remplacer (si null = insertion au curseur)
const replaceTargetPos = ref(null)

function triggerImagePicker() {
  replaceTargetPos.value = null
  imageInputRef.value?.click()
}
async function onImageSelected(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    notifyError('Le fichier doit être une image')
    return
  }
  uploading.value = true
  try {
    const fd = new FormData()
    fd.append('file', file, file.name)
    const { data } = await api.post('/faq/upload-image', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    const altFromName = file.name.replace(/\.[^.]+$/, '')
    const targetPos = replaceTargetPos.value

    if (targetPos !== null && editor.value) {
      // Récupère le alt du placeholder pour le réutiliser comme alt définitif
      const node = editor.value.state.doc.nodeAt(targetPos)
      const existingAlt = node?.attrs?.alt || altFromName
      editor.value.chain().focus()
        .setNodeSelection(targetPos)
        .deleteSelection()
        .setImage({
          src: data.url,
          alt: existingAlt,
          width: data.width || undefined,
        })
        .run()
    } else {
      editor.value?.chain().focus().setImage({
        src: data.url,
        alt: altFromName,
        width: data.width || undefined,
      }).run()
    }
    success('Image insérée')
  } catch (err) {
    notifyError(err.response?.data?.detail || 'Échec de l\'upload')
  } finally {
    uploading.value = false
    replaceTargetPos.value = null
  }
}

// Click sur un placeholder image -> file picker pour le remplacer
function onEditorClick(e) {
  const img = e.target.closest('img.faq-img-placeholder, img[data-placeholder="true"]')
  if (!img || !editor.value) return
  e.preventDefault()
  // Trouve la position du nœud correspondant
  const view = editor.value.view
  const pos = view.posAtDOM(img, 0)
  replaceTargetPos.value = pos
  imageInputRef.value?.click()
}

// Drag & drop
function onDrop(e) {
  const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'))
  if (!files.length) return
  e.preventDefault()
  for (const f of files) {
    onImageSelected({ target: { files: [f], value: '' } })
  }
}

// Paste : intercepte les images du presse-papiers (Cmd+V d'une capture écran).
// Sans ce handler, Tiptap colle les images en data:image/... dans le HTML, ce
// qui passe pas le push Crisp (taille + URL non-publique).
function onPaste(e) {
  const items = [...(e.clipboardData?.items || [])]
  const imageItems = items.filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
  if (!imageItems.length) return
  e.preventDefault()
  for (const it of imageItems) {
    const file = it.getAsFile()
    if (file) onImageSelected({ target: { files: [file], value: '' } })
  }
}

// ── BubbleMenu : réécrire la sélection avec l'IA ──────────────────
const rewriteSelectionModalOpen = ref(false)
const rewriteSelectionHtml = ref('')

function openRewriteSelectionModal() {
  if (!editor.value || !props.articleId) return
  const { from, to } = editor.value.state.selection
  if (from === to) return
  // Sérialise la sélection en HTML (préserve gras / liens / structure).
  const slice = editor.value.state.doc.slice(from, to)
  const result = editor.value.view.serializeForClipboard(slice)
  rewriteSelectionHtml.value = result.dom.innerHTML || ''
  if (rewriteSelectionHtml.value) rewriteSelectionModalOpen.value = true
}

function applyRewrittenSelection(data) {
  if (!editor.value || !data?.html) return
  editor.value
    .chain()
    .focus()
    .deleteSelection()
    .insertContent(data.html)
    .run()
  rewriteSelectionModalOpen.value = false
  emit('update:modelValue', editor.value.getHTML())
}

// ── Bouton IA "Réécrire avec IA" ──────────────────────────────────
const aiRunning = ref(false)
async function rewriteWithAi() {
  if (!props.articleId) return
  aiRunning.value = true
  try {
    const { data } = await api.post('/faq/ai/rewrite', { article_id: props.articleId })
    if (data.html) {
      editor.value?.commands.setContent(data.html, true)
      emit('update:modelValue', data.html)
    }
    if (data.suggested_title) emit('suggested-title', data.suggested_title)
    emit('rewritten', data)
    success('Article réécrit par l\'IA')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de la réécriture IA')
  } finally {
    aiRunning.value = false
  }
}

const editorClass = computed(() => 'prose prose-sm max-w-none focus:outline-none px-4 py-3')
</script>

<template>
  <div class="border border-gray-200 rounded-lg bg-white">
    <!-- Toolbar (sticky pour rester visible sur articles longs) -->
    <div class="sticky top-0 z-10 flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-200 bg-gray-50/95 backdrop-blur-sm rounded-t-lg flex-wrap">
      <!-- Headings -->
      <button type="button" @click="setHeading(1)" :class="['p-1.5 rounded hover:bg-gray-200 transition', isActive('heading', { level: 1 }) ? 'bg-gray-200 text-gray-900' : 'text-gray-600']" title="Titre H1">
        <H1Icon class="w-4 h-4" />
      </button>
      <button type="button" @click="setHeading(2)" :class="['p-1.5 rounded hover:bg-gray-200 transition', isActive('heading', { level: 2 }) ? 'bg-gray-200 text-gray-900' : 'text-gray-600']" title="Titre H2">
        <H2Icon class="w-4 h-4" />
      </button>
      <button type="button" @click="setHeading(3)" :class="['p-1.5 rounded hover:bg-gray-200 transition', isActive('heading', { level: 3 }) ? 'bg-gray-200 text-gray-900' : 'text-gray-600']" title="Titre H3">
        <H3Icon class="w-4 h-4" />
      </button>

      <span class="w-px h-5 bg-gray-200 mx-1.5" />

      <!-- Inline -->
      <button type="button" @click="editor?.chain().focus().toggleBold().run()" :class="['p-1.5 rounded hover:bg-gray-200 transition', isActive('bold') ? 'bg-gray-200 text-gray-900' : 'text-gray-600']" title="Gras">
        <BoldIcon class="w-4 h-4" />
      </button>
      <button type="button" @click="editor?.chain().focus().toggleItalic().run()" :class="['p-1.5 rounded hover:bg-gray-200 transition', isActive('italic') ? 'bg-gray-200 text-gray-900' : 'text-gray-600']" title="Italique">
        <ItalicIcon class="w-4 h-4" />
      </button>
      <button type="button" @click="editor?.chain().focus().toggleUnderline().run()" :class="['p-1.5 rounded hover:bg-gray-200 transition', isActive('underline') ? 'bg-gray-200 text-gray-900' : 'text-gray-600']" title="Souligné">
        <UnderlineIcon class="w-4 h-4" />
      </button>
      <button type="button" @click="editor?.chain().focus().toggleHighlight().run()" :class="['p-1.5 rounded hover:bg-gray-200 transition', isActive('highlight') ? 'bg-yellow-200 text-gray-900' : 'text-gray-600']" title="Surligner">
        <span class="block w-4 h-4 text-xs font-bold leading-4 text-center">A</span>
      </button>

      <span class="w-px h-5 bg-gray-200 mx-1.5" />

      <!-- Lists -->
      <button type="button" @click="editor?.chain().focus().toggleBulletList().run()" :class="['p-1.5 rounded hover:bg-gray-200 transition', isActive('bulletList') ? 'bg-gray-200 text-gray-900' : 'text-gray-600']" title="Liste à puces">
        <ListBulletIcon class="w-4 h-4" />
      </button>
      <button type="button" @click="editor?.chain().focus().toggleOrderedList().run()" :class="['p-1.5 rounded hover:bg-gray-200 transition', isActive('orderedList') ? 'bg-gray-200 text-gray-900' : 'text-gray-600']" title="Liste numérotée">
        <NumberedListIcon class="w-4 h-4" />
      </button>

      <span class="w-px h-5 bg-gray-200 mx-1.5" />

      <!-- Citation simple -->
      <button type="button" @click="editor?.chain().focus().wrapIn('blockquote', { variant: null }).run()"
              :class="['p-1.5 rounded hover:bg-gray-200 transition', isActive('blockquote') && !editor?.getAttributes('blockquote').variant ? 'bg-gray-200 text-gray-900' : 'text-gray-600']"
              title="Citation">
        <ChatBubbleBottomCenterTextIcon class="w-4 h-4" />
      </button>
      <button type="button" @click="editor?.chain().focus().toggleCodeBlock().run()" :class="['p-1.5 rounded hover:bg-gray-200 transition', isActive('codeBlock') ? 'bg-gray-200 text-gray-900' : 'text-gray-600']" title="Bloc de code">
        <CodeBracketIcon class="w-4 h-4" />
      </button>

      <span class="w-px h-5 bg-gray-200 mx-1.5" />

      <!-- Encarts Crisp : tip / info / warning -->
      <button type="button" @click="toggleCallout('tip')"
              :class="['p-1.5 rounded transition', isCalloutVariant('tip') ? 'bg-green-100 text-green-700' : 'text-gray-600 hover:bg-gray-200']"
              title="Encart Astuce (vert)">
        <LightBulbIcon class="w-4 h-4" />
      </button>
      <button type="button" @click="toggleCallout('info')"
              :class="['p-1.5 rounded transition', isCalloutVariant('info') ? 'bg-yellow-100 text-yellow-700' : 'text-gray-600 hover:bg-gray-200']"
              title="Encart Information (jaune)">
        <InformationCircleIcon class="w-4 h-4" />
      </button>
      <button type="button" @click="toggleCallout('warning')"
              :class="['p-1.5 rounded transition', isCalloutVariant('warning') ? 'bg-orange-100 text-orange-700' : 'text-gray-600 hover:bg-gray-200']"
              title="Encart Avertissement (orange)">
        <ExclamationTriangleIcon class="w-4 h-4" />
      </button>

      <span class="w-px h-5 bg-gray-200 mx-1.5" />

      <!-- Link -->
      <button type="button" @click="openLink" :class="['p-1.5 rounded hover:bg-gray-200 transition', isActive('link') ? 'bg-gray-200 text-gray-900' : 'text-gray-600']" title="Lien externe (URL)">
        <LinkIcon class="w-4 h-4" />
      </button>
      <button type="button" @click="openArticleLink"
              class="p-1.5 rounded hover:bg-gray-200 transition text-gray-600"
              title="Lien vers un autre article FAQ">
        <BookOpenIcon class="w-4 h-4" />
      </button>

      <!-- Image upload -->
      <button type="button" @click="triggerImagePicker" :disabled="uploading"
              class="p-1.5 rounded hover:bg-gray-200 transition text-gray-600 disabled:opacity-50" title="Insérer une image">
        <PhotoIcon class="w-4 h-4" :class="uploading ? 'animate-pulse' : ''" />
      </button>
      <input ref="imageInputRef" type="file" accept="image/png,image/jpeg,image/webp,image/gif"
             class="hidden" @change="onImageSelected" />

      <!-- IA — pousser à droite -->
      <div v-if="articleId" class="ml-auto">
        <button type="button" @click="rewriteWithAi" :disabled="aiRunning"
                class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 transition whitespace-nowrap disabled:opacity-50">
          <SparklesIcon class="w-3.5 h-3.5 shrink-0" :class="aiRunning ? 'animate-pulse' : ''" />
          {{ aiRunning ? 'Réécriture…' : 'Réécrire avec IA' }}
        </button>
      </div>
    </div>

    <!-- Content -->
    <div class="overflow-y-auto" :style="{ minHeight: minHeight }"
         @drop="onDrop" @dragover.prevent @click="onEditorClick" @paste="onPaste">
      <!-- BubbleMenu : apparaît au-dessus d'une sélection non-vide. Permet de
           réécrire le passage avec l'IA en gardant le contexte article. -->
      <BubbleMenu v-if="editor && articleId" :editor="editor"
                  :should-show="({ editor: ed, from, to }) => from !== to && !ed.isActive('image')">
        <div class="inline-flex items-center gap-1 px-1 py-1 bg-white border border-gray-200 rounded-lg shadow-md">
          <button type="button" @click="openRewriteSelectionModal"
                  class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded text-violet-700 hover:bg-violet-50 transition whitespace-nowrap font-medium"
                  title="Réécrire la sélection avec l'IA">
            <SparklesIcon class="w-3.5 h-3.5 shrink-0" />
            Réécrire avec IA
          </button>
        </div>
      </BubbleMenu>

      <EditorContent :editor="editor" :class="editorClass" />
    </div>

    <LinkInputModal v-if="linkModalOpen" :initial-url="linkPrefill"
                    @close="linkModalOpen = false" @save="applyLink" />

    <FaqArticleLinkModal v-if="articleLinkModalOpen"
                         @close="articleLinkModalOpen = false"
                         @select="onArticleLinkSelect" />

    <FaqRewriteSelectionModal v-if="rewriteSelectionModalOpen"
                              :article-id="articleId"
                              :selection-html="rewriteSelectionHtml"
                              @close="rewriteSelectionModalOpen = false"
                              @rewritten="applyRewrittenSelection" />
  </div>
</template>

<style scoped>
:deep(.ProseMirror) {
  outline: none;
  min-height: inherit;
}
:deep(.ProseMirror h1) { font-size: 1.875rem; font-weight: 700; line-height: 1.2; margin-top: 0.5em; margin-bottom: 0.4em; }
:deep(.ProseMirror h2) { font-size: 1.5rem;   font-weight: 700; line-height: 1.25; margin-top: 0.6em; margin-bottom: 0.4em; }
:deep(.ProseMirror h3) { font-size: 1.25rem;  font-weight: 600; line-height: 1.3; margin-top: 0.7em; margin-bottom: 0.35em; }
:deep(.ProseMirror h4) { font-size: 1.05rem;  font-weight: 600; line-height: 1.35; margin-top: 0.7em; margin-bottom: 0.3em; }
:deep(.ProseMirror p)  { margin: 0.5em 0; line-height: 1.6; }
:deep(.ProseMirror ul) { list-style: disc; padding-left: 1.5rem; margin: 0.5em 0; }
:deep(.ProseMirror ol) { list-style: decimal; padding-left: 1.5rem; margin: 0.5em 0; }
:deep(.ProseMirror li) { margin: 0.25em 0; }
:deep(.ProseMirror li > p) { margin: 0.1em 0; }
/* Citation neutre (sans variante) */
:deep(.ProseMirror blockquote) {
  border-left: 3px solid #d1d5db;
  padding: 0.5rem 1rem;
  margin: 0.7em 0;
  color: #4b5563;
  font-style: italic;
  background: transparent;
  border-radius: 0 0.25rem 0.25rem 0;
}
/* Encarts Crisp : couleurs officielles */
:deep(.ProseMirror blockquote.callout-tip) {
  background: #ecfdf5;
  border-left: 4px solid #22c55e;
  color: #064e3b;
  font-style: normal;
  padding: 0.875rem 1.25rem;
  border-radius: 0 0.5rem 0.5rem 0;
}
:deep(.ProseMirror blockquote.callout-info) {
  background: #fefce8;
  border-left: 4px solid #eab308;
  color: #422006;
  font-style: normal;
  padding: 0.875rem 1.25rem;
  border-radius: 0 0.5rem 0.5rem 0;
}
:deep(.ProseMirror blockquote.callout-warning) {
  background: #fff7ed;
  border-left: 4px solid #f97316;
  color: #431407;
  font-style: normal;
  padding: 0.875rem 1.25rem;
  border-radius: 0 0.5rem 0.5rem 0;
}
:deep(.ProseMirror blockquote.callout-tip > p:first-child),
:deep(.ProseMirror blockquote.callout-info > p:first-child),
:deep(.ProseMirror blockquote.callout-warning > p:first-child) {
  margin-top: 0;
}
:deep(.ProseMirror blockquote.callout-tip > p:last-child),
:deep(.ProseMirror blockquote.callout-info > p:last-child),
:deep(.ProseMirror blockquote.callout-warning > p:last-child) {
  margin-bottom: 0;
}
:deep(.ProseMirror code) { background: #f3f4f6; border-radius: 3px; padding: 1px 4px; font-size: 0.9em; }
:deep(.ProseMirror pre) { background: #1f2937; color: #f9fafb; padding: 0.75rem 1rem; border-radius: 0.5rem; overflow-x: auto; margin: 0.7em 0; }
:deep(.ProseMirror pre code) { background: transparent; color: inherit; padding: 0; }
:deep(.ProseMirror img) { max-width: 100%; height: auto; border-radius: 0.5rem; margin: 0.5em 0; display: block; }
:deep(.ProseMirror mark) { background: #fef08a; padding: 0 2px; border-radius: 2px; }
:deep(.ProseMirror a) { color: #4f46e5; text-decoration: underline; }

/* Image placeholder (suggérée par l'IA) — affichage skeleton interactif */
:deep(.ProseMirror img.faq-img-placeholder),
:deep(.ProseMirror img[data-placeholder="true"]) {
  width: 100%;
  height: 180px;
  background: repeating-linear-gradient(
    45deg,
    #f3f4f6,
    #f3f4f6 12px,
    #e5e7eb 12px,
    #e5e7eb 24px
  );
  border: 2px dashed #c7d2fe;
  border-radius: 0.5rem;
  cursor: pointer;
  position: relative;
  object-fit: cover;
  margin: 0.7em 0;
  /* Cache l'image cassée (src placeholder://...) en l'affichant transparente */
  color: transparent;
  font-size: 0;
}
:deep(.ProseMirror img.faq-img-placeholder::after),
:deep(.ProseMirror img[data-placeholder="true"]::after) {
  content: "📷  Cliquer pour téléverser : " attr(alt);
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: #4338ca;
  background: rgba(255, 255, 255, 0.6);
  border-radius: inherit;
}
:deep(.ProseMirror img.faq-img-placeholder:hover),
:deep(.ProseMirror img[data-placeholder="true"]:hover) {
  border-color: #6366f1;
  background-color: #eef2ff;
}

:deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  color: #9ca3af;
  pointer-events: none;
  height: 0;
  float: left;
}
</style>
