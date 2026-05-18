<script setup>
// Éditeur riche dédié aux livres blancs : titres H2/H3, gras/italique,
// listes, liens, image, et 3 types d'encadrés (info / conseil / attention)
// rendus en <blockquote class="callout-*"> — compatibles avec le template
// PDF whitepaper-book.hbs. Le node callout réutilise le pattern FaqBlockquote.
import { ref, watch, onBeforeUnmount } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Blockquote from '@tiptap/extension-blockquote'
import Placeholder from '@tiptap/extension-placeholder'
import Image from '@tiptap/extension-image'
import {
  BoldIcon, ItalicIcon, ListBulletIcon, NumberedListIcon, LinkIcon, PhotoIcon,
  InformationCircleIcon, LightBulbIcon, ExclamationTriangleIcon,
} from '@heroicons/vue/24/outline'
import LinkInputModal from './LinkInputModal.vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: 'Rédigez le contenu du chapitre…' },
  minHeight: { type: String, default: '420px' },
})
const emit = defineEmits(['update:modelValue'])

// ── Encadrés : blockquote + attribut variant → classe callout-{variant} ──
const CalloutBlockquote = Blockquote.extend({
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
      toggleCalloutVariant: (variant) => ({ commands, editor }) => {
        if (!editor.isActive('blockquote')) {
          return commands.wrapIn('blockquote', { variant })
        }
        const current = editor.getAttributes('blockquote').variant
        if (current === variant) return commands.lift('blockquote')
        return commands.updateAttributes('blockquote', { variant })
      },
    }
  },
})

const editor = useEditor({
  content: props.modelValue || '',
  extensions: [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      blockquote: false,
      link: { openOnClick: false, autolink: true, linkOnPaste: true },
    }),
    CalloutBlockquote,
    Image.configure({ inline: false, HTMLAttributes: { class: 'wp-img' } }),
    Placeholder.configure({ placeholder: props.placeholder, emptyEditorClass: 'is-editor-empty' }),
  ],
  editorProps: {
    attributes: {
      class: 'prose prose-sm max-w-none focus:outline-none px-4 py-3 wp-prose',
      style: `min-height: ${props.minHeight}`,
    },
  },
  onUpdate: ({ editor }) => emit('update:modelValue', editor.getHTML()),
})

watch(() => props.modelValue, (val) => {
  if (!editor.value) return
  if (val !== editor.value.getHTML()) editor.value.commands.setContent(val || '', false)
})
onBeforeUnmount(() => editor.value?.destroy())

const isActive = (name, attrs) => editor.value?.isActive(name, attrs) || false

// ── Lien ────────────────────────────────────────────────────────────
const showLinkModal = ref(false)
function setLink() {
  if (!editor.value) return
  showLinkModal.value = true
}
function onSaveLink(url) {
  if (!editor.value) return
  if (url === '') editor.value.chain().focus().extendMarkRange('link').unsetLink().run()
  else editor.value.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  showLinkModal.value = false
}

// ── Image (par URL) ─────────────────────────────────────────────────
function insertImage() {
  const url = window.prompt('URL de l\'image :')
  if (url) editor.value?.chain().focus().setImage({ src: url }).run()
}

const btn = 'p-1.5 rounded text-gray-600 hover:bg-gray-100 transition'
const btnActive = 'p-1.5 rounded bg-indigo-100 text-indigo-700 transition'
</script>

