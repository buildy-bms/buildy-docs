<script setup>
import { ref, watch, onBeforeUnmount, computed } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import {
  BoldIcon, ItalicIcon, ListBulletIcon, NumberedListIcon,
  H1Icon, H2Icon, H3Icon, LinkIcon, ChatBubbleLeftRightIcon,
} from '@heroicons/vue/24/outline'
import { updateSection } from '@/api'
import { useAutosave } from '@/composables/useAutosave'
import AutosaveStatus from './AutosaveStatus.vue'
import ServiceLevelBadge from '@/components/ServiceLevelBadge.vue'

const props = defineProps({
  section: { type: Object, required: true },
})
const emit = defineEmits(['updated'])

// Titre éditable
const title = ref(props.section.title)
watch(() => props.section.id, () => {
  // Quand on change de section, on flush l'ancienne et reset
  flushAll()
  title.value = props.section.title
  if (editor.value) editor.value.commands.setContent(props.section.body_html || '')
})

const editor = useEditor({
  content: props.section.body_html || '',
  extensions: [
    StarterKit.configure({ heading: { levels: [2, 3, 4] } }),
    Placeholder.configure({
      placeholder: 'Commence à rédiger ici…',
      emptyEditorClass: 'is-editor-empty',
    }),
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
  ],
  editorProps: {
    attributes: {
      class: 'prose prose-sm max-w-none focus:outline-none min-h-[300px] py-4',
    },
  },
  onUpdate: ({ editor }) => {
    bodyAutosave.schedule(editor.getHTML())
  },
})

// Autosave body Tiptap
const bodyAutosave = useAutosave(async (html) => {
  const { data } = await updateSection(props.section.id, { body_html: html })
  emit('updated', data)
}, { delay: 800 })

// Autosave titre (debounce plus court car champ simple)
const titleAutosave = useAutosave(async (newTitle) => {
  const { data } = await updateSection(props.section.id, { title: newTitle })
  emit('updated', data)
}, { delay: 600 })

function onTitleInput() {
  if (title.value.trim() && title.value !== props.section.title) {
    titleAutosave.schedule(title.value)
  }
}

async function flushAll() {
  await Promise.all([bodyAutosave.flush(), titleAutosave.flush()])
}

// Status global = priorité error > saving > pending > saved > idle
const globalState = computed(() => {
  const states = [bodyAutosave.state.value, titleAutosave.state.value]
  if (states.includes('error')) return 'error'
  if (states.includes('saving')) return 'saving'
  if (states.includes('pending')) return 'pending'
  if (states.includes('saved')) return 'saved'
  return 'idle'
})
const globalLastSaved = computed(() => {
  const dates = [bodyAutosave.lastSaved.value, titleAutosave.lastSaved.value].filter(Boolean)
  return dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : null
})

onBeforeUnmount(() => {
  flushAll()
  editor.value?.destroy()
})

