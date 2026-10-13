// Étape Systèmes, mise en page guidée : ce qu'il reste à faire, usage par usage et zone par zone.
//
// Trois états, partout (onglets, guide, tableau, fiche, synthèse) :
//  - « à compléter » : une information manque (équipement incomplet, usage présent sans
//    équipement) ;
//  - « à vérifier » : c'est renseigné, mais incohérent ou douteux (règles du pré-contrôle de
//    livraison, et puissance manquante d'un équipement de production : le cumul du site est
//    alors incomplet) ;
//  - « sans réponse » : usage ni « présent » ni « non concerné ».
//
// Fonctions pures, imports relatifs : testées côté backend (backend-node/test/systems-guide.test.mjs).
// Règles de comptage, communes au guide et au bandeau de l'étape (systemsStepTodo) : un équipement
// compte une seule fois, dans son usage d'origine s'il est présent, sinon dans le premier usage
// présent qui le partage ; seuls les usages présents comptent leurs équipements. Sa complétude se
// juge sur la catégorie de son usage d'origine (la fiche fait de même).
import { isDeviceComplete, deviceMissingFields, deviceMissingItems } from './audit-options.js'

// Codes du pré-contrôle (backend lib/bacs-audit-precheck.js) affichés « à vérifier » dans l'étape.
// Les manques purs n'y figurent pas : ils sont déjà « à compléter » (SYS-002 = usage présent sans
// équipement ; DEV-002 = énergie d'un équipement de production, déjà exigée par la fiche).
export const CHECK_DEVICE_CODES = new Set(['DEV-001', 'DEV-003', 'DEV-004', 'DEV-005', 'DEV-006', 'DEV-007', 'DEV-008', 'THERMAL-002'])
export const CHECK_SYSTEM_CODES = new Set(['SYS-001', 'SYS-003'])
// Point « à vérifier » ajouté par l'écran : équipement de production sans puissance
// (power_summary.incompletePowerDeviceIds, même règle que le cumul des puissances).
export const MISSING_POWER_CODE = 'POWER-MISSING'

/**
 * Index des points « à vérifier » : par équipement, par système, et par catégorie d'usage pour
 * les règles qui portent sur une fonction entière (règle des 5 %, sans système précis).
 */
export function indexChecks(precheck, { missingPowerIds = [] } = {}) {
  const byDevice = new Map()
  const bySystem = new Map()
  const byCategory = new Map()
  const add = (map, key, f) => {
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(f)
  }
  for (const f of [...(precheck?.blocking || []), ...(precheck?.warnings || [])]) {
    if (f.entity === 'device' && CHECK_DEVICE_CODES.has(f.code) && f.entity_id != null) add(byDevice, f.entity_id, f)
    else if (f.entity === 'system' && CHECK_SYSTEM_CODES.has(f.code)) {
      if (f.entity_id != null) add(bySystem, f.entity_id, f)
      else if (f.system_category) add(byCategory, f.system_category, f)
    }
  }
  for (const id of missingPowerIds || []) {
    if ((byDevice.get(id) || []).some(f => f.code === MISSING_POWER_CODE)) continue
    add(byDevice, id, { code: MISSING_POWER_CODE, severity: 'warning', entity: 'device', entity_id: id })
  }
  return { byDevice, bySystem, byCategory }
}

export const EMPTY_INDEX = indexChecks(null)

function rolesOf(d) {
  return Array.isArray(d.device_role) ? d.device_role : (d.device_role ? [d.device_role] : [])
}
const ROLE_ORDER = { production: 1, distribution: 2, emission: 3, regulation: 4 }
/** Rang d'un équipement dans sa liste : production, distribution, émission, régulation. */
export function rolePriority(d) {
  const roles = rolesOf(d)
  if (!roles.length) return 5
  return Math.min(...roles.map(r => ROLE_ORDER[String(r).toLowerCase()] || 5))
}
/** Même ordre que la liste des équipements (SystemDeviceList) : fonction, puis nom. */
export function sortDevices(list) {
  return [...(list || [])].sort((a, b) => (rolePriority(a) - rolePriority(b))
    || (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase()))
}

/** Équipements d'un usage : les siens, puis ceux partagés depuis un autre usage. */
export function systemDevices(system, devicesBySystem, allDevices) {
  const own = devicesBySystem?.[system.id] || []
  const shared = (allDevices || []).filter(d =>
    d.system_id !== system.id && (d.extra_system_ids || []).includes(system.id))
  return { own, shared }
}

