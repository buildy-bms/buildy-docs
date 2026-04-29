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

const TARGET_VERSION = 30;

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

  if (current < 7) {
    // Lot 14.3 — retire le disclaimer générique de la description du template CTA
    // (désormais affiché une seule fois en page de garde du PDF AF, pas dans chaque section).
    const FRAGMENT_RE = /<p><em>Les données listées ci-dessous sont indicatives.*?ne seraient pas mises à disposition par l'équipement\.<\/em><\/p>\s*/s;
    const tpls = db.prepare('SELECT id, description_html FROM equipment_templates WHERE description_html IS NOT NULL').all();
    let cleaned = 0;
    for (const t of tpls) {
      if (FRAGMENT_RE.test(t.description_html)) {
        const newHtml = t.description_html.replace(FRAGMENT_RE, '').trim();
        db.prepare('UPDATE equipment_templates SET description_html = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newHtml, t.id);
        cleaned++;
      }
    }
    if (cleaned > 0) log.info(`Migration 7 : disclaimer générique retiré de ${cleaned} template(s)`);
    db.pragma('user_version = 7');
    log.info('Migration 7 appliquee : nettoyage disclaimer CTA');
  }

  if (current < 8) {
    // Lot 15 — refonte du cycle de vie d'une AF :
    //   setup    → redaction       (Rédaction en cours)
    //   chantier → commissioning   (Commissionnement en cours)
    //   livree   → livree           (Projet livré)
    //   revision → livree           (les révisions sont des modifs sur livree)
    //   nouveaux : validee, commissioned
    //
    // SQLite ne permet pas d'éditer un CHECK constraint → on recrée la table
    // (pattern PRAGMA foreign_keys=OFF + BEGIN + INSERT INTO new SELECT FROM old).
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE afs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        client_name TEXT NOT NULL,
        project_name TEXT NOT NULL,
        site_address TEXT,
        service_level TEXT,
        status TEXT NOT NULL DEFAULT 'redaction'
          CHECK (status IN ('redaction', 'validee', 'commissioning', 'commissioned', 'livree')),
        delivered_at TEXT,
        last_inspection_at TEXT,
        created_by INTEGER REFERENCES users(id),
        updated_by INTEGER REFERENCES users(id),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      );
      INSERT INTO afs_new
        (id, slug, client_name, project_name, site_address, service_level, status,
         delivered_at, last_inspection_at, created_by, updated_by, created_at, updated_at, deleted_at)
      SELECT
        id, slug, client_name, project_name, site_address, service_level,
        CASE status
          WHEN 'setup'    THEN 'redaction'
          WHEN 'chantier' THEN 'commissioning'
          WHEN 'livree'   THEN 'livree'
          WHEN 'revision' THEN 'livree'
          ELSE 'redaction'
        END,
        delivered_at, last_inspection_at, created_by, updated_by, created_at, updated_at, deleted_at
      FROM afs;
      DROP TABLE afs;
      ALTER TABLE afs_new RENAME TO afs;
      CREATE INDEX IF NOT EXISTS idx_afs_status ON afs(status, deleted_at);

      -- af_inspections devient générique : ajout d'un champ kind
      ALTER TABLE af_inspections ADD COLUMN kind TEXT
        CHECK (kind IN ('validation', 'commissioning', 'delivery', 'inspection_bacs'))
        DEFAULT 'inspection_bacs';
    `);
    db.pragma('foreign_keys = ON');
    log.info('Migration 8 appliquee : refonte statuts AF (5 etats) + af_inspections.kind');
    db.pragma('user_version = 8');
  }

  if (current < 9) {
    // Lot 22 — supprime le chapitre 10 (Application Hyperveez) et toutes ses
    // sous-sections (10.x + pages Hyperveez peuplées dynamiquement) dans toutes
    // les AFs existantes. Cascade ON DELETE supprime overrides + instances + attachments.
    const result = db.prepare(`
      DELETE FROM sections
      WHERE number LIKE '10' OR number LIKE '10.%' OR kind = 'hyperveez_page'
    `).run();
    if (result.changes > 0) {
      log.info(`Migration 9 : ${result.changes} sections supprimées (chapitre 10 Hyperveez)`);
    }
    db.pragma('user_version = 9');
    log.info('Migration 9 appliquee : suppression chapitre 10 Hyperveez');
  }

  if (current < 10) {
    // Lot 18 — enrichissement schéma équipements :
    //   * tech_name : nom technique attendu côté intégrateur (ex. T_AIR_NEUF)
    //   * nature : type de donnée technique (Booléen | Numérique | Enum | Chaîne)
    //   * preferred_protocols : protocoles recommandés par template (CSV)
    db.exec(`
      ALTER TABLE equipment_template_points ADD COLUMN tech_name TEXT;
      ALTER TABLE equipment_template_points ADD COLUMN nature TEXT;
      ALTER TABLE section_point_overrides ADD COLUMN tech_name TEXT;
      ALTER TABLE section_point_overrides ADD COLUMN nature TEXT;
      ALTER TABLE equipment_templates ADD COLUMN preferred_protocols TEXT;
    `);
    log.info('Migration 10 appliquee : tech_name + nature + preferred_protocols');
    db.pragma('user_version = 10');
  }

  if (current < 11) {
    // Lot 17b — justification BACS contextualisée par section et par équipement.
    // Permet d'expliquer en clair pourquoi tel élément est lié au décret BACS.
    db.exec(`
      ALTER TABLE equipment_templates ADD COLUMN bacs_justification TEXT;
      ALTER TABLE sections ADD COLUMN bacs_justification TEXT;
    `);
    log.info('Migration 11 appliquee : bacs_justification (templates + sections)');
    db.pragma('user_version = 11');
  }

  if (current < 12) {
    // Lot 26 — Zones fonctionnelles du bâtiment :
    //   * étendre l'enum sections.kind pour y ajouter 'zones'
    //   * créer la table af_zones (bureaux/logistique/atelier/technique/parking…)
    //   * pour chaque AF existante : ajouter une section kind='zones' en début de plan
    db.pragma('foreign_keys = OFF');
    db.exec(`
      DROP TABLE IF EXISTS sections_new;
      CREATE TABLE sections_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        af_id INTEGER NOT NULL REFERENCES afs(id) ON DELETE CASCADE,
        parent_id INTEGER REFERENCES sections(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        number TEXT,
        title TEXT NOT NULL,
        service_level TEXT,
        service_level_source TEXT,
        bacs_articles TEXT,
        bacs_justification TEXT,
        body_html TEXT,
        body_yjs BLOB,
        kind TEXT NOT NULL DEFAULT 'standard'
          CHECK (kind IN ('standard', 'equipment', 'synthesis', 'hyperveez_page', 'zones')),
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
      INSERT INTO sections_new
        (id, af_id, parent_id, position, number, title, service_level, service_level_source,
         bacs_articles, bacs_justification, body_html, body_yjs, kind, included_in_export,
         generic_note, fact_check_status, equipment_template_id, equipment_template_version,
         hyperveez_page_slug, created_at, updated_at, updated_by)
      SELECT
        id, af_id, parent_id, position, number, title, service_level, service_level_source,
        bacs_articles, bacs_justification, body_html, body_yjs, kind, included_in_export,
        generic_note, fact_check_status, equipment_template_id, equipment_template_version,
        hyperveez_page_slug, created_at, updated_at, updated_by
      FROM sections;
      DROP TABLE sections;
      ALTER TABLE sections_new RENAME TO sections;
      CREATE INDEX IF NOT EXISTS idx_sections_af_parent ON sections(af_id, parent_id, position);
      CREATE INDEX IF NOT EXISTS idx_sections_kind ON sections(af_id, kind);
      CREATE INDEX IF NOT EXISTS idx_sections_template ON sections(equipment_template_id)
        WHERE equipment_template_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS af_zones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        name TEXT NOT NULL,
        surface_m2 REAL,
        occupation_type TEXT,
        occupation_max_personnes INTEGER,
        horaires TEXT,
        qai_contraintes TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_zones_section ON af_zones(section_id, position);

      -- Trigger FTS5 cleanup à recréer (sections recréée)
      CREATE TRIGGER IF NOT EXISTS sections_fts_delete
      AFTER DELETE ON sections BEGIN
        DELETE FROM sections_fts WHERE section_id = old.id;
      END;
    `);
    db.pragma('foreign_keys = ON');

    // Ajout d'une section "Zones fonctionnelles" dans chaque AF non-deleted
    const afsToSeed = db.prepare('SELECT id FROM afs WHERE deleted_at IS NULL').all();
    let zonesAdded = 0;
    for (const af of afsToSeed) {
      // Vérifier qu'il n'y en a pas déjà
      const exists = db.prepare("SELECT 1 FROM sections WHERE af_id = ? AND kind = 'zones'").get(af.id);
      if (exists) continue;
      db.prepare(`
        INSERT INTO sections (af_id, parent_id, position, number, title, kind, body_html)
        VALUES (?, NULL, ?, NULL, ?, 'zones', ?)
      `).run(
        af.id,
        -100, // position négative → toujours en tête de l'arbre
        'Zones fonctionnelles du bâtiment',
        '<p>Découpage zonal du site (bureaux, logistique, ateliers, locaux techniques…). Ces zones éclairent les choix d\'équipements (CTAs, éclairages, comptages) et les exigences de confort/régulation propres à chaque usage.</p>'
      );
      zonesAdded++;
    }
    if (zonesAdded > 0) log.info(`Migration 12 : ${zonesAdded} sections "Zones fonctionnelles" creees`);
    log.info('Migration 12 appliquee : sections.kind etendu (zones) + table af_zones');
    db.pragma('user_version = 12');
  }

  if (current < 13) {
    // Lot 28 — Partage des AFs avec permissions read/write par utilisateur.
    // Modèle "permissive par défaut" : si une AF n'a aucune entrée dans
    // af_permissions → tout le monde y accède (legacy compat). Le partage sert
    // à formaliser les responsabilités, pas à restreindre (V1).
    db.exec(`
      CREATE TABLE IF NOT EXISTS af_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        af_id INTEGER NOT NULL REFERENCES afs(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('read', 'write')),
        granted_by INTEGER REFERENCES users(id),
        granted_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(af_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_af_perm_af ON af_permissions(af_id);
      CREATE INDEX IF NOT EXISTS idx_af_perm_user ON af_permissions(user_id);
    `);
    log.info('Migration 13 appliquee : af_permissions');
    db.pragma('user_version = 13');
  }

  if (current < 14) {
    // Lot UX BACS — réécriture des bacs_justification existantes pour qu'elles
    // soient pédagogiques et expliquent vraiment le lien équipement/décret.
    // On ne réécrit que celles qui correspondent à l'ancienne version courte
    // (générée Lot 17b/20) pour ne pas écraser une rédaction utilisateur.
    const ANCIEN_PREFIX_RE = /^[A-ZÀÉÈÊÎÔÛ][^<]+$/; // texte simple sans HTML, ancien format
    const tpls = db.prepare('SELECT id, slug, bacs_justification FROM equipment_templates WHERE bacs_justification IS NOT NULL').all();
    let cleared = 0;
    for (const t of tpls) {
      if (ANCIEN_PREFIX_RE.test((t.bacs_justification || '').trim())) {
        // Vide pour permettre au seeder de re-remplir avec la nouvelle version HTML
        db.prepare('UPDATE equipment_templates SET bacs_justification = NULL WHERE id = ?').run(t.id);
        cleared++;
      }
    }
    if (cleared > 0) log.info(`Migration 14 : ${cleared} bacs_justification anciennes vidées (sera re-rempli au seed)`);
    db.pragma('user_version = 14');
    log.info('Migration 14 appliquee : reset bacs_justification ancien format');
  }

  if (current < 15) {
    // Audit critères AF — corrections sur 7 templates (programmation horaire
    // attribuée à tort au régulateur de l'équipement) + 1 point label.
    // On vide les description_html concernées pour que le seeder les recharge
    // depuis les fichiers seeds (qui contiennent maintenant la version corrigée).
    const SLUGS_DESC_RESET = [
      'eclairage-interieur', 'eclairage-exterieur', 'prises-pilotees',
      'volets', 'stores', 'rooftop', 'equipement-generique',
    ];
    let cleared = 0;
    for (const slug of SLUGS_DESC_RESET) {
      const r = db.prepare('UPDATE equipment_templates SET description_html = NULL WHERE slug = ?').run(slug);
      cleared += r.changes;
    }
    if (cleared > 0) log.info(`Migration 15 : ${cleared} description_html vidées pour reseed (audit critères AF)`);

    // Renommage label point destratificateur "zone occupée" → "partie basse"
    const r2 = db.prepare(`
      UPDATE equipment_template_points
      SET label = 'Température air en partie basse'
      WHERE template_id = (SELECT id FROM equipment_templates WHERE slug = 'destratificateur')
        AND slug = 'temp.basse' AND label = 'Température air zone occupée'
    `).run();
    if (r2.changes > 0) log.info(`Migration 15 : ${r2.changes} point destratificateur renommé`);

    db.pragma('user_version = 15');
    log.info('Migration 15 appliquee : audit critères AF (programmation horaire = Buildy)');
  }

  if (current < 16) {
    // Reset descriptions équipement pour reseed avec mention explicite
    // "régulation assurée par l'équipement (fabricant ou intégrateur)".
    const SLUGS = [
      'cta', 'chaudiere', 'aerotherme', 'destratificateur', 'drv', 'rooftop',
      'ventilation-generique', 'ecs', 'eclairage-interieur', 'eclairage-exterieur',
      'prises-pilotees', 'production-electricite', 'volets', 'stores',
      'process-industriel', 'equipement-generique',
    ];
    let cleared = 0;
    for (const slug of SLUGS) {
      const r = db.prepare('UPDATE equipment_templates SET description_html = NULL WHERE slug = ?').run(slug);
      cleared += r.changes;
    }
    if (cleared > 0) log.info(`Migration 16 : ${cleared} description_html vidées (régulation équipement = fabricant/intégrateur)`);
    db.pragma('user_version = 16');
    log.info('Migration 16 appliquee : reset descriptions pour mention regulation fabricant/integrateur');
  }

  if (current < 17) {
    // Reset des descriptions équipement pour reseed avec :
    // - texte aéré en plusieurs paragraphes courts
    // - "GTB Buildy" → "solution Buildy" partout (positionnement Buildy non-GTB)
    // - "intégrateur" précisé (pas Buildy : chaufferiste, frigoriste, électricien…)
    const SLUGS = [
      'cta', 'chaudiere', 'aerotherme', 'destratificateur', 'drv', 'rooftop',
      'ventilation-generique', 'ecs', 'eclairage-interieur', 'eclairage-exterieur',
      'prises-pilotees', 'production-electricite', 'volets', 'stores',
      'process-industriel', 'equipement-generique',
      'compteur-electrique', 'compteur-gaz', 'compteur-eau', 'compteur-calories', 'qai',
    ];
    let cleared = 0, justifCleared = 0;
    for (const slug of SLUGS) {
      const r = db.prepare('UPDATE equipment_templates SET description_html = NULL WHERE slug = ?').run(slug);
      cleared += r.changes;
    }
    // Vide aussi les bacs_justification (refonte "GTB Buildy" → "solution Buildy")
    const r2 = db.prepare("UPDATE equipment_templates SET bacs_justification = NULL WHERE bacs_justification LIKE '%GTB Buildy%'").run();
    justifCleared = r2.changes;
    log.info(`Migration 17 : ${cleared} description_html + ${justifCleared} bacs_justification vidées (positionnement Buildy + aération)`);
    db.pragma('user_version = 17');
    log.info('Migration 17 appliquee : reset descriptions + justifications pour positionnement Buildy non-GTB');
  }

  if (current < 18) {
    // Lot 30 — Bibliothèque "Sections types" : contenu canonique des sections
    // standard (et 'zones') stocké en DB pour édition in-app, plus dans le seed.
    db.exec(`
      CREATE TABLE IF NOT EXISTS section_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        number TEXT,
        title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'standard',
        body_html TEXT,
        bacs_articles TEXT,
        service_level TEXT,
        service_level_source TEXT,
        features TEXT,
        current_version INTEGER NOT NULL DEFAULT 1,
        updated_by INTEGER REFERENCES users(id),
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_section_templates_slug ON section_templates(slug);
    `);

    // Ajout des colonnes de rattachement sur sections (best-effort : ignore si déjà là)
    try { db.exec('ALTER TABLE sections ADD COLUMN section_template_id INTEGER REFERENCES section_templates(id)'); } catch { /* déjà ajoutée */ }
    try { db.exec('ALTER TABLE sections ADD COLUMN section_template_version INTEGER'); } catch { /* déjà ajoutée */ }

    db.pragma('user_version = 18');
    log.info('Migration 18 appliquee : section_templates + rattachement sections');
  }

  if (current < 19) {
    // Lot 30+ — Backfill bacs_articles sur les sections equipement existantes
    // qui n'avaient pas hérité de la valeur du template.
    const r = db.prepare(`
      UPDATE sections
         SET bacs_articles = (SELECT bacs_articles FROM equipment_templates WHERE id = sections.equipment_template_id)
       WHERE kind = 'equipment'
         AND (bacs_articles IS NULL OR bacs_articles = '')
         AND equipment_template_id IS NOT NULL
         AND (SELECT bacs_articles FROM equipment_templates WHERE id = sections.equipment_template_id) IS NOT NULL
    `).run();
    if (r.changes > 0) log.info(`Migration 19 : ${r.changes} sections equipement ont herite des BACS de leur template`);
    db.pragma('user_version = 19');
    log.info('Migration 19 appliquee : backfill BACS sections equipement');
  }

  if (current < 20) {
    // Lot 31 — Mode "ecartee par la MOA" : nouvelle colonne distincte de
    // included_in_export. Section reste dans l'arbre + dans le PDF, mais
    // affiche un encart "fonctionnalite ecartee par la maitrise d'ouvrage".
    try { db.exec('ALTER TABLE sections ADD COLUMN opted_out_by_moa INTEGER NOT NULL DEFAULT 0'); }
    catch { /* deja la */ }
    db.pragma('user_version = 20');
    log.info('Migration 20 appliquee : opted_out_by_moa sur sections');
  }

  if (current < 21) {
    // Lot 31bis — Cohérence colonne BACS : R175-1 = definitions des systemes
    // (chauffage/clim/ventilation/STB), R175-3 = exigences fonctionnelles.
    // Les compteurs ne sont PAS des systemes au sens R175-1, ils contribuent
    // a l'exigence R175-3 §1 (suivi continu). On clear donc leur bacs_articles
    // pour ne plus melanger les deux semantiques. Le tag "contribue R175-3"
    // est gere visuellement dans la matrice de synthese.
    const COMPTEUR_SLUGS = ['compteur-electrique', 'compteur-gaz', 'compteur-eau', 'compteur-calories'];
    let clearedTemplates = 0, clearedSections = 0;
    for (const slug of COMPTEUR_SLUGS) {
      const r = db.prepare("UPDATE equipment_templates SET bacs_articles = NULL WHERE slug = ? AND bacs_articles LIKE 'R175-3%'").run(slug);
      clearedTemplates += r.changes;
    }
    const r2 = db.prepare(`
      UPDATE sections SET bacs_articles = NULL
      WHERE bacs_articles LIKE 'R175-3%'
        AND equipment_template_id IN (SELECT id FROM equipment_templates WHERE slug IN ('compteur-electrique','compteur-gaz','compteur-eau','compteur-calories'))
    `).run();
    clearedSections = r2.changes;
    if (clearedTemplates + clearedSections > 0) {
      log.info(`Migration 21 : ${clearedTemplates} template(s) compteur + ${clearedSections} section(s) AF — bacs_articles R175-3 efface (R175-3 != R175-1)`);
    }
    db.pragma('user_version = 21');
    log.info('Migration 21 appliquee : coherence BACS column (compteurs hors R175-1)');
  }

  if (current < 22) {
    // Lot 32 — Lien explicite instance d'equipement <-> zones fonctionnelles (M2M)
    db.exec(`
      CREATE TABLE IF NOT EXISTS equipment_instance_zones (
        instance_id INTEGER NOT NULL REFERENCES equipment_instances(id) ON DELETE CASCADE,
        zone_id INTEGER NOT NULL REFERENCES af_zones(id) ON DELETE CASCADE,
        PRIMARY KEY (instance_id, zone_id)
      );
      CREATE INDEX IF NOT EXISTS idx_eiz_instance ON equipment_instance_zones(instance_id);
      CREATE INDEX IF NOT EXISTS idx_eiz_zone ON equipment_instance_zones(zone_id);
    `);
    db.pragma('user_version = 22');
    log.info('Migration 22 appliquee : equipment_instance_zones (lien M2M instance <-> zones)');
  }

  if (current < 23) {
    // Lot 32 — Categories d'usage par INSTANCE (pas par template).
    // Ex : une CTA peut etre marquee chauffage+ventilation OU ventilation seule.
    db.exec(`
      CREATE TABLE IF NOT EXISTS equipment_instance_categories (
        instance_id INTEGER NOT NULL REFERENCES equipment_instances(id) ON DELETE CASCADE,
        category_key TEXT NOT NULL,
        PRIMARY KEY (instance_id, category_key)
      );
      CREATE INDEX IF NOT EXISTS idx_eic_instance ON equipment_instance_categories(instance_id);
    `);
    db.pragma('user_version = 23');
    log.info('Migration 23 appliquee : equipment_instance_categories (categories par instance)');
  }

  if (current < 24) {
    // Lot 32 — Catalogue editable des categories de systemes (avec icone + couleur)
    db.exec(`
      CREATE TABLE IF NOT EXISTS system_categories_db (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        bacs TEXT,
        slugs TEXT,
        icon_value TEXT DEFAULT 'fa-cube',
        icon_color TEXT DEFAULT '#6b7280',
        position INTEGER NOT NULL DEFAULT 0
      );
    `);
    db.pragma('user_version = 24');
    log.info('Migration 24 appliquee : system_categories_db (catalogue editable)');
  }

  if (current < 25) {
    // Lot 33 — Sections types : flag is_functionality + position pour drag-drop.
    // Les "fonctionnalites" sont separees des "sections types" et affichees
    // dans une page dediee. La numerotation devient automatique dans les AFs.
    try { db.exec('ALTER TABLE section_templates ADD COLUMN is_functionality INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* deja presente */ }
    try { db.exec('ALTER TABLE section_templates ADD COLUMN position INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* deja presente */ }

    // Marquer les fonctionnalites a partir de la liste figee historique
    // (cf. ancienne constante FUNCTIONALITY_NUMBERS de export.js).
    const FUNCTIONALITY_NUMBERS = [
      '1.5', '3.1', '3.2', '3.3', '4.1', '4.2', '4.3',
      '5.1', '5.2', '5.3', '6.1', '6.2', '6.3', '6.4', '6.5', '6.6',
      '7', '8', '9', '11.1', '11.2', '11.3',
    ];
    const placeholders = FUNCTIONALITY_NUMBERS.map(() => '?').join(',');
    db.prepare(`UPDATE section_templates SET is_functionality = 1 WHERE number IN (${placeholders})`).run(...FUNCTIONALITY_NUMBERS);

    // Backfill position : tri stable par decoupage numerique du number
    // (mirroir de la logique de tri dans list()).
    const rows = db.prepare('SELECT id, number FROM section_templates').all();
    rows.sort((a, b) => {
      const pa = (a.number || '').split('.').map(n => parseInt(n, 10) || 0);
      const pb = (b.number || '').split('.').map(n => parseInt(n, 10) || 0);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const da = pa[i] || 0, dbb = pb[i] || 0;
        if (da !== dbb) return da - dbb;
      }
      return a.id - b.id;
    });
    const updatePos = db.prepare('UPDATE section_templates SET position = ? WHERE id = ?');
    db.transaction(() => {
      rows.forEach((r, i) => updatePos.run((i + 1) * 10, r.id));
    })();

    db.exec('CREATE INDEX IF NOT EXISTS idx_section_templates_position ON section_templates(position)');
    db.pragma('user_version = 25');
    log.info('Migration 25 appliquee : section_templates is_functionality + position');
  }

  if (current < 26) {
    // Lot 33 — section_templates devient la source de verite du plan AF.
    // Ajout de parent_template_id (hierarchie) + equipment_template_id (lien
    // vers la bibliotheque equipement). One-shot bootstrap depuis PLAN_AF :
    // - INSERT les sous-sections equipment manquantes (auparavant non seedees)
    // - UPDATE parent_template_id, equipment_template_id, position pour TOUS
    try { db.exec('ALTER TABLE section_templates ADD COLUMN parent_template_id INTEGER REFERENCES section_templates(id) ON DELETE SET NULL'); } catch (e) { /* deja presente */ }
    try { db.exec('ALTER TABLE section_templates ADD COLUMN equipment_template_id INTEGER REFERENCES equipment_templates(id) ON DELETE SET NULL'); } catch (e) { /* deja presente */ }

    const { PLAN_AF } = require('./seeds/plan-af');
    const equipmentSlugToId = new Map();
    for (const row of db.prepare('SELECT id, slug FROM equipment_templates').all()) {
      equipmentSlugToId.set(row.slug, row.id);
    }

    function slugOf(node) {
      // Mirror de sectionTemplateSlug : number, sinon kind, sinon equipment_template_slug
      // pour les noeuds equipment sans number.
      return node.number || node.kind;
    }

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO section_templates
        (slug, number, title, kind, body_html, bacs_articles, service_level, current_version)
      VALUES (?, ?, ?, ?, NULL, ?, NULL, 1)
    `);
    const updateStmt = db.prepare(`
      UPDATE section_templates
         SET parent_template_id = ?, equipment_template_id = ?, position = ?
       WHERE id = ?
    `);

    let positionPerParent = new Map(); // parentId|0 -> next position
    function nextPos(parentId) {
      const k = parentId || 0;
      const cur = (positionPerParent.get(k) || 0) + 10;
      positionPerParent.set(k, cur);
      return cur;
    }

    const tx = db.transaction(() => {
      // Refresh slug map dans la transaction (peut grossir au fur et a mesure
      // qu'on insere des nouveaux rows equipment).
      const slugToId = new Map();
      function refreshSlugMap() {
        for (const row of db.prepare('SELECT id, slug FROM section_templates').all()) {
          slugToId.set(row.slug, row.id);
        }
      }
      refreshSlugMap();

      function walk(node, parentId) {
        const slug = slugOf(node);
        let id = slugToId.get(slug);
        // INSERT manquant (notamment les noeuds kind='equipment' qui
        // n'etaient pas seedes auparavant).
        if (!id) {
          insertStmt.run(slug, node.number || null, node.title, node.kind || 'standard',
            node.bacs_articles || null);
          refreshSlugMap();
          id = slugToId.get(slug);
        }
        if (id) {
          const equipId = node.equipment_template_slug
            ? equipmentSlugToId.get(node.equipment_template_slug) || null
            : null;
          updateStmt.run(parentId || null, equipId, nextPos(parentId), id);
        }
        if (Array.isArray(node.children)) {
          for (const c of node.children) walk(c, id || parentId);
        }
      }
      for (const top of PLAN_AF) walk(top, null);
    });
    tx();

    db.exec('CREATE INDEX IF NOT EXISTS idx_section_templates_parent ON section_templates(parent_template_id, position)');
    db.pragma('user_version = 26');
    log.info('Migration 26 appliquee : section_templates parent_template_id + equipment_template_id (bootstrap depuis PLAN_AF)');
  }

  if (current < 27) {
    // Lot 35 — Centralisation BACS au niveau categorie. Les equipment_templates
    // n'ont plus leur propre bacs_articles (heritage depuis system_categories_db).
    // Les sections types narratives (kind=standard, !is_functionality) non plus.
    // On vide les colonnes pour que le source unique soit categorie / fonctionnalite.
    db.exec(`UPDATE equipment_templates SET bacs_articles = NULL`);
    db.exec(`
      UPDATE section_templates
         SET bacs_articles = NULL
       WHERE is_functionality = 0
         AND kind != 'equipment'
    `);
    db.pragma('user_version = 27');
    log.info('Migration 27 appliquee : BACS centralise au niveau categorie (equipement) et fonctionnalites');
  }

  if (current < 28) {
    // Lot 35 (suite) — Le niveau de contrat (service_level) n'a de sens que
    // pour les fonctionnalites. On nettoie les sections types narratives.
    db.exec(`
      UPDATE section_templates
         SET service_level = NULL
       WHERE is_functionality = 0
    `);
    db.pragma('user_version = 28');
    log.info('Migration 28 appliquee : service_level reserve aux fonctionnalites');
  }

  if (current < 29) {
    // Lot 36 — Disponibilite par niveau de contrat. Une fonctionnalite peut
    // etre 'included' / 'paid_option' / NULL (pas dispo) a chacun des niveaux
    // E / S / P, independamment. Le service_level reste comme le niveau
    // minimum ou la feature est INCLUSE (cohesion ascendante).
    try { db.exec('ALTER TABLE section_templates ADD COLUMN avail_e TEXT'); } catch { /* deja la */ }
    try { db.exec('ALTER TABLE section_templates ADD COLUMN avail_s TEXT'); } catch { /* deja la */ }
    try { db.exec('ALTER TABLE section_templates ADD COLUMN avail_p TEXT'); } catch { /* deja la */ }

    // Backfill depuis service_level pour les fonctionnalites :
    // E ou E/S/P -> incluse partout
    // S ou S/P  -> incluse a S et P, indispo a E
    // P         -> incluse a P seulement
    db.exec(`
      UPDATE section_templates
         SET avail_e = 'included', avail_s = 'included', avail_p = 'included'
       WHERE is_functionality = 1
         AND service_level IN ('E', 'E/S/P')
    `);
    db.exec(`
      UPDATE section_templates
         SET avail_s = 'included', avail_p = 'included'
       WHERE is_functionality = 1
         AND service_level IN ('S', 'S/P')
    `);
    db.exec(`
      UPDATE section_templates
         SET avail_p = 'included'
       WHERE is_functionality = 1
         AND service_level = 'P'
    `);
    db.pragma('user_version = 29');
    log.info('Migration 29 appliquee : avail_e/s/p (matrice disponibilite par niveau)');
  }

  if (current < 30) {
    // Lot 37 — Tombstones de slugs supprimes par l'utilisateur. Empeche le
    // seedSectionTemplatesOnBoot de recreer un template qu'on a explicitement
    // supprime. Solution au bug "redeploy = retour des sections supprimees".
    db.exec(`
      CREATE TABLE IF NOT EXISTS deleted_section_template_slugs (
        slug TEXT PRIMARY KEY,
        deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.pragma('user_version = 30');
    log.info('Migration 30 appliquee : tombstones de slugs supprimes (anti-reseed)');
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
  extendByJti(jti, newExpiresAt) {
    db.prepare(`
      UPDATE sessions SET expires_at = ?, last_activity_at = CURRENT_TIMESTAMP
      WHERE jti = ?
    `).run(newExpiresAt, jti);
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
  create({ slug, name, category, bacsArticles, bacsJustification, descriptionHtml, iconKind, iconValue, iconColor, preferredProtocols, createdBy }) {
    const result = db.prepare(`
      INSERT INTO equipment_templates
        (slug, name, category, bacs_articles, bacs_justification, description_html, icon_kind, icon_value, icon_color, preferred_protocols, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(slug, name, category || null, bacsArticles || null, bacsJustification || null,
            descriptionHtml || null,
            iconKind || null, iconValue || null, iconColor || null, preferredProtocols || null,
            createdBy || null, createdBy || null);
    return this.getById(result.lastInsertRowid);
  },
  update(id, { name, category, bacsArticles, bacsJustification, descriptionHtml, iconKind, iconValue, iconColor, preferredProtocols, updatedBy }) {
    db.prepare(`
      UPDATE equipment_templates
      SET name = COALESCE(?, name),
          category = COALESCE(?, category),
          bacs_articles = COALESCE(?, bacs_articles),
          bacs_justification = COALESCE(?, bacs_justification),
          description_html = COALESCE(?, description_html),
          icon_kind = COALESCE(?, icon_kind),
          icon_value = COALESCE(?, icon_value),
          icon_color = COALESCE(?, icon_color),
          preferred_protocols = COALESCE(?, preferred_protocols),
          updated_by = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name, category, bacsArticles, bacsJustification, descriptionHtml, iconKind, iconValue, iconColor, preferredProtocols, updatedBy || null, id);
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
  create(templateId, { slug, position, label, dataType, direction, unit, notes, isOptional, techName, nature }) {
    const result = db.prepare(`
      INSERT INTO equipment_template_points
        (template_id, slug, position, label, data_type, direction, unit, notes, is_optional, tech_name, nature)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(templateId, slug, position || 0, label, dataType, direction, unit || null, notes || null,
            isOptional ? 1 : 0, techName || null, nature || null);
    return db.prepare('SELECT * FROM equipment_template_points WHERE id = ?').get(result.lastInsertRowid);
  },
  deleteByTemplate(templateId) {
    db.prepare('DELETE FROM equipment_template_points WHERE template_id = ?').run(templateId);
  },
};

// ── Section templates (Lot 30 : contenu canonique des sections standard) ───
const sectionTemplates = {
  list({ kind } = {}) {
    const where = [];
    const params = [];
    // Filtre is_functionality. kind='functionality' => 1, kind='standard' => 0,
    // kind absent => pas de filtre (compat).
    if (kind === 'functionality') { where.push('st.is_functionality = 1'); }
    else if (kind === 'standard') { where.push('st.is_functionality = 0'); }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return db.prepare(`
      SELECT st.*,
             (SELECT COUNT(*) FROM sections s
                JOIN afs a ON a.id = s.af_id
                WHERE s.section_template_id = st.id AND a.deleted_at IS NULL) AS affected_afs_count,
             (SELECT COUNT(*) FROM sections s
                JOIN afs a ON a.id = s.af_id
                WHERE s.section_template_id = st.id AND a.deleted_at IS NULL
                  AND (s.section_template_version IS NULL OR s.section_template_version < st.current_version)) AS outdated_count
      FROM section_templates st
      ${whereClause}
      ORDER BY st.position, st.id
    `).all(...params);
  },
  getById(id) {
    return db.prepare('SELECT * FROM section_templates WHERE id = ?').get(id);
  },
  getBySlug(slug) {
    return db.prepare('SELECT * FROM section_templates WHERE slug = ?').get(slug);
  },
  create({ slug, number, title, kind, bodyHtml, bacsArticles, serviceLevel, serviceLevelSource, features, isFunctionality, parentTemplateId, equipmentTemplateId, availE, availS, availP }) {
    // Position : derniere de la fratrie (parent_template_id donne).
    const maxRow = db.prepare(
      'SELECT COALESCE(MAX(position), 0) AS m FROM section_templates WHERE parent_template_id IS ?'
    ).get(parentTemplateId || null);
    const position = (maxRow?.m || 0) + 10;
    const result = db.prepare(`
      INSERT INTO section_templates
        (slug, number, title, kind, body_html, bacs_articles, service_level, service_level_source,
         features, is_functionality, position, parent_template_id, equipment_template_id,
         avail_e, avail_s, avail_p)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(slug, number || null, title, kind || 'standard', bodyHtml || null,
            bacsArticles || null, serviceLevel || null, serviceLevelSource || null,
            features ? JSON.stringify(features) : null, isFunctionality ? 1 : 0, position,
            parentTemplateId || null, equipmentTemplateId || null,
            availE || null, availS || null, availP || null);
    return this.getById(result.lastInsertRowid);
  },
  delete(id) {
    db.prepare('DELETE FROM section_templates WHERE id = ?').run(id);
  },
  // Reorder dans une fratrie. Si parentTemplateId est passe, met aussi a jour
  // le parent (cas du re-parenting via drag-drop). Sinon, garde le parent
  // courant et ne change que la position.
  reorder({ parentTemplateId = undefined, ids }) {
    const stmt = parentTemplateId === undefined
      ? db.prepare('UPDATE section_templates SET position = ? WHERE id = ?')
      : db.prepare('UPDATE section_templates SET position = ?, parent_template_id = ? WHERE id = ?');
    db.transaction(() => {
      ids.forEach((id, i) => {
        if (parentTemplateId === undefined) stmt.run((i + 1) * 10, id);
        else stmt.run((i + 1) * 10, parentTemplateId || null, id);
      });
    })();
  },
  countAffectedAfs(id) {
    const r = db.prepare(`
      SELECT COUNT(*) AS c FROM sections s
        JOIN afs a ON a.id = s.af_id
       WHERE s.section_template_id = ? AND a.deleted_at IS NULL
    `).get(id);
    return r?.c || 0;
  },
  // Garde-fou anti-cycle : verifie qu'on ne fait pas descendre un parent dans
  // un de ses descendants. Retourne true si setting parentId sur targetId
  // creerait un cycle.
  wouldCreateCycle(targetId, parentId) {
    if (!parentId) return false;
    if (parentId === targetId) return true;
    let cur = db.prepare('SELECT parent_template_id FROM section_templates WHERE id = ?').get(parentId);
    while (cur && cur.parent_template_id) {
      if (cur.parent_template_id === targetId) return true;
      cur = db.prepare('SELECT parent_template_id FROM section_templates WHERE id = ?').get(cur.parent_template_id);
    }
    return false;
  },
  update(id, { title, bodyHtml, bacsArticles, serviceLevel, updatedBy, kind, parentTemplateId, equipmentTemplateId, availE, availS, availP }) {
    const fields = [], params = [];
    if (title !== undefined) { fields.push('title = ?'); params.push(title); }
    if (bodyHtml !== undefined) { fields.push('body_html = ?'); params.push(bodyHtml); }
    if (bacsArticles !== undefined) { fields.push('bacs_articles = ?'); params.push(bacsArticles); }
    if (serviceLevel !== undefined) { fields.push('service_level = ?'); params.push(serviceLevel); }
    if (kind !== undefined) { fields.push('kind = ?'); params.push(kind); }
    if (parentTemplateId !== undefined) { fields.push('parent_template_id = ?'); params.push(parentTemplateId); }
    if (equipmentTemplateId !== undefined) { fields.push('equipment_template_id = ?'); params.push(equipmentTemplateId); }
    if (availE !== undefined) { fields.push('avail_e = ?'); params.push(availE); }
    if (availS !== undefined) { fields.push('avail_s = ?'); params.push(availS); }
    if (availP !== undefined) { fields.push('avail_p = ?'); params.push(availP); }
    if (updatedBy !== undefined) { fields.push('updated_by = ?'); params.push(updatedBy); }
    if (!fields.length) return this.getById(id);
    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    db.prepare(`UPDATE section_templates SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    return this.getById(id);
  },
  bumpVersion(id) {
    db.prepare('UPDATE section_templates SET current_version = current_version + 1 WHERE id = ?').run(id);
  },
  // Propage le nouveau body_html aux sections AF où l'ancien body_html est encore présent
  // (= user n'a pas customisé). Retourne le nombre de sections mises à jour.
  propagateUnchanged(templateId, oldBodyHtml, newBodyHtml, newVersion) {
    const r = db.prepare(`
      UPDATE sections
         SET body_html = ?, section_template_version = ?
       WHERE section_template_id = ?
         AND body_html IS ?
    `).run(newBodyHtml, newVersion, templateId, oldBodyHtml);
    return r.changes;
  },
  // Propage le nouveau bacs_articles aux sections AF non personnalisees.
  propagateBacsUnchanged(templateId, oldBacs, newBacs, newVersion) {
    const r = db.prepare(`
      UPDATE sections
         SET bacs_articles = ?, section_template_version = ?
       WHERE section_template_id = ?
         AND bacs_articles IS ?
    `).run(newBacs, newVersion, templateId, oldBacs);
    return r.changes;
  },
  // Le niveau de service est une meta non editable a la section : toujours synchroniser.
  syncServiceLevel(templateId, newLevel, newVersion) {
    const r = db.prepare(`
      UPDATE sections
         SET service_level = ?, section_template_version = ?
       WHERE section_template_id = ?
    `).run(newLevel, newVersion, templateId);
    return r.changes;
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
    return db.prepare(`
      SELECT s.*, u.display_name AS updated_by_name, u.email AS updated_by_email
      FROM sections s
      LEFT JOIN users u ON u.id = s.updated_by
      WHERE s.id = ?
    `).get(id);
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
      'bacs_articles', 'bacs_justification', 'body_html', 'kind', 'included_in_export', 'generic_note',
      'opted_out_by_moa',
      'fact_check_status', 'equipment_template_id', 'equipment_template_version',
      'section_template_id', 'section_template_version',
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
  create(sectionId, { action, basePointId, position, label, dataType, direction, unit, isOptional, techName, nature, createdBy }) {
    const result = db.prepare(`
      INSERT INTO section_point_overrides
        (section_id, action, base_point_id, position, label, data_type, direction, unit, is_optional, tech_name, nature, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sectionId, action, basePointId || null, position || 0, label || null,
      dataType || null, direction || null, unit || null,
      isOptional == null ? null : (isOptional ? 1 : 0),
      techName || null, nature || null,
      createdBy || null
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
  listByAf(afId) {
    return db.prepare(`
      SELECT
        ei.id, ei.section_id, ei.position, ei.reference, ei.location, ei.qty, ei.notes,
        s.number AS section_number, s.title AS section_title,
        s.included_in_export AS section_included_in_export,
        t.id AS template_id, t.slug AS template_slug, t.name AS template_name,
        t.icon_kind AS template_icon_kind, t.icon_value AS template_icon_value, t.icon_color AS template_icon_color,
        t.category AS template_category
      FROM equipment_instances ei
      JOIN sections s ON s.id = ei.section_id
      LEFT JOIN equipment_templates t ON t.id = s.equipment_template_id
      WHERE s.af_id = ?
      ORDER BY s.position, s.id, ei.position, ei.id
    `).all(afId);
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

// ── Catalogue editable des categories de systemes (Lot 32) ──
const systemCategoriesDb = {
  list() {
    return db.prepare('SELECT * FROM system_categories_db ORDER BY position, id').all().map(r => ({
      ...r,
      slugs: r.slugs ? JSON.parse(r.slugs) : [],
    }));
  },
  getByKey(key) {
    const r = db.prepare('SELECT * FROM system_categories_db WHERE key = ?').get(key);
    if (!r) return null;
    return { ...r, slugs: r.slugs ? JSON.parse(r.slugs) : [] };
  },
  getById(id) {
    const r = db.prepare('SELECT * FROM system_categories_db WHERE id = ?').get(id);
    if (!r) return null;
    return { ...r, slugs: r.slugs ? JSON.parse(r.slugs) : [] };
  },
  create({ key, label, bacs, slugs, iconValue, iconColor, position }) {
    const result = db.prepare(`
      INSERT INTO system_categories_db (key, label, bacs, slugs, icon_value, icon_color, position)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(key, label, bacs || null, JSON.stringify(slugs || []),
            iconValue || 'fa-cube', iconColor || '#6b7280', position || 0);
    return this.getById(result.lastInsertRowid);
  },
  update(id, { label, bacs, slugs, iconValue, iconColor, position }) {
    const fields = [], params = [];
    if (label !== undefined) { fields.push('label = ?'); params.push(label); }
    if (bacs !== undefined) { fields.push('bacs = ?'); params.push(bacs); }
    if (slugs !== undefined) { fields.push('slugs = ?'); params.push(JSON.stringify(slugs)); }
    if (iconValue !== undefined) { fields.push('icon_value = ?'); params.push(iconValue); }
    if (iconColor !== undefined) { fields.push('icon_color = ?'); params.push(iconColor); }
    if (position !== undefined) { fields.push('position = ?'); params.push(position); }
    if (!fields.length) return this.getById(id);
    params.push(id);
    db.prepare(`UPDATE system_categories_db SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    return this.getById(id);
  },
  delete(id) {
    db.prepare('DELETE FROM system_categories_db WHERE id = ?').run(id);
  },
};

// ── Categories d'usage par instance (Lot 32) — multi-valeurs par instance ──
const instanceCategories = {
  listForInstance(instanceId) {
    return db.prepare('SELECT category_key FROM equipment_instance_categories WHERE instance_id = ?')
      .all(instanceId).map(r => r.category_key);
  },
  listForAf(afId) {
    return db.prepare(`
      SELECT eic.instance_id, eic.category_key
      FROM equipment_instance_categories eic
      JOIN equipment_instances ei ON ei.id = eic.instance_id
      JOIN sections s ON s.id = ei.section_id
      WHERE s.af_id = ?
    `).all(afId);
  },
  setForInstance(instanceId, keys) {
    const tx = db.transaction((iId, ks) => {
      db.prepare('DELETE FROM equipment_instance_categories WHERE instance_id = ?').run(iId);
      const stmt = db.prepare('INSERT OR IGNORE INTO equipment_instance_categories (instance_id, category_key) VALUES (?, ?)');
      for (const k of ks) stmt.run(iId, k);
    });
    tx(instanceId, Array.isArray(keys) ? keys : []);
  },
};

// ── Lien M2M instance d'equipement <-> zones fonctionnelles (Lot 32) ──
const instanceZones = {
  listForInstance(instanceId) {
    return db.prepare(`
      SELECT z.* FROM af_zones z
      JOIN equipment_instance_zones eiz ON eiz.zone_id = z.id
      WHERE eiz.instance_id = ?
      ORDER BY z.position, z.id
    `).all(instanceId);
  },
  listForAf(afId) {
    return db.prepare(`
      SELECT eiz.instance_id, eiz.zone_id, z.name AS zone_name
      FROM equipment_instance_zones eiz
      JOIN af_zones z ON z.id = eiz.zone_id
      JOIN equipment_instances ei ON ei.id = eiz.instance_id
      JOIN sections s ON s.id = ei.section_id
      WHERE s.af_id = ?
    `).all(afId);
  },
  setForInstance(instanceId, zoneIds) {
    const tx = db.transaction((iId, zIds) => {
      db.prepare('DELETE FROM equipment_instance_zones WHERE instance_id = ?').run(iId);
      const stmt = db.prepare('INSERT OR IGNORE INTO equipment_instance_zones (instance_id, zone_id) VALUES (?, ?)');
      for (const z of zIds) stmt.run(iId, z);
    });
    tx(instanceId, Array.isArray(zoneIds) ? zoneIds : []);
  },
};

// ── Permissions AF (Lot 28) ─────────────────────────────────────────
const afPermissions = {
  listByAf(afId) {
    return db.prepare(`
      SELECT p.*, u.display_name AS user_display_name, u.email AS user_email,
             gb.display_name AS granted_by_name
      FROM af_permissions p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN users gb ON gb.id = p.granted_by
      WHERE af_id = ?
      ORDER BY p.granted_at DESC
    `).all(afId);
  },
  hasAccess(afId, userId, requiredRole = 'read') {
    if (!userId) return { ok: false, role: null };
    const af = db.prepare('SELECT created_by FROM afs WHERE id = ?').get(afId);
    if (af?.created_by === userId) return { ok: true, role: 'owner' };
    const perms = db.prepare('SELECT 1 FROM af_permissions WHERE af_id = ? LIMIT 1').get(afId);
    if (!perms) return { ok: true, role: 'public' }; // Mode legacy : pas de permission posée → tous accèdent
    const row = db.prepare('SELECT role FROM af_permissions WHERE af_id = ? AND user_id = ?').get(afId, userId);
    if (!row) return { ok: false, role: null };
    if (requiredRole === 'write' && row.role === 'read') return { ok: false, role: 'read' };
    return { ok: true, role: row.role };
  },
  grant(afId, userId, role, grantedBy) {
    db.prepare(`
      INSERT INTO af_permissions (af_id, user_id, role, granted_by)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(af_id, user_id) DO UPDATE SET role = excluded.role, granted_by = excluded.granted_by, granted_at = CURRENT_TIMESTAMP
    `).run(afId, userId, role, grantedBy || null);
    return db.prepare('SELECT * FROM af_permissions WHERE af_id = ? AND user_id = ?').get(afId, userId);
  },
  revoke(afId, userId) {
    db.prepare('DELETE FROM af_permissions WHERE af_id = ? AND user_id = ?').run(afId, userId);
  },
};

// ── Zones fonctionnelles du bâtiment (Lot 26) ─────────────────────────
const afZones = {
  listBySection(sectionId) {
    return db.prepare(`
      SELECT * FROM af_zones WHERE section_id = ? ORDER BY position, id
    `).all(sectionId);
  },
  create(sectionId, { position, name, surfaceM2, occupationType, occupationMaxPersonnes, horaires, qaiContraintes, notes }) {
    const result = db.prepare(`
      INSERT INTO af_zones (section_id, position, name, surface_m2, occupation_type, occupation_max_personnes, horaires, qai_contraintes, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sectionId, position || 0, name, surfaceM2 || null, occupationType || null,
            occupationMaxPersonnes || null, horaires || null, qaiContraintes || null, notes || null);
    return db.prepare('SELECT * FROM af_zones WHERE id = ?').get(result.lastInsertRowid);
  },
  update(id, { position, name, surfaceM2, occupationType, occupationMaxPersonnes, horaires, qaiContraintes, notes }) {
    const sets = [], params = [];
    if (position != null) { sets.push('position = ?'); params.push(position); }
    if (name != null) { sets.push('name = ?'); params.push(name); }
    if (surfaceM2 !== undefined) { sets.push('surface_m2 = ?'); params.push(surfaceM2); }
    if (occupationType !== undefined) { sets.push('occupation_type = ?'); params.push(occupationType); }
    if (occupationMaxPersonnes !== undefined) { sets.push('occupation_max_personnes = ?'); params.push(occupationMaxPersonnes); }
    if (horaires !== undefined) { sets.push('horaires = ?'); params.push(horaires); }
    if (qaiContraintes !== undefined) { sets.push('qai_contraintes = ?'); params.push(qaiContraintes); }
    if (notes !== undefined) { sets.push('notes = ?'); params.push(notes); }
    if (!sets.length) return null;
    params.push(id);
    db.prepare(`UPDATE af_zones SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return db.prepare('SELECT * FROM af_zones WHERE id = ?').get(id);
  },
  delete(id) {
    db.prepare('DELETE FROM af_zones WHERE id = ?').run(id);
  },
};

// ── Inspections BACS + Milestones (généralisée Lot 15) ──────────────
const afInspections = {
  listByAf(afId, { kind } = {}) {
    const sql = `
      SELECT i.*, u.display_name AS created_by_name,
             e.file_path, e.file_size_bytes
      FROM af_inspections i
      LEFT JOIN users u ON u.id = i.created_by
      LEFT JOIN exports e ON e.id = i.pdf_export_id
      WHERE af_id = ?
      ${kind ? 'AND i.kind = ?' : ''}
      ORDER BY inspected_at DESC
    `;
    return kind ? db.prepare(sql).all(afId, kind) : db.prepare(sql).all(afId);
  },
  create(afId, { inspectorName, gitTag, pdfExportId, notes, createdBy, kind = 'inspection_bacs' }) {
    const inspectedAt = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO af_inspections (af_id, inspected_at, inspector_name, git_tag, pdf_export_id, notes, created_by, kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(afId, inspectedAt, inspectorName || null, gitTag || null, pdfExportId || null, notes || null, createdBy || null, kind);
    return db.prepare('SELECT * FROM af_inspections WHERE id = ?').get(result.lastInsertRowid);
  },
};

// ── Tombstones de slugs supprimes (anti-reseed au boot) ────────────────
const deletedSectionTemplateSlugs = {
  has(slug) {
    if (!slug) return false;
    return !!db.prepare('SELECT 1 FROM deleted_section_template_slugs WHERE slug = ?').get(slug);
  },
  add(slug) {
    if (!slug) return;
    db.prepare('INSERT OR IGNORE INTO deleted_section_template_slugs (slug) VALUES (?)').run(slug);
  },
  remove(slug) {
    if (!slug) return;
    db.prepare('DELETE FROM deleted_section_template_slugs WHERE slug = ?').run(slug);
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
  // Liste globale paginee + filtres (vue Audit trail)
  listAll({ limit = 100, offset = 0, action = null, userId = null, afId = null } = {}) {
    const where = [];
    const params = [];
    if (action) { where.push('a.action LIKE ?'); params.push(`${action}%`); }
    if (userId) { where.push('a.user_id = ?'); params.push(userId); }
    if (afId)   { where.push('a.af_id = ?');   params.push(afId); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db.prepare(`
      SELECT a.*, u.display_name AS user_display_name, u.email AS user_email,
             af.client_name AS af_client_name, af.project_name AS af_project_name
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.user_id
      LEFT JOIN afs af ON af.id = a.af_id
      ${whereSql}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM audit_log a ${whereSql}`).get(...params);
    return { rows, total: totalRow?.c || 0 };
  },
  // Liste des actions distinctes pour les filtres
  distinctActions() {
    return db.prepare(`SELECT DISTINCT action FROM audit_log ORDER BY action`).all().map(r => r.action);
  },
};

module.exports = {
  init,
  users,
  sessions,
  equipmentTemplates,
  equipmentTemplatePoints,
  equipmentTemplateVersions,
  sectionTemplates,
  deletedSectionTemplateSlugs,
  sectionPointOverrides,
  equipmentInstances,
  instanceZones,
  instanceCategories,
  systemCategoriesDb,
  attachments,
  afZones,
  afPermissions,
  afs,
  afInspections,
  sections,
  auditLog,
  get db() { return db; },
};
