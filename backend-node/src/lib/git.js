'use strict';

const fs = require('fs');
const path = require('path');
const git = require('isomorphic-git');
const config = require('../config');
const db = require('../database');
const log = require('./logger').system;
const { resolveSectionPoints } = require('./points-resolver');

const SNAPSHOT_FILENAME = 'af.json';

function repoDir(afId) {
  return path.join(path.resolve(config.gitReposDir), String(afId));
}

async function ensureRepo(afId) {
  const dir = repoDir(afId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, '.git'))) {
    await git.init({ fs, dir, defaultBranch: 'main' });
    log.info(`Git repo initialise pour AF #${afId} (${dir})`);
  }
  return dir;
}

/**
 * Construit un snapshot complet de l'AF pour figer dans Git :
 * - meta (client, projet, niveau de service, statut, ...)
 * - arbre des sections (titre, body_html, level, points resolus si equipment, instances)
 * - liste des attachments (refs only, pas le binaire)
 *
 * Le snapshot est versioning-friendly : noms stables, tri deterministe.
 */
function buildAfSnapshot(afId) {
  const af = db.afs.getById(afId);
  if (!af) return null;

  const sections = db.sections.listByAf(afId);
  const sectionData = sections.map(s => {
    const node = {
      id: s.id,
      number: s.number,
      title: s.title,
      kind: s.kind,
      service_level: s.service_level,
      bacs_articles: s.bacs_articles,
      included_in_export: !!s.included_in_export,
      body_html: s.body_html || null,
      parent_id: s.parent_id,
      position: s.position,
      equipment_template_id: s.equipment_template_id,
      equipment_template_version: s.equipment_template_version,
      hyperveez_page_slug: s.hyperveez_page_slug,
    };
    if (s.kind === 'equipment') {
      node.points = resolveSectionPoints(s.id).map(p => ({
        slug: p.slug, label: p.label, data_type: p.data_type,
        direction: p.direction, unit: p.unit, source: p.source,
      }));
      node.instances = db.equipmentInstances.listBySection(s.id).map(i => ({
        reference: i.reference, location: i.location, qty: i.qty, notes: i.notes,
      }));
    }
    node.attachments = db.attachments.listBySection(s.id).map(a => ({
      filename: a.filename, original_name: a.original_name,
      caption: a.caption, position: a.position,
    }));
    return node;
  });

  return {
    schema_version: 1,
    af: {
      id: af.id, slug: af.slug,
      client_name: af.client_name, project_name: af.project_name,
      site_address: af.site_address, service_level: af.service_level,
      status: af.status, delivered_at: af.delivered_at,
    },
    sections: sectionData,
    captured_at: new Date().toISOString(),
  };
}

/**
 * Ecrit af.json + commit + (optionnel) tag annote leger.
 */
async function commitAf(afId, message, { tag, author } = {}) {
  const dir = await ensureRepo(afId);
  const snapshot = buildAfSnapshot(afId);
  if (!snapshot) throw new Error(`AF #${afId} introuvable`);

  fs.writeFileSync(path.join(dir, SNAPSHOT_FILENAME), JSON.stringify(snapshot, null, 2));
  await git.add({ fs, dir, filepath: SNAPSHOT_FILENAME });

  // Skip commit si rien n'a change
  const status = await git.status({ fs, dir, filepath: SNAPSHOT_FILENAME });
  if (status === 'unmodified' || status === 'absent') return null;

  const sha = await git.commit({
    fs, dir, message,
    author: {
      name: author?.name || 'Buildy Docs',
      email: author?.email || 'noreply@buildy.fr',
      timestamp: Math.floor(Date.now() / 1000),
      timezoneOffset: -new Date().getTimezoneOffset(),
    },
  });
  if (tag) {
    try { await git.tag({ fs, dir, ref: tag, object: sha }); }
    catch (e) {
      // tag deja present : on bump avec un suffixe horodate
      const fallback = `${tag}-${Date.now()}`;
      await git.tag({ fs, dir, ref: fallback, object: sha });
    }
  }
  return sha;
}

async function listCommits(afId) {
  const dir = await ensureRepo(afId);
  let commits;
  try { commits = await git.log({ fs, dir }); }
  catch { return []; } // repo vide
  // Recupere les tags pour annoter chaque commit
  let tagsBySha = new Map();
  try {
    const tagRefs = await git.listTags({ fs, dir });
    for (const t of tagRefs) {
      const sha = await git.resolveRef({ fs, dir, ref: `refs/tags/${t}` });
      if (!tagsBySha.has(sha)) tagsBySha.set(sha, []);
      tagsBySha.get(sha).push(t);
    }
  } catch { /* ignore */ }
  return commits.map(c => ({
    sha: c.oid,
    sha_short: c.oid.slice(0, 7),
    message: c.commit.message.trim(),
    author_name: c.commit.author.name,
    author_email: c.commit.author.email,
    timestamp: c.commit.author.timestamp,
    date: new Date(c.commit.author.timestamp * 1000).toISOString(),
    parents: c.commit.parent || [],
    tags: tagsBySha.get(c.oid) || [],
  }));
}

