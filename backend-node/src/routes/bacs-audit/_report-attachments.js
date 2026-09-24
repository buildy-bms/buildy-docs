// Annexe « Documents joints » du rapport d'audit (demande Kévin 2026-09-24).
//
// Seuls les documents du site cochés « Inclure dans le rapport »
// (site_documents.include_in_report = 1, décoché par défaut) y figurent :
//  - chaque document est listé (titre, type, élément rattaché, date, taille) ;
//  - les images sont reproduites en vignette, sauf les photos déjà imprimées
//    dans un chapitre (photo rattachée à une zone, un système, un équipement,
//    un compteur ou la GTB), qui renvoient au chapitre ;
//  - une note vocale est accompagnée de sa transcription quand elle existe.
// Les autres fichiers (PDF, plans, schémas, tableurs) sont listés, pas
// reproduits.

const CATEGORY_LABEL = {
  analyse_fonctionnelle: 'Analyse fonctionnelle',
  plan: 'Plan',
  schema_electrique: 'Schéma électrique',
  schema_synoptique: 'Schéma synoptique',
  datasheet: 'Fiche technique',
  manuel_utilisateur: 'Manuel utilisateur',
  rapport_essais: "Rapport d'essais",
  photo: 'Photo',
  autre: 'Autre',
};
// Ordre de la liste : documents de référence d'abord, photos à la fin.
const CATEGORY_ORDER = ['analyse_fonctionnelle', 'plan', 'schema_electrique',
  'schema_synoptique', 'datasheet', 'manuel_utilisateur', 'rapport_essais', 'autre', 'photo'];

const TRANSCRIPT_MAX = 1500;

function isImageDoc(d) {
  return String(d.mime_type || '').startsWith('image/') && d.media_type !== 'audio';
}

function formatLabel(d) {
  const mime = String(d.mime_type || '').toLowerCase();
  const name = String(d.original_name || d.filename || '').toLowerCase();
  if (d.media_type === 'audio' || mime.startsWith('audio/')) return 'Audio';
  if (mime.startsWith('image/')) return 'Image';
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'PDF';
  if (/sheet|excel|csv/.test(mime) || /\.(xlsx?|csv)$/.test(name)) return 'Tableur';
  if (/word|msword/.test(mime) || /\.docx?$/.test(name)) return 'Document Word';
  if (name.endsWith('.dwg')) return 'Plan DWG';
  if (mime.startsWith('text/')) return 'Texte';
  return 'Fichier';
}

function sizeLabel(bytes) {
  const b = Number(bytes) || 0;
  if (!b) return '';
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} Ko`;
  return `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
}

/**
 * Élément auquel le document est rattaché, et chapitre du rapport où une
 * photo ainsi rattachée est déjà imprimée (null sinon).
 * @param {object} d - ligne site_documents
 * @param {object} ctx - lookups de l'audit (zones, systèmes, équipements,
 *   compteurs, actions, inspections) + documentId + chapitres.
 */
function attachmentOf(d, ctx) {
  const ch = ctx.chapters || {};
  if (d.bacs_audit_device_id != null) {
    const dev = ctx.devicesById.get(d.bacs_audit_device_id);
    if (dev) return { label: `Équipement : ${dev.label}`, chapter: ch.systems };
  }
  if (d.bacs_audit_system_id != null) {
    const sys = ctx.systemsById.get(d.bacs_audit_system_id);
    if (sys) return { label: `Système : ${sys.label}`, chapter: ch.systems };
  }
  if (d.bacs_audit_zone_id != null) {
    const zone = ctx.zonesById.get(d.bacs_audit_zone_id);
    if (zone) return { label: `Zone : ${zone.label}`, chapter: ch.zones };
  }
  if (d.bacs_audit_meter_id != null) {
    const meter = ctx.metersById.get(d.bacs_audit_meter_id);
    if (meter) return { label: `Compteur : ${meter.label}`, chapter: ch.meters };
  }
  if (d.bacs_audit_bms_document_id != null && d.bacs_audit_bms_document_id === ctx.documentId) {
    return { label: 'GTB', chapter: ch.bms };
  }
  if (d.bacs_audit_action_item_id != null) {
    const action = ctx.actionsById.get(d.bacs_audit_action_item_id);
    if (action) return { label: `Action ${action.label}`, chapter: null };
  }
  if (d.bacs_audit_inspection_id != null) {
    return { label: 'Inspection périodique', chapter: null };
  }
  if (d.bacs_audit_checklist_id != null) {
    const item = ctx.checklistById && ctx.checklistById.get(d.bacs_audit_checklist_id);
    return { label: item ? `Check-list : ${item.label}` : 'Check-list de visite', chapter: null };
  }
  return { label: 'Site', chapter: null };
}

/**
 * Construit les entrées de l'annexe à partir des lignes site_documents
 * cochées. Fonction pure, sans lecture de fichier : les vignettes sont
 * chargées ensuite (loadThumbnails).
 * @returns {Array<object>} entrées numérotées « PJ 1 », « PJ 2 »…
 */
function buildReportAttachments(rows, ctx) {
  const rank = (d) => {
    if (d.media_type === 'audio') return CATEGORY_ORDER.indexOf('autre') + 0.5;
    const i = CATEGORY_ORDER.indexOf(d.category);
    return i < 0 ? CATEGORY_ORDER.length : i;
  };
  const dateOf = (d) => d.taken_at || d.uploaded_at || null;
  const selected = (rows || [])
    .filter(d => d.include_in_report === 1 || d.include_in_report === true)
    .sort((a, b) => (rank(a) - rank(b))
      || String(dateOf(a) || '').localeCompare(String(dateOf(b) || ''))
      || (a.id - b.id));
  return selected.map((d, i) => {
    const att = attachmentOf(d, ctx);
    const image = isImageDoc(d);
    // Photo déjà imprimée dans un chapitre : pas de seconde reproduction.
    const shownInChapter = image && d.category === 'photo' && att.chapter ? att.chapter : null;
    const transcript = d.media_type === 'audio' && d.transcript_text
      ? (String(d.transcript_text).trim().length > TRANSCRIPT_MAX
        ? `${String(d.transcript_text).trim().slice(0, TRANSCRIPT_MAX).replace(/\s+\S*$/, '')}…`
        : String(d.transcript_text).trim())
      : null;
    return {
      id: d.id,
      ref: `PJ ${i + 1}`,
      title: (d.title && String(d.title).trim()) || d.original_name || `Document ${d.id}`,
      typeLabel: d.media_type === 'audio' ? 'Note vocale' : (CATEGORY_LABEL[d.category] || 'Autre'),
      formatLabel: formatLabel(d),
      attachedTo: att.label,
      date: dateOf(d),
      sizeLabel: sizeLabel(d.size_bytes),
      isImage: image,
      shownInChapter,
      needsThumbnail: image && !shownInChapter,
      filename: d.filename,
      transcript,
    };
  });
}

module.exports = {
  CATEGORY_LABEL,
  buildReportAttachments,
  attachmentOf,
  formatLabel,
  sizeLabel,
};
