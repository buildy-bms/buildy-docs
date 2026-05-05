import { ref, onMounted, onBeforeUnmount } from 'vue'

const _online = ref(typeof navigator !== 'undefined' ? navigator.onLine !== false : true)
let _refCount = 0

function syncOnline() {
  _online.value = navigator.onLine !== false
}

function attach() {
  if (typeof window === 'undefined') return
  if (_refCount === 0) {
    window.addEventListener('online', syncOnline)
    window.addEventListener('offline', syncOnline)
    syncOnline()
  }
  _refCount += 1
}

function detach() {
  _refCount = Math.max(0, _refCount - 1)
  if (_refCount === 0 && typeof window !== 'undefined') {
    window.removeEventListener('online', syncOnline)
    window.removeEventListener('offline', syncOnline)
  }
}

/**
 * Singleton réactif `isOnline` exposant l'état de connexion réseau.
 * Note : `navigator.onLine` est conservateur — il indique simplement que
 * l'OS détecte une interface réseau. Il peut être true alors qu'aucun
 * serveur n'est joignable. Pour fiabilité maximale, à coupler avec un
 * ping API périodique si besoin.
 */
export function useOnlineStatus() {
  onMounted(attach)
  onBeforeUnmount(detach)
  return { isOnline: _online }
}
