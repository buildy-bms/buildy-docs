import { ref } from 'vue'
import { getDecreeRefs } from '@/api'

/**
 * Composable d'accès au texte officiel du décret BACS (R175), servi par
 * l'endpoint `GET /api/bacs-knowledge/decree-refs` — source UNIQUE opposable
 * (table bacs_knowledge). Remplace les extraits d'articles autrefois dupliqués
 * en dur dans R175Tooltip.vue.
 *
 * - Cache module-level partagé : 1 fetch réseau par session (promesse
 *   mutualisée), pas un fetch par survol de tooltip (pattern
 *   useSystemCategories.js).
 * - Hydratation immédiate depuis localStorage (SWR) : le texte s'affiche sans
 *   attendre le réseau ; le fetch de fond rafraîchit ensuite le cache.
 * - `getRef(article)` accepte une référence d'article OU d'alinéa
 *   ("R175-3", "R175-3 1°", "R175-3 §1") et renvoie le texte de l'ARTICLE
 *   parent (le décret est stocké par article, pas par alinéa).
 */

const CACHE_KEY = 'decree-refs-v1'
const TTL_MS = 7 * 24 * 3600 * 1000 // 7 jours

const refs = ref({})              // { 'R175-3': { official_html, source_url, ... } }
const decreeVersion = ref(null)   // { effective_from, label }
const ready = ref(false)
let inflight = null

function hydrateFromCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!parsed || (parsed.ts && Date.now() - parsed.ts > TTL_MS)) return
    if (parsed.refs) {
      refs.value = parsed.refs
      decreeVersion.value = parsed.decree_version || null
      ready.value = true
    }
  } catch { /* cache illisible → on ignore, le réseau prendra le relais */ }
}

function loadOnce() {
  if (inflight) return inflight
  inflight = getDecreeRefs()
    .then(({ data }) => {
      refs.value = data?.refs || {}
      decreeVersion.value = data?.decree_version || null
      ready.value = true
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          ts: Date.now(), refs: refs.value, decree_version: decreeVersion.value,
        }))
      } catch { /* quota localStorage plein → tant pis, cache mémoire suffit */ }
    })
    .catch(() => { /* silencieux : le tooltip retombe sur son fallback */ })
    .finally(() => { inflight = null })
  return inflight
}

// "R175-3 1°" / "R175-3 §1" / "R175-3" → code d'article parent "R175-3".
// "R175-5-1" reste "R175-5-1" (article à part entière).
function parentArticleCode(article) {
  if (!article) return null
  const m = String(article).match(/^\s*(R\.?\s*175-\d+(?:-\d+)?)/i)
  if (!m) return null
  return m[1].replace(/\s+/g, '').replace(/^R\./i, 'R')
}

export function useDecreeRefs() {
  hydrateFromCache()
  loadOnce()

  function getRef(article) {
    const code = parentArticleCode(article)
    if (!code) return null
    return refs.value[code] || null
  }

  return { refs, decreeVersion, ready, getRef, parentArticleCode }
}
