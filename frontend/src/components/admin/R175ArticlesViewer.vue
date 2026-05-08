<script setup>
/**
 * Visualiseur read-only des articles R175-1 à R175-6 du décret BACS.
 * Source : seed `bacs-articles.js` (page Notion « Décret BACS 2023 »),
 * exposé via `GET /api/bacs-articles`. Affiché en bas de l'onglet
 * « Textes PDF & Articles R175 » de la page /admin/bacs-parameters.
 *
 * L'article est volontairement non éditable depuis l'UI : c'est une
 * source de droit, modifiable uniquement par commit + déploiement.
 */
import { ref, computed, onMounted } from 'vue'
import { ChevronRightIcon, MagnifyingGlassIcon } from '@heroicons/vue/24/outline'
import { listBacsArticles } from '@/api'
import SafeHtml from '@/components/SafeHtml.vue'
import { useNotification } from '@/composables/useNotification'

const { error } = useNotification()

const articles = ref([])
const introHtml = ref('')
const loading = ref(true)
const query = ref('')
const expanded = ref(new Set())

onMounted(async () => {
  try {
    const { data } = await listBacsArticles()
    articles.value = data?.articles || []
    introHtml.value = data?.intro_html || ''
  } catch {
    error('Chargement des articles R175 impossible')
  } finally {
    loading.value = false
  }
})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return articles.value
  return articles.value.filter(a =>
    (a.title || '').toLowerCase().includes(q) ||
    (a.summary || '').toLowerCase().includes(q) ||
    (a.code || '').toLowerCase().includes(q)
  )
})

function toggle(code) {
  if (expanded.value.has(code)) expanded.value.delete(code)
  else expanded.value.add(code)
  // force reactivity
  expanded.value = new Set(expanded.value)
}
</script>

<template>
  <div>
    <header class="mb-3">
      <h2 class="text-sm font-semibold text-gray-800">📜 Articles R175 du décret BACS (lecture seule)</h2>
      <p class="text-[12px] text-gray-500 mt-0.5">
        Source : décret 2020-887 modifié 2023-259, codifié aux articles R175-1 à R175-6 du Code de la construction et de l'habitation.
        Ces textes sont intégrés en annexe A des PDF d'audit. Modification = nouveau seed + déploiement.
      </p>
    </header>

    <!-- Recherche -->
    <div class="relative mb-3">
      <MagnifyingGlassIcon class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
      <input type="text" v-model="query"
             placeholder="Rechercher dans les titres et résumés…"
             class="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500" />
    </div>

    <div v-if="loading" class="text-center py-12 text-gray-400 text-sm">Chargement…</div>

    <div v-else class="space-y-2">
      <!-- Intro générale (toujours visible quand pas de recherche) -->
      <div v-if="!query && introHtml"
           class="bg-indigo-50/50 border border-indigo-200 rounded-lg px-4 py-3">
        <div class="text-[11px] font-semibold uppercase tracking-wider text-indigo-700 mb-1.5">
          Vue d'ensemble du décret
        </div>
        <SafeHtml :html="introHtml" class="prose prose-sm max-w-none text-gray-700" />
      </div>

      <!-- Articles -->
      <article v-for="a in filtered" :key="a.code"
               class="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <button type="button" @click="toggle(a.code)"
                class="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 transition">
          <ChevronRightIcon
            :class="['w-4 h-4 mt-0.5 text-gray-400 shrink-0 transition-transform',
                     expanded.has(a.code) ? 'rotate-90' : '']" />
          <div class="flex-1 min-w-0">
            <div class="flex items-baseline gap-2 flex-wrap">
              <span class="font-mono text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">
                {{ a.code }}
              </span>
              <span class="font-semibold text-gray-900 text-sm">{{ a.title }}</span>
            </div>
            <p class="text-[13px] text-gray-600 mt-1">{{ a.summary }}</p>
          </div>
        </button>
        <div v-if="expanded.has(a.code)" class="px-4 py-3 border-t border-gray-100 bg-gray-50/50">
          <SafeHtml :html="a.full_html" class="prose prose-sm max-w-none text-gray-700" />
        </div>
      </article>

      <div v-if="!filtered.length" class="text-center py-8 text-sm text-gray-500 italic">
        Aucun article ne correspond à « {{ query }} ».
      </div>
    </div>
  </div>
</template>
