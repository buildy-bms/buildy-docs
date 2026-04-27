<script setup>
import { ref, watch, onBeforeUnmount, computed } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
// StarterKit (Tiptap 2.10+) inclut deja Link nativement.
import {
  BoldIcon, ItalicIcon, ListBulletIcon, NumberedListIcon,
  H1Icon, H2Icon, H3Icon, LinkIcon, ChatBubbleLeftRightIcon,
  SparklesIcon, StopIcon,
} from '@heroicons/vue/24/outline'
import { updateSection } from '@/api'
import { useAutosave } from '@/composables/useAutosave'
import { useClaudeDraft } from '@/composables/useClaudeDraft'
import { useNotification } from '@/composables/useNotification'
import AutosaveStatus from './AutosaveStatus.vue'
import ServiceLevelBadge from '@/components/ServiceLevelBadge.vue'
import BaseModal from '@/components/BaseModal.vue'
import BacsBadge from '@/components/BacsBadge.vue'
import BacsContextBox from '@/components/BacsContextBox.vue'

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
    StarterKit.configure({
      heading: { levels: [2, 3, 4] },
      link: { openOnClick: false, autolink: true, linkOnPaste: true },
    }),
    Placeholder.configure({
      placeholder: 'Commence à rédiger ici…',
      emptyEditorClass: 'is-editor-empty',
    }),
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

// ── Assistant Claude ──
const claudeStream = useClaudeDraft()
const { error: notifyError, success: notifySuccess } = useNotification()
const showClaudeModal = ref(false)
const claudeInstruction = ref('')
const claudePreview = ref('')
const claudeAction = ref('replace') // 'replace' | 'append'

function openClaude() {
  claudeInstruction.value = ''
  claudePreview.value = ''
  claudeAction.value = props.section.body_html ? 'append' : 'replace'
  showClaudeModal.value = true
}

async function runClaude() {
  claudePreview.value = ''
  await claudeStream.start(props.section.id, {
    instruction: claudeInstruction.value.trim() || null,
    onText: (chunk) => { claudePreview.value += chunk },
    onError: (msg) => notifyError(msg || 'Échec Claude'),
    onDone: () => { /* preview ready */ },
  })
}

function applyClaude() {
  if (!claudePreview.value.trim() || !editor.value) return
  if (claudeAction.value === 'replace') {
    editor.value.commands.setContent(claudePreview.value)
  } else {
    editor.value.commands.focus('end')
    editor.value.commands.insertContent(claudePreview.value)
  }
  bodyAutosave.schedule(editor.value.getHTML())
  notifySuccess('Brouillon Claude inséré dans la section.')
  showClaudeModal.value = false
}

