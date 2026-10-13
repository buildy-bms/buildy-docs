<script setup>
/**
 * Badge d'état de synchronisation Fonctionnalité biblio -> Article FAQ Crisp.
 *
 * Affiché dans le tableau de LibraryFunctionalitiesView.vue, colonne « FAQ ».
 * 4 états visuels :
 *   🔒 confidentiel  — la fonctionnalité a faq_publishable=0, publication désactivée
 *   ⚪ pas d'article — clic propose « Générer un article FAQ »
 *   🟠 désynchronisé — la biblio a évolué depuis la dernière génération
 *   🟢 synchronisé  — clic ouvre l'article dans l'éditeur FAQ
 *
 * Au montage : fetch /section-templates/:id/faq-status. Pas de re-fetch
 * automatique sur changements externes — le parent peut bump le `refreshKey`
 * pour forcer une réactualisation après création / regénération.
 */
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getFaqStatusForFunctionality } from '@/api'
import { LockClosedIcon, SparklesIcon, ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/vue/24/outline'
import Tooltip from '@/components/Tooltip.vue'
import { faqStatusTip } from '@/lib/library-tips'

const props = defineProps({
  sectionTemplateId: { type: Number, required: true },
  // Clé de refresh : changer cette valeur force un re-fetch.
  refreshKey: { type: [Number, String], default: 0 },
})
const emit = defineEmits(['generate', 'open-article'])

const router = useRouter()
const status = ref(null)
const loading = ref(true)
const errorState = ref(false)

async function fetchStatus() {
  loading.value = true
  errorState.value = false
  try {
    const { data } = await getFaqStatusForFunctionality(props.sectionTemplateId)
    status.value = data
  } catch (e) {
    errorState.value = true
  } finally {
    loading.value = false
  }
}

watch(() => [props.sectionTemplateId, props.refreshKey], fetchStatus, { immediate: true })

const view = computed(() => {
  if (loading.value || errorState.value || !status.value) return null
  const s = status.value
  // Bulles (lib/library-tips.js), portées par l'enveloppe <Tooltip> : le badge « Confidentiel »
  // est un bouton grisé. La case à cocher qui autorise la publication s'appelle « Autoriser la
  // publication d'un article FAQ » dans la fiche (et non « Confidentiel »).
  if (!s.faq_publishable) {
    return {
      kind: 'locked',
      icon: LockClosedIcon,
      label: 'Confidentiel',
      tooltip: faqStatusTip('locked'),
      cls: 'text-gray-300 bg-gray-50 cursor-not-allowed',
      disabled: true,
    }
  }
  if (!s.article) {
    return {
      kind: 'none',
      icon: SparklesIcon,
      label: 'Générer',
      tooltip: faqStatusTip('none'),
      cls: 'text-indigo-600 hover:bg-indigo-50',
      disabled: false,
    }
  }
  if (s.diverged) {
    return {
      kind: 'diverged',
      icon: ExclamationTriangleIcon,
      label: 'À revoir',
      tooltip: faqStatusTip('diverged', s.article),
      cls: 'text-amber-600 hover:bg-amber-50',
      disabled: false,
    }
  }
  return {
    kind: 'synced',
    icon: CheckCircleIcon,
    label: 'À jour',
    tooltip: faqStatusTip('synced', s.article),
    cls: 'text-emerald-600 hover:bg-emerald-50',
    disabled: false,
  }
})

function onClick() {
  if (!view.value || view.value.disabled) return
  if (view.value.kind === 'none') {
    emit('generate', props.sectionTemplateId)
    return
  }
  // Synchronisé ou désynchronisé : on ouvre l'article dans l'éditeur FAQ
  if (status.value?.article?.id) {
    emit('open-article', status.value.article.id)
    router.push(`/faq/articles/${status.value.article.id}`)
  }
}
</script>

<template>
  <Tooltip v-if="view" :text="view.tooltip">
    <button type="button"
            :disabled="view.disabled"
            :class="['inline-flex items-center gap-1 px-2 py-1 rounded-md transition text-[11px] font-medium', view.cls]"
            @click.stop="onClick">
      <component :is="view.icon" class="w-4 h-4" />
      <span>{{ view.label }}</span>
    </button>
  </Tooltip>
  <span v-else-if="loading" class="inline-block w-12 h-4 bg-gray-100 rounded animate-pulse"></span>
</template>
