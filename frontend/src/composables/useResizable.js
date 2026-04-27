import { ref, onUnmounted } from 'vue'

/**
 * Composable de drag-resize horizontal pour une sidebar.
 * - storageKey : clé localStorage pour persister la largeur
 * - defaultWidth, minWidth, maxWidth : en pixels
 * - direction : 'right' (poignée à droite, drag à droite agrandit) ou 'left'
 *
 * Usage :
 *   const { width, onMouseDown } = useResizable({ storageKey: 'af-tree-width' })
 *   <aside :style="{ width: width.value + 'px' }">
 *     <div class="resize-handle" @mousedown="onMouseDown" />
 *   </aside>
 */
export function useResizable({
  storageKey,
  defaultWidth = 320,
  minWidth = 200,
  maxWidth = 600,
  direction = 'right',
} = {}) {
  const stored = storageKey ? parseInt(localStorage.getItem(storageKey) || '', 10) : NaN
  const width = ref(Number.isFinite(stored) ? Math.min(Math.max(stored, minWidth), maxWidth) : defaultWidth)

  let dragging = false
  let startX = 0
  let startWidth = 0

  function onMouseDown(e) {
    dragging = true
    startX = e.clientX
    startWidth = width.value
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    e.preventDefault()
  }

  function onMouseMove(e) {
    if (!dragging) return
    const delta = direction === 'right' ? (e.clientX - startX) : (startX - e.clientX)
    const next = Math.min(Math.max(startWidth + delta, minWidth), maxWidth)
    width.value = next
  }

  function onMouseUp() {
    if (!dragging) return
    dragging = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
    if (storageKey) localStorage.setItem(storageKey, String(width.value))
  }

  onUnmounted(() => {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  })

  return { width, onMouseDown }
}
