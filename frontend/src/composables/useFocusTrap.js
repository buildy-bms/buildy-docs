import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'

// Focus trap pour modales : capture le focus au montage, restaure le
// dernier focus au demontage, et boucle Tab/Shift+Tab a l'interieur du
// containerRef. A coupler avec role="dialog" + aria-modal="true".
//
// Usage :
//   const containerRef = ref(null)
//   useFocusTrap(containerRef, () => props.open)
//   <div ref="containerRef" role="dialog" aria-modal="true" ...>
const FOCUSABLE_SELECTOR = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled])', 'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useFocusTrap(containerRef, isOpen) {
  const lastActive = ref(null)

  function focusableEls() {
    if (!containerRef.value) return []
    return Array.from(containerRef.value.querySelectorAll(FOCUSABLE_SELECTOR))
      .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null)
  }

  function onKeydown(e) {
    if (e.key !== 'Tab') return
    const els = focusableEls()
    if (!els.length) { e.preventDefault(); return }
    const first = els[0]
    const last = els[els.length - 1]
    const active = document.activeElement
    if (e.shiftKey && active === first) { last.focus(); e.preventDefault() }
    else if (!e.shiftKey && active === last) { first.focus(); e.preventDefault() }
  }

  async function activate() {
    lastActive.value = document.activeElement
    await nextTick()
    const els = focusableEls()
    if (els.length) els[0].focus()
    else containerRef.value?.focus?.()
    document.addEventListener('keydown', onKeydown)
  }

  function deactivate() {
    document.removeEventListener('keydown', onKeydown)
    if (lastActive.value && typeof lastActive.value.focus === 'function') {
      try { lastActive.value.focus() } catch { /* element may be removed */ }
    }
    lastActive.value = null
  }

  // Si isOpen() est fourni, on suit son etat. Sinon le trap est actif
  // pendant toute la duree de vie du composant (ouverture systematique).
  if (typeof isOpen === 'function') {
    watch(isOpen, (v) => v ? activate() : deactivate(), { flush: 'post' })
    onMounted(() => { if (isOpen()) activate() })
  } else {
    onMounted(activate)
  }
  onBeforeUnmount(deactivate)
}