function formatUpdatedAt(iso) {
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'à l\'instant'
  if (diff < 3600) return `il y a ${Math.round(diff / 60)} min`
  if (diff < 86400) return `il y a ${Math.round(diff / 3600)} h`
  return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

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
  <div class="bg-white rounded-none border border-gray-200">
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
      <BacsBadge v-if="section.bacs_articles" :reference="section.bacs_articles" :context="section.kind === 'equipment' ? 'equipment' : 'section'" />
      <AutosaveStatus
        :state="globalState"
        :last-saved="globalLastSaved"
        :error="bodyAutosave.lastError.value || titleAutosave.lastError.value"
        class="ml-2 shrink-0"
      />
    </div>

    <!-- Signature de derniere modif -->
    <div v-if="section.updated_by_name || section.updated_at" class="px-5 py-1 text-[10px] text-gray-400 border-b border-gray-100 bg-gray-50">
      Dernière modification {{ section.updated_by_name ? `par ${section.updated_by_name}` : '' }}
      <span v-if="section.updated_at"> · {{ formatUpdatedAt(section.updated_at) }}</span>
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
      <span class="flex-1"></span>
      <!-- Bouton Claude masqué temporairement (Lot 14.1) — code conservé, à réactiver plus tard -->
      <button v-if="false" @click="openClaude"
              class="inline-flex items-center gap-1 px-2 py-1 text-xs bg-linear-to-r from-violet-600 to-indigo-600 text-white rounded hover:from-violet-700 hover:to-indigo-700"
              title="Rédiger avec Claude">
        <SparklesIcon class="w-3.5 h-3.5" /> Claude
      </button>
    </div>

    <!-- Encart contextualisé "lien avec le décret BACS" (visible, éditable) -->
    <div v-if="section.bacs_articles" class="px-5 pt-4">
      <BacsContextBox
        :reference="section.bacs_articles"
        :justification="section.bacs_justification"
        :context="section.kind === 'equipment' ? 'equipment' : 'section'"
        :section-id="section.id"
        editable
        @updated="emit('updated', $event)"
      />
    </div>

    <!-- Éditeur Tiptap -->
    <div class="px-5">
      <EditorContent :editor="editor" />
    </div>
  </div>

  <BaseModal v-if="showClaudeModal" title="Rédiger avec Claude" size="lg" @close="showClaudeModal = false">
    <div class="space-y-3">
      <p class="text-xs text-gray-500">
        Claude va rédiger un brouillon pour cette section dans le style Buildy, en s'appuyant sur le contexte
        (titre, niveau de service, BACS, points équipement, instances réelles).
      </p>

      <div>
        <label class="block text-xs font-semibold text-gray-700 mb-1">Instruction spécifique (optionnel)</label>
        <input v-model="claudeInstruction" type="text" autocomplete="off" data-1p-ignore="true" data-bwignore="true" data-lpignore="true"
               placeholder="Ex : insiste sur la traçabilité des dérives, mentionne le tableau de bord QAI…"
               class="w-full px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      </div>

      <div class="flex items-center gap-3 text-xs">
        <span class="text-gray-700 font-semibold">Insertion :</span>
        <label class="inline-flex items-center gap-1">
          <input v-model="claudeAction" type="radio" value="replace" /> Remplacer le contenu
        </label>
        <label class="inline-flex items-center gap-1">
          <input v-model="claudeAction" type="radio" value="append" /> Ajouter à la suite
        </label>
      </div>

      <div class="border border-gray-200 rounded-none min-h-50 max-h-[40vh] overflow-y-auto bg-gray-50">
        <div v-if="!claudePreview && !claudeStream.streaming.value" class="p-6 text-center text-xs text-gray-400 italic">
          Le brouillon de Claude apparaîtra ici en streaming.
        </div>
        <div v-else class="prose prose-sm max-w-none p-4" v-html="claudePreview || ''"></div>
        <div v-if="claudeStream.streaming.value" class="px-4 py-2 text-[11px] text-indigo-600 border-t border-gray-200">
          <span class="inline-block w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse mr-1"></span>
          Claude rédige…
        </div>
      </div>
    </div>

    <template #footer>
      <button @click="showClaudeModal = false" class="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">
        Fermer
      </button>
      <button v-if="claudeStream.streaming.value" @click="claudeStream.abort"
              class="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-red-50 text-red-700 hover:bg-red-100">
        <StopIcon class="w-3.5 h-3.5" /> Arrêter
      </button>
      <button v-else-if="!claudePreview" @click="runClaude"
              class="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-linear-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700">
        <SparklesIcon class="w-3.5 h-3.5" /> Lancer Claude
      </button>
      <template v-else>
        <button @click="runClaude" class="px-3 py-1.5 text-xs border border-gray-300 hover:bg-gray-50">
          Régénérer
        </button>
        <button @click="applyClaude" class="px-3 py-1.5 text-xs bg-emerald-600 text-white hover:bg-emerald-700">
          {{ claudeAction === 'replace' ? 'Remplacer' : 'Ajouter' }}
        </button>
      </template>
    </template>
  </BaseModal>
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
