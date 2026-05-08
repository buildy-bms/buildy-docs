<script setup>
/**
 * Page d'admin centralisant la configuration métier des audits BACS.
 *
 * Trois onglets :
 *  1. checklist  — Catalogue de la check-list documentaire (CRUD)
 *  2. pdf        — Textes annexes PDF (méthodologie + disclaimers)
 *                  + Articles R175 (lecture seule)
 *  3. prompts    — Prompts IA spécifiques BACS (synthèse R175,
 *                  synthèse Site, mapping transcript Plaud Pro)
 *
 * L'onglet actif est persisté dans le query string (?tab=...) pour
 * permettre le deep linking.
 */
import { computed, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Cog6ToothIcon, ClipboardDocumentCheckIcon, DocumentTextIcon, SparklesIcon } from '@heroicons/vue/24/outline'

// Async components : on ne charge le code de chaque onglet que quand
// l'utilisateur l'ouvre, pour limiter le poids initial de la page.
const BacsChecklistCatalogAdmin = defineAsyncComponent(() =>
  import('@/components/admin/BacsChecklistCatalogAdmin.vue'))
const BoilerplateAdmin = defineAsyncComponent(() =>
  import('@/components/admin/BoilerplateAdmin.vue'))
const R175ArticlesViewer = defineAsyncComponent(() =>
  import('@/components/admin/R175ArticlesViewer.vue'))
const BacsAiPromptsAdmin = defineAsyncComponent(() =>
  import('@/components/admin/BacsAiPromptsAdmin.vue'))

const route = useRoute()
const router = useRouter()

const TABS = [
  { key: 'checklist', label: 'Check-list documentaire', icon: ClipboardDocumentCheckIcon },
  { key: 'pdf',       label: 'Textes PDF & Articles R175', icon: DocumentTextIcon },
  { key: 'prompts',   label: 'Prompts IA BACS', icon: SparklesIcon },
]

const activeTab = computed(() => {
  const q = route.query?.tab
  return TABS.find(t => t.key === q) ? q : 'checklist'
})

function setTab(key) {
  router.replace({ query: { ...route.query, tab: key } })
}
</script>

<template>
  <div class="max-w-6xl mx-auto px-5 lg:px-6 py-6">
    <!-- Header -->
    <header class="mb-6">
      <h1 class="text-xl font-semibold text-gray-900 inline-flex items-center gap-2">
        <Cog6ToothIcon class="w-5 h-5 text-emerald-600" />
        Paramètres BACS
      </h1>
      <p class="text-sm text-gray-500 mt-1">
        Centralise la configuration métier propre aux audits BACS et Site :
        catalogue de la check-list documentaire, textes des annexes PDF,
        articles du décret R175, et prompts IA dédiés.
      </p>
    </header>

    <!-- Onglets -->
    <nav class="border-b border-gray-200 mb-5 flex items-end gap-1 overflow-x-auto">
      <button v-for="t in TABS" :key="t.key"
              @click="setTab(t.key)"
              :class="['inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition whitespace-nowrap',
                       activeTab === t.key
                         ? 'border-emerald-600 text-emerald-700'
                         : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300']">
        <component :is="t.icon" class="w-4 h-4 shrink-0" />
        {{ t.label }}
      </button>
    </nav>

    <!-- Contenu de l'onglet actif -->
    <div v-if="activeTab === 'checklist'">
      <BacsChecklistCatalogAdmin />
    </div>

    <div v-else-if="activeTab === 'pdf'" class="space-y-8">
      <BoilerplateAdmin />
      <R175ArticlesViewer />
    </div>

    <div v-else-if="activeTab === 'prompts'">
      <BacsAiPromptsAdmin />
    </div>
  </div>
</template>
