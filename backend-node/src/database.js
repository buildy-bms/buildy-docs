'use strict';

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const log = require('./lib/logger').system;

let db;

// ── Migrations versionnees (PRAGMA user_version) ─────────────────────
// Ajouter une nouvelle migration = incrementer TARGET_VERSION + ajouter
// le bloc dans `runMigrations()`. Jamais modifier une migration existante.

const TARGET_VERSION = 6;

function runMigrations() {
  const current = db.pragma('user_version', { simple: true });

  if (current < 1) {
    // Lot 1 — users + sessions OIDC
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        oidc_sub TEXT NOT NULL,
        oidc_issuer TEXT NOT NULL,
        email TEXT,
        display_name TEXT,
        first_name TEXT,
        last_name TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TEXT,
        UNIQUE(oidc_sub, oidc_issuer)
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        jti TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_activity_at TEXT DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL,
        is_revoked INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_jti ON sessions(jti);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    `);
    db.pragma('user_version = 1');
    log.info('Migration 1 appliquee : users + sessions');
  }

  if (current < 2) {
    // Lot 2 — bibliotheque, AFs, sections, points, attachments, exports, audit, FTS
    db.exec(`
      -- ── Bibliotheque equipements (cross-AF) ──
      CREATE TABLE IF NOT EXISTS equipment_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        category TEXT,
        bacs_articles TEXT,
        description_html TEXT,
        icon_kind TEXT,
        icon_value TEXT,
        icon_color TEXT,
        current_version INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER REFERENCES users(id),
        updated_by INTEGER REFERENCES users(id),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS equipment_template_points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL REFERENCES equipment_templates(id) ON DELETE CASCADE,
        slug TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        label TEXT NOT NULL,
        data_type TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('read', 'write')),
        unit TEXT,
        notes TEXT,
        is_optional INTEGER DEFAULT 0,
        hyperveez_facets TEXT,
        fact_check_status TEXT DEFAULT 'unverified',
        fact_check_url TEXT,
        UNIQUE(template_id, slug)
      );
      CREATE INDEX IF NOT EXISTS idx_etp_template ON equipment_template_points(template_id, position);

      CREATE TABLE IF NOT EXISTS equipment_template_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL REFERENCES equipment_templates(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        snapshot TEXT NOT NULL,
        changelog TEXT,
        author_id INTEGER REFERENCES users(id),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(template_id, version)
      );

      -- ── AFs ──
      CREATE TABLE IF NOT EXISTS afs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        client_name TEXT NOT NULL,
        project_name TEXT NOT NULL,
        site_address TEXT,
        service_level TEXT,
        status TEXT NOT NULL DEFAULT 'setup'
          CHECK (status IN ('setup', 'chantier', 'livree', 'revision')),
        delivered_at TEXT,
        last_inspection_at TEXT,
        created_by INTEGER REFERENCES users(id),
        updated_by INTEGER REFERENCES users(id),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_afs_status ON afs(status, deleted_at);

      CREATE TABLE IF NOT EXISTS af_inspections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        af_id INTEGER NOT NULL REFERENCES afs(id) ON DELETE CASCADE,
        inspected_at TEXT NOT NULL,
        inspector_name TEXT,
        git_tag TEXT,
        pdf_export_id INTEGER,
        notes TEXT,
        created_by INTEGER REFERENCES users(id)
      );

      -- ── Sections (arborescence) ──
      CREATE TABLE IF NOT EXISTS sections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        af_id INTEGER NOT NULL REFERENCES afs(id) ON DELETE CASCADE,
        parent_id INTEGER REFERENCES sections(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        number TEXT,
        title TEXT NOT NULL,
        service_level TEXT,
        service_level_source TEXT,
        bacs_articles TEXT,
        body_html TEXT,
        body_yjs BLOB,
        kind TEXT NOT NULL DEFAULT 'standard'
          CHECK (kind IN ('standard', 'equipment', 'synthesis', 'hyperveez_page')),
        included_in_export INTEGER NOT NULL DEFAULT 1,
        generic_note INTEGER NOT NULL DEFAULT 0,
        fact_check_status TEXT DEFAULT 'unverified',
        equipment_template_id INTEGER REFERENCES equipment_templates(id),
        equipment_template_version INTEGER,
        hyperveez_page_slug TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_sections_af_parent ON sections(af_id, parent_id, position);
      CREATE INDEX IF NOT EXISTS idx_sections_kind ON sections(af_id, kind);
      CREATE INDEX IF NOT EXISTS idx_sections_template ON sections(equipment_template_id)
        WHERE equipment_template_id IS NOT NULL;

      -- ── Overrides points pour une section equipment ──
      CREATE TABLE IF NOT EXISTS section_point_overrides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
        action TEXT NOT NULL CHECK (action IN ('add', 'edit', 'remove')),
        base_point_id INTEGER REFERENCES equipment_template_points(id) ON DELETE SET NULL,
        position INTEGER,
        label TEXT,
        data_type TEXT,
        direction TEXT CHECK (direction IS NULL OR direction IN ('read', 'write')),
        unit TEXT,
        is_optional INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_spo_section ON section_point_overrides(section_id);

      -- ── Instances d'equipement (CTA-N1-EST...) ──
      CREATE TABLE IF NOT EXISTS equipment_instances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        reference TEXT NOT NULL,
        location TEXT,
        qty INTEGER NOT NULL DEFAULT 1,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_ei_section ON equipment_instances(section_id, position);

      -- ── Captures attachees a une section ──
      CREATE TABLE IF NOT EXISTS attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        original_name TEXT,
        caption TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        width INTEGER,
        height INTEGER,
        uploaded_by INTEGER REFERENCES users(id),
        uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_att_section ON attachments(section_id, position);

      -- ── Exports (PDF AF + PDF liste de points) ──
      CREATE TABLE IF NOT EXISTS exports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        af_id INTEGER NOT NULL REFERENCES afs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('pdf-af', 'pdf-points-list')),
        file_path TEXT NOT NULL,
        sections_snapshot TEXT,
        options TEXT,
        motif TEXT,
        git_tag TEXT,
        exported_by INTEGER REFERENCES users(id),
        exported_at TEXT DEFAULT CURRENT_TIMESTAMP,
        file_size_bytes INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_exports_af ON exports(af_id, exported_at DESC);

      -- ── Audit log (tracabilite) ──
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        af_id INTEGER REFERENCES afs(id) ON DELETE SET NULL,
        section_id INTEGER REFERENCES sections(id) ON DELETE SET NULL,
        template_id INTEGER REFERENCES equipment_templates(id) ON DELETE SET NULL,
        user_id INTEGER REFERENCES users(id),
        action TEXT NOT NULL,
        payload TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_audit_af ON audit_log(af_id, created_at DESC);

      -- ── Recherche full-text cross-AF (FTS5) ──
      CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
        section_id UNINDEXED,
        af_id UNINDEXED,
        title,
        body_text,
        tokenize='unicode61 remove_diacritics 2'
      );

      -- Triggers FTS5 : maintien automatique de l'index lors des INSERT/UPDATE/DELETE
      -- sur sections. body_text sera renseigne par l'app cote backend (strip HTML).
      CREATE TRIGGER IF NOT EXISTS sections_fts_delete
      AFTER DELETE ON sections BEGIN
        DELETE FROM sections_fts WHERE section_id = old.id;
      END;
    `);
    db.pragma('user_version = 2');
    log.info('Migration 2 appliquee : bibliotheque + AFs + sections + FTS5');
  }

  if (current < 3) {
    // Lot 2.7 — refresh description CTA si elle correspond a l'ancienne phrase
    // (ne touche pas aux templates dont la description a deja ete editee).
    const OLD_FRAGMENT = 'fait seule foi pour chaque déploiement.</em></p>';
    const NEW_FRAGMENT = 'fait seule foi pour chaque déploiement. Les données effectivement disponibles dépendent également de l\'équipement lui-même et des informations qu\'il expose ; Buildy n\'est pas responsable de l\'absence ou de l\'indisponibilité de données qui ne seraient pas mises à disposition par l\'équipement.</em></p>';
    const ctaRow = db.prepare('SELECT id, description_html FROM equipment_templates WHERE slug = ?').get('cta');
    if (ctaRow && ctaRow.description_html?.includes(OLD_FRAGMENT) && !ctaRow.description_html?.includes(NEW_FRAGMENT)) {
      const updated = ctaRow.description_html.replace(OLD_FRAGMENT, NEW_FRAGMENT);
      db.prepare('UPDATE equipment_templates SET description_html = ?, current_version = current_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(updated, ctaRow.id);
      log.info('Migration 3 : description du template CTA mise a jour (mention responsabilite Buildy)');
    }
    db.pragma('user_version = 3');
    log.info('Migration 3 appliquee : refresh description CTA');
  }

  if (current < 4) {
    // Lot 5 fixes : retire les badges BACS sur 1.1 (Objet) et 1.3
    // (Conformite au decret BACS — titre deja explicite, badge redondant)
    const result = db.prepare(`
      UPDATE sections SET bacs_articles = NULL
      WHERE number IN ('1.1', '1.3') AND bacs_articles IN ('R175-5-1', 'R175-3')
    `).run();
    if (result.changes > 0) {
      log.info(`Migration 4 : retire badges BACS sur ${result.changes} sections (1.1 + 1.3)`);
    }
    db.pragma('user_version = 4');
    log.info('Migration 4 appliquee');
  }

  if (current < 5) {
    // Lot 9 — snapshot initial des templates existants comme version 1.
    // Permet aux sections deja seedees (figees a v1) de comparer contre la
    // version courante du template pour declencher la propagation.
    const templates = db.prepare('SELECT id, current_version, description_html FROM equipment_templates').all();
    let snapshotted = 0;
    for (const tpl of templates) {
      const exists = db.prepare(
        'SELECT 1 FROM equipment_template_versions WHERE template_id = ? AND version = ?'
      ).get(tpl.id, tpl.current_version);
      if (exists) continue;
      const points = db.prepare(`
        SELECT slug, position, label, data_type, direction, unit, notes, is_optional
        FROM equipment_template_points WHERE template_id = ?
        ORDER BY position, id
      `).all(tpl.id);
      const snapshot = JSON.stringify({ description_html: tpl.description_html, points });
      db.prepare(`
        INSERT INTO equipment_template_versions (template_id, version, snapshot, changelog)
        VALUES (?, ?, ?, ?)
      `).run(tpl.id, tpl.current_version, snapshot, 'Snapshot initial (migration v5)');
      snapshotted++;
    }
    if (snapshotted > 0) {
      log.info(`Migration 5 : ${snapshotted} snapshots de templates poses`);
    }
    db.pragma('user_version = 5');
    log.info('Migration 5 appliquee : snapshots templates equipement');
  }

  if (current < 6) {
    // Lot 8 — backfill index FTS5 pour toutes les sections existantes (les
    // sections seedees avant Lot 8 n'avaient pas d'entree FTS, la recherche
    // remontait vide).
    const sections = db.prepare(`
      SELECT s.id, s.af_id, s.title, s.body_html
      FROM sections s
      JOIN afs a ON a.id = s.af_id
      WHERE a.deleted_at IS NULL
    `).all();
    let indexed = 0;
    const ins = db.prepare(`
      INSERT INTO sections_fts (section_id, af_id, title, body_text) VALUES (?, ?, ?, ?)
    `);
    const del = db.prepare('DELETE FROM sections_fts WHERE section_id = ?');
    for (const s of sections) {
      del.run(s.id);
      const bodyText = (s.body_html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      if (s.title || bodyText) {
        ins.run(s.id, s.af_id, s.title || '', bodyText);
        indexed++;
      }
    }
    log.info(`Migration 6 : ${indexed} sections indexees dans FTS5`);
    db.pragma('user_version = 6');
    log.info('Migration 6 appliquee : backfill FTS5');
  }

  if (current > TARGET_VERSION) {
    log.warn(`DB version ${current} > TARGET_VERSION ${TARGET_VERSION}. Possible downgrade ?`);
  }
}

function init() {
  const dir = path.dirname(config.databasePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(config.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations();

  log.info(`Database ready at ${config.databasePath} (version ${db.pragma('user_version', { simple: true })})`);
}

// ── Users ────────────────────────────────────────────────────────────
const users = {
  getById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  },
  getByOidcSub(sub, issuer) {
    return db.prepare('SELECT * FROM users WHERE oidc_sub = ? AND oidc_issuer = ?').get(sub, issuer);
  },
  createFromOidc({ sub, issuer, email, displayName, firstName, lastName }) {
    return db.prepare(`
      INSERT INTO users (oidc_sub, oidc_issuer, email, display_name, first_name, last_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sub, issuer, email || null, displayName || null, firstName || null, lastName || null);
  },
  updateProfile(id, { email, displayName, firstName, lastName }) {
    db.prepare(`
      UPDATE users SET email = ?, display_name = ?, first_name = ?, last_name = ?
      WHERE id = ?
    `).run(email || null, displayName || null, firstName || null, lastName || null, id);
  },
  touchLastSeen(id) {
    db.prepare('UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  },
  ensureDevUser(email, displayName) {
    const existing = db.prepare('SELECT * FROM users WHERE oidc_sub = ?').get('dev-bypass');
    if (existing) return existing;
    const result = db.prepare(`
      INSERT INTO users (oidc_sub, oidc_issuer, email, display_name)
      VALUES ('dev-bypass', 'local-dev', ?, ?)
    `).run(email, displayName);
    return this.getById(result.lastInsertRowid);
  },
};

// ── Sessions ─────────────────────────────────────────────────────────
const sessions = {
  create(userId, jti, expiresAt) {
    return db.prepare(`
      INSERT INTO sessions (user_id, jti, expires_at) VALUES (?, ?, ?)
    `).run(userId, jti, expiresAt);
  },
  getByJti(jti) {
    return db.prepare('SELECT * FROM sessions WHERE jti = ?').get(jti);
  },
  revokeByJti(jti) {
    db.prepare('UPDATE sessions SET is_revoked = 1 WHERE jti = ?').run(jti);
  },
  deleteExpired() {
    db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  },
};

// ── Equipment templates (bibliotheque) ───────────────────────────────
const equipmentTemplates = {
  list({ category } = {}) {
    if (category) {
      return db.prepare('SELECT * FROM equipment_templates WHERE category = ? ORDER BY name').all(category);
    }
    return db.prepare('SELECT * FROM equipment_templates ORDER BY category, name').all();
  },
  getById(id) {
    return db.prepare('SELECT * FROM equipment_templates WHERE id = ?').get(id);
  },
  getBySlug(slug) {
    return db.prepare('SELECT * FROM equipment_templates WHERE slug = ?').get(slug);
  },
  create({ slug, name, category, bacsArticles, descriptionHtml, iconKind, iconValue, iconColor, createdBy }) {
    const result = db.prepare(`
      INSERT INTO equipment_templates
        (slug, name, category, bacs_articles, description_html, icon_kind, icon_value, icon_color, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(slug, name, category || null, bacsArticles || null, descriptionHtml || null,
            iconKind || null, iconValue || null, iconColor || null, createdBy || null, createdBy || null);
    return this.getById(result.lastInsertRowid);
  },
  update(id, { name, category, bacsArticles, descriptionHtml, iconKind, iconValue, iconColor, updatedBy }) {
    db.prepare(`
      UPDATE equipment_templates
      SET name = COALESCE(?, name),
          category = COALESCE(?, category),
          bacs_articles = COALESCE(?, bacs_articles),
          description_html = COALESCE(?, description_html),
          icon_kind = COALESCE(?, icon_kind),
          icon_value = COALESCE(?, icon_value),
          icon_color = COALESCE(?, icon_color),
          updated_by = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name, category, bacsArticles, descriptionHtml, iconKind, iconValue, iconColor, updatedBy || null, id);
    return this.getById(id);
  },
  delete(id) {
    db.prepare('DELETE FROM equipment_templates WHERE id = ?').run(id);
  },
  bumpVersion(id) {
    db.prepare('UPDATE equipment_templates SET current_version = current_version + 1 WHERE id = ?').run(id);
  },
};

const equipmentTemplateVersions = {
  listByTemplate(templateId) {
    return db.prepare(`
      SELECT v.id, v.template_id, v.version, v.changelog, v.created_at,
             v.author_id, u.display_name AS author_name
      FROM equipment_template_versions v
      LEFT JOIN users u ON u.id = v.author_id
      WHERE template_id = ?
      ORDER BY version DESC
    `).all(templateId);
  },
  getByTemplateAndVersion(templateId, version) {
    return db.prepare(`
      SELECT * FROM equipment_template_versions
      WHERE template_id = ? AND version = ?
    `).get(templateId, version);
  },
  create({ templateId, version, snapshot, changelog, authorId }) {
    db.prepare(`
      INSERT INTO equipment_template_versions (template_id, version, snapshot, changelog, author_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(templateId, version, JSON.stringify(snapshot), changelog || null, authorId || null);
  },
};

const equipmentTemplatePoints = {
  listByTemplate(templateId) {
    return db.prepare(`
      SELECT * FROM equipment_template_points
      WHERE template_id = ?
      ORDER BY position, id
    `).all(templateId);
  },
  create(templateId, { slug, position, label, dataType, direction, unit, notes, isOptional }) {
    const result = db.prepare(`
      INSERT INTO equipment_template_points
        (template_id, slug, position, label, data_type, direction, unit, notes, is_optional)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(templateId, slug, position || 0, label, dataType, direction, unit || null, notes || null, isOptional ? 1 : 0);
    return db.prepare('SELECT * FROM equipment_template_points WHERE id = ?').get(result.lastInsertRowid);
  },
  deleteByTemplate(templateId) {
    db.prepare('DELETE FROM equipment_template_points WHERE template_id = ?').run(templateId);
  },
};

// ── AFs ──────────────────────────────────────────────────────────────
const afs = {
  list({ status, includeDeleted = false } = {}) {
    let sql = 'SELECT * FROM afs WHERE 1=1';
    const params = [];
    if (!includeDeleted) sql += ' AND deleted_at IS NULL';
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY updated_at DESC';
    return db.prepare(sql).all(...params);
  },
  getById(id) {
    return db.prepare('SELECT * FROM afs WHERE id = ?').get(id);
  },
  getBySlug(slug) {
    return db.prepare('SELECT * FROM afs WHERE slug = ?').get(slug);
  },
  create({ slug, clientName, projectName, siteAddress, serviceLevel, createdBy }) {
    const result = db.prepare(`
      INSERT INTO afs (slug, client_name, project_name, site_address, service_level, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(slug, clientName, projectName, siteAddress || null, serviceLevel || null, createdBy || null, createdBy || null);
    return this.getById(result.lastInsertRowid);
  },
  update(id, fields) {
    const allowed = ['client_name', 'project_name', 'site_address', 'service_level', 'status', 'delivered_at'];
    const sets = [], params = [];
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      const col = k.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
      if (allowed.includes(col)) { sets.push(`${col} = ?`); params.push(v); }
    }
    if (fields.updatedBy != null) { sets.push('updated_by = ?'); params.push(fields.updatedBy); }
    if (!sets.length) return this.getById(id);
    sets.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    db.prepare(`UPDATE afs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.getById(id);
  },
  softDelete(id) {
    db.prepare("UPDATE afs SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  },
  restore(id) {
    db.prepare('UPDATE afs SET deleted_at = NULL WHERE id = ?').run(id);
  },
  countByStatus() {
    return db.prepare(`
      SELECT status, COUNT(*) as count FROM afs WHERE deleted_at IS NULL GROUP BY status
    `).all();
  },
};

// ── Sections ─────────────────────────────────────────────────────────
const sections = {
  listByAf(afId) {
    return db.prepare(`
      SELECT * FROM sections WHERE af_id = ?
      ORDER BY parent_id NULLS FIRST, position, id
    `).all(afId);
  },
  getById(id) {
    return db.prepare('SELECT * FROM sections WHERE id = ?').get(id);
  },
  create({ afId, parentId, position, number, title, serviceLevel, serviceLevelSource,
           bacsArticles, bodyHtml, kind, equipmentTemplateId, equipmentTemplateVersion,
           hyperveezPageSlug, includedInExport = 1, genericNote = 0 }) {
    const result = db.prepare(`
      INSERT INTO sections
        (af_id, parent_id, position, number, title, service_level, service_level_source,
         bacs_articles, body_html, kind, included_in_export, generic_note,
         equipment_template_id, equipment_template_version, hyperveez_page_slug)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      afId, parentId || null, position || 0, number || null, title,
      serviceLevel || null, serviceLevelSource || null, bacsArticles || null,
      bodyHtml || null, kind || 'standard', includedInExport, genericNote,
      equipmentTemplateId || null, equipmentTemplateVersion || null, hyperveezPageSlug || null
    );
    return this.getById(result.lastInsertRowid);
  },
  update(id, fields) {
    const allowed = [
      'parent_id', 'position', 'number', 'title', 'service_level', 'service_level_source',
      'bacs_articles', 'body_html', 'kind', 'included_in_export', 'generic_note',
      'fact_check_status', 'equipment_template_id', 'equipment_template_version',
      'hyperveez_page_slug',
    ];
    const sets = [], params = [];
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;          // skip clés non fournies (PATCH partiel)
      const col = k.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
      if (allowed.includes(col)) { sets.push(`${col} = ?`); params.push(v); }
    }
    if (fields.updatedBy != null) { sets.push('updated_by = ?'); params.push(fields.updatedBy); }
    if (!sets.length) return this.getById(id);
    sets.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    db.prepare(`UPDATE sections SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.getById(id);
  },
  delete(id) {
    db.prepare('DELETE FROM sections WHERE id = ?').run(id);
  },
  // Sections d'une AF qui referencent un template a une version anterieure
  // a la version courante du template (= une mise a jour est disponible).
  outdatedByAf(afId) {
    return db.prepare(`
      SELECT s.id, s.number, s.title, s.equipment_template_id, s.equipment_template_version,
             t.name AS template_name, t.slug AS template_slug, t.current_version
      FROM sections s
      JOIN equipment_templates t ON t.id = s.equipment_template_id
      WHERE s.af_id = ? AND s.kind = 'equipment'
        AND s.equipment_template_id IS NOT NULL
        AND (s.equipment_template_version IS NULL OR s.equipment_template_version < t.current_version)
      ORDER BY s.position, s.id
    `).all(afId);
  },
  // AFs (non supprimees) qui referencent un template, groupees par version pinnee
  affectedAfsByTemplate(templateId) {
    return db.prepare(`
      SELECT a.id AS af_id, a.client_name, a.project_name, a.status, a.deleted_at,
             s.id AS section_id, s.number, s.title, s.equipment_template_version
      FROM sections s
      JOIN afs a ON a.id = s.af_id
      WHERE s.equipment_template_id = ? AND a.deleted_at IS NULL
      ORDER BY a.updated_at DESC, s.position
    `).all(templateId);
  },
  // Indexation FTS5 (appelee depuis le service apres modif body_html)
  reindexFts(sectionId, afId, title, bodyText) {
    db.prepare('DELETE FROM sections_fts WHERE section_id = ?').run(sectionId);
    if (title || bodyText) {
      db.prepare(`
        INSERT INTO sections_fts (section_id, af_id, title, body_text)
        VALUES (?, ?, ?, ?)
      `).run(sectionId, afId, title || '', bodyText || '');
    }
  },
};

// ── Attachments ──────────────────────────────────────────────────────
const attachments = {
  listBySection(sectionId) {
    return db.prepare(`
      SELECT a.*, u.display_name AS uploaded_by_name
      FROM attachments a
      LEFT JOIN users u ON u.id = a.uploaded_by
      WHERE section_id = ?
      ORDER BY position, id
    `).all(sectionId);
  },
  getById(id) {
    return db.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
  },
  create(sectionId, { filename, originalName, caption, position, width, height, uploadedBy }) {
    const result = db.prepare(`
      INSERT INTO attachments
        (section_id, filename, original_name, caption, position, width, height, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sectionId, filename, originalName || null, caption || null, position || 0,
            width || null, height || null, uploadedBy || null);
    return this.getById(result.lastInsertRowid);
  },
  update(id, { caption, position }) {
    const sets = [], params = [];
    if (caption !== undefined) { sets.push('caption = ?'); params.push(caption); }
    if (position !== undefined) { sets.push('position = ?'); params.push(position); }
    if (!sets.length) return this.getById(id);
    params.push(id);
    db.prepare(`UPDATE attachments SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.getById(id);
  },
  delete(id) {
    db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
  },
};

// ── Section point overrides ──────────────────────────────────────────
const sectionPointOverrides = {
  listBySection(sectionId) {
    return db.prepare(`
      SELECT * FROM section_point_overrides
      WHERE section_id = ?
      ORDER BY position, id
    `).all(sectionId);
  },
  create(sectionId, { action, basePointId, position, label, dataType, direction, unit, isOptional, createdBy }) {
    const result = db.prepare(`
      INSERT INTO section_point_overrides
        (section_id, action, base_point_id, position, label, data_type, direction, unit, is_optional, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sectionId, action, basePointId || null, position || 0, label || null,
      dataType || null, direction || null, unit || null,
      isOptional == null ? null : (isOptional ? 1 : 0), createdBy || null
    );
    return db.prepare('SELECT * FROM section_point_overrides WHERE id = ?').get(result.lastInsertRowid);
  },
  delete(id) {
    db.prepare('DELETE FROM section_point_overrides WHERE id = ?').run(id);
  },
  deleteBySection(sectionId) {
    db.prepare('DELETE FROM section_point_overrides WHERE section_id = ?').run(sectionId);
  },
};

// ── Equipment instances (CTA-N1-EST...) ──────────────────────────────
const equipmentInstances = {
  listBySection(sectionId) {
    return db.prepare(`
      SELECT * FROM equipment_instances
      WHERE section_id = ?
      ORDER BY position, id
    `).all(sectionId);
  },
  create(sectionId, { position, reference, location, qty, notes }) {
    const result = db.prepare(`
      INSERT INTO equipment_instances (section_id, position, reference, location, qty, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sectionId, position || 0, reference, location || null, qty || 1, notes || null);
    return db.prepare('SELECT * FROM equipment_instances WHERE id = ?').get(result.lastInsertRowid);
  },
  update(id, { position, reference, location, qty, notes }) {
    const sets = [], params = [];
    if (position != null) { sets.push('position = ?'); params.push(position); }
    if (reference != null) { sets.push('reference = ?'); params.push(reference); }
    if (location != null) { sets.push('location = ?'); params.push(location); }
    if (qty != null) { sets.push('qty = ?'); params.push(qty); }
    if (notes != null) { sets.push('notes = ?'); params.push(notes); }
    if (!sets.length) return null;
    params.push(id);
    db.prepare(`UPDATE equipment_instances SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return db.prepare('SELECT * FROM equipment_instances WHERE id = ?').get(id);
  },
  delete(id) {
    db.prepare('DELETE FROM equipment_instances WHERE id = ?').run(id);
  },
};

// ── Inspections BACS ─────────────────────────────────────────────────
const afInspections = {
  listByAf(afId) {
    return db.prepare(`
      SELECT i.*, u.display_name AS created_by_name,
             e.file_path, e.file_size_bytes
      FROM af_inspections i
      LEFT JOIN users u ON u.id = i.created_by
      LEFT JOIN exports e ON e.id = i.pdf_export_id
      WHERE af_id = ?
      ORDER BY inspected_at DESC
    `).all(afId);
  },
  create(afId, { inspectorName, gitTag, pdfExportId, notes, createdBy }) {
    const inspectedAt = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO af_inspections (af_id, inspected_at, inspector_name, git_tag, pdf_export_id, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(afId, inspectedAt, inspectorName, gitTag || null, pdfExportId || null, notes || null, createdBy || null);
    return db.prepare('SELECT * FROM af_inspections WHERE id = ?').get(result.lastInsertRowid);
  },
};

// ── Audit log ────────────────────────────────────────────────────────
const auditLog = {
  add({ afId, sectionId, templateId, userId, action, payload }) {
    db.prepare(`
      INSERT INTO audit_log (af_id, section_id, template_id, user_id, action, payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      afId || null, sectionId || null, templateId || null, userId || null,
      action, payload ? JSON.stringify(payload) : null
    );
  },
  recent(afId, limit = 50) {
    return db.prepare(`
      SELECT a.*, u.display_name AS user_display_name
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE af_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(afId, limit);
  },
};

module.exports = {
  init,
  users,
  sessions,
  equipmentTemplates,
  equipmentTemplatePoints,
  equipmentTemplateVersions,
  sectionPointOverrides,
  equipmentInstances,
  attachments,
  afs,
  afInspections,
  sections,
  auditLog,
  get db() { return db; },
};
