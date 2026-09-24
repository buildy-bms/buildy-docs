'use strict';

// Repères {{zone:id}} / {{system:id}} / {{device:id}} posés par le
// générateur d'actions dans les titres et descriptions : remplacement par
// le libellé de l'élément, en texte brut. Source unique pour le PDF
// (tableaux denses, synthèse), la vue commerciale et l'export CSV — un même
// repère doit se lire pareil partout.

const db = require('../../database');

const TAG_RE = /\{\{(zone|system|device):(\d+)\}\}/g;

// Libellés en minuscules : le repère est inséré au milieu d'une phrase
// (« Raccorder chauffage · Atelier au BACS »).
const SYSTEM_LABEL_FR = {
  heating: 'chauffage', cooling: 'refroidissement', ventilation: 'ventilation',
  dhw: 'eau chaude sanitaire', lighting_indoor: 'éclairage intérieur',
  lighting_outdoor: 'éclairage extérieur', electricity_production: 'production photovoltaïque',
};

/**
 * @param {object} p
 * @param {Array} p.zones    — lignes de `zones` (id, name)
 * @param {Array} p.systems  — lignes de `bacs_audit_systems` + zone_name
 * @param {Array} p.devices  — lignes de `bacs_audit_system_devices`
 * @returns {{ label: (type: string, id: number|string) => string, strip: (text: string) => string }}
 */
function makePlainTagResolver({ zones = [], systems = [], devices = [] } = {}) {
  const zonesById = new Map(zones.map(z => [z.id, z]));
  const systemsById = new Map(systems.map(s => [s.id, s]));
  const devicesById = new Map(devices.map(d => [d.id, d]));

  function label(type, n) {
    const id = Number(n);
    if (type === 'zone') {
      const z = zonesById.get(id);
      return z ? (z.name || `Zone #${id}`) : `Zone #${id}`;
    }
    if (type === 'system') {
      const s = systemsById.get(id);
      if (!s) return `Système #${id}`;
      const name = s.custom_label || SYSTEM_LABEL_FR[s.system_category] || s.system_category || 'Système';
      return s.zone_name ? `${name} · ${s.zone_name}` : name;
    }
    if (type === 'device') {
      const d = devicesById.get(id);
      return d ? (d.name || [d.brand, d.model_reference].filter(Boolean).join(' ') || `Équipement #${id}`)
        : `Équipement ${id}`;
    }
    return '';
  }

  function strip(text) {
    if (!text) return text;
    return String(text).replace(TAG_RE, (_m, type, id) => label(type, id));
  }

  return { label, strip };
}

// Charge zones, systèmes et équipements d'un audit puis construit le
// résolveur (vue commerciale, export CSV).
function loadPlainTagResolver(documentId) {
  const af = db.afs.getById(documentId);
  const site = af?.site_id ? db.sites.getById(af.site_id) : null;
  const zones = site ? db.zones.listBySite(site.site_id) : [];
  const systems = db.db.prepare(`
    SELECT s.id, s.custom_label, s.system_category, z.name AS zone_name
    FROM bacs_audit_systems s LEFT JOIN zones z ON z.id = s.zone_id
    WHERE s.document_id = ?
  `).all(documentId);
  const devices = db.db.prepare(`
    SELECT d.id, d.name, d.brand, d.model_reference
    FROM bacs_audit_system_devices d
    JOIN bacs_audit_systems s ON s.id = d.system_id
    WHERE s.document_id = ?
  `).all(documentId);
  return makePlainTagResolver({ zones, systems, devices });
}

module.exports = { SYSTEM_LABEL_FR, makePlainTagResolver, loadPlainTagResolver };
