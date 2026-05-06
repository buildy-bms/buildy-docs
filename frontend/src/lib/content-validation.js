// Helpers de validation de contenu (bibliotheque). 3 etats derives :
//   - 'empty'     : contenu vide ou blanc
//   - 'draft'     : contenu present mais pas valide
//   - 'validated' : content_validated_at non NULL
//
// `htmlField` = nom du champ contenant le HTML ('body_html' pour
// section_templates, 'description_html' pour equipment_templates).

export function getValidationStatus(item, htmlField = 'body_html') {
  if (!item) return 'empty'
  const html = (item[htmlField] || '').trim()
  if (!html) return 'empty'
  if (item.content_validated_at) return 'validated'
  return 'draft'
}
