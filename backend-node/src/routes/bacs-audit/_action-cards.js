'use strict';

// Regroupement du plan d'action BACS par CARTE de l'audit (alignement
// stepper). Remplace l'ancien decoupage par article R175 (cf. historique
// _action-themes.js, refonte 2026-05-29 → cards 2026-05-29). Rationale :
// l'utilisateur retrouve immediatement dans quelle carte il doit aller
// corriger une action ; le decoupage par article forcait l'utilisateur
// a faire le mapping mental « R175-3 §3 → c'est ou dans mon audit ? ».
//
// 7 cartes generatrices :
//   identification | systems | meters | bms (sous-divise) | thermal |
//   inspections | misc (catch-all + items manuels)
//
// La carte « bms » comporte 4 sous-sections internes :
//   bms_capabilities   : capacites GTB (archivage 5 ans, derives, mise a
//                        dispo, accès proprietaire, export)
//   bms_devices        : integration des equipements (raccordement, arret
//                        manuel, autonomie, equipement non-communicant a
//                        rendre communicant via module ou remplacement)
//   bms_meters         : integration des compteurs a la GTB (liaison
//                        cassee, compteur communicant non rattache)
//   bms_maintenance    : maintenance R175-4 + formation R175-5
//
// Numerotation BACS-NNN : ordre des cartes ci-dessus, puis ordre des
// sous-sections pour bms, puis severite (blocking > major > minor), puis
// article R175 puis id. Le numero suit la lecture top-down du plan.

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
];

const CARD_ORDER  = new Map(CARDS.map((c, i) => [c.key, i]));
const SUBSEC_ORDER = new Map();
for (const c of CARDS) {
  if (!c.subsections) continue;
  c.subsections.forEach((s, i) => SUBSEC_ORDER.set(s.key, i));
}
const SEVERITY_ORDER = { blocking: 0, major: 1, minor: 2 };

// Resolution carte + sous-section a partir des FK source_*_id, du
// source_subtype et de l'article R175. Convention figee 2026-05-29 avec
// Kevin :
//   1. R175-2                              → identification
//   2. source_meter_id + subtype != bms_*  → meters
//      source_meter_id + subtype == bms_*  → bms / bms_meters
//   3. source_thermal_id                   → thermal
//   4. source_inspection_id                → inspections
//   5. source_bms_document_id              → bms (sous-section selon
//                                            subtype/article)
//   6. source_device_id                    → bms / bms_devices
//      (le user a tranche : "raccorder un equipement a la GTB" doit
//      vivre dans la carte GTB, pas dans la carte Systemes, parce que
//      l'action est sur la GTB qui doit lire l'equipement.)
//   7. source_system_id                    → systems
//   8. items manuels (auto_generated=0)    → respect du champ
//      `assigned_card` saisi par l'auditeur, fallback 'misc'
//
// Sous-sections GTB :
//   - bms_devices      : subtype in { r175_3_p3_connect, r175_3_p3_replace,
//                        r175_3_p4, r175_3_p4_autonomous, bms_link_broken
//                        (sur device), contraindication_no_cut }
//   - bms_meters       : subtype bms_link_broken sur meter, OU action sur
//                        meter avec article = §3 (raccordement compteur a
//                        la GTB)
//   - bms_maintenance  : article R175-4 ou R175-5
//   - bms_capabilities : tout le reste sur source_bms_document_id (P1, P2,
//                        data_provision_*, data_storage_5y, data_owner_access,
//                        data_export_capability, GTB absente, etc.)

function isBmsMaintenanceArticle(art) {
  if (!art) return false;
  return art === 'R175-4' || art === 'R175-5' || art === 'R175-5-1';
}

const DEVICE_BMS_SUBTYPES = new Set([
  'r175_3_p3_connect',
  'r175_3_p3_replace',
  'r175_3_p4',
  'r175_3_p4_autonomous',
  'bms_link_broken',
  'contraindication_no_cut',
]);