/** Ce qui manque à un équipement (vide s'il est complet ou validé malgré tout). */
export function deviceMissing(device, category) {
  return isDeviceComplete(device, category) ? [] : deviceMissingFields(device, category)
}

/** Usage présent : « Présent » coché (et pas « non concerné »). */
export function isPresentSystem(system) {
  return !!system?.present && !system?.not_concerned
}

/** Usage d'eau chaude présent dont le bouclage n'a pas de réponse (Bouclée, Non bouclée ou Inconnu). */
export function loopMissing(system) {
  return isPresentSystem(system) && system.system_category === 'dhw' && !system.is_looped
}

/**
 * Usage où un équipement compte (une seule fois) : son usage d'origine s'il est présent, sinon le
 * premier usage présent qui le partage ; null = l'équipement n'est pas audité (aucun usage présent).
 */
export function deviceHomeId(device, systemsById) {
  const own = systemsById?.get(device.system_id)
  if (!own || isPresentSystem(own)) return device.system_id
  for (const id of device.extra_system_ids || []) {
    if (isPresentSystem(systemsById.get(id))) return id
  }
  return null
}

/**
 * État d'un usage (système d'une zone).
 * status ∈ 'not_concerned' | 'unanswered' | 'check' | 'empty' | 'todo' | 'done'.
 * toComplete = équipements incomplets qui comptent ici (+ 1 si présent sans aucun équipement,
 * + 1 si le bouclage de l'eau chaude n'a pas de réponse) ; toCheck = points à vérifier.
 * `systemsById` (facultatif) : catégorie d'origine des équipements partagés et usage où ils comptent.
 */
export function systemGuide(system, { devicesBySystem = {}, allDevices = [], index = EMPTY_INDEX, systemsById = null } = {}) {
  const { own, shared } = systemDevices(system, devicesBySystem, allDevices)
  const present = isPresentSystem(system)
  const notConcerned = !!system.not_concerned && !system.present
  const unanswered = !system.present && !system.not_concerned
  const originCategory = (d) => systemsById?.get(d.system_id)?.system_category || system.system_category
  const entry = (d, category) => {
    const missing = deviceMissing(d, category)
    // Puissance manquante d'une production de chauffage ou de froid : déjà « à compléter ».
    const keys = missing.length ? deviceMissingItems(d, category).map(m => m.key) : []
    const checks = (index.byDevice.get(d.id) || []).filter(f => !(f.code === MISSING_POWER_CODE && keys.includes('power')))
    return { device: d, missing, checks }
  }
  const devices = sortDevices(own).map(d => entry(d, system.system_category))
  const sharedEntries = sortDevices(shared).map(d => ({
    ...entry(d, originCategory(d)),
    // Compte ici : son usage d'origine n'est pas présent et celui-ci est le premier qui le partage.
    countsHere: !!systemsById && present && deviceHomeId(d, systemsById) === system.id,
  }))
  const counted = present ? [...devices, ...sharedEntries.filter(e => e.countsHere)] : []
  const checks = [
    ...(index.bySystem.get(system.id) || []),
    ...(system.marked_negligible_under_5pct ? (index.byCategory.get(system.system_category) || []) : []),
  ]
  const empty = present && own.length + shared.length === 0
  const loop = loopMissing(system)
  const incomplete = counted.filter(e => e.missing.length).length
  const toComplete = incomplete + (empty ? 1 : 0) + (loop ? 1 : 0)
  const toCheck = counted.reduce((n, e) => n + e.checks.length, 0) + checks.length
  let status = 'done'
  if (notConcerned && !checks.length) status = 'not_concerned'
  else if (unanswered) status = 'unanswered'
  else if (toCheck) status = 'check'
  else if (empty) status = 'empty'
  else if (incomplete || loop) status = 'todo'
  return {
    system, status, present, empty, loopMissing: loop, incomplete, toComplete, toCheck, checks,
    devices,
    shared: sharedEntries,
  }
}

/**
 * Ce qui empêche de valider l'étape Systèmes (bandeau de l'étape, les deux mises en page) : mêmes
 * règles que le guide. « À vérifier » n'y figure pas : contrôlé à la livraison, il ne bloque pas.
 * → { unanswered, empty, loops, incompleteDevices } (zéro partout = étape complète).
 */
