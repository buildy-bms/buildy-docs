<script setup>
import { ref, onMounted, computed } from 'vue'
import { ScaleIcon } from '@heroicons/vue/24/outline'
import { getBacsArticles } from '@/api'
import BaseModal from './BaseModal.vue'

const props = defineProps({
  // Référence brute : "R175-1" ou "R175-1 1°, 2°" ou "R175-1 1°, 2° ; R175-3 3°"
  // (Format historique avec § encore parsé pour compatibilité.)
  reference: { type: String, required: true },
  // 'section' (défaut) → "Exigé par le décret BACS"
  // 'equipment'        → "Système concerné par le décret BACS"
  context: { type: String, default: 'section' },
  // Explication métier propre à l'équipement / la section : pourquoi le décret
  // s'applique ici, comment la solution Buildy y répond. Affichée en haut de la modale.
  contextExplanation: { type: String, default: null },
})

const labelPrefix = props.context === 'equipment'
  ? 'Système concerné par le décret BACS'
  : 'Exigé par le décret BACS'

// Reference affichee : convertit "§N" -> "N°" a la volee pour les valeurs
// historiques en DB qui n'ont pas encore ete migrees. Idempotent.
const formattedReference = computed(() =>
  (props.reference || '').replace(/§\s*(\d+)/g, (_, n) => `${n}°`)
)

const showModal = ref(false)
const bacsData = ref(null)

// Parse la référence en liste { code, paragraphs[] }.
// Ajoute systématiquement R175-3 1°, 3°, 4° (obligations BACS communes) en
// complément des références propres à l'équipement, parce que le bandeau
// "Pourquoi le décret s'applique ici" cite ces obligations (interopérabilité,
// arrêt manuel, gestion autonome, suivi continu) — les extraits justificatifs
// correspondants doivent suivre.
const articleRefs = computed(() => {
  if (!props.reference) return []
  const parts = props.reference.split(/[;,]/).map(s => s.trim()).filter(Boolean)
  const map = new Map()
  let lastCode = null
  for (const p of parts) {
    const codeMatch = p.match(/R175-\d+(-\d+)?/)
    // Accepte les deux notations : "1°" (canonique) et "§1" (historique).
    const paraMatches = [
      ...[...p.matchAll(/(\d+)°/g)].map(m => m[1]),
      ...[...p.matchAll(/§\s*(\d+)/g)].map(m => m[1]),
    ]
    const code = codeMatch ? codeMatch[0] : lastCode
    if (!code) continue
    lastCode = code
    if (!map.has(code)) map.set(code, new Set())
    paraMatches.forEach(pp => map.get(code).add(pp))
  }

  // Auto-ajout des exigences BACS communes (R175-3) pour les équipements
  // référençant le décret. R175-3 1° = suivi continu / 3° = interopérabilité /
  // 4° = arrêt manuel + gestion autonome.
  if (map.size > 0 && !map.has('R175-3')) {
    map.set('R175-3', new Set(['1', '3', '4']))
  } else if (map.has('R175-3')) {
    const existing = map.get('R175-3')
    ;['1', '3', '4'].forEach(p => existing.add(p))
  }

  return [...map.entries()].map(([code, paras]) => ({ code, paragraphs: [...paras] }))
})

// Filtre l'HTML d'un article pour ne garder que les paragraphes (li) précisés
// dans la référence. Si paragraphes vides → renvoie l'article complet.
function filterArticleHtml(fullHtml, paragraphs) {
  if (!paragraphs?.length) return fullHtml
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(`<div id="root">${fullHtml}</div>`, 'text/html')
    const root = doc.getElementById('root')
    const ol = root.querySelector('ol')
    if (!ol) return fullHtml
    const allLis = Array.from(ol.children).filter(c => c.tagName === 'LI')
    const indices = paragraphs
      .map(p => parseInt(p, 10) - 1)
      .filter(n => n >= 0 && n < allLis.length)
    if (!indices.length) return fullHtml

    const newOl = doc.createElement('ol')
    for (const i of indices) {
      const li = allLis[i].cloneNode(true)
      li.setAttribute('value', String(i + 1)) // garde la numérotation d'origine
      newOl.appendChild(li)
    }

    // Conserver l'éventuel <p> d'intro qui précède le <ol>
    const out = doc.createElement('div')
    let cur = root.firstElementChild
    while (cur && cur !== ol) {
      if (cur.tagName === 'P') out.appendChild(cur.cloneNode(true))
      cur = cur.nextElementSibling
    }
    out.appendChild(newOl)
    return out.innerHTML
  } catch {
    return fullHtml
  }
}

const articlesToShow = computed(() => {
  if (!bacsData.value) return []
  return articleRefs.value.map(ref => {
    const article = bacsData.value.articles.find(a => a.code === ref.code)
    if (!article) return { ...ref, article: null }
    return {
      ...ref,
      article: {
        ...article,
        full_html: filterArticleHtml(article.full_html, ref.paragraphs),
      },
    }
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
    :title="`Voir l'extrait du décret BACS — ${formattedReference}`"
  >
    <ScaleIcon class="w-3 h-3" />
    {{ labelPrefix }} · {{ formattedReference }}
  </button>

  <BaseModal v-if="showModal" :title="`Décret BACS — ${formattedReference}`" size="lg" @close="showModal = false">
    <div class="space-y-6 max-h-[70vh] overflow-y-auto pr-2 -mr-2">
      <!-- Explication métier en tête (Lot UX BACS) -->
      <div v-if="contextExplanation" class="bg-purple-50 border-l-4 border-purple-400 px-5 py-4">
        <p class="text-[11px] uppercase tracking-wider text-purple-700 font-semibold mb-2">
          Pourquoi le décret BACS s'applique ici
        </p>
        <div class="bacs-prose text-[14px] text-gray-800 leading-relaxed" v-html="contextExplanation"></div>
      </div>

      <p class="text-xs text-gray-500 italic leading-relaxed">
        Extraits du décret n° 2023-259 du 7 avril 2023 (articles R175-1 à R175-6 du Code de la construction et de l'habitation).
      </p>

      <article v-for="(item, idx) in articlesToShow" :key="idx" class="border border-purple-100 rounded-lg">
        <header class="px-5 py-3 bg-purple-50 border-b border-purple-100">
          <p class="font-semibold text-purple-900 text-sm">
            Article {{ item.code }} — {{ item.article.title }}
          </p>
          <p v-if="item.paragraphs.length" class="text-[11px] text-purple-700 mt-1">
            Sous-points mis en évidence : {{ item.paragraphs.map(p => p + '°').join(', ') }}
          </p>
        </header>
        <div class="bacs-prose px-5 py-4 text-[13px] text-gray-800" v-html="item.article.full_html"></div>
      </article>

      <div v-if="!articlesToShow.length" class="text-xs text-gray-400 italic px-2">
        {{ bacsData ? `Article(s) « ${formattedReference} » introuvable(s) dans le seed BACS.` : 'Chargement…' }}
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
