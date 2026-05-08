<script setup>
/**
 * Modale de sélection d'un article FAQ existant pour insertion d'un lien
 * interne dans l'éditeur.
 *
 * - Liste les articles `published` avec URL Crisp (endpoint searchable).
 * - Recherche live (debounce) par titre.
 * - Émet `select { url, title }` au clic sur un article.
 */
import { ref, onMounted, watch } from 'vue'
import { MagnifyingGlassIcon, ArrowTopRightOnSquareIcon } from '@heroicons/vue/24/outline'
import BaseModal from './BaseModal.vue'
import { searchFaqArticles } from '@/api'

const emit = defineEmits(['close', 'select'])

const query = ref('')
const articles = ref([])
const loading = ref(false)
let debounce = null

async function fetchList() {
  loading.value = true
  try {
    const { data } = await searchFaqArticles(query.value.trim() || null)
    articles.value = data
  } catch {
    articles.value = []
  } finally {
    loading.value = false
  }
}

onMounted(fetchList)

watch(query, () => {
  clearTimeout(debounce)
  debounce = setTimeout(fetchList, 200)
})

function pick(a) {
  emit('select', { url: a.crisp_url, title: a.title })
}
</script>

<template>
  <BaseModal size="lg" :title="'Insérer un lien vers un article FAQ'" @close="emit('close')">
    <div>
      <p class="text-sm text-gray-500 mb-3 -mt-1">
        Choisis un article publié sur help.buildy.fr — le lien sera inséré au curseur de l'éditeur.
      </p>
      <div class="relative mb-3">
        <MagnifyingGlassIcon class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input v-model="query" type="text" placeholder="Rechercher par titre…" autofocus
               class="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
      </div>

      <div v-if="loading" class="py-6 text-sm text-gray-400 italic text-center">Chargement…</div>
      <div v-else-if="!articles.length" class="py-6 text-sm text-gray-400 italic text-center">
        Aucun article trouvé. Seuls les articles publiés (statut « Publié ») apparaissent ici.
      </div>
      <ul v-else class="space-y-1 max-h-96 overflow-y-auto border border-gray-100 rounded-lg">
        <li v-for="a in articles" :key="a.id">
          <button @click="pick(a)"
                  class="w-full text-left px-3 py-2.5 hover:bg-indigo-50 transition border-b border-gray-100 last:border-b-0 group">
            <div class="font-medium text-gray-800 group-hover:text-indigo-700 inline-flex items-center gap-1.5">
              {{ a.title }}
              <ArrowTopRightOnSquareIcon class="w-3.5 h-3.5 shrink-0 opacity-0 group-hover:opacity-100 transition" />
            </div>
            <div class="text-xs text-gray-500 mt-0.5">
              <span v-if="a.category_name">{{ a.category_name }} · </span>
              <span class="text-gray-400 break-all">{{ a.crisp_url }}</span>
            </div>
          </button>
        </li>
      </ul>
    </div>
  </BaseModal>
</template>
