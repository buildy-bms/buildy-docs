<script setup>
/**
 * Modale de génération d'un article FAQ depuis une fonctionnalité biblio (Lot 138).
 *
 * Étapes :
 *   1. L'utilisateur choisit une catégorie Crisp cible (default : « Fonctionnalités transverses »).
 *   2. Aperçu du contexte : titre source, captures à uploader, codes BACS couverts.
 *   3. Clic « Générer » → appel backend (l'IA reformule + upload captures + crée l'article).
 *   4. À la réussite, on redirige vers l'éditeur FAQ avec l'article en brouillon.
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import BaseModal from '@/components/BaseModal.vue'
import { SparklesIcon, ArrowPathIcon, PhotoIcon, BookOpenIcon } from '@heroicons/vue/24/outline'
import { listFaqCategories, generateFaqFromFunctionality } from '@/api'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  // La fonctionnalité source (row section_templates avec is_functionality=1)
  functionality: { type: Object, required: true },
  // Articles BACS couverts (string parsé depuis functionality.bacs_articles)
  bacsCodes: { type: Array, default: () => [] },
  // Nombre de captures sur la fonctionnalité (pour preview)
  attachmentsCount: { type: Number, default: 0 },
})
const emit = defineEmits(['close', 'generated'])

const router = useRouter()
const { success, error: notifyError } = useNotification()

const categories = ref([])
const loadingCategories = ref(true)
const selectedCategoryId = ref(null)
const generating = ref(false)

onMounted(async () => {
  loadingCategories.value = true
  try {
    const { data } = await listFaqCategories()
    categories.value = data || []
    // Sélection par défaut : « Fonctionnalités transverses » si elle existe.
    const preferred = categories.value.find((c) => /fonctionnalit/i.test(c.name || ''))
    selectedCategoryId.value = preferred?.id || (categories.value[0]?.id || null)
  } catch (e) {
    notifyError('Impossible de charger les catégories Crisp')
  } finally {
    loadingCategories.value = false
  }
})

const summaryLines = computed(() => {
  const lines = []
  lines.push(`Titre source : ${props.functionality.title || '(sans titre)'}`)
  if (props.attachmentsCount > 0) {
    lines.push(`${props.attachmentsCount} capture${props.attachmentsCount > 1 ? 's' : ''} d'écran à uploader sur l'hébergement Crisp`)
  } else {
    lines.push('Aucune capture d\'écran sur la fonctionnalité — article sans images')
  }
  if (props.bacsCodes.length > 0) {
    lines.push(`Codes BACS couverts : ${props.bacsCodes.join(', ')} → maillage automatique vers les articles BACS publiés`)
  }
  return lines
})

async function generate() {
  if (!selectedCategoryId.value) {
    notifyError('Choisis une catégorie Crisp')
    return
  }
  generating.value = true
  try {
    const { data } = await generateFaqFromFunctionality(props.functionality.id, {
      category_id: selectedCategoryId.value,
    })
    success('Article FAQ généré. Tu peux le relire avant de publier.')
    emit('generated', data)
    emit('close')
    // Bascule directe vers l'éditeur FAQ
    router.push(`/faq/articles/${data.id}`)
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de la génération')
  } finally {
    generating.value = false
  }
}
</script>

<template>
  <BaseModal size="lg" :dismiss-on-backdrop="false" title="Générer un article FAQ depuis cette fonctionnalité" @close="emit('close')">
    <div>
      <p class="text-sm text-gray-600 mb-4 -mt-1">
        L'IA va reformuler la fonctionnalité en article FAQ optimisé Google,
        publiable sur <code class="text-xs bg-gray-100 px-1 rounded">help.buildy.fr</code>.
        Les captures de la fonctionnalité seront uploadées vers l'hébergement Crisp.
      </p>

      <!-- Récap contexte -->
      <div class="rounded-lg border border-gray-200 bg-gray-50 p-4 mb-4 space-y-1.5">
        <div v-for="(line, i) in summaryLines" :key="i" class="text-sm text-gray-700 flex items-start gap-2">
          <span class="text-gray-400 mt-0.5">•</span>
          <span>{{ line }}</span>
        </div>
      </div>

      <!-- Sélecteur catégorie Crisp -->
      <label class="block text-sm font-medium text-gray-700 mb-1.5">
        Catégorie Crisp cible
      </label>
      <select v-model="selectedCategoryId"
              :disabled="loadingCategories || generating"
              class="w-full px-3.5 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition mb-5">
        <option v-if="loadingCategories" :value="null">Chargement…</option>
        <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>

      <div class="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
        <button type="button" @click="emit('close')" :disabled="generating"
                class="px-4 py-2 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-100 transition whitespace-nowrap disabled:opacity-50">
          Annuler
        </button>
        <button type="button" @click="generate" :disabled="generating || !selectedCategoryId"
                class="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition whitespace-nowrap disabled:opacity-50 shadow-sm">
          <ArrowPathIcon v-if="generating" class="w-4 h-4 shrink-0 animate-spin" />
          <SparklesIcon v-else class="w-4 h-4 shrink-0" />
          {{ generating ? 'Génération…' : 'Générer l\'article' }}
        </button>
      </div>
    </div>
  </BaseModal>
</template>
