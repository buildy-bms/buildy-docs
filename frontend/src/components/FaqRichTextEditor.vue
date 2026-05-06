<script setup>
/**
 * Éditeur Tiptap dédié à la FAQ Buildy / Crisp Knowledge Base.
 *
 * Différences vs RichTextEditor partagé :
 * - Headings H1-H4 (Crisp KB supporte H1-H6, on en expose 4)
 * - Underline + Highlight (équivalents `__` et `++` du markdown Crisp)
 * - Upload d'images via `/api/faq/upload-image` (push FTP -> URL publique)
 * - Pas de bouton Claude inline (la réécriture IA se fait depuis la toolbar
 *   de la vue parente, qui appelle un endpoint dédié `/api/faq/ai/rewrite`)
 */
import { ref, watch, onBeforeUnmount, computed } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import {
  BoldIcon, ItalicIcon, UnderlineIcon, ListBulletIcon, NumberedListIcon,
  LinkIcon, PhotoIcon, CodeBracketIcon, ChatBubbleBottomCenterTextIcon,
  H1Icon, H2Icon, H3Icon,
} from '@heroicons/vue/24/outline'
import api from '@/api'
import { useNotification } from '@/composables/useNotification'
import LinkInputModal from './LinkInputModal.vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: 'Rédigez l\'article…' },
  minHeight: { type: String, default: '320px' },
})
const emit = defineEmits(['update:modelValue'])
const { success, error: notifyError } = useNotification()

const editor = useEditor({
  content: props.modelValue || '',
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      // Link et Underline retirés du StarterKit pour utiliser nos versions custom
      link: false,
      underline: false,
    }),
    Placeholder.configure({ placeholder: props.placeholder }),
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
    Image.configure({ inline: false, allowBase64: false }),
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

function isActive(name, attrs) {
  return editor.value?.isActive(name, attrs) || false
}

function setHeading(level) {
  editor.value?.chain().focus().toggleHeading({ level }).run()
}

function openLink() {
  linkPrefill.value = editor.value?.getAttributes('link')?.href || ''
  linkModalOpen.value = true
}
function applyLink(href) {
  if (!editor.value) return
  if (!href) {
    editor.value.chain().focus().extendMarkRange('link').unsetLink().run()
  } else {
    editor.value.chain().focus().extendMarkRange('link').setLink({ href }).run()
  }
  linkModalOpen.value = false
}

// ── Image upload ────────────────────────────────────────────────────
const imageInputRef = ref(null)
const uploading = ref(false)
function triggerImagePicker() {
  imageInputRef.value?.click()
}
async function onImageSelected(e) {
  const file = e.target.files?.[0]
  e.target.value = '' // reset pour permettre re-upload du même fichier
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
    editor.value?.chain().focus().setImage({
      src: data.url,
      alt: file.name.replace(/\.[^.]+$/, ''),
      width: data.width || undefined,
    }).run()
    success('Image insérée')
  } catch (err) {
    notifyError(err.response?.data?.detail || 'Échec de l\'upload')
  } finally {
    uploading.value = false
  }
}

// Drag & drop d'images dans l'éditeur
function onDrop(e) {
  const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'))
  if (!files.length) return
  e.preventDefault()
  for (const f of files) {
    onImageSelected({ target: { files: [f], value: '' } })
  }
}

const editorClass = computed(() => `prose prose-sm max-w-none focus:outline-none px-4 py-3`)
</script>

<template>
  <div class="border border-gray-200 rounded-lg bg-white overflow-hidden">
    <!-- Toolbar -->
    <div class="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-200 bg-gray-50/60 flex-wrap">
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

      <!-- Inline formatting -->
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

      <!-- Block -->
      <button type="button" @click="editor?.chain().focus().toggleBlockquote().run()" :class="['p-1.5 rounded hover:bg-gray-200 transition', isActive('blockquote') ? 'bg-gray-200 text-gray-900' : 'text-gray-600']" title="Citation">
        <ChatBubbleBottomCenterTextIcon class="w-4 h-4" />
      </button>
      <button type="button" @click="editor?.chain().focus().toggleCodeBlock().run()" :class="['p-1.5 rounded hover:bg-gray-200 transition', isActive('codeBlock') ? 'bg-gray-200 text-gray-900' : 'text-gray-600']" title="Bloc de code">
        <CodeBracketIcon class="w-4 h-4" />
      </button>

      <span class="w-px h-5 bg-gray-200 mx-1.5" />

      <!-- Link -->
      <button type="button" @click="openLink" :class="['p-1.5 rounded hover:bg-gray-200 transition', isActive('link') ? 'bg-gray-200 text-gray-900' : 'text-gray-600']" title="Lien">
        <LinkIcon class="w-4 h-4" />
      </button>

      <!-- Image -->
      <button type="button" @click="triggerImagePicker" :disabled="uploading"
              class="p-1.5 rounded hover:bg-gray-200 transition text-gray-600 disabled:opacity-50" title="Insérer une image">
        <PhotoIcon class="w-4 h-4" :class="uploading ? 'animate-pulse' : ''" />
      </button>
      <input ref="imageInputRef" type="file" accept="image/png,image/jpeg,image/webp,image/gif"
             class="hidden" @change="onImageSelected" />
    </div>

    <!-- Content -->
    <div class="overflow-y-auto" :style="{ minHeight: minHeight }" @drop="onDrop" @dragover.prevent>
      <EditorContent :editor="editor" :class="editorClass" />
    </div>

    <LinkInputModal v-if="linkModalOpen" :prefill="linkPrefill"
                    @close="linkModalOpen = false" @submit="applyLink" />
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
:deep(.ProseMirror blockquote) { border-left: 3px solid #d1d5db; padding-left: 1rem; margin: 0.7em 0; color: #4b5563; font-style: italic; }
:deep(.ProseMirror code) { background: #f3f4f6; border-radius: 3px; padding: 1px 4px; font-size: 0.9em; }
:deep(.ProseMirror pre) { background: #1f2937; color: #f9fafb; padding: 0.75rem 1rem; border-radius: 0.5rem; overflow-x: auto; margin: 0.7em 0; }
:deep(.ProseMirror pre code) { background: transparent; color: inherit; padding: 0; }
:deep(.ProseMirror img) { max-width: 100%; height: auto; border-radius: 0.5rem; margin: 0.5em 0; }
:deep(.ProseMirror mark) { background: #fef08a; padding: 0 2px; border-radius: 2px; }
:deep(.ProseMirror a) { color: #4f46e5; text-decoration: underline; }
:deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  color: #9ca3af;
  pointer-events: none;
  height: 0;
  float: left;
}
</style>
