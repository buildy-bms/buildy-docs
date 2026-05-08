<script setup>
import { ref, computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import {
  Cog6ToothIcon, SparklesIcon, ArrowPathIcon, CheckIcon,
  ArrowUturnLeftIcon, PlusIcon, XMarkIcon, ArrowLeftIcon,
  ClockIcon, TagIcon,
} from '@heroicons/vue/24/outline'
import {
  getAiPrompt, updateAiPrompt, resetAiPrompt,
  getFaqSeoKeywords, saveFaqSeoKeywords, resetFaqSeoKeywords,
} from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'

const { success, error: notifyError } = useNotification()
const { confirm } = useConfirm()

// ── Section A : 3 prompts IA FAQ ─────────────────────────────────────
const PROMPTS = [
  {
    key: 'faq.generate',
    label: 'Générer un article',
    hint: 'Utilisé quand tu cliques sur "Nouvel article assisté par IA". Produit titre, description et corps depuis une question.',
  },
  {
    key: 'faq.rewrite',
    label: 'Réécrire un article',
    hint: 'Utilisé par le bouton "Réécrire avec IA" dans l\'éditeur. Améliore clarté, structure et SEO d\'un article existant.',
  },
  {
    key: 'faq.suggest_missing',
    label: 'Suggérer des articles manquants',
    hint: 'Utilisé par le bouton "Articles manquants" sur la liste FAQ. Propose des sujets non couverts.',
  },
]

const promptStates = ref(PROMPTS.map((p) => ({
  ...p,
  detail: null,
  draft: '',
  saving: false,
})))

function isDirty(s) {
  return s.detail && s.draft !== s.detail.body
}

async function loadPrompt(s) {
  const { data } = await getAiPrompt(s.key)
  s.detail = data
  s.draft = data.body || ''
}

async function savePrompt(s) {
  if (!isDirty(s)) return
  s.saving = true
  try {
    const { data } = await updateAiPrompt(s.key, s.draft)
    s.detail = { ...s.detail, ...data }
    s.draft = data.body
    await loadPrompt(s)
    success(`Prompt ${s.label.toLowerCase()} enregistré`)
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de l\'enregistrement')
  } finally {
    s.saving = false
  }
}

async function resetPrompt(s) {
  const ok = await confirm({
    title: 'Restaurer le prompt par défaut ?',
    message: 'Ton prompt actuel sera archivé dans l\'historique. Le prompt par défaut intégré au code sera restauré.',
    confirmLabel: 'Restaurer',
  })
  if (!ok) return
  try {
    const { data } = await resetAiPrompt(s.key)
    s.detail = data
    s.draft = data.body
    await loadPrompt(s)
    success('Prompt par défaut restauré')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de la restauration')
  }
}

function discardPrompt(s) { s.draft = s.detail?.body || '' }

// ── Section B : whitelist SEO ────────────────────────────────────────
const seoKeywords = ref([])
const seoIsDefault = ref(true)
const seoNewInput = ref('')
const seoOriginal = ref([])
const seoSaving = ref(false)
const SEO_SORT_KEY = 'buildy.docs.faqSeoPillSort'
const seoSort = ref(localStorage.getItem(SEO_SORT_KEY) || 'added') // 'added' | 'alpha'
function toggleSeoSort() {
  seoSort.value = seoSort.value === 'alpha' ? 'added' : 'alpha'
  localStorage.setItem(SEO_SORT_KEY, seoSort.value)
}

// Vue triée (n'altère pas l'ordre stocké : on persiste toujours dans l'ordre d'ajout).
const seoKeywordsView = computed(() => {
  if (seoSort.value !== 'alpha') return seoKeywords.value.map((k, idx) => ({ k, idx }))
  return seoKeywords.value
    .map((k, idx) => ({ k, idx }))
    .slice()
    .sort((a, b) => a.k.localeCompare(b.k, 'fr', { sensitivity: 'base' }))
})

const seoDirty = computed(() => {
  if (seoOriginal.value.length !== seoKeywords.value.length) return true
  for (let i = 0; i < seoKeywords.value.length; i++) {
    if (seoKeywords.value[i] !== seoOriginal.value[i]) return true
  }
  return false
})

async function loadSeoKeywords() {
  const { data } = await getFaqSeoKeywords()
  seoKeywords.value = [...(data.keywords || [])]
  seoOriginal.value = [...(data.keywords || [])]
  seoIsDefault.value = !!data.is_default
}

function addKeyword() {
  const raw = seoNewInput.value.trim()
  if (!raw) return
  if (raw.length > 60) {
    notifyError('Mot-clé trop long (max 60 chars)')
    return
  }
  const lower = raw.toLowerCase()
  if (seoKeywords.value.some((k) => k.toLowerCase() === lower)) {
    notifyError('Ce mot-clé est déjà dans la liste')
    return
  }
  seoKeywords.value.push(raw)
  seoNewInput.value = ''
}

