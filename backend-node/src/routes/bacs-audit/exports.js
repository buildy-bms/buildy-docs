'use strict';

// Exports PDF audit BACS : (1) checklist A4 imprimable, (2) export CSV
// du plan d'actions, (3) export PDF du rapport complet (synthese,
// systemes, GTB, plan, annexes R175).

const path = require('path');
const fs = require('fs');
const config = require('../../config');
const db = require('../../database');
const log = require('../../lib/logger').system;
const { renderPdf, loadAssetDataUrl } = require('../../lib/pdf');
const { optimizeFileToDataUrl } = require('../../lib/image-optimizer');
const { buildChecklistData } = require('../../lib/bacs-checklist-builder');
const bacsArticlesData = require('../../seeds/bacs-articles');
const bacsAuditMethodology = require('../../lib/bacs-audit-methodology');
const bacsAuditDisclaimers = require('../../lib/bacs-audit-disclaimers');
const { assertBacsAuditExists } = require('./_shared');

async function routes(fastify) {
  // ─── Export checklist A4 (impression terrain) ──────────────────────
  // Genere une feuille A4 imprimable avec numerotation stable,
  // cases a cocher, emplacements pour photos, et liste des pieces a
  // demander a l'exploitant. Le collaborateur l'utilise sur site avec
  // photos telephone + dictee Plaud Pro pour la restitution au bureau.
  fastify.post('/bacs-audit/:documentId/exports/checklist', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    const af = assertBacsAuditExists(documentId, reply);
    if (!af) return;
    const data = buildChecklistData(documentId);
    if (!data) return reply.code(404).send({ detail: 'Audit introuvable' });
    const outDir = path.resolve(config.attachmentsDir, '..', 'exports', String(documentId));
    fs.mkdirSync(outDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputPath = path.join(outDir, `bacs-audit-checklist-${ts}.pdf`);
    const result = await renderPdf({
      template: 'bacs-audit-checklist',
      styles: 'styles-bacs-audit-checklist',
      data: {
        ...data,
        logoDataUrl: loadAssetDataUrl('logo-buildy.svg'),
      },
      outputPath,
      pageFormat: 'A4',
      pageOrientation: 'portrait',
      pdfOptions: { format: 'A4' },
      addFormFields: true,
      pageContainerSelector: '.page',
    });
    db.auditLog.add({
      afId: documentId,
      userId: request.authUser?.id,
      action: 'bacs_audit.checklist.export',
      payload: { size: result.sizeBytes },
    });
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="checklist-${af.slug || documentId}.pdf"`)
      .send(fs.createReadStream(outputPath));
  });

  fastify.get('/bacs-audit/:documentId/action-items/export.csv', async (request, reply) => {
    const id = parseInt(request.params.documentId, 10);
    if (!assertBacsAuditExists(id, reply)) return;
    const items = db.db.prepare(`
      SELECT a.*, z.name AS zone_name, e.name AS equipment_name
      FROM bacs_audit_action_items a
      LEFT JOIN zones z ON z.zone_id = a.zone_id
      LEFT JOIN equipments e ON e.equipment_id = a.equipment_id
      WHERE a.document_id = ?
      ORDER BY CASE a.severity WHEN 'blocking' THEN 0 WHEN 'major' THEN 1 ELSE 2 END, a.position
    `).all(id);
    const esc = (v) => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const headers = ['Severity', 'Article R175', 'Categorie', 'Titre', 'Zone', 'Equipement',
      'Description', 'Status', 'Estimated effort', 'Notes commerciales'];
    const rows = [headers.join(',')];
    for (const it of items) {
      rows.push([
        esc(it.severity), esc(it.r175_article), esc(it.category), esc(it.title),
        esc(it.zone_name), esc(it.equipment_name), esc(it.description),
        esc(it.status), esc(it.estimated_effort), esc(it.commercial_notes),
      ].join(','));
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="audit-bacs-${id}-actions.csv"`);
    return rows.join('\n');
  });

  // ─── Export PDF audit BACS ─────────────────────────────────────────
  fastify.post('/bacs-audit/:documentId/export-pdf', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    const af = assertBacsAuditExists(documentId, reply);
    if (!af) return;

    const userId = request.authUser?.id;
    const user = userId ? db.users.getById(userId) : null;

    // Donnees principales
    const site = af.site_id ? db.sites.getById(af.site_id) : null;
    const zones = site ? db.zones.listBySite(site.site_id) : [];
    const systems = db.db.prepare(`
      SELECT s.*, z.name AS zone_name, z.nature AS zone_nature
      FROM bacs_audit_systems s LEFT JOIN zones z ON z.zone_id = s.zone_id
      WHERE s.document_id = ?
      ORDER BY z.position, z.name, s.system_category
    `).all(documentId);
    const meters = db.db.prepare(`
      SELECT m.*, z.name AS zone_name FROM bacs_audit_meters m
      LEFT JOIN zones z ON z.zone_id = m.zone_id
      WHERE m.document_id = ?
      ORDER BY z.position NULLS LAST, m.usage
    `).all(documentId);
    const bms = db.db.prepare('SELECT * FROM bacs_audit_bms WHERE document_id = ?').get(documentId) || null;
    const thermalRaw = db.db.prepare(`
      SELECT t.*, z.name AS zone_name FROM bacs_audit_thermal_regulation t
      LEFT JOIN zones z ON z.zone_id = t.zone_id
      WHERE t.document_id = ?
      ORDER BY z.position, z.name
    `).all(documentId);
    // On filtre done + declined : ces actions ne doivent pas apparaitre
    // dans le PDF livre aux integrateurs GTB.
    const actionItemsRaw = db.db.prepare(`
      SELECT a.*, z.name AS zone_name FROM bacs_audit_action_items a
      LEFT JOIN zones z ON z.zone_id = a.zone_id
      WHERE a.document_id = ? AND a.status NOT IN ('done', 'declined')
      ORDER BY a.position, a.id
    `).all(documentId);

    // Labels d'enums (pour eviter les codes anglais bruts dans le PDF)
    const SYSTEM_LABEL = { heating:'Chauffage', cooling:'Refroidissement', ventilation:'Ventilation',
      dhw:'Eau chaude sanitaire', lighting_indoor:'Éclairage intérieur',
      lighting_outdoor:'Éclairage extérieur', electricity_production:'Production photovoltaïque' };
    const SYSTEM_NEGATIVE_LABEL = { heating:'Pas de chauffage', cooling:'Pas de refroidissement',
      ventilation:'Pas de ventilation', dhw:'Pas d\'ECS',
      lighting_indoor:'Pas d\'éclairage intérieur', lighting_outdoor:'Pas d\'éclairage extérieur',
      electricity_production:'Pas de production photovoltaïque' };
    const COMM_LABEL = { modbus_tcp:'Modbus TCP', modbus_rtu:'Modbus RTU', bacnet_ip:'BACnet IP',
      bacnet_mstp:'BACnet MS/TP', knx:'KNX', mbus:'M-Bus', mqtt:'MQTT', lorawan:'LoRaWAN',
      autre:'Autre', non_communicant:'Non communicant', absent:'Absent' };
    const ENERGY_LABEL = { gas:'Gaz', electric:'Électrique', wood:'Bois', heat_pump:'PAC',
      district_heating:'Réseau de chaleur', fuel_oil:'Fioul', solar:'Solaire',
      biomass:'Biomasse', autre:'Autre' };
    const ROLE_LABEL = { production:'Production', distribution:'Distribution',
      emission:'Émission', regulation:'Régulation', autre:'Autre' };
    const METER_TYPE_LABEL = { electric:'Électrique', electric_production:'Électrique de production',
      gas:'Gaz', water:'Eau', thermal:'Thermique', other:'Autre' };
    const METER_USAGE_LABEL = { heating:'Chauffage', cooling:'Refroidissement',
      dhw:'ECS', pv:'Production PV', lighting:'Éclairage', other:'Général' };
    const REGULATION_LABEL = { per_room:'Par pièce', per_zone:'Par zone',
      central_only:'Centrale uniquement', none:'Aucune' };
    const GENERATOR_LABEL = { gas:'Gaz', electric:'Effet Joule', heat_pump:'Pompe à chaleur',
      wood_appliance:'Appareil bois (exempté R175-6)', district_heating:'Réseau de chaleur', other:'Autre' };
    const APPLICABILITY_LABEL = {
      subject_immediate: 'Immédiate (bâtiment > 290 kW déjà existant)',
      subject_2025: '1er janvier 2025 (puissance > 290 kW)',
      subject_2027: '1er janvier 2027 (puissance > 70 kW)',
      not_subject: 'Non assujetti (puissance < 70 kW)',
    };
    const COMPLIANCE_LABEL = { compliant:'Conforme', partial:'Partiellement conforme', non_compliant:'Non conforme' };

    // Charge tous les devices du document (joints au systeme parent)
    const devices = db.db.prepare(`
      SELECT d.*, s.system_category, s.zone_id, z.name AS zone_name
      FROM bacs_audit_system_devices d
      JOIN bacs_audit_systems s ON s.id = d.system_id
      LEFT JOIN zones z ON z.zone_id = s.zone_id
      WHERE s.document_id = ?
      ORDER BY z.position, z.name, s.system_category, d.position, d.id
    `).all(documentId);
    const devicesBySystem = new Map();
    for (const d of devices) {
      d.energyLabel = d.energy_source ? (ENERGY_LABEL[d.energy_source] || d.energy_source) : '—';
      d.roleLabel = d.device_role ? (ROLE_LABEL[d.device_role] || d.device_role) : '—';
      d.commLabel = d.communication_protocol
        ? (COMM_LABEL[d.communication_protocol] || d.communication_protocol)
        : 'Non communicant';
      if (!devicesBySystem.has(d.system_id)) devicesBySystem.set(d.system_id, []);
      devicesBySystem.get(d.system_id).push(d);
    }

    // Enrichit systems avec devices + sums et group par zone
    const enrichedSystems = systems.map(s => {
      const devs = devicesBySystem.get(s.id) || [];
      const totalKw = devs.reduce((sum, d) => sum + (Number(d.power_kw) || 0), 0);
      return {
        ...s,
        categoryLabel: SYSTEM_LABEL[s.system_category] || s.system_category,
        negativeLabel: SYSTEM_NEGATIVE_LABEL[s.system_category] || `Pas de ${(SYSTEM_LABEL[s.system_category] || s.system_category).toLowerCase()}`,
        commLabel: s.communication ? (COMM_LABEL[s.communication] || s.communication) : '—',
        devices: devs,
        device_count: devs.length,
        total_power_kw: totalKw,
      };
    });
    // Group systems par zone
    const systemsByZoneMap = new Map();
    for (const s of enrichedSystems) {
      const k = s.zone_id;
      if (!systemsByZoneMap.has(k)) {
        systemsByZoneMap.set(k, { zone_name: s.zone_name, zone_nature: s.zone_nature, items: [] });
      }
      systemsByZoneMap.get(k).items.push(s);
    }
    const systemsByZone = [...systemsByZoneMap.values()];

    // Enrichit meters
    const enrichedMeters = meters.map(m => ({
      ...m,
      typeLabel: METER_TYPE_LABEL[m.meter_type] || m.meter_type,
      usageLabel: METER_USAGE_LABEL[m.usage] || m.usage,
      zoneLabel: m.zone_name || 'Général bâtiment',
    }));

    // ── Photos ────────────────────────────────────────────────────────
    // On charge tous les site_documents categorie 'photo' du site et on
    // les rattache a chaque entite scope (zone, systeme, compteur, device,
    // GTB) sous forme de data URL JPEG. Les photos ont deja ete optimisees
    // a l'upload (sharp 1600px max, JPEG q=82), inutile de retraiter ici.
    if (site) {
      const photoRows = db.db.prepare(`
        SELECT id, filename, mime_type,
               bacs_audit_zone_id, bacs_audit_system_id, bacs_audit_meter_id,
               bacs_audit_device_id, bacs_audit_bms_document_id
        FROM site_documents
        WHERE site_id = ? AND category = 'photo'
        ORDER BY uploaded_at ASC
      `).all(site.site_id);
      const docsRoot = path.resolve(config.attachmentsDir, '..', 'site-documents', site.site_uuid);
      const zonePhotos = new Map();
      const systemPhotos = new Map();
      const meterPhotos = new Map();
      const devicePhotos = new Map();
      const bmsPhotos = [];
      const photoUrls = await Promise.all(photoRows.map((ph) =>
        optimizeFileToDataUrl(path.join(docsRoot, ph.filename)).catch(() => null)
      ));
      for (let i = 0; i < photoRows.length; i++) {
        const ph = photoRows[i];
        const url = photoUrls[i];
        if (!url) continue;
        const item = { id: ph.id, dataUrl: url };
        if (ph.bacs_audit_zone_id) {
          if (!zonePhotos.has(ph.bacs_audit_zone_id)) zonePhotos.set(ph.bacs_audit_zone_id, []);
          zonePhotos.get(ph.bacs_audit_zone_id).push(item);
        }
        if (ph.bacs_audit_system_id) {
          if (!systemPhotos.has(ph.bacs_audit_system_id)) systemPhotos.set(ph.bacs_audit_system_id, []);
          systemPhotos.get(ph.bacs_audit_system_id).push(item);
        }
        if (ph.bacs_audit_meter_id) {
          if (!meterPhotos.has(ph.bacs_audit_meter_id)) meterPhotos.set(ph.bacs_audit_meter_id, []);
          meterPhotos.get(ph.bacs_audit_meter_id).push(item);
        }
        if (ph.bacs_audit_device_id) {
          if (!devicePhotos.has(ph.bacs_audit_device_id)) devicePhotos.set(ph.bacs_audit_device_id, []);
          devicePhotos.get(ph.bacs_audit_device_id).push(item);
        }
        if (ph.bacs_audit_bms_document_id === documentId) {
          bmsPhotos.push(item);
        }
      }
      // On rattache les photos directement aux entites pour simplifier le template
      for (const z of zones) z.photos = zonePhotos.get(z.zone_id) || [];
      for (const m of enrichedMeters) m.photos = meterPhotos.get(m.id) || [];
      for (const d of devices) d.photos = devicePhotos.get(d.id) || [];
      for (const sys of enrichedSystems) sys.photos = systemPhotos.get(sys.id) || [];
      if (bms) bms.photos = bmsPhotos;
    }

    // Listes GTB integration : devices + meters integres
    const bmsManagedDevices = devices.filter(d => d.managed_by_bms);
    const bmsManagedMeters = enrichedMeters.filter(m => m.managed_by_bms);

    const thermal = thermalRaw.map(t => ({
      ...t,
      regulationLabel: t.regulation_type ? (REGULATION_LABEL[t.regulation_type] || t.regulation_type) : '—',
      generatorLabel: t.generator_type ? (GENERATOR_LABEL[t.generator_type] || t.generator_type) : '—',
    }));

    // Plan de mise en conformite groupe par severite
    // Numerotation BACS-001/002/... pour faciliter le devis des integrateurs.
    // L'ordre suit l'affichage du PDF : bloquantes -> majeures -> mineures.
    const numberedItems = [
      ...actionItemsRaw.filter(a => a.severity === 'blocking'),
      ...actionItemsRaw.filter(a => a.severity === 'major'),
      ...actionItemsRaw.filter(a => a.severity === 'minor'),
    ].map((a, idx) => ({
      ...a,
      display_number: 'BACS-' + String(idx + 1).padStart(3, '0'),
    }));
    const actionItems = { blocking: [], major: [], minor: [] };
    for (const a of numberedItems) actionItems[a.severity]?.push(a);
    const actionStats = {
      blocking: actionItems.blocking.length,
      major: actionItems.major.length,
      minor: actionItems.minor.length,
    };

    // Justifications (Annexe C)
    const justifications = actionItemsRaw.map(a => ({
      title: a.title,
      article: a.r175_article || '—',
      source: a.source_table ? `${a.source_table} (#${a.source_id})` : 'Item manuel',
      description: a.description || a.title,
    }));

    // Articles BACS (Annexe A) — adapte au format attendu par le template
    const bacsArticles = bacsArticlesData.BACS_ARTICLES.map(a => ({
      code: a.code,
      title: a.title,
      html: a.full_html,
    }));

    // Detection solution Buildy (pour mention R175-5 native)
    const buildySolution = bms && /buildy/i.test(`${bms.existing_solution || ''} ${bms.existing_solution_brand || ''}`);

    // Version (compteur d'exports BACS pour ce document)
    const previousCount = db.db.prepare(`
      SELECT COUNT(*) AS c FROM exports WHERE af_id = ? AND kind = 'pdf-bacs-audit'
    `).get(documentId).c;
    const version = `bacs-v${previousCount + 1}`;

    const exportDate = new Date().toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'long', year: 'numeric',
    });

    // R175-6 applicabilite : declencheur (PC > 21/07/2021 OU travaux generateur)
    const R175_6_TRIGGER = '2021-07-21';
    const pcAfter = af.bacs_building_permit_date && af.bacs_building_permit_date > R175_6_TRIGGER;
    const worksAfter = af.bacs_generator_works_date && af.bacs_generator_works_date > R175_6_TRIGGER;
    const r175_6_applicable = pcAfter || worksAfter
      ? { applies: true, reason: pcAfter && worksAfter
            ? 'permis de construire postérieur au 21/07/2021 et travaux générateur récents'
            : (pcAfter ? 'permis de construire postérieur au 21/07/2021' : 'travaux d\'installation/remplacement de générateur postérieurs au 21/07/2021') }
      : { applies: false, reason: 'aucun déclencheur (permis de construire et travaux générateur antérieurs ou égaux au 21/07/2021)' };

    // Detail du calcul auto chauffage + clim (pour transparence dans le PDF)
    const heatingCoolingBreakdown = devices
      .filter(d => ['heating','cooling'].includes(d.system_category) && d.power_kw != null)
      .map(d => ({
        name: d.name, brand: d.brand, model_reference: d.model_reference,
        power_kw: d.power_kw, zone_name: d.zone_name,
        category: d.system_category,
        categoryLabel: SYSTEM_LABEL[d.system_category] || d.system_category,
      }));
    const heatingCoolingTotal = heatingCoolingBreakdown.reduce((s, d) => s + (Number(d.power_kw) || 0), 0);

    const isBacs = af.kind === 'bacs_audit';
    const data = {
      document: af,
      isBacs,
      isSiteAudit: !isBacs,
      site,
      zones,
      systemsByZone,
      meters: enrichedMeters,
      thermal,
      bms,
      bmsManagedDevices,
      bmsManagedMeters,
      buildySolution,
      actionItems,
      actionStats,
      synthesisHtml: af.audit_synthesis_html || null,
      heatingCoolingBreakdown,
      heatingCoolingTotal: Math.round(heatingCoolingTotal * 10) / 10,
      r175_6_applicable,
      complianceLabel: bms?.overall_compliance ? COMPLIANCE_LABEL[bms.overall_compliance] : null,
      applicabilityLabel: af.bacs_applicability_status ? APPLICABILITY_LABEL[af.bacs_applicability_status] : null,
      bacsArticles,
      methodology: bacsAuditMethodology,
      disclaimers: bacsAuditDisclaimers,
      justifications,
      authorName: user?.display_name || 'Buildy Docs',
      exportDate,
      version,
      logoDataUrl: loadAssetDataUrl('logo-buildy.svg'),
    };

    // Genere le PDF
    const exportsDir = path.resolve(config.exportsDir);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${af.slug}-bacs-audit-${version}-${ts}.pdf`;
    const outputPath = path.join(exportsDir, String(documentId), filename);

    const logoSmall = loadAssetDataUrl('logo-buildy.svg');
    const WATERMARK_PATH = path.resolve(__dirname, '../../templates/pdf/assets/watermark-buildy.png');
    const BUILDY_WATERMARK = { imagePath: WATERMARK_PATH, widthRatio: 0.85, heightRatio: 0.85, opacity: 0.03 };

    let result;
    try {
      result = await renderPdf({
        template: 'bacs-audit',
        styles: 'styles-bacs-audit',
        data,
        outputPath,
        populateToc: true,
        pageFormat: 'A4',
        skipFirstPageHeaderFooter: true,
        coverFullBleed: true,
        watermark: { ...BUILDY_WATERMARK, skipFirstPage: true },
        pdfOptions: {
          displayHeaderFooter: true,
          margin: { top: '18mm', bottom: '16mm', left: '12mm', right: '12mm' },
          headerTemplate: `<div style="font-family:'Helvetica',sans-serif; font-size:8pt; color:#9ca3af; padding:0 12mm; width:100%; display:flex; justify-content:space-between;">
            <span>${af.client_name} — ${af.project_name}</span>
            <span>${isBacs ? 'Audit BACS' : 'Audit GTB'} ${version}</span>
          </div>`,
          footerTemplate: `<div style="font-family:'Helvetica',sans-serif; font-size:8pt; color:#9ca3af; padding:0 12mm; width:100%; display:flex; align-items:center; gap:6mm;">
            <img src="${logoSmall}" style="height:5mm; opacity:0.6;" />
            <span style="flex:1;">${isBacs ? 'Audit BACS Buildy · décret R175 · confidentiel' : 'Audit GTB Buildy · préparation devis · confidentiel'}</span>
            <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
          </div>`,
        },
      });
    } catch (err) {
      log.error(`PDF audit BACS render failed: ${err.message}`);
      return reply.code(500).send({ detail: `Echec generation PDF : ${err.message}` });
    }

    // Insert dans exports + audit
    const insertedRow = db.db.prepare(`
      INSERT INTO exports (af_id, kind, file_path, sections_snapshot, options, motif, exported_by, file_size_bytes)
      VALUES (?, 'pdf-bacs-audit', ?, ?, ?, ?, ?, ?)
    `).run(
      documentId, result.path,
      JSON.stringify({ systems_count: systems.length, meters_count: meters.length,
        actions_blocking: actionStats.blocking, actions_major: actionStats.major }),
      JSON.stringify({ version }),
      'Export audit BACS',
      userId || null, result.sizeBytes,
    );

    db.auditLog.add({
      afId: documentId, userId, action: 'export.bacs-audit',
      payload: { version, file_size_bytes: result.sizeBytes, actions_total: actionItemsRaw.length },
    });
    log.info(`PDF audit BACS exported: doc #${documentId} → ${filename} (${(result.sizeBytes/1024).toFixed(1)} KB) by user #${userId}`);

    return {
      id: insertedRow.lastInsertRowid,
      version,
      file_size_bytes: result.sizeBytes,
      download_url: `/api/exports/${insertedRow.lastInsertRowid}/download`,
    };
  });
}

module.exports = routes;
