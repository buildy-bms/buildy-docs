// Directive v-tooltip : tooltip custom léger qui remplace les `title=""`
// HTML natifs (lents ~1s, style OS, pas de wrap). Apparition ~120ms,
// style Buildy (gris foncé, blanc, rounded, ombre).
//
// Usage :
//   <button v-tooltip="'Texte du tooltip'">…</button>
//   <button v-tooltip="{ text: 'Texte', placement: 'top' }">…</button>
//
// placement supportés : 'top' (défaut), 'bottom', 'left', 'right'.
// Le tooltip est singleton (un seul DOM partagé) et téléporté au <body>
// avec position fixed.

const SHOW_DELAY = 120
const HIDE_DELAY = 60
const OFFSET = 6

let el = null
let arrowEl = null
let showTimer = null
let hideTimer = null
let currentTarget = null

function ensureEl() {
  if (el) return el
  el = document.createElement('div')
  el.setAttribute('role', 'tooltip')
  Object.assign(el.style, {
    position: 'fixed',
    zIndex: '9999',
    background: '#1f2937', // gray-800
    color: '#fff',
    padding: '6px 10px',
    borderRadius: '6px',
    fontSize: '12px',
    lineHeight: '1.35',
    fontWeight: '500',
    maxWidth: '280px',
    pointerEvents: 'none',
    boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
    opacity: '0',
    transition: 'opacity 80ms ease',
    whiteSpace: 'normal',
    wordBreak: 'break-word',
  })
  arrowEl = document.createElement('div')
  Object.assign(arrowEl.style, {
    position: 'absolute',
    width: '8px',
    height: '8px',
    background: '#1f2937',
    transform: 'rotate(45deg)',
  })
  el.appendChild(arrowEl)
  document.body.appendChild(el)
  return el
}

function position(target, placement) {
  ensureEl()
  const r = target.getBoundingClientRect()
  const tw = el.offsetWidth
  const th = el.offsetHeight
  let top, left, ax, ay
  switch (placement) {
    case 'bottom':
      top = r.bottom + OFFSET
      left = r.left + r.width / 2 - tw / 2
      ax = tw / 2 - 4; ay = -4
      break
    case 'left':
      top = r.top + r.height / 2 - th / 2
      left = r.left - tw - OFFSET
      ax = tw - 4; ay = th / 2 - 4
      break
    case 'right':
      top = r.top + r.height / 2 - th / 2
      left = r.right + OFFSET
      ax = -4; ay = th / 2 - 4
      break
    case 'top':
    default:
      top = r.top - th - OFFSET
      left = r.left + r.width / 2 - tw / 2
      ax = tw / 2 - 4; ay = th - 4
      break
  }
  // Garde dans le viewport
  const margin = 4
  const vw = window.innerWidth
  const vh = window.innerHeight
  left = Math.max(margin, Math.min(left, vw - tw - margin))
  top = Math.max(margin, Math.min(top, vh - th - margin))
  el.style.top = top + 'px'
  el.style.left = left + 'px'
  arrowEl.style.left = ax + 'px'
  arrowEl.style.top = ay + 'px'
}

function show(target, opts) {
  clearTimeout(hideTimer)
  hideTimer = null
  const text = typeof opts === 'string' ? opts : (opts?.text || '')
  if (!text) return
  const placement = typeof opts === 'object' ? (opts.placement || 'top') : 'top'
  ensureEl()
  // Texte sans l'arrow
  // Réinjecter texte proprement
  const textNode = el.firstChild === arrowEl ? null : el.firstChild
  if (textNode) el.removeChild(textNode)
  el.insertBefore(document.createTextNode(text), arrowEl)
  el.style.display = 'block'
  // Position après render pour avoir les bonnes dimensions
  requestAnimationFrame(() => {
    position(target, placement)
    el.style.opacity = '1'
  })
  currentTarget = target
}

function hide() {
  if (!el) return
  clearTimeout(showTimer)
  showTimer = null
  el.style.opacity = '0'
  hideTimer = setTimeout(() => {
    if (el) el.style.display = 'none'
    currentTarget = null
  }, 100)
}

function getOpts(binding) {
  return binding.value
}

function onEnter(e) {
  const opts = e.currentTarget.__tooltipOpts
  if (!opts) return
  clearTimeout(showTimer)
  showTimer = setTimeout(() => show(e.currentTarget, opts), SHOW_DELAY)
}

function onLeave() {
  hide()
}

export const tooltipDirective = {
  mounted(el, binding) {
    el.__tooltipOpts = getOpts(binding)
    el.addEventListener('mouseenter', onEnter)
    el.addEventListener('mouseleave', onLeave)
    el.addEventListener('focus', onEnter)
    el.addEventListener('blur', onLeave)
  },
  updated(el, binding) {
    el.__tooltipOpts = getOpts(binding)
    if (currentTarget === el && el.__tooltipOpts) {
      // Texte mis à jour pendant l'affichage : on rafraîchit
      const text = typeof el.__tooltipOpts === 'string' ? el.__tooltipOpts : el.__tooltipOpts.text
      if (text) {
        const placement = typeof el.__tooltipOpts === 'object' ? (el.__tooltipOpts.placement || 'top') : 'top'
        show(el, { text, placement })
      }
    }
  },
  beforeUnmount(el) {
    el.removeEventListener('mouseenter', onEnter)
    el.removeEventListener('mouseleave', onLeave)
    el.removeEventListener('focus', onEnter)
    el.removeEventListener('blur', onLeave)
    if (currentTarget === el) hide()
    delete el.__tooltipOpts
  },
}