async function readSnapshotAt(afId, sha) {
  const dir = await ensureRepo(afId);
  try {
    const { blob } = await git.readBlob({ fs, dir, oid: sha, filepath: SNAPSHOT_FILENAME });
    return JSON.parse(Buffer.from(blob).toString('utf-8'));
  } catch (e) {
    log.warn(`readSnapshotAt(#${afId}, ${sha}) : ${e.message}`);
    return null;
  }
}

/**
 * Diff entre 2 commits : compare les snapshots section par section.
 * Retourne un objet structure pour le rendu UI.
 */
async function diffCommits(afId, fromSha, toSha) {
  const fromSnap = await readSnapshotAt(afId, fromSha);
  const toSnap = await readSnapshotAt(afId, toSha);
  if (!fromSnap || !toSnap) return null;

  const fromBySection = new Map(fromSnap.sections.map(s => [s.id, s]));
  const toBySection = new Map(toSnap.sections.map(s => [s.id, s]));

  const added = [], removed = [], modified = [];

  for (const [id, s] of toBySection) {
    if (!fromBySection.has(id)) {
      added.push({ id, number: s.number, title: s.title });
    } else {
      const old = fromBySection.get(id);
      const changes = {};
      const fields = ['title', 'service_level', 'bacs_articles', 'body_html', 'included_in_export'];
      for (const f of fields) {
        if ((old[f] || null) !== (s[f] || null)) {
          changes[f] = { from: old[f], to: s[f] };
        }
      }
      // Diff sur les points (par slug)
      if (s.kind === 'equipment') {
        const oldPoints = new Map((old.points || []).map(p => [p.slug, p]));
        const newPoints = new Map((s.points || []).map(p => [p.slug, p]));
        const pAdded = [], pRemoved = [], pModified = [];
        for (const [slug, p] of newPoints) {
          if (!oldPoints.has(slug)) pAdded.push(p);
          else {
            const o = oldPoints.get(slug);
            if (o.label !== p.label || o.data_type !== p.data_type ||
                o.direction !== p.direction || o.unit !== p.unit) {
              pModified.push({ slug, label: p.label, from: o, to: p });
            }
          }
        }
        for (const [slug, p] of oldPoints) {
          if (!newPoints.has(slug)) pRemoved.push(p);
        }
        if (pAdded.length || pRemoved.length || pModified.length) {
          changes.points = { added: pAdded, removed: pRemoved, modified: pModified };
        }
      }
      // Diff sur attachments (par filename)
      const oldAtts = new Set((old.attachments || []).map(a => a.filename));
      const newAtts = new Set((s.attachments || []).map(a => a.filename));
      const attAdded = [...newAtts].filter(f => !oldAtts.has(f));
      const attRemoved = [...oldAtts].filter(f => !newAtts.has(f));
      if (attAdded.length || attRemoved.length) {
        changes.attachments = { added: attAdded, removed: attRemoved };
      }
      if (Object.keys(changes).length > 0) {
        modified.push({ id, number: s.number, title: s.title, changes });
      }
    }
  }
  for (const [id, s] of fromBySection) {
    if (!toBySection.has(id)) removed.push({ id, number: s.number, title: s.title });
  }

  // Diff meta AF
  const metaChanges = {};
  for (const f of ['client_name', 'project_name', 'site_address', 'service_level', 'status']) {
    if ((fromSnap.af[f] || null) !== (toSnap.af[f] || null)) {
      metaChanges[f] = { from: fromSnap.af[f], to: toSnap.af[f] };
    }
  }

  return {
    from_sha: fromSha, to_sha: toSha,
    af_meta_changes: metaChanges,
    sections: { added, removed, modified },
    total_changes: added.length + removed.length + modified.length + Object.keys(metaChanges).length,
  };
}

/**
 * Restaure un snapshot Git dans la DB SQLite.
 * Strategie V1 : on rejoue body_html + service_level + bacs_articles + title sur les
 * sections qui matchent par id. Les sections supprimees ne sont pas re-creees, les
 * sections nouvelles ne sont pas supprimees (on log un avertissement). Un commit
 * "Restauration de <sha>" est pose apres ecriture pour garder le fil chronologique.
 */
async function restoreCommit(afId, sha, { userId } = {}) {
  const snap = await readSnapshotAt(afId, sha);
  if (!snap) throw new Error(`Snapshot ${sha} introuvable`);

  let touched = 0, missing = 0;
  for (const s of snap.sections) {
    const current = db.sections.getById(s.id);
    if (!current || current.af_id !== afId) { missing++; continue; }
    db.sections.update(s.id, {
      title: s.title,
      bodyHtml: s.body_html,
      serviceLevel: s.service_level,
      bacsArticles: s.bacs_articles,
      includedInExport: s.included_in_export ? 1 : 0,
      updatedBy: userId,
    });
    touched++;
  }
  // Re-commit pour refleter la restauration
  await commitAf(afId, `Restauration de ${sha.slice(0, 7)}`);
  db.auditLog.add({ afId, userId, action: 'af.restore', payload: { sha, touched, missing } });
  log.info(`AF #${afId} restauree depuis ${sha.slice(0, 7)} : ${touched} sections, ${missing} introuvables`);
  return { touched, missing };
}

module.exports = {
  ensureRepo, commitAf, listCommits, readSnapshotAt, diffCommits, restoreCommit,
  buildAfSnapshot,
};
