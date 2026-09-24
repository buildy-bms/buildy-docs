// Navigation clavier d'une liste d'onglets (role="tablist") : flèches
// gauche/droite, Début/Fin déplacent le focus ; Entrée/Espace = clic natif
// (activation manuelle : la 1re ouverture d'une étape peut être lourde).
// Les onglets `aria-disabled="true"` sont sautés.
export function useRovingTabs(containerRef, { keyAttr = 'data-key' } = {}) {
  const tabs = () => [...(containerRef.value?.querySelectorAll('[role="tab"]') || [])]
    .filter(t => t.getAttribute('aria-disabled') !== 'true')

  // Défilement horizontal du conteneur seulement : scrollIntoView ferait
  // aussi défiler la page (la barre est dans un en-tête collant).
  function ensureElVisible(el) {
    const sc = containerRef.value
    if (!sc || !el) return
    const l = el.offsetLeft
    const r = l + el.offsetWidth
    if (l < sc.scrollLeft) sc.scrollLeft = Math.max(0, l - 12)
    else if (r > sc.scrollLeft + sc.clientWidth) sc.scrollLeft = r - sc.clientWidth + 12
  }

  function ensureVisible(key) {
    if (key == null) return
    ensureElVisible(containerRef.value?.querySelector(`[${keyAttr}="${key}"]`))
  }

  function onKeydown(e) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    const list = tabs()
    if (!list.length) return
    const i = Math.max(0, list.indexOf(document.activeElement))
    const n = e.key === 'Home' ? 0
      : e.key === 'End' ? list.length - 1
        : (i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length
    e.preventDefault()
    list[n].focus()
    ensureElVisible(list[n])
  }

  return { onKeydown, ensureVisible }
}