export function systemsStepTodo(systems, devices) {
  const list = systems || []
  const systemsById = new Map(list.map(s => [s.id, s]))
  const devicesBySystem = {}
  for (const d of devices || []) (devicesBySystem[d.system_id] ||= []).push(d)
  const shared = new Set()
  for (const d of devices || []) for (const id of d.extra_system_ids || []) shared.add(id)
  let unanswered = 0
  let empty = 0
  let loops = 0
  for (const s of list) {
    if (!s.present && !s.not_concerned) unanswered++
    if (!isPresentSystem(s)) continue
    if (!(devicesBySystem[s.id] || []).length && !shared.has(s.id)) empty++
    if (loopMissing(s)) loops++
  }
  let incompleteDevices = 0
  for (const d of devices || []) {
    if (deviceHomeId(d, systemsById) == null) continue
    if (!isDeviceComplete(d, systemsById.get(d.system_id)?.system_category)) incompleteDevices++
  }
  return { unanswered, empty, loops, incompleteDevices }
}

/** État d'une zone : ses usages, puis les compteurs cumulés. */
export function zoneGuide(group, ctx) {
  const systems = (group.items || []).map(s => systemGuide(s, ctx))
  const sum = (k) => systems.reduce((n, x) => n + x[k], 0)
  const presentOnes = systems.filter(x => x.present)
  return {
    zoneId: group.zone_id,
    zoneName: group.zone_name || 'Zone sans nom',
    systems,
    toComplete: sum('toComplete'),
    toCheck: sum('toCheck'),
    unanswered: systems.filter(x => x.status === 'unanswered').length,
    present: presentOnes.length,
    done: presentOnes.filter(x => x.status === 'done').length,
    incompleteDevices: sum('incomplete'),
    emptySystems: systems.filter(x => x.empty).length,
    loops: systems.filter(x => x.loopMissing).length,
  }
}

/** Compteurs de toutes les zones (onglet « Synthèse des systèmes »). */
export function guideTotals(zoneStates) {
  return (zoneStates || []).reduce((t, z) => ({
    zones: t.zones + 1,
    toComplete: t.toComplete + z.toComplete,
    toCheck: t.toCheck + z.toCheck,
    unanswered: t.unanswered + z.unanswered,
    incompleteDevices: t.incompleteDevices + z.incompleteDevices,
    emptySystems: t.emptySystems + z.emptySystems,
    loops: t.loops + (z.loops || 0),
  }), { zones: 0, toComplete: 0, toCheck: 0, unanswered: 0, incompleteDevices: 0, emptySystems: 0, loops: 0 })
}

/**
 * Points à reprendre, dans l'ordre de l'écran : zone, usage, puis ses équipements (production
 * d'abord). Un point = un usage (sans réponse, sans équipement, ou à vérifier) ou un équipement
 * (incomplet ou à vérifier). `order` = position [zone, usage, équipement] pour trouver le suivant.
 */
export function guideStops(zoneStates) {
  const out = []
  ;(zoneStates || []).forEach((z, zi) => {
    z.systems.forEach((x, si) => {
      if (x.status === 'not_concerned') return
      if (x.status === 'unanswered' || x.empty || x.checks.length || x.loopMissing) {
        out.push({
          kind: 'system', zoneId: z.zoneId, systemId: x.system.id, order: [zi, si, -1],
          reason: x.status === 'unanswered' ? 'unanswered' : (x.checks.length ? 'check' : (x.empty ? 'empty' : 'loop')),
        })
      }
      if (!x.present) return
      countedEntries(x).forEach((e, di) => {
        if (!e.missing.length && !e.checks.length) return
        out.push({
          kind: 'device', zoneId: z.zoneId, systemId: x.system.id, deviceId: e.device.id, order: [zi, si, di],
          reason: e.checks.length ? 'check' : 'complete',
        })
      })
    })
  })
  return out
}

/** Équipements qui comptent dans un usage : les siens, puis les partagés dont il est l'usage de rattachement. */
function countedEntries(x) {
  return [...x.devices, ...(x.shared || []).filter(e => e.countsHere)]
}

