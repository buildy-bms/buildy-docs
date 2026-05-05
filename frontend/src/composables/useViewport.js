import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const MOBILE_QUERY = '(max-width: 767px)'
const NARROW_QUERY = '(max-width: 1023px)'
const COARSE_QUERY = '(pointer: coarse)'

const _isMobile = ref(false)
const _isNarrow = ref(false)
const _isCoarsePointer = ref(false)
let _mqMobile = null
let _mqNarrow = null
let _mqCoarse = null
let _refCount = 0

function syncFromMatchMedia() {
  if (typeof window === 'undefined') return
  _isMobile.value = window.matchMedia(MOBILE_QUERY).matches
  _isNarrow.value = window.matchMedia(NARROW_QUERY).matches
  _isCoarsePointer.value = window.matchMedia(COARSE_QUERY).matches
}

function attachListeners() {
  if (typeof window === 'undefined') return
  if (_refCount === 0) {
    _mqMobile = window.matchMedia(MOBILE_QUERY)
    _mqNarrow = window.matchMedia(NARROW_QUERY)
    _mqCoarse = window.matchMedia(COARSE_QUERY)
    _mqMobile.addEventListener('change', syncFromMatchMedia)
    _mqNarrow.addEventListener('change', syncFromMatchMedia)
    _mqCoarse.addEventListener('change', syncFromMatchMedia)
    syncFromMatchMedia()
  }
  _refCount += 1
}

function detachListeners() {
  _refCount = Math.max(0, _refCount - 1)
  if (_refCount === 0 && _mqMobile && _mqNarrow && _mqCoarse) {
    _mqMobile.removeEventListener('change', syncFromMatchMedia)
    _mqNarrow.removeEventListener('change', syncFromMatchMedia)
    _mqCoarse.removeEventListener('change', syncFromMatchMedia)
    _mqMobile = null
    _mqNarrow = null
    _mqCoarse = null
  }
}

export function useViewport() {
  onMounted(attachListeners)
  onBeforeUnmount(detachListeners)
  return {
    // isMobile : phone portrait/landscape (cards stack rendering)
    isMobile: computed(() => _isMobile.value),
    isDesktop: computed(() => !_isMobile.value),
    // isNarrow : phone OU iPad portrait (sidebar stepper masque, bottom nav visible)
    isNarrow: computed(() => _isNarrow.value),
    isWide: computed(() => !_isNarrow.value),
    isCoarsePointer: computed(() => _isCoarsePointer.value),
  }
}
