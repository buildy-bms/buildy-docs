<script setup>
/**
 * Historique des versions d'un article FAQ + restauration.
 *
 * Snapshots automatiques pris :
 *   - reason='before_push'         : avant chaque "Publier vers Crisp"
 *   - reason='before_ai_rewrite'   : avant chaque réécriture IA
 *   - reason='before_restore'      : avant chaque restauration (chaîne préservée)
 */
import { ref, onMounted } from 'vue'
import { ArrowUturnLeftIcon, ClockIcon, SparklesIcon, ArrowUpOnSquareIcon, ArrowsRightLeftIcon } from '@heroicons/vue/24/outline'
import BaseModal from './BaseModal.vue'
import { listFaqArticleVersions, restoreFaqArticleVersion } from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'

const props = defineProps({ articleId: { type: [Number, String], required: true } })
const emit = defineEmits(['close', 'restored'])

const { success, error: notifyError } = useNotification()
const { confirm } = useConfirm()

const versions = ref([])
const loading = ref(false)
const restoring = ref(null)

async function fetchVersions() {
  loading.value = true
  try {
    const { data } = await listFaqArticleVersions(props.articleId)
    versions.value = data
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec du chargement')
  } finally {
    loading.value = false
  }
}

onMounted(fetchVersions)

const REASON_LABEL = {
  before_push: { label: 'Avant publication Crisp', icon: ArrowUpOnSquareIcon, cls: 'text-indigo-600' },
  before_ai_rewrite: { label: 'Avant réécriture IA', icon: SparklesIcon, cls: 'text-violet-600' },
  before_restore: { label: 'Avant restauration', icon: ArrowsRightLeftIcon, cls: 'text-amber-600' },
}
function reasonMeta(r) {
  return REASON_LABEL[r] || { label: r || 'Snapshot manuel', icon: ClockIcon, cls: 'text-gray-500' }
}
function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
}

async function restore(v) {
  const ok = await confirm({
    title: 'Restaurer cette version ?',
    message: `Le contenu actuel sera remplacé par celui de cette version (du ${fmtDate(v.created_at)}). L'état actuel est d'abord sauvegardé dans l'historique, donc l'opération est réversible.`,
    confirmLabel: 'Restaurer',
  })
  if (!ok) return
  restoring.value = v.id
  try {
    const { data } = await restoreFaqArticleVersion(props.articleId, v.id)
    success('Version restaurée — pense à publier vers Crisp si nécessaire')
    emit('restored', data)
    emit('close')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec')
  } finally {
    restoring.value = null
  }
}
</script>

<template>
  <BaseModal size="lg" title="Historique de l'article" @close="emit('close')">
    <div>
      <p class="text-sm text-gray-500 mb-3 -mt-1">
        Versions automatiquement sauvegardées avant chaque action critique (réécriture IA, publication Crisp, restauration). Les éditions manuelles ne créent pas de snapshot.
      </p>
      <div v-if="loading" class="py-6 text-sm text-gray-400 italic text-center">Chargement…</div>
      <div v-else-if="!versions.length" class="py-6 text-sm text-gray-400 italic text-center">
        Aucune version archivée pour cet article.
      </div>
      <ul v-else class="space-y-2 max-h-96 overflow-y-auto">
        <li v-for="v in versions" :key="v.id"
            class="border border-gray-200 rounded-lg p-3 flex items-start gap-3 hover:border-indigo-300 transition">
          <component :is="reasonMeta(v.reason).icon"
                     :class="['w-5 h-5 shrink-0 mt-0.5', reasonMeta(v.reason).cls]" />
          <div class="flex-1 min-w-0">
            <div class="font-medium text-gray-800 truncate">{{ v.title }}</div>
            <div class="text-xs text-gray-500 mt-0.5">
              {{ reasonMeta(v.reason).label }} · {{ fmtDate(v.created_at) }}
              <span v-if="v.created_by_name"> · par {{ v.created_by_name }}</span>
              <span class="ml-1 text-gray-400">· {{ Math.round(v.content_size / 100) / 10 }} ko</span>
              <span class="ml-1 px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{{ v.status }}</span>
            </div>
          </div>
          <button @click="restore(v)" :disabled="restoring === v.id"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-indigo-200 text-indigo-700 hover:bg-indigo-50 transition whitespace-nowrap disabled:opacity-50">
            <ArrowUturnLeftIcon class="w-3.5 h-3.5 shrink-0" />
            {{ restoring === v.id ? 'Restauration…' : 'Restaurer' }}
          </button>
        </li>
      </ul>
    </div>
  </BaseModal>
</template>
