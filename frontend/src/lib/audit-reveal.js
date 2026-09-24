// « Révéler » une entité de l'audit (zone, système, équipement, compteur,
// GTB) depuis n'importe quelle carte : la page desktop à onglets bascule sur
// la bonne étape (+ zone / énergie), fait défiler jusqu'à l'élément et le met
// en surbrillance.
//
// Événement fenêtre plutôt que props : les émetteurs (ActionDescription,
// ThermalSection, check-list…) sont profonds et partagés avec la PWA.

export const AUDIT_REVEAL_EVENT = 'audit:reveal'

// Renvoie true si la page desktop a pris la demande en charge (son écouteur,
// synchrone, pose `handled = true`). Sur la PWA il n'y a pas d'écouteur :
// false → l'appelant garde son comportement historique.
export function requestAuditReveal(detail) {
  const d = { block: 'center', ...detail, handled: false }
  window.dispatchEvent(new CustomEvent(AUDIT_REVEAL_EVENT, { detail: d }))
  return d.handled
}

// Attend qu'un élément apparaisse (sections asynchrones, panneau monté au
// premier affichage). Résout null après `timeout` ms.
export function waitForElement(getter, timeout = 2000) {
  return new Promise(resolve => {
    const t0 = performance.now()
    const tick = () => {
      let el = null
      try { el = getter() } catch { el = null }
      if (el) return resolve(el)
      if (performance.now() - t0 > timeout) return resolve(null)
      requestAnimationFrame(tick)
    }
    tick()
  })
}

export function nextFrame() {
  return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
}

// Surbrillance brève. Animation Web (WAAPI) sur `outline` : fonctionne sur
// un <tr> (dont les <td> ont leur propre fond), ne dépend d'aucune classe
// Tailwind et résiste aux re-render Vue (className réécrit).
export function flashAuditTarget(el, duration = 1800) {
  if (!el?.animate) return
  el.animate([
    { outline: '3px solid rgb(245 158 11 / 0.95)', outlineOffset: '2px' },
    { outline: '3px solid rgb(245 158 11 / 0)', outlineOffset: '2px' },
  ], { duration, easing: 'ease-out' })
}
