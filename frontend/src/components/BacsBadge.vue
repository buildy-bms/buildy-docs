<script setup>
import { ref, onMounted, computed } from 'vue'
import { ScaleIcon } from '@heroicons/vue/24/outline'
import { getBacsArticles } from '@/api'
import BaseModal from './BaseModal.vue'

const props = defineProps({
  // Référence brute : "R175-1" ou "R175-1 §1, §2" ou "R175-1 §1, §2 ; R175-3 §3"
  reference: { type: String, required: true },
  // 'section' (défaut) → "Exigé par le décret BACS"
  // 'equipment'        → "Système concerné par le décret BACS"
  context: { type: String, default: 'section' },
})

const labelPrefix = props.context === 'equipment'
  ? 'Système concerné par le décret BACS'
  : 'Exigé par le décret BACS'

const showModal = ref(false)
const bacsData = ref(null)

// Parse la référence en liste { code, paragraphs[] }
const articleRefs = computed(() => {
  if (!props.reference) return []
  const parts = props.reference.split(/[;,]/).map(s => s.trim()).filter(Boolean)
  // Regroupe par code (R175-X)
  const map = new Map()
  let lastCode = null
  for (const p of parts) {
    const codeMatch = p.match(/R175-\d+/)
    const paraMatches = [...p.matchAll(/§\s*(\d+)/g)].map(m => m[1])
    const code = codeMatch ? codeMatch[0] : lastCode
    if (!code) continue
    lastCode = code
    if (!map.has(code)) map.set(code, new Set())
    paraMatches.forEach(pp => map.get(code).add(pp))
  }
  return [...map.entries()].map(([code, paras]) => ({ code, paragraphs: [...paras] }))
})

const articlesToShow = computed(() => {
  if (!bacsData.value) return []
  return articleRefs.value.map(ref => {
    const article = bacsData.value.articles.find(a => a.code === ref.code)
    return { ...ref, article }
  }).filter(x => x.article)
})

async function openModal() {
  if (!bacsData.value) {
    try { bacsData.value = await getBacsArticles() }
    catch { /* on affiche quand même la modale, l'utilisateur saura que c'est cassé */ }
  }
  showModal.value = true
}

onMounted(() => {
  // Pre-charge en background pour éviter latence à l'ouverture
  if (!bacsData.value) getBacsArticles().then(d => { bacsData.value = d }).catch(() => {})
})
</script>

<template>
  <button
    type="button"
    @click.stop="openModal"
    class="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded border bg-purple-50 text-purple-700 border-purple-200 whitespace-nowrap hover:bg-purple-100 hover:border-purple-300 cursor-pointer"
    :title="`Voir l'extrait du décret BACS — ${reference}`"
  >
    <ScaleIcon class="w-3 h-3" />
    {{ labelPrefix }} · {{ reference }}
  </button>

  <BaseModal v-if="showModal" :title="`Décret BACS — ${reference}`" size="lg" @close="showModal = false">
    <div class="space-y-6 max-h-[70vh] overflow-y-auto pr-2 -mr-2">
      <p class="text-xs text-gray-500 italic leading-relaxed">
        Extraits du décret n° 2023-259 du 7 avril 2023 (articles R175-1 à R175-6 du Code de la construction et de l'habitation).
      </p>

      <article v-for="(item, idx) in articlesToShow" :key="idx" class="border border-purple-100 rounded-none">
        <header class="px-5 py-3 bg-purple-50 border-b border-purple-100">
          <p class="font-semibold text-purple-900 text-sm">
            Article {{ item.code }} — {{ item.article.title }}
          </p>
          <p v-if="item.paragraphs.length" class="text-[11px] text-purple-700 mt-1">
            Paragraphes mis en évidence : {{ item.paragraphs.map(p => '§' + p).join(', ') }}
          </p>
        </header>
        <div class="bacs-prose px-5 py-4 text-[13px] text-gray-800" v-html="item.article.full_html"></div>
      </article>

      <div v-if="!articlesToShow.length" class="text-xs text-gray-400 italic px-2">
        {{ bacsData ? `Article(s) « ${reference} » introuvable(s) dans le seed BACS.` : 'Chargement…' }}
      </div>
    </div>
    <template #footer>
      <button @click="showModal = false" class="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">Fermer</button>
    </template>
  </BaseModal>
</template>

<style scoped>
/* Aération du HTML brut du décret (rendu via v-html) — Lot 17 fix */
.bacs-prose :deep(p) { margin: 0 0 0.85rem; line-height: 1.7; }
.bacs-prose :deep(p:last-child) { margin-bottom: 0; }
.bacs-prose :deep(ol),
.bacs-prose :deep(ul) {
  margin: 0.5rem 0 1rem;
  padding-left: 1.4rem;
  list-style-position: outside;
}
.bacs-prose :deep(ol) { list-style-type: decimal; }
.bacs-prose :deep(ul) { list-style-type: disc; }
.bacs-prose :deep(li) {
  margin: 0.55rem 0;
  line-height: 1.65;
  padding-left: 0.25rem;
}
.bacs-prose :deep(li > strong) {
  display: inline;
  margin-right: 0.15rem;
  color: #1f2937;
}
.bacs-prose :deep(li > ul),
.bacs-prose :deep(li > ol) {
  margin-top: 0.4rem;
  margin-bottom: 0.4rem;
}
.bacs-prose :deep(strong) { color: #1f2937; font-weight: 700; }
</style>
