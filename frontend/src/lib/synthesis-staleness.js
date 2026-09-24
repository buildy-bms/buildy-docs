// Note de synthèse périmée : datée d'avant la dernière modification du plan
// d'actions (actions générées automatiquement). Même règle que le serveur
// (précheck SYN-001 et routes/bacs-audit/_export-data.js) : une note périmée
// n'est PAS imprimée dans le rapport. Partagé par l'étape Synthèse (desktop)
// et la feuille Synthèse (mobile).
export function isSynthesisStale({ html, generatedAt, actionItems }) {
  if (!html || !generatedAt) return false
  const generated = new Date(generatedAt)
  if (isNaN(generated)) return false
  let last = null
  for (const a of actionItems || []) {
    if (!(a.auto_generated === 1 || a.auto_generated === true) || !a.updated_at) continue
    // updated_at SQLite « AAAA-MM-JJ HH:MM:SS » en UTC.
    const d = new Date(String(a.updated_at).replace(' ', 'T') + 'Z')
    if (!isNaN(d) && (!last || d > last)) last = d
  }
  return !!last && last > generated
}
