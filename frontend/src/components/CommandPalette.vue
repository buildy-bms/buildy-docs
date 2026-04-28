<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick, computed } from 'vue'
import { useRouter } from 'vue-router'
import { MagnifyingGlassIcon, DocumentTextIcon, CubeIcon, BookOpenIcon } from '@heroicons/vue/24/outline'
import { search } from '@/api'

const router = useRouter()
const open = ref(false)
const q = ref('')
const results = ref([])
const loading = ref(false)
const flatItems = computed(() => {
  const out = []
  for (const af of results.value) {
    for (const s of af.sections) {
      out.push({ ...s, af_id: af.af_id, af_slug: af.af_slug, client_name: af.client_name, project_name: af.project_name })
    }
  }
  return out
})
const activeIndex = ref(0)
const inputEl = ref(null)

const KIND_ICON = {
  standard: DocumentTextIcon,
  equipment: CubeIcon,
  hyperveez_page: BookOpenIcon,
  synthesis: DocumentTextIcon,
}

let debounceTimer = null
function scheduleSearch() {
  clearTimeout(debounceTimer)
  if (q.value.trim().length < 2) {
    results.value = []
    return
  }
  debounceTimer = setTimeout(runSearch, 180)
}

async function runSearch() {
  loading.value = true
  try {
    const { data } = await search(q.value)
    results.value = data.items || []
    activeIndex.value = 0
  } catch (e) {
    results.value = []
  } finally {
    loading.value = false
  }
}

function openPalette() {
  open.value = true
  q.value = ''
  results.value = []
  nextTick(() => inputEl.value?.focus())
}

function closePalette() {
  open.value = false
}

function selectAt(idx) {
  const item = flatItems.value[idx]
  if (!item) return
  closePalette()
  router.push(`/afs/${item.af_id}`)
}

function onKey(e) {
  // Toggle Cmd+K / Ctrl+K (global)
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    open.value ? closePalette() : openPalette()
    return
  }
  if (!open.value) return
  if (e.key === 'Escape') return closePalette()
  if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex.value = Math.min(activeIndex.value + 1, flatItems.value.length - 1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex.value = Math.max(activeIndex.value - 1, 0) }
  else if (e.key === 'Enter') { e.preventDefault(); selectAt(activeIndex.value) }
}

watch(q, scheduleSearch)
onMounted(() => document.addEventListener('keydown', onKey))
onUnmounted(() => document.removeEventListener('keydown', onKey))
defineExpose({ openPalette, closePalette })
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-24 px-4" @click.self="closePalette">
      <div class="bg-white shadow-2xl w-full max-w-2xl rounded-xl border border-gray-200 flex flex-col max-h-[70vh] overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <MagnifyingGlassIcon class="w-4 h-4 text-gray-400 shrink-0" />
          <input
            ref="inputEl"
            v-model="q"
            type="text"
            placeholder="Rechercher dans toutes les AFs (titres + contenu)…"
            autocomplete="off"
            data-1p-ignore="true"
            data-bwignore="true"
            data-lpignore="true"
            class="flex-1 text-sm focus:outline-none"
          />
          <kbd class="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 font-mono">ESC</kbd>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto">
          <div v-if="loading" class="px-4 py-6 text-center text-xs text-gray-400">Recherche…</div>

          <div v-else-if="q.length < 2" class="px-4 py-6 text-center text-xs text-gray-400">
            Tape au moins 2 caractères pour lancer la recherche.
          </div>

          <div v-else-if="!results.length" class="px-4 py-6 text-center text-xs text-gray-400">
            Aucun résultat pour <strong class="text-gray-600">«&nbsp;{{ q }}&nbsp;»</strong>.
          </div>

          <div v-else>
            <template v-for="(af, afIdx) in results" :key="af.af_id">
              <div class="px-4 py-1.5 bg-gray-50 border-y border-gray-100 text-[11px] uppercase tracking-wider font-semibold text-gray-500">
                {{ af.client_name }} — {{ af.project_name }}
              </div>
              <button
                v-for="s in af.sections"
                :key="s.section_id"
                ref="itemEls"
                @click="selectAt(flatItems.findIndex(i => i.section_id === s.section_id))"
                @mouseenter="activeIndex = flatItems.findIndex(i => i.section_id === s.section_id)"
                :class="['w-full text-left px-4 py-2 flex items-start gap-2 border-b border-gray-50',
                  flatItems[activeIndex]?.section_id === s.section_id ? 'bg-indigo-50' : 'hover:bg-gray-50']"
              >
                <component :is="KIND_ICON[s.kind] || DocumentTextIcon" class="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                <div class="min-w-0 flex-1">
                  <p class="text-sm text-gray-800 truncate">
                    <span class="text-gray-400 font-mono mr-1">§ {{ s.number || '?' }}</span>
                    {{ s.title }}
                  </p>
                  <p v-if="s.snippet" class="text-[11px] text-gray-500 mt-0.5 truncate" v-html="s.snippet"></p>
                </div>
              </button>
            </template>
          </div>
        </div>

        <div class="px-4 py-2 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-400">
          <div class="flex items-center gap-3">
            <span><kbd class="px-1 py-0.5 bg-gray-100 font-mono">↑</kbd> <kbd class="px-1 py-0.5 bg-gray-100 font-mono">↓</kbd> naviguer</span>
            <span><kbd class="px-1 py-0.5 bg-gray-100 font-mono">↵</kbd> ouvrir</span>
          </div>
          <span><kbd class="px-1 py-0.5 bg-gray-100 font-mono">⌘ K</kbd> bascule</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
:deep(mark) { background: #fef3c7; color: #92400e; padding: 0 1px; }
</style>