<template>
  <div v-if="editor" class="border border-gray-200 rounded-lg bg-white">
    <!-- Toolbar — sticky pour rester visible sur les chapitres longs -->
    <div class="sticky top-0 z-10 flex items-center gap-0.5 flex-wrap px-2 py-1.5 border-b border-gray-200 bg-gray-50/95 backdrop-blur-sm rounded-t-lg">
      <button type="button" v-tooltip="'Titre de section'"
              :class="isActive('heading', { level: 2 }) ? btnActive : btn"
              @click="editor.chain().focus().toggleHeading({ level: 2 }).run()">
        <span class="text-xs font-bold px-0.5">T1</span>
      </button>
      <button type="button" v-tooltip="'Sous-titre'"
              :class="isActive('heading', { level: 3 }) ? btnActive : btn"
              @click="editor.chain().focus().toggleHeading({ level: 3 }).run()">
        <span class="text-xs font-bold px-0.5">T2</span>
      </button>
      <span class="w-px h-5 bg-gray-200 mx-1"></span>
      <button type="button" v-tooltip="'Gras'" :class="isActive('bold') ? btnActive : btn"
              @click="editor.chain().focus().toggleBold().run()"><BoldIcon class="w-4 h-4" /></button>
      <button type="button" v-tooltip="'Italique'" :class="isActive('italic') ? btnActive : btn"
              @click="editor.chain().focus().toggleItalic().run()"><ItalicIcon class="w-4 h-4" /></button>
      <span class="w-px h-5 bg-gray-200 mx-1"></span>
      <button type="button" v-tooltip="'Liste à puces'" :class="isActive('bulletList') ? btnActive : btn"
              @click="editor.chain().focus().toggleBulletList().run()"><ListBulletIcon class="w-4 h-4" /></button>
      <button type="button" v-tooltip="'Liste numérotée'" :class="isActive('orderedList') ? btnActive : btn"
              @click="editor.chain().focus().toggleOrderedList().run()"><NumberedListIcon class="w-4 h-4" /></button>
      <span class="w-px h-5 bg-gray-200 mx-1"></span>
      <button type="button" v-tooltip="'Lien'" :class="isActive('link') ? btnActive : btn"
              @click="setLink"><LinkIcon class="w-4 h-4" /></button>
      <button type="button" v-tooltip="'Image'" :class="btn" @click="insertImage">
        <PhotoIcon class="w-4 h-4" />
      </button>
      <span class="w-px h-5 bg-gray-200 mx-1"></span>
      <button type="button" v-tooltip="'Encadré information'"
              :class="isActive('blockquote', { variant: 'info' }) ? btnActive : btn"
              @click="editor.chain().focus().toggleCalloutVariant('info').run()">
        <InformationCircleIcon class="w-4 h-4 text-slate-500" />
      </button>
      <button type="button" v-tooltip="'Encadré conseil'"
              :class="isActive('blockquote', { variant: 'tip' }) ? btnActive : btn"
              @click="editor.chain().focus().toggleCalloutVariant('tip').run()">
        <LightBulbIcon class="w-4 h-4 text-emerald-600" />
      </button>
      <button type="button" v-tooltip="'Encadré attention'"
              :class="isActive('blockquote', { variant: 'warning' }) ? btnActive : btn"
              @click="editor.chain().focus().toggleCalloutVariant('warning').run()">
        <ExclamationTriangleIcon class="w-4 h-4 text-amber-600" />
      </button>
    </div>

    <!-- Zone d'édition -->
    <EditorContent :editor="editor" class="wp-editor-content" />

    <LinkInputModal
      v-if="showLinkModal"
      :initial-url="editor.getAttributes('link').href || ''"
      @save="onSaveLink"
      @close="showLinkModal = false"
    />
  </div>
</template>

<style scoped>
.wp-editor-content :deep(.ProseMirror) { font-size: 14px; line-height: 1.6; }
.wp-editor-content :deep(.ProseMirror h2) { font-size: 1.35rem; font-weight: 700; color: #1b2842; margin: 1.2em 0 .4em; }
.wp-editor-content :deep(.ProseMirror h3) { font-size: 1.1rem; font-weight: 600; color: #1b2842; margin: 1em 0 .3em; }
.wp-editor-content :deep(.ProseMirror p) { margin: 0 0 .6em; }
.wp-editor-content :deep(.ProseMirror ul) { list-style: disc; padding-left: 1.3em; }
.wp-editor-content :deep(.ProseMirror ol) { list-style: decimal; padding-left: 1.3em; }
.wp-editor-content :deep(.ProseMirror a) { color: #4f46e5; text-decoration: underline; }
.wp-editor-content :deep(.ProseMirror img.wp-img) { max-width: 100%; border-radius: 6px; }
.wp-editor-content :deep(.ProseMirror blockquote) {
  border-left: 4px solid #1b2842; background: #f3f4f6;
  padding: .6em 1em; margin: .8em 0; border-radius: 0 6px 6px 0;
}
.wp-editor-content :deep(.ProseMirror blockquote.callout-tip) { border-left-color: #047857; background: #ecfdf5; }
.wp-editor-content :deep(.ProseMirror blockquote.callout-info) { border-left-color: #475569; background: #f1f5f9; }
.wp-editor-content :deep(.ProseMirror blockquote.callout-warning) { border-left-color: #b45309; background: #fffbeb; }
.wp-editor-content :deep(.ProseMirror blockquote p:last-child) { margin-bottom: 0; }
.wp-editor-content :deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder); float: left; color: #9ca3af; pointer-events: none; height: 0;
}
</style>
