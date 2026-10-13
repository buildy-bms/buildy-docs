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

// Raison d'un compteur non exigé, en mots simples (infobulle + texte du mobile).
const NOT_REQUIRED_REASON = {
  exempt_5pct: 'Cet usage pèse moins de 5 % de la consommation : il est dispensé de raccordement à la GTB, donc de compteur.',
  excluded_by_auditor: 'Les équipements de cet usage ont été déclarés non concernés par la GTB : pas de compteur exigé.',
}

// Mention courte affichée sous l'usage du compteur (`label`), son explication en une phrase
// (`text`, affichée telle quelle sur mobile) et la carte d'infobulle (`tooltip`), ou null.
export function meterPlanNote(m, planStatus) {
  const st = planStatus?.[m.id]
  if (!st) return null
  if (st.status === 'covered') {
    const text = 'Ces zones sont regroupées : un seul compteur mesure l’ensemble, car on ne peut pas compter chaque zone à part. Ce compteur-ci n’est donc pas exigé.'
    return {
      label: 'Couvert par le compteur commun',
      text,
      tooltip: { title: 'Comptage commun', tone: 'neutral', icon: 'object-group', text, rows: [{ label: 'Zones regroupées', value: st.group }], article: 'R175-3' },
    }
  }
  if (st.status === 'lead') {
    const text = 'Ces zones sont regroupées : ce compteur mesure l’ensemble.'
    return {
      label: 'Compteur commun des zones regroupées',
      text,
      tooltip: { title: 'Compteur commun', tone: 'info', icon: 'object-group', text, rows: [{ label: 'Zones regroupées', value: st.group }], article: 'R175-3' },
    }
  }
  if (st.status === 'not_required') {
    const text = NOT_REQUIRED_REASON[st.reason] || 'Ce compteur n’est pas exigé.'
    return { label: 'Non exigé', text, tooltip: { title: 'Compteur non exigé', tone: 'neutral', text, article: 'R175-3' } }
  }
  return null
}

// Colonne « Requis » d'un audit BACS (non éditable) : même lecture que le
// chapitre 4 du PDF. Un compteur couvert par le comptage unique d'une zone
// regroupée affiche « Commun », un usage exempté « Non requis » — le flag
// `required` du resync, lui, reste zone par zone et disait « Oui » sous la
// mention « Ce compteur n'est pas exigé ». Null = afficher le flag.
export function requiredCellLabel(m, planStatus) {
  const status = planStatus?.[m.id]?.status
  if (status === 'not_required') return 'Non requis'
  if (status === 'covered') return 'Commun'
  return null
}

// Valeur du bouton Oui / Non « Présent » : null tant que la présence n'a pas
// été vérifiée (les deux boutons restent neutres).
export const presentToggleValue = (m) => (m.present_actual == null ? null : isTrue(m.present_actual))