function removeKeyword(idx) {
  seoKeywords.value.splice(idx, 1)
}

async function saveSeoKeywords() {
  if (seoKeywords.value.length === 0) {
    notifyError('Au moins un mot-clé requis')
    return
  }
  seoSaving.value = true
  try {
    const { data } = await saveFaqSeoKeywords(seoKeywords.value)
    seoKeywords.value = [...(data.keywords || [])]
    seoOriginal.value = [...(data.keywords || [])]
    seoIsDefault.value = !!data.is_default
    success(`Liste SEO enregistrée (${data.keywords.length} mots-clés)`)
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de l\'enregistrement')
  } finally {
    seoSaving.value = false
  }
}

function discardSeoChanges() {
  seoKeywords.value = [...seoOriginal.value]
  seoNewInput.value = ''
}

async function resetSeoKeywords() {
  const ok = await confirm({
    title: 'Restaurer la liste par défaut ?',
    message: 'Ta liste actuelle sera remplacée par les mots-clés par défaut intégrés au code (~36 entrées).',
    confirmLabel: 'Restaurer',
  })
  if (!ok) return
  try {
    const { data } = await resetFaqSeoKeywords()
    seoKeywords.value = [...(data.keywords || [])]
    seoOriginal.value = [...(data.keywords || [])]
    seoIsDefault.value = !!data.is_default
    seoNewInput.value = ''
    success('Liste par défaut restaurée')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de la restauration')
  }
}

function formatDate(s) {
  if (!s) return ''
  return new Date(s).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
}

onMounted(async () => {
  await Promise.all([
    ...promptStates.value.map(loadPrompt),
    loadSeoKeywords(),
  ])
})
</script>