function cardOfAction(a) {
  if (!a) return { card: 'misc', subsection: null };
  // 1) Items manuels : on respecte le choix de l'auditeur si saisi.
  if (a.auto_generated === 0 || a.auto_generated === false) {
    const assigned = a.assigned_card;
    if (assigned && CARD_ORDER.has(assigned)) return cardSpec(assigned, a.assigned_subsection);
    return { card: 'misc', subsection: null };
  }
  // 2) Article R175-2 → identification (quand on en generera).
  if (a.r175_article === 'R175-2') return { card: 'identification', subsection: null };
  // 3) Inspection R175-5-1.
  if (a.source_inspection_id) return { card: 'inspections', subsection: null };
  // 4) Regulation thermique R175-6.
  if (a.source_thermal_id) return { card: 'thermal', subsection: null };
  // 5) GTB elle-meme : capacites / maintenance.
  if (a.source_bms_document_id) {
    if (isBmsMaintenanceArticle(a.r175_article)) return { card: 'bms', subsection: 'bms_maintenance' };
    return { card: 'bms', subsection: 'bms_capabilities' };
  }
  // 6) Equipement physique : integration GTB des equipements.
  if (a.source_device_id) {
    return { card: 'bms', subsection: 'bms_devices' };
  }
  // 7) Compteur : la majorite reste dans la carte Compteurs (poser,
  //    remplacer, raccorder physiquement). Sauf les actions liees a
  //    l'integration GTB du compteur : "liaison cassee" → carte GTB,
  //    sous-section "Integration compteurs". Le user a explicitement
  //    decoupe ainsi : ajout/remplacement = Compteurs, integration GTB =
  //    sous-section GTB.
  if (a.source_meter_id) {
    if (a.source_subtype === 'bms_link_broken') {
      return { card: 'bms', subsection: 'bms_meters' };
    }
    return { card: 'meters', subsection: null };
  }
  // 8) Usage technique : carte Systemes (exemption 5%, ECS bouclée,
  //    usage non-communicant au sens « groupe d'equipements »).
  if (a.source_system_id) return { card: 'systems', subsection: null };
  // 9) Fallback.
  return { card: 'misc', subsection: null };
}

function cardSpec(card, subsection) {
  // Pour un manuel reaffecte vers une carte GTB sans sous-section
  // explicite, on retombe sur 'bms_capabilities' par defaut.
  if (card === 'bms' && !subsection) return { card: 'bms', subsection: 'bms_capabilities' };
  return { card, subsection: subsection || null };
}

function cardMeta(key) {
  return CARDS.find(c => c.key === key) || CARDS[CARDS.length - 1];
}

function subsectionMeta(card, subKey) {
  const c = cardMeta(card);
  if (!c?.subsections || !subKey) return null;
  return c.subsections.find(s => s.key === subKey) || null;
}

// Tri stable par (carte → sous-section → severite → article → id) en
// vue de la renumerotation BACS-001..NNN.
function sortActions(items) {
  return [...items].sort((a, b) => {
    const ca = cardOfAction(a);
    const cb = cardOfAction(b);
    const oa = CARD_ORDER.get(ca.card) ?? 99;
    const ob = CARD_ORDER.get(cb.card) ?? 99;
    if (oa !== ob) return oa - ob;
    const sa1 = SUBSEC_ORDER.get(ca.subsection) ?? 99;
    const sb1 = SUBSEC_ORDER.get(cb.subsection) ?? 99;
    if (sa1 !== sb1) return sa1 - sb1;
    const sa = SEVERITY_ORDER[a.severity] ?? 99;
    const sb = SEVERITY_ORDER[b.severity] ?? 99;
    if (sa !== sb) return sa - sb;
    const ra = a.r175_article || 'ZZZ';
    const rb = b.r175_article || 'ZZZ';
    if (ra !== rb) return ra.localeCompare(rb, 'fr');
    return (a.id || 0) - (b.id || 0);
  });
}

// Regroupe une liste deja triee en cartes (avec sous-sections pour bms).
// Chaque entree contient { key, label, count, blocking, major, minor,
// items, subsections } et n'apparait que si elle a au moins un item.
function groupByCard(numberedItems) {
  const buckets = new Map();
  for (const item of numberedItems) {
    const { card, subsection } = cardOfAction(item);
    if (!buckets.has(card)) buckets.set(card, { items: [], subs: new Map() });
    const b = buckets.get(card);
    b.items.push(item);
    if (subsection) {
      if (!b.subs.has(subsection)) b.subs.set(subsection, []);
      b.subs.get(subsection).push(item);
    }
  }
  const groups = [];
  for (const c of CARDS) {
    const b = buckets.get(c.key);
    if (!b || !b.items.length) continue;
    const out = {
      key: c.key,
      label: c.label,
      count: b.items.length,
      blocking: b.items.filter(x => x.severity === 'blocking').length,
      major:    b.items.filter(x => x.severity === 'major').length,
      minor:    b.items.filter(x => x.severity === 'minor').length,
      first_number: b.items[0].display_number,
      last_number:  b.items[b.items.length - 1].display_number,
      items: b.items,
    };
    if (c.subsections) {
      out.subsections = [];
      for (const s of c.subsections) {
        const list = b.subs.get(s.key);
        if (!list || !list.length) continue;
        out.subsections.push({
          key: s.key,
          label: s.label,
          count: list.length,
          blocking: list.filter(x => x.severity === 'blocking').length,
          major:    list.filter(x => x.severity === 'major').length,
          minor:    list.filter(x => x.severity === 'minor').length,
          items: list,
        });
      }
    }
    groups.push(out);
  }
  return groups;
}

module.exports = {
  CARDS,
  cardOfAction,
  cardMeta,
  subsectionMeta,
  sortActions,
  groupByCard,
};
