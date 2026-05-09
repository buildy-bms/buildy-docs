// Queue d'écritures différées pour le mode hors-ligne PWA. Quand axios
// se prend une erreur réseau (NetworkError) sur un PATCH/POST/PUT/DELETE
// d'une route audit, on push la mutation ici au lieu de retourner une
// erreur au caller. Au retour en ligne, un drainer rejoue les
// mutations dans l'ordre.
//
// Volontairement simple en V1 :
//  - localStorage (5 Mo de quota navigateur, largement suffisant pour
//    quelques centaines de PATCH textuels). Pas IndexedDB pour limiter
//    la complexité.
//  - Pas de dédup : si on PATCH 3x le même champ, les 3 partent au
//    drain. Le serveur upsert, dernière mutation gagne. OK.
//  - Pas d'upload binaire (multipart) : transcripts / images sont
//    refusés du queueing (rejectent en erreur classique au caller).
//  - Drain séquentiel : 1 mutation à la fois, abort sur 5xx persistant.
//    Les erreurs 4xx (validation) marquent la mutation en `failed`
//    et la sortent de la queue (le serveur l'aurait refusée même en
//    ligne — donc on garde le state local divergent et on prévient).

const STORAGE_KEY = 'buildy-docs.audit-pending-mutations.v1'

function readQueue() {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function writeQueue(items) {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)) }
  catch { /* quota ou storage off — silencieux */ }
}

function uuid() {
  // Pas besoin de crypto — usage interne, pas de collision possible
  // entre devices car la queue est locale.
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Méthodes HTTP qui sont safes à mettre en queue. Les GET/HEAD/OPTIONS
 * ne sont jamais queuables — un GET sans réseau retourne juste une
 * erreur au caller (qui doit gérer son fallback / cache).
 */
const QUEUEABLE_METHODS = new Set(['post', 'patch', 'put', 'delete'])

/**
 * Préfixes d'URL qu'on autorise à mettre en queue. On limite aux routes
 * BACS audit + AF metadata pour éviter de queuer des écritures sur
 * /api/auth, /api/users, etc. qui n'ont pas de sens à différer.
 */
const QUEUEABLE_PREFIXES = [
  '/bacs-audit/',
  '/afs/',
  '/sites/',
  '/zones',
  '/sections',
]

export function isQueueable(method, url, contentType) {
  if (!method || !url) return false
  if (!QUEUEABLE_METHODS.has(method.toLowerCase())) return false
  // Multipart (upload fichier) : trop volumineux pour localStorage,
  // contraintes de sérialisation. Au caller de gérer.
  if (contentType && /multipart\/form-data/i.test(contentType)) return false
  return QUEUEABLE_PREFIXES.some(p => url.startsWith(p))
}

export function enqueue({ method, url, data, headers }) {
  const items = readQueue()
  const item = {
    id: uuid(),
    method: method.toUpperCase(),
    url,
    data: data ?? null,
    headers: headers || null,
    createdAt: Date.now(),
    retries: 0,
  }
  items.push(item)
  writeQueue(items)
  notifyChange()
  return item
}

export function listPending() {
  return readQueue()
}

export function pendingCount() {
  return readQueue().length
}

export function removeById(id) {
  const items = readQueue().filter(i => i.id !== id)
  writeQueue(items)
  notifyChange()
}

export function clearAll() {
  writeQueue([])
  notifyChange()
}

// ── Notif simple via CustomEvent pour que les composables Vue
// puissent watch le compteur en réactif sans subscribe pattern lourd.
const CHANGE_EVENT = 'buildy-docs:offline-queue-changed'
function notifyChange() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
}

export function onQueueChange(handler) {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(CHANGE_EVENT, handler)
  return () => window.removeEventListener(CHANGE_EVENT, handler)
}

/**
 * Drain : rejoue les mutations dans l'ordre, 1 à 1. Si la mutation
 * passe (2xx) on la retire. Si elle échoue par erreur réseau on stop
 * (on reprendra au prochain trigger). Si elle échoue par 4xx on la
 * retire et on log (le serveur l'aurait refusée même en ligne — pas
 * la peine de bloquer le reste de la queue).
 *
 * Retourne `{ replayed, failed, skipped }`.
 */
export async function drain(axiosInstance, { onMutationFailed } = {}) {
  const stats = { replayed: 0, failed: 0, skipped: 0 }
  let items = readQueue()
  while (items.length > 0) {
    const next = items[0]
    try {
      await axiosInstance.request({
        method: next.method,
        url: next.url,
        data: next.data,
        headers: next.headers || undefined,
        // Marque la requête comme un replay pour que l'interceptor
        // ne la re-queue PAS si elle échoue à nouveau (sinon boucle).
        _isOfflineReplay: true,
      })
      stats.replayed += 1
      items.shift()
      writeQueue(items)
    } catch (err) {
      const status = err?.response?.status
      const isNetwork = !err?.response // pas de réponse = erreur réseau
      if (isNetwork) {
        // Toujours hors-ligne : on stop le drain, on reprendra plus tard.
        stats.skipped = items.length
        break
      }
      if (status >= 400 && status < 500) {
        // Validation/perm refusée : on retire la mutation (ne sera
        // jamais acceptée par le serveur).
        stats.failed += 1
        items.shift()
        writeQueue(items)
        if (onMutationFailed) onMutationFailed(next, err)
      } else {
        // 5xx : on stop, le serveur a un souci. On retentera.
        stats.skipped = items.length
        break
      }
    }
  }
  notifyChange()
  return stats
}