function cmpOrder(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

/** Position à l'écran d'un équipement ou d'un usage (même si ce n'est plus un point à reprendre). */
export function positionOf(zoneStates, { systemId, deviceId = null }) {
  for (let zi = 0; zi < (zoneStates || []).length; zi++) {
    const si = zoneStates[zi].systems.findIndex(x => x.system.id === systemId)
    if (si < 0) continue
    if (deviceId == null) return [zi, si, -1]
    const devs = countedEntries(zoneStates[zi].systems[si])
    const di = devs.findIndex(e => e.device.id === deviceId)
    // Équipement partagé depuis une autre zone : rangé après les équipements de l'usage.
    return [zi, si, di < 0 ? devs.length : di]
  }
  return null
}

/**
 * Prochain point à reprendre après une position (équipement ou usage ouvert), zone après zone.
 * Arrivé au bout, on repart du premier point restant (ceux passés plus tôt). null = plus rien.
 */
export function nextStop(stops, zoneStates, current = null) {
  if (!stops?.length) return null
  const pos = current ? positionOf(zoneStates, current) : null
  if (!pos) return stops[0]
  const isCurrent = (s) => s.systemId === current.systemId
    && (current.deviceId == null ? s.kind === 'system' : s.deviceId === current.deviceId)
  return stops.find(s => cmpOrder(s.order, pos) > 0) || stops.find(s => !isCurrent(s)) || null
}

// Libellés courts de ce qui manque (deviceMissingFields), pour la ligne « réponses manquantes ».
// Une évolution de deviceMissingFields doit être reportée ici (test de non-dérive côté backend).
export const MISSING_SHORT = {
  'un nom, une marque ou une référence': 'nom ou référence',
  "l'énergie": 'énergie',
  'la communication (oui ou non)': 'communication',
  'au moins un protocole de communication': 'protocole de communication',
  "la fonction de l'équipement (production, émission…)": 'fonction',
  'la liaison câblée vers la GTB (oui ou non)': 'liaison câblée à la GTB',
  "l'arrêt à la main depuis la GTB (oui ou non)": 'arrêt à la main',
  'le fonctionnement sans la GTB (oui ou non)': 'fonctionnement sans la GTB',
  'équipement de secours (oui ou non)': 'secours',
  'hors service (oui ou non)': 'hors service',
  'le comptage séparable par zone': 'comptage par zone',
  'la puissance (ou « puissance inconnue »)': 'puissance',
  'la régulation (oui ou non)': 'régulation',
  'la régulation intégrée ou déportée': 'régulation intégrée ou déportée',
  'le type de régulation de la production': 'type de régulation de la production',
  'le type de régulation de la distribution': 'type de régulation de la distribution',
  "le type de régulation de l'émission": "type de régulation de l'émission",
  'si l’équipement dessert plusieurs bâtiments (oui ou non)': 'plusieurs bâtiments',
}
export function missingShort(label) {
  return MISSING_SHORT[label] || label
}

/**
 * Ce qui manque dans une zone : nombre de réponses, d'équipements concernés, et libellés courts
 * (les plus fréquents d'abord).
 */
export function missingSummary(zoneState) {
  const counts = new Map()
  let answers = 0
  let devices = 0
  for (const x of zoneState?.systems || []) {
    if (!x.present) continue
    for (const e of countedEntries(x)) {
      if (!e.missing.length) continue
      devices++
      for (const m of e.missing) {
        answers++
        const k = missingShort(m)
        counts.set(k, (counts.get(k) || 0) + 1)
      }
    }
  }
  const labels = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  return { answers, devices, labels }
}

/** Points « à vérifier » d'une zone (lignes en tête, carte de la fiche). */
export function zoneChecks(zoneState) {
  const out = []
  for (const x of zoneState?.systems || []) {
    for (const f of x.checks) out.push({ kind: 'system', system: x.system, finding: f })
    if (!x.present) continue
    for (const e of countedEntries(x)) for (const f of e.checks) out.push({ kind: 'device', system: x.system, device: e.device, finding: f })
  }
  return out
}

/** Cases du tableau de présence qui portent un point à vérifier : « zoneId:catégorie ». */
export function checkCells(zoneStates) {
  const out = new Set()
  for (const z of zoneStates || []) {
    for (const x of z.systems) {
      if (!x.toCheck) continue
      out.add(`${z.zoneId}:${!x.system.is_bacs ? '__other' : x.system.system_category}`)
    }
  }
  return out
}
