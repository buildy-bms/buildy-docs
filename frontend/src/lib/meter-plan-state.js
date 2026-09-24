// État d'un compteur dans l'onglet Compteurs, aligné sur le plan d'actions et
// le chapitre 4 du PDF (backend : routes/bacs-audit/_meter-coverage.js,
// coverageMeterState) :
// - ternaires stricts : une présence non vérifiée est « à vérifier », jamais
//   « manquante » (incident Communay) ;
// - statut calculé par le serveur (GET /bacs-audit/:id/meters/plan-status,
//   store `meterPlanStatus`) : compteur couvert par le comptage unique d'une
//   zone regroupée, ou usage exempté (règle des 5 %) / équipements déclarés
//   non concernés → compteur non exigé.
// Aucune règle métier n'est recopiée ici : le serveur décide.

const isTrue = (v) => v === 1 || v === true
const isFalse = (v) => v === 0 || v === false

// 'hs' | 'present' | 'covered' | 'not_required' | 'neutral' | 'missing' | 'unanswered'
export function meterPlanState(m, planStatus) {
  if (isTrue(m.out_of_service)) return 'hs'
  if (isTrue(m.present_actual)) return 'present'
  const status = planStatus?.[m.id]?.status
  if (status === 'covered') return 'covered'
  if (status === 'not_required') return 'not_required'
  if (!isTrue(m.required)) return 'neutral'
  return isFalse(m.present_actual) ? 'missing' : 'unanswered'
}

export const isMeterMissing = (m, planStatus) => meterPlanState(m, planStatus) === 'missing'
export const isMeterUnanswered = (m, planStatus) => meterPlanState(m, planStatus) === 'unanswered'

const NOT_REQUIRED_REASON = {
  exempt_5pct: 'Système exempté de raccordement (règle des 5 %) : ce compteur n\'est pas exigé.',
  excluded_by_auditor: 'Équipements déclarés non concernés par l\'intégration à la GTB : ce compteur n\'est pas exigé.',
}

// Mention courte (+ infobulle) affichée sous l'usage du compteur, ou null.
export function meterPlanNote(m, planStatus) {
  const st = planStatus?.[m.id]
  if (!st) return null
  if (st.status === 'covered') {
    return {
      label: 'Couvert par la zone regroupée',
      tooltip: `Zones regroupées ${st.group} : un compteur unique suffit pour l'ensemble (comptage séparé non réalisable). Ce compteur n'est pas exigé.`,
    }
  }
  if (st.status === 'lead') {
    return {
      label: 'Compteur unique de la zone regroupée',
      tooltip: `Zones regroupées ${st.group} : ce compteur porte le comptage de l'ensemble.`,
    }
  }
  if (st.status === 'not_required') {
    return { label: 'Non exigé', tooltip: NOT_REQUIRED_REASON[st.reason] || 'Ce compteur n\'est pas exigé.' }
  }
  return null
}

// Valeur du bouton Oui / Non « Présent » : null tant que la présence n'a pas
// été vérifiée (les deux boutons restent neutres).
export const presentToggleValue = (m) => (m.present_actual == null ? null : isTrue(m.present_actual))
