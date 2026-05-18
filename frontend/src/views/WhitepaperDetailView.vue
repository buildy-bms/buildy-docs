<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import {
  ArrowLeftIcon, PlusIcon, TrashIcon, ChevronUpIcon, ChevronDownIcon,
  ArrowDownTrayIcon, DocumentTextIcon, BookOpenIcon,
} from '@heroicons/vue/24/outline'
import { useWhitepaperStore } from '@/stores/whitepaper'
import { exportWhitepaperPdf } from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import WhitepaperRichTextEditor from '@/components/WhitepaperRichTextEditor.vue'

const route = useRoute()
const router = useRouter()
const store = useWhitepaperStore()
const { whitepaper, chapters, companions, currentChapter, loading, saving, isCompanion } = storeToRefs(store)
const { success, error } = useNotification()
const { confirm } = useConfirm()

const exporting = ref(false)
const newChapterTitle = ref('')
const addingChapter = ref(false)

const AUDIENCE_LABELS = {
  property_manager: 'Property manager',
  asset_manager: 'Asset manager',
  moa_moe: 'MOA / MOE / BE',
  exploitant: 'Exploitant',
}

const isPublished = computed(() => whitepaper.value?.status === 'published')

// ── Sauvegarde auto du chapitre (debounce 800ms) ────────────────────
let saveTimer = null
function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => store.saveCurrentChapter().catch(() => error('Échec de la sauvegarde')), 800)
}
watch(() => currentChapter.value?.body_html, (v, old) => { if (old !== undefined) scheduleSave() })

function onTitleInput() { scheduleSave() }

async function selectChapter(id) {
  clearTimeout(saveTimer)
  await store.saveCurrentChapter().catch(() => {})
  await store.selectChapter(id)
}

async function addChapter() {
  const title = newChapterTitle.value.trim() || `Chapitre ${chapters.value.length + 1}`
  addingChapter.value = true
  try {
    await store.addChapter(title)
    newChapterTitle.value = ''
  } catch {
    error('Échec de l\'ajout du chapitre')
  } finally {
    addingChapter.value = false
  }
}

async function removeChapter(ch) {
  const ok = await confirm({
    title: 'Supprimer ce chapitre ?',
    message: `« ${ch.title} » sera définitivement supprimé.`,
    confirmLabel: 'Supprimer', danger: true,
  })
  if (!ok) return
  try { await store.removeChapter(ch.id); success('Chapitre supprimé') }
  catch { error('Échec de la suppression') }
}

async function move(ch, direction) {
  try { await store.moveChapter(ch.id, direction) }
  catch { error('Échec du déplacement') }
}

async function saveMetaField(field, value) {
  try { await store.saveMeta({ [field]: value }) }
  catch { error('Échec de la mise à jour') }
}

async function togglePublished() {
  await saveMetaField('status', isPublished.value ? 'draft' : 'published')
  success(isPublished.value ? 'Livre blanc publié' : 'Repassé en brouillon')
}

