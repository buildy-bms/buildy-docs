<script setup>
/**
 * Page Release Notes — historique des nouveautés / correctifs de Buildy
 * Docs, en langage fonctionnel pour les collegues non techniques.
 *
 * Source de verite : `frontend/src/release-notes.json`. A maintenir
 * manuellement a chaque bump de version (cf. CLAUDE.md - feedback
 * `feedback_buildy_docs_version_bump.md`).
 *
 * Acces : clic sur le numero de version en bas de la sidebar (route
 * `/release-notes`).
 */
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeftIcon, SparklesIcon, WrenchScrewdriverIcon, BugAntIcon, ArrowsPointingOutIcon } from '@heroicons/vue/24/outline'
import notes from '@/release-notes.json'

const router = useRouter()

// Mapping kind → icone + couleur. Sert au visuel par highlight.
const KIND_META = {
  feature: { icon: SparklesIcon,             bg: 'bg-emerald-50',  text: 'text-emerald-700',  border: 'border-emerald-200', label: 'Nouveauté' },
  ux:      { icon: ArrowsPointingOutIcon,    bg: 'bg-indigo-50',   text: 'text-indigo-700',   border: 'border-indigo-200',  label: 'UX' },
  fix:     { icon: BugAntIcon,               bg: 'bg-amber-50',    text: 'text-amber-700',    border: 'border-amber-200',   label: 'Correctif' },
  perf:    { icon: WrenchScrewdriverIcon,    bg: 'bg-violet-50',   text: 'text-violet-700',   border: 'border-violet-200',  label: 'Performance' },
}
function metaFor(kind) { return KIND_META[kind] || KIND_META.feature }

function formatDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch { return iso }
}

const versions = computed(() => notes.versions || [])
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 py-8">
    <button
      type="button"
      @click="router.back()"
      class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-6"
    >
      <ArrowLeftIcon class="w-4 h-4" /> Retour
    </button>

    <header class="mb-8">
      <p class="text-xs font-semibold uppercase tracking-wider text-indigo-600 mb-2">Buildy Docs</p>
      <h1 class="text-3xl font-bold text-gray-900 mb-2">Notes de version</h1>
      <p class="text-sm text-gray-600 leading-relaxed">{{ notes.intro }}</p>
    </header>

    <ol class="space-y-10">
      <li v-for="v in versions" :key="v.version" class="relative">
        <!-- Pastille version + date -->
        <div class="flex items-baseline gap-3 mb-3 flex-wrap">
          <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-bold bg-indigo-600 text-white tabular-nums shrink-0">
            v{{ v.version }}
          </span>
          <span v-if="v.date" class="text-xs text-gray-400 tabular-nums">{{ formatDate(v.date) }}</span>
        </div>
        <h2 class="text-xl font-semibold text-gray-800 mb-4">{{ v.title }}</h2>

        <!-- Liste highlights -->
        <ul class="space-y-4">
          <li
            v-for="(h, i) in v.highlights"
            :key="i"
            class="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow transition-shadow"
          >
            <div class="flex items-start gap-3">
              <span :class="['inline-flex items-center justify-center w-9 h-9 rounded-lg border shrink-0', metaFor(h.kind).bg, metaFor(h.kind).border]">
                <component :is="metaFor(h.kind).icon" :class="['w-5 h-5', metaFor(h.kind).text]" />
              </span>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span :class="['text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full', metaFor(h.kind).bg, metaFor(h.kind).text]">
                    {{ metaFor(h.kind).label }}
                  </span>
                  <h3 class="text-base font-semibold text-gray-800">{{ h.title }}</h3>
                </div>

                <dl class="mt-3 space-y-2 text-sm">
                  <div v-if="h.what">
                    <dt class="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-0.5">Quoi</dt>
                    <dd class="text-gray-700 leading-relaxed">{{ h.what }}</dd>
                  </div>
                  <div v-if="h.where">
                    <dt class="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-0.5">Où</dt>
                    <dd class="text-gray-700 leading-relaxed">{{ h.where }}</dd>
                  </div>
                  <div v-if="h.how_to_test">
                    <dt class="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-0.5">Comment tester</dt>
                    <dd class="text-gray-700 leading-relaxed">{{ h.how_to_test }}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </li>
        </ul>
      </li>
    </ol>

    <p v-if="notes.ancien_changelog_note" class="mt-12 text-xs text-gray-400 italic text-center border-t border-gray-100 pt-6">
      {{ notes.ancien_changelog_note }}
    </p>
  </div>
</template>
