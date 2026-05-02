'use strict';

// Lifecycle audit BACS : livraison (Git tag + SHA256), validation/
// invalidation des etapes du stepper, redaction de la note de synthese
// (manuelle ou IA Claude), et fixture de test (audit demo).

const { z } = require('zod');
const config = require('../../config');
const db = require('../../database');
const log = require('../../lib/logger').system;
const { assistAuditSynthesis } = require('../../lib/claude');
const { regenerateActionItems } = require('../../lib/bacs-audit-action-generator');
const { seedBacsAuditStructure, resyncBacsAuditWithSiteZones } = require('../../lib/seeder');
const gitLib = require('../../lib/git');
const { assertBacsAuditExists } = require('./_shared');

async function routes(fastify) {
  // ─── Livraison de l'audit ──────────────────────────────────────────
  // Workflow simplifie : draft -> review -> delivered. Au passage delivered :
  //   1. Genere le PDF final
  //   2. Calcule SHA256 du PDF -> documents.delivered_pdf_sha256
  //   3. Snapshot JSON + PDF dans le repo Git du document, tag annote
  //   4. documents.delivered_at + delivered_git_tag remplis
  //   5. Audit log
  // Re-livraison : nouveau tag avec suffixe -v2/-v3 (cf lib/git.js).
  fastify.post('/bacs-audit/:documentId/deliver', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    const af = assertBacsAuditExists(documentId, reply);
    if (!af) return;
    const userId = request.authUser?.id;
    const user = userId ? db.users.getById(userId) : null;

    // 1. Genere le PDF final via l'endpoint export-pdf interne (re-utilise la
    // meme logique : on duplique pas la generation, on appelle inject)
    const pdfRes = await fastify.inject({
      method: 'POST',
      url: `/api/bacs-audit/${documentId}/export-pdf`,
      headers: request.headers, // forward auth
    });
    if (pdfRes.statusCode !== 200) {
      return reply.code(500).send({ detail: `Echec generation PDF : ${pdfRes.body}` });
    }
    const exportData = JSON.parse(pdfRes.body);
    const exportRow = db.db.prepare('SELECT file_path FROM exports WHERE id = ?').get(exportData.id);
    const pdfPath = exportRow.file_path;

    // 2 + 3 + 4 : SHA256 + snapshot Git + tag
    let snap;
    try {
      snap = await gitLib.commitBacsAuditDelivery(documentId, pdfPath, {
        author: user ? { name: user.display_name || 'Buildy Docs', email: user.email || 'noreply@buildy.fr' } : undefined,
      });
    } catch (e) {
      log.error(`commitBacsAuditDelivery a echoue pour doc #${documentId} : ${e.message}`);
      return reply.code(500).send({ detail: `Snapshot Git echoue : ${e.message}` });
    }

    db.afs.update(documentId, {
      status: 'livree', // FR temporaire, sera 'delivered' apres rename m37
      deliveredAt: new Date().toISOString(),
      deliveredPdfSha256: snap.sha256,
      deliveredGitTag: snap.gitTag,
      updatedBy: userId,
    });

    db.auditLog.add({
      afId: documentId, userId, action: 'document.delivered',
      payload: { kind: 'bacs_audit', git_tag: snap.gitTag, sha256: snap.sha256, export_id: exportData.id },
    });
    log.info(`Audit BACS #${documentId} livre par user #${userId} — tag=${snap.gitTag}`);

    return {
      delivered_at: new Date().toISOString(),
      delivered_pdf_sha256: snap.sha256,
      delivered_git_tag: snap.gitTag,
      pdf_export_id: exportData.id,
      pdf_download_url: exportData.download_url,
    };
  });

  // ─── Stepper progression (v2.9 / v2.10) ────────────────────────────
  // 10 etapes manuelles a valider par l'auditeur :
  //   identification, zones, systems, meters, thermal, bms, documents,
  //   credentials, review, synthesis.
  const AUDIT_STEPS = ['identification','zones','systems','meters','thermal','bms','documents','credentials','review','synthesis'];

  fastify.post('/bacs-audit/:documentId/validate-step', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    const af = assertBacsAuditExists(documentId, reply);
    if (!af) return;
    const schema = z.object({
      step: z.enum(AUDIT_STEPS),
      validated: z.boolean(),
    });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }

    let progress = {};
    try { progress = JSON.parse(af.audit_progress || '{}'); }
    catch { progress = {}; }

    if (body.validated) {
      const user = request.authUser?.id ? db.users.getById(request.authUser.id) : null;
      progress[body.step] = {
        validated: true,
        validated_at: new Date().toISOString(),
        validated_by: request.authUser?.id || null,
        validated_by_name: user?.display_name || user?.email || null,
      };
    } else {
      delete progress[body.step];
    }

    db.db.prepare('UPDATE afs SET audit_progress = ? WHERE id = ?')
      .run(JSON.stringify(progress), documentId);

    db.auditLog.add({
      afId: documentId,
      userId: request.authUser?.id,
      action: body.validated ? 'bacs_audit.step.validate' : 'bacs_audit.step.invalidate',
      payload: { step: body.step },
    });

    const validatedCount = AUDIT_STEPS.filter(s => progress[s]?.validated).length;
    return {
      audit_progress: progress,
      validated_count: validatedCount,
      total_steps: AUDIT_STEPS.length,
      completion_percent: Math.round((validatedCount / AUDIT_STEPS.length) * 100),
    };
  });

  // ─── Note de synthese (v2.10) ──────────────────────────────────────
  // PUT manuel + POST generate (Claude). La note HTML est ensuite injectee
  // en tete du PDF d'audit (chapitre 0 - Synthese executive).
  fastify.put('/bacs-audit/:documentId/synthesis', async (request, reply) => {
    const documentId = parseInt(request.params.documentId, 10);
    const af = assertBacsAuditExists(documentId, reply);
    if (!af) return;
    const schema = z.object({ html: z.string().nullable().optional() });
    let body;
    try { body = schema.parse(request.body); }
    catch (e) { return reply.code(400).send({ detail: e.errors?.[0]?.message }); }
    db.afs.update(documentId, { audit_synthesis_html: body.html ?? null });
    return db.afs.getById(documentId);
  });

  // POST /bacs-audit/action-items/:id/generate-alternatives — R175-5-1 4°
  fastify.post('/bacs-audit/action-items/:id/generate-alternatives', async (request, reply) => {
    if (!config.anthropicApiKey) {
      return reply.code(503).send({ detail: 'Assistant Claude non configure' });
    }
    const id = parseInt(request.params.id, 10);
    const item = db.db.prepare('SELECT * FROM bacs_audit_action_items WHERE id = ?').get(id);
    if (!item) return reply.code(404).send({ detail: 'Action non trouvee' });
    const ctx = {
      title: item.title,
      description: item.description,
      severity: item.severity,
      r175_article: item.r175_article,
      source_table: item.source_table,
      source_subtype: item.source_subtype,
      action_kind: item.action_kind,
    };
    try {
      const { html, usage } = await assistActionAlternatives(ctx);
      db.db.prepare('UPDATE bacs_audit_action_items SET alternative_solutions_html = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(html, id);
      db.auditLog.add({
        afId: item.document_id,
        userId: request.authUser?.id,
        action: 'bacs_audit.action_alternatives.generate',
        payload: { action_item_id: id, length: html.length, usage },
      });
      return { html, usage };
    } catch (err) {
      log.error(`Generation alternatives echouee : ${err.message}`);
      return reply.code(500).send({ detail: err.message });
    }
  });

  fastify.post('/bacs-audit/:documentId/generate-synthesis', async (request, reply) => {
    if (!config.anthropicApiKey) {
      return reply.code(503).send({ detail: 'Assistant Claude non configure (ANTHROPIC_API_KEY manquant)' });
    }
    const documentId = parseInt(request.params.documentId, 10);
    const af = assertBacsAuditExists(documentId, reply);
    if (!af) return;
    const site = af.site_id ? db.sites.getByIdInternal?.(af.site_id) || db.sites.getById(af.site_id) : null;
    const zones = site ? db.zones.listBySite(site.site_id) : [];
    const systems = db.db.prepare(`
      SELECT s.*, z.name AS zone_name, z.nature AS zone_nature
      FROM bacs_audit_systems s LEFT JOIN zones z ON z.zone_id = s.zone_id
      WHERE s.document_id = ?
      ORDER BY z.position, z.name, s.system_category
    `).all(documentId);
    const devices = db.db.prepare(`
      SELECT d.*, s.system_category, z.name AS zone_name
      FROM bacs_audit_system_devices d
      JOIN bacs_audit_systems s ON s.id = d.system_id
      LEFT JOIN zones z ON z.zone_id = s.zone_id
      WHERE s.document_id = ?
    `).all(documentId);
    const meters = db.db.prepare(`
      SELECT m.*, z.name AS zone_name FROM bacs_audit_meters m
      LEFT JOIN zones z ON z.zone_id = m.zone_id
      WHERE m.document_id = ?
    `).all(documentId);
    const bms = db.db.prepare('SELECT * FROM bacs_audit_bms WHERE document_id = ?').get(documentId) || null;
    const thermal = db.db.prepare(`
      SELECT t.*, z.name AS zone_name FROM bacs_audit_thermal_regulation t
      LEFT JOIN zones z ON z.zone_id = t.zone_id
      WHERE t.document_id = ?
    `).all(documentId);
    const actionItems = db.db.prepare(`
      SELECT a.*, z.name AS zone_name FROM bacs_audit_action_items a
      LEFT JOIN zones z ON z.zone_id = a.zone_id
      WHERE a.document_id = ? AND a.status NOT IN ('done','declined')
      ORDER BY (CASE a.severity WHEN 'blocking' THEN 0 WHEN 'major' THEN 1 ELSE 2 END), a.position, a.id
    `).all(documentId);

    // Dump structure (notes incluses) pour permettre a Claude de produire
    // une synthese fidele aux donnees saisies sans avoir a inventer.
    const stripHtml = (s) => s ? String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : null;
    const auditDump = {
      // Cadre legal de l'audit : se positionne comme rapport d'inspection
      // periodique R175-5-1 du decret BACS (a conserver 10 ans).
      regulatory_frame: {
        decree: 'R175 (Decret BACS, modifie par decret 2023-259)',
        report_type: 'Inspection periodique R175-5-1',
        retention_years: 10,
      },
      audit: {
        client_name: af.client_name,
        project_name: af.project_name,
        applicability_status: af.bacs_applicability_status,
        applicable_deadline: af.bacs_applicable_deadline,
        total_power_kw: af.bacs_total_power_kw,
        total_power_source: af.bacs_total_power_source,
        building_permit_date: af.bacs_building_permit_date,
        // R175-2 : pour batiments raccordes a un reseau urbain, la
        // puissance a considerer est celle de la station d'echange.
        district_heating_substation_kw: af.bacs_district_heating_substation_kw,
        // R175-5-1 1° : examen de l'analyse fonctionnelle existante
        // (uniquement a la 1ere inspection).
        existing_af_status: af.audit_existing_af_status,
      },
      site: site ? { name: site.name, address: site.address, city: site.city } : null,
      zones: zones.map(z => ({
        name: z.name, nature: z.nature, surface_m2: z.surface_m2,
        notes: stripHtml(z.notes_html) || z.notes,
      })),
      systems: systems.filter(s => s.present).map(s => ({
        category: s.system_category, zone: s.zone_name,
        meets_r175_3_p3: !!s.meets_r175_3_p3,
        meets_r175_3_p4: !!s.meets_r175_3_p4,
        meets_r175_3_p4_autonomous: !!s.meets_r175_3_p4_autonomous,
        managed_by_bms: !!s.managed_by_bms,
        notes: stripHtml(s.notes_html) || s.notes,
      })),
      devices: devices.map(d => ({
        name: d.name, brand: d.brand, model: d.model_reference,
        category: d.system_category, zone: d.zone_name,
        energy_source: d.energy_source, power_kw: d.power_kw,
        communication_protocol: d.communication_protocol,
        meets_r175_3_p4: !!d.meets_r175_3_p4,
        managed_by_bms: !!d.managed_by_bms,
        out_of_service: !!d.out_of_service,
        notes: stripHtml(d.notes_html) || d.notes,
      })),
      meters: meters.map(m => ({
        zone: m.zone_name || 'Compteur general', usage: m.usage,
        type: m.meter_type, required: !!m.required,
        present: !!m.present_actual, communicating: !!m.communicating,
        managed_by_bms: !!m.managed_by_bms,
        notes: stripHtml(m.notes_html) || m.notes,
      })),
      bms: bms ? {
        existing_solution: bms.existing_solution,
        brand: bms.existing_solution_brand,
        location: bms.location, model_reference: bms.model_reference,
        manages: {
          heating: !!bms.manages_heating, cooling: !!bms.manages_cooling,
          ventilation: !!bms.manages_ventilation, dhw: !!bms.manages_dhw,
          lighting: !!bms.manages_lighting,
        },
        meets_r175_3_p1: !!bms.meets_r175_3_p1,
        meets_r175_3_p2: !!bms.meets_r175_3_p2,
        has_maintenance_procedures: !!bms.has_maintenance_procedures,
        operator_trained: !!bms.operator_trained,
        operator_training_date: bms.operator_training_date,
        overall_compliance: bms.overall_compliance,
        out_of_service: !!bms.out_of_service,
        notes: stripHtml(bms.notes_html),
      } : null,
      thermal_regulation: thermal.map(t => ({
        zone: t.zone_name, regulation_type: t.regulation_type,
        generator_type: t.generator_type, age_years: t.age_years,
        notes: t.notes,
      })),
      action_items_open: actionItems.map(a => ({
        severity: a.severity, article: a.r175_article,
        title: a.title, description: a.description,
        zone: a.zone_name, estimated_effort: a.estimated_effort,
        status: a.status,
        commercial_notes: a.commercial_notes,
        // R175-5-1 4° : autres solutions envisageables
        alternative_solutions: stripHtml(a.alternative_solutions_html),
      })),
      stats: {
        zones_count: zones.length,
        systems_present: systems.filter(s => s.present).length,
        devices_count: devices.length,
        meters_required: meters.filter(m => m.required).length,
        meters_present: meters.filter(m => m.present_actual).length,
        actions_blocking: actionItems.filter(a => a.severity === 'blocking').length,
        actions_major: actionItems.filter(a => a.severity === 'major').length,
        actions_minor: actionItems.filter(a => a.severity === 'minor').length,
      },
    };

    try {
      const { html, usage } = await assistAuditSynthesis(auditDump, af.kind || 'bacs_audit');
      db.afs.update(documentId, {
        audit_synthesis_html: html,
        audit_synthesis_generated_at: new Date().toISOString(),
      });
      db.auditLog.add({
        afId: documentId,
        userId: request.authUser?.id,
        action: 'bacs_audit.synthesis.generate',
        payload: { length: html.length, usage },
      });
      return { html, usage, generated_at: new Date().toISOString() };
    } catch (err) {
      log.error(`Generation synthese audit BACS echouee : ${err.message}`);
      return reply.code(500).send({ detail: err.message || 'Echec generation synthese' });
    }
  });

  // ─── Fixture de test (v2.14) ───────────────────────────────────────
  // Cree de bout en bout un audit BACS fictif complet pour tests :
  // site + zones + systemes presents + devices + meters + GTB partiellement
  // conforme + thermal regulation + plan d'action genere. Aucune donnee
  // saisie sur des sites reels n'est touchee.
  fastify.post('/bacs-audit/seed-fixture', async (request, reply) => {
    const userId = request.authUser?.id;
    const ts = Date.now();
    const siteUuid = require('crypto').randomUUID();

    // 1. Site
    const site = db.sites.create({
      siteUuid,
      name: `Bâtiment Démo BACS — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      customerName: 'Société Démo Tertiaire SAS',
      address: '12 rue des Tests, 75001 Paris',
      notes: 'Site fictif généré pour tester l\'audit BACS de bout en bout. Supprimable sans impact.',
      createdBy: userId,
    });

    // 2. Zones
    const zonesData = [
      { name: 'Open-space niveau 1', nature: 'open-space', surface_m2: 280 },
      { name: 'Salles de réunion', nature: 'meeting-room', surface_m2: 60 },
      { name: 'Couloirs & circulations', nature: 'corridor', surface_m2: 90 },
      { name: 'Local technique sous-sol', nature: 'technical-area', surface_m2: 25 },
      { name: 'Parking extérieur', nature: 'outdoor', surface_m2: 400 },
    ];
    const zones = zonesData.map((z, idx) => db.zones.create({
      siteId: site.site_id, name: z.name, nature: z.nature,
      position: idx, surfaceM2: z.surface_m2,
    }));

    // 3. Audit BACS
    const slug = `audit-demo-bacs-${ts}`;
    const af = db.afs.create({
      slug, clientName: 'Société Démo Tertiaire SAS',
      projectName: 'Mise en conformité BACS — Bâtiment Démo',
      siteAddress: '12 rue des Tests, 75001 Paris',
      kind: 'bacs_audit', siteId: site.site_id,
      title: 'Audit BACS de démonstration', createdBy: userId,
    });
    seedBacsAuditStructure(af.id, site.site_id);

    // 4. Identification + applicabilite R175-2 + R175-6
    db.afs.update(af.id, {
      bacs_total_power_kw: 145,
      bacs_total_power_source: 'auto',
      bacs_district_heating_substation_kw: null,
      bacs_building_permit_date: '2010-06-15',
      // Travaux generateur recents → declenche R175-6 sur les zones non
      // exemptees, permet de tester le flux applicabilite + actions.
      bacs_generator_works_date: '2023-09-15',
      bacs_applicability_status: 'subject_2027',
      bacs_applicable_deadline: '2027-01-01',
      audit_existing_af_status: 'absent',
    });

    // 5. Marquer 4 categories comme presentes (sur la zone open-space + couloirs)
    const openSpace = zones.find(z => z.nature === 'open-space');
    const corridors = zones.find(z => z.nature === 'corridor');
    const localTech = zones.find(z => z.nature === 'technical-area');
    const parking = zones.find(z => z.nature === 'outdoor');

    const presentSystems = [
      { zone_id: openSpace.zone_id, category: 'heating' },
      { zone_id: openSpace.zone_id, category: 'cooling' },
      { zone_id: openSpace.zone_id, category: 'ventilation' },
      { zone_id: openSpace.zone_id, category: 'lighting_indoor' },
      { zone_id: corridors.zone_id, category: 'lighting_indoor' },
      { zone_id: parking.zone_id, category: 'lighting_outdoor' },
      { zone_id: localTech.zone_id, category: 'dhw' },
    ];
    for (const ps of presentSystems) {
      db.db.prepare(`
        UPDATE bacs_audit_systems SET present = 1, updated_at = CURRENT_TIMESTAMP
        WHERE document_id = ? AND zone_id = ? AND system_category = ?
      `).run(af.id, ps.zone_id, ps.category);
    }

    // 6. Devices realistes
    const findSystem = (zoneId, cat) => db.db.prepare(
      'SELECT id FROM bacs_audit_systems WHERE document_id = ? AND zone_id = ? AND system_category = ?'
    ).get(af.id, zoneId, cat)?.id;

    const devices = [
      { sys: findSystem(openSpace.zone_id, 'heating'),
        name: 'Chaudière gaz', brand: 'Atlantic', model: 'Varmax 70',
        power: 70, energy: 'gas', role: 'production', comm: 'modbus_rtu',
        location: 'Local technique sous-sol' },
      { sys: findSystem(openSpace.zone_id, 'cooling'),
        name: 'Groupe extérieur DRV', brand: 'Daikin', model: 'VRV-IV 75',
        power: 75, energy: 'electric', role: 'production', comm: 'absent',
        location: 'Toiture' },
      { sys: findSystem(openSpace.zone_id, 'ventilation'),
        name: 'CTA double flux', brand: 'Aldes', model: 'DFE 800',
        power: 6, energy: 'electric', role: 'production', comm: 'modbus_tcp',
        location: 'Toiture' },
      { sys: findSystem(openSpace.zone_id, 'lighting_indoor'),
        name: 'Pavés LED bureaux', brand: 'Trilux', model: 'Sonnos M73',
        power: 4, energy: 'electric', role: 'emission', comm: 'non_communicant',
        location: 'Plafond open-space' },
      { sys: findSystem(corridors.zone_id, 'lighting_indoor'),
        name: 'Rubans LED couloirs', brand: 'Sylvania', model: 'StripLED 24V',
        power: 1.2, energy: 'electric', role: 'emission', comm: 'non_communicant',
        location: 'Couloirs étage' },
      { sys: findSystem(parking.zone_id, 'lighting_outdoor'),
        name: 'Mâts LED parking', brand: 'Schréder', model: 'Avento 2',
        power: 2.5, energy: 'electric', role: 'emission', comm: 'absent',
        location: 'Parking extérieur' },
      { sys: findSystem(localTech.zone_id, 'dhw'),
        name: 'Ballon ECS électrique', brand: 'Atlantic', model: 'Chauffeo 200L',
        power: 2.4, energy: 'electric', role: 'production', comm: 'absent',
        location: 'Local technique' },
    ];
    const insDev = db.db.prepare(`
      INSERT INTO bacs_audit_system_devices
        (system_id, position, name, brand, model_reference, power_kw,
         energy_source, device_role, communication_protocol, location,
         meets_r175_3_p4, meets_r175_3_p4_autonomous, managed_by_bms)
      VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const d of devices) {
      if (!d.sys) continue;
      // Heuristique : devices communicants supposes interoperables et integres GTB
      const interop = !['absent', 'non_communicant'].includes(d.comm);
      insDev.run(
        d.sys, d.name, d.brand, d.model, d.power, d.energy, d.role, d.comm, d.location,
        interop ? 1 : 0,                                // arret manuel si communicant
        interop ? 1 : 0,                                // autonome
        interop ? 1 : 0,                                // managed_by_bms
      );
    }

    // 7. Resync pour generer les compteurs requis et thermal
    resyncBacsAuditWithSiteZones(af.id);

    // 8. Marquer une partie des compteurs comme presents communicants
    const meters = db.db.prepare('SELECT id FROM bacs_audit_meters WHERE document_id = ?').all(af.id);
    // 1/2 des compteurs presents, 1/3 communicants
    meters.forEach((m, idx) => {
      const present = idx % 2 === 0;
      const comm = present && idx % 3 === 0;
      db.db.prepare(`
        UPDATE bacs_audit_meters SET present_actual = ?, communicating = ?,
        managed_by_bms = ? WHERE id = ?
      `).run(present ? 1 : 0, comm ? 1 : 0, comm ? 1 : 0, m.id);
    });

    // 9. GTB partiellement conforme
    db.db.prepare(`
      INSERT INTO bacs_audit_bms (document_id, existing_solution, existing_solution_brand,
        location, model_reference, manages_heating, manages_cooling, manages_ventilation,
        manages_dhw, manages_lighting, meets_r175_3_p1, meets_r175_3_p2,
        has_maintenance_procedures, operator_trained, overall_compliance,
        data_provision_to_manager, data_provision_to_operators, notes_data_provision)
      VALUES (?, 'Niagara N4', 'Tridium', 'Local technique sous-sol', 'JACE 8000',
        1, 1, 1, 0, 0, 0, 0, 1, 0, 'partial',
        0, 0, 'Aucun mécanisme formel de mise à disposition des données identifié au moment de la visite.')
      ON CONFLICT(document_id) DO UPDATE SET
        existing_solution = excluded.existing_solution,
        existing_solution_brand = excluded.existing_solution_brand,
        location = excluded.location, model_reference = excluded.model_reference,
        manages_heating = excluded.manages_heating, manages_cooling = excluded.manages_cooling,
        manages_ventilation = excluded.manages_ventilation, manages_dhw = excluded.manages_dhw,
        manages_lighting = excluded.manages_lighting,
        meets_r175_3_p1 = excluded.meets_r175_3_p1, meets_r175_3_p2 = excluded.meets_r175_3_p2,
        has_maintenance_procedures = excluded.has_maintenance_procedures,
        operator_trained = excluded.operator_trained, overall_compliance = excluded.overall_compliance,
        data_provision_to_manager = excluded.data_provision_to_manager,
        data_provision_to_operators = excluded.data_provision_to_operators,
        notes_data_provision = excluded.notes_data_provision,
        updated_at = CURRENT_TIMESTAMP
    `).run(af.id);

    // 10. Thermal regulation : per_room sur open-space, none sur les autres
    db.db.prepare(`
      UPDATE bacs_audit_thermal_regulation SET regulation_type = 'per_room',
        generator_type = 'gas', generator_age_years = 12 WHERE document_id = ? AND zone_id = ?
    `).run(af.id, openSpace.zone_id);

    // 11. Final regen plan
    regenerateActionItems(af.id);

    db.auditLog.add({
      afId: af.id, userId, action: 'bacs_audit.fixture.create',
      payload: { site_uuid: site.site_uuid, zones: zones.length, devices: devices.length },
    });

    return reply.code(201).send({
      af_id: af.id, slug: af.slug,
      site_id: site.site_id, site_uuid: site.site_uuid,
      detail_url: `/bacs-audit/${af.id}`,
    });
  });
}

module.exports = routes;