async function exportPdf() {
  exporting.value = true
  try {
    const { data } = await exportWhitepaperPdf(whitepaper.value.id)
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = `${whitepaper.value.slug || 'livre-blanc'}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    error(e.response?.data?.detail || 'Échec de l\'export PDF')
  } finally {
    exporting.value = false
  }
}

async function removeWhitepaper() {
  const ok = await confirm({
    title: 'Supprimer ce livre blanc ?',
    message: `« ${whitepaper.value.title} » et ses documents compagnons seront supprimés.`,
    confirmLabel: 'Supprimer', danger: true,
  })
  if (!ok) return
  try {
    await store.remove()
    success('Livre blanc supprimé')
    router.push({ name: 'whitepapers' })
  } catch { error('Échec de la suppression') }
}

function openCompanion(c) {
  router.push({ name: 'whitepaper-detail', params: { id: c.id } })
}

onMounted(async () => {
  try { await store.load(parseInt(route.params.id, 10)) }
  catch { error('Livre blanc introuvable'); router.push({ name: 'whitepapers' }) }
})
onBeforeUnmount(() => { clearTimeout(saveTimer); store.reset() })

// Recharge si on navigue vers un autre livre blanc (compagnon)
watch(() => route.params.id, async (id) => {
  if (id) { try { await store.load(parseInt(id, 10)) } catch { /* */ } }
})
</script>

<template>
  <div v-if="loading && !whitepaper" class="text-center py-16 text-gray-400 text-sm">Chargement…</div>

  <div v-else-if="whitepaper" class="max-w-7xl mx-auto">
    <!-- Toolbar -->
    <div class="flex items-center justify-between gap-4 mb-5">
      <div class="flex items-center gap-3 min-w-0">
        <button @click="router.push({ name: 'whitepapers' })" class="p-1.5 text-gray-400 hover:text-gray-700 shrink-0">
          <ArrowLeftIcon class="w-5 h-5" />
        </button>
        <input
          :value="whitepaper.title"
          @input="store.whitepaper.title = $event.target.value"
          @change="saveMetaField('title', whitepaper.title)"
          class="text-xl font-semibold text-gray-800 bg-transparent border-0 focus:outline-none focus:ring-0 min-w-0 truncate"
        />
        <span v-if="isCompanion" class="px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-700 shrink-0">
          Compagnon
        </span>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <span class="text-xs text-gray-400">{{ saving ? 'Enregistrement…' : 'Tout enregistré' }}</span>
        <button
          @click="exportPdf"
          :disabled="exporting"
          class="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
        >
          <ArrowDownTrayIcon class="w-4 h-4 shrink-0" />
          {{ exporting ? 'Export…' : 'Export PDF' }}
        </button>
        <button
          @click="togglePublished"
          class="inline-flex items-center px-3 py-2 text-sm font-medium rounded-lg whitespace-nowrap"
          :class="isPublished ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-indigo-600 text-white hover:bg-indigo-700'"
        >
          {{ isPublished ? 'Publié ✓' : 'Publier' }}
        </button>
        <button @click="removeWhitepaper" class="p-2 text-gray-400 hover:text-red-600" v-tooltip="'Supprimer'">
          <TrashIcon class="w-4 h-4" />
        </button>
      </div>
    </div>

    <div class="flex gap-5 items-start">
      <!-- Sidebar gauche -->
      <aside class="w-72 shrink-0 space-y-4">
        <!-- Chapitres -->
        <div class="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div class="px-3 py-2 border-b border-gray-100 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Chapitres
          </div>
          <ul>
            <li
              v-for="(ch, i) in chapters"
              :key="ch.id"
              @click="selectChapter(ch.id)"
              class="group flex items-center gap-1.5 px-3 py-2 text-sm cursor-pointer border-b border-gray-50 last:border-0"
              :class="currentChapter?.id === ch.id ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700 hover:bg-gray-50'"
            >
              <span class="flex-1 truncate">{{ ch.title }}</span>
              <span v-if="ch.is_empty" class="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" v-tooltip="'Vide'" />
              <span class="hidden group-hover:flex items-center gap-0.5 shrink-0">
                <button v-if="i > 0" @click.stop="move(ch, 'up')" class="p-0.5 text-gray-400 hover:text-gray-700">
                  <ChevronUpIcon class="w-3.5 h-3.5" />
                </button>
                <button v-if="i < chapters.length - 1" @click.stop="move(ch, 'down')" class="p-0.5 text-gray-400 hover:text-gray-700">
                  <ChevronDownIcon class="w-3.5 h-3.5" />
                </button>
                <button @click.stop="removeChapter(ch)" class="p-0.5 text-gray-400 hover:text-red-600">
                  <TrashIcon class="w-3.5 h-3.5" />
                </button>
              </span>
            </li>
            <li v-if="!chapters.length" class="px-3 py-3 text-xs text-gray-400">Aucun chapitre.</li>
          </ul>
          <div class="flex gap-1.5 p-2 border-t border-gray-100">
            <input
              v-model="newChapterTitle"
              @keydown.enter="addChapter"
              type="text"
              placeholder="Titre du chapitre…"
              class="flex-1 min-w-0 px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
            <button
              @click="addChapter"
              :disabled="addingChapter"
              class="p-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 shrink-0"
            >
              <PlusIcon class="w-4 h-4" />
            </button>
          </div>
        </div>

        <!-- Métadonnées -->
        <div class="bg-white rounded-lg border border-gray-200 p-3 space-y-3">
          <div class="text-xs font-semibold uppercase tracking-wider text-gray-500">Métadonnées</div>
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">Audience</label>
            <select
              :value="whitepaper.audience || ''"
              @change="saveMetaField('audience', $event.target.value || null)"
              class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            >
              <option value="">Non précisée</option>
              <option v-for="(label, key) in AUDIENCE_LABELS" :key="key" :value="key">{{ label }}</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-500 mb-1">Version</label>
            <input
              :value="whitepaper.version || ''"
              @change="saveMetaField('version', $event.target.value || null)"
              type="text" placeholder="1.0"
              class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>
          <div class="text-xs text-gray-400">
            Slug : <code class="text-gray-500">{{ whitepaper.slug }}</code>
          </div>
        </div>

        <!-- Compagnons (parent uniquement) -->
        <div v-if="!isCompanion" class="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div class="px-3 py-2 border-b border-gray-100 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Documents compagnons
          </div>
          <ul>
            <li
              v-for="c in companions"
              :key="c.id"
              @click="openCompanion(c)"
              class="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-0"
            >
              <DocumentTextIcon class="w-4 h-4 text-gray-400 shrink-0" />
              <span class="truncate">{{ c.title }}</span>
            </li>
            <li v-if="!companions.length" class="px-3 py-3 text-xs text-gray-400">
              Aucun compagnon. Les checklists et infographies liées apparaîtront ici.
            </li>
          </ul>
        </div>
      </aside>

      <!-- Éditeur central -->
      <main class="flex-1 min-w-0 bg-white rounded-lg border border-gray-200 p-6">
        <div v-if="currentChapter">
          <input
            v-model="currentChapter.title"
            @input="onTitleInput"
            placeholder="Titre du chapitre"
            class="w-full text-2xl font-semibold text-gray-800 bg-transparent border-0 border-b border-transparent focus:border-gray-200 focus:outline-none focus:ring-0 pb-2 mb-4"
          />
          <WhitepaperRichTextEditor
            v-model="currentChapter.body_html"
            placeholder="Rédigez le contenu du chapitre…"
            min-height="420px"
          />
        </div>
        <div v-else class="text-center py-20 text-gray-400">
          <BookOpenIcon class="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p class="text-sm">Sélectionnez un chapitre ou créez-en un pour commencer.</p>
        </div>
      </main>
    </div>
  </div>
</template>
