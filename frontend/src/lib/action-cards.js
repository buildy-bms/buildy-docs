// Regroupement du plan d'action BACS par CARTE de l'audit (alignement
// stepper) — miroir front du helper backend
// `backend-node/src/routes/bacs-audit/_action-cards.js`. Toute evolution
// doit etre faite des deux cotes (sinon UI/PDF/MCP divergent).

const CARDS = [
  { key: 'identification', label: 'Identification' },
  { key: 'systems',        label: 'Systèmes' },
  { key: 'meters',         label: 'Compteurs' },
  { key: 'bms',            label: 'GTB', subsections: [
    { key: 'bms_capabilities', label: 'Capacités GTB' },
    { key: 'bms_devices',      label: 'Intégration équipements' },
    { key: 'bms_meters',       label: 'Intégration compteurs' },
    { key: 'bms_maintenance',  label: 'Maintenance & formation' },
  ] },
  { key: 'thermal',        label: 'Régulation' },
  { key: 'inspections',    label: 'Inspections' },
  { key: 'misc',           label: 'Divers' },
]

const CARD_KEYS = new Set(CARDS.map(c => c.key))
const SUBSECTION_KEYS = new Set(CARDS.flatMap(c => (c.subsections || []).map(s => s.key)))

const DEVICE_BMS_SUBTYPES = new Set([
  'r175_3_p3_connect', 'r175_3_p3_replace',
  'r175_3_p4', 'r175_3_p4_autonomous',
  'bms_link_broken', 'contraindication_no_cut',
])

function isBmsMaintenanceArticle(art) {
  if (!art) return false
  return art === 'R175-4' || art === 'R175-5' || art === 'R175-5-1'
}

export function cardOfAction(a) {
  if (!a) return { card: 'misc', subsection: null }
  if (a.auto_generated === 0 || a.auto_generated === false) {
    if (a.assigned_card && CARD_KEYS.has(a.assigned_card)) {
      let sub = a.assigned_subsection && SUBSECTION_KEYS.has(a.assigned_subsection) ? a.assigned_subsection : null
      if (a.assigned_card === 'bms' && !sub) sub = 'bms_capabilities'
      return { card: a.assigned_card, subsection: sub }
    }
    return { card: 'misc', subsection: null }
  }
  if (a.r175_article === 'R175-2') return { card: 'identification', subsection: null }
  if (a.source_inspection_id) return { card: 'inspections', subsection: null }
  if (a.source_thermal_id) return { card: 'thermal', subsection: null }
  if (a.source_bms_document_id) {
    if (isBmsMaintenanceArticle(a.r175_article)) return { card: 'bms', subsection: 'bms_maintenance' }
    return { card: 'bms', subsection: 'bms_capabilities' }
  }
  if (a.source_device_id) return { card: 'bms', subsection: 'bms_devices' }
  if (a.source_meter_id) {
    if (a.source_subtype === 'bms_link_broken') return { card: 'bms', subsection: 'bms_meters' }
    return { card: 'meters', subsection: null }
  }
  if (a.source_system_id) return { card: 'systems', subsection: null }
  return { card: 'misc', subsection: null }
}

export function cardMeta(key) {
  return CARDS.find(c => c.key === key) || CARDS[CARDS.length - 1]
}

// Regroupe une liste d'actions (deja triee cote backend) en cartes,
// avec sous-sections pour la carte GTB. Format identique au helper
// backend : { key, label, count, blocking, major, minor, items,
// subsections? }.
export function groupByCard(items) {
  const buckets = new Map()
  for (const it of items) {
    const { card, subsection } = cardOfAction(it)
    if (!buckets.has(card)) buckets.set(card, { items: [], subs: new Map() })
    const b = buckets.get(card)
    b.items.push(it)
    if (subsection) {
      if (!b.subs.has(subsection)) b.subs.set(subsection, [])
      b.subs.get(subsection).push(it)
    }
  }
  const out = []
  for (const c of CARDS) {
    const b = buckets.get(c.key)
    if (!b || !b.items.length) continue
    const entry = {
      key: c.key,
      label: c.label,
      count: b.items.length,
      blocking: b.items.filter(x => x.severity === 'blocking').length,
      major:    b.items.filter(x => x.severity === 'major').length,
      minor:    b.items.filter(x => x.severity === 'minor').length,
      items: b.items,
    }
    if (c.subsections) {
      entry.subsections = []
      for (const s of c.subsections) {
        const list = b.subs.get(s.key)
        if (!list || !list.length) continue
        entry.subsections.push({
          key: s.key,
          label: s.label,
          count: list.length,
          blocking: list.filter(x => x.severity === 'blocking').length,
          major:    list.filter(x => x.severity === 'major').length,
          minor:    list.filter(x => x.severity === 'minor').length,
          items: list,
        })
      }
    }
    out.push(entry)
  }
  return out
}

// Options pour le sélecteur de carte sur un item MANUEL (créateur peut
// choisir la carte cible + sous-section si GTB). Forme à plat
// [{value, label}] pour un <select> simple.
export function CARD_FLAT_OPTIONS() {
  const out = []
  for (const c of CARDS) {
    if (c.subsections) {
      for (const s of c.subsections) {
        out.push({ value: `${c.key}/${s.key}`, label: `${c.label} — ${s.label}` })
      }
    } else {
      out.push({ value: c.key, label: c.label })
    }
  }
  return out
}

export { CARDS }
