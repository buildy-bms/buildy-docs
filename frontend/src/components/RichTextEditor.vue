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
import { watch, onBeforeUnmount } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import {
  BoldIcon, ItalicIcon, ListBulletIcon, NumberedListIcon, LinkIcon,
} from '@heroicons/vue/24/outline'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: 'Commencez à écrire…' },
  minHeight: { type: String, default: '180px' },
})
const emit = defineEmits(['update:modelValue'])

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
  },
})

// Sync externe → éditeur (par exemple quand on charge un nouveau template)
watch(() => props.modelValue, (val) => {
  if (!editor.value) return
  if (val !== editor.value.getHTML()) {
    editor.value.commands.setContent(val || '', false)
  }
})

onBeforeUnmount(() => editor.value?.destroy())

const isActive = (name, attrs) => editor.value?.isActive(name, attrs) || false

function setLink() {
  const previous = editor.value?.getAttributes('link').href || ''
  const url = window.prompt('URL du lien (vide pour retirer)', previous)
  if (url === null) return
  if (url === '') editor.value.chain().focus().extendMarkRange('link').unsetLink().run()
  else editor.value.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
}
</script>

<template>
  <div class="border border-gray-300 rounded bg-white">
    <div v-if="editor" class="flex items-center gap-0.5 px-1.5 py-1 border-b border-gray-200 bg-gray-50">
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
    </div>
    <EditorContent :editor="editor" />
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
