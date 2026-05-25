#!/usr/bin/env node
/**
 * Vérifie la cohérence des chiffres d'un audit BACS entre la couche serveur
 * (recapStats du bundle d'export PDF) et le résumé MCP exposé par
 * `audit_get_summary` du Fleet Manager.
 *
 * Usage :
 *   BUILDY_DOCS_TOKEN=<oidc-jwt> node scripts/verify-audit-coherence.mjs --audit-ids 43,44,45
 *   BUILDY_DOCS_TOKEN=<oidc-jwt> DOCS_URL=https://docs.buildy.fr:3443 node scripts/verify-audit-coherence.mjs --audit-ids 43
 *
 * Le script appelle DIRECTEMENT l'API Docs (route /bacs-audit/:id/full) et
 * recalcule en local le bundle MCP que `audit_get_summary` produirait (mêmes
 * filtres ternaires que buildy-audit-read.mjs). Pour chaque audit, il compare
 * et reporte les divergences. Échoue si au moins 1 divergence détectée.
 *
 * À lancer AVANT chaque release qui touche aux calculs d'agrégation
 * (recapStats, devices_summary, meters_summary, _compliance-summary).
 */
'use strict';

const args = process.argv.slice(2);
const auditIdsArg = args.find(a => a.startsWith('--audit-ids='));
const auditIds = auditIdsArg
  ? auditIdsArg.split('=')[1].split(',').map(s => Number(s.trim())).filter(Boolean)
  : args.includes('--audit-ids')
    ? args[args.indexOf('--audit-ids') + 1].split(',').map(s => Number(s.trim())).filter(Boolean)
    : [];

if (!auditIds.length) {
  console.error('Usage : node scripts/verify-audit-coherence.mjs --audit-ids 43,44,45');
  process.exit(2);
}

const DOCS_URL = process.env.DOCS_URL || 'https://localhost:3443';
const TOKEN = process.env.BUILDY_DOCS_TOKEN;
if (!TOKEN) {
  console.error('Erreur : env BUILDY_DOCS_TOKEN requis (cookie OIDC ou JWT).');
  process.exit(2);
}

// Cohérent avec backend-node/src/routes/bacs-audit/_ternary.js
const isTrue = v => v === 1 || v === true;
const isFalse = v => v === 0 || v === false;
const isUnanswered = v => v == null;

async function fetchFull(auditId) {
  const url = `${DOCS_URL}/api/bacs-audit/${auditId}/full`;
  const res = await fetch(url, {
    headers: { cookie: `docs_token=${TOKEN}` },
    // Cert auto-signé en dev ou prod NetBird.
    ...(process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ? {} : {}),
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}

function mcpSummary(data) {
  const devices = (data?.systemsByZone || [])
    .flatMap(g => (g.items || []).flatMap(s => s.devices || []));
  const meters = data?.meters || [];
  return {
    devices: {
      total: devices.length,
      out_of_service: devices.filter(d => d.out_of_service).length,
      managed_by_bms_true: devices.filter(d => isTrue(d.managed_by_bms)).length,
      managed_by_bms_unanswered: devices.filter(d => isUnanswered(d.managed_by_bms)).length,
      managed_by_bms_false: devices.filter(d => isFalse(d.managed_by_bms)).length,
    },
    meters: {
      total: meters.length,
      present: meters.filter(m => isTrue(m.present_actual) && !m.out_of_service).length,
      required: meters.filter(m => m.required).length,
      required_but_absent: meters.filter(m => m.required && !m.present_actual && !m.out_of_service).length,
      managed_by_bms_true: meters.filter(m => isTrue(m.managed_by_bms)).length,
      managed_by_bms_unanswered: meters.filter(m => isUnanswered(m.managed_by_bms)).length,
    },
  };
}

function compare(label, expected, actual) {
  if (expected === actual) return null;
  return `${label} : PDF=${expected} ≠ MCP=${actual}`;
}

async function verifyAudit(auditId) {
  const data = await fetchFull(auditId);
  const pdf = data?.recapStats || {};
  const mcp = mcpSummary(data);
  const diffs = [
    compare('devicesPresent (total - HS)', pdf.devicesPresent, mcp.devices.total - mcp.devices.out_of_service),
    compare('devicesIntegrated', pdf.devicesIntegrated, mcp.devices.managed_by_bms_true),
    compare('devicesIntegratedUnanswered', pdf.devicesIntegratedUnanswered, mcp.devices.managed_by_bms_unanswered),
    compare('devicesIntegratedFalse', pdf.devicesIntegratedFalse, mcp.devices.managed_by_bms_false),
    compare('devicesHs', pdf.devicesHs, mcp.devices.out_of_service),
    compare('metersRequired', pdf.metersRequired, mcp.meters.required),
    compare('metersPresent', pdf.metersPresent, mcp.meters.present),
    compare('metersIntegrated', pdf.metersIntegrated, mcp.meters.managed_by_bms_true),
    compare('metersIntegratedUnanswered', pdf.metersIntegratedUnanswered, mcp.meters.managed_by_bms_unanswered),
    compare('metersMissing', pdf.metersMissing, mcp.meters.required_but_absent),
  ].filter(Boolean);
  return { auditId, diffs };
}

(async () => {
  let totalDiffs = 0;
  for (const id of auditIds) {
    try {
      const { diffs } = await verifyAudit(id);
      if (diffs.length === 0) {
        console.log(`✓ audit ${id} : 0 divergences PDF ↔ MCP`);
      } else {
        console.log(`✗ audit ${id} : ${diffs.length} divergences`);
        for (const d of diffs) console.log(`    - ${d}`);
        totalDiffs += diffs.length;
      }
    } catch (e) {
      console.error(`! audit ${id} : ${e.message}`);
      totalDiffs += 1;
    }
  }
  console.log(totalDiffs === 0
    ? `\n✓ Tous les audits sont cohérents.`
    : `\n✗ ${totalDiffs} divergence${totalDiffs > 1 ? 's' : ''} détectée${totalDiffs > 1 ? 's' : ''}.`);
  process.exit(totalDiffs === 0 ? 0 : 1);
})();