<template>
  <div class="max-w-screen-xl mx-auto pb-20">
    <!-- Header -->
    <div class="mb-6 flex items-start justify-between gap-4">
      <div>
        <RouterLink to="/faq"
                    class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-2">
          <ArrowLeftIcon class="w-4 h-4" /> Retour FAQ Buildy
        </RouterLink>
        <h1 class="text-2xl font-semibold text-gray-800 inline-flex items-center gap-2">
          <Cog6ToothIcon class="w-6 h-6 text-indigo-600" /> Paramètres FAQ
        </h1>
        <p class="text-sm text-gray-500 mt-1">
          Prompts IA et whitelist SEO utilisés par la génération et le scoring d'articles FAQ.
        </p>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════════════ -->
    <!-- Section A — Prompts IA FAQ                                       -->
    <!-- ═══════════════════════════════════════════════════════════════ -->
    <section class="mb-10">
      <div class="flex items-center gap-2 mb-3">
        <SparklesIcon class="w-5 h-5 text-violet-600" />
        <h2 class="text-lg font-semibold text-gray-800">Prompts IA FAQ</h2>
      </div>
      <p class="text-sm text-gray-500 mb-4">
        Instructions envoyées à Claude pour les 3 actions IA de la FAQ. Toute modification est versionnée
        — l'historique complet et la restauration de versions précédentes restent accessibles depuis
        <RouterLink to="/ai-prompts" class="text-indigo-600 hover:text-indigo-800 underline">la page Prompts IA</RouterLink>.
      </p>

      <div class="space-y-5">
        <div v-for="s in promptStates" :key="s.key"
             class="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <div class="flex items-start justify-between gap-3 mb-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h3 class="text-base font-semibold text-gray-800">{{ s.label }}</h3>
                <code class="text-[11px] px-1.5 py-0.5 bg-gray-100 rounded text-gray-600 font-mono">
                  {{ s.key }}
                </code>
              </div>
              <p class="text-xs text-gray-500 mt-1">{{ s.hint }}</p>
            </div>
            <div class="text-[11px] text-gray-500 text-right shrink-0 whitespace-nowrap">
              <span v-if="s.detail?.is_overridden" class="inline-flex items-center gap-1">
                <ClockIcon class="w-3 h-3" />
                Modifié — {{ formatDate(s.detail.updated_at) }}
              </span>
              <span v-else class="italic">Par défaut</span>
            </div>
          </div>

          <textarea v-if="s.detail" v-model="s.draft" rows="14"
                    autocomplete="off" data-1p-ignore="true"
                    class="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-[12.5px] font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 resize-y"></textarea>
          <div v-else class="text-sm text-gray-400 italic py-8 text-center">Chargement…</div>

          <div class="flex items-center justify-between gap-2 mt-3">
            <span class="text-[11px] text-gray-400">
              {{ s.draft.length }} caractères
            </span>
            <div class="flex items-center gap-2">
              <button v-if="isDirty(s)" @click="discardPrompt(s)"
                      class="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded">
                <ArrowUturnLeftIcon class="w-3.5 h-3.5" /> Annuler
              </button>
              <button @click="resetPrompt(s)" :disabled="!s.detail?.is_overridden"
                      class="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-amber-700 hover:bg-amber-50 rounded disabled:opacity-50 disabled:hover:bg-transparent">
                <ArrowPathIcon class="w-3.5 h-3.5" /> Restaurer défaut
              </button>
              <button @click="savePrompt(s)" :disabled="!isDirty(s) || s.saving"
                      class="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg shadow-sm font-medium disabled:opacity-50">
                <CheckIcon class="w-3.5 h-3.5" />
                {{ s.saving ? 'Enregistrement…' : 'Enregistrer' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════════ -->
    <!-- Section B — Whitelist mots-clés SEO                              -->
    <!-- ═══════════════════════════════════════════════════════════════ -->
    <section class="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
      <div class="flex items-start justify-between gap-3 mb-3">
        <div>
          <div class="flex items-center gap-2">
            <TagIcon class="w-5 h-5 text-emerald-600" />
            <h2 class="text-lg font-semibold text-gray-800">Mots-clés SEO métier</h2>
          </div>
          <p class="text-sm text-gray-500 mt-1">
            Whitelist utilisée par le scoring SEO et injectée dans les exemples few-shot envoyés à Claude.
            Toute génération d'article est ensuite évaluée sur la couverture de cette liste.
          </p>
        </div>
        <div class="text-xs text-gray-500 whitespace-nowrap shrink-0 text-right">
          <div>
            <strong class="text-gray-700">{{ seoKeywords.length }}</strong> mot{{ seoKeywords.length > 1 ? 's' : '' }}-clé{{ seoKeywords.length > 1 ? 's' : '' }}
            <button type="button" @click="toggleSeoSort"
                    class="ml-2 text-[11px] text-indigo-600 hover:text-indigo-800 underline"
                    :title="seoSort === 'alpha' ? 'Tri actuel : alphabétique. Cliquer pour passer en ordre d\'ajout.' : 'Tri actuel : ordre d\'ajout. Cliquer pour passer en alphabétique.'">
              {{ seoSort === 'alpha' ? 'A→Z' : '↺' }}
            </button>
          </div>
          <span v-if="seoIsDefault" class="block text-[11px] italic mt-0.5">Liste par défaut</span>
          <span v-else class="block text-[11px] italic mt-0.5 text-emerald-700">Liste personnalisée</span>
        </div>
      </div>

      <!-- Pills -->
      <div v-if="seoKeywordsView.length"
           class="flex flex-wrap gap-2 mb-4 p-3 bg-gray-50 border border-gray-100 rounded-lg min-h-16">
        <span v-for="entry in seoKeywordsView" :key="`${entry.k}-${entry.idx}`"
              class="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full text-sm border border-indigo-100">
          <span>{{ entry.k }}</span>
          <button @click="removeKeyword(entry.idx)"
                  class="text-indigo-400 hover:text-indigo-700 hover:bg-indigo-100 rounded-full w-4 h-4 inline-flex items-center justify-center"
                  :title="`Retirer « ${entry.k} »`"
                  :aria-label="`Retirer le mot-clé « ${entry.k} »`">
            <XMarkIcon class="w-3 h-3" />
          </button>
        </span>
      </div>
      <div v-else class="mb-4 p-6 text-center text-sm text-gray-400 italic bg-gray-50 border border-gray-100 rounded-lg">
        Aucun mot-clé. Ajoute-en au moins un avant d'enregistrer.
      </div>

      <!-- Input ajout -->
      <form @submit.prevent="addKeyword" class="flex items-center gap-2 mb-4">
        <input v-model="seoNewInput" type="text" placeholder="Ajouter un mot-clé…"
               maxlength="60" autocomplete="off"
               class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500" />
        <button type="submit" :disabled="!seoNewInput.trim()"
                class="inline-flex items-center gap-1 px-3 py-2 text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg disabled:opacity-50 whitespace-nowrap">
          <PlusIcon class="w-4 h-4" /> Ajouter
        </button>
      </form>

      <!-- Actions -->
      <div class="flex items-center justify-between gap-2 pt-4 border-t border-gray-100">
        <button @click="resetSeoKeywords"
                class="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-gray-600 hover:text-amber-700 hover:bg-amber-50 rounded-lg whitespace-nowrap">
          <ArrowPathIcon class="w-3.5 h-3.5" /> Restaurer la liste par défaut
        </button>
        <div class="flex items-center gap-2">
          <button v-if="seoDirty" @click="discardSeoChanges"
                  class="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg whitespace-nowrap">
            <ArrowUturnLeftIcon class="w-3.5 h-3.5" /> Annuler
          </button>
          <button @click="saveSeoKeywords" :disabled="!seoDirty || seoSaving"
                  class="inline-flex items-center gap-1 px-4 py-1.5 text-xs bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg shadow-sm font-medium disabled:opacity-50 whitespace-nowrap">
            <CheckIcon class="w-3.5 h-3.5" />
            {{ seoSaving ? 'Enregistrement…' : 'Enregistrer la liste' }}
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
