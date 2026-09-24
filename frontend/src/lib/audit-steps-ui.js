// Navigation par étapes de l'audit BACS desktop : phases colorées, objectifs
// affichés dans le bandeau guide, clé d'injection du « mode étape ».
//
// Classes Tailwind écrites EN ENTIER (détection statique Tailwind 4) : ne
// jamais construire `bg-${couleur}-50` dynamiquement. Palette choisie hors
// vert / ambre / rouge, réservés aux états (validée, à valider, bloquante).

// Clé en chaîne (pas un Symbol) : un Symbol serait recréé au rechargement à
// chaud (HMR Vite) et inject() renverrait null dans les composants montés.
export const AUDIT_STEP_MODE_KEY = 'audit:step-mode'

export const AUDIT_PHASES = [
  {
    key: 'site',
    label: 'Site',
    steps: ['identification', 'zones'],
    tone: {
      label: 'text-sky-700',
      bar: 'border-sky-300',
      underline: 'after:bg-sky-500',
      icon: 'text-sky-600',
      tile: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200',
      accent: 'border-l-sky-400',
      chip: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200',
    },
  },
  {
    key: 'equipment',
    label: 'Équipements',
    steps: ['systems', 'thermal', 'meters'],
    tone: {
      label: 'text-violet-700',
      bar: 'border-violet-300',
      underline: 'after:bg-violet-500',
      icon: 'text-violet-600',
      tile: 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200',
      accent: 'border-l-violet-400',
      chip: 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200',
    },
  },
  {
    key: 'supervision',
    label: 'Supervision',
    steps: ['bms', 'inspections'],
    // indigo = navy Buildy (palette remappée dans main.css)
    tone: {
      label: 'text-indigo-700',
      bar: 'border-indigo-300',
      underline: 'after:bg-indigo-600',
      icon: 'text-indigo-600',
      tile: 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200',
      accent: 'border-l-indigo-500',
      chip: 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200',
    },
  },
  {
    key: 'dossier',
    label: 'Dossier',
    steps: ['docs-checklist', 'documents', 'credentials', 'review', 'synthesis'],
    tone: {
      label: 'text-pink-700',
      bar: 'border-pink-300',
      underline: 'after:bg-pink-500',
      icon: 'text-pink-600',
      tile: 'bg-pink-50 text-pink-700 ring-1 ring-inset ring-pink-200',
      accent: 'border-l-pink-400',
      chip: 'bg-pink-50 text-pink-700 ring-1 ring-inset ring-pink-200',
    },
  },
]

const PHASE_BY_STEP = Object.fromEntries(AUDIT_PHASES.flatMap(p => p.steps.map(k => [k, p])))
export function phaseForStep(key) {
  return PHASE_BY_STEP[key] || null
}

// Objectif de chaque étape, affiché en tête du bandeau guide.
export const AUDIT_STEP_OBJECTIVES = {
  identification: 'Rattacher le site et déterminer si le bâtiment est assujetti au décret BACS (R175-2) : puissance chauffage + climatisation et date du permis de construire.',
  zones: 'Découper le site en zones fonctionnelles homogènes (R175-1 6°) et inventorier les locaux techniques.',
  systems: 'Pour chaque zone, indiquer les usages présents ou non concernés, puis renseigner complètement chaque équipement.',
  thermal: 'Pour chaque système de chauffage et de refroidissement, décrire la régulation automatique : production, distribution et émission (R175-6).',
  meters: 'Pointer les compteurs requis par énergie et par usage : présents, absents ou hors service (R175-3 1°).',
  bms: "Décrire la GTB en place, puis évaluer ses capacités (R175-3), la maintenance (R175-4) et la formation de l'exploitant (R175-5).",
  inspections: "Renseigner la dernière inspection périodique de la GTB (R175-5-1), ou indiquer qu'aucune inspection n'est à déclarer.",
  'docs-checklist': 'Collecter les pièces du dossier (plans, schémas, synoptique GTB, AF…) et une photo de chaque zone, système, compteur et de la GTB.',
  documents: 'Déposer les documents du site : plans, schémas, fiches techniques et manuels.',
  credentials: 'Renseigner les accès (web, SSH, VPN) à la GTB et aux systèmes. Ils sont stockés chiffrés.',
  review: 'Relire le plan de mise en conformité, ajuster les actions et leurs préconisations.',
  synthesis: "Rédiger la note de synthèse affichée en tête du rapport, à la main ou avec l'aide de Claude.",
}

export function stepObjective(key, isBacs = true) {
  const o = AUDIT_STEP_OBJECTIVES[key] || ''
  return isBacs ? o : o.replace(/\s*\(R175[^)]*\)/g, '')
}
