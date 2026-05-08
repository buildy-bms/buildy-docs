// Détection PII (noms de sites/clients) sur une capture via OCR + matching
// avec la liste des termes connus côté backend (table `sites`).
// Tesseract.js ~10 MB WASM lazy-loadé à la 1re utilisation, cache navigateur
// au-delà.

import api from '@/api'

let _ocrWorkerPromise = null
let _blocklistCache = null
let _blocklistFetchedAt = 0
const BLOCKLIST_TTL_MS = 5 * 60 * 1000

async function getOcrWorker() {
  if (_ocrWorkerPromise) return _ocrWorkerPromise
  _ocrWorkerPromise = (async () => {
    const { createWorker } = await import('tesseract.js')
    const worker = await createWorker(['fra', 'eng'])
    return worker
  })()
  return _ocrWorkerPromise
}

async function getBlocklist() {
  if (_blocklistCache && (Date.now() - _blocklistFetchedAt) < BLOCKLIST_TTL_MS) {
    return _blocklistCache
  }
  try {
    const { data } = await api.get('/faq/sites-blocklist')
    _blocklistCache = (data?.terms || []).filter((t) => t && t.length >= 4)
    _blocklistFetchedAt = Date.now()
  } catch {
    _blocklistCache = []
  }
  return _blocklistCache
}

// Levenshtein distance (simple) pour fuzzy matching ≤ 1 erreur.
function lev(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const m = []
  for (let i = 0; i <= a.length; i++) { m[i] = [i] }
  for (let j = 0; j <= b.length; j++) { m[0][j] = j }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      m[i][j] = Math.min(
        m[i - 1][j] + 1,
        m[i][j - 1] + 1,
        m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
  }
  return m[a.length][b.length]
}

function _matches(word, terms) {
  const w = word.toLowerCase().trim()
  if (w.length < 4) return false
  for (const t of terms) {
    const tl = t.toLowerCase()
    if (w === tl) return true
    // Fuzzy ≤ 1 sur les termes courts (≤ 8 chars), ≤ 2 sur les longs
    const tol = tl.length <= 8 ? 1 : 2
    if (lev(w, tl) <= tol) return true
  }
  return false
}

// Patterns regex génériques (email, IP privée, n° SIRET/TVA)
const GENERIC_PII_REGEX = [
  /\b[\w.-]+@[\w.-]+\.[a-z]{2,}\b/i,           // email
  /\b(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d+\.\d+\b/, // IP privée
  /\b\d{14}\b/,                                  // SIRET 14 chiffres
  /\bFR\d{11}\b/,                                // TVA FR
]

// Détecte les zones PII d'un blob image. Retourne array de bounding boxes :
// [{ x0, y0, x1, y1, word, confidence }] avec un padding de 8 px appliqué.
export async function detectPii(imageBlob) {
  const [worker, terms] = await Promise.all([getOcrWorker(), getBlocklist()])
  const url = URL.createObjectURL(imageBlob)
  let bboxes = []
  try {
    const { data } = await worker.recognize(url, {}, { blocks: true })
    const words = data?.words || []
    for (const w of words) {
      if ((w.confidence || 0) < 60) continue
      const text = (w.text || '').trim()
      if (!text) continue
      let hit = _matches(text, terms)
      if (!hit) {
        for (const re of GENERIC_PII_REGEX) {
          if (re.test(text)) { hit = true; break }
        }
      }
      if (hit) {
        const b = w.bbox || w.box || {}
        if (b.x0 != null && b.y0 != null && b.x1 != null && b.y1 != null) {
          bboxes.push({
            x0: Math.max(0, b.x0 - 8),
            y0: Math.max(0, b.y0 - 8),
            x1: b.x1 + 8,
            y1: b.y1 + 8,
            word: text,
            confidence: w.confidence,
          })
        }
      }
    }
  } finally {
    URL.revokeObjectURL(url)
  }
  return bboxes
}

// Termine le worker (à appeler à la destruction de la vue si possible).
export async function shutdownOcr() {
  if (!_ocrWorkerPromise) return
  try {
    const w = await _ocrWorkerPromise
    await w.terminate()
  } catch { /* ignore */ }
  _ocrWorkerPromise = null
}