// Toolbar helpers
const isActive = (name, attrs) => editor.value?.isActive(name, attrs) || false
function setLink() {
  const previous = editor.value?.getAttributes('link').href || ''
  const url = window.prompt('URL du lien (vide pour retirer)', previous)
  if (url === null) return
  if (url === '') {
    editor.value.chain().focus().extendMarkRange('link').unsetLink().run()
  } else {
    editor.value.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }
}
</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200">
    <!-- Header section : numéro + titre éditable + badges + autosave -->
    <div class="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
      <span v-if="section.number" class="text-sm font-semibold text-gray-400 shrink-0">
        {{ section.number }}
      </span>
      <input
        v-model="title"
        @input="onTitleInput"
        type="text"
        placeholder="Titre de la section"
        class="flex-1 min-w-0 text-base font-semibold text-gray-800 bg-transparent border-0 focus:outline-none focus:ring-0 px-0"
      />
      <ServiceLevelBadge :level="section.service_level" />
      <span v-if="section.bacs_articles" class="inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded border bg-purple-50 text-purple-700 border-purple-200 whitespace-nowrap" :title="`Décret BACS — ${section.bacs_articles}`">
        ⚖️ {{ section.bacs_articles }}
      </span>
      <AutosaveStatus
        :state="globalState"
        :last-saved="globalLastSaved"
        :error="bodyAutosave.lastError.value || titleAutosave.lastError.value"
        class="ml-2 shrink-0"
      />
    </div>

    <!-- Toolbar Tiptap -->
    <div v-if="editor" class="flex items-center gap-1 px-3 py-2 border-b border-gray-100 bg-gray-50">
      <button @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
              :class="['p-1.5 rounded hover:bg-gray-200', isActive('heading', { level: 2 }) ? 'bg-gray-200 text-indigo-700' : 'text-gray-600']"
              title="Titre niveau 2"><H2Icon class="w-4 h-4" /></button>
      <button @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
              :class="['p-1.5 rounded hover:bg-gray-200', isActive('heading', { level: 3 }) ? 'bg-gray-200 text-indigo-700' : 'text-gray-600']"
              title="Titre niveau 3"><H3Icon class="w-4 h-4" /></button>
      <span class="w-px h-5 bg-gray-300 mx-1"></span>
      <button @click="editor.chain().focus().toggleBold().run()"
              :class="['p-1.5 rounded hover:bg-gray-200', isActive('bold') ? 'bg-gray-200 text-indigo-700' : 'text-gray-600']"
              title="Gras"><BoldIcon class="w-4 h-4" /></button>
      <button @click="editor.chain().focus().toggleItalic().run()"
              :class="['p-1.5 rounded hover:bg-gray-200', isActive('italic') ? 'bg-gray-200 text-indigo-700' : 'text-gray-600']"
              title="Italique"><ItalicIcon class="w-4 h-4" /></button>
      <span class="w-px h-5 bg-gray-300 mx-1"></span>
      <button @click="editor.chain().focus().toggleBulletList().run()"
              :class="['p-1.5 rounded hover:bg-gray-200', isActive('bulletList') ? 'bg-gray-200 text-indigo-700' : 'text-gray-600']"
              title="Liste à puces"><ListBulletIcon class="w-4 h-4" /></button>
      <button @click="editor.chain().focus().toggleOrderedList().run()"
              :class="['p-1.5 rounded hover:bg-gray-200', isActive('orderedList') ? 'bg-gray-200 text-indigo-700' : 'text-gray-600']"
              title="Liste numérotée"><NumberedListIcon class="w-4 h-4" /></button>
      <span class="w-px h-5 bg-gray-300 mx-1"></span>
      <button @click="editor.chain().focus().toggleBlockquote().run()"
              :class="['p-1.5 rounded hover:bg-gray-200', isActive('blockquote') ? 'bg-gray-200 text-indigo-700' : 'text-gray-600']"
              title="Citation"><ChatBubbleLeftRightIcon class="w-4 h-4" /></button>
      <button @click="setLink"
              :class="['p-1.5 rounded hover:bg-gray-200', isActive('link') ? 'bg-gray-200 text-indigo-700' : 'text-gray-600']"
              title="Lien"><LinkIcon class="w-4 h-4" /></button>
    </div>

    <!-- Éditeur Tiptap -->
    <div class="px-5">
      <EditorContent :editor="editor" />
    </div>
  </div>
</template>

<style>
/* Tiptap placeholder (paragraphes vides) */
.ProseMirror p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  float: left;
  color: #9ca3af;
  pointer-events: none;
  height: 0;
  font-style: italic;
}
.ProseMirror:focus { outline: none; }
.ProseMirror h2 { font-size: 1.125rem; font-weight: 600; margin-top: 1.5rem; margin-bottom: 0.5rem; color: #1f2937; }
.ProseMirror h3 { font-size: 1rem; font-weight: 600; margin-top: 1rem; margin-bottom: 0.5rem; color: #374151; }
.ProseMirror p { margin: 0.5rem 0; line-height: 1.65; color: #374151; }
.ProseMirror ul, .ProseMirror ol { padding-left: 1.5rem; margin: 0.5rem 0; }
.ProseMirror li { margin: 0.25rem 0; }
.ProseMirror blockquote { border-left: 3px solid #d1d5db; padding-left: 1rem; margin: 1rem 0; color: #6b7280; font-style: italic; }
.ProseMirror a { color: #4f46e5; text-decoration: underline; }
</style>
