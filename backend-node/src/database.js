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

const TARGET_VERSION = 140;

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

  if (current < 31) {
    // Renommage de la valeur 'Chaîne' -> 'Chaîne de caractères' pour la
    // colonne nature des points (alignement libelle complet).
    db.exec(`UPDATE equipment_template_points SET nature = 'Chaîne de caractères' WHERE nature = 'Chaîne'`);
    db.pragma('user_version = 31');
    log.info('Migration 31 appliquee : nature Chaîne -> Chaîne de caractères');
  }

  if (current < 32) {
    // Captures attachees aux templates (section_template ou equipment_template)
    // en plus des sections d'AF. La table attachments existe deja avec une
    // FK section_id NOT NULL ; on l'assouplit en NULLABLE et on ajoute deux
    // FKs optionnelles vers section_templates et equipment_templates. Une
    // attachment est rattachee a EXACTEMENT un parent (section, section_tpl
    // ou equipment_tpl) — verifie par CHECK.
    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE attachments_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          section_id INTEGER REFERENCES sections(id) ON DELETE CASCADE,
          section_template_id INTEGER REFERENCES section_templates(id) ON DELETE CASCADE,
          equipment_template_id INTEGER REFERENCES equipment_templates(id) ON DELETE CASCADE,
          filename TEXT NOT NULL,
          original_name TEXT,
          caption TEXT,
          position INTEGER NOT NULL DEFAULT 0,
          width INTEGER,
          height INTEGER,
          uploaded_by INTEGER REFERENCES users(id),
          uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
          CHECK (
            (section_id IS NOT NULL) + (section_template_id IS NOT NULL) + (equipment_template_id IS NOT NULL) = 1
          )
        );
        INSERT INTO attachments_new
          (id, section_id, filename, original_name, caption, position, width, height, uploaded_by, uploaded_at)
          SELECT id, section_id, filename, original_name, caption, position, width, height, uploaded_by, uploaded_at
            FROM attachments;
        DROP TABLE attachments;
        ALTER TABLE attachments_new RENAME TO attachments;
        CREATE INDEX idx_att_section ON attachments(section_id, position);
        CREATE INDEX idx_att_section_tpl ON attachments(section_template_id, position);
        CREATE INDEX idx_att_equip_tpl ON attachments(equipment_template_id, position);
      `);
      db.pragma('user_version = 32');
      db.exec('COMMIT');
      log.info('Migration 32 appliquee : attachments peuvent cibler section_templates et equipment_templates');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  if (current < 33) {
    // Retrait du workflow d'inspection BACS (hors scope produit : l'app
    // ne sert qu'a produire l'AF livrable au DOE). On supprime la colonne
    // afs.last_inspection_at et on purge les enregistrements af_inspections
    // de kind='inspection_bacs' (les snapshots de transition validation /
    // commissioning / delivery restent).
    db.pragma('foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(`
        DELETE FROM af_inspections WHERE kind = 'inspection_bacs';

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
          created_by INTEGER REFERENCES users(id),
          updated_by INTEGER REFERENCES users(id),
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          deleted_at TEXT
        );
        INSERT INTO afs_new
          (id, slug, client_name, project_name, site_address, service_level, status,
           delivered_at, created_by, updated_by, created_at, updated_at, deleted_at)
          SELECT
            id, slug, client_name, project_name, site_address, service_level, status,
            delivered_at, created_by, updated_by, created_at, updated_at, deleted_at
          FROM afs;
        DROP TABLE afs;
        ALTER TABLE afs_new RENAME TO afs;
        CREATE INDEX IF NOT EXISTS idx_afs_status ON afs(status, deleted_at);
      `);
      db.pragma('foreign_keys = ON');
      db.pragma('user_version = 33');
      db.exec('COMMIT');
      log.info('Migration 33 appliquee : retrait workflow inspection BACS (afs.last_inspection_at + af_inspections kind=inspection_bacs)');
    } catch (e) {
      db.exec('ROLLBACK');
      db.pragma('foreign_keys = ON');
      throw e;
    }
  }

  if (current < 34) {
    // Multi-domaines Buildy Docs (additive) : nouvelles tables sites / zones /
    // equipments + colonnes kind/site_id/bacs_* sur afs. La table afs est
    // conservee telle quelle pour l'instant (rename -> documents prevu en m35).
    // Les statuts AF restent 'redaction'/'validee'/... pour ne rien casser ;
    // l'alignement anglais sera fait en meme temps que le rename.
    db.exec('BEGIN');
    try {
      db.exec(`
        -- Sites (synchro bidirectionnelle avec Fleet Manager via site_uuid)
        CREATE TABLE IF NOT EXISTS sites (
          site_id INTEGER PRIMARY KEY AUTOINCREMENT,
          site_uuid TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          customer_name TEXT,
          address TEXT,
          notes TEXT,
          created_by INTEGER REFERENCES users(id),
          updated_by INTEGER REFERENCES users(id),
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          deleted_at TEXT,
          synced_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sites_uuid ON sites(site_uuid);
        CREATE INDEX IF NOT EXISTS idx_sites_active ON sites(deleted_at, name);

        -- Queue de retry pour la synchro FM (cf. lib/sites-sync.js)
        CREATE TABLE IF NOT EXISTS sites_sync_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          site_uuid TEXT NOT NULL,
          payload TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          last_attempt_at TEXT,
          next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_sites_sync_queue_next ON sites_sync_queue(next_attempt_at);

        -- Zones fonctionnelles (locales Buildy Docs, partagees par tous les
        -- documents du site)
        CREATE TABLE IF NOT EXISTS zones (
          zone_id INTEGER PRIMARY KEY AUTOINCREMENT,
          site_id INTEGER NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          nature TEXT,
          position INTEGER NOT NULL DEFAULT 0,
          notes TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          deleted_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_zones_site ON zones(site_id, position);

        -- Equipements ET compteurs (distingue via type)
        CREATE TABLE IF NOT EXISTS equipments (
          equipment_id INTEGER PRIMARY KEY AUTOINCREMENT,
          zone_id INTEGER NOT NULL REFERENCES zones(zone_id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          power_kw REAL,
          communication_protocol TEXT,
          installation_date TEXT,
          status TEXT NOT NULL DEFAULT 'operational'
            CHECK (status IN ('designed','commissioned','tested','operational','decommissioned')),
          bacs_classification TEXT,
          notes TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          deleted_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_equipments_zone ON equipments(zone_id);
        CREATE INDEX IF NOT EXISTS idx_equipments_type ON equipments(type);

        -- Buildy Docs multi-domaines : kind + site_id + champs specifiques BACS
        ALTER TABLE afs ADD COLUMN kind TEXT NOT NULL DEFAULT 'af'
          CHECK (kind IN ('af','bacs_audit','site_audit','brochure'));
        ALTER TABLE afs ADD COLUMN site_id INTEGER REFERENCES sites(site_id) ON DELETE SET NULL;
        ALTER TABLE afs ADD COLUMN title TEXT;
        ALTER TABLE afs ADD COLUMN bacs_total_power_kw REAL;
        ALTER TABLE afs ADD COLUMN bacs_total_power_source TEXT NOT NULL DEFAULT 'auto'
          CHECK (bacs_total_power_source IN ('auto','manual_override'));
        ALTER TABLE afs ADD COLUMN bacs_building_permit_date TEXT;
        ALTER TABLE afs ADD COLUMN bacs_applicable_deadline TEXT;
        ALTER TABLE afs ADD COLUMN bacs_applicability_status TEXT
          CHECK (bacs_applicability_status IS NULL OR bacs_applicability_status IN
            ('subject_immediate','subject_2025','subject_2027','not_subject'));
        ALTER TABLE afs ADD COLUMN delivered_pdf_sha256 TEXT;
        ALTER TABLE afs ADD COLUMN delivered_git_tag TEXT;
        CREATE INDEX IF NOT EXISTS idx_afs_kind_site ON afs(kind, site_id);
      `);
      db.pragma('user_version = 34');
      db.exec('COMMIT');
      log.info('Migration 34 appliquee : multi-domaines Buildy Docs (sites/zones/equipments + kind/site_id/bacs_*)');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  if (current < 35) {
    // Tables specifiques aux audits BACS (decret R175). Cinq tables de
    // donnees + un referentiel seede (matrice nature_zone -> categories
    // BACS attendues).
    //
    // Toutes les FK pointent encore vers `afs(id)` ; au rename m36 elles
    // suivront automatiquement (les FK sont par nom de table en SQLite).
    db.exec('BEGIN');
    try {
      db.exec(`
        -- R175-1 §4 : systemes techniques par zone (chauffage, refroidissement,
        -- ventilation, ECS, eclairage int/ext, production electrique).
        CREATE TABLE IF NOT EXISTS bacs_audit_systems (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          document_id INTEGER NOT NULL REFERENCES afs(id) ON DELETE CASCADE,
          zone_id INTEGER NOT NULL REFERENCES zones(zone_id) ON DELETE CASCADE,
          system_category TEXT NOT NULL
            CHECK (system_category IN
              ('heating','cooling','ventilation','dhw',
               'lighting_indoor','lighting_outdoor','electricity_production')),
          equipment_id INTEGER REFERENCES equipments(equipment_id) ON DELETE SET NULL,
          present INTEGER NOT NULL DEFAULT 0,
          communication TEXT
            CHECK (communication IS NULL OR communication IN
              ('modbus_tcp','modbus_rtu','bacnet_ip','bacnet_mstp',
               'knx','mbus','mqtt','autre','non_communicant','absent')),
          notes TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(document_id, zone_id, system_category)
        );
        CREATE INDEX IF NOT EXISTS idx_bacs_systems_doc ON bacs_audit_systems(document_id);
        CREATE INDEX IF NOT EXISTS idx_bacs_systems_zone ON bacs_audit_systems(zone_id);

        -- R175-3 §1 : matrice usage x zone des compteurs requis vs presents.
        CREATE TABLE IF NOT EXISTS bacs_audit_meters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          document_id INTEGER NOT NULL REFERENCES afs(id) ON DELETE CASCADE,
          zone_id INTEGER REFERENCES zones(zone_id) ON DELETE CASCADE,
          usage TEXT NOT NULL
            CHECK (usage IN ('heating','cooling','dhw','pv','lighting','other')),
          meter_type TEXT NOT NULL
            CHECK (meter_type IN
              ('electric','electric_production','gas','water','thermal')),
          equipment_id INTEGER REFERENCES equipments(equipment_id) ON DELETE SET NULL,
          required INTEGER NOT NULL DEFAULT 1,
          present_actual INTEGER NOT NULL DEFAULT 0,
          communicating INTEGER NOT NULL DEFAULT 0,
          communication_protocol TEXT,
          notes TEXT,
          recommendation TEXT
            CHECK (recommendation IS NULL OR recommendation IN
              ('to_add','to_replace','to_connect','compliant')),
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_bacs_meters_doc ON bacs_audit_meters(document_id);
        CREATE INDEX IF NOT EXISTS idx_bacs_meters_zone ON bacs_audit_meters(zone_id);

        -- R175-3 / R175-4 / R175-5 : evaluation de la solution GTB en place.
        -- 1-1 avec le document (donc PK = document_id, pas d'autoincrement).
        CREATE TABLE IF NOT EXISTS bacs_audit_bms (
          document_id INTEGER PRIMARY KEY REFERENCES afs(id) ON DELETE CASCADE,
          existing_solution TEXT,
          existing_solution_brand TEXT,
          -- R175-3 : 4 exigences fonctionnelles
          meets_r175_3_p1 INTEGER, -- suivi continu / pas horaire / retention 5 ans
          meets_r175_3_p2 INTEGER, -- detection pertes d'efficacite
          meets_r175_3_p3 INTEGER, -- interoperabilite
          meets_r175_3_p4 INTEGER, -- arret manuel + autonome
          notes_p1 TEXT,
          notes_p2 TEXT,
          notes_p3 TEXT,
          notes_p4 TEXT,
          -- R175-4 : verifications periodiques
          has_maintenance_procedures INTEGER,
          notes_maintenance TEXT,
          -- R175-5 : formation de l'exploitant
          operator_trained INTEGER,
          operator_training_date TEXT,
          notes_training TEXT,
          -- Synthese
          overall_compliance TEXT
            CHECK (overall_compliance IS NULL OR overall_compliance IN
              ('compliant','partial','non_compliant')),
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        -- R175-6 : regulation thermique automatique par piece ou par zone.
        CREATE TABLE IF NOT EXISTS bacs_audit_thermal_regulation (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          document_id INTEGER NOT NULL REFERENCES afs(id) ON DELETE CASCADE,
          zone_id INTEGER NOT NULL REFERENCES zones(zone_id) ON DELETE CASCADE,
          has_automatic_regulation INTEGER NOT NULL DEFAULT 0,
          regulation_type TEXT
            CHECK (regulation_type IS NULL OR regulation_type IN
              ('per_room','per_zone','central_only','none')),
          generator_type TEXT
            CHECK (generator_type IS NULL OR generator_type IN
              ('gas','electric','heat_pump','wood_appliance','district_heating','other')),
          generator_age_years INTEGER,
          notes TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(document_id, zone_id)
        );
        CREATE INDEX IF NOT EXISTS idx_bacs_thermal_doc ON bacs_audit_thermal_regulation(document_id);

        -- Plan de mise en conformite : actions correctives consolidees.
        -- Mix d'items auto-generes (depuis systems/meters/bms) et manuels.
        CREATE TABLE IF NOT EXISTS bacs_audit_action_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          document_id INTEGER NOT NULL REFERENCES afs(id) ON DELETE CASCADE,
          category TEXT NOT NULL
            CHECK (category IN
              ('meter_addition','meter_replacement','meter_connection',
               'system_addition','system_replacement','communication_upgrade',
               'bms_upgrade','bms_replacement','bms_addition',
               'data_retention_upgrade','training','documentation',
               'thermal_regulation','thermal_regulation_upgrade','other')),
          severity TEXT NOT NULL
            CHECK (severity IN ('blocking','major','minor')),
          r175_article TEXT,
          title TEXT NOT NULL,
          description TEXT,
          zone_id INTEGER REFERENCES zones(zone_id) ON DELETE SET NULL,
          equipment_id INTEGER REFERENCES equipments(equipment_id) ON DELETE SET NULL,
          source_table TEXT
            CHECK (source_table IS NULL OR source_table IN
              ('systems','meters','bms','thermal_regulation')),
          source_id INTEGER,
          auto_generated INTEGER NOT NULL DEFAULT 1,
          commercial_notes TEXT,
          estimated_effort TEXT
            CHECK (estimated_effort IS NULL OR estimated_effort IN ('low','medium','high')),
          status TEXT NOT NULL DEFAULT 'open'
            CHECK (status IN ('open','quoted','in_progress','done','declined')),
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_bacs_actions_doc ON bacs_audit_action_items(document_id, severity, position);
        CREATE INDEX IF NOT EXISTS idx_bacs_actions_source ON bacs_audit_action_items(document_id, source_table, source_id);

        -- Referentiel : matrice nature_zone -> categories BACS attendues.
        -- Seede au boot par seedBacsRequirements() dans seeder.js.
        CREATE TABLE IF NOT EXISTS bacs_requirements_by_zone_nature (
          zone_nature TEXT PRIMARY KEY,
          required_categories TEXT NOT NULL -- JSON array of system_category values
        );
      `);
      db.pragma('user_version = 35');
      db.exec('COMMIT');
      log.info('Migration 35 appliquee : tables audit BACS (systems/meters/bms/thermal_regulation/action_items + referentiel)');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  if (current < 36) {
    // Etend le CHECK exports.kind pour accepter 'pdf-bacs-audit' (export PDF
    // d'audit BACS). Recreation de la table car SQLite ne permet pas de
    // modifier un CHECK in-place. On preserve les exports historiques.
    db.pragma('foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE exports_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          af_id INTEGER NOT NULL REFERENCES afs(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('pdf-af', 'pdf-points-list', 'pdf-bacs-audit')),
          file_path TEXT NOT NULL,
          sections_snapshot TEXT,
          options TEXT,
          motif TEXT,
          git_tag TEXT,
          exported_by INTEGER REFERENCES users(id),
          exported_at TEXT DEFAULT CURRENT_TIMESTAMP,
          file_size_bytes INTEGER
        );
        INSERT INTO exports_new SELECT * FROM exports;
        DROP TABLE exports;
        ALTER TABLE exports_new RENAME TO exports;
        CREATE INDEX IF NOT EXISTS idx_exports_af ON exports(af_id, exported_at DESC);
      `);
      db.pragma('foreign_keys = ON');
      db.pragma('user_version = 36');
      db.exec('COMMIT');
      log.info('Migration 36 appliquee : exports.kind accepte pdf-bacs-audit');
    } catch (e) {
      db.exec('ROLLBACK');
      db.pragma('foreign_keys = ON');
      throw e;
    }
  }

  if (current < 37) {
    // Refonte de la matrice bacs_requirements_by_zone_nature : exhaustive par
    // defaut pour ne rien oublier sur le terrain. Les 6 categories R175-1 §4
    // (chauffage, refroidissement, ventilation, ECS, eclairage interieur,
    // production electrique) sont desormais pre-remplies pour toute zone
    // interieure ; outdoor garde lighting_outdoor + electricity_production.
    //
    // On vide la table pour forcer le re-seed au boot suivant via
    // seedBacsRequirementsOnBoot. Pour les audits BACS existants, l'auditeur
    // doit cliquer "Regenerer le plan" (qui appelle resync + regen action
    // items) pour ajouter les nouvelles rows aux zones deja saisies.
    db.exec('DELETE FROM bacs_requirements_by_zone_nature');
    db.pragma('user_version = 37');
    log.info('Migration 37 appliquee : matrice nature_zone videe (re-seed au boot avec 6 categories par zone interieure)');
  }

  if (current < 38) {
    // Audit BACS v2 — affinements terrain (cf plan Phase 3) :
    //   - zones.surface_m2
    //   - bacs_audit_system_devices : equipements individuels par catégorie x zone
    //   - bacs_meter_requirements_matrix : matrice usage x nature_zone -> meter_type
    //   - bacs_audit_systems.meets_r175_3_p3 / p4 (interop + arret manuel par systeme)
    //   - bacs_audit_bms enrichie (location, model_reference, manages_*) + drop p3/p4
    //   - site_documents : fichiers DOE par site
    //   - site_credentials : credentials chiffres par site
    db.pragma('foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(`
        -- 1. Surface zones (optionnelle)
        ALTER TABLE zones ADD COLUMN surface_m2 REAL;

        -- 2. Equipements individuels (multi-systemes par categorie x zone)
        CREATE TABLE IF NOT EXISTS bacs_audit_system_devices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          system_id INTEGER NOT NULL REFERENCES bacs_audit_systems(id) ON DELETE CASCADE,
          position INTEGER NOT NULL DEFAULT 0,
          brand TEXT,
          model_reference TEXT,
          power_kw REAL,
          energy_source TEXT
            CHECK (energy_source IS NULL OR energy_source IN
              ('gas','electric','wood','heat_pump','district_heating','fuel_oil','solar','biomass','autre')),
          device_role TEXT
            CHECK (device_role IS NULL OR device_role IN
              ('production','distribution','emission','autre')),
          location TEXT,
          notes TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_bacs_devices_system ON bacs_audit_system_devices(system_id, position);

        -- 3. Matrice usage x nature_zone -> meter_type (auto-population compteurs)
        CREATE TABLE IF NOT EXISTS bacs_meter_requirements_matrix (
          zone_nature TEXT NOT NULL,
          usage TEXT NOT NULL,
          meter_type TEXT NOT NULL,
          PRIMARY KEY (zone_nature, usage, meter_type)
        );

        -- 4. Critères R175-3 §3 (interop) et §4 (arret manuel) par système
        ALTER TABLE bacs_audit_systems ADD COLUMN meets_r175_3_p3 INTEGER;
        ALTER TABLE bacs_audit_systems ADD COLUMN meets_r175_3_p4 INTEGER;
        ALTER TABLE bacs_audit_systems ADD COLUMN notes_p3 TEXT;
        ALTER TABLE bacs_audit_systems ADD COLUMN notes_p4 TEXT;

        -- 5. GTB enrichie (location, model_reference, manages_*)
        ALTER TABLE bacs_audit_bms ADD COLUMN location TEXT;
        ALTER TABLE bacs_audit_bms ADD COLUMN model_reference TEXT;
        ALTER TABLE bacs_audit_bms ADD COLUMN manages_heating INTEGER;
        ALTER TABLE bacs_audit_bms ADD COLUMN manages_cooling INTEGER;
        ALTER TABLE bacs_audit_bms ADD COLUMN manages_ventilation INTEGER;
        ALTER TABLE bacs_audit_bms ADD COLUMN manages_dhw INTEGER;
        ALTER TABLE bacs_audit_bms ADD COLUMN manages_lighting INTEGER;

        -- 6. Drop bacs_audit_bms.meets_r175_3_p3 + p4 + notes_p3 + notes_p4
        --    (descendus au niveau systeme). SQLite ne supporte pas DROP COLUMN
        --    < 3.35 → recreate table sans ces colonnes.
        CREATE TABLE bacs_audit_bms_new (
          document_id INTEGER PRIMARY KEY REFERENCES afs(id) ON DELETE CASCADE,
          existing_solution TEXT,
          existing_solution_brand TEXT,
          location TEXT,
          model_reference TEXT,
          manages_heating INTEGER,
          manages_cooling INTEGER,
          manages_ventilation INTEGER,
          manages_dhw INTEGER,
          manages_lighting INTEGER,
          meets_r175_3_p1 INTEGER,
          meets_r175_3_p2 INTEGER,
          notes_p1 TEXT,
          notes_p2 TEXT,
          has_maintenance_procedures INTEGER,
          notes_maintenance TEXT,
          operator_trained INTEGER,
          operator_training_date TEXT,
          notes_training TEXT,
          overall_compliance TEXT
            CHECK (overall_compliance IS NULL OR overall_compliance IN
              ('compliant','partial','non_compliant')),
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO bacs_audit_bms_new
          (document_id, existing_solution, existing_solution_brand,
           location, model_reference,
           manages_heating, manages_cooling, manages_ventilation, manages_dhw, manages_lighting,
           meets_r175_3_p1, meets_r175_3_p2, notes_p1, notes_p2,
           has_maintenance_procedures, notes_maintenance,
           operator_trained, operator_training_date, notes_training,
           overall_compliance, updated_at)
          SELECT
           document_id, existing_solution, existing_solution_brand,
           location, model_reference,
           manages_heating, manages_cooling, manages_ventilation, manages_dhw, manages_lighting,
           meets_r175_3_p1, meets_r175_3_p2, notes_p1, notes_p2,
           has_maintenance_procedures, notes_maintenance,
           operator_trained, operator_training_date, notes_training,
           overall_compliance, updated_at
          FROM bacs_audit_bms;
        DROP TABLE bacs_audit_bms;
        ALTER TABLE bacs_audit_bms_new RENAME TO bacs_audit_bms;

        -- 7. Fichiers DOE rattaches au site (partages entre tous documents)
        CREATE TABLE IF NOT EXISTS site_documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          site_id INTEGER NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          category TEXT NOT NULL
            CHECK (category IN
              ('plan','schema_electrique','schema_synoptique','analyse_fonctionnelle',
               'datasheet','manuel_utilisateur','rapport_essais','autre')),
          filename TEXT NOT NULL,
          original_name TEXT,
          size_bytes INTEGER,
          mime_type TEXT,
          bacs_audit_system_id INTEGER REFERENCES bacs_audit_systems(id) ON DELETE SET NULL,
          bacs_audit_bms_document_id INTEGER REFERENCES bacs_audit_bms(document_id) ON DELETE SET NULL,
          uploaded_by INTEGER REFERENCES users(id),
          uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_site_documents_site ON site_documents(site_id, category);

        -- 8. Credentials chiffres par site
        CREATE TABLE IF NOT EXISTS site_credentials (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          site_id INTEGER NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          type TEXT NOT NULL
            CHECK (type IN ('web','ssh','vpn','snmp','rdp','autre')),
          url TEXT,
          username TEXT,
          password_encrypted TEXT,
          notes TEXT,
          bacs_audit_system_id INTEGER REFERENCES bacs_audit_systems(id) ON DELETE SET NULL,
          bacs_audit_bms_document_id INTEGER REFERENCES bacs_audit_bms(document_id) ON DELETE SET NULL,
          created_by INTEGER REFERENCES users(id),
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_site_credentials_site ON site_credentials(site_id, type);
      `);
      db.pragma('foreign_keys = ON');
      db.pragma('user_version = 38');
      db.exec('COMMIT');
      log.info('Migration 38 appliquee : audit BACS v2 (zones.surface_m2 + system_devices + meter_requirements_matrix + R175-3 par systeme + GTB enrichie + site_documents + site_credentials)');
    } catch (e) {
      db.exec('ROLLBACK');
      db.pragma('foreign_keys = ON');
      throw e;
    }
  }

  if (current < 39) {
    // source_subtype sur bacs_audit_action_items : permet plusieurs items
    // distincts par paire (source_table, source_id), notamment pour les
    // systems qui peuvent declencher 'absent' / 'non_communicant' /
    // 'r175_3_p3' / 'r175_3_p4' independamment.
    db.exec('BEGIN');
    try {
      db.exec(`
        ALTER TABLE bacs_audit_action_items ADD COLUMN source_subtype TEXT;
        DROP INDEX IF EXISTS idx_bacs_actions_source;
        CREATE INDEX idx_bacs_actions_source
          ON bacs_audit_action_items(document_id, source_table, source_id, source_subtype);
      `);
      db.pragma('user_version = 39');
      db.exec('COMMIT');
      log.info('Migration 39 appliquee : source_subtype sur bacs_audit_action_items');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  if (current < 40) {
    // Audit BACS v2.1 — retours terrain :
    //   - Devices : nom obligatoire (1ere position) + communication_protocol
    //     (LoRaWAN inclus) car la communication est au niveau equipement, pas
    //     au niveau categorie de systeme
    //   - Devices : "regulation" ajoute aux roles possibles
    //   - Systeme : R175-3 §4 scinde en 2 criteres distincts
    //     (arret manuel + fonctionnement autonome) decoches par defaut
    //   - Systeme : managed_by_bms (oui/non) pour cocher dans la GTB les
    //     systemes effectivement integres
    //   - Reset valeurs NULL existantes a 0 (= decoche) pour que le bouton
    //     decoche par defaut soit l'etat de saisie initial
    //   - Drop matrice bacs_meter_requirements_matrix : compteurs auto
    //     desormais derives uniquement des devices saisis (energy_source +
    //     zone du systeme parent)
    db.exec('BEGIN');
    try {
      db.exec(`
        -- 1. Devices : nom + protocole de communication
        ALTER TABLE bacs_audit_system_devices ADD COLUMN name TEXT;
        ALTER TABLE bacs_audit_system_devices ADD COLUMN communication_protocol TEXT
          CHECK (communication_protocol IS NULL OR communication_protocol IN
            ('modbus_tcp','modbus_rtu','bacnet_ip','bacnet_mstp',
             'knx','mbus','mqtt','lorawan','autre','non_communicant','absent'));

        -- 2. Systeme : 2 nouveaux criteres + managed_by_bms
        ALTER TABLE bacs_audit_systems ADD COLUMN meets_r175_3_p4_autonomous INTEGER DEFAULT 0;
        ALTER TABLE bacs_audit_systems ADD COLUMN notes_p4_autonomous TEXT;
        ALTER TABLE bacs_audit_systems ADD COLUMN managed_by_bms INTEGER DEFAULT 0;

        -- 3. Reset NULL -> 0 pour les criteres R175-3 §3 / §4 existants
        --    (decoche par defaut, cf retour Kevin)
        UPDATE bacs_audit_systems SET meets_r175_3_p3 = 0 WHERE meets_r175_3_p3 IS NULL;
        UPDATE bacs_audit_systems SET meets_r175_3_p4 = 0 WHERE meets_r175_3_p4 IS NULL;

        -- 4. Vide la matrice usage x nature_zone : les compteurs sont
        --    desormais derives des devices, pas des zones
        DELETE FROM bacs_meter_requirements_matrix;

        -- 5. Etend device_role avec 'regulation' (recreate table car CHECK
        --    contraintes ne s'editent pas in-place en SQLite < 3.35).
        --    Preserve toutes les colonnes ajoutees ci-dessus.
        CREATE TABLE bacs_audit_system_devices_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          system_id INTEGER NOT NULL REFERENCES bacs_audit_systems(id) ON DELETE CASCADE,
          position INTEGER NOT NULL DEFAULT 0,
          name TEXT,
          brand TEXT,
          model_reference TEXT,
          power_kw REAL,
          energy_source TEXT
            CHECK (energy_source IS NULL OR energy_source IN
              ('gas','electric','wood','heat_pump','district_heating','fuel_oil','solar','biomass','autre')),
          device_role TEXT
            CHECK (device_role IS NULL OR device_role IN
              ('production','distribution','emission','regulation','autre')),
          communication_protocol TEXT
            CHECK (communication_protocol IS NULL OR communication_protocol IN
              ('modbus_tcp','modbus_rtu','bacnet_ip','bacnet_mstp',
               'knx','mbus','mqtt','lorawan','autre','non_communicant','absent')),
          location TEXT,
          notes TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO bacs_audit_system_devices_new
          (id, system_id, position, name, brand, model_reference, power_kw,
           energy_source, device_role, communication_protocol, location, notes,
           created_at, updated_at)
          SELECT id, system_id, position, name, brand, model_reference, power_kw,
                 energy_source, device_role, communication_protocol, location, notes,
                 created_at, updated_at
          FROM bacs_audit_system_devices;
        DROP TABLE bacs_audit_system_devices;
        ALTER TABLE bacs_audit_system_devices_new RENAME TO bacs_audit_system_devices;
        CREATE INDEX idx_bacs_devices_system ON bacs_audit_system_devices(system_id, position);
      `);
      db.pragma('user_version = 40');
      db.exec('COMMIT');
      log.info('Migration 40 appliquee : audit BACS v2.1 (devices.name + communication_protocol/LoRaWAN, R175-3 §4 split, managed_by_bms, matrice meters videe)');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  if (current < 41) {
    // Backfill des notes auto-generees des compteurs : remplace les libelles
    // anglais (heritage des anciennes versions du seeder) par leurs equivalents
    // francais avec accents. Idempotent : les notes utilisateur ne sont pas
    // touchees (seules les patterns connus sont remplaces).
    db.exec('BEGIN');
    try {
      // Compteurs generaux
      db.prepare("UPDATE bacs_audit_meters SET notes = 'Compteur général électrique du bâtiment' WHERE notes = 'Compteur general electrique du batiment'").run();
      db.prepare("UPDATE bacs_audit_meters SET notes = 'Compteur général gaz du bâtiment' WHERE notes = 'Compteur general gaz du batiment'").run();
      db.prepare("UPDATE bacs_audit_meters SET notes = 'Compteur général fioul du bâtiment' WHERE notes = 'Compteur general fioul du batiment'").run();
      db.prepare("UPDATE bacs_audit_meters SET notes = 'Compteur général thermique (réseau de chaleur)' WHERE notes = 'Compteur general thermique (reseau de chaleur)'").run();
      // Compteurs zonaux : fix les types et usages anglais dans les notes
      db.exec(`
        UPDATE bacs_audit_meters
        SET notes = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(notes,
          'Compteur gas en', 'Compteur gaz en'),
          'Compteur electric en', 'Compteur électrique en'),
          'Compteur electric_production en', 'Compteur électrique de production en'),
          'Compteur thermal en', 'Compteur thermique en'),
          'Compteur water en', 'Compteur eau en'),
          '(heating)', '(chauffage)'),
          '(cooling)', '(refroidissement)'),
          '(dhw)', '(ECS)'),
          '(lighting)', '(éclairage)'),
          '(pv)', '(production PV)'),
          '(other)', '(général)')
        WHERE notes LIKE 'Compteur % en zone %';
      `);
      db.pragma('user_version = 41');
      db.exec('COMMIT');
      log.info('Migration 41 appliquee : notes compteurs auto traduites en FR');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  if (current < 42) {
    // Cf retour Kevin : "Communicant / Arret manuel possible / Fonctionnement
    // autonome doit s'appliquer a chaque systeme declare". Les checkboxes
    // descendent du niveau systeme vers le niveau device. Les colonnes au
    // niveau system (meets_r175_3_p3/p4/p4_autonomous) restent en DB pour
    // compat ascendante mais ne sont plus utilisees par le generateur.
    //
    // "Communicant" est redondant avec la liste deroulante du protocole :
    // si communication_protocol IS NULL ou ('non_communicant','absent'),
    // le device est considere non-communicant. Pas besoin de checkbox.
    db.exec(`
      ALTER TABLE bacs_audit_system_devices ADD COLUMN meets_r175_3_p4 INTEGER DEFAULT 0;
      ALTER TABLE bacs_audit_system_devices ADD COLUMN meets_r175_3_p4_autonomous INTEGER DEFAULT 0;
    `);
    db.pragma('user_version = 42');
    log.info('Migration 42 appliquee : R175-3 §4 par device (manual + autonomous), interop inferee du protocole');
  }

  if (current < 43) {
    // Cf retour Kevin v2.3 :
    //  - Systemes integres a la GTB = au niveau device (pas categorie). Mise
    //    a jour live au fur et a mesure de la declaration des devices.
    //  - Compteurs integres a la GTB : meme principe (managed_by_bms au
    //    niveau bacs_audit_meters).
    //  - Hors-Service partout (devices, meters, bms) : case a cocher qui
    //    indique que l'equipement est inactif. Quand HS, le generateur
    //    d'actions ignore l'item (pas d'action corrective genere).
    db.exec(`
      ALTER TABLE bacs_audit_system_devices ADD COLUMN managed_by_bms INTEGER DEFAULT 0;
      ALTER TABLE bacs_audit_system_devices ADD COLUMN out_of_service INTEGER DEFAULT 0;
      ALTER TABLE bacs_audit_meters ADD COLUMN managed_by_bms INTEGER DEFAULT 0;
      ALTER TABLE bacs_audit_meters ADD COLUMN out_of_service INTEGER DEFAULT 0;
      ALTER TABLE bacs_audit_bms ADD COLUMN out_of_service INTEGER DEFAULT 0;
    `);
    db.pragma('user_version = 43');
    log.info('Migration 43 appliquee : managed_by_bms + out_of_service par device/meter/bms');
  }

  if (current < 44) {
    // Etend le CHECK source_table pour accepter 'devices' (introduit en m42).
    // SQLite < 3.35 ne supporte pas DROP CHECK in-place : recreate table.
    // Preserve toutes les colonnes (m35 + m39 source_subtype) et les donnees.
    db.pragma('foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE bacs_audit_action_items_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          document_id INTEGER NOT NULL REFERENCES afs(id) ON DELETE CASCADE,
          category TEXT NOT NULL
            CHECK (category IN
              ('meter_addition','meter_replacement','meter_connection',
               'system_addition','system_replacement','communication_upgrade',
               'bms_upgrade','bms_replacement','bms_addition',
               'data_retention_upgrade','training','documentation',
               'thermal_regulation','thermal_regulation_upgrade','other')),
          severity TEXT NOT NULL
            CHECK (severity IN ('blocking','major','minor')),
          r175_article TEXT,
          title TEXT NOT NULL,
          description TEXT,
          zone_id INTEGER REFERENCES zones(zone_id) ON DELETE SET NULL,
          equipment_id INTEGER REFERENCES equipments(equipment_id) ON DELETE SET NULL,
          source_table TEXT
            CHECK (source_table IS NULL OR source_table IN
              ('systems','meters','bms','thermal_regulation','devices')),
          source_id INTEGER,
          source_subtype TEXT,
          auto_generated INTEGER NOT NULL DEFAULT 1,
          commercial_notes TEXT,
          estimated_effort TEXT
            CHECK (estimated_effort IS NULL OR estimated_effort IN ('low','medium','high')),
          status TEXT NOT NULL DEFAULT 'open'
            CHECK (status IN ('open','quoted','in_progress','done','declined')),
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO bacs_audit_action_items_new
          SELECT id, document_id, category, severity, r175_article, title, description,
                 zone_id, equipment_id, source_table, source_id, source_subtype,
                 auto_generated, commercial_notes, estimated_effort, status, position,
                 created_at, updated_at
          FROM bacs_audit_action_items;
        DROP TABLE bacs_audit_action_items;
        ALTER TABLE bacs_audit_action_items_new RENAME TO bacs_audit_action_items;
        CREATE INDEX idx_bacs_actions_doc ON bacs_audit_action_items(document_id, severity, position);
        CREATE INDEX idx_bacs_actions_source ON bacs_audit_action_items(document_id, source_table, source_id, source_subtype);
      `);
      db.pragma('foreign_keys = ON');
      db.pragma('user_version = 44');
      db.exec('COMMIT');
      log.info("Migration 44 appliquee : source_table.CHECK accepte 'devices'");
    } catch (e) {
      db.exec('ROLLBACK');
      db.pragma('foreign_keys = ON');
      throw e;
    }
  }

  if (current < 45) {
    // Cf retour Kevin v2.5 : on distingue deux dimensions independantes
    //  - out_of_service : l'equipement physique est en panne / arrete
    //  - bms_integration_out_of_service : l'equipement fonctionne mais la
    //    GTB ne le voit pas (probleme de parametrage, com cassee, etc.)
    // Un equipement peut etre integre a la GTB mais avec une liaison HS.
    db.exec(`
      ALTER TABLE bacs_audit_system_devices ADD COLUMN bms_integration_out_of_service INTEGER DEFAULT 0;
      ALTER TABLE bacs_audit_meters ADD COLUMN bms_integration_out_of_service INTEGER DEFAULT 0;
    `);
    db.pragma('user_version = 45');
    log.info('Migration 45 appliquee : bms_integration_out_of_service sur devices + meters');
  }

  if (current < 46) {
    // Cf retour Kevin v2.7 : permettre d'ajouter des photos directement
    // depuis la ligne d'un device (et qu'elles apparaissent dans la liste
    // des fichiers du site / de l'audit). Ajout de bacs_audit_device_id
    // sur site_documents.
    db.exec(`
      ALTER TABLE site_documents ADD COLUMN bacs_audit_device_id INTEGER
        REFERENCES bacs_audit_system_devices(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_site_documents_device
        ON site_documents(bacs_audit_device_id);
    `);
    db.pragma('user_version = 46');
    log.info('Migration 46 appliquee : site_documents.bacs_audit_device_id');
  }

  if (current < 47) {
    // Cf retour Kevin v2.8 : pour chaque zone/systeme/compteur/GTB, pouvoir
    // ouvrir un editeur de notes riches (Tiptap HTML) ameliorables via
    // Claude, et y rattacher des photos optimisees. On ajoute :
    //   - notes_html sur zones, bacs_audit_systems, bacs_audit_meters,
    //     bacs_audit_bms (les colonnes 'notes' TEXT existantes restent
    //     pour compat / fallback), et bacs_audit_system_devices.
    //   - bacs_audit_zone_id et bacs_audit_meter_id sur site_documents
    //     pour rattacher photos a zones et compteurs.
    db.exec(`
      ALTER TABLE zones ADD COLUMN notes_html TEXT;
      ALTER TABLE bacs_audit_systems ADD COLUMN notes_html TEXT;
      ALTER TABLE bacs_audit_meters ADD COLUMN notes_html TEXT;
      ALTER TABLE bacs_audit_bms ADD COLUMN notes_html TEXT;
      ALTER TABLE bacs_audit_system_devices ADD COLUMN notes_html TEXT;

      ALTER TABLE site_documents ADD COLUMN bacs_audit_zone_id INTEGER
        REFERENCES zones(zone_id) ON DELETE SET NULL;
      ALTER TABLE site_documents ADD COLUMN bacs_audit_meter_id INTEGER
        REFERENCES bacs_audit_meters(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_site_documents_zone
        ON site_documents(bacs_audit_zone_id);
      CREATE INDEX IF NOT EXISTS idx_site_documents_meter
        ON site_documents(bacs_audit_meter_id);
    `);
    db.pragma('user_version = 47');
    log.info('Migration 47 appliquee : notes_html + zone/meter FK sur site_documents');
  }

  if (current < 48) {
    // Cf retour Kevin v2.9 : ajout d'un stepper dans la fiche audit BACS
    // (chaque etape est validee manuellement par l'auditeur). On stocke
    // l'etat de progression dans une colonne JSON dediee sur la table afs :
    //   { zones: { validated: true, validated_at: '2026-04-30T...' }, ... }
    db.exec(`
      ALTER TABLE afs ADD COLUMN audit_progress TEXT DEFAULT '{}';
    `);
    db.pragma('user_version = 48');
    log.info('Migration 48 appliquee : afs.audit_progress (stepper BACS)');
  }

  if (current < 49) {
    // Cf retour Kevin v2.10 : ajout d'une etape 12 'note de synthese' dans
    // l'audit BACS, redigee par l'auditeur (avec assistance Claude). Le HTML
    // est integre en tete du PDF d'audit. On stocke aussi la date de derniere
    // generation Claude pour audit log / debug.
    db.exec(`
      ALTER TABLE afs ADD COLUMN audit_synthesis_html TEXT;
      ALTER TABLE afs ADD COLUMN audit_synthesis_generated_at TEXT;
    `);
    db.pragma('user_version = 49');
    log.info('Migration 49 appliquee : afs.audit_synthesis_html (note synthese)');
  }

  if (current < 50) {
    // Cf retour Kevin v2.12 (apres relecture du decret R175 sur Notion) :
    // - audit_existing_af_status : suit le 1° de R175-5-1 (examen de
    //   l'analyse fonctionnelle existante a la 1ere inspection). Valeurs :
    //   'present' (un doc AF existe et est rattache) ou 'absent' (l'auditeur
    //   confirme qu'il n'y a pas d'AF).
    // - bacs_district_heating_substation_kw : pour les batiments raccordes a
    //   un reseau urbain, R175-2 stipule que la puissance a considerer est
    //   celle de la station d'echange et non des systemes en aval.
    // - bacs_audit_action_items.alternative_solutions_html : R175-5-1 4°
    //   demande explicitement la fourniture des 'autres solutions
    //   envisageables'. Champ par action pour les decrire.
    db.exec(`
      ALTER TABLE afs ADD COLUMN audit_existing_af_status TEXT;
      ALTER TABLE afs ADD COLUMN bacs_district_heating_substation_kw REAL;
      ALTER TABLE bacs_audit_action_items ADD COLUMN alternative_solutions_html TEXT;
    `);
    db.pragma('user_version = 50');
    log.info("Migration 50 appliquee : R175-5-1 (AF existante + alternatives + station d'echange)");
  }

  if (current < 51) {
    // Cf retour Kevin v2.13 : la clause de dispense R175-2 (TRI > 10 ans) est
    // explicitement de la responsabilite du proprietaire (ou son BET). On
    // ajoute une trace de l'etude TRI dans l'audit, cite le texte du decret
    // dans le PDF, mais Buildy ne calcule rien.
    db.exec(`
      ALTER TABLE afs ADD COLUMN bacs_roi_study_status TEXT;
      ALTER TABLE afs ADD COLUMN bacs_roi_study_html TEXT;
    `);
    db.pragma('user_version = 51');
    log.info('Migration 51 appliquee : afs.bacs_roi_study_* (clause de dispense R175-2)');
  }

  if (current < 52) {
    // Cf retour Kevin v2.15 :
    // - R175-3 dernier alinea : mise a disposition des donnees au gestionnaire
    //   et aux exploitants. Deux cases distinctes sur bacs_audit_bms.
    // - R175-6 : declencheur (PC > 21/07/2021 OU travaux generateur >
    //   21/07/2021) et exemption appareil bois. Date des travaux generateur
    //   sur afs ; flag exemption sur thermal_regulation par zone.
    db.exec(`
      ALTER TABLE bacs_audit_bms ADD COLUMN data_provision_to_manager INTEGER;
      ALTER TABLE bacs_audit_bms ADD COLUMN data_provision_to_operators INTEGER;
      ALTER TABLE bacs_audit_bms ADD COLUMN notes_data_provision TEXT;
      ALTER TABLE afs ADD COLUMN bacs_generator_works_date TEXT;
      ALTER TABLE bacs_audit_thermal_regulation ADD COLUMN generator_exempt_wood INTEGER DEFAULT 0;
    `);
    db.pragma('user_version = 52');
    log.info('Migration 52 appliquee : R175-3 mise a disposition donnees + R175-6 declencheur');
  }

  if (current < 53) {
    // Bug v2.18 : la contrainte CHECK sur site_documents.category n'incluait
    // pas 'photo' alors que le code JS l'attendait. Tous les uploads photo
    // failaient en 500 SQLITE_CONSTRAINT_CHECK. SQLite ne supporte pas le
    // modify CHECK direct → recreate table + copy data.
    db.exec(`
      CREATE TABLE site_documents_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id INTEGER NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        category TEXT NOT NULL CHECK (category IN
          ('plan','schema_electrique','schema_synoptique','analyse_fonctionnelle',
           'datasheet','manuel_utilisateur','rapport_essais','photo','autre')),
        filename TEXT NOT NULL,
        original_name TEXT,
        size_bytes INTEGER,
        mime_type TEXT,
        bacs_audit_system_id INTEGER REFERENCES bacs_audit_systems(id) ON DELETE SET NULL,
        bacs_audit_bms_document_id INTEGER REFERENCES bacs_audit_bms(document_id) ON DELETE SET NULL,
        bacs_audit_device_id INTEGER REFERENCES bacs_audit_system_devices(id) ON DELETE SET NULL,
        bacs_audit_zone_id INTEGER REFERENCES zones(zone_id) ON DELETE SET NULL,
        bacs_audit_meter_id INTEGER REFERENCES bacs_audit_meters(id) ON DELETE SET NULL,
        uploaded_by INTEGER REFERENCES users(id),
        uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO site_documents_new
        (id, site_id, title, category, filename, original_name, size_bytes, mime_type,
         bacs_audit_system_id, bacs_audit_bms_document_id, bacs_audit_device_id,
         bacs_audit_zone_id, bacs_audit_meter_id, uploaded_by, uploaded_at)
      SELECT id, site_id, title, category, filename, original_name, size_bytes, mime_type,
             bacs_audit_system_id, bacs_audit_bms_document_id, bacs_audit_device_id,
             bacs_audit_zone_id, bacs_audit_meter_id, uploaded_by, uploaded_at
      FROM site_documents;
      DROP TABLE site_documents;
      ALTER TABLE site_documents_new RENAME TO site_documents;
      CREATE INDEX IF NOT EXISTS idx_site_documents_site ON site_documents(site_id, category);
      CREATE INDEX IF NOT EXISTS idx_site_documents_device ON site_documents(bacs_audit_device_id);
      CREATE INDEX IF NOT EXISTS idx_site_documents_zone ON site_documents(bacs_audit_zone_id);
      CREATE INDEX IF NOT EXISTS idx_site_documents_meter ON site_documents(bacs_audit_meter_id);
    `);
    db.pragma('user_version = 53');
    log.info('Migration 53 appliquee : site_documents.category accepte photo');
  }

  if (current < 54) {
    // Cf retour Kevin v2.20 : ajout d'un flag 'non concerne' explicite par
    // systeme. Permet a l'auditeur de masquer les categories qui ne
    // s'appliquent pas au site (ex : pas de production photovoltaique du
    // tout) sans les supprimer de la DB. Distinct de present (declare
    // installe ou non).
    db.exec(`
      ALTER TABLE bacs_audit_systems ADD COLUMN not_concerned INTEGER DEFAULT 0;
    `);
    db.pragma('user_version = 54');
    log.info('Migration 54 appliquee : bacs_audit_systems.not_concerned');
  }

  if (current < 55) {
    // Retour Kevin v2.29 :
    // (1) flag 'wired' (cablage physique) sur devices et meters. Un
    // equipement communicant mais pas cable ne remonte pas dans la GTB
    // -> doit apparaitre comme HS liaison.
    // (2) communication_protocols TEXT JSON pour multi-protocoles
    // (laisse l'ancien communication_protocol single intact pour compat
    // descendante, mais l'UI utilisera l'array si rempli).
    // (3) bacs_audit_bms.provided_protocols pour les protocoles de mise
    // a disposition des points (BACnet, Modbus, OPC-UA, MQTT, API REST...).
    db.exec(`
      ALTER TABLE bacs_audit_system_devices ADD COLUMN wired INTEGER DEFAULT 0;
      ALTER TABLE bacs_audit_meters ADD COLUMN wired INTEGER DEFAULT 0;
      ALTER TABLE bacs_audit_system_devices ADD COLUMN communication_protocols TEXT;
      ALTER TABLE bacs_audit_meters ADD COLUMN communication_protocols TEXT;
      ALTER TABLE bacs_audit_bms ADD COLUMN provided_protocols TEXT;
    `);
    db.pragma('user_version = 55');
    log.info('Migration 55 appliquee : wired + multi-protocoles + bms.provided_protocols');
  }

  if (current < 56) {
    // Card 5 (R175-6) : permet de lier un device existant (saisi dans la
    // section 3) comme generateur thermique de la zone, plutot que de
    // ressaisir generator_type a la main.
    db.exec(`
      ALTER TABLE bacs_audit_thermal_regulation ADD COLUMN generator_device_id INTEGER
        REFERENCES bacs_audit_system_devices(id) ON DELETE SET NULL;
    `);
    db.pragma('user_version = 56');
    log.info('Migration 56 appliquee : thermal_regulation.generator_device_id');
  }

  if (current < 57) {
    // Card 5 (R175-6) : differenciation par categorie. Une zone peut avoir
    // une regulation auto en chauffage mais pas en clim. Ajout d'un champ
    // 'category' (heating/cooling) et changement de la cle UNIQUE de
    // (document_id, zone_id) a (document_id, zone_id, category).
    // Rebuild de la table car SQLite ne supporte pas DROP CONSTRAINT.
    db.exec(`
      ALTER TABLE bacs_audit_thermal_regulation ADD COLUMN category TEXT;
      UPDATE bacs_audit_thermal_regulation SET category = 'heating' WHERE category IS NULL;

      CREATE TABLE bacs_audit_thermal_regulation_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL REFERENCES afs(id) ON DELETE CASCADE,
        zone_id INTEGER NOT NULL REFERENCES zones(zone_id) ON DELETE CASCADE,
        category TEXT NOT NULL CHECK (category IN ('heating','cooling')),
        has_automatic_regulation INTEGER NOT NULL DEFAULT 0,
        regulation_type TEXT
          CHECK (regulation_type IS NULL OR regulation_type IN
            ('per_room','per_zone','central_only','none')),
        generator_type TEXT
          CHECK (generator_type IS NULL OR generator_type IN
            ('gas','electric','heat_pump','wood_appliance','district_heating','other')),
        generator_age_years INTEGER,
        generator_exempt_wood INTEGER DEFAULT 0,
        generator_device_id INTEGER REFERENCES bacs_audit_system_devices(id) ON DELETE SET NULL,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(document_id, zone_id, category)
      );

      INSERT INTO bacs_audit_thermal_regulation_new
        (id, document_id, zone_id, category, has_automatic_regulation,
         regulation_type, generator_type, generator_age_years,
         generator_exempt_wood, generator_device_id, notes,
         created_at, updated_at)
      SELECT
        id, document_id, zone_id, COALESCE(category, 'heating'),
        has_automatic_regulation, regulation_type, generator_type,
        generator_age_years, generator_exempt_wood, generator_device_id, notes,
        created_at, updated_at
      FROM bacs_audit_thermal_regulation;

      DROP TABLE bacs_audit_thermal_regulation;
      ALTER TABLE bacs_audit_thermal_regulation_new RENAME TO bacs_audit_thermal_regulation;
      CREATE INDEX idx_bacs_thermal_doc ON bacs_audit_thermal_regulation(document_id);
    `);
    db.pragma('user_version = 57');
    log.info('Migration 57 appliquee : thermal_regulation.category (heating/cooling) + UNIQUE recompose');
  }

  if (current < 58) {
    // Card 6 (GTB) : composants matériels (passerelles, automates,
    // contrôleurs, modules IO, routeurs, etc.) qui constituent
    // l'architecture matérielle de la GTB. Permet à l'auditeur de
    // relever chaque équipement réseau/automatisme avec ses protocoles
    // exposés et sa localisation.
    db.exec(`
      CREATE TABLE bacs_audit_bms_components (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL REFERENCES afs(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        component_type TEXT
          CHECK (component_type IS NULL OR component_type IN
            ('gateway','plc','controller','io_module','router','switch','server','other')),
        brand TEXT,
        model TEXT,
        location TEXT,
        ip_address TEXT,
        protocols TEXT,
        firmware_version TEXT,
        notes TEXT,
        notes_html TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_bacs_bms_components_doc ON bacs_audit_bms_components(document_id, position);
    `);
    db.pragma('user_version = 58');
    log.info('Migration 58 appliquee : bacs_audit_bms_components');
  }

  if (current < 59) {
    // Ajout du kind 'site_audit' (audit site sans contrainte décret R175,
    // pour préparation devis Buildy). Modifie la contrainte CHECK sur
    // afs.kind via writable_schema. better-sqlite3 nécessite unsafeMode
    // pour autoriser l'écriture dans sqlite_master.
    db.unsafeMode(true);
    try {
      db.pragma('writable_schema = 1');
      db.prepare(
        "UPDATE sqlite_master SET sql = REPLACE(sql, ?, ?) " +
        "WHERE type = 'table' AND name = 'afs'"
      ).run(
        "CHECK (kind IN ('af','bacs_audit','brochure'))",
        "CHECK (kind IN ('af','bacs_audit','site_audit','brochure'))",
      );
      db.pragma('writable_schema = 0');
    } finally {
      db.unsafeMode(false);
    }
    db.pragma('user_version = 59');
    log.info('Migration 59 appliquee : afs.kind CHECK étendu (site_audit)');
  }

  if (current < 60) {
    // Table de stockage des prompts IA editables depuis l'UI.
    // Cle = identifiant logique (ex: 'library', 'synthesis', 'alternatives').
    // Si une ligne existe, elle prevaut sur la valeur en dur dans le code ;
    // sinon, le code retombe sur sa constante par defaut.
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_prompts (
        key TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS ai_prompt_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        label TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_ai_prompt_versions_key ON ai_prompt_versions(key, created_at DESC);
    `);
    db.pragma('user_version = 60');
    log.info('Migration 60 appliquee : ai_prompts + ai_prompt_versions');
  }

  if (current < 61) {
    // ── R175 coverage gaps (Partie A du plan virtual-karp) ──
    // 1. Nouvelle table bacs_audit_inspections : R175-5-1 (inspection
    //    periodique par tiers, conservation 10 ans). Permet de tracer la
    //    derniere inspection officielle, ses anomalies et la date prevue
    //    pour la prochaine. Distincte de l'audit Buildy (qui est interne).
    db.exec(`
      CREATE TABLE IF NOT EXISTS bacs_audit_inspections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL REFERENCES afs(id) ON DELETE CASCADE,
        last_inspection_date TEXT,
        last_inspection_inspector TEXT,
        last_inspection_report_filename TEXT,
        last_inspection_anomalies_html TEXT,
        last_inspection_recommendations_html TEXT,
        next_inspection_due_date TEXT,
        retained_until_date TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_bacs_inspections_doc ON bacs_audit_inspections(document_id);
    `);

    // 2. bacs_audit_bms : champs detail R175-3 §1/§2, mise a disposition
    //    des donnees, R175-4, R175-5.
    db.exec(`
      ALTER TABLE bacs_audit_bms ADD COLUMN r175_3_p1_archival_format TEXT;
      ALTER TABLE bacs_audit_bms ADD COLUMN r175_3_p1_retention_verified INTEGER;
      ALTER TABLE bacs_audit_bms ADD COLUMN r175_3_p2_anomaly_rules_html TEXT;
      ALTER TABLE bacs_audit_bms ADD COLUMN data_provision_frequency TEXT;
      ALTER TABLE bacs_audit_bms ADD COLUMN data_provision_format TEXT;
      ALTER TABLE bacs_audit_bms ADD COLUMN maintenance_periodicity TEXT;
      ALTER TABLE bacs_audit_bms ADD COLUMN maintenance_responsible TEXT;
      ALTER TABLE bacs_audit_bms ADD COLUMN operator_training_topics TEXT;
      ALTER TABLE bacs_audit_bms ADD COLUMN operator_training_provider TEXT;
    `);

    // 3. bacs_audit_thermal_regulation : detail R175-6 (sonde, thermostat,
    //    robinets thermostatiques).
    db.exec(`
      ALTER TABLE bacs_audit_thermal_regulation ADD COLUMN sensor_position TEXT;
      ALTER TABLE bacs_audit_thermal_regulation ADD COLUMN thermostat_type TEXT;
      ALTER TABLE bacs_audit_thermal_regulation ADD COLUMN has_thermostatic_valves INTEGER DEFAULT 0;
    `);

    db.pragma('user_version = 61');
    log.info('Migration 61 appliquee : R175-5-1 inspections + champs detail BMS/thermal (gaps couverture)');
  }

  if (current < 62) {
    // Bulk upload terrain (B2 du plan virtual-karp) : on conserve l'horodatage
    // EXIF de la prise de vue pour pouvoir trier les photos chronologiquement
    // dans l'UI de restitution et suggerer un mapping section/photo.
    db.exec(`ALTER TABLE site_documents ADD COLUMN taken_at TEXT;`);
    db.pragma('user_version = 62');
    log.info('Migration 62 appliquee : site_documents.taken_at (EXIF DateTimeOriginal)');
  }

  if (current < 63) {
    // B3 du plan virtual-karp : import transcript Plaud Pro + suggestions Claude.
    // - bacs_audit_transcripts : fichier (.txt/.docx) source + meta
    // - bacs_audit_suggestions : suggestions Claude (1 ligne par champ
    //   suggere). statut : pending/applied/rejected. Permet la validation
    //   manuelle de l'auditeur (diff inline) avant ecriture en DB.
    db.exec(`
      CREATE TABLE IF NOT EXISTS bacs_audit_transcripts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL REFERENCES afs(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        original_name TEXT,
        size_bytes INTEGER,
        text_content TEXT,
        uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        suggestions_generated_at TEXT,
        suggestions_usage_input_tokens INTEGER,
        suggestions_usage_output_tokens INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_bacs_transcripts_doc ON bacs_audit_transcripts(document_id);

      CREATE TABLE IF NOT EXISTS bacs_audit_suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transcript_id INTEGER NOT NULL REFERENCES bacs_audit_transcripts(id) ON DELETE CASCADE,
        document_id INTEGER NOT NULL REFERENCES afs(id) ON DELETE CASCADE,
        target_kind TEXT NOT NULL,
        target_id INTEGER,
        target_ref TEXT,
        field_name TEXT NOT NULL,
        suggested_value TEXT,
        confidence REAL,
        source_quote TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'applied', 'rejected')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        decided_at TEXT,
        decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bacs_suggestions_doc ON bacs_audit_suggestions(document_id, status);
      CREATE INDEX IF NOT EXISTS idx_bacs_suggestions_transcript ON bacs_audit_suggestions(transcript_id);
    `);
    db.pragma('user_version = 63');
    log.info('Migration 63 appliquee : bacs_audit_transcripts + bacs_audit_suggestions');
  }

  if (current < 64) {
    // Etend bacs_audit_action_items.source_table pour accepter
    // 'inspections' (R175-5-1). Sans cela, le generateur d'actions
    // correctives plante en SQLITE_CONSTRAINT_CHECK quand il essaie
    // d'ajouter "Programmer une inspection" ou "Echeance depassee".
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN TRANSACTION');
    // CHECK sur category retire (les donnees prod contiennent des valeurs
    // historiques system_addition / meter_addition / meter_connection /
    // communication_upgrade / data_retention_upgrade qui n'etaient plus
    // dans la whitelist mais sont legitimes). Le code applicatif enforce.
    db.exec(`
      CREATE TABLE bacs_audit_action_items_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL REFERENCES afs(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        severity TEXT NOT NULL
          CHECK (severity IN ('blocking','major','minor')),
        r175_article TEXT,
        title TEXT NOT NULL,
        description TEXT,
        zone_id INTEGER REFERENCES zones(zone_id) ON DELETE SET NULL,
        equipment_id INTEGER REFERENCES equipments(equipment_id) ON DELETE SET NULL,
        source_table TEXT
          CHECK (source_table IS NULL OR source_table IN
            ('systems','meters','bms','thermal_regulation','devices','inspections')),
        source_id INTEGER,
        source_subtype TEXT,
        auto_generated INTEGER NOT NULL DEFAULT 1,
        commercial_notes TEXT,
        estimated_effort TEXT
          CHECK (estimated_effort IS NULL OR estimated_effort IN ('low','medium','high')),
        status TEXT NOT NULL DEFAULT 'open'
          CHECK (status IN ('open','quoted','in_progress','done','declined')),
        position INTEGER NOT NULL DEFAULT 0,
        alternative_solutions_html TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO bacs_audit_action_items_new
        SELECT id, document_id, category, severity, r175_article, title, description,
               zone_id, equipment_id, source_table, source_id, source_subtype,
               auto_generated, commercial_notes, estimated_effort, status, position,
               alternative_solutions_html, created_at, updated_at
        FROM bacs_audit_action_items;
      DROP TABLE bacs_audit_action_items;
      ALTER TABLE bacs_audit_action_items_new RENAME TO bacs_audit_action_items;
      CREATE INDEX idx_bacs_actions_doc ON bacs_audit_action_items(document_id, severity, position);
      CREATE INDEX idx_bacs_actions_source ON bacs_audit_action_items(document_id, source_table, source_id, source_subtype);
    `);
    db.exec('COMMIT');
    db.exec('PRAGMA foreign_keys = ON');
    db.pragma('user_version = 64');
    log.info("Migration 64 appliquee : source_table.CHECK accepte 'inspections' (R175-5-1)");
  }

  if (current < 65) {
    // Lot B4 : boilerplate des PDFs (methodologie / disclaimers / autres
    // textes recurrents) sortis du code et editables via une page admin.
    // Permet de modifier ces textes sans redeployer.
    // - kind : 'methodology' (Annexe B audit BACS) | 'disclaimer' (Annexe D)
    // - position : ordre d'affichage dans l'annexe
    // - title : titre de la section (peut etre null pour les disclaimers
    //   qui sont une liste numerotee sans titres)
    // - body_html : contenu rich-text (HTML sanitize cote backend)
    db.exec(`
      CREATE TABLE pdf_boilerplate (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL
          CHECK (kind IN ('methodology', 'disclaimer')),
        position INTEGER NOT NULL DEFAULT 0,
        title TEXT,
        body_html TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_pdf_boilerplate_kind ON pdf_boilerplate(kind, is_active, position);
    `);
    // Seed initial : migre les contenus actuels des fichiers .js vers la DB.
    // Apres cette migration, les fichiers .js ne sont plus la source de
    // verite — ils peuvent etre supprimes plus tard, ou conserves comme
    // fallback de seed pour reset.
    try {
      const methodology = require('./lib/bacs-audit-methodology');
      const disclaimers = require('./lib/bacs-audit-disclaimers');
      const insertMeth = db.prepare(`INSERT INTO pdf_boilerplate
        (kind, position, title, body_html) VALUES ('methodology', ?, ?, ?)`);
      methodology.forEach((m, i) => insertMeth.run(i, m.title, m.body));
      const insertDisc = db.prepare(`INSERT INTO pdf_boilerplate
        (kind, position, title, body_html) VALUES ('disclaimer', ?, NULL, ?)`);
      disclaimers.forEach((d, i) => insertDisc.run(i, d));
    } catch (err) {
      log.warn(`Seed initial pdf_boilerplate KO : ${err.message}`);
    }
    db.pragma('user_version = 65');
    log.info('Migration 65 appliquee : pdf_boilerplate (methodologie + disclaimers en DB)');
  }

  if (current < 66) {
    // Lot A2 : Brochure commerciale + Catalogue d'offres.
    // Structure unifiee : meme outil de composition pour les 2 variantes,
    // distinguees par afs.layout_template ('commercial-brochure' par
    // defaut, 'offering-catalog' pour la brochure annuelle type
    // "Offres Buildy 2026").
    //
    // brochure_items : liste plate d'items composant la brochure. Chaque
    // item peut etre :
    //   - 'feature' : item de bibliotheque rédigée (presentation Buildy,
    //                 niveau service E/S/P, etc.)
    //   - 'equipment_template' : reference a une fiche equipment_templates
    //   - 'hyperveez_page' : reference a HYPERVEEZ_PAGES (slug)
    //   - 'cgv' : extrait des CGV
    //   - 'custom' : item ad-hoc redige uniquement pour cette brochure
    //
    // override_title et override_html permettent de personnaliser un item
    // pour ce client specifique sans modifier la bibliotheque (ex: "Voici
    // notre offre pour le projet Auchan Mainvilliers").
    db.exec(`
      ALTER TABLE afs ADD COLUMN layout_template TEXT DEFAULT NULL;

      CREATE TABLE brochure_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brochure_id INTEGER NOT NULL REFERENCES afs(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        item_kind TEXT NOT NULL
          CHECK (item_kind IN ('feature', 'equipment_template',
                               'hyperveez_page', 'cgv', 'custom')),
        source_id INTEGER,         -- pointeur (equipment_templates.id, etc.)
        source_slug TEXT,          -- pour hyperveez_page (slug texte)
        title TEXT,                -- titre par defaut (peut etre override)
        body_html TEXT,            -- contenu par defaut
        override_title TEXT,       -- override specifique a cette brochure
        override_html TEXT,        -- idem pour le body
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_brochure_items_brochure ON brochure_items(brochure_id, position);

      -- brochure_library_items : catalogue partage de tous les items
      -- reutilisables (presentations Buildy, niveaux d'offre, etc.)
      -- maintenu une fois centrale, utilise dans toutes les brochures.
      CREATE TABLE brochure_library_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        item_kind TEXT NOT NULL
          CHECK (item_kind IN ('feature', 'offering_level', 'cgv', 'company')),
        service_level TEXT
          CHECK (service_level IS NULL OR service_level IN ('E', 'S', 'P', 'ESP')),
        title TEXT NOT NULL,
        summary TEXT,
        body_html TEXT NOT NULL,
        tags TEXT,                 -- CSV libre pour filtrage UI
        position INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_brochure_library_kind ON brochure_library_items(item_kind, is_active, position);
    `);
    // Seed minimal de la bibliotheque : 4 items de demarrage.
    // L'admin pourra etoffer via une page dediee plus tard.
    const seedLib = db.prepare(`INSERT INTO brochure_library_items
      (slug, item_kind, service_level, title, summary, body_html, position)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    seedLib.run('qui-est-buildy', 'company', null,
      'Qui est Buildy ?',
      'Présentation de la société, de la mission, et de l\'équipe.',
      '<h2>Qui est Buildy ?</h2><p>Buildy est l\'éditeur d\'une plateforme de supervision et hypervision GTB agnostique multi-sites. Nous intégrons les systèmes existants sans imposer un fournisseur unique.</p><p><em>À enrichir depuis l\'admin Boilerplate.</em></p>',
      0);
    seedLib.run('niveau-essentiel', 'offering_level', 'E',
      'Niveau Essentiel',
      'Le socle : monitoring + alarmes de base + tableaux de bord.',
      '<h2>Niveau Essentiel</h2><p>Le socle de la supervision Buildy : monitoring continu, alarmes, tableaux de bord énergétiques, dashboards consolidés multi-sites.</p>',
      1);
    seedLib.run('niveau-smart', 'offering_level', 'S',
      'Niveau Smart',
      'Essentiel + commande à distance + planifications + détection de dérives.',
      '<h2>Niveau Smart</h2><p>L\'Essentiel enrichi des fonctions de pilotage : commandes à distance, programmation horaire, scénarios, détection automatique des dérives énergétiques (R175-3 §2).</p>',
      2);
    seedLib.run('niveau-premium', 'offering_level', 'P',
      'Niveau Premium',
      'Smart + IA prédictive + rapports automatiques + accompagnement.',
      '<h2>Niveau Premium</h2><p>Tous les avantages Smart + IA prédictive (anticipation des défaillances), rapports énergétiques automatiques, support dédié et accompagnement à la mise en conformité R175.</p>',
      3);
    seedLib.run('cgv-2026', 'cgv', null,
      'Conditions générales de vente — 2026',
      'Conditions contractuelles applicables à toute prestation Buildy.',
      '<h2>Conditions générales de vente</h2><p><em>Texte des CGV à insérer ici — voir docs/cgv-buildy-2026.pdf.</em></p>',
      99);
    db.pragma('user_version = 66');
    log.info('Migration 66 appliquee : brochure_items + brochure_library_items + afs.layout_template');
  }

  if (current < 67) {
    // PDF "Offres Buildy" entierement editable depuis l'admin :
    // - offering_levels : 3 niveaux (E/S/P) avec nom, tagline, mise en
    //   valeur (decoy) configurables. Slug fixe (matche les colonnes
    //   avail_e/s/p de section_templates).
    // - pdf_boilerplate : on ajoute les kinds 'offerings_cover_promise',
    //   'offerings_cover_subtitle', 'offerings_cta_title',
    //   'offerings_cta_sub', 'offerings_cta_contact' pour les textes
    //   editables en cover et footer du PDF offres. Necessite de
    //   recreer le CHECK de la table pdf_boilerplate (SQLite ne permet
    //   pas le ALTER de CHECK).
    db.exec(`
      CREATE TABLE offering_levels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE
          CHECK (slug IN ('E', 'S', 'P')),
        name TEXT NOT NULL,
        tagline TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        is_highlighted INTEGER NOT NULL DEFAULT 0,
        highlight_label TEXT,
        color_hex TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
    `);
    // Seed : valeurs courantes hardcodees du template
    const seedLevel = db.prepare(`INSERT INTO offering_levels
      (slug, name, tagline, position, is_highlighted, highlight_label, color_hex)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    seedLevel.run('E', 'Essentiel', 'Démarrer simple', 0, 0, null, '#64748b');
    seedLevel.run('S', 'Smart', 'Pilotez et anticipez', 1, 0, null, '#4f46e5');
    seedLevel.run('P', 'Premium', 'L\'intégrale', 2, 1, '★ Le plus choisi', '#7c3aed');

    // Recreate pdf_boilerplate avec CHECK etendu
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN TRANSACTION');
    db.exec(`
      CREATE TABLE pdf_boilerplate_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL
          CHECK (kind IN ('methodology', 'disclaimer',
                          'offerings_cover_promise',
                          'offerings_cover_subtitle',
                          'offerings_cta_title',
                          'offerings_cta_sub',
                          'offerings_cta_contact')),
        position INTEGER NOT NULL DEFAULT 0,
        title TEXT,
        body_html TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
      INSERT INTO pdf_boilerplate_new
        SELECT id, kind, position, title, body_html, is_active,
               created_at, updated_at, updated_by
        FROM pdf_boilerplate;
      DROP TABLE pdf_boilerplate;
      ALTER TABLE pdf_boilerplate_new RENAME TO pdf_boilerplate;
      CREATE INDEX idx_pdf_boilerplate_kind ON pdf_boilerplate(kind, is_active, position);
    `);
    // Seed des textes cover/CTA des offres avec les valeurs courantes
    const seedBoiler = db.prepare(`INSERT INTO pdf_boilerplate
      (kind, position, title, body_html) VALUES (?, 0, NULL, ?)`);
    seedBoiler.run('offerings_cover_promise',
      `<p>Réduisez vos consommations. Anticipez les dérives.<br/>Conformez-vous au décret BACS — sans changer toute votre GTB.</p>`);
    seedBoiler.run('offerings_cover_subtitle',
      `<p>Plateforme de supervision et hypervision GTB agnostique multi-sites. Trois niveaux de service. Un seul projet : votre efficacité énergétique.</p>`);
    seedBoiler.run('offerings_cta_title', `<p>Prêt à démarrer ?</p>`);
    seedBoiler.run('offerings_cta_sub', `<p>Notre équipe revient vers vous sous 48 h ouvrées.</p>`);
    seedBoiler.run('offerings_cta_contact', `<p>contact@buildy.fr · 01 23 45 67 89</p>`);
    db.exec('COMMIT');
    db.exec('PRAGMA foreign_keys = ON');
    db.pragma('user_version = 67');
    log.info('Migration 67 appliquee : offering_levels + pdf_boilerplate.kind etendu');
  }

  if (current < 68) {
    // Re-seed des textes methodology + disclaimer avec les versions
    // accentuees des fichiers .js (les valeurs initiales seedees en
    // migration 65 etaient sans accents). On respecte les editions
    // utilisateur : on remplace UNIQUEMENT les rows non touchees
    // (created_at = updated_at, c.a.d. jamais editees via l'admin).
    try {
      const methodology = require('./lib/bacs-audit-methodology');
      const disclaimers = require('./lib/bacs-audit-disclaimers');
      // Pour les rows methodology jamais editees, supprime puis re-insere
      // dans le meme ordre. Conserve les editions utilisateur.
      db.exec(`
        DELETE FROM pdf_boilerplate
        WHERE kind IN ('methodology', 'disclaimer')
          AND created_at = updated_at
      `);
      // Re-insert les rows manquantes (apres delete) seulement si la table
      // est vide pour ce kind (eviter de creer des duplicats si l'utilisateur
      // a deja toutes les rows editees).
      const countMeth = db.prepare(
        `SELECT COUNT(*) AS c FROM pdf_boilerplate WHERE kind = 'methodology'`
      ).get().c;
      if (countMeth === 0) {
        const insertMeth = db.prepare(`INSERT INTO pdf_boilerplate
          (kind, position, title, body_html) VALUES ('methodology', ?, ?, ?)`);
        methodology.forEach((m, i) => insertMeth.run(i, m.title, m.body));
      }
      const countDisc = db.prepare(
        `SELECT COUNT(*) AS c FROM pdf_boilerplate WHERE kind = 'disclaimer'`
      ).get().c;
      if (countDisc === 0) {
        const insertDisc = db.prepare(`INSERT INTO pdf_boilerplate
          (kind, position, title, body_html) VALUES ('disclaimer', ?, NULL, ?)`);
        disclaimers.forEach((d, i) => insertDisc.run(i, d));
      }
    } catch (err) {
      log.warn(`Re-seed pdf_boilerplate accents KO : ${err.message}`);
    }
    db.pragma('user_version = 68');
    log.info('Migration 68 appliquee : re-seed methodology + disclaimers avec accents');
  }

  if (current < 69) {
    // Lot — Mode "demandee par MOA" : symetrique de opted_out_by_moa.
    // Permet de marquer une fonctionnalite paid_option comme explicitement
    // demandee par le maitre d'ouvrage. Sert ensuite a deduire le niveau
    // d'offre minimum a souscrire (chapitre engagement contractuel).
    // Exclusivite logique : une section demandee ne peut pas etre refusee
    // (geree cote API/UI, contrainte applicative).
    try { db.exec('ALTER TABLE sections ADD COLUMN demanded_by_moa INTEGER NOT NULL DEFAULT 0'); }
    catch { /* deja la */ }

    // Seed du nouveau chapitre 13 "Engagement contractuel et pilotage de
    // l'offre apres livraison". Inseré apres la synthese (chapitre 12).
    const slug = 'engagement-contractuel';
    const exists = db.prepare('SELECT id FROM section_templates WHERE slug = ?').get(slug);
    if (!exists) {
      const bodyHtml = `<p>Cette analyse fonctionnelle engage le maître d'ouvrage et Buildy sur un périmètre fonctionnel précis. Les fonctionnalités cochées comme « demandées par le MOA » dans les chapitres précédents définissent le niveau d'offre minimum à souscrire (Essentiel, Smart ou Premium) ainsi que les éventuelles options associées.</p>

<h3>Engagement avant livraison du chantier</h3>
<p>L'offre cible recommandée est précisée dans la synthèse en tête de ce chapitre, calculée à partir des fonctionnalités demandées. Le contrat correspondant doit être signé en avenant au présent document, afin que la plateforme Buildy soit pleinement opérationnelle au moment de la livraison du bâtiment. Toute fonctionnalité demandée et identifiée comme option payante doit être incluse dans cet avenant.</p>

<h3>Pilotage de l'offre après livraison</h3>
<p>Une fois le bâtiment livré, l'exploitant ou le locataire reste libre de poursuivre ou non les engagements pris à la conception. Buildy adresse un devis de renouvellement environ un mois avant chaque échéance contractuelle. Le client peut accepter, modifier ou refuser ce renouvellement.</p>
<p>En cas de non-renouvellement de l'ensemble des contrats, la passerelle bascule automatiquement sur la licence <strong>Essentiel</strong>. Les fonctionnalités correspondant aux niveaux supérieurs ou aux options sont alors désactivées, sans interruption du service supervisé localement par la passerelle.</p>

<h3>Connectivité réseau</h3>
<p>Si le client renonce à un contrat <strong>Premium</strong> ou à l'option <strong>connectivité 4G</strong>, il devient responsable de la fourniture de la connectivité Internet de la passerelle (lien filaire ou Wi-Fi mis à disposition sur le réseau de l'exploitant). Sans connectivité, seules les fonctions locales restent actives ; la supervision distante, l'hypervision multi-sites et les rapports cloud sont indisponibles.</p>

<h3>Options de service</h3>
<p>Les options telles que <strong>Sérénité</strong> (assistance, mises à jour pilotées, garantie étendue) sont indépendantes du niveau d'offre choisi. Elles peuvent être ajoutées, conservées ou résiliées séparément, lors du renouvellement annuel.</p>`;

      db.prepare(`
        INSERT INTO section_templates
          (slug, number, title, kind, body_html, is_functionality, position)
        VALUES (?, '13', 'Engagement contractuel', 'standard', ?, 0, ?)
      `).run(slug, bodyHtml, 1300);
    } else {
      // Si le slug existe deja (re-run ou migration partielle), on rafraichit
      // le body uniquement si le row n'a jamais ete edite (created_at == updated_at).
      db.prepare(`
        UPDATE section_templates
           SET title = 'Engagement contractuel',
               number = '13',
               kind = 'standard',
               position = 1300
         WHERE slug = ?
      `).run(slug);
    }

    db.pragma('user_version = 69');
    log.info('Migration 69 appliquee : sections.demanded_by_moa + chapitre 13 Engagement contractuel');
  }

  if (current < 70) {
    // Lot — Deduplication "Engagement contractuel".
    // La migration 69 inserait le template avec slug = 'engagement-contractuel'
    // mais sectionTemplateSlug(plan_af_node) renvoie node.number = '13'. Le
    // seeder boot creait donc un 2e template (slug='13'), et seedAfStructure
    // generait 2 sections par nouvelle AF.
    // Fix : on garde le row le plus ancien (avec notre body_html seede),
    // on lui force le slug = '13', et on supprime tous les autres rows en
    // doublon ainsi que les sections orphelines des AFs existantes.
    try {
      const dupeTpls = db.prepare(`
        SELECT id, slug, body_html, position, current_version
        FROM section_templates
        WHERE title = 'Engagement contractuel'
        ORDER BY (CASE WHEN body_html IS NOT NULL AND body_html != '' THEN 0 ELSE 1 END), id
      `).all();
      if (dupeTpls.length > 0) {
        const keep = dupeTpls[0];
        const toDelete = dupeTpls.slice(1);
        // Renomme le slug du keep en '13' (en evitant collision avec un
        // autre template qui aurait deja '13' mais titre different).
        const otherWithSlug13 = db.prepare(`
          SELECT id FROM section_templates WHERE slug = '13' AND id != ?
        `).get(keep.id);
        if (!otherWithSlug13) {
          db.prepare(`UPDATE section_templates SET slug = '13', number = '13', position = 1300 WHERE id = ?`).run(keep.id);
        }
        // Supprime les sections orphelines des AFs (celles qui pointaient vers
        // un template doublon) puis les templates eux-memes.
        for (const dup of toDelete) {
          const orphans = db.prepare(`
            SELECT id FROM sections WHERE section_template_id = ?
          `).all(dup.id);
          for (const o of orphans) {
            db.prepare(`DELETE FROM sections WHERE id = ?`).run(o.id);
          }
          db.prepare(`DELETE FROM section_templates WHERE id = ?`).run(dup.id);
        }
        if (toDelete.length > 0) {
          log.info(`Migration 70 : ${toDelete.length} template(s) "Engagement contractuel" en doublon supprimes + sections liees nettoyees`);
        }
      }
      // Cas edge : AF qui a 2 sections "Engagement contractuel" mais toutes les
      // 2 pointent vers le meme template (cree avant la deduplication des
      // templates) → on supprime la plus jeune.
      const dupeSections = db.prepare(`
        SELECT af_id, COUNT(*) AS c, MIN(id) AS keep_id, GROUP_CONCAT(id) AS ids
        FROM sections
        WHERE title = 'Engagement contractuel'
        GROUP BY af_id
        HAVING c > 1
      `).all();
      let deletedSections = 0;
      for (const dup of dupeSections) {
        const allIds = dup.ids.split(',').map(Number);
        const toRemove = allIds.filter(id => id !== dup.keep_id);
        for (const id of toRemove) {
          db.prepare('DELETE FROM sections WHERE id = ?').run(id);
          deletedSections++;
        }
      }
      if (deletedSections > 0) {
        log.info(`Migration 70 : ${deletedSections} section(s) "Engagement contractuel" en doublon supprimees`);
      }
    } catch (err) {
      log.warn(`Migration 70 (dedupe Engagement contractuel) KO : ${err.message}`);
    }
    db.pragma('user_version = 70');
    log.info('Migration 70 appliquee : deduplication template + sections "Engagement contractuel"');
  }

  if (current < 71) {
    // Aligne offering_levels.color_hex sur les couleurs du ServiceLevelBadge
    // de l'UI (gray / amber / emerald) pour coherence visuelle entre le
    // tableau des offres PDF, l'arbre des sections, et la page de config.
    // Ne touche pas les rows que l'utilisateur a edite (heuristique : color
    // encore une des valeurs seedees a l'origine en migration 67).
    try {
      db.prepare(`UPDATE offering_levels SET color_hex = '#6b7280' WHERE slug = 'E' AND color_hex = '#64748b'`).run();
      db.prepare(`UPDATE offering_levels SET color_hex = '#f59e0b' WHERE slug = 'S' AND color_hex = '#4f46e5'`).run();
      db.prepare(`UPDATE offering_levels SET color_hex = '#10b981' WHERE slug = 'P' AND color_hex = '#7c3aed'`).run();
    } catch (err) {
      log.warn(`Migration 71 (alignement color_hex) KO : ${err.message}`);
    }
    db.pragma('user_version = 71');
    log.info('Migration 71 appliquee : color_hex offering_levels aligne sur ServiceLevelBadge');
  }

  if (current < 72) {
    // Deduplication globale section_templates + sections.
    // Cause : 2 strategies de generation de slug coexistent —
    //   (a) seedSectionTemplatesOnBoot utilise node.number (PLAN_AF)
    //   (b) creation manuelle via UI utilise slugify(title)
    // → pour une meme entree (CTA, Engagement contractuel...), on peut avoir
    // 2 templates et donc seedAfStructure cree 2 sections par AF.
    //
    // Algorithme :
    //   1. Pour chaque title dupliquee : garder le template avec un number
    //      defini (canonical PLAN_AF) > avec body_html non vide > id le plus
    //      petit. Retargeter sections + enfants vers le keep, supprimer
    //      les autres.
    //   2. Forcer slug='13' pour Engagement contractuel (sinon le seeder
    //      boot recreera un template slug='13' a chaque demarrage).
    //   3. Pour chaque section avec section_template_id = keep MAIS apparait
    //      en plusieurs exemplaires sous le meme parent : garder la plus
    //      ancienne, supprimer les enfants orphelins/vides.
    try {
      const dupes = db.prepare(`
        SELECT title, GROUP_CONCAT(id) ids
        FROM section_templates
        GROUP BY title
        HAVING COUNT(*) > 1
      `).all();
      let tplsRemoved = 0;
      let sectionsRetargeted = 0;
      for (const d of dupes) {
        const ids = d.ids.split(',').map(Number);
        const rows = db.prepare(`
          SELECT id, slug, number, body_html
          FROM section_templates WHERE id IN (${ids.join(',')})
        `).all();
        rows.sort((a, b) => {
          const aNum = a.number ? 0 : 1;
          const bNum = b.number ? 0 : 1;
          if (aNum !== bNum) return aNum - bNum;
          const aBody = (a.body_html && a.body_html.length > 10) ? 0 : 1;
          const bBody = (b.body_html && b.body_html.length > 10) ? 0 : 1;
          if (aBody !== bBody) return aBody - bBody;
          return a.id - b.id;
        });
        const keep = rows[0];
        for (const dup of rows.slice(1)) {
          const r = db.prepare(`UPDATE sections SET section_template_id = ? WHERE section_template_id = ?`)
            .run(keep.id, dup.id);
          sectionsRetargeted += r.changes;
          db.prepare(`UPDATE section_templates SET parent_template_id = ? WHERE parent_template_id = ?`)
            .run(keep.id, dup.id);
          db.prepare(`DELETE FROM section_templates WHERE id = ?`).run(dup.id);
          tplsRemoved++;
        }
      }
      if (tplsRemoved > 0) {
        log.info(`Migration 72 : ${tplsRemoved} template(s) en doublon supprimes, ${sectionsRetargeted} section(s) re-rattachee(s) au keep`);
      }
      // Force slug = '13' pour Engagement contractuel (sinon recree au boot)
      const engagement = db.prepare(`SELECT id, slug FROM section_templates WHERE title = 'Engagement contractuel' LIMIT 1`).get();
      if (engagement && engagement.slug !== '13') {
        // Si un autre template a deja slug='13', on lui change le slug en
        // 'engagement-contractuel-orphelin' pour ne pas violer l'unique.
        const conflicting = db.prepare(`SELECT id FROM section_templates WHERE slug = '13' AND id != ?`).get(engagement.id);
        if (conflicting) {
          db.prepare(`UPDATE section_templates SET slug = 'orphan-' || id WHERE id = ?`).run(conflicting.id);
        }
        db.prepare(`UPDATE section_templates SET slug = '13', number = '13' WHERE id = ?`).run(engagement.id);
      }
      // Dedup sections AF : meme parent + meme template_id => doublon.
      // Garde la plus ancienne, supprime les autres si elles n'ont pas
      // d'enfants (sinon on risque d'orpheliner du contenu utilisateur).
      const dupSections = db.prepare(`
        SELECT af_id, COALESCE(parent_id, 0) parent_key, section_template_id, GROUP_CONCAT(id) ids
        FROM sections
        WHERE section_template_id IS NOT NULL
        GROUP BY af_id, COALESCE(parent_id, 0), section_template_id
        HAVING COUNT(*) > 1
      `).all();
      let sectionsDeleted = 0;
      for (const d of dupSections) {
        const ids = d.ids.split(',').map(Number).sort((a, b) => a - b);
        const keepId = ids[0];
        for (const id of ids.slice(1)) {
          const childCount = db.prepare(`SELECT COUNT(*) c FROM sections WHERE parent_id = ?`).get(id).c;
          if (childCount > 0) continue; // refuse de rendre orphelins des enfants
          db.prepare(`DELETE FROM sections WHERE id = ?`).run(id);
          sectionsDeleted++;
        }
      }
      if (sectionsDeleted > 0) {
        log.info(`Migration 72 : ${sectionsDeleted} section(s) en doublon supprimees dans les AFs`);
      }
    } catch (err) {
      log.warn(`Migration 72 (dedup global) KO : ${err.message}`);
    }
    db.pragma('user_version = 72');
    log.info('Migration 72 appliquee : deduplication globale templates + sections');
  }

  if (current < 73) {
    // Lot — Capture pleine largeur (PDF brochure) : permet de
    // verrouiller une capture en 1 seule colonne au lieu du auto-fit
    // 1-2 colonnes par defaut. Utile pour les screenshots wide
    // (cartographie pleine carte, plans 2D/3D, dashboards complets)
    // qui ne sont pas lisibles a moitie de la largeur de page.
    try {
      db.exec('ALTER TABLE attachments ADD COLUMN full_width INTEGER NOT NULL DEFAULT 0');
    } catch (e) { /* deja presente */ }
    db.pragma('user_version = 73');
    log.info('Migration 73 appliquee : attachments.full_width');
  }

  if (current < 74) {
    // Lot — icone FontAwesome optionnelle par section_template (typiquement
    // sur les fonctionnalites is_functionality=1). Affichee dans la liste
    // de la bibliotheque, dans la brochure PDF, dans le tableau d'offres,
    // et sur la fiche d'edition. Pas de gestion de couleur (decision user
    // 2026-05-04 : la couleur reste celle des classes CSS du contexte).
    try {
      db.exec('ALTER TABLE section_templates ADD COLUMN icon_name TEXT');
    } catch (e) { /* deja presente */ }
    db.pragma('user_version = 74');
    log.info('Migration 74 appliquee : section_templates.icon_name');
  }

  if (current < 75) {
    // Versionnage des section_templates : avant chaque modification du
    // body_html, on fige l'etat courant dans cette table. Permet de
    // restaurer un texte ecrase depuis la modale d'edition.
    // Pattern aligne sur equipment_template_versions (migration 5).
    db.exec(`
      CREATE TABLE IF NOT EXISTS section_template_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL REFERENCES section_templates(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        snapshot TEXT NOT NULL,
        changelog TEXT,
        author_id INTEGER REFERENCES users(id),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(template_id, version)
      );
      CREATE INDEX IF NOT EXISTS idx_stv_template ON section_template_versions(template_id, version DESC);
    `);
    db.pragma('user_version = 75');
    log.info('Migration 75 appliquee : section_template_versions');
  }

  if (current < 76) {
    // Ajout du kind 'pdf-bacs-tables' pour les exports tableaux de synthèse
    // (A3 paysage, complement du PDF audit BACS principal). SQLite ne supporte
    // pas ALTER TABLE ... ADD CHECK, donc on recree la table avec la nouvelle
    // contrainte (pattern standard SQLite).
    db.exec(`
      CREATE TABLE exports_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        af_id INTEGER NOT NULL REFERENCES afs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('pdf-af', 'pdf-points-list', 'pdf-bacs-audit', 'pdf-bacs-tables')),
        file_path TEXT NOT NULL,
        sections_snapshot TEXT,
        options TEXT,
        motif TEXT,
        git_tag TEXT,
        exported_by INTEGER REFERENCES users(id),
        exported_at TEXT DEFAULT CURRENT_TIMESTAMP,
        file_size_bytes INTEGER
      );
      INSERT INTO exports_new SELECT * FROM exports;
      DROP TABLE exports;
      ALTER TABLE exports_new RENAME TO exports;
      CREATE INDEX IF NOT EXISTS idx_exports_af ON exports(af_id, exported_at DESC);
    `);
    db.pragma('user_version = 76');
    log.info('Migration 76 appliquee : exports.kind accepte pdf-bacs-tables');
  }

  if (current < 77) {
    // Lot — Chapitre 14 « Pourquoi Buildy » : section type de positionnement
    // regroupant 4 angles (BACS / Cybersécurité / Cloud / Buildy Box). Bloc
    // autonome destiné à servir de pièce de défense en inspection R175-5-1
    // ET de matière première pour la brochure commerciale.
    //
    // - 14.1 (Conformité BACS) + 12 sous-sections : body_html riche figé
    // - 14.2 (Cybersécurité) + 4 sous-sections : placeholders (rédaction Kevin)
    // - 14.3 (Cloud) + 7 sous-sections : placeholders (rédaction Kevin)
    // - 14.4 (Buildy Box) + 3 sous-sections : body_html depuis buildy.fr
    //
    // Walk récursif du sous-arbre 14 dans PLAN_AF + INSERT chaque node avec
    // body_html depuis BODIES_BY_SLUG. Ne touche pas aux nodes existants
    // (idempotent, INSERT OR IGNORE par slug). Le seeder boot suivant trouve
    // tout déjà créé et le backfillNewPlanSections() ajoute les sections aux
    // AFs vivantes.
    const { PLAN_AF } = require('./seeds/plan-af');
    const { BODIES_BY_SLUG } = require('./seeds/chapter-14-bodies');

    const ch14 = PLAN_AF.find(n => n.number === '14');
    if (!ch14) {
      log.warn('Migration 77 : node 14 introuvable dans PLAN_AF — skip');
    } else {
      let inserted = 0;
      const insertStmt = db.prepare(`
        INSERT INTO section_templates
          (slug, number, title, kind, body_html, bacs_articles,
           parent_template_id, is_functionality, position)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
      `);
      const getBySlug = db.prepare('SELECT id FROM section_templates WHERE slug = ?');
      const maxPosForParent = db.prepare(
        'SELECT COALESCE(MAX(position), 0) AS m FROM section_templates WHERE parent_template_id IS ?'
      );

      function walk(node, parentTemplateId) {
        const slug = node.number;
        let id = null;
        const existing = getBySlug.get(slug);
        if (existing) {
          id = existing.id;
        } else {
          const bodyHtml = Object.prototype.hasOwnProperty.call(BODIES_BY_SLUG, slug)
            ? BODIES_BY_SLUG[slug]
            : null;
          const maxRow = maxPosForParent.get(parentTemplateId || null);
          const position = (maxRow?.m || 0) + 10;
          const result = insertStmt.run(
            slug,
            node.number || null,
            node.title,
            node.kind || 'standard',
            bodyHtml,
            node.bacs_articles || null,
            parentTemplateId || null,
            position,
          );
          id = result.lastInsertRowid;
          inserted++;
        }
        if (Array.isArray(node.children)) {
          for (const c of node.children) walk(c, id);
        }
      }

      walk(ch14, null);
      log.info(`Migration 77 : chapitre 14 « Pourquoi Buildy » seede (${inserted} sections inserees)`);
    }

    db.pragma('user_version = 77');
    log.info('Migration 77 appliquee : chapitre 14 Pourquoi Buildy (BACS + Cybersecurite + Cloud + Buildy Box)');
  }

  if (current < 78) {
    // Lot — Multi-tagging des section_templates par type de document.
    // Chaque section type peut etre rattachee a un ou plusieurs types de
    // documents Buildy (af / brochure / bacs_audit / site_audit). Permet
    // de definir ou` une section apparait : par exemple, le ch.14.4
    // (Buildy Box) n'a pas sa place dans une AF mais doit figurer dans
    // la brochure commerciale.
    //
    // Heritage parent -> enfants : la cascade est appliquee a l'ecriture
    // (cf. db.sectionTemplates.setDocumentKinds) sur le pattern existant
    // de opted_out_by_moa / demanded_by_moa via CTE recursive.
    db.exec(`
      CREATE TABLE IF NOT EXISTS section_template_documents (
        section_template_id INTEGER NOT NULL REFERENCES section_templates(id) ON DELETE CASCADE,
        document_kind TEXT NOT NULL,
        PRIMARY KEY (section_template_id, document_kind)
      );
      CREATE INDEX IF NOT EXISTS idx_stp_docs_kind ON section_template_documents(document_kind);
    `);

    // Backfill : par defaut, toutes les sections existantes sont rattachees
    // a 'af' (le seul type de document qui consommait section_templates jusqu'a
    // present, via seedAfStructure et backfillNewPlanSections).
    db.exec(`
      INSERT OR IGNORE INTO section_template_documents (section_template_id, document_kind)
      SELECT id, 'af' FROM section_templates;
    `);

    // Repartition specifique du chapitre 14 « Pourquoi Buildy » :
    //   14, 14.1, 14.1.x, 14.2, 14.2.x, 14.3, 14.3.x : af + brochure
    //   14.1, 14.1.x : aussi bacs_audit (annexe potentielle du rapport d'audit)
    //   14.4, 14.4.x : brochure SEULEMENT (retire 'af')
    const ch14Ids = db.prepare(`
      SELECT id, slug FROM section_templates
       WHERE slug = '14' OR slug LIKE '14.%'
    `).all();

    const insertKind = db.prepare(`
      INSERT OR IGNORE INTO section_template_documents (section_template_id, document_kind)
      VALUES (?, ?)
    `);
    const deleteKind = db.prepare(`
      DELETE FROM section_template_documents
       WHERE section_template_id = ? AND document_kind = ?
    `);

    for (const row of ch14Ids) {
      const slug = row.slug;
      // Toute la branche 14 -> brochure
      insertKind.run(row.id, 'brochure');
      // 14.1 + ses 12 enfants -> aussi bacs_audit
      if (slug === '14.1' || slug.startsWith('14.1.')) {
        insertKind.run(row.id, 'bacs_audit');
      }
      // 14.4 + ses 3 enfants -> retire 'af' (brochure-only)
      if (slug === '14.4' || slug.startsWith('14.4.')) {
        deleteKind.run(row.id, 'af');
      }
    }

    db.pragma('user_version = 78');
    log.info(`Migration 78 appliquee : section_template_documents + backfill (${ch14Ids.length} sections du ch.14 retaguees)`);
  }

  if (current < 79) {
    // Refonte du tableau R175 ↔ Buildy (section 14.1.12) : design moderne
    // (stats en haut, badges colores Couvert/Renforce, niveau requis colore).
    // On force l'UPDATE du body_html du template + bump current_version.
    // Les AFs existantes verront le banner de propagation et pourront
    // appliquer manuellement la nouvelle version.
    const { BODIES_BY_SLUG } = require('./seeds/chapter-14-bodies');
    const newBody = BODIES_BY_SLUG['14.1.12'];
    if (newBody) {
      const r = db.prepare(`
        UPDATE section_templates
           SET body_html = ?,
               current_version = current_version + 1,
               updated_at = CURRENT_TIMESTAMP
         WHERE slug = '14.1.12'
      `).run(newBody);
      log.info(`Migration 79 : tableau R175 ↔ Buildy (section 14.1.12) refresh (${r.changes} template mis a jour)`);
    }
    db.pragma('user_version = 79');
    log.info('Migration 79 appliquee : refresh body_html section 14.1.12 (tableau R175 redesign)');
  }

  if (current < 80) {
    // Lot — Sections "fantômes" : sections AF sans section_template_id (et
    // sans equipment_template_id), créées via backfillNewPlanSections quand
    // un template manquait. Backfill par titre exact contre section_templates.
    // Les sections qui restent orphelines après ce passage ont été créées
    // pour une raison non automatique (titre divergent vs PLAN_AF, ou
    // anciennes AFs pré-Lot 33) ; on les laisse en place pour que l'user
    // puisse les promouvoir / supprimer manuellement.
    const orphans = db.prepare(`
      SELECT s.id, s.title FROM sections s
      WHERE s.section_template_id IS NULL
        AND s.equipment_template_id IS NULL
        AND s.kind IN ('standard', 'zones')
    `).all();
    let linked = 0;
    const linkStmt = db.prepare(`
      UPDATE sections SET section_template_id = ?, section_template_version = ? WHERE id = ?
    `);
    const lookupByTitle = db.prepare(`
      SELECT id, current_version FROM section_templates WHERE title = ? LIMIT 1
    `);
    for (const o of orphans) {
      const tpl = lookupByTitle.get(o.title);
      if (tpl) {
        linkStmt.run(tpl.id, tpl.current_version || 1, o.id);
        linked++;
      }
    }
    db.pragma('user_version = 80');
    log.info(`Migration 80 : ${linked}/${orphans.length} sections orphelines reliees a la biblio par titre (les ${orphans.length - linked} restantes n'ont pas de pendant et necessitent une promotion manuelle)`);
  }

  if (current < 81) {
    // Lot — Sections "fantômes" : suppression des sections AF qui n'ont
    // toujours pas de pendant biblio apres la migration 80 (link par titre).
    // Ces sections viennent du backfill historique pour des slugs PLAN_AF
    // que l'user a explicitement supprimes de la biblio (tombstone). Le
    // ON DELETE CASCADE propage aux overrides, instances, attachments et
    // sous-sections orphelines.
    const orphans = db.prepare(`
      SELECT id, title, af_id FROM sections
      WHERE section_template_id IS NULL
        AND equipment_template_id IS NULL
        AND kind IN ('standard', 'zones')
    `).all();
    let deleted = 0;
    const delStmt = db.prepare('DELETE FROM sections WHERE id = ?');
    for (const o of orphans) {
      delStmt.run(o.id);
      deleted++;
    }
    db.pragma('user_version = 81');
    log.info(`Migration 81 : ${deleted} sections orphelines supprimees (cascade sur overrides/instances/attachments)`);
  }

  if (current < 82) {
    // Lot — Catégorie 'thermique_mixte' (Chauffage + Climatisation) pour les
    // systèmes réversibles (DRV, rooftop, CTA…). Évite à l'utilisateur de
    // cocher manuellement les 2 cases distinctes pour ces équipements.
    //
    // (a) Met à jour le catalogue system_categories_db :
    //     - insère la nouvelle ligne thermique_mixte si absente
    //     - retire ['drv','rooftop','cta'] des slugs de chauffage et de
    //       climatisation pour qu'ils soient candidats UNIQUEMENT via
    //       thermique_mixte (idempotent : on ne touche pas aux autres slugs).
    // (b) Pour chaque instance qui a actuellement chauffage ET climatisation
    //     cochées simultanément, on remplace par une seule ligne thermique_mixte
    //     (DELETE des 2 + INSERT). Les instances qui n'ont qu'une seule des 2
    //     restent inchangées.
    const cat = (key) => db.prepare('SELECT id, slugs FROM system_categories_db WHERE key = ?').get(key);
    const stripSlugs = (key, toRemove) => {
      const row = cat(key);
      if (!row) return;
      const slugs = row.slugs ? JSON.parse(row.slugs) : [];
      const next = slugs.filter(s => !toRemove.includes(s));
      db.prepare('UPDATE system_categories_db SET slugs = ? WHERE id = ?')
        .run(JSON.stringify(next), row.id);
    };

    if (!cat('thermique_mixte')) {
      // Position : juste après climatisation pour que la matrice PDF affiche
      // les 3 colonnes thermiques côte-à-côte.
      const climPos = db.prepare("SELECT position FROM system_categories_db WHERE key = 'climatisation'").get();
      const newPos = (climPos?.position ?? 10) + 5;
      db.prepare(`
        INSERT INTO system_categories_db (key, label, bacs, slugs, icon_value, icon_color, position)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        'thermique_mixte',
        'Chauffage + Climatisation',
        'R175-1 §1, §2',
        JSON.stringify(['drv', 'rooftop', 'cta']),
        'fa-temperature-half',
        '#a855f7',
        newPos,
      );
    }
    stripSlugs('chauffage', ['drv', 'rooftop', 'cta']);
    stripSlugs('climatisation', ['drv', 'rooftop', 'cta']);

    // (b) Migration des instances : chauffage + climatisation → thermique_mixte
    const mixed = db.prepare(`
      SELECT instance_id FROM equipment_instance_categories WHERE category_key = 'chauffage'
      INTERSECT
      SELECT instance_id FROM equipment_instance_categories WHERE category_key = 'climatisation'
    `).all();
    let migrated = 0;
    const delPair = db.prepare(`
      DELETE FROM equipment_instance_categories
      WHERE instance_id = ? AND category_key IN ('chauffage','climatisation')
    `);
    const insMixed = db.prepare(`
      INSERT OR IGNORE INTO equipment_instance_categories (instance_id, category_key)
      VALUES (?, 'thermique_mixte')
    `);
    for (const row of mixed) {
      delPair.run(row.instance_id);
      insMixed.run(row.instance_id);
      migrated++;
    }
    db.pragma('user_version = 82');
    log.info(`Migration 82 : ${migrated} instance(s) repassee(s) de chauffage+climatisation -> thermique_mixte (catalogue mis a jour)`);
  }

  if (current < 83) {
    // Lot — Réassignation du champ `equipment_templates.category` (groupement
    // principal de la biblio) sur les templates intrinsèquement mixtes :
    // DRV et Rooftop. CTA reste en 'ventilation' (sa fonction principale).
    // Conservateur : on ne réassigne que les templates qui étaient
    // explicitement en 'climatisation' (le DRV était l'exemple typique).
    const upd = db.prepare(`
      UPDATE equipment_templates
         SET category = 'thermique_mixte', updated_at = CURRENT_TIMESTAMP
       WHERE slug IN ('drv', 'rooftop')
         AND category IN ('chauffage', 'climatisation')
    `).run();
    db.pragma('user_version = 83');
    log.info(`Migration 83 : ${upd.changes} template(s) DRV/Rooftop reassignes a la categorie thermique_mixte`);
  }

  if (current < 84) {
    // Lot — Notes riches sur bacs_audit_thermal_regulation : ajout de la
    // colonne notes_html pour permettre l'édition via la même modale que
    // les autres entités (system / device / meter). La colonne notes
    // legacy reste pour compat backward.
    const cols = db.prepare("PRAGMA table_info(bacs_audit_thermal_regulation)").all();
    if (!cols.some(c => c.name === 'notes_html')) {
      db.exec('ALTER TABLE bacs_audit_thermal_regulation ADD COLUMN notes_html TEXT');
      log.info('Migration 84 : colonne notes_html ajoutee a bacs_audit_thermal_regulation');
    }
    db.pragma('user_version = 84');
  }

  if (current < 85) {
    // Lot — Réordonnancement utilisateur : colonnes `position` sur les
    // entités audit BACS qui n'en avaient pas (systems, meters, thermal).
    // Backfill par id pour conserver l'ordre actuel. Tri par
    // (position ASC, id ASC) ensuite. Espacement *10 pour permettre des
    // insertions sans renumérotation globale.
    const tables = ['bacs_audit_systems', 'bacs_audit_meters', 'bacs_audit_thermal_regulation'];
    for (const t of tables) {
      const cols = db.prepare(`PRAGMA table_info(${t})`).all();
      if (!cols.some(c => c.name === 'position')) {
        db.exec(`ALTER TABLE ${t} ADD COLUMN position INTEGER NOT NULL DEFAULT 0`);
        // Backfill : position = rang dans le document * 10
        db.exec(`
          UPDATE ${t}
          SET position = (
            SELECT COUNT(*) * 10
            FROM ${t} t2
            WHERE t2.document_id = ${t}.document_id
              AND t2.id <= ${t}.id
          )
        `);
        log.info(`Migration 85 : colonne position ajoutee a ${t} et backfillee`);
      }
    }
    db.pragma('user_version = 85');
  }

  if (current < 86) {
    // Lot — EXIF photos : enrichir site_documents avec GPS et appareil.
    // taken_at existe déjà depuis la migration 62. On ajoute la position
    // (lat/lng en degrés décimaux WGS84) et la marque/modèle de l'appareil
    // pour : afficher un pin Google Maps sur les tiles photos, identifier
    // d'où vient une photo et avec quel appareil.
    const cols = db.prepare("PRAGMA table_info(site_documents)").all();
    const has = (n) => cols.some(c => c.name === n);
    if (!has('gps_latitude'))  db.exec('ALTER TABLE site_documents ADD COLUMN gps_latitude REAL');
    if (!has('gps_longitude')) db.exec('ALTER TABLE site_documents ADD COLUMN gps_longitude REAL');
    if (!has('camera_make'))   db.exec('ALTER TABLE site_documents ADD COLUMN camera_make TEXT');
    if (!has('camera_model'))  db.exec('ALTER TABLE site_documents ADD COLUMN camera_model TEXT');
    log.info('Migration 86 : site_documents.{gps_latitude,gps_longitude,camera_make,camera_model} ajoutées');
    db.pragma('user_version = 86');
  }

  if (current < 87) {
    // Lot — Régulation thermique R175-6 : passer de 1 niveau (générateur)
    // à 3 niveaux Production / Distribution / Émission, comme le décrit le
    // métier. `generator_device_id` historique reste utilisé comme niveau
    // "Production" (pas renommé en DB pour éviter une refonte risquée du
    // code qui le lit), on ajoute juste 2 nouvelles colonnes pour les
    // niveaux supplémentaires. Tous facultatifs : un DRV n'a pas de
    // distribution, un poêle bois n'a ni distribution ni émission séparée.
    const cols = db.prepare("PRAGMA table_info(bacs_audit_thermal_regulation)").all();
    const has = (n) => cols.some(c => c.name === n);
    if (!has('distribution_device_id')) {
      db.exec('ALTER TABLE bacs_audit_thermal_regulation ADD COLUMN distribution_device_id INTEGER REFERENCES bacs_audit_system_devices(id) ON DELETE SET NULL');
    }
    if (!has('emission_device_id')) {
      db.exec('ALTER TABLE bacs_audit_thermal_regulation ADD COLUMN emission_device_id INTEGER REFERENCES bacs_audit_system_devices(id) ON DELETE SET NULL');
    }
    log.info('Migration 87 : bacs_audit_thermal_regulation.{distribution_device_id,emission_device_id} ajoutées');
    db.pragma('user_version = 87');
  }

  if (current < 88) {
    // Lot — Régulation par niveau (R175-6) : pour chaque équipement
    // (production / distribution / émission) l'auditeur peut décrire la
    // boucle de régulation associée (sonde extérieure, V3V, robinets
    // thermo…). Champs TEXT libres avec liste de suggestions côté UI
    // (composant SearchableSelect creatable). Tous facultatifs.
    const cols = db.prepare("PRAGMA table_info(bacs_audit_thermal_regulation)").all();
    const has = (n) => cols.some(c => c.name === n);
    if (!has('production_regulation'))   db.exec('ALTER TABLE bacs_audit_thermal_regulation ADD COLUMN production_regulation TEXT');
    if (!has('distribution_regulation')) db.exec('ALTER TABLE bacs_audit_thermal_regulation ADD COLUMN distribution_regulation TEXT');
    if (!has('emission_regulation'))     db.exec('ALTER TABLE bacs_audit_thermal_regulation ADD COLUMN emission_regulation TEXT');
    log.info('Migration 88 : bacs_audit_thermal_regulation.{production,distribution,emission}_regulation ajoutées');
    db.pragma('user_version = 88');
  }

  if (current < 89) {
    // Lot — Statut de validation du contenu de la bibliothèque (sections
    // types, fonctionnalités, équipements). 3 états dérivés en lecture :
    //   - vide       : body_html / description_html null ou blanc
    //   - brouillon  : contenu présent, content_validated_at NULL
    //   - validé     : content_validated_at non NULL (date + auteur)
    // Action utilisateur explicite "Valider le contenu" depuis l'éditeur.
    // Toute modification ultérieure du contenu repasse en brouillon
    // (auto-clear côté DB methods sectionTemplates.update / equipmentTemplates.update).
    const stCols = db.prepare('PRAGMA table_info(section_templates)').all();
    const stHas = (n) => stCols.some(c => c.name === n);
    if (!stHas('content_validated_at')) {
      db.exec('ALTER TABLE section_templates ADD COLUMN content_validated_at TEXT');
    }
    if (!stHas('content_validated_by')) {
      db.exec('ALTER TABLE section_templates ADD COLUMN content_validated_by INTEGER REFERENCES users(id)');
    }
    const etCols = db.prepare('PRAGMA table_info(equipment_templates)').all();
    const etHas = (n) => etCols.some(c => c.name === n);
    if (!etHas('content_validated_at')) {
      db.exec('ALTER TABLE equipment_templates ADD COLUMN content_validated_at TEXT');
    }
    if (!etHas('content_validated_by')) {
      db.exec('ALTER TABLE equipment_templates ADD COLUMN content_validated_by INTEGER REFERENCES users(id)');
    }
    log.info('Migration 89 appliquée : content_validated_at/by sur section_templates et equipment_templates');
    db.pragma('user_version = 89');
  }

  if (current < 90) {
    // Lot — FAQ Buildy : synchronisation Knowledge Base Crisp.
    //   - crisp_settings : singleton (id=1) avec credentials chiffrés (lib/crypto)
    //     + website_id + locale par défaut + statut du dernier pull.
    //   - faq_categories / faq_articles : calque Crisp 1:1 avec champs `crisp_id`,
    //     `dirty` (modif locale non poussée), `pulled_at` / `pushed_at`.
    db.exec(`
      CREATE TABLE IF NOT EXISTS crisp_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        api_identifier_encrypted TEXT,
        api_key_encrypted TEXT,
        website_id TEXT,
        default_locale TEXT NOT NULL DEFAULT 'fr',
        last_pull_at TEXT,
        last_pull_status TEXT,
        last_pull_error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS faq_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        crisp_id TEXT UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        color TEXT,
        order_index INTEGER NOT NULL DEFAULT 0,
        parent_id INTEGER REFERENCES faq_categories(id) ON DELETE SET NULL,
        locale TEXT NOT NULL DEFAULT 'fr',
        pulled_at TEXT,
        pushed_at TEXT,
        dirty INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_faq_categories_parent ON faq_categories(parent_id);
      CREATE INDEX IF NOT EXISTS idx_faq_categories_crisp ON faq_categories(crisp_id);

      CREATE TABLE IF NOT EXISTS faq_articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        crisp_id TEXT UNIQUE,
        category_id INTEGER REFERENCES faq_categories(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        slug TEXT,
        content_html TEXT,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
        visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
        locale TEXT NOT NULL DEFAULT 'fr',
        views_count INTEGER DEFAULT 0,
        pulled_at TEXT,
        pushed_at TEXT,
        crisp_updated_at TEXT,
        dirty INTEGER NOT NULL DEFAULT 0,
        last_ai_assist_at TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_faq_articles_category ON faq_articles(category_id);
      CREATE INDEX IF NOT EXISTS idx_faq_articles_status ON faq_articles(status);
      CREATE INDEX IF NOT EXISTS idx_faq_articles_dirty ON faq_articles(dirty);
      CREATE INDEX IF NOT EXISTS idx_faq_articles_crisp ON faq_articles(crisp_id);
    `);
    log.info('Migration 90 appliquée : crisp_settings + faq_categories + faq_articles (FAQ Buildy / Crisp KB)');
    db.pragma('user_version = 90');
  }

  if (current < 91) {
    // Lot — Options payantes à la carte (AF).
    // sections.optin_paid_option = 1 quand le MOA ajoute explicitement
    // une fonctionnalité comme option payante au contrat (sans monter au
    // niveau supérieur). Distinct de demanded_by_moa (= socle exigé qui
    // peut imposer une montée de niveau).
    const cols = db.prepare('PRAGMA table_info(sections)').all();
    if (!cols.some(c => c.name === 'optin_paid_option')) {
      db.exec('ALTER TABLE sections ADD COLUMN optin_paid_option INTEGER NOT NULL DEFAULT 0');
    }
    log.info('Migration 91 appliquée : sections.optin_paid_option (option payante MOA à la carte)');
    db.pragma('user_version = 91');
  }

  if (current < 92) {
    // FAQ Buildy : historique des versions d'article. Snapshot du
    // content_html + title + status pris AVANT chaque push vers Crisp,
    // pour permettre une restauration en cas de regression.
    db.exec(`
      CREATE TABLE IF NOT EXISTS faq_article_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        article_id INTEGER NOT NULL REFERENCES faq_articles(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content_html TEXT,
        status TEXT,
        reason TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_faq_article_versions_article
        ON faq_article_versions(article_id, created_at DESC);
    `);
    log.info('Migration 92 appliquée : faq_article_versions (snapshot pré-push)');
    db.pragma('user_version = 92');
  }

  if (current < 93) {
    // Lot — Resync one-shot des titres de sections AF avec leur template.
    // Avant ce lot, les titres ne se propageaient pas de la biblio aux AFs
    // (la propagation backend etait conditionnelle a un query param jamais
    // transmis). Resultat : certaines AFs avaient des titres obsoletes.
    // Cette migration force l'alignement au boot. Les titres etaient deja
    // censes etre des metas non-customisables, donc pas de perte de travail
    // utilisateur.
    const result = db.prepare(`
      UPDATE sections
         SET title = (SELECT title FROM section_templates WHERE id = sections.section_template_id)
       WHERE section_template_id IS NOT NULL
         AND title != (SELECT title FROM section_templates WHERE id = sections.section_template_id)
    `).run();
    log.info(`Migration 93 appliquée : ${result.changes} titre(s) de sections AF resynchronises avec leur template biblio.`);
    db.pragma('user_version = 93');
  }

  if (current < 94) {
    // Lot — Engagement de commande du contrat de services (section type 13.x).
    // Ajoute un sous-chapitre sous le chapitre 13 « Engagement contractuel »
    // qui formalise l'engagement du MOA a passer commande du contrat de
    // services (Smart/Premium) au plus tard la veille de la livraison, et
    // les consequences a defaut (report de livraison ou non-activation des
    // fonctionnalites payantes).
    const parent = db.prepare(`SELECT id FROM section_templates WHERE slug = '13'`).get();
    if (!parent) {
      log.warn('Migration 94 : chapitre 13 introuvable (slug=13) — skip');
    } else {
      const slug = 'engagement-commande-contrat-services';
      const existing = db.prepare('SELECT id FROM section_templates WHERE slug = ?').get(slug);
      const bodyHtml = `<p>Le maître d'ouvrage <strong>s'engage à passer commande du contrat de services Buildy</strong> (Smart ou Premium, selon le niveau choisi dans la présente AF) <strong>au plus tard la veille de la date de livraison prévue du projet</strong>.</p>

<p>Cet engagement couvre également la souscription des éventuelles options payantes ajoutées à la carte au contrat (cf. chapitre <em>Options payantes à inclure dans l'avenant</em>).</p>

<h3>Pourquoi cet engagement ?</h3>
<p>Le contrat de services est facturé au palier (nombre de points de données effectivement supervisés), connu uniquement en fin de chantier. Le devis correspondant est donc émis au dernier moment, et le commanditaire (exploitant, mainteneur, property manager ou client final) peut être identifié tardivement. Il revient au MOA d'orchestrer ce processus en amont de la livraison.</p>

<h3>Conséquences à défaut de commande</h3>
<p>Si la commande du contrat de services n'a pas été reçue par Buildy à la date prévue de livraison, Buildy se réserve le droit de&nbsp;:</p>
<ul>
  <li><strong>Repousser la date de livraison</strong> du projet jusqu'à réception et validation de la commande&nbsp;;</li>
  <li><strong>Ou livrer le projet sans activer les fonctionnalités</strong> nécessitant un contrat Smart, Premium ou une option payante souscrite. Ces fonctionnalités resteront documentées dans l'AF mais désactivées techniquement jusqu'à la commande effective.</li>
  </ul>

<p>La validation de la présente AF par le MOA acte la prise de connaissance et l'acceptation de cet engagement.</p>`;
      let newId;
      if (existing) {
        newId = existing.id;
        log.info(`Migration 94 : section_template '${slug}' existe deja (id=${newId}) — skip insert`);
      } else {
        const result = db.prepare(`
          INSERT INTO section_templates
            (slug, number, title, kind, body_html, parent_template_id, is_functionality, position)
          VALUES (?, NULL, ?, 'standard', ?, ?, 0, 100)
        `).run(slug, 'Engagement de commande du contrat de services', bodyHtml, parent.id);
        newId = result.lastInsertRowid;
        db.prepare(`
          INSERT OR IGNORE INTO section_template_documents (section_template_id, document_kind)
          VALUES (?, 'af')
        `).run(newId);
      }
      // Propagation aux AFs vivantes (idempotente). On ne peut pas appeler
      // db.sectionTemplates ici (sectionTemplates n'est pas encore expose au
      // boot des migrations) — on reproduit la logique inline.
      const tpl = db.prepare('SELECT * FROM section_templates WHERE id = ?').get(newId);
      const afsAlive = db.prepare('SELECT id FROM afs WHERE deleted_at IS NULL').all();
      let inserted = 0;
      for (const af of afsAlive) {
        const exists = db.prepare(
          'SELECT 1 FROM sections WHERE af_id = ? AND section_template_id = ?'
        ).get(af.id, tpl.id);
        if (exists) continue;
        const parentSection = db.prepare(
          'SELECT id FROM sections WHERE af_id = ? AND section_template_id = ? LIMIT 1'
        ).get(af.id, tpl.parent_template_id);
        if (!parentSection) continue;
        const maxPos = db.prepare(
          'SELECT COALESCE(MAX(position), 0) AS m FROM sections WHERE af_id = ? AND parent_id = ?'
        ).get(af.id, parentSection.id);
        const position = (maxPos?.m || 0) + 10;
        const ins = db.prepare(`
          INSERT INTO sections
            (af_id, parent_id, position, number, title, kind, body_html, section_template_id, section_template_version)
          VALUES (?, ?, ?, NULL, ?, 'standard', ?, ?, ?)
        `).run(af.id, parentSection.id, position, tpl.title, tpl.body_html, tpl.id, tpl.current_version || 1);
        if (ins.changes > 0) inserted++;
      }
      log.info(`Migration 94 appliquee : section type 13.x « Engagement de commande du contrat de services » (id=${newId}, propagee dans ${inserted} AF(s)).`);
    }
    db.pragma('user_version = 94');
  }

  if (current < 95) {
    // Lot — Library-driven equipment sections (renforcement de fbc9b2f).
    //
    // Probleme initial : libraryExtendAf derive les categories d'equipement
    // a injecter dans une section parent depuis les categories des enfants
    // equipment deja inseres. Mais si un equipement a ete supprime de la
    // bibliotheque (ex : drv tombstoned), la categorie correspondante
    // disparait du parent, et les autres equipements de la lib avec cette
    // categorie (ex : unite-interieure-drv) ne sont jamais ajoutes.
    //
    // Resolution :
    // (a) Nouvelle colonne library_categories sur section_templates pour
    //     declarer explicitement les categories d'equipement qu'un parent
    //     accueille. libraryExtendAf prend cette declaration en compte en
    //     plus (et en fallback) des categories detectees dans eqKids.
    try { db.exec('ALTER TABLE section_templates ADD COLUMN library_categories TEXT'); }
    catch { /* deja la */ }

    // (b) Set library_categories sur les parents narratifs canoniques.
    //     Idempotent : ne touche pas si l'utilisateur a deja edite la valeur.
    const PARENT_TO_CATS = {
      '2.1': ['chauffage', 'climatisation'],
      '2.2': ['ventilation'],
      '2.3': ['ecs'],
      '2.4': ['eclairage'],
      '2.5': ['electricite'],
      '2.6': ['comptage'],
      '2.7': ['qai'],
      '2.8': ['occultation'],
      '2.9': ['process'],
      '2.10': ['autres'],
    };
    const setCats = db.prepare(`
      UPDATE section_templates
         SET library_categories = ?
       WHERE slug = ? AND (library_categories IS NULL OR library_categories = '')
    `);
    for (const [slug, cats] of Object.entries(PARENT_TO_CATS)) {
      setCats.run(JSON.stringify(cats), slug);
    }

    // (c) Tombstone equipment_templates : protege contre la recreation au
    //     boot apres une suppression UI (parite avec deleted_section_template_slugs).
    db.exec(`
      CREATE TABLE IF NOT EXISTS deleted_equipment_template_slugs (
        slug TEXT PRIMARY KEY,
        deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    log.info('Migration 95 appliquee : section_templates.library_categories + tombstones equipment_templates');
    db.pragma('user_version = 95');
  }

  if (current < 96) {
    // Lot — Bouton « Bibliothèque » dans les cartes systèmes BACS.
    //
    // Sur la fiche d'un equipment_template (admin), on peut renseigner une
    // énergie et un niveau (production/distribution/émission) "par défaut"
    // qui pré-remplissent le device créé depuis ce template via la modale
    // bibliothèque. Champs nullables — un template peut rester générique.
    try { db.exec('ALTER TABLE equipment_templates ADD COLUMN default_energy_source TEXT'); }
    catch { /* deja la */ }
    try { db.exec('ALTER TABLE equipment_templates ADD COLUMN default_device_role TEXT'); }
    catch { /* deja la */ }

    log.info('Migration 96 appliquee : equipment_templates.default_energy_source + default_device_role');
    db.pragma('user_version = 96');
  }

  if (current < 97) {
    // Lot — Partage d'un système BACS entre plusieurs zones fonctionnelles.
    //
    // Cas d'usage : une chaufferie commune alimente plusieurs cellules
    // logistiques + ateliers. Aujourd'hui le modèle bacs_audit_systems
    // (zone_id FK + UNIQUE(document_id, zone_id, system_category)) oblige
    // à dupliquer le système une fois par zone, ce qui est faux.
    //
    // Approche conservative : on garde zone_id (zone "d'origine") et on
    // ajoute une table d'extras pour les zones supplémentaires desservies.
    // Les call sites existants (resync, exports, indicateurs R175) continuent
    // de fonctionner sans modification — ils traitent toujours la zone
    // d'origine. La nouvelle UI matérialise les extras comme des cartes
    // miroir dans les autres zones, avec un badge « Partagé ».
    db.exec(`
      CREATE TABLE IF NOT EXISTS bacs_audit_system_extra_zones (
        system_id INTEGER NOT NULL REFERENCES bacs_audit_systems(id) ON DELETE CASCADE,
        zone_id INTEGER NOT NULL REFERENCES zones(zone_id) ON DELETE CASCADE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (system_id, zone_id)
      );
      CREATE INDEX IF NOT EXISTS idx_bacs_sys_extra_zones_zone
        ON bacs_audit_system_extra_zones(zone_id);
    `);

    log.info('Migration 97 appliquee : bacs_audit_system_extra_zones (partage multi-zones)');
    db.pragma('user_version = 97');
  }

  if (current < 98) {
    // Lot — Partage multi-zones AU NIVEAU DEVICE (et non plus système).
    //
    // Correction de scope mig 97 : un « système » dans le langage utilisateur
    // = un équipement physique (chaudière, VMC, luminaire), pas l'enveloppe
    // zone × catégorie. C'est le device qui dessert physiquement plusieurs
    // zones (la chaufferie commune = 1 chaudière), pas la « catégorie
    // chauffage de Logistique » qui est une abstraction matrice.
    //
    // On supprime donc l'extras-zones niveau système (table vide en prod
    // après le déploiement initial) et on la ré-attache au device.
    db.exec('DROP TABLE IF EXISTS bacs_audit_system_extra_zones');
    db.exec(`
      CREATE TABLE IF NOT EXISTS bacs_audit_device_extra_zones (
        device_id INTEGER NOT NULL REFERENCES bacs_audit_system_devices(id) ON DELETE CASCADE,
        zone_id INTEGER NOT NULL REFERENCES zones(zone_id) ON DELETE CASCADE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (device_id, zone_id)
      );
      CREATE INDEX IF NOT EXISTS idx_bacs_dev_extra_zones_zone
        ON bacs_audit_device_extra_zones(zone_id);
    `);

    log.info('Migration 98 appliquee : partage multi-zones rebasculé au niveau device');
    db.pragma('user_version = 98');
  }

  if (current < 99) {
    // Lot — Niveaux libres (Production / Distribution / Émission / Régulation +
    // valeurs custom). On retire la contrainte CHECK sur device_role pour
    // permettre à l'admin d'ajouter ses propres niveaux depuis la modale
    // de modèle d'équipement (SearchableSelect creatable).
    //
    // SQLite ne permet pas de DROP CHECK directement → recréation de la
    // table en conservant les données.
    db.exec(`
      BEGIN;
      CREATE TABLE bacs_audit_system_devices_new99 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        system_id INTEGER NOT NULL REFERENCES bacs_audit_systems(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        name TEXT,
        brand TEXT,
        model_reference TEXT,
        power_kw REAL,
        energy_source TEXT
          CHECK (energy_source IS NULL OR energy_source IN
            ('gas','electric','wood','heat_pump','district_heating','fuel_oil','solar','biomass','autre')),
        device_role TEXT,
        communication_protocol TEXT
          CHECK (communication_protocol IS NULL OR communication_protocol IN
            ('modbus_tcp','modbus_rtu','bacnet_ip','bacnet_mstp',
             'knx','mbus','mqtt','lorawan','autre','non_communicant','absent')),
        location TEXT,
        notes TEXT,
        notes_html TEXT,
        wired INTEGER,
        meets_r175_3_p4 INTEGER,
        meets_r175_3_p4_autonomous INTEGER,
        managed_by_bms INTEGER,
        out_of_service INTEGER DEFAULT 0,
        bms_integration_out_of_service INTEGER DEFAULT 0,
        communication_protocols TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO bacs_audit_system_devices_new99
        SELECT id, system_id, position, name, brand, model_reference, power_kw,
               energy_source, device_role, communication_protocol, location, notes,
               notes_html, wired, meets_r175_3_p4, meets_r175_3_p4_autonomous,
               managed_by_bms, out_of_service, bms_integration_out_of_service,
               communication_protocols, created_at, updated_at
        FROM bacs_audit_system_devices;
      DROP TABLE bacs_audit_system_devices;
      ALTER TABLE bacs_audit_system_devices_new99 RENAME TO bacs_audit_system_devices;
      CREATE INDEX idx_bacs_devices_system ON bacs_audit_system_devices(system_id, position);
      COMMIT;
    `);

    log.info('Migration 99 appliquee : device_role devient TEXT libre (niveaux custom)');
    db.pragma('user_version = 99');
  }

  if (current < 100) {
    // Lot — Check-list de collecte des pièces jointes du dossier d'audit
    // (plans étages, schémas électriques, synoptique GTB, plan IP, AF GTB,
    // coordonnées locataires, etc.) + couverture photo des entités.
    //
    // Modèle :
    //  - bacs_checklist_catalog (clé / label / icône / position / actif) :
    //    catalogue éditable côté admin. Items partagés à tous les audits.
    //  - bacs_audit_checklist : état par audit (pending / available /
    //    not_available + raison + notes_html). Une ligne par (document, key).
    //  - site_documents.bacs_audit_checklist_id : nouvelle FK pour rattacher
    //    les fichiers à un item de check-list (vs zone/system/meter/device/bms).
    db.exec(`
      CREATE TABLE IF NOT EXISTS bacs_checklist_catalog (
        key TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        description TEXT,
        icon_value TEXT,
        icon_color TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bacs_audit_checklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL REFERENCES afs(id) ON DELETE CASCADE,
        catalog_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','available','not_available')),
        notes_html TEXT,
        not_available_reason TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(document_id, catalog_key)
      );
      CREATE INDEX IF NOT EXISTS idx_bacs_audit_checklist_doc
        ON bacs_audit_checklist(document_id);
    `);
    try { db.exec('ALTER TABLE site_documents ADD COLUMN bacs_audit_checklist_id INTEGER'); }
    catch { /* déjà là */ }

    // Seed initial du catalogue (les ~10 items les plus courants).
    // L'admin peut ensuite l'éditer (ajouter/retirer/réordonner).
    const seedItems = [
      { key: 'floor_plans',           label: 'Plans d\'étages / niveaux',                   icon: 'fa-layer-group',          color: '#3b82f6', position: 10 },
      { key: 'electrical_schemas',    label: 'Schémas électriques (TGBT, divisionnaires)',  icon: 'fa-bolt',                 color: '#facc15', position: 20 },
      { key: 'gtb_synoptic',          label: 'Synoptique d\'architecture GTB',              icon: 'fa-sitemap',              color: '#06b6d4', position: 30 },
      { key: 'ip_addressing',         label: 'Plan d\'adressage IP',                         icon: 'fa-network-wired',        color: '#22c55e', position: 40 },
      { key: 'gtb_functional',        label: 'Analyse fonctionnelle GTB existante',         icon: 'fa-file-lines',           color: '#a855f7', position: 50 },
      { key: 'tenants_contacts',      label: 'Coordonnées locataires / occupants',          icon: 'fa-address-book',         color: '#f97316', position: 60 },
      { key: 'hydraulic_schemas',     label: 'Schémas hydrauliques / fluides',              icon: 'fa-droplet',              color: '#0ea5e9', position: 70 },
      { key: 'maintenance_contracts', label: 'Carnet d\'entretien / contrats',              icon: 'fa-screwdriver-wrench',   color: '#475569', position: 80 },
      { key: 'tech_room_access',      label: 'Accès locaux techniques (badges, codes)',     icon: 'fa-key',                  color: '#eab308', position: 90 },
      { key: 'site_overview_photos',  label: 'Photos générales du site (façades, toiture)', icon: 'fa-camera',               color: '#10b981', position: 100 },
    ];
    const insertItem = db.prepare(`
      INSERT INTO bacs_checklist_catalog (key, label, icon_value, icon_color, position)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const it of seedItems) {
      try { insertItem.run(it.key, it.label, it.icon, it.color, it.position); }
      catch { /* ignore conflict si déjà présent */ }
    }

    log.info('Migration 100 appliquee : check-list audit (catalog + état + FK site_documents)');
    db.pragma('user_version = 100');
  }

  if (current < 101) {
    // SEO score persistance pour articles FAQ.
    // Permet : 1) badge SEO dans l'éditeur, 2) few-shot examples dans le
    // prompt Claude (top articles ≥ 80), 3) auto-rewrite loop si < 70.
    db.exec(`
      ALTER TABLE faq_articles ADD COLUMN seo_score INTEGER;
      ALTER TABLE faq_articles ADD COLUMN seo_checks_json TEXT;
      ALTER TABLE faq_articles ADD COLUMN seo_scored_at DATETIME;
    `);
    log.info('Migration 101 appliquee : faq_articles.seo_score + seo_checks_json + seo_scored_at');
    db.pragma('user_version = 101');
  }

  if (current < 102) {
    // Description (meta-description SEO) des articles FAQ. Crisp limite à 160 chars.
    // Persistée localement, poussée en push, lue au pull. Champ éditable + bouton
    // de reformulation IA dédié dans l'éditeur.
    db.exec(`
      ALTER TABLE faq_articles ADD COLUMN description TEXT;
    `);
    log.info('Migration 102 appliquee : faq_articles.description (meta-description SEO)');
    db.pragma('user_version = 102');
  }

  if (current < 103) {
    // Settings FAQ singleton (whitelist mots-cles SEO surchargeable depuis l'UI).
    db.exec(`
      CREATE TABLE IF NOT EXISTS faq_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        seo_keywords_json TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT OR IGNORE INTO faq_settings (id) VALUES (1);
    `);
    log.info('Migration 103 appliquee : faq_settings (whitelist mots-cles SEO)');
    db.pragma('user_version = 103');
  }

  if (current < 104) {
    // crisp_url : URL publique de l'article cote help.buildy.fr (renvoyee par
    // Crisp au pull non-conflictuel). La colonne avait ete ajoutee a la main
    // en dev sans migration -> manquait en prod (incident 2026-05-08).
    // ALTER IF NOT EXISTS via try/catch : sqlite ne supporte pas
    // 'ADD COLUMN IF NOT EXISTS', et la dev DB a deja la colonne.
    try {
      db.exec(`ALTER TABLE faq_articles ADD COLUMN crisp_url TEXT;`);
      log.info('Migration 104 appliquee : faq_articles.crisp_url');
    } catch (e) {
      if (!String(e.message).includes('duplicate column')) throw e;
      log.info('Migration 104 : faq_articles.crisp_url existait deja (ajoute manuellement avant)');
    }
    db.pragma('user_version = 104');
  }

  if (current < 105) {
    // Tombstones de categories Crisp supprimees cote distant : empeche le
    // re-import au prochain pull. Posees au pull quand un crisp_id local
    // n'apparait plus dans la liste Crisp, ou explicitement par l'API.
    db.exec(`
      CREATE TABLE IF NOT EXISTS faq_categories_tombstones (
        crisp_id TEXT PRIMARY KEY,
        local_id INTEGER,
        deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        reason TEXT
      );
    `);
    log.info('Migration 105 appliquee : faq_categories_tombstones');
    db.pragma('user_version = 105');
  }

  if (current < 106) {
    // Suppression du kind 'site_audit' : decision produit, on n'utilise plus
    // que 'bacs_audit' (plus complet et structure). Les site_audit existants
    // sont convertis en bacs_audit (les annexes R175 deviendront visibles
    // dans le PDF, pas de perte de donnees). On retire ensuite 'site_audit'
    // du CHECK contraint via writable_schema (meme pattern que mig 59).
    const converted = db.prepare(
      "UPDATE afs SET kind = 'bacs_audit' WHERE kind = 'site_audit'"
    ).run().changes;
    if (converted > 0) {
      log.info(`Migration 106 : ${converted} site_audit converti(s) en bacs_audit`);
    }
    db.unsafeMode(true);
    try {
      db.pragma('writable_schema = 1');
      db.prepare(
        "UPDATE sqlite_master SET sql = REPLACE(sql, ?, ?) " +
        "WHERE type = 'table' AND name = 'afs'"
      ).run(
        "CHECK (kind IN ('af','bacs_audit','site_audit','brochure'))",
        "CHECK (kind IN ('af','bacs_audit','brochure'))",
      );
      db.pragma('writable_schema = 0');
    } finally {
      db.unsafeMode(false);
    }
    db.pragma('user_version = 106');
    log.info('Migration 106 appliquee : kind site_audit supprime');
  }

  if (current < 107) {
    // Permissions strictes par défaut : on bascule du mode « permissive »
    // (mig 13 : tous les users connectés voient tous les docs sans entrée
    // af_permissions) vers « creator-only par défaut ».
    //
    // Compat : pour ne pas couper l'accès à des collègues qui collaborent
    // déjà sur des audits en prod, on snapshote l'état actuel = on insère
    // un grant 'write' explicite pour tous les users existants sur tous
    // les docs existants (sauf l'owner qui a déjà tous les droits via
    // afs.created_by). À partir de cette migration, tous les NOUVEAUX
    // docs sont strictement creator-only jusqu'au premier partage
    // explicite via la modale « Partager ».
    const inserted = db.prepare(`
      INSERT OR IGNORE INTO af_permissions (af_id, user_id, role, granted_by)
      SELECT a.id, u.id, 'write', a.created_by
      FROM afs a
      CROSS JOIN users u
      WHERE a.deleted_at IS NULL
        AND u.id != a.created_by
    `).run().changes;
    log.info(`Migration 107 : ${inserted} grant(s) legacy posé(s) (snapshot accès actuel)`);
    db.pragma('user_version = 107');
    log.info('Migration 107 appliquee : permissions strictes par defaut (creator-only + grants explicites)');
  }

  if (current < 108) {
    // Constats GTB hors-décret + opportunités Buildy.
    // Pour chaque sujet GTB (mesurage, historisation, régulation,
    // programmation, alarmes, supervision, accès distant,
    // interopérabilité), l'auditeur saisit deux narratifs libres :
    //  - observation : ce qu'il constate sur place (état actuel,
    //    défauts, contournements, écarts) — indépendant de la
    //    conformité R175.
    //  - opportunity : ce que Buildy peut apporter ici (proposition
    //    commerciale, amélioration, intégration hyperveez/connect).
    // Visibles dans le rapport PDF même quand l'alinéa R175
    // correspondant est marqué « non concerné ».
    db.exec(`
      CREATE TABLE IF NOT EXISTS gtb_topics_catalog (
        key TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        description TEXT,
        icon_value TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bacs_audit_gtb_observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL REFERENCES afs(id) ON DELETE CASCADE,
        topic_key TEXT NOT NULL,
        observation_html TEXT,
        opportunity_html TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(document_id, topic_key)
      );
      CREATE INDEX IF NOT EXISTS idx_bacs_audit_gtb_obs_doc
        ON bacs_audit_gtb_observations(document_id);
    `);
    const seedTopics = [
      { key: 'metering',        label: 'Mesurage et comptage',          icon: 'fa-gauge',          desc: 'Compteurs présents, granularité, lisibilité, accessibilité.', position: 10 },
      { key: 'historisation',   label: 'Historisation des données',     icon: 'fa-clock-rotate-left', desc: 'Profondeur d\'historique, fréquence, exploitabilité, sauvegarde.', position: 20 },
      { key: 'regulation',      label: 'Régulation thermique',          icon: 'fa-temperature-half',  desc: 'Type de régulation (TOR, PI, PID), zones, dérives observées.', position: 30 },
      { key: 'programming',     label: 'Programmation horaire',         icon: 'fa-calendar-days',     desc: 'Plages occupation/inoccupation, dérogations, modes spéciaux.', position: 40 },
      { key: 'alarms',          label: 'Alarmes et défauts',            icon: 'fa-bell',              desc: 'Acquittement, hiérarchisation, notifications, journal des défauts.', position: 50 },
      { key: 'supervision',     label: 'Supervision graphique',         icon: 'fa-chart-line',        desc: 'Synoptiques, vues d\'exploitation, courbes, ergonomie poste.', position: 60 },
      { key: 'remote_access',   label: 'Accès distant et mobilité',     icon: 'fa-mobile-screen',     desc: 'VPN, web client, app mobile, sécurité, multi-utilisateurs.', position: 70 },
      { key: 'interoperability',label: 'Interopérabilité et protocoles',icon: 'fa-network-wired',     desc: 'Modbus, BACnet, KNX, M-Bus, APIs, ouverture aux tiers.', position: 80 },
    ];
    const insTopic = db.prepare(`
      INSERT INTO gtb_topics_catalog (key, label, description, icon_value, position)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const t of seedTopics) {
      try { insTopic.run(t.key, t.label, t.desc, t.icon, t.position); }
      catch { /* ignore conflict */ }
    }
    log.info('Migration 108 appliquee : gtb_topics_catalog + bacs_audit_gtb_observations + seed 8 sujets');
    db.pragma('user_version = 108');
  }

  if (current < 109) {
    // Reset du catalogue gtb_topics_catalog : la mig 108 avait seedé
    // 8 sujets génériques (mesurage, historisation, régulation…). On
    // remplace par les VRAIS sous-titres de la carte GTB existante,
    // pour que chaque h3 du chapitre 6 puisse recevoir une note libre
    // via le pattern existant « + Note » (NotesEditorModal).
    //
    // On préserve les notes saisies sur les anciennes clés via un
    // mapping (historisation -> r175_3_capacites, etc.) — meilleur
    // effort, certaines anciennes clés sans correspondance directe
    // sont juste laissées orphelines (lignes invisibles dans l'UI).
    db.prepare(`
      UPDATE bacs_audit_gtb_observations SET topic_key = 'r175_3_capacites'
      WHERE topic_key IN ('historisation', 'supervision', 'alarms')
    `).run();
    db.prepare(`
      UPDATE bacs_audit_gtb_observations SET topic_key = 'r175_3_mise_dispo'
      WHERE topic_key = 'remote_access'
    `).run();
    db.prepare(`
      UPDATE bacs_audit_gtb_observations SET topic_key = 'compteurs'
      WHERE topic_key = 'metering'
    `).run();
    db.prepare(`
      UPDATE bacs_audit_gtb_observations SET topic_key = 'usages'
      WHERE topic_key IN ('regulation', 'programming', 'interoperability')
    `).run();
    db.prepare('DELETE FROM gtb_topics_catalog').run();
    const seedTopics = [
      { key: 'analyse_fonctionnelle', label: 'Analyse fonctionnelle de la GTB existante', position: 10 },
      { key: 'usages',                label: 'Usages traités par la GTB',                  position: 20 },
      { key: 'equipements',           label: 'Équipements intégrés à la GTB',              position: 30 },
      { key: 'compteurs',             label: 'Compteurs intégrés à la GTB',                position: 40 },
      { key: 'r175_3_capacites',      label: 'R175-3 — Capacités de la solution de supervision', position: 50 },
      { key: 'r175_3_mise_dispo',     label: 'R175-3 — Mise à disposition des données',    position: 60 },
      { key: 'r175_4',                label: 'R175-4 — Vérifications périodiques',         position: 70 },
      { key: 'r175_5',                label: 'R175-5 — Formation exploitant',              position: 80 },
    ];
    const insTopic = db.prepare(`
      INSERT INTO gtb_topics_catalog (key, label, position) VALUES (?, ?, ?)
    `);
    for (const t of seedTopics) insTopic.run(t.key, t.label, t.position);
    log.info('Migration 109 appliquee : reset gtb_topics_catalog avec les sujets reels de la carte GTB');
    db.pragma('user_version = 109');
  }

  if (current < 110) {
    // Dedup global des sections equipement par AF.
    // Bug : libraryExtendAf() dedupliquait par fratrie uniquement, donc un meme
    // equipment_template (ex: borne-irve, production-electricite avec
    // category='electricite') etait clone sous chaque parent narratif partageant
    // cette categorie. Resultat : "Production d'electricite" en 3.4.8 ET 3.5,
    // "IRVE" en 3.4.4 ET 3.13, etc.
    // Le fix code-level vit dans lib/seeder.js (set globallyExistingTplIds).
    // Cette migration nettoie les AFs deja seedees : pour chaque
    // (af_id, equipment_template_id) en doublon, on garde la section avec la
    // plus petite position (apparition la plus haute du plan = canonique) et
    // on supprime les autres avec leurs cascades.
    const dupes = db.prepare(`
      SELECT af_id, equipment_template_id, COUNT(*) AS n
      FROM sections
      WHERE equipment_template_id IS NOT NULL
      GROUP BY af_id, equipment_template_id
      HAVING n > 1
    `).all();
    let totalRemoved = 0;
    const auditInsert = db.prepare(`
      INSERT INTO audit_log (af_id, action, payload) VALUES (?, ?, ?)
    `);
    const dedupeTx = db.transaction(() => {
      for (const d of dupes) {
        const sectionsForPair = db.prepare(`
          SELECT id, number, position, parent_id
          FROM sections
          WHERE af_id = ? AND equipment_template_id = ?
          ORDER BY position ASC, id ASC
        `).all(d.af_id, d.equipment_template_id);
        const [keep, ...remove] = sectionsForPair;
        if (!remove.length) continue;
        for (const s of remove) {
          db.prepare('DELETE FROM sections WHERE id = ?').run(s.id);
          totalRemoved++;
        }
        auditInsert.run(
          d.af_id,
          'af.dedupe.equipment',
          JSON.stringify({
            equipment_template_id: d.equipment_template_id,
            kept: { id: keep.id, number: keep.number, position: keep.position },
            removed: remove.map(s => ({ id: s.id, number: s.number, position: s.position })),
          })
        );
      }
    });
    dedupeTx();
    log.info(`Migration 110 appliquee : dedup global equipement par AF (${dupes.length} paires, ${totalRemoved} sections supprimees)`);
    db.pragma('user_version = 110');
  }

  if (current < 111) {
    // Override de la description fonctionnelle d'une section equipement au
    // niveau de l'AF, sans toucher au template biblio. Quand NULL, l'AF
    // affiche/exporte la description canonique de equipment_templates ;
    // quand non-NULL, c'est cette valeur qui est rendue. Le bouton
    // "Recuperer depuis le modele" remet la colonne a NULL.
    try { db.exec('ALTER TABLE sections ADD COLUMN description_html_override TEXT'); }
    catch { /* deja ajoutee */ }
    log.info('Migration 111 appliquee : sections.description_html_override');
    db.pragma('user_version = 111');
  }

  if (current < 112) {
    // Refactor catégories : la catégorie système devient le parent direct
    // des équipements dans l'arbo AF, au lieu de passer par des sections
    // narratives intermédiaires (ancien `2.1 Chauffage & Climatisation`,
    // `2.2 Ventilation`...). La colonne `system_category_key` discrimine ces
    // nœuds des sections narratives standard (kind reste 'standard' pour ne
    // pas avoir à toucher au CHECK constraint -- recreate table = lourd).
    try { db.exec('ALTER TABLE sections ADD COLUMN system_category_key TEXT'); }
    catch { /* deja ajoutee */ }
    try { db.exec('CREATE INDEX IF NOT EXISTS idx_sections_system_category ON sections(af_id, system_category_key) WHERE system_category_key IS NOT NULL'); }
    catch { /* idem */ }
    log.info('Migration 112 appliquee : sections.system_category_key + index');
    db.pragma('user_version = 112');
  }

  if (current < 113) {
    // Re-parentage des sections kind='equipment' sous des nœuds catégorie
    // dans chaque AF active. Pour chaque AF :
    //   1) Trouver le chapitre "Périmètre des équipements supervisés" (chap 2).
    //   2) Créer les nœuds catégorie depuis system_categories_db (un par cat).
    //   3) Re-parenter les sections kind='equipment' sous leur catégorie via
    //      equipment_templates.category.
    //   4) Supprimer les anciens parents narratifs (kind='standard' enfants
    //      directs du chap 2 devenus sans descendant).
    // Tout en transaction par AF (rollback si erreur).
    const cats = db.prepare('SELECT key, label, position, icon_value, icon_color FROM system_categories_db ORDER BY position, id').all();
    if (!cats.length) {
      log.warn('Migration 113 : system_categories_db vide, skip refactor (re-run après seed)');
      db.pragma('user_version = 113');
    } else {
      const catByKey = new Map(cats.map(c => [c.key, c]));
      const afs = db.prepare('SELECT id FROM afs WHERE deleted_at IS NULL').all();
      let totalAfs = 0;
      let totalCatsCreated = 0;
      let totalEquipmentMoved = 0;
      let totalNarrativesDeleted = 0;
      const auditInsert = db.prepare(`
        INSERT INTO audit_log (af_id, action, payload) VALUES (?, ?, ?)
      `);

      for (const af of afs) {
        const tx = db.transaction(() => {
          // 1) Trouver le chap 2 : préférer slug='2' du section_template, sinon
          // titre exact, sinon premier top-level après "Préambule".
          let chap2 = db.prepare(`
            SELECT s.id, s.position FROM sections s
            LEFT JOIN section_templates t ON t.id = s.section_template_id
            WHERE s.af_id = ? AND s.parent_id IS NULL AND (
              t.slug = '2' OR s.title = 'Périmètre des équipements supervisés'
              OR s.title LIKE 'Périmètre des équipements%'
            )
            LIMIT 1
          `).get(af.id);
          if (!chap2) return; // AF sans chap 2 — skip

          // 2) Créer les nœuds catégorie sous chap2 (idempotent : skip si déjà créé)
          const existingCatNodes = db.prepare(
            'SELECT id, system_category_key FROM sections WHERE af_id = ? AND parent_id = ? AND system_category_key IS NOT NULL'
          ).all(af.id, chap2.id);
          const catNodeByKey = new Map(existingCatNodes.map(r => [r.system_category_key, r.id]));
          let basePos = (db.prepare(
            'SELECT COALESCE(MAX(position), 0) AS m FROM sections WHERE af_id = ? AND parent_id = ?'
          ).get(af.id, chap2.id)).m;
          const insertCat = db.prepare(`
            INSERT INTO sections (af_id, parent_id, position, number, title, kind, system_category_key, included_in_export)
            VALUES (?, ?, ?, NULL, ?, 'standard', ?, 1)
          `);
          for (const c of cats) {
            if (catNodeByKey.has(c.key)) continue;
            basePos += 10;
            const r = insertCat.run(af.id, chap2.id, basePos, c.label, c.key);
            catNodeByKey.set(c.key, r.lastInsertRowid);
            totalCatsCreated++;
          }

          // 3) Re-parenter les sections kind='equipment' descendantes du chap 2
          // ou ailleurs (cas pathologique) sous leur catégorie.
          const equipSections = db.prepare(`
            SELECT s.id, s.parent_id, s.equipment_template_id, eqt.category, s.position
            FROM sections s
            JOIN equipment_templates eqt ON eqt.id = s.equipment_template_id
            WHERE s.af_id = ? AND s.kind = 'equipment'
          `).all(af.id);
          for (const es of equipSections) {
            const targetParent = catNodeByKey.get(es.category);
            if (!targetParent) continue; // catégorie inconnue — laisse tel quel
            if (es.parent_id === targetParent) continue; // déjà bon
            const maxChildPos = (db.prepare(
              'SELECT COALESCE(MAX(position), 0) AS m FROM sections WHERE af_id = ? AND parent_id = ?'
            ).get(af.id, targetParent)).m;
            db.prepare('UPDATE sections SET parent_id = ?, position = ? WHERE id = ?')
              .run(targetParent, maxChildPos + 10, es.id);
            totalEquipmentMoved++;
          }

          // 4) Supprimer les anciens parents narratifs : enfants directs du
          // chap 2, kind='standard', sans system_category_key (donc pas un
          // nœud catégorie qu'on vient de créer), sans aucun descendant
          // restant.
          const orphanNarratives = db.prepare(`
            SELECT s.id, s.title FROM sections s
            WHERE s.af_id = ?
              AND s.parent_id = ?
              AND s.kind = 'standard'
              AND (s.system_category_key IS NULL)
              AND NOT EXISTS (SELECT 1 FROM sections c WHERE c.parent_id = s.id)
          `).all(af.id, chap2.id);
          for (const o of orphanNarratives) {
            db.prepare('DELETE FROM sections WHERE id = ?').run(o.id);
            totalNarrativesDeleted++;
          }

          auditInsert.run(af.id, 'af.refactor.categories', JSON.stringify({
            chap2_id: chap2.id,
            categories_created: totalCatsCreated,
            equipment_moved: totalEquipmentMoved,
            narratives_deleted: totalNarrativesDeleted,
          }));
        });
        tx();
        totalAfs++;
      }
      log.info(`Migration 113 appliquee : refactor categories sur ${totalAfs} AF(s) — ${totalCatsCreated} cat node(s), ${totalEquipmentMoved} equipement(s) re-parente(s), ${totalNarrativesDeleted} narratif(s) supprimé(s)`);
      db.pragma('user_version = 113');
    }
  }

  if (current < 114) {
    // Finalisation refactor categories :
    //   (a) Rattrape les sections AF kind='equipment' avec equipment_template_id
    //       NULL mais section_template_id non null (heritage Lot 33). Met a
    //       jour sections.equipment_template_id depuis le section_template lie.
    //   (b) Re-applique le re-parentage de mig 113 pour ces sections nouvellement
    //       reliees.
    //   (c) Supprime les anciens parents narratifs maintenant orphelins.
    //   (d) Tombstone + DELETE des section_templates narratifs intermediaires
    //       (slugs '2.1', '2.2', '2.4', '2.6', '2.8' du plan-af). Empeche le
    //       seedSectionTemplatesOnBoot de les recreer.

    // (a) Set equipment_template_id quand heritable depuis section_template
    const fixedRes = db.prepare(`
      UPDATE sections SET equipment_template_id = (
        SELECT st.equipment_template_id FROM section_templates st
        WHERE st.id = sections.section_template_id
      )
      WHERE kind = 'equipment'
        AND equipment_template_id IS NULL
        AND section_template_id IS NOT NULL
        AND (SELECT st.equipment_template_id FROM section_templates st WHERE st.id = sections.section_template_id) IS NOT NULL
    `).run();

    // (b) + (c) Re-applique re-parentage sur ces sections + cleanup narratifs
    const cats114 = db.prepare('SELECT key, label, position FROM system_categories_db ORDER BY position, id').all();
    let movedAdditional = 0;
    let narrativesDeletedAdditional = 0;
    if (cats114.length) {
      const afs = db.prepare('SELECT id FROM afs WHERE deleted_at IS NULL').all();
      const auditInsert = db.prepare(`INSERT INTO audit_log (af_id, action, payload) VALUES (?, ?, ?)`);
      for (const af of afs) {
        const tx = db.transaction(() => {
          const chap2 = db.prepare(`
            SELECT s.id FROM sections s
            LEFT JOIN section_templates t ON t.id = s.section_template_id
            WHERE s.af_id = ? AND s.parent_id IS NULL AND (
              t.slug = '2' OR s.title LIKE 'Périmètre des équipements%'
            )
            LIMIT 1
          `).get(af.id);
          if (!chap2) return;
          const catNodes = db.prepare(`
            SELECT id, system_category_key FROM sections
            WHERE af_id = ? AND parent_id = ? AND system_category_key IS NOT NULL
          `).all(af.id, chap2.id);
          const catNodeByKey = new Map(catNodes.map(r => [r.system_category_key, r.id]));
          const equipSections = db.prepare(`
            SELECT s.id, s.parent_id, eqt.category
            FROM sections s
            JOIN equipment_templates eqt ON eqt.id = s.equipment_template_id
            WHERE s.af_id = ? AND s.kind = 'equipment'
          `).all(af.id);
          let localMoved = 0;
          for (const es of equipSections) {
            const target = catNodeByKey.get(es.category);
            if (!target || es.parent_id === target) continue;
            const maxP = (db.prepare('SELECT COALESCE(MAX(position),0) AS m FROM sections WHERE af_id = ? AND parent_id = ?').get(af.id, target)).m;
            db.prepare('UPDATE sections SET parent_id = ?, position = ? WHERE id = ?').run(target, maxP + 10, es.id);
            localMoved++;
          }
          // Cleanup recursif des narratifs orphelins (multi-passes : un narratif
          // peut devenir orphelin apres suppression d'un autre narratif).
          let localDeleted = 0;
          let pass;
          do {
            const orphans = db.prepare(`
              SELECT s.id FROM sections s
              WHERE s.af_id = ? AND s.parent_id = ? AND s.kind = 'standard'
                AND s.system_category_key IS NULL
                AND NOT EXISTS (SELECT 1 FROM sections c WHERE c.parent_id = s.id)
            `).all(af.id, chap2.id);
            pass = orphans.length;
            for (const o of orphans) {
              db.prepare('DELETE FROM sections WHERE id = ?').run(o.id);
              localDeleted++;
            }
          } while (pass > 0);
          movedAdditional += localMoved;
          narrativesDeletedAdditional += localDeleted;
          if (localMoved || localDeleted) {
            auditInsert.run(af.id, 'af.refactor.categories.finalize', JSON.stringify({
              moved: localMoved, deleted_narratives: localDeleted,
            }));
          }
        });
        tx();
      }
    }
    log.info(`Migration 114 (a/b/c) : ${fixedRes.changes} section(s) re-link, ${movedAdditional} re-parente(s), ${narrativesDeletedAdditional} narratif(s) supprime(s)`);

    // (d) Tombstone + DELETE des section_templates narratifs intermediaires
    // (slugs '2.1', '2.2', '2.4', '2.6', '2.8'). Detacher les enfants
    // section_templates avant DELETE (parent_template_id n'a pas
    // ON DELETE CASCADE) — on les promote en orphelins (parent NULL),
    // ils ne seront plus instancies par seedAfStructure (filtre kind=equipment
    // && !equipment_template_id) mais ne sont pas non plus reseed (ils
    // existent deja en DB).
    const obsoleteNarrativeSlugs = ['2.1', '2.2', '2.4', '2.6', '2.8'];
    let tombstoned = 0;
    let deleted = 0;
    for (const slug of obsoleteNarrativeSlugs) {
      try {
        const ts = db.prepare('INSERT OR IGNORE INTO deleted_section_template_slugs (slug) VALUES (?)').run(slug);
        if (ts.changes) tombstoned++;
      } catch { /* table might not exist on very old DBs — safe to skip */ }
      const tplRow = db.prepare('SELECT id FROM section_templates WHERE slug = ?').get(slug);
      if (!tplRow) continue;
      // Detacher les enfants section_templates AVANT DELETE
      db.prepare('UPDATE section_templates SET parent_template_id = NULL WHERE parent_template_id = ?').run(tplRow.id);
      // SET NULL aussi sur sections.section_template_id (devrait etre auto par
      // FK SET NULL declare a la mig 30, mais securisons).
      db.prepare('UPDATE sections SET section_template_id = NULL WHERE section_template_id = ?').run(tplRow.id);
      const del = db.prepare('DELETE FROM section_templates WHERE id = ?').run(tplRow.id);
      deleted += del.changes;
    }
    log.info(`Migration 114 (d) : ${tombstoned} tombstone(s), ${deleted} section_template(s) narratif(s) supprime(s)`);
    db.pragma('user_version = 114');
  }

  if (current < 115) {
    // Aligne equipment_templates.category sur system_categories_db.key.
    // Bug historique : certaines categories en DB ne matchent aucune key
    // (ex: 'electricite', 'eclairage') -> equipements jamais re-parentes
    // par mig 113/114. On unifie ici, puis on repete le re-parentage.
    const remaps = [
      { slug: 'production-electricite', cat: 'pv' },
      { slug: 'borne-irve',             cat: 'autres' },
      { slug: 'prises-pilotees',        cat: 'prises' },
      { slug: 'contacteur-pilote',      cat: 'autres' },
      { slug: 'disjoncteur-of',         cat: 'autres' },
      { slug: 'disjoncteur-sd',         cat: 'autres' },
      { slug: 'eclairage-interieur',    cat: 'eclairage_int' },
      { slug: 'eclairage-exterieur',    cat: 'eclairage_ext' },
    ];
    let remapped = 0;
    for (const r of remaps) {
      const res = db.prepare('UPDATE equipment_templates SET category = ? WHERE slug = ? AND category != ?')
        .run(r.cat, r.slug, r.cat);
      if (res.changes) remapped++;
    }
    log.info(`Migration 115 : ${remapped} equipment_template(s) re-categorise(s)`);

    // Re-applique le re-parentage de mig 114 (categories nouvellement alignees)
    const cats115 = db.prepare('SELECT key FROM system_categories_db ORDER BY position').all();
    if (cats115.length) {
      const afs = db.prepare('SELECT id FROM afs WHERE deleted_at IS NULL').all();
      let movedFinal = 0;
      let narrativesDeletedFinal = 0;
      for (const af of afs) {
        const tx = db.transaction(() => {
          const chap2 = db.prepare(`
            SELECT s.id FROM sections s
            LEFT JOIN section_templates t ON t.id = s.section_template_id
            WHERE s.af_id = ? AND s.parent_id IS NULL AND (
              t.slug = '2' OR s.title LIKE 'Périmètre des équipements%'
            )
            LIMIT 1
          `).get(af.id);
          if (!chap2) return;
          const catNodes = db.prepare(`
            SELECT id, system_category_key FROM sections
            WHERE af_id = ? AND parent_id = ? AND system_category_key IS NOT NULL
          `).all(af.id, chap2.id);
          const catNodeByKey = new Map(catNodes.map(r => [r.system_category_key, r.id]));
          const equipSections = db.prepare(`
            SELECT s.id, s.parent_id, eqt.category
            FROM sections s
            JOIN equipment_templates eqt ON eqt.id = s.equipment_template_id
            WHERE s.af_id = ? AND s.kind = 'equipment'
          `).all(af.id);
          for (const es of equipSections) {
            const target = catNodeByKey.get(es.category);
            if (!target || es.parent_id === target) continue;
            const maxP = (db.prepare('SELECT COALESCE(MAX(position),0) AS m FROM sections WHERE af_id = ? AND parent_id = ?').get(af.id, target)).m;
            db.prepare('UPDATE sections SET parent_id = ?, position = ? WHERE id = ?').run(target, maxP + 10, es.id);
            movedFinal++;
          }
          // Cleanup narratifs orphelins (multi-passes)
          let pass;
          do {
            const orphans = db.prepare(`
              SELECT s.id FROM sections s
              WHERE s.af_id = ? AND s.parent_id = ? AND s.kind = 'standard'
                AND s.system_category_key IS NULL
                AND NOT EXISTS (SELECT 1 FROM sections c WHERE c.parent_id = s.id)
            `).all(af.id, chap2.id);
            pass = orphans.length;
            for (const o of orphans) {
              db.prepare('DELETE FROM sections WHERE id = ?').run(o.id);
              narrativesDeletedFinal++;
            }
          } while (pass > 0);
        });
        tx();
      }
      log.info(`Migration 115 (re-parent) : ${movedFinal} re-parente(s), ${narrativesDeletedFinal} narratif(s) supprime(s)`);
    }
    db.pragma('user_version = 115');
  }

  if (current < 116) {
    // Ordre stable des equipment_templates dans la biblio (et donc dans l'arbo
    // AF apres libraryExtendAf). Ajout d'une colonne `position`. Initialise
    // par categorie en numerotant les rows existants par ordre alphabetique
    // du nom (ordre actuel par defaut).
    try { db.exec('ALTER TABLE equipment_templates ADD COLUMN position INTEGER NOT NULL DEFAULT 0'); }
    catch { /* deja ajoutee */ }
    // Backfill : pour chaque categorie, numerote les rows par ordre alpha (ordre actuel)
    const rowsByCat = db.prepare('SELECT id, category, name FROM equipment_templates ORDER BY category, name').all();
    const posByCat = new Map();
    const updateStmt = db.prepare('UPDATE equipment_templates SET position = ? WHERE id = ?');
    const tx = db.transaction(() => {
      for (const r of rowsByCat) {
        const k = r.category || '';
        const next = (posByCat.get(k) || 0) + 10;
        posByCat.set(k, next);
        updateStmt.run(next, r.id);
      }
    });
    tx();
    log.info(`Migration 116 appliquee : equipment_templates.position seede sur ${rowsByCat.length} row(s)`);
    db.pragma('user_version = 116');
  }

  if (current < 117) {
    // Multi-niveau : `default_device_role` (equipment_templates) et
    // `device_role` (bacs_audit_system_devices) passent de string scalaire
    // a JSON array dans la meme colonne TEXT. Idempotent : si la valeur
    // est deja un JSON array valide, ne touche pas.
    function toJsonArray(val) {
      if (val == null) return null;
      const s = String(val).trim();
      if (!s) return null;
      if (s.startsWith('[')) {
        try { const parsed = JSON.parse(s); if (Array.isArray(parsed)) return s; } catch { /* legacy */ }
      }
      return JSON.stringify([s]);
    }
    let tplCount = 0;
    let devCount = 0;
    const tx = db.transaction(() => {
      const tplRows = db.prepare('SELECT id, default_device_role FROM equipment_templates WHERE default_device_role IS NOT NULL').all();
      const updTpl = db.prepare('UPDATE equipment_templates SET default_device_role = ? WHERE id = ?');
      for (const r of tplRows) {
        const next = toJsonArray(r.default_device_role);
        if (next !== r.default_device_role) { updTpl.run(next, r.id); tplCount++; }
      }
      const devRows = db.prepare('SELECT id, device_role FROM bacs_audit_system_devices WHERE device_role IS NOT NULL').all();
      const updDev = db.prepare('UPDATE bacs_audit_system_devices SET device_role = ? WHERE id = ?');
      for (const r of devRows) {
        const next = toJsonArray(r.device_role);
        if (next !== r.device_role) { updDev.run(next, r.id); devCount++; }
      }
    });
    tx();
    log.info(`Migration 117 appliquee : default_device_role/device_role -> JSON array (${tplCount} tpl + ${devCount} devices migres)`);
    db.pragma('user_version = 117');
  }

  if (current < 118) {
    // Ajout des FK manquantes pour le rattachement template/instance ↔
    // categorie systeme. Historique : `equipment_templates.category` et
    // `equipment_instance_categories.category_key` etaient des TEXT libres
    // sans FK -- valeurs orphelines silencieuses possibles, rename de
    // categorie key necessitait une cascade manuelle.
    //
    // Cette mig recree les 2 tables avec FK :
    //   REFERENCES system_categories_db(key) ON UPDATE CASCADE ON DELETE NO ACTION
    // - ON UPDATE CASCADE : un rename de key propage automatiquement
    //   (plus besoin du UPDATE manuel dans la route PATCH).
    // - ON DELETE NO ACTION : interdit le DELETE direct, force a passer
    //   par le guard 409 de la route DELETE.
    //
    // Note : `sections.system_category_key` n'est PAS migrée ici. La table
    // sections est trop massive et lourde de dependances pour un recreate
    // safe en prod ; la cascade manuelle dans la route PATCH reste en place
    // pour cette colonne.
    //
    // Pre-check : nettoyer les orphelines pour ne pas faire echouer le
    // recreate (FK strict). Les orphelines deviennent NULL.
    const orphTplCleanup = db.prepare(`
      UPDATE equipment_templates SET category = NULL
      WHERE category IS NOT NULL AND category NOT IN (SELECT key FROM system_categories_db)
    `).run();
    const orphInstCleanup = db.prepare(`
      DELETE FROM equipment_instance_categories
      WHERE category_key NOT IN (SELECT key FROM system_categories_db)
    `).run();
    if (orphTplCleanup.changes || orphInstCleanup.changes) {
      log.warn(`Migration 118 : orphelines nettoyees avant recreate FK -- ${orphTplCleanup.changes} equipment_templates.category, ${orphInstCleanup.changes} equipment_instance_categories rows`);
    }

    db.pragma('foreign_keys = OFF');
    const tx = db.transaction(() => {
      // === equipment_templates ===
      db.exec(`
        CREATE TABLE equipment_templates_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          slug TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          category TEXT REFERENCES system_categories_db(key) ON UPDATE CASCADE ON DELETE NO ACTION,
          bacs_articles TEXT,
          description_html TEXT,
          icon_kind TEXT,
          icon_value TEXT,
          icon_color TEXT,
          current_version INTEGER NOT NULL DEFAULT 1,
          created_by INTEGER REFERENCES users(id),
          updated_by INTEGER REFERENCES users(id),
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          preferred_protocols TEXT,
          bacs_justification TEXT,
          content_validated_at TEXT,
          content_validated_by INTEGER REFERENCES users(id),
          default_energy_source TEXT,
          default_device_role TEXT,
          position INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO equipment_templates_new SELECT * FROM equipment_templates;
        DROP TABLE equipment_templates;
        ALTER TABLE equipment_templates_new RENAME TO equipment_templates;
      `);
      // === equipment_instance_categories ===
      db.exec(`
        CREATE TABLE equipment_instance_categories_new (
          instance_id INTEGER NOT NULL REFERENCES equipment_instances(id) ON DELETE CASCADE,
          category_key TEXT NOT NULL REFERENCES system_categories_db(key) ON UPDATE CASCADE ON DELETE CASCADE,
          PRIMARY KEY (instance_id, category_key)
        );
        INSERT INTO equipment_instance_categories_new SELECT * FROM equipment_instance_categories;
        DROP TABLE equipment_instance_categories;
        ALTER TABLE equipment_instance_categories_new RENAME TO equipment_instance_categories;
        CREATE INDEX IF NOT EXISTS idx_eic_instance ON equipment_instance_categories(instance_id);
      `);
    });
    tx();

    // Validation integrite + reactivation FK
    const fkErrors = db.prepare('PRAGMA foreign_key_check').all();
    if (fkErrors.length) {
      log.error({ fkErrors }, 'Migration 118 : FK errors detectes apres recreate');
      throw new Error('Migration 118 echouee : FK errors -- ' + JSON.stringify(fkErrors));
    }
    db.pragma('foreign_keys = ON');
    log.info('Migration 118 appliquee : FK posees sur equipment_templates.category + equipment_instance_categories.category_key (ON UPDATE CASCADE ON DELETE NO ACTION/CASCADE)');
    db.pragma('user_version = 118');
  }

  if (current < 119) {
    // Finalisation des FK categorie : `sections.system_category_key` rejoint
    // les autres avec FK ON UPDATE CASCADE ON DELETE SET NULL.
    // Recreate de la table sections avec preservation de tous les indexes
    // et du trigger sections_fts_delete.
    //
    // Pre-check : nettoyer orphelines avant le recreate (sinon FK strict
    // rejette).
    const orphSecCleanup = db.prepare(`
      UPDATE sections SET system_category_key = NULL
      WHERE system_category_key IS NOT NULL
        AND system_category_key NOT IN (SELECT key FROM system_categories_db)
    `).run();
    if (orphSecCleanup.changes) {
      log.warn(`Migration 119 : ${orphSecCleanup.changes} sections.system_category_key orphelines mises a NULL avant recreate FK`);
    }

    db.pragma('foreign_keys = OFF');
    const tx = db.transaction(() => {
      db.exec(`
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
          updated_by INTEGER REFERENCES users(id),
          section_template_id INTEGER REFERENCES section_templates(id),
          section_template_version INTEGER,
          opted_out_by_moa INTEGER NOT NULL DEFAULT 0,
          demanded_by_moa INTEGER NOT NULL DEFAULT 0,
          optin_paid_option INTEGER NOT NULL DEFAULT 0,
          description_html_override TEXT,
          system_category_key TEXT REFERENCES system_categories_db(key) ON UPDATE CASCADE ON DELETE SET NULL
        );
        INSERT INTO sections_new SELECT
          id, af_id, parent_id, position, number, title, service_level,
          service_level_source, bacs_articles, bacs_justification, body_html,
          body_yjs, kind, included_in_export, generic_note, fact_check_status,
          equipment_template_id, equipment_template_version, hyperveez_page_slug,
          created_at, updated_at, updated_by, section_template_id,
          section_template_version, opted_out_by_moa, demanded_by_moa,
          optin_paid_option, description_html_override, system_category_key
        FROM sections;
        -- Le trigger sections_fts_delete est ON DELETE FROM sections, donc
        -- DROP TABLE sections le supprime aussi. On le recree apres rename.
        DROP TABLE sections;
        ALTER TABLE sections_new RENAME TO sections;
        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_sections_af_parent ON sections(af_id, parent_id, position);
        CREATE INDEX IF NOT EXISTS idx_sections_kind ON sections(af_id, kind);
        CREATE INDEX IF NOT EXISTS idx_sections_template ON sections(equipment_template_id) WHERE equipment_template_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_sections_system_category ON sections(af_id, system_category_key) WHERE system_category_key IS NOT NULL;
        -- Trigger FTS delete (sync sections_fts)
        CREATE TRIGGER IF NOT EXISTS sections_fts_delete
          AFTER DELETE ON sections BEGIN
            DELETE FROM sections_fts WHERE section_id = old.id;
          END;
      `);
    });
    tx();
    const fkErrors = db.prepare('PRAGMA foreign_key_check').all();
    if (fkErrors.length) {
      log.error({ fkErrors }, 'Migration 119 : FK errors detectes');
      throw new Error('Migration 119 echouee : FK errors -- ' + JSON.stringify(fkErrors));
    }
    db.pragma('foreign_keys = ON');
    log.info('Migration 119 appliquee : FK sections.system_category_key -> system_categories_db.key (ON UPDATE CASCADE ON DELETE SET NULL) + indexes + trigger FTS preserves');
    db.pragma('user_version = 119');
  }

  if (current < 120) {
    // CHECK constraints sur les enums TEXT qui n'en avaient pas. Empeche les
    // INSERT directs (CSV / scripts maint / nouvelles routes mal validees)
    // d'introduire des valeurs orphelines silencieuses.
    //
    // 3 tables affectees :
    //   - equipment_template_points.fact_check_status (5 valeurs)
    //   - sections.fact_check_status (5 valeurs, meme set)
    //   - equipments.communication_protocol (10 valeurs)
    //
    // Toutes par recreate de la table (SQLite ne permet pas d'ajouter un
    // CHECK constraint a une colonne existante sans recreate).
    //
    // Pre-check : on identifie les valeurs orphelines existantes et on les
    // resette a la valeur par defaut ('unverified' / NULL) pour ne pas
    // faire echouer l'INSERT au recreate (CHECK strict).
    const FACT_CHECK_VALID = ['unverified', 'verified', 'backend_only', 'in_progress', 'documented'];
    const COMM_PROTO_VALID = ['modbus_tcp','modbus_rtu','bacnet_ip','bacnet_mstp','knx','mbus','mqtt','analog','none','other'];

    const orphFcEtp = db.prepare(`
      UPDATE equipment_template_points SET fact_check_status = 'unverified'
      WHERE fact_check_status NOT IN (${FACT_CHECK_VALID.map(() => '?').join(',')})
    `).run(...FACT_CHECK_VALID);
    const orphFcSec = db.prepare(`
      UPDATE sections SET fact_check_status = 'unverified'
      WHERE fact_check_status IS NOT NULL
        AND fact_check_status NOT IN (${FACT_CHECK_VALID.map(() => '?').join(',')})
    `).run(...FACT_CHECK_VALID);
    const orphCommEq = db.prepare(`
      UPDATE equipments SET communication_protocol = NULL
      WHERE communication_protocol IS NOT NULL
        AND communication_protocol NOT IN (${COMM_PROTO_VALID.map(() => '?').join(',')})
    `).run(...COMM_PROTO_VALID);
    if (orphFcEtp.changes || orphFcSec.changes || orphCommEq.changes) {
      log.warn(`Migration 120 : valeurs orphelines normalisees avant CHECK -- ${orphFcEtp.changes} ETP.fact_check, ${orphFcSec.changes} sections.fact_check, ${orphCommEq.changes} equipments.communication_protocol`);
    }

    db.pragma('foreign_keys = OFF');
    const tx = db.transaction(() => {
      // === equipment_template_points (fact_check_status CHECK) ===
      db.exec(`
        CREATE TABLE equipment_template_points_new (
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
          fact_check_status TEXT DEFAULT 'unverified'
            CHECK (fact_check_status IN ('unverified','verified','backend_only','in_progress','documented')),
          fact_check_url TEXT,
          tech_name TEXT,
          nature TEXT,
          UNIQUE(template_id, slug)
        );
        INSERT INTO equipment_template_points_new SELECT
          id, template_id, slug, position, label, data_type, direction,
          unit, notes, is_optional, hyperveez_facets, fact_check_status,
          fact_check_url, tech_name, nature
        FROM equipment_template_points;
        DROP TABLE equipment_template_points;
        ALTER TABLE equipment_template_points_new RENAME TO equipment_template_points;
        CREATE INDEX IF NOT EXISTS idx_etp_template ON equipment_template_points(template_id, position);
      `);

      // === sections (fact_check_status CHECK + tout le reste preserve) ===
      db.exec(`
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
          fact_check_status TEXT DEFAULT 'unverified'
            CHECK (fact_check_status IS NULL OR fact_check_status IN ('unverified','verified','backend_only','in_progress','documented')),
          equipment_template_id INTEGER REFERENCES equipment_templates(id),
          equipment_template_version INTEGER,
          hyperveez_page_slug TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_by INTEGER REFERENCES users(id),
          section_template_id INTEGER REFERENCES section_templates(id),
          section_template_version INTEGER,
          opted_out_by_moa INTEGER NOT NULL DEFAULT 0,
          demanded_by_moa INTEGER NOT NULL DEFAULT 0,
          optin_paid_option INTEGER NOT NULL DEFAULT 0,
          description_html_override TEXT,
          system_category_key TEXT REFERENCES system_categories_db(key) ON UPDATE CASCADE ON DELETE SET NULL
        );
        INSERT INTO sections_new SELECT
          id, af_id, parent_id, position, number, title, service_level,
          service_level_source, bacs_articles, bacs_justification, body_html,
          body_yjs, kind, included_in_export, generic_note, fact_check_status,
          equipment_template_id, equipment_template_version, hyperveez_page_slug,
          created_at, updated_at, updated_by, section_template_id,
          section_template_version, opted_out_by_moa, demanded_by_moa,
          optin_paid_option, description_html_override, system_category_key
        FROM sections;
        DROP TABLE sections;
        ALTER TABLE sections_new RENAME TO sections;
        CREATE INDEX IF NOT EXISTS idx_sections_af_parent ON sections(af_id, parent_id, position);
        CREATE INDEX IF NOT EXISTS idx_sections_kind ON sections(af_id, kind);
        CREATE INDEX IF NOT EXISTS idx_sections_template ON sections(equipment_template_id) WHERE equipment_template_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_sections_system_category ON sections(af_id, system_category_key) WHERE system_category_key IS NOT NULL;
        CREATE TRIGGER IF NOT EXISTS sections_fts_delete
          AFTER DELETE ON sections BEGIN
            DELETE FROM sections_fts WHERE section_id = old.id;
          END;
      `);

      // === equipments (communication_protocol CHECK) ===
      db.exec(`
        CREATE TABLE equipments_new (
          equipment_id INTEGER PRIMARY KEY AUTOINCREMENT,
          zone_id INTEGER NOT NULL REFERENCES zones(zone_id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          power_kw REAL,
          communication_protocol TEXT
            CHECK (communication_protocol IS NULL OR communication_protocol IN
              ('modbus_tcp','modbus_rtu','bacnet_ip','bacnet_mstp','knx','mbus','mqtt','analog','none','other')),
          installation_date TEXT,
          status TEXT NOT NULL DEFAULT 'operational'
            CHECK (status IN ('designed','commissioned','tested','operational','decommissioned')),
          bacs_classification TEXT,
          notes TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          deleted_at TEXT
        );
        INSERT INTO equipments_new SELECT
          equipment_id, zone_id, name, type, power_kw, communication_protocol,
          installation_date, status, bacs_classification, notes,
          created_at, updated_at, deleted_at
        FROM equipments;
        DROP TABLE equipments;
        ALTER TABLE equipments_new RENAME TO equipments;
        CREATE INDEX IF NOT EXISTS idx_equipments_zone ON equipments(zone_id);
        CREATE INDEX IF NOT EXISTS idx_equipments_type ON equipments(type);
      `);
    });
    tx();
    const fkErrors = db.prepare('PRAGMA foreign_key_check').all();
    if (fkErrors.length) {
      log.error({ fkErrors }, 'Migration 120 : FK errors detectes');
      throw new Error('Migration 120 echouee : FK errors -- ' + JSON.stringify(fkErrors));
    }
    db.pragma('foreign_keys = ON');
    log.info('Migration 120 appliquee : CHECK constraints sur fact_check_status (ETP+sections) + communication_protocol (equipments)');
    db.pragma('user_version = 120');
  }

  if (current < 121) {
    // Drop colonne morte `system_categories_db.slugs` : depuis la PR #124
    // (mig precedente non versionnee), la valeur est calculee a la volee
    // dans systemCategoriesDb.list/getById/getByKey via :
    //   SELECT slug FROM equipment_templates WHERE category = ? ORDER BY name
    // La colonne stockee n'est plus la verite et peut diverger silencieusement.
    db.pragma('foreign_keys = OFF');
    const tx = db.transaction(() => {
      db.exec(`
        CREATE TABLE system_categories_db_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL UNIQUE,
          label TEXT NOT NULL,
          bacs TEXT,
          icon_value TEXT DEFAULT 'fa-cube',
          icon_color TEXT DEFAULT '#6b7280',
          position INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO system_categories_db_new
          (id, key, label, bacs, icon_value, icon_color, position)
        SELECT id, key, label, bacs, icon_value, icon_color, position
        FROM system_categories_db;
        DROP TABLE system_categories_db;
        ALTER TABLE system_categories_db_new RENAME TO system_categories_db;
      `);
    });
    tx();
    const fkErrors = db.prepare('PRAGMA foreign_key_check').all();
    if (fkErrors.length) {
      log.error({ fkErrors }, 'Migration 121 : FK errors detectes');
      throw new Error('Migration 121 echouee : FK errors -- ' + JSON.stringify(fkErrors));
    }
    db.pragma('foreign_keys = ON');
    log.info('Migration 121 appliquee : colonne morte system_categories_db.slugs supprimee (calcul a la volee depuis equipment_templates.category)');
    db.pragma('user_version = 121');
  }

  if (current < 122) {
    // FK manquantes ON DELETE SET NULL sur sections : `equipment_template_id`
    // et `section_template_id` etaient en NO ACTION. Concretement, DELETE
    // d'un equipment_template ou d'un section_template echouait avec
    // SQLITE_CONSTRAINT_FOREIGNKEY si une section pointait dessus, meme
    // quand l'AF etait soft-deletee. On contournait avec un UPDATE manuel
    // dans les routes DELETE des templates. Mieux : que la FK fasse le job.
    //
    // Ce 4e recreate de sections ajoute :
    //   equipment_template_id REFERENCES equipment_templates(id) ON DELETE SET NULL
    //   section_template_id REFERENCES section_templates(id) ON DELETE SET NULL
    // (Les autres FK et le CHECK fact_check_status restent inchanges.)
    db.pragma('foreign_keys = OFF');
    const tx = db.transaction(() => {
      db.exec(`
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
          fact_check_status TEXT DEFAULT 'unverified'
            CHECK (fact_check_status IS NULL OR fact_check_status IN ('unverified','verified','backend_only','in_progress','documented')),
          equipment_template_id INTEGER REFERENCES equipment_templates(id) ON DELETE SET NULL,
          equipment_template_version INTEGER,
          hyperveez_page_slug TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_by INTEGER REFERENCES users(id),
          section_template_id INTEGER REFERENCES section_templates(id) ON DELETE SET NULL,
          section_template_version INTEGER,
          opted_out_by_moa INTEGER NOT NULL DEFAULT 0,
          demanded_by_moa INTEGER NOT NULL DEFAULT 0,
          optin_paid_option INTEGER NOT NULL DEFAULT 0,
          description_html_override TEXT,
          system_category_key TEXT REFERENCES system_categories_db(key) ON UPDATE CASCADE ON DELETE SET NULL
        );
        INSERT INTO sections_new SELECT
          id, af_id, parent_id, position, number, title, service_level,
          service_level_source, bacs_articles, bacs_justification, body_html,
          body_yjs, kind, included_in_export, generic_note, fact_check_status,
          equipment_template_id, equipment_template_version, hyperveez_page_slug,
          created_at, updated_at, updated_by, section_template_id,
          section_template_version, opted_out_by_moa, demanded_by_moa,
          optin_paid_option, description_html_override, system_category_key
        FROM sections;
        DROP TABLE sections;
        ALTER TABLE sections_new RENAME TO sections;
        CREATE INDEX IF NOT EXISTS idx_sections_af_parent ON sections(af_id, parent_id, position);
        CREATE INDEX IF NOT EXISTS idx_sections_kind ON sections(af_id, kind);
        CREATE INDEX IF NOT EXISTS idx_sections_template ON sections(equipment_template_id) WHERE equipment_template_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_sections_system_category ON sections(af_id, system_category_key) WHERE system_category_key IS NOT NULL;
        CREATE TRIGGER IF NOT EXISTS sections_fts_delete
          AFTER DELETE ON sections BEGIN
            DELETE FROM sections_fts WHERE section_id = old.id;
          END;
      `);
    });
    tx();
    const fkErrors = db.prepare('PRAGMA foreign_key_check').all();
    if (fkErrors.length) {
      log.error({ fkErrors }, 'Migration 122 : FK errors detectes');
      throw new Error('Migration 122 echouee : FK errors -- ' + JSON.stringify(fkErrors));
    }
    db.pragma('foreign_keys = ON');
    log.info('Migration 122 appliquee : sections.equipment_template_id + sections.section_template_id passent en ON DELETE SET NULL');
    db.pragma('user_version = 122');
  }

  if (current < 123) {
    // Convention PK uniforme : les 3 tables historiques avec PK `<table>_id`
    // sont renommees en `id` (cohrence avec les tables modernes : afs, sections,
    // equipment_templates, system_categories_db, etc.)
    //   - sites.site_id -> sites.id
    //   - zones.zone_id -> zones.id
    //   - equipments.equipment_id -> equipments.id
    //
    // SQLite 3.26+ propage automatiquement le RENAME COLUMN aux FK descendantes
    // (les FK qui referencent `zones(zone_id)` deviennent `zones(id)`). Pas de
    // recreate massif requis. Les FK COLUMNS portees par les tables enfant
    // gardent leur nom (ex: equipments.zone_id, afs.site_id), c'est juste la
    // PK qui change.
    db.exec('ALTER TABLE sites RENAME COLUMN site_id TO id');
    db.exec('ALTER TABLE zones RENAME COLUMN zone_id TO id');
    db.exec('ALTER TABLE equipments RENAME COLUMN equipment_id TO id');
    const fkErrors = db.prepare('PRAGMA foreign_key_check').all();
    if (fkErrors.length) {
      log.error({ fkErrors }, 'Migration 123 : FK errors detectes');
      throw new Error('Migration 123 echouee : FK errors -- ' + JSON.stringify(fkErrors));
    }
    log.info('Migration 123 appliquee : sites/zones/equipments PK renommees en `id` (FK descendantes propagees automatiquement par SQLite)');
    db.pragma('user_version = 123');
  }

  if (current < 124) {
    // Soft-delete uniformise (Lot 2). On ajoute deleted_at sur users
    // pour preserver l'audit trail (FK created_by/updated_by/uploaded_by
    // pointent vers users, on ne peut pas hard-delete sans casser).
    db.exec(`
      ALTER TABLE users ADD COLUMN deleted_at TEXT;
      CREATE INDEX IF NOT EXISTS idx_users_active ON users(deleted_at) WHERE deleted_at IS NULL;
    `);
    log.info('Migration 124 appliquee : users.deleted_at ajoute (soft-delete uniformise)');
    db.pragma('user_version = 124');
  }

  if (current < 125) {
    // Polymorphisme type (Lot 3) : action_items remplace
    // (source_table TEXT, source_id INTEGER) par 6 FK colonnes nullables
    // avec ON DELETE CASCADE et un CHECK "au plus 1 FK non-NULL".
    //
    // Avantages :
    //   - Integrite referentielle DB (orphan impossibles a la creation)
    //   - Cascade automatique : supprimer un device -> ses action_items
    //     disparaissent (au lieu de devenir des orphelins silencieux).
    //   - Plus de string libre 'systems'/'meters'/etc. mal typee.
    //
    // BMS : la table bacs_audit_bms a une PK = document_id (1:1 avec
    // afs), donc source_bms_document_id reference afs(id). Le
    // discriminator entre les differents checks BMS (R175-3 P1, P2,
    // maintenance, training, data_provision_*) passe via source_subtype.
    //
    // Orphans : 10 lignes pre-existantes pointent vers des devices/meters
    // hard-deletes. Pour preserver les donnees, on les migre avec FK=NULL
    // (l'item devient "deconnecte de sa source" mais reste visible).
    db.pragma('foreign_keys = OFF');
    const m125tx = db.transaction(() => {
      db.exec(`
        CREATE TABLE bacs_audit_action_items_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          document_id INTEGER NOT NULL REFERENCES afs(id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          severity TEXT NOT NULL CHECK (severity IN ('blocking','major','minor')),
          r175_article TEXT,
          title TEXT NOT NULL,
          description TEXT,
          zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL,
          equipment_id INTEGER REFERENCES equipments(id) ON DELETE SET NULL,
          source_system_id INTEGER REFERENCES bacs_audit_systems(id) ON DELETE CASCADE,
          source_meter_id INTEGER REFERENCES bacs_audit_meters(id) ON DELETE CASCADE,
          source_thermal_id INTEGER REFERENCES bacs_audit_thermal_regulation(id) ON DELETE CASCADE,
          source_device_id INTEGER REFERENCES bacs_audit_system_devices(id) ON DELETE CASCADE,
          source_inspection_id INTEGER REFERENCES bacs_audit_inspections(id) ON DELETE CASCADE,
          source_bms_document_id INTEGER REFERENCES afs(id) ON DELETE CASCADE,
          source_subtype TEXT,
          auto_generated INTEGER NOT NULL DEFAULT 1,
          commercial_notes TEXT,
          estimated_effort TEXT CHECK (estimated_effort IS NULL OR estimated_effort IN ('low','medium','high')),
          status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','quoted','in_progress','done','declined')),
          position INTEGER NOT NULL DEFAULT 0,
          alternative_solutions_html TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          CHECK (
            (source_system_id IS NOT NULL) +
            (source_meter_id IS NOT NULL) +
            (source_thermal_id IS NOT NULL) +
            (source_device_id IS NOT NULL) +
            (source_inspection_id IS NOT NULL) +
            (source_bms_document_id IS NOT NULL) <= 1
          )
        );

        INSERT INTO bacs_audit_action_items_new (
          id, document_id, category, severity, r175_article, title, description,
          zone_id, equipment_id,
          source_system_id, source_meter_id, source_thermal_id,
          source_device_id, source_inspection_id, source_bms_document_id,
          source_subtype, auto_generated, commercial_notes, estimated_effort,
          status, position, alternative_solutions_html, created_at, updated_at
        )
        SELECT
          a.id, a.document_id, a.category, a.severity, a.r175_article, a.title, a.description,
          a.zone_id, a.equipment_id,
          CASE WHEN a.source_table='systems'            AND EXISTS(SELECT 1 FROM bacs_audit_systems x            WHERE x.id = a.source_id) THEN a.source_id END,
          CASE WHEN a.source_table='meters'             AND EXISTS(SELECT 1 FROM bacs_audit_meters x             WHERE x.id = a.source_id) THEN a.source_id END,
          CASE WHEN a.source_table='thermal_regulation' AND EXISTS(SELECT 1 FROM bacs_audit_thermal_regulation x WHERE x.id = a.source_id) THEN a.source_id END,
          CASE WHEN a.source_table='devices'            AND EXISTS(SELECT 1 FROM bacs_audit_system_devices x     WHERE x.id = a.source_id) THEN a.source_id END,
          CASE WHEN a.source_table='inspections'        AND a.source_id > 0
                                                        AND EXISTS(SELECT 1 FROM bacs_audit_inspections x       WHERE x.id = a.source_id) THEN a.source_id END,
          CASE WHEN a.source_table='bms'                THEN a.document_id END,
          -- Subtype : preserve l'existant si pose. Sinon derive un
          -- discriminator pour bms (anciennement source_id) et pour
          -- l'inspection synthetique "no_inspection" (anciennement source_id=0).
          COALESCE(
            a.source_subtype,
            CASE
              WHEN a.source_table = 'bms' AND a.source_id = 1 THEN 'r175_3_p1'
              WHEN a.source_table = 'bms' AND a.source_id = 2 THEN 'r175_3_p2'
              WHEN a.source_table = 'bms' AND a.source_id = 5 THEN 'maintenance'
              WHEN a.source_table = 'bms' AND a.source_id = 6 THEN 'training'
              WHEN a.source_table = 'bms' AND a.source_id = 7 THEN 'data_provision_manager'
              WHEN a.source_table = 'bms' AND a.source_id = 8 THEN 'data_provision_operators'
              WHEN a.source_table = 'inspections' AND a.source_id = 0 THEN 'no_inspection'
              ELSE NULL
            END
          ),
          a.auto_generated, a.commercial_notes, a.estimated_effort,
          a.status, a.position, a.alternative_solutions_html, a.created_at, a.updated_at
        FROM bacs_audit_action_items a;
      `);

      const oldCount = db.prepare('SELECT COUNT(*) AS n FROM bacs_audit_action_items').get().n;
      const newCount = db.prepare('SELECT COUNT(*) AS n FROM bacs_audit_action_items_new').get().n;
      if (oldCount !== newCount) {
        throw new Error(`Migration 125 : count mismatch ${oldCount} -> ${newCount}`);
      }

      db.exec(`
        DROP TABLE bacs_audit_action_items;
        ALTER TABLE bacs_audit_action_items_new RENAME TO bacs_audit_action_items;
        CREATE INDEX idx_bacs_actions_doc                ON bacs_audit_action_items(document_id, severity, position);
        CREATE INDEX idx_bacs_actions_source_system      ON bacs_audit_action_items(source_system_id)       WHERE source_system_id      IS NOT NULL;
        CREATE INDEX idx_bacs_actions_source_meter       ON bacs_audit_action_items(source_meter_id)        WHERE source_meter_id       IS NOT NULL;
        CREATE INDEX idx_bacs_actions_source_thermal     ON bacs_audit_action_items(source_thermal_id)      WHERE source_thermal_id     IS NOT NULL;
        CREATE INDEX idx_bacs_actions_source_device      ON bacs_audit_action_items(source_device_id)       WHERE source_device_id      IS NOT NULL;
        CREATE INDEX idx_bacs_actions_source_inspection  ON bacs_audit_action_items(source_inspection_id)   WHERE source_inspection_id  IS NOT NULL;
        CREATE INDEX idx_bacs_actions_source_bms         ON bacs_audit_action_items(source_bms_document_id) WHERE source_bms_document_id IS NOT NULL;
      `);

      const fkErrors = db.prepare('PRAGMA foreign_key_check').all();
      if (fkErrors.length) {
        throw new Error('Migration 125 : FK errors -- ' + JSON.stringify(fkErrors));
      }
    });
    m125tx();
    db.pragma('foreign_keys = ON');
    log.info('Migration 125 appliquee : action_items polymorphisme type (6 FK colonnes au lieu de source_table+source_id)');
    db.pragma('user_version = 125');
  }

  if (current < 126) {
    // Index FK manquants (Lot 4) : ajoute des index partiels
    // (`WHERE col IS NOT NULL`) sur tous les FK d'audit / propriete / auteur
    // qui n'en ont pas. Index partiel = pas de cout sur les lignes ou la
    // colonne est NULL (cas frequent pour `updated_by`, `decided_by`...).
    //
    // Beneficie : queries "qu'est-ce que cet utilisateur a cree/modifie",
    // soft-delete cascade users, lookups d'audit log par user, et tout
    // futur listing filtre par auteur.
    db.exec(`
      -- *_by colonnes ownership / activite
      CREATE INDEX IF NOT EXISTS idx_af_inspections_created_by      ON af_inspections(created_by)               WHERE created_by              IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_af_perm_granted_by             ON af_permissions(granted_by)               WHERE granted_by              IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_afs_created_by                 ON afs(created_by)                          WHERE created_by              IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_afs_updated_by                 ON afs(updated_by)                          WHERE updated_by              IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_ai_prompt_versions_created_by  ON ai_prompt_versions(created_by)           WHERE created_by              IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_ai_prompts_updated_by          ON ai_prompts(updated_by)                   WHERE updated_by              IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_attachments_uploaded_by        ON attachments(uploaded_by)                 WHERE uploaded_by             IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_bacs_suggestions_decided_by    ON bacs_audit_suggestions(decided_by)       WHERE decided_by              IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_bacs_transcripts_uploaded_by   ON bacs_audit_transcripts(uploaded_by)      WHERE uploaded_by             IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_eq_tpl_content_validated_by    ON equipment_templates(content_validated_by) WHERE content_validated_by   IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_eq_tpl_created_by              ON equipment_templates(created_by)          WHERE created_by              IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_eq_tpl_updated_by              ON equipment_templates(updated_by)          WHERE updated_by              IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_exports_exported_by            ON exports(exported_by)                     WHERE exported_by             IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_faq_article_versions_created_by ON faq_article_versions(created_by)        WHERE created_by              IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_faq_articles_created_by        ON faq_articles(created_by)                 WHERE created_by              IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_faq_articles_updated_by        ON faq_articles(updated_by)                 WHERE updated_by              IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_offering_levels_updated_by     ON offering_levels(updated_by)              WHERE updated_by              IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_pdf_boilerplate_updated_by     ON pdf_boilerplate(updated_by)              WHERE updated_by              IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_section_overrides_created_by   ON section_point_overrides(created_by)      WHERE created_by              IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_section_tpl_content_validated_by ON section_templates(content_validated_by) WHERE content_validated_by   IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_section_tpl_updated_by         ON section_templates(updated_by)            WHERE updated_by              IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_sections_updated_by            ON sections(updated_by)                     WHERE updated_by              IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_site_credentials_created_by    ON site_credentials(created_by)             WHERE created_by              IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_site_documents_uploaded_by     ON site_documents(uploaded_by)              WHERE uploaded_by             IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_sites_created_by               ON sites(created_by)                        WHERE created_by              IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_sites_updated_by               ON sites(updated_by)                        WHERE updated_by              IS NOT NULL;

      -- author_id (versions)
      CREATE INDEX IF NOT EXISTS idx_eq_tpl_versions_author         ON equipment_template_versions(author_id)   WHERE author_id               IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_section_tpl_versions_author    ON section_template_versions(author_id)     WHERE author_id               IS NOT NULL;

      -- audit_log.user_id (af_id deja indexe)
      CREATE INDEX IF NOT EXISTS idx_audit_log_user                 ON audit_log(user_id, created_at DESC)      WHERE user_id                 IS NOT NULL;

      -- bacs_audit_action_items : zone_id / equipment_id (FK auxiliaires)
      CREATE INDEX IF NOT EXISTS idx_bacs_actions_zone              ON bacs_audit_action_items(zone_id)         WHERE zone_id                 IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_bacs_actions_equipment         ON bacs_audit_action_items(equipment_id)    WHERE equipment_id            IS NOT NULL;

      -- bacs_audit_meters.equipment_id (FK auxiliaire vers equipments)
      CREATE INDEX IF NOT EXISTS idx_bacs_meters_equipment          ON bacs_audit_meters(equipment_id)          WHERE equipment_id            IS NOT NULL;

      -- bacs_audit_systems.equipment_id (FK auxiliaire)
      CREATE INDEX IF NOT EXISTS idx_bacs_systems_equipment         ON bacs_audit_systems(equipment_id)         WHERE equipment_id            IS NOT NULL;
    `);
    log.info('Migration 126 appliquee : 32 index partiels sur les FK ownership / author / auxiliaires');
    db.pragma('user_version = 126');
  }

  if (current < 127) {
    // Timestamps uniformes (Lot 5) : created_at + updated_at sur toutes
    // les tables mutables qui n'avaient qu'un des deux (ou aucun).
    //
    // SQLite refuse `ALTER TABLE ADD COLUMN ... DEFAULT CURRENT_TIMESTAMP`
    // (defaut non-constant). Strategie :
    //   1. ADD COLUMN nullable
    //   2. Backfill depuis le peer colonne (created_at <-> updated_at),
    //      ou depuis la table parente pour les 1:1.
    //   3. AFTER INSERT trigger qui remplit les NULL avec CURRENT_TIMESTAMP
    //      pour que les futures insertions sans timestamp explicite
    //      restent uniformes.

    // ── updated_at sur tables qui ont deja created_at ────────────────
    db.exec(`
      ALTER TABLE af_zones                ADD COLUMN updated_at TEXT;
      ALTER TABLE equipment_instances     ADD COLUMN updated_at TEXT;
      ALTER TABLE section_point_overrides ADD COLUMN updated_at TEXT;
      ALTER TABLE users                   ADD COLUMN updated_at TEXT;

      UPDATE af_zones                SET updated_at = created_at WHERE updated_at IS NULL;
      UPDATE equipment_instances     SET updated_at = created_at WHERE updated_at IS NULL;
      UPDATE section_point_overrides SET updated_at = created_at WHERE updated_at IS NULL;
      UPDATE users                   SET updated_at = created_at WHERE updated_at IS NULL;
    `);

    // ── created_at sur tables qui n'avaient qu'updated_at (ou rien) ──
    db.exec(`
      ALTER TABLE bacs_audit_bms              ADD COLUMN created_at TEXT;
      ALTER TABLE offering_levels             ADD COLUMN created_at TEXT;
      ALTER TABLE ai_prompts                  ADD COLUMN created_at TEXT;
      ALTER TABLE equipment_template_points   ADD COLUMN created_at TEXT;
      ALTER TABLE equipment_template_points   ADD COLUMN updated_at TEXT;
    `);

    // bacs_audit_bms est 1:1 avec afs : on derive le created_at depuis l'AF parente.
    db.exec(`
      UPDATE bacs_audit_bms
      SET created_at = (SELECT created_at FROM afs WHERE afs.id = bacs_audit_bms.document_id)
      WHERE created_at IS NULL;
    `);

    // offering_levels et ai_prompts : on backfill depuis updated_at.
    db.exec(`
      UPDATE offering_levels SET created_at = updated_at WHERE created_at IS NULL;
      UPDATE ai_prompts      SET created_at = updated_at WHERE created_at IS NULL;
    `);

    // equipment_template_points : pas de timestamp existant. On derive
    // depuis le template parent pour created_at, et on aligne updated_at.
    db.exec(`
      UPDATE equipment_template_points
      SET created_at = (SELECT created_at FROM equipment_templates WHERE equipment_templates.id = equipment_template_points.template_id)
      WHERE created_at IS NULL;
      UPDATE equipment_template_points SET updated_at = created_at WHERE updated_at IS NULL;
    `);

    // ── Triggers AFTER INSERT pour auto-populer NULL -> CURRENT_TIMESTAMP ──
    // Permet a tout INSERT (legacy ou futur) sans timestamp explicite d'avoir
    // des dates coherentes sans toucher au code applicatif.
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_af_zones_ts AFTER INSERT ON af_zones
        WHEN NEW.created_at IS NULL OR NEW.updated_at IS NULL
        BEGIN UPDATE af_zones SET
          created_at = COALESCE(NEW.created_at, CURRENT_TIMESTAMP),
          updated_at = COALESCE(NEW.updated_at, NEW.created_at, CURRENT_TIMESTAMP)
          WHERE id = NEW.id; END;
      CREATE TRIGGER IF NOT EXISTS trg_equipment_instances_ts AFTER INSERT ON equipment_instances
        WHEN NEW.created_at IS NULL OR NEW.updated_at IS NULL
        BEGIN UPDATE equipment_instances SET
          created_at = COALESCE(NEW.created_at, CURRENT_TIMESTAMP),
          updated_at = COALESCE(NEW.updated_at, NEW.created_at, CURRENT_TIMESTAMP)
          WHERE id = NEW.id; END;
      CREATE TRIGGER IF NOT EXISTS trg_section_point_overrides_ts AFTER INSERT ON section_point_overrides
        WHEN NEW.created_at IS NULL OR NEW.updated_at IS NULL
        BEGIN UPDATE section_point_overrides SET
          created_at = COALESCE(NEW.created_at, CURRENT_TIMESTAMP),
          updated_at = COALESCE(NEW.updated_at, NEW.created_at, CURRENT_TIMESTAMP)
          WHERE id = NEW.id; END;
      CREATE TRIGGER IF NOT EXISTS trg_users_ts AFTER INSERT ON users
        WHEN NEW.created_at IS NULL OR NEW.updated_at IS NULL
        BEGIN UPDATE users SET
          created_at = COALESCE(NEW.created_at, CURRENT_TIMESTAMP),
          updated_at = COALESCE(NEW.updated_at, NEW.created_at, CURRENT_TIMESTAMP)
          WHERE id = NEW.id; END;
      CREATE TRIGGER IF NOT EXISTS trg_offering_levels_ts AFTER INSERT ON offering_levels
        WHEN NEW.created_at IS NULL OR NEW.updated_at IS NULL
        BEGIN UPDATE offering_levels SET
          created_at = COALESCE(NEW.created_at, CURRENT_TIMESTAMP),
          updated_at = COALESCE(NEW.updated_at, NEW.created_at, CURRENT_TIMESTAMP)
          WHERE id = NEW.id; END;
      CREATE TRIGGER IF NOT EXISTS trg_equipment_template_points_ts AFTER INSERT ON equipment_template_points
        WHEN NEW.created_at IS NULL OR NEW.updated_at IS NULL
        BEGIN UPDATE equipment_template_points SET
          created_at = COALESCE(NEW.created_at, CURRENT_TIMESTAMP),
          updated_at = COALESCE(NEW.updated_at, NEW.created_at, CURRENT_TIMESTAMP)
          WHERE id = NEW.id; END;

      -- bacs_audit_bms : PK = document_id (1:1 avec afs), pas \`id\`.
      CREATE TRIGGER IF NOT EXISTS trg_bacs_audit_bms_ts AFTER INSERT ON bacs_audit_bms
        WHEN NEW.created_at IS NULL OR NEW.updated_at IS NULL
        BEGIN UPDATE bacs_audit_bms SET
          created_at = COALESCE(NEW.created_at, CURRENT_TIMESTAMP),
          updated_at = COALESCE(NEW.updated_at, NEW.created_at, CURRENT_TIMESTAMP)
          WHERE document_id = NEW.document_id; END;

      -- ai_prompts : PK = key (TEXT).
      CREATE TRIGGER IF NOT EXISTS trg_ai_prompts_ts AFTER INSERT ON ai_prompts
        WHEN NEW.created_at IS NULL OR NEW.updated_at IS NULL
        BEGIN UPDATE ai_prompts SET
          created_at = COALESCE(NEW.created_at, CURRENT_TIMESTAMP),
          updated_at = COALESCE(NEW.updated_at, NEW.created_at, CURRENT_TIMESTAMP)
          WHERE key = NEW.key; END;
    `);

    log.info('Migration 127 appliquee : timestamps uniformes (created_at + updated_at sur 8 tables, 8 triggers AFTER INSERT)');
    db.pragma('user_version = 127');
  }

  if (current < 128) {
    // Drop colonnes mortes (Lot 6) : champs notes_pX qui n'ont jamais ete
    // utilises (0 lignes en prod) et qui flottent dans le schema.
    //
    // bacs_audit_systems : notes_p3, notes_p4, notes_p4_autonomous
    //   -> doublons de la note generale `notes` / `notes_html`. Les
    //      compliance par device sont desormais sur bacs_audit_system_devices.
    //
    // bacs_audit_bms : notes_p1, notes_p2, notes_maintenance, notes_training
    //   -> meme logique : notes globales BMS sont sur `notes_html`,
    //      l'argumentaire P1/P2/maintenance/training est porte par les
    //      champs structures r175_3_p1_archival_format, maintenance_*,
    //      operator_training_*, etc. ajoutes recemment.
    //
    // Verification automatique : si l'une de ces colonnes contient des
    // donnees, on AVORTE la migration plutot que de les perdre.
    const checks = [
      ['bacs_audit_systems', 'notes_p3'],
      ['bacs_audit_systems', 'notes_p4'],
      ['bacs_audit_systems', 'notes_p4_autonomous'],
      ['bacs_audit_bms',     'notes_p1'],
      ['bacs_audit_bms',     'notes_p2'],
      ['bacs_audit_bms',     'notes_maintenance'],
      ['bacs_audit_bms',     'notes_training'],
    ];
    for (const [tbl, col] of checks) {
      const n = db.prepare(`SELECT COUNT(*) AS n FROM ${tbl} WHERE ${col} IS NOT NULL AND ${col} != ''`).get().n;
      if (n > 0) {
        throw new Error(`Migration 128 abandonnee : ${tbl}.${col} contient ${n} ligne(s) non vide(s). Examiner avant de drop.`);
      }
    }
    db.exec(`
      ALTER TABLE bacs_audit_systems DROP COLUMN notes_p3;
      ALTER TABLE bacs_audit_systems DROP COLUMN notes_p4;
      ALTER TABLE bacs_audit_systems DROP COLUMN notes_p4_autonomous;
      ALTER TABLE bacs_audit_bms     DROP COLUMN notes_p1;
      ALTER TABLE bacs_audit_bms     DROP COLUMN notes_p2;
      ALTER TABLE bacs_audit_bms     DROP COLUMN notes_maintenance;
      ALTER TABLE bacs_audit_bms     DROP COLUMN notes_training;
    `);
    log.info('Migration 128 appliquee : 7 colonnes mortes droppees (notes_p1/p2/p3/p4/p4_autonomous/maintenance/training, 0 records)');
    db.pragma('user_version = 128');
  }

  if (current < 129) {
    // Card 05 Regulation thermique R175-6 : decoupage par niveau (Production /
    // Distribution / Emission). Trois ajouts par niveau :
    //   - <level>_regulation_device_id  : FK vers l'equipement de regulation
    //     (sonde, thermostat, GTB) qui realise la regulation. Distinct du
    //     <level>_device_id qui pointe l'equipement-process (chaudiere, pompe,
    //     radiateur).
    //   - <level>_notes_html            : note libre par niveau, en plus des
    //     notes globales `notes_html` (couple zone x categorie).
    // Les anciens champs <level>_regulation (TEXT creatable, "sonde exterieure",
    // "V3V melange"...) deviennent redondants : on copie leur contenu vers la
    // colonne <level>_notes_html du meme niveau (encadre <p>) puis on drop.
    db.exec(`
      ALTER TABLE bacs_audit_thermal_regulation
        ADD COLUMN production_regulation_device_id INTEGER
          REFERENCES bacs_audit_system_devices(id) ON DELETE SET NULL;
      ALTER TABLE bacs_audit_thermal_regulation
        ADD COLUMN distribution_regulation_device_id INTEGER
          REFERENCES bacs_audit_system_devices(id) ON DELETE SET NULL;
      ALTER TABLE bacs_audit_thermal_regulation
        ADD COLUMN emission_regulation_device_id INTEGER
          REFERENCES bacs_audit_system_devices(id) ON DELETE SET NULL;
      ALTER TABLE bacs_audit_thermal_regulation ADD COLUMN production_notes_html TEXT;
      ALTER TABLE bacs_audit_thermal_regulation ADD COLUMN distribution_notes_html TEXT;
      ALTER TABLE bacs_audit_thermal_regulation ADD COLUMN emission_notes_html TEXT;

      UPDATE bacs_audit_thermal_regulation
         SET production_notes_html = '<p>' || production_regulation || '</p>'
       WHERE production_regulation IS NOT NULL AND TRIM(production_regulation) <> '';
      UPDATE bacs_audit_thermal_regulation
         SET distribution_notes_html = '<p>' || distribution_regulation || '</p>'
       WHERE distribution_regulation IS NOT NULL AND TRIM(distribution_regulation) <> '';
      UPDATE bacs_audit_thermal_regulation
         SET emission_notes_html = '<p>' || emission_regulation || '</p>'
       WHERE emission_regulation IS NOT NULL AND TRIM(emission_regulation) <> '';

      ALTER TABLE bacs_audit_thermal_regulation DROP COLUMN production_regulation;
      ALTER TABLE bacs_audit_thermal_regulation DROP COLUMN distribution_regulation;
      ALTER TABLE bacs_audit_thermal_regulation DROP COLUMN emission_regulation;
    `);
    log.info('Migration 129 appliquee : thermal_regulation P/D/E (FK regulation_device_id + notes_html par niveau, drop *_regulation TEXT)');
    db.pragma('user_version = 129');
  }

  if (current < 130) {
    // Cleanup des rows BACS audit orphelines : systems / meters /
    // thermal_regulation qui pointent vers une zone soft-delete (mig 124
    // a introduit `zones.deleted_at` mais les FK ON DELETE CASCADE ne
    // s'appliquent pas au soft-delete UPDATE). Ces rows orphelines etaient
    // reconstituees en "zones fantomes" par le fallback frontend
    // (audit.js loadAudit) et empechaient la suppression de zone (la route
    // DELETE no-op sur zone deja soft-delete).
    //
    // Le hard-delete est correct : ces tables n'ont pas de colonne
    // deleted_at et sont entierement regenerables a la volee depuis le
    // seeder (resyncBacsAuditWithSiteZones). Les bacs_audit_system_devices
    // sont auto-supprimes par FK ON DELETE CASCADE sur leur system parent.
    const cleanup = db.transaction(() => {
      const orphanSys = db.prepare(`
        DELETE FROM bacs_audit_systems
         WHERE zone_id IN (SELECT id FROM zones WHERE deleted_at IS NOT NULL)
      `).run();
      const orphanMeter = db.prepare(`
        DELETE FROM bacs_audit_meters
         WHERE zone_id IN (SELECT id FROM zones WHERE deleted_at IS NOT NULL)
      `).run();
      const orphanThermal = db.prepare(`
        DELETE FROM bacs_audit_thermal_regulation
         WHERE zone_id IN (SELECT id FROM zones WHERE deleted_at IS NOT NULL)
      `).run();
      log.info(`Migration 130 cleanup : ${orphanSys.changes} systems + ${orphanMeter.changes} meters + ${orphanThermal.changes} thermal_regulation rows orphelines droppees`);
    });
    cleanup();
    db.pragma('user_version = 130');
  }

  if (current < 131) {
    // Cleanup des rows BACS qui referencent une zone d'un AUTRE site que
    // celui de l'audit. Ces incoherences se produisent quand le site_id
    // d'un audit change apres creation, sans cleanup des rows BACS.
    // Symptome utilisateur : le fallback frontend (audit.js loadAudit)
    // reconstitue des "zones fantomes" depuis les rows orphelines, et
    // toute suppression d'une zone "fantome" donne l'impression que
    // toutes les zones disparaissent (listZones du bon site retourne []
    // qui est ecrase a chaque load par le fallback).
    const cleanup131 = db.transaction(() => {
      const sysRes = db.prepare(`
        DELETE FROM bacs_audit_systems
         WHERE id IN (
           SELECT s.id FROM bacs_audit_systems s
             JOIN afs a ON a.id = s.document_id
             JOIN zones z ON z.id = s.zone_id
            WHERE z.site_id != a.site_id
         )
      `).run();
      const meterRes = db.prepare(`
        DELETE FROM bacs_audit_meters
         WHERE id IN (
           SELECT m.id FROM bacs_audit_meters m
             JOIN afs a ON a.id = m.document_id
             JOIN zones z ON z.id = m.zone_id
            WHERE z.site_id != a.site_id
         )
      `).run();
      const thermalRes = db.prepare(`
        DELETE FROM bacs_audit_thermal_regulation
         WHERE id IN (
           SELECT t.id FROM bacs_audit_thermal_regulation t
             JOIN afs a ON a.id = t.document_id
             JOIN zones z ON z.id = t.zone_id
            WHERE z.site_id != a.site_id
         )
      `).run();
      log.info(`Migration 131 cleanup cross-site : ${sysRes.changes} systems + ${meterRes.changes} meters + ${thermalRes.changes} thermal_regulation rows incoherentes droppees`);
    });
    cleanup131();
    db.pragma('user_version = 131');
  }

  if (current < 132) {
    // Permet d'attacher des photos terrain a une action du plan de mise
    // en conformite (parite avec zones / systems / meters / devices /
    // GTB qui ont deja leur FK sur site_documents).
    db.exec(`
      ALTER TABLE site_documents ADD COLUMN bacs_audit_action_item_id INTEGER
        REFERENCES bacs_audit_action_items(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_site_docs_bacs_action
        ON site_documents(bacs_audit_action_item_id);
    `);
    log.info('Migration 132 appliquee : site_documents.bacs_audit_action_item_id (photos par action plan)');
    db.pragma('user_version = 132');
  }

  if (current < 133) {
    // ── Fix : section_templates.parent_template_id ON DELETE CASCADE ──
    //
    // Bug isole 2026-05-10 : la FK etait en ON DELETE SET NULL. Quand
    // l'utilisateur a supprime les templates parents 2.1/2.2/2.4/2.6/2.8
    // depuis l'UI biblio, leurs 16+ enfants (2.1.1 Chaudieres, 2.1.2
    // Aerothermes, 2.4.1 Eclairage int, 2.6.1 Compteurs elec, etc.) ont
    // vu leur parent_template_id passer a NULL au lieu d'etre supprimes
    // en cascade. Resultat : ils sont apparus comme top-level dans le
    // seeder, et la nouvelle AF #39 a recu 16 sections doublons au
    // niveau racine.
    //
    // Cette migration :
    //   1) Nettoie les section_templates orphelins (parent NULL + slug
    //      avec un point), avec tombstone des slugs (anti-reseed).
    //   2) Supprime les sections root-level (parent_id IS NULL) qui ont
    //      ete creees a partir de ces orphelins. Limite a AF #39 :
    //      les AFs plus anciennes ont leurs sections correctement
    //      placees sous leur ancien parent (avant la suppression de
    //      celui-ci) et restent intactes — juste leur section_template_id
    //      sera NULL apres le drop des orphelins (FK SET NULL).
    //   3) Recree section_templates avec FK parent_template_id en
    //      ON DELETE CASCADE pour empecher la recidive.
    const orphans = db.prepare(
      "SELECT id, slug FROM section_templates WHERE parent_template_id IS NULL AND slug LIKE '%.%'"
    ).all();
    if (orphans.length) {
      const orphanIds = orphans.map(o => o.id);
      const placeholders = orphanIds.map(() => '?').join(',');
      // Tombstones AVANT delete (sinon getById echoue dans la route DELETE)
      const tsStmt = db.prepare(
        'INSERT OR IGNORE INTO deleted_section_template_slugs (slug, deleted_at) VALUES (?, CURRENT_TIMESTAMP)'
      );
      for (const o of orphans) tsStmt.run(o.slug);
      // Supprime les sections root-level orphelines (toutes AFs, pour
      // robustesse — en pratique seule l'AF #39 est concernee).
      const sectionsCleaned = db.prepare(
        `DELETE FROM sections WHERE parent_id IS NULL AND section_template_id IN (${placeholders})`
      ).run(...orphanIds);
      // Drop les templates orphelins. Les sections restantes qui les
      // referencent (dans des AFs plus anciennes) auront leur
      // section_template_id mis a NULL via la FK SET NULL existante
      // (mig 122).
      const tplCleaned = db.prepare(
        `DELETE FROM section_templates WHERE id IN (${placeholders})`
      ).run(...orphanIds);
      log.info(`Migration 133 cleanup : ${orphans.length} templates orphelins droppes, ${sectionsCleaned.changes} sections root nettoyees`);
    } else {
      log.info('Migration 133 cleanup : aucun template orphelin a nettoyer');
    }

    // Pour changer la FK parent_template_id de SET NULL -> CASCADE,
    // SQLite impose une recreation complete de la table. On copie
    // dynamiquement la liste des colonnes existantes (sans hardcoder)
    // pour rester robuste si des colonnes ont ete ajoutees via ALTER.
    const cols = db.prepare("PRAGMA table_info(section_templates)").all().map(c => c.name);
    const colsCsv = cols.map(c => `"${c}"`).join(', ');
    // Recupere la def CREATE TABLE complete (pour preserver les types
    // exacts), on substitue juste la clause SET NULL -> CASCADE sur
    // parent_template_id.
    const sqlMaster = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='section_templates'"
    ).get();
    let createSql = sqlMaster.sql;
    // Pattern : parent_template_id INTEGER REFERENCES section_templates(id) ON DELETE SET NULL
    // -> parent_template_id INTEGER REFERENCES section_templates_new(id) ON DELETE CASCADE
    createSql = createSql.replace(
      /(parent_template_id\s+INTEGER\s+REFERENCES\s+)section_templates(\(id\)\s+ON\s+DELETE\s+)SET\s+NULL/i,
      '$1section_templates_new$2CASCADE'
    );
    // Replace table name in CREATE clause
    createSql = createSql.replace(
      /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?["']?section_templates["']?/i,
      'CREATE TABLE section_templates_new'
    );

    db.pragma('foreign_keys = OFF');
    const tx = db.transaction(() => {
      db.exec(createSql);
      db.exec(`INSERT INTO section_templates_new (${colsCsv}) SELECT ${colsCsv} FROM section_templates;`);
      db.exec('DROP TABLE section_templates;');
      db.exec('ALTER TABLE section_templates_new RENAME TO section_templates;');
      // Recreate indexes (best-effort, IF NOT EXISTS)
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_section_templates_parent ON section_templates(parent_template_id, position);
        CREATE INDEX IF NOT EXISTS idx_section_templates_position ON section_templates(position);
        CREATE INDEX IF NOT EXISTS idx_section_templates_slug ON section_templates(slug);
        CREATE INDEX IF NOT EXISTS idx_section_tpl_content_validated_by ON section_templates(content_validated_by) WHERE content_validated_by IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_section_tpl_updated_by ON section_templates(updated_by) WHERE updated_by IS NOT NULL;
      `);
      const fkErrors = db.prepare('PRAGMA foreign_key_check').all();
      if (fkErrors.length) {
        throw new Error('Migration 133 : FK errors -- ' + JSON.stringify(fkErrors));
      }
    });
    tx();
    db.pragma('foreign_keys = ON');
    log.info('Migration 133 appliquee : section_templates.parent_template_id passe en ON DELETE CASCADE (cleanup + fix structurel)');
    db.pragma('user_version = 133');
  }

  if (current < 134) {
    // Quantite par systeme : un meme device peut representer N exemplaires
    // identiques (ex. 12 radiateurs identiques sur une zone, 4 PAC murales
    // sur un toit). Defaut 1 (compatible avec l'existant).
    db.exec(`
      ALTER TABLE bacs_audit_system_devices
        ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1;
    `);
    log.info('Migration 134 appliquee : bacs_audit_system_devices.quantity (defaut 1)');
    db.pragma('user_version = 134');
  }

  if (current < 135) {
    // Age du systeme : propriete du device (Card 03), pas de la regulation
    // thermique (Card 05). Avant : `bacs_audit_thermal_regulation.generator_age_years`
    // -> duplique par couple zone x categorie. Maintenant : `age_years` sur
    // le device pointe via generator_device_id.
    // Idem : `generator_type` etait redondant avec `device.energy_source`
    // -> drop apres migration.
    db.exec(`
      ALTER TABLE bacs_audit_system_devices ADD COLUMN age_years INTEGER;
    `);
    // Copie : pour chaque thermal pointant un device en generator_device_id,
    // remonter l'age sur le device. En cas de conflit (meme device cible
    // par plusieurs thermals), MIN garde la premiere valeur non-nulle
    // rencontree (en pratique, peu de doublons).
    db.exec(`
      UPDATE bacs_audit_system_devices
         SET age_years = (
           SELECT MIN(t.generator_age_years)
             FROM bacs_audit_thermal_regulation t
            WHERE t.generator_device_id = bacs_audit_system_devices.id
              AND t.generator_age_years IS NOT NULL
         )
       WHERE id IN (
         SELECT generator_device_id FROM bacs_audit_thermal_regulation
          WHERE generator_device_id IS NOT NULL
            AND generator_age_years IS NOT NULL
       );
    `);
    db.exec(`
      ALTER TABLE bacs_audit_thermal_regulation DROP COLUMN generator_age_years;
      ALTER TABLE bacs_audit_thermal_regulation DROP COLUMN generator_type;
    `);
    log.info('Migration 135 appliquee : bacs_audit_system_devices.age_years (copie depuis thermal.generator_age_years) + drop generator_type/age sur thermal');
    db.pragma('user_version = 135');
  }

  if (current < 136) {
    // Tombstones par point d'equipement : quand un point est supprime de
    // l'UI biblio, on memorise (template_id, slug) pour que le seeder
    // (seedLibraryOnBoot, branche enrichissement) ne le recree pas au
    // prochain boot. Pattern symetrique a deleted_equipment_template_slugs
    // pour les templates entiers, et deleted_section_template_slugs pour
    // les sections types.
    db.exec(`
      CREATE TABLE IF NOT EXISTS deleted_equipment_template_point_slugs (
        template_id INTEGER NOT NULL REFERENCES equipment_templates(id) ON DELETE CASCADE,
        slug TEXT NOT NULL,
        deleted_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (template_id, slug)
      );
      CREATE INDEX IF NOT EXISTS idx_deleted_eq_tpl_point_slugs_tpl
        ON deleted_equipment_template_point_slugs(template_id);
    `);
    log.info('Migration 136 appliquee : table tombstones par point biblio (deleted_equipment_template_point_slugs)');
    db.pragma('user_version = 136');
  }

  if (current < 137) {
    // Tombstones par cle de categorie systeme : meme bug pattern que les
    // points biblio (mig 136). Une categorie supprimee via l'UI revenait
    // au prochain boot car seedSystemCategoriesOnBoot la re-creait.
    db.exec(`
      CREATE TABLE IF NOT EXISTS deleted_system_category_keys (
        key TEXT PRIMARY KEY,
        deleted_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    log.info('Migration 137 appliquee : table tombstones categories systeme (deleted_system_category_keys)');
    db.pragma('user_version = 137');
  }

  if (current < 138) {
    // Synchronisation bibliothèque de fonctionnalités -> FAQ Crisp (Lot 138).
    // 1) Lien biblio -> article FAQ : permet de tracer quelle fonctionnalité a
    //    généré l'article, détecter une divergence (biblio modifiée depuis la
    //    dernière génération) et préserver les éditions manuelles côté FAQ.
    // 2) Codes BACS couverts par l'article : permet le maillage interne SEO
    //    automatique (un article fonctionnalité peut renvoyer vers l'article
    //    BACS approprié).
    // 3) Flag confidentiel sur les fonctionnalités : empêche la publication
    //    FAQ d'algorithmes propriétaires ou de techniques d'intégration.
    // 4) Table mapping local -> FTP pour les captures de la biblio publiées
    //    sur l'hébergement Crisp public.
    db.exec(`
      ALTER TABLE faq_articles ADD COLUMN source_section_template_id INTEGER REFERENCES section_templates(id) ON DELETE SET NULL;
      ALTER TABLE faq_articles ADD COLUMN source_synced_version INTEGER;
      ALTER TABLE faq_articles ADD COLUMN source_synced_at DATETIME;
      ALTER TABLE faq_articles ADD COLUMN source_overridden INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE faq_articles ADD COLUMN bacs_articles TEXT;

      CREATE INDEX IF NOT EXISTS idx_faq_source_section_tpl ON faq_articles(source_section_template_id);
      CREATE INDEX IF NOT EXISTS idx_faq_bacs_articles ON faq_articles(bacs_articles);

      ALTER TABLE section_templates ADD COLUMN faq_publishable INTEGER NOT NULL DEFAULT 1;

      CREATE TABLE IF NOT EXISTS library_attachment_publications (
        attachment_id INTEGER PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
        ftp_url TEXT NOT NULL,
        file_hash TEXT NOT NULL,
        published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    log.info('Migration 138 appliquee : sync biblio -> FAQ (source_*, bacs_articles, faq_publishable, library_attachment_publications)');
    db.pragma('user_version = 138');
  }

  if (current < 139) {
    // Consolidation audit trail vers Fleet Manager (push periodique).
    // Singleton qui stocke :
    //  - epoch (uuid v4) : identifie l'instance Docs. Regenere uniquement si
    //    la DB est restauree depuis un snapshot (les ids AUTOINCREMENT
    //    pourraient se recycler).
    //  - last_id : id max deja pousse avec succes. Le worker pousse les
    //    audit_log.id > last_id.
    // Le couple (epoch, audit_log.id) est la cle de dedup cote FM.
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_sync_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        epoch TEXT NOT NULL,
        last_id INTEGER NOT NULL DEFAULT 0,
        last_pushed_at TEXT
      );
    `);
    log.info('Migration 139 appliquee : audit_sync_state (consolidation audit trail vers FM)');
    db.pragma('user_version = 139');
  }

  if (current < 140) {
    // Livres blancs marketing : nouveau kind 'whitepaper' dans la table afs
    // (table unifiee des documents). Edition Tiptap, export PDF flux naturel.
    // Documents compagnons (checklists, infographies) = whitepaper enfants
    // relies via parent_af_id.
    //
    // 1. Etendre les CHECK kind + status via writable_schema (pattern mig 106).
    //    - kind : ajout de 'whitepaper'
    //    - status : ajout de 'draft' / 'published' (statuts livre blanc)
    db.unsafeMode(true);
    try {
      db.pragma('writable_schema = 1');
      const replaceAfsSql = db.prepare(
        "UPDATE sqlite_master SET sql = REPLACE(sql, ?, ?) " +
        "WHERE type = 'table' AND name = 'afs'"
      );
      replaceAfsSql.run(
        "CHECK (kind IN ('af','bacs_audit','brochure'))",
        "CHECK (kind IN ('af','bacs_audit','brochure','whitepaper'))",
      );
      replaceAfsSql.run(
        "CHECK (status IN ('redaction', 'validee', 'commissioning', 'commissioned', 'livree'))",
        "CHECK (status IN ('redaction', 'validee', 'commissioning', 'commissioned', 'livree', 'draft', 'published'))",
      );
      db.pragma('writable_schema = 0');
    } finally {
      db.unsafeMode(false);
    }
    // 2. Colonnes specifiques whitepaper (prefixe wp_, cf. convention bacs_).
    //    slug existe deja sur afs : reutilise tel quel.
    db.exec(`
      ALTER TABLE afs ADD COLUMN parent_af_id INTEGER REFERENCES afs(id) ON DELETE CASCADE;
      ALTER TABLE afs ADD COLUMN wp_layout TEXT;        -- 'book' | 'single-page'
      ALTER TABLE afs ADD COLUMN wp_audience TEXT;      -- ex 'property_manager'
      ALTER TABLE afs ADD COLUMN wp_version TEXT;       -- '1.0', '1.1' (saisi manuel)
      ALTER TABLE afs ADD COLUMN wp_meta_json TEXT;     -- JSON cover/pivot/back
      CREATE INDEX IF NOT EXISTS idx_afs_parent ON afs(parent_af_id) WHERE parent_af_id IS NOT NULL;
    `);
    log.info('Migration 140 appliquee : kind whitepaper + colonnes wp_*');
    db.pragma('user_version = 140');
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
  // getById renvoie aussi les soft-deleted (utile pour l'audit trail :
  // les FK created_by / updated_by / uploaded_by doivent toujours
  // resoudre un nom). Pour la liste des users actifs, utiliser listActive().
  getById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  },
  // Batche les lookups (evite le N+1 sur les listings).
  // Renvoie une Map<id, user>. Inclut les soft-deleted (cf. getById).
  getByIds(ids) {
    if (!ids || !ids.length) return new Map();
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const placeholders = unique.map(() => '?').join(', ');
    const rows = db.prepare(`SELECT * FROM users WHERE id IN (${placeholders})`).all(...unique);
    return new Map(rows.map(r => [r.id, r]));
  },
  // Liste des users actifs (pour les pickers de partage / liste admin).
  listActive() {
    return db.prepare('SELECT * FROM users WHERE deleted_at IS NULL ORDER BY display_name').all();
  },
  getByOidcSub(sub, issuer) {
    // Un user soft-deleted ne peut plus se reconnecter (filtre deleted_at).
    return db.prepare('SELECT * FROM users WHERE oidc_sub = ? AND oidc_issuer = ? AND deleted_at IS NULL').get(sub, issuer);
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
    // On indexe par email (et pas un oidc_sub fixe) pour permettre
    // de basculer entre plusieurs users en dev via les env vars
    // DEV_BYPASS_EMAIL/DEV_BYPASS_NAME — utile pour tester les
    // permissions multi-users.
    const oidcSub = `dev-bypass:${email}`;
    const existing = db.prepare('SELECT * FROM users WHERE oidc_sub = ?').get(oidcSub);
    if (existing) return existing;
    // Compat avec l'ancien dev-bypass mono-user : si un user existe déjà
    // avec cet email (créé sous l'oidc_sub legacy 'dev-bypass'), on le
    // migre vers le nouveau schéma au lieu d'en créer un doublon — ça
    // préserve les ownerships d'audits existants.
    const byEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (byEmail) {
      db.prepare('UPDATE users SET oidc_sub = ? WHERE id = ?').run(oidcSub, byEmail.id);
      return { ...byEmail, oidc_sub: oidcSub };
    }
    const result = db.prepare(`
      INSERT INTO users (oidc_sub, oidc_issuer, email, display_name)
      VALUES (?, 'local-dev', ?, ?)
    `).run(oidcSub, email, displayName);
    return this.getById(result.lastInsertRowid);
  },
  softDelete(id) {
    // Hard-delete impossible : created_by/updated_by/uploaded_by referencent
    // l'user. Soft-delete coupe l'acces (getByOidcSub filtre deleted_at)
    // sans casser l'audit trail.
    db.prepare('UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  },
  restore(id) {
    db.prepare('UPDATE users SET deleted_at = NULL WHERE id = ?').run(id);
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
    // Ordre : categorie (selon position de system_categories_db pour rester
    // coherent avec l'arbo AF), puis position dans la categorie, puis nom.
    const sql = `
      SELECT et.*, u.display_name AS content_validated_by_name
      FROM equipment_templates et
      LEFT JOIN users u ON u.id = et.content_validated_by
      LEFT JOIN system_categories_db scd ON scd.key = et.category
      ${category ? 'WHERE et.category = ?' : ''}
      ORDER BY scd.position, et.category, et.position, et.name
    `;
    return category ? db.prepare(sql).all(category) : db.prepare(sql).all();
  },
  getById(id) {
    return db.prepare(`
      SELECT et.*, u.display_name AS content_validated_by_name
      FROM equipment_templates et
      LEFT JOIN users u ON u.id = et.content_validated_by
      WHERE et.id = ?
    `).get(id);
  },
  getBySlug(slug) {
    return db.prepare('SELECT * FROM equipment_templates WHERE slug = ?').get(slug);
  },
  create({ slug, name, category, bacsArticles, bacsJustification, descriptionHtml, iconKind, iconValue, iconColor, preferredProtocols, defaultEnergySource, defaultDeviceRole, createdBy }) {
    const result = db.prepare(`
      INSERT INTO equipment_templates
        (slug, name, category, bacs_articles, bacs_justification, description_html, icon_kind, icon_value, icon_color, preferred_protocols, default_energy_source, default_device_role, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(slug, name, category || null, bacsArticles || null, bacsJustification || null,
            descriptionHtml || null,
            iconKind || null, iconValue || null, iconColor || null, preferredProtocols || null,
            defaultEnergySource || null, defaultDeviceRole || null,
            createdBy || null, createdBy || null);
    return this.getById(result.lastInsertRowid);
  },
  update(id, { slug, name, category, bacsArticles, bacsJustification, descriptionHtml, iconKind, iconValue, iconColor, preferredProtocols, defaultEnergySource, defaultDeviceRole, updatedBy }) {
    // Auto-clear de la validation si description_html change effectivement
    // (mig 89). Le contenu repasse en brouillon — l'utilisateur devra re-valider.
    let clearValidation = false;
    if (descriptionHtml !== undefined && descriptionHtml !== null) {
      const cur = this.getById(id);
      if (cur && (cur.description_html || '') !== (descriptionHtml || '')) {
        clearValidation = true;
      }
    }
    // default_energy_source / default_device_role : explicitement settable a
    // NULL pour permettre de vider le pré-remplissage depuis l'editeur admin.
    // Sentinel '__clear__' demande l'unset ; absent (undefined) = inchange.
    const energySql = defaultEnergySource === '__clear__' ? 'NULL' : 'COALESCE(?, default_energy_source)';
    const roleSql   = defaultDeviceRole   === '__clear__' ? 'NULL' : 'COALESCE(?, default_device_role)';
    const energyArg = defaultEnergySource === '__clear__' ? [] : [defaultEnergySource ?? null];
    const roleArg   = defaultDeviceRole   === '__clear__' ? [] : [defaultDeviceRole ?? null];

    db.prepare(`
      UPDATE equipment_templates
      SET slug = COALESCE(?, slug),
          name = COALESCE(?, name),
          category = COALESCE(?, category),
          bacs_articles = COALESCE(?, bacs_articles),
          bacs_justification = COALESCE(?, bacs_justification),
          description_html = COALESCE(?, description_html),
          icon_kind = COALESCE(?, icon_kind),
          icon_value = COALESCE(?, icon_value),
          icon_color = COALESCE(?, icon_color),
          preferred_protocols = COALESCE(?, preferred_protocols),
          default_energy_source = ${energySql},
          default_device_role = ${roleSql},
          updated_by = ?,
          updated_at = CURRENT_TIMESTAMP
          ${clearValidation ? ', content_validated_at = NULL, content_validated_by = NULL' : ''}
      WHERE id = ?
    `).run(slug, name, category, bacsArticles, bacsJustification, descriptionHtml, iconKind, iconValue, iconColor, preferredProtocols, ...energyArg, ...roleArg, updatedBy || null, id);
    return this.getById(id);
  },
  delete(id) {
    db.prepare('DELETE FROM equipment_templates WHERE id = ?').run(id);
  },
  bumpVersion(id) {
    db.prepare('UPDATE equipment_templates SET current_version = current_version + 1 WHERE id = ?').run(id);
  },
  // Reordonne les rows d'une categorie selon orderedIds. Position en
  // increments de 10. Les ids absents de l'array gardent leur position
  // actuelle (placés a la fin).
  reorderInCategory(category, orderedIds) {
    if (!Array.isArray(orderedIds) || !orderedIds.length) return 0;
    const validIds = db.prepare(
      `SELECT id FROM equipment_templates WHERE category = ? AND id IN (${orderedIds.map(() => '?').join(',')})`
    ).all(category, ...orderedIds).map(r => r.id);
    const validSet = new Set(validIds);
    const filtered = orderedIds.filter(id => validSet.has(id));
    const tx = db.transaction(() => {
      filtered.forEach((id, idx) => {
        db.prepare('UPDATE equipment_templates SET position = ? WHERE id = ?').run((idx + 1) * 10, id);
      });
    });
    tx();
    return filtered.length;
  },
  // Clone à plat d'un equipment_template : le template + ses points +
  // ses attachments. Slug unique généré via slugifyName (callback). Les
  // attachments référencent les mêmes fichiers sur disque.
  clone(sourceId, { newName, slugifyName, userId }) {
    const src = this.getById(sourceId);
    if (!src) throw new Error(`Equipment template #${sourceId} introuvable`);
    const tx = db.transaction(() => {
      let baseSlug = slugifyName(newName);
      let candidate = baseSlug || 'equipment';
      let suffix = 2;
      while (db.prepare('SELECT 1 FROM equipment_templates WHERE slug = ?').get(candidate)) {
        candidate = `${baseSlug}-${suffix++}`;
      }
      const r = db.prepare(`
        INSERT INTO equipment_templates
          (slug, name, category, bacs_articles, bacs_justification, description_html,
           icon_kind, icon_value, icon_color, preferred_protocols,
           default_energy_source, default_device_role, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        candidate, newName, src.category, src.bacs_articles, src.bacs_justification,
        src.description_html, src.icon_kind, src.icon_value, src.icon_color,
        src.preferred_protocols, src.default_energy_source, src.default_device_role,
        userId || null, userId || null,
      );
      const newId = r.lastInsertRowid;
      // Points
      const points = db.prepare(
        'SELECT * FROM equipment_template_points WHERE template_id = ? ORDER BY position, id'
      ).all(sourceId);
      for (const p of points) {
        db.prepare(`
          INSERT INTO equipment_template_points
            (template_id, slug, position, label, data_type, direction, unit, notes, is_optional, tech_name, nature)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(newId, p.slug, p.position, p.label, p.data_type, p.direction, p.unit, p.notes, p.is_optional || 0, p.tech_name, p.nature);
      }
      // Attachments
      const atts = db.prepare(
        'SELECT * FROM attachments WHERE equipment_template_id = ? ORDER BY position, id'
      ).all(sourceId);
      for (const a of atts) {
        db.prepare(`
          INSERT INTO attachments
            (equipment_template_id, filename, original_name, caption, position, width, height, full_width, uploaded_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(newId, a.filename, a.original_name, a.caption, a.position, a.width, a.height, a.full_width || 0, userId || null);
      }
      return { newId, pointsCount: points.length, attachmentsCount: atts.length };
    });
    return tx();
  },

  // Statut de validation du contenu (mig 89). Symétrique de sectionTemplates.
  validateContent(id, userId) {
    db.prepare(`
      UPDATE equipment_templates
         SET content_validated_at = CURRENT_TIMESTAMP,
             content_validated_by = ?
       WHERE id = ?
    `).run(userId || null, id);
    return this.getById(id);
  },
  unvalidateContent(id) {
    db.prepare(`
      UPDATE equipment_templates
         SET content_validated_at = NULL,
             content_validated_by = NULL
       WHERE id = ?
    `).run(id);
    return this.getById(id);
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

// Versionnage des section_templates : un snapshot est insere AVANT chaque
// ecrasement du body_html (cf. sectionTemplates.update). Permet la restauration
// depuis l'UI. La version stockee est l'ancienne version (avant ecrasement),
// donc lister par version DESC montre la version la plus recemment remplacee
// en premier.
const sectionTemplateVersions = {
  listByTemplate(templateId) {
    return db.prepare(`
      SELECT v.id, v.template_id, v.version, v.changelog, v.created_at,
             v.author_id, u.display_name AS author_name
      FROM section_template_versions v
      LEFT JOIN users u ON u.id = v.author_id
      WHERE template_id = ?
      ORDER BY v.id DESC
    `).all(templateId);
  },
  getById(id) {
    return db.prepare(`SELECT * FROM section_template_versions WHERE id = ?`).get(id);
  },
  create({ templateId, version, snapshot, changelog, authorId }) {
    const r = db.prepare(`
      INSERT INTO section_template_versions (template_id, version, snapshot, changelog, author_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(templateId, version, JSON.stringify(snapshot), changelog || null, authorId || null);
    return r.lastInsertRowid;
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
    const rows = db.prepare(`
      SELECT st.*,
             u.display_name AS content_validated_by_name,
             (SELECT COUNT(*) FROM sections s
                JOIN afs a ON a.id = s.af_id
                WHERE s.section_template_id = st.id AND a.deleted_at IS NULL) AS affected_afs_count,
             (SELECT COUNT(*) FROM sections s
                JOIN afs a ON a.id = s.af_id
                WHERE s.section_template_id = st.id AND a.deleted_at IS NULL
                  AND (s.section_template_version IS NULL OR s.section_template_version < st.current_version)) AS outdated_count,
             (SELECT COUNT(*) FROM attachments
                WHERE section_template_id = st.id) AS attachments_count,
             (SELECT GROUP_CONCAT(document_kind) FROM section_template_documents
                WHERE section_template_id = st.id) AS document_kinds_csv
      FROM section_templates st
      LEFT JOIN users u ON u.id = st.content_validated_by
      ${whereClause}
      ORDER BY st.position, st.id
    `).all(...params);
    // Splitte la csv en array. Defaut : ['af'] si rien (cohérent avec backfill mig 78).
    return rows.map(r => ({
      ...r,
      document_kinds: r.document_kinds_csv ? r.document_kinds_csv.split(',').sort() : [],
    }));
  },
  getById(id) {
    const row = db.prepare(`
      SELECT st.*, u.display_name AS content_validated_by_name
      FROM section_templates st
      LEFT JOIN users u ON u.id = st.content_validated_by
      WHERE st.id = ?
    `).get(id);
    if (!row) return null;
    return { ...row, document_kinds: this.getDocumentKinds(id) };
  },
  getBySlug(slug) {
    return db.prepare('SELECT * FROM section_templates WHERE slug = ?').get(slug);
  },
  create({ slug, number, title, kind, bodyHtml, bacsArticles, serviceLevel, serviceLevelSource, features, isFunctionality, parentTemplateId, equipmentTemplateId, availE, availS, availP, iconName }) {
    // Position : derniere de la fratrie (parent_template_id donne).
    const maxRow = db.prepare(
      'SELECT COALESCE(MAX(position), 0) AS m FROM section_templates WHERE parent_template_id IS ?'
    ).get(parentTemplateId || null);
    const position = (maxRow?.m || 0) + 10;
    const result = db.prepare(`
      INSERT INTO section_templates
        (slug, number, title, kind, body_html, bacs_articles, service_level, service_level_source,
         features, is_functionality, position, parent_template_id, equipment_template_id,
         avail_e, avail_s, avail_p, icon_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(slug, number || null, title, kind || 'standard', bodyHtml || null,
            bacsArticles || null, serviceLevel || null, serviceLevelSource || null,
            features ? JSON.stringify(features) : null, isFunctionality ? 1 : 0, position,
            parentTemplateId || null, equipmentTemplateId || null,
            availE || null, availS || null, availP || null, iconName || null);
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
  // Compte les descendants (tous niveaux) d'un section_template via CTE
  // recursive. Sert au warning avant DELETE : la FK est CASCADE (mig 133),
  // donc supprimer un parent emporte tout le sous-arbre.
  countDescendants(id) {
    const r = db.prepare(`
      WITH RECURSIVE descendants(id) AS (
        SELECT id FROM section_templates WHERE parent_template_id = ?
        UNION ALL
        SELECT st.id FROM section_templates st
        JOIN descendants d ON st.parent_template_id = d.id
      )
      SELECT COUNT(*) AS c FROM descendants
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
  update(id, { title, bodyHtml, bacsArticles, serviceLevel, updatedBy, kind, parentTemplateId, equipmentTemplateId, availE, availS, availP, iconName, changelog, faqPublishable }) {
    // Snapshot du body_html courant AVANT ecrasement, ssi le body change
    // reellement. Permet la restauration depuis l'UI (modale d'edition).
    if (bodyHtml !== undefined) {
      const cur = this.getById(id);
      if (cur && (cur.body_html || '') !== (bodyHtml || '')) {
        sectionTemplateVersions.create({
          templateId: id,
          version: cur.current_version,
          snapshot: { body_html: cur.body_html, title: cur.title },
          changelog: changelog || null,
          authorId: updatedBy || null,
        });
      }
    }
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
    if (iconName !== undefined) { fields.push('icon_name = ?'); params.push(iconName); }
    if (faqPublishable !== undefined) { fields.push('faq_publishable = ?'); params.push(faqPublishable ? 1 : 0); }
    if (updatedBy !== undefined) { fields.push('updated_by = ?'); params.push(updatedBy); }
    // Auto-clear validation : si le contenu change, on repasse en brouillon.
    // Le snapshot ci-dessus a deja teste le diff effectif.
    if (bodyHtml !== undefined) {
      const cur = this.getById(id);
      if (cur && (cur.body_html || '') !== (bodyHtml || '')) {
        fields.push('content_validated_at = NULL');
        fields.push('content_validated_by = NULL');
      }
    }
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
  // Lot — Le titre est aussi une meta non editable par section AF (le titre
  // canonique est dans la biblio). Toujours propagé aux sections rattachees.
  syncTitle(templateId, newTitle, newVersion) {
    const r = db.prepare(`
      UPDATE sections
         SET title = ?, section_template_version = ?
       WHERE section_template_id = ?
    `).run(newTitle, newVersion, templateId);
    return r.changes;
  },

  // ── Multi-tagging par type de document (Lot — migration 78) ──────────
  // Chaque section type peut etre rattachee a 1+ types de documents Buildy
  // (cf. seeds/document-kinds.js). 'af' par defaut. Heritage parent → enfants
  // en cascade a l'ecriture (CTE recursive sur parent_template_id).
  getDocumentKinds(id) {
    return db.prepare(
      'SELECT document_kind FROM section_template_documents WHERE section_template_id = ? ORDER BY document_kind'
    ).all(id).map(r => r.document_kind);
  },

  setDocumentKinds(id, kinds, { cascade = true } = {}) {
    const tx = db.transaction(() => {
      const targets = [id];
      let cascadedCount = 0;
      if (cascade) {
        const descendants = db.prepare(`
          WITH RECURSIVE descendants(id) AS (
            SELECT id FROM section_templates WHERE parent_template_id = ?
            UNION ALL
            SELECT st.id FROM section_templates st JOIN descendants d ON st.parent_template_id = d.id
          )
          SELECT id FROM descendants
        `).all(id);
        for (const d of descendants) targets.push(d.id);
        cascadedCount = descendants.length;
      }
      const del = db.prepare('DELETE FROM section_template_documents WHERE section_template_id = ?');
      const ins = db.prepare(
        'INSERT INTO section_template_documents (section_template_id, document_kind) VALUES (?, ?)'
      );
      for (const tid of targets) {
        del.run(tid);
        for (const k of kinds) ins.run(tid, k);
      }
      return { updated: targets.length, cascaded: cascadedCount };
    });
    return tx();
  },

  // Modification en bulk des document_kinds sur plusieurs sections types.
  // Modes :
  //   - 'add' : ajoute les `kinds` aux tags existants (INSERT OR IGNORE)
  //   - 'remove' : retire les `kinds` des tags existants
  //   - 'replace' : remplace tous les tags par la liste fournie (DELETE + INSERT)
  // Si `cascade` est true, l'operation s'applique aussi aux descendants
  // (CTE recursive sur parent_template_id) de chaque id selectionne.
  bulkUpdateDocumentKinds({ ids, action, kinds, cascade = true }) {
    if (!Array.isArray(ids) || !ids.length) return { affected: 0, cascaded: 0 };
    if (!['add', 'remove', 'replace'].includes(action)) {
      throw new Error(`Invalid bulk action: ${action}`);
    }
    if (!Array.isArray(kinds) || !kinds.length) {
      throw new Error('At least one document_kind required');
    }
    const tx = db.transaction(() => {
      const targets = new Set(ids);
      let cascadedCount = 0;
      if (cascade) {
        const descStmt = db.prepare(`
          WITH RECURSIVE descendants(id) AS (
            SELECT id FROM section_templates WHERE parent_template_id = ?
            UNION ALL
            SELECT st.id FROM section_templates st JOIN descendants d ON st.parent_template_id = d.id
          )
          SELECT id FROM descendants
        `);
        for (const id of ids) {
          const descendants = descStmt.all(id);
          for (const d of descendants) {
            if (!targets.has(d.id)) {
              targets.add(d.id);
              cascadedCount++;
            }
          }
        }
      }
      const insStmt = db.prepare(
        'INSERT OR IGNORE INTO section_template_documents (section_template_id, document_kind) VALUES (?, ?)'
      );
      const delKindStmt = db.prepare(
        'DELETE FROM section_template_documents WHERE section_template_id = ? AND document_kind = ?'
      );
      const delAllStmt = db.prepare(
        'DELETE FROM section_template_documents WHERE section_template_id = ?'
      );
      for (const tid of targets) {
        if (action === 'add') {
          for (const k of kinds) insStmt.run(tid, k);
        } else if (action === 'remove') {
          for (const k of kinds) delKindStmt.run(tid, k);
        } else { // 'replace'
          delAllStmt.run(tid);
          for (const k of kinds) insStmt.run(tid, k);
        }
      }
      return { affected: targets.size, cascaded: cascadedCount };
    });
    return tx();
  },

  // Clone récursif d'une section type avec tout son sous-arbre. Le titre du
  // root est remplacé par newTitle (suffixé « (copie) » par le caller). Les
  // descendants conservent leur titre. Slug unique généré pour chaque node
  // via la callback `slugifyTitle` (passée par le caller pour partager la
  // logique avec le seeder). Attachments clonées en référençant les mêmes
  // fichiers sur disque (pas de copie binaire).
  cloneSubtree(rootId, { newTitle, slugifyTitle, userId }) {
    const root = this.getById(rootId);
    if (!root) throw new Error(`Section template #${rootId} introuvable`);
    const tx = db.transaction(() => {
      const idMap = new Map(); // oldId -> newId
      const insertOne = (src, overrideTitle, parentNewId) => {
        const title = overrideTitle ?? src.title;
        let baseSlug = slugifyTitle(title);
        let candidate = baseSlug;
        let suffix = 2;
        while (db.prepare('SELECT 1 FROM section_templates WHERE slug = ?').get(candidate)) {
          candidate = `${baseSlug}-${suffix++}`;
        }
        const maxRow = db.prepare(
          'SELECT COALESCE(MAX(position), 0) AS m FROM section_templates WHERE parent_template_id IS ?'
        ).get(parentNewId || null);
        const position = (maxRow?.m || 0) + 10;
        const r = db.prepare(`
          INSERT INTO section_templates
            (slug, title, kind, body_html, bacs_articles, service_level, service_level_source,
             features, is_functionality, position, parent_template_id, equipment_template_id,
             avail_e, avail_s, avail_p, icon_name)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          candidate, title, src.kind || 'standard',
          src.body_html, src.bacs_articles, src.service_level, src.service_level_source,
          src.features, src.is_functionality ? 1 : 0, position,
          parentNewId || null, src.equipment_template_id || null,
          src.avail_e, src.avail_s, src.avail_p, src.icon_name,
        );
        const newId = r.lastInsertRowid;
        idMap.set(src.id, newId);
        // Document kinds
        const kinds = db.prepare(
          'SELECT document_kind FROM section_template_documents WHERE section_template_id = ?'
        ).all(src.id).map(k => k.document_kind);
        if (kinds.length) {
          const ins = db.prepare(
            'INSERT INTO section_template_documents (section_template_id, document_kind) VALUES (?, ?)'
          );
          for (const k of kinds) ins.run(newId, k);
        } else {
          db.prepare(
            'INSERT INTO section_template_documents (section_template_id, document_kind) VALUES (?, ?)'
          ).run(newId, 'af');
        }
        // Attachments (référencent les mêmes filename sur disque)
        const atts = db.prepare(
          'SELECT * FROM attachments WHERE section_template_id = ? ORDER BY position, id'
        ).all(src.id);
        for (const a of atts) {
          db.prepare(`
            INSERT INTO attachments
              (section_template_id, filename, original_name, caption, position, width, height, full_width, uploaded_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(newId, a.filename, a.original_name, a.caption, a.position, a.width, a.height, a.full_width || 0, userId || null);
        }
        return newId;
      };
      // Walk récursif : on insère src + descendants, en mappant les parents.
      const walk = (src, parentNewId, overrideTitle) => {
        const newId = insertOne(src, overrideTitle, parentNewId);
        const children = db.prepare(
          'SELECT * FROM section_templates WHERE parent_template_id = ? ORDER BY position, id'
        ).all(src.id);
        for (const child of children) walk(child, newId, undefined);
      };
      walk(root, root.parent_template_id, newTitle);
      return idMap;
    });
    const idMap = tx();
    return {
      newRootId: idMap.get(rootId),
      clonedCount: idMap.size,
    };
  },

  // Statut de validation du contenu (mig 89). Action utilisateur explicite
  // depuis l'éditeur. Toute modif ultérieure du body_html re-clear la
  // validation (cf. update() ci-dessus).
  validateContent(id, userId) {
    db.prepare(`
      UPDATE section_templates
         SET content_validated_at = CURRENT_TIMESTAMP,
             content_validated_by = ?
       WHERE id = ?
    `).run(userId || null, id);
    return this.getById(id);
  },
  unvalidateContent(id) {
    db.prepare(`
      UPDATE section_templates
         SET content_validated_at = NULL,
             content_validated_by = NULL
       WHERE id = ?
    `).run(id);
    return this.getById(id);
  },

  // Liste les section_templates qui POURRAIENT etre ajoutes a une AF
  // donnee : tagges 'af', avec un parent_template_id present dans l'AF
  // (ou top-level), et qui ne sont pas DEJA dans l'AF. Sert a alimenter
  // la "detection d'elements modifies" avec une source supplementaire :
  // les nouveaux templates de la bibliotheque non encore presents.
  missingByAf(afId) {
    return db.prepare(`
      SELECT st.*
      FROM section_templates st
      INNER JOIN section_template_documents stdocs
        ON stdocs.section_template_id = st.id AND stdocs.document_kind = 'af'
      WHERE NOT EXISTS (
          SELECT 1 FROM sections s
          WHERE s.af_id = ? AND s.section_template_id = st.id
        )
        AND (
          st.parent_template_id IS NULL
          OR EXISTS (
            SELECT 1 FROM sections s2
            WHERE s2.af_id = ? AND s2.section_template_id = st.parent_template_id
          )
        )
      ORDER BY st.position, st.id
    `).all(afId, afId);
  },

  // Helper interne : insere le section_template dans une AF si le parent
  // est present (ou top-level). Retourne 'inserted' | 'skipped-exists' |
  // 'skipped-no-parent'. Idempotent.
  _insertTemplateIntoAf(afId, tpl) {
    const exists = db.prepare(
      'SELECT 1 FROM sections WHERE af_id = ? AND section_template_id = ?'
    ).get(afId, tpl.id);
    if (exists) return 'skipped-exists';
    let parentSectionId = null;
    if (tpl.parent_template_id) {
      const parent = db.prepare(
        'SELECT id FROM sections WHERE af_id = ? AND section_template_id = ? LIMIT 1'
      ).get(afId, tpl.parent_template_id);
      if (!parent) return 'skipped-no-parent';
      parentSectionId = parent.id;
    }
    const maxPos = db.prepare(
      'SELECT COALESCE(MAX(position), 0) AS m FROM sections WHERE af_id = ? AND parent_id IS ?'
    ).get(afId, parentSectionId);
    const position = (maxPos?.m || 0) + 10;
    const created = sections.create({
      afId,
      parentId: parentSectionId,
      position,
      number: null,
      title: tpl.title,
      serviceLevel: tpl.service_level || null,
      serviceLevelSource: tpl.service_level ? 'manual' : null,
      bacsArticles: tpl.bacs_articles || null,
      bodyHtml: tpl.body_html || null,
      kind: tpl.kind || 'standard',
      equipmentTemplateId: tpl.equipment_template_id || null,
    });
    db.prepare('UPDATE sections SET section_template_id = ?, section_template_version = ? WHERE id = ?')
      .run(tpl.id, tpl.current_version, created.id);
    return 'inserted';
  },

  // Propagation d'un NOUVEAU template aux AFs existantes (au moment de
  // sa creation dans la bibliotheque). Insere dans toutes les AFs ouvertes
  // ou le parent existe. Idempotent.
  propagateNewToAfs(templateId) {
    const tpl = this.getById(templateId);
    if (!tpl) return { inserted: 0, skipped: 0 };
    if (!Array.isArray(tpl.document_kinds) || !tpl.document_kinds.includes('af')) {
      return { inserted: 0, skipped: 0, reason: 'not-af-tagged' };
    }
    const allAfs = db.prepare('SELECT id FROM afs WHERE deleted_at IS NULL').all();
    let inserted = 0, skipped = 0;
    for (const af of allAfs) {
      const r = this._insertTemplateIntoAf(af.id, tpl);
      if (r === 'inserted') inserted++; else skipped++;
    }
    return { inserted, skipped };
  },

  // Ajoute un template manquant dans une AF specifique (action utilisateur
  // depuis le bandeau "Mises a jour de la bibliotheque" -> source new_*).
  addMissingTemplateToAf(afId, templateId) {
    const tpl = this.getById(templateId);
    if (!tpl) return { ok: false, reason: 'template-not-found' };
    if (!Array.isArray(tpl.document_kinds) || !tpl.document_kinds.includes('af')) {
      return { ok: false, reason: 'not-af-tagged' };
    }
    const r = this._insertTemplateIntoAf(afId, tpl);
    return { ok: r === 'inserted', reason: r };
  },
};

// ── AFs ──────────────────────────────────────────────────────────────
const afs = {
  /**
   * @param {object} [opts]
   * @param {string} [opts.status]
   * @param {boolean} [opts.includeDeleted=false]
   * @param {number} [opts.forUserId] — filtre les docs accessibles à cet
   *   utilisateur (mig 107 : creator-only par défaut). Owner OR grant
   *   posé dans af_permissions. Si omis : retourne tous les docs (admin
   *   uniquement, ou contextes internes).
   */
  list({ status, includeDeleted = false, forUserId } = {}) {
    let sql = 'SELECT a.* FROM afs a WHERE 1=1';
    const params = [];
    if (!includeDeleted) sql += ' AND a.deleted_at IS NULL';
    if (status) { sql += ' AND a.status = ?'; params.push(status); }
    if (forUserId != null) {
      sql += ` AND (a.created_by = ?
        OR EXISTS (SELECT 1 FROM af_permissions p WHERE p.af_id = a.id AND p.user_id = ?))`;
      params.push(forUserId, forUserId);
    }
    sql += ' ORDER BY a.updated_at DESC';
    return db.prepare(sql).all(...params);
  },
  getById(id) {
    return db.prepare('SELECT * FROM afs WHERE id = ?').get(id);
  },
  getBySlug(slug) {
    return db.prepare('SELECT * FROM afs WHERE slug = ?').get(slug);
  },
  create({ slug, clientName, projectName, siteAddress, serviceLevel, createdBy, kind, siteId, title }) {
    const result = db.prepare(`
      INSERT INTO afs (slug, client_name, project_name, site_address, service_level, kind, site_id, title, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      slug, clientName, projectName, siteAddress || null, serviceLevel || null,
      kind || 'af', siteId || null, title || null,
      createdBy || null, createdBy || null,
    );
    return this.getById(result.lastInsertRowid);
  },
  update(id, fields) {
    const allowed = [
      'client_name', 'project_name', 'site_address', 'service_level', 'status', 'delivered_at',
      'kind', 'site_id', 'title', 'slug',
      'bacs_total_power_kw', 'bacs_total_power_source', 'bacs_building_permit_date',
      'bacs_applicable_deadline', 'bacs_applicability_status',
      'delivered_pdf_sha256', 'delivered_git_tag',
      'audit_synthesis_html', 'audit_synthesis_generated_at',
      'audit_existing_af_status', 'bacs_district_heating_substation_kw',
      'bacs_roi_study_status', 'bacs_roi_study_html',
      'bacs_generator_works_date',
      // Livres blancs (mig 140)
      'parent_af_id', 'wp_layout', 'wp_audience', 'wp_version', 'wp_meta_json',
    ];
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
  // ── Livres blancs (mig 140) ────────────────────────────────────────
  // Liste les livres blancs « parents » (parent_af_id IS NULL) avec le
  // compte de leurs documents compagnons.
  listWhitepapers() {
    return db.prepare(`
      SELECT a.*,
             (SELECT COUNT(*) FROM afs c
                WHERE c.parent_af_id = a.id AND c.deleted_at IS NULL) AS companion_count
      FROM afs a
      WHERE a.kind = 'whitepaper' AND a.parent_af_id IS NULL AND a.deleted_at IS NULL
      ORDER BY a.updated_at DESC
    `).all();
  },
  // Documents compagnons d'un livre blanc parent.
  listCompanions(parentId) {
    return db.prepare(`
      SELECT * FROM afs
      WHERE kind = 'whitepaper' AND parent_af_id = ? AND deleted_at IS NULL
      ORDER BY created_at ASC
    `).all(parentId);
  },
};

// ── Sections ─────────────────────────────────────────────────────────
const sections = {
  listByAf(afId) {
    // Joint :
    //   - section_templates pour avail_e/s/p (UI distingue inclus / paid_option / null) + icon_name
    //   - equipment_templates pour les icones colorees des systemes techniques
    //     (kind='equipment'), exposees via EquipmentIcon.vue dans l'arborescence.
    return db.prepare(`
      SELECT s.*,
             stt.avail_e AS tpl_avail_e,
             stt.avail_s AS tpl_avail_s,
             stt.avail_p AS tpl_avail_p,
             stt.icon_name AS tpl_icon_name,
             eqt.icon_kind AS eq_icon_kind,
             eqt.icon_value AS eq_icon_value,
             eqt.icon_color AS eq_icon_color,
             eqt.category AS eq_category,
             eqt.bacs_justification AS eq_bacs_justification,
             eqt.bacs_articles AS eq_bacs_articles,
             scd.label AS cat_label,
             scd.icon_value AS cat_icon_value,
             scd.icon_color AS cat_icon_color
      FROM sections s
      LEFT JOIN section_templates stt ON stt.id = s.section_template_id
      LEFT JOIN equipment_templates eqt ON eqt.id = s.equipment_template_id
      LEFT JOIN system_categories_db scd ON scd.key = s.system_category_key
      WHERE s.af_id = ?
      ORDER BY s.parent_id NULLS FIRST, s.position, s.id
    `).all(afId);
  },
  // Variante "lite" : meme structure que listByAf mais SANS body_html ni
  // body_yjs (les BLOB Yjs peuvent peser plusieurs centaines de Ko sur des
  // AFs riches). Sert au chargement initial de l'arborescence ou` seuls les
  // titres + flags + icones sont necessaires. Le body est ensuite recupere a
  // la selection via getById().
  // Ajoute un champ derive `is_empty` (1/0) pour preserver l'indicateur
  // visuel "section vide" dans le tree sans avoir a renvoyer le body_html.
  listByAfLight(afId) {
    return db.prepare(`
      SELECT s.id, s.af_id, s.parent_id, s.position, s.number, s.title,
             s.service_level, s.service_level_source, s.bacs_articles,
             s.kind, s.included_in_export, s.generic_note, s.fact_check_status,
             s.opted_out_by_moa, s.demanded_by_moa, s.optin_paid_option,
             s.equipment_template_id, s.equipment_template_version,
             s.section_template_id, s.section_template_version,
             s.system_category_key,
             s.hyperveez_page_slug, s.created_at, s.updated_at, s.updated_by,
             CASE
               WHEN s.body_html IS NULL OR s.body_html = '' THEN 1
               WHEN s.body_html LIKE '%class="text-gray-400"%' THEN 1
               ELSE 0
             END AS is_empty,
             stt.avail_e AS tpl_avail_e,
             stt.avail_s AS tpl_avail_s,
             stt.avail_p AS tpl_avail_p,
             stt.icon_name AS tpl_icon_name,
             eqt.icon_kind AS eq_icon_kind,
             eqt.icon_value AS eq_icon_value,
             eqt.icon_color AS eq_icon_color,
             eqt.category AS eq_category,
             eqt.bacs_justification AS eq_bacs_justification,
             eqt.bacs_articles AS eq_bacs_articles,
             scd.label AS cat_label,
             scd.icon_value AS cat_icon_value,
             scd.icon_color AS cat_icon_color
      FROM sections s
      LEFT JOIN section_templates stt ON stt.id = s.section_template_id
      LEFT JOIN equipment_templates eqt ON eqt.id = s.equipment_template_id
      LEFT JOIN system_categories_db scd ON scd.key = s.system_category_key
      WHERE s.af_id = ?
      ORDER BY s.parent_id NULLS FIRST, s.position, s.id
    `).all(afId);
  },
  getById(id) {
    return db.prepare(`
      SELECT s.*, u.display_name AS updated_by_name, u.email AS updated_by_email,
             eqt.slug AS equipment_template_slug, eqt.name AS equipment_template_name,
             eqt.bacs_justification AS eq_bacs_justification,
             eqt.bacs_articles AS eq_bacs_articles,
             eqt.description_html AS eq_description_html,
             stt.slug AS section_template_slug, stt.title AS section_template_title,
             stt.is_functionality AS section_template_is_functionality,
             stt.avail_e AS tpl_avail_e,
             stt.avail_s AS tpl_avail_s,
             stt.avail_p AS tpl_avail_p,
             stt.icon_name AS tpl_icon_name
      FROM sections s
      LEFT JOIN users u ON u.id = s.updated_by
      LEFT JOIN equipment_templates eqt ON eqt.id = s.equipment_template_id
      LEFT JOIN section_templates stt ON stt.id = s.section_template_id
      WHERE s.id = ?
    `).get(id);
  },
  create({ afId, parentId, position, number, title, serviceLevel, serviceLevelSource,
           bacsArticles, bodyHtml, kind, equipmentTemplateId, equipmentTemplateVersion,
           hyperveezPageSlug, systemCategoryKey,
           includedInExport = 1, genericNote = 0 }) {
    const result = db.prepare(`
      INSERT INTO sections
        (af_id, parent_id, position, number, title, service_level, service_level_source,
         bacs_articles, body_html, kind, included_in_export, generic_note,
         equipment_template_id, equipment_template_version, hyperveez_page_slug,
         system_category_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      afId, parentId || null, position || 0, number || null, title,
      serviceLevel || null, serviceLevelSource || null, bacsArticles || null,
      bodyHtml || null, kind || 'standard', includedInExport, genericNote,
      equipmentTemplateId || null, equipmentTemplateVersion || null, hyperveezPageSlug || null,
      systemCategoryKey || null
    );
    return this.getById(result.lastInsertRowid);
  },
  update(id, fields) {
    const allowed = [
      'parent_id', 'position', 'number', 'title', 'service_level', 'service_level_source',
      'bacs_articles', 'bacs_justification', 'body_html', 'description_html_override',
      'kind', 'included_in_export', 'generic_note',
      'opted_out_by_moa', 'demanded_by_moa', 'optin_paid_option',
      'fact_check_status', 'equipment_template_id', 'equipment_template_version',
      'section_template_id', 'section_template_version',
      'hyperveez_page_slug', 'system_category_key',
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
  // Lot — Reorder + re-parentage atomique d'une fratrie complete.
  // Pour chaque id de orderedIds : set parent_id = parentId + position (i+1)*10.
  // Couvre 2 cas :
  //   1) reorder simple (tous les ids ont deja parentId comme parent)
  //   2) re-parentage par drag (un ou plusieurs ids changent de parent)
  // Garde-fou anti-cycle : un id ne peut pas etre droppe dans son propre
  // sous-arbre. Filtre les ids invalides (autre AF, descendant du target).
  reorderSiblings(afId, parentId, orderedIds) {
    if (!Array.isArray(orderedIds) || !orderedIds.length) return 0;
    const placeholders = orderedIds.map(() => '?').join(',');
    // Verifie que tous les ids appartiennent a l'AF
    const validInAf = db.prepare(
      `SELECT id FROM sections WHERE af_id = ? AND id IN (${placeholders})`
    ).all(afId, ...orderedIds).map(r => r.id);
    const validInAfSet = new Set(validInAf);
    // Anti-cycle : si parentId est dans le sous-arbre d'un id deplace, abort.
    // On calcule pour chaque id deplace tous ses descendants (CTE), et
    // on rejette si parentId y figure.
    let cycleViolation = false;
    if (parentId != null) {
      for (const id of orderedIds) {
        if (!validInAfSet.has(id)) continue;
        const descendants = db.prepare(`
          WITH RECURSIVE descendants(id) AS (
            SELECT id FROM sections WHERE parent_id = ?
            UNION ALL
            SELECT s.id FROM sections s JOIN descendants d ON s.parent_id = d.id
          )
          SELECT id FROM descendants
        `).all(id).map(r => r.id);
        if (id === parentId || descendants.includes(parentId)) {
          cycleViolation = true; break;
        }
      }
    }
    if (cycleViolation) return 0;
    const filtered = orderedIds.filter(id => validInAfSet.has(id));
    const tx = db.transaction(() => {
      filtered.forEach((id, i) => {
        db.prepare(
          'UPDATE sections SET parent_id = ?, position = ? WHERE id = ?'
        ).run(parentId, (i + 1) * 10, id);
      });
    });
    tx();
    return filtered.length;
  },

  // Lot — Deplace une section au sein de sa fratrie (meme af_id + parent_id).
  // direction = 'up' / 'down'. Idempotent : noop si deja en bord.
  // Retourne true si la section a bouge, false sinon.
  moveWithinSiblings(id, direction) {
    const sec = this.getById(id);
    if (!sec) return false;
    const siblings = db.prepare(`
      SELECT id, position FROM sections
      WHERE af_id = ? AND parent_id IS ?
      ORDER BY position, id
    `).all(sec.af_id, sec.parent_id);
    const idx = siblings.findIndex(s => s.id === id);
    if (idx < 0) return false;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= siblings.length) return false;
    const a = siblings[idx];
    const b = siblings[targetIdx];
    // Swap des positions. Si elles sont egales (collision), on reorder
    // l'ensemble de la fratrie en increments de 10 et on swap.
    const tx = db.transaction(() => {
      if (a.position === b.position) {
        siblings.forEach((s, i) => {
          db.prepare('UPDATE sections SET position = ? WHERE id = ?').run((i + 1) * 10, s.id);
        });
        const nextSiblings = db.prepare(
          'SELECT id, position FROM sections WHERE af_id = ? AND parent_id IS ? ORDER BY position, id'
        ).all(sec.af_id, sec.parent_id);
        const na = nextSiblings.find(s => s.id === a.id);
        const nb = nextSiblings.find(s => s.id === b.id);
        db.prepare('UPDATE sections SET position = ? WHERE id = ?').run(nb.position, na.id);
        db.prepare('UPDATE sections SET position = ? WHERE id = ?').run(na.position, nb.id);
      } else {
        db.prepare('UPDATE sections SET position = ? WHERE id = ?').run(b.position, a.id);
        db.prepare('UPDATE sections SET position = ? WHERE id = ?').run(a.position, b.id);
      }
    });
    tx();
    return true;
  },
  // Sections d'une AF qui referencent un template a une version anterieure
  // a la version courante du template (= une mise a jour est disponible).
  // Marque opted_out_by_moa = 1 sur les sections de l'AF dont le niveau de
  // service requis est *strictement superieur* au niveau cible de l'AF.
  // Utilise a la creation d'une AF avec un service_level defini (ex: 'S')
  // pour ecarter automatiquement les fonctionnalites Premium-only que la
  // MOA ne pourra pas activer dans son contrat.
  // Logique : on prend la 1ere lettre du service_level de chaque section
  // (ex: 'E/S/P' -> 'E', 'S/P' -> 'S', 'P' -> 'P') et on compare au rang
  // RANK={E:0,S:1,P:2} ; si rang section > rang cible AF, opt-out.
  optOutAboveLevel(afId, afLevel) {
    const RANK = { E: 0, S: 1, P: 2 };
    const targetRank = RANK[(afLevel || '').toUpperCase()];
    // Etape 1 : opt-out direct des sections dont le service_level est superieur au niveau cible.
    let directChanges = 0;
    if (targetRank != null && targetRank < 2) {
      const above = ['E', 'S', 'P'].filter(l => RANK[l] > targetRank);
      const placeholders = above.map(() => '?').join(',');
      const r = db.prepare(`
        UPDATE sections
           SET opted_out_by_moa = 1
         WHERE af_id = ?
           AND service_level IS NOT NULL
           AND opted_out_by_moa = 0
           AND SUBSTR(UPPER(service_level), 1, 1) IN (${placeholders})
      `).run(afId, ...above);
      directChanges = r.changes;
    }
    // Etape 1bis : opt-out des fonctionnalites « options payantes pures »
    // (les 3 niveaux a 'paid_option' — exemple : Option Serenite). Ces
    // sections ont service_level=null donc ne sont pas capturees par
    // l'etape 1, mais elles ne devraient pas etre activees par defaut
    // (la MOA doit les demander explicitement via demanded_by_moa).
    // Applicable a tous les niveaux d'AF (E/S/P) : une option payante
    // est par definition un add-on hors contrat de base.
    const r1b = db.prepare(`
      UPDATE sections
         SET opted_out_by_moa = 1
       WHERE af_id = ?
         AND opted_out_by_moa = 0
         AND demanded_by_moa = 0
         AND section_template_id IN (
           SELECT id FROM section_templates
            WHERE avail_e = 'paid_option'
              AND avail_s = 'paid_option'
              AND avail_p = 'paid_option'
         )
    `).run(afId);
    const optionPaidChanges = r1b.changes;
    const r = { changes: directChanges + optionPaidChanges };
    // Etape 2 : cascade aux descendants (cf. feedback_section_flags_cascade.md).
    // Une fonctionnalite ecartee implique que ses sous-sections le sont aussi
    // (ex: 11 Gojee opt-out -> 11.1, 11.2, 11.3 suivent meme si elles n'ont
    // pas de service_level propre). CTE recursive sur parent_id puis UPDATE
    // ciblé sur les ids collectes.
    const descendantsToOptOut = db.prepare(`
      WITH RECURSIVE descendants(id) AS (
        SELECT s.id FROM sections s
          JOIN sections p ON p.id = s.parent_id
         WHERE s.af_id = ? AND p.opted_out_by_moa = 1 AND s.opted_out_by_moa = 0
        UNION ALL
        SELECT s.id FROM sections s
          JOIN descendants d ON s.parent_id = d.id
         WHERE s.af_id = ? AND s.opted_out_by_moa = 0
      )
      SELECT id FROM descendants
    `).all(afId, afId);
    let cascadeChanges = 0;
    if (descendantsToOptOut.length) {
      const ids = descendantsToOptOut.map(x => x.id);
      const idPlaceholders = ids.map(() => '?').join(',');
      const r2 = db.prepare(
        `UPDATE sections SET opted_out_by_moa = 1 WHERE id IN (${idPlaceholders})`
      ).run(...ids);
      cascadeChanges = r2.changes;
    }
    return r.changes + cascadeChanges;
  },
  // Preview : meme logique que optOutAboveLevel mais retourne la liste des
  // sections candidates au lieu d'appliquer l'UPDATE. Utilise par l'UI pour
  // afficher un resume avant confirmation utilisateur. Le compteur include
  // la cascade aux descendants (mais on ne renvoie que les sections "racines"
  // dans la liste pour ne pas saturer l'apercu).
  previewOptOutAboveLevel(afId, afLevel) {
    const RANK = { E: 0, S: 1, P: 2 };
    const targetRank = RANK[(afLevel || '').toUpperCase()];
    const out = [];
    // Sections dont le service_level est superieur au niveau cible
    if (targetRank != null && targetRank < 2) {
      const above = ['E', 'S', 'P'].filter(l => RANK[l] > targetRank);
      const placeholders = above.map(() => '?').join(',');
      out.push(...db.prepare(`
        SELECT id, number, title, service_level
          FROM sections
         WHERE af_id = ?
           AND service_level IS NOT NULL
           AND opted_out_by_moa = 0
           AND SUBSTR(UPPER(service_level), 1, 1) IN (${placeholders})
         ORDER BY position, id
      `).all(afId, ...above));
    }
    // Options payantes pures (Sérénité etc.) — toujours candidates a l'opt-out.
    out.push(...db.prepare(`
      SELECT s.id, s.number, s.title, s.service_level
        FROM sections s
       WHERE s.af_id = ?
         AND s.opted_out_by_moa = 0
         AND s.demanded_by_moa = 0
         AND s.section_template_id IN (
           SELECT id FROM section_templates
            WHERE avail_e = 'paid_option'
              AND avail_s = 'paid_option'
              AND avail_p = 'paid_option'
         )
       ORDER BY s.position, s.id
    `).all(afId));
    // Dedup par id (au cas ou)
    const seen = new Set();
    return out.filter(s => seen.has(s.id) ? false : (seen.add(s.id), true));
  },
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
  // Sections narratives + fonctionnalites de l'AF dont le section_template lie
  // a evolue depuis la version pinnee. Le banner global de propagation utilise
  // cette methode en plus de outdatedByAf (qui ne couvre que les equipements).
  outdatedSectionTemplatesByAf(afId) {
    return db.prepare(`
      SELECT s.id, s.number, s.title, s.section_template_id, s.section_template_version,
             s.body_html AS section_body_html,
             st.title AS template_title, st.slug AS template_slug, st.current_version,
             st.body_html AS template_body_html, st.is_functionality
      FROM sections s
      JOIN section_templates st ON st.id = s.section_template_id
      WHERE s.af_id = ?
        AND s.section_template_id IS NOT NULL
        AND (s.section_template_version IS NULL OR s.section_template_version < st.current_version)
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
  // Liste effective pour une section AF : captures de la section + celles
  // heritees du section_template (s'il existe) + de l'equipment_template
  // (s'il existe). Chaque ligne a un champ `source` :
  //   'section' (specifique a cette AF, editable)
  //   'section_template' / 'equipment_template' (heritee, lecture seule
  //   pour cette AF — il faut editer le template a la source).
  listEffectiveForSection(sectionId) {
    const sec = db.prepare('SELECT id, section_template_id, equipment_template_id FROM sections WHERE id = ?').get(sectionId);
    if (!sec) return [];
    const fromTplSection = sec.section_template_id
      ? db.prepare(`
          SELECT a.*, u.display_name AS uploaded_by_name, 'section_template' AS source
          FROM attachments a
          LEFT JOIN users u ON u.id = a.uploaded_by
          WHERE a.section_template_id = ?
          ORDER BY a.position, a.id
        `).all(sec.section_template_id)
      : [];
    const fromTplEquip = sec.equipment_template_id
      ? db.prepare(`
          SELECT a.*, u.display_name AS uploaded_by_name, 'equipment_template' AS source
          FROM attachments a
          LEFT JOIN users u ON u.id = a.uploaded_by
          WHERE a.equipment_template_id = ?
          ORDER BY a.position, a.id
        `).all(sec.equipment_template_id)
      : [];
    const fromAfSection = db.prepare(`
      SELECT a.*, u.display_name AS uploaded_by_name, 'section' AS source
      FROM attachments a
      LEFT JOIN users u ON u.id = a.uploaded_by
      WHERE a.section_id = ?
      ORDER BY a.position, a.id
    `).all(sectionId);
    // Heritage en tete (ordre stable pour PDF), specifiques apres.
    return [...fromTplSection, ...fromTplEquip, ...fromAfSection];
  },
  listBySectionTemplate(templateId) {
    return db.prepare(`
      SELECT a.*, u.display_name AS uploaded_by_name
      FROM attachments a
      LEFT JOIN users u ON u.id = a.uploaded_by
      WHERE section_template_id = ?
      ORDER BY position, id
    `).all(templateId);
  },
  listByEquipmentTemplate(templateId) {
    return db.prepare(`
      SELECT a.*, u.display_name AS uploaded_by_name
      FROM attachments a
      LEFT JOIN users u ON u.id = a.uploaded_by
      WHERE equipment_template_id = ?
      ORDER BY position, id
    `).all(templateId);
  },
  getById(id) {
    return db.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
  },
  // Crée un attachment lié à exactement UN parent : passer { sectionId } OU
  // { sectionTemplateId } OU { equipmentTemplateId }. Le CHECK constraint
  // SQL s'assure que les autres restent NULL.
  create({ sectionId, sectionTemplateId, equipmentTemplateId,
           filename, originalName, caption, position, width, height, uploadedBy }) {
    const result = db.prepare(`
      INSERT INTO attachments
        (section_id, section_template_id, equipment_template_id,
         filename, original_name, caption, position, width, height, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sectionId || null, sectionTemplateId || null, equipmentTemplateId || null,
      filename, originalName || null, caption || null, position || 0,
      width || null, height || null, uploadedBy || null);
    return this.getById(result.lastInsertRowid);
  },
  update(id, { caption, position, full_width }) {
    const sets = [], params = [];
    if (caption !== undefined) { sets.push('caption = ?'); params.push(caption); }
    if (position !== undefined) { sets.push('position = ?'); params.push(position); }
    if (full_width !== undefined) { sets.push('full_width = ?'); params.push(full_width ? 1 : 0); }
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
//
// La source de verite du rattachement template <-> categorie est
// `equipment_templates.category` (string libre). La colonne historique
// `system_categories_db.slugs` (JSON array stockee en DB) est conservee
// pour compatibilite mais n'est plus la verite : `slugs` est CALCULE
// a la volee dans list/getById/getByKey en dynamique depuis
// `equipment_templates.category = key`. Au write (PATCH), `slugs` peut
// etre fourni ; on propage via UPDATE equipment_templates.category
// (cf. route PATCH /system-categories/:id pour la logique).
function _slugsForKey(key) {
  if (!key) return [];
  return db.prepare('SELECT slug FROM equipment_templates WHERE category = ? ORDER BY name')
    .all(key)
    .map(r => r.slug);
}
const systemCategoriesDb = {
  list() {
    return db.prepare('SELECT * FROM system_categories_db ORDER BY position, id').all().map(r => ({
      ...r,
      slugs: _slugsForKey(r.key),
    }));
  },
  getByKey(key) {
    const r = db.prepare('SELECT * FROM system_categories_db WHERE key = ?').get(key);
    if (!r) return null;
    return { ...r, slugs: _slugsForKey(r.key) };
  },
  getById(id) {
    const r = db.prepare('SELECT * FROM system_categories_db WHERE id = ?').get(id);
    if (!r) return null;
    return { ...r, slugs: _slugsForKey(r.key) };
  },
  create({ key, label, bacs, iconValue, iconColor, position }) {
    // Note (mig 121) : la colonne `slugs` est supprimee. La liste des
    // equipements rattaches est calculee a la volee via _slugsForKey
    // depuis equipment_templates.category.
    const result = db.prepare(`
      INSERT INTO system_categories_db (key, label, bacs, icon_value, icon_color, position)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(key, label, bacs || null,
            iconValue || 'fa-cube', iconColor || '#6b7280', position || 0);
    return this.getById(result.lastInsertRowid);
  },
  update(id, { key, label, bacs, iconValue, iconColor, position }) {
    const fields = [], params = [];
    // key editable (validation unicite faite cote route — UNIQUE constraint
    // ici en filet de securite). Voir route PATCH pour la cascade.
    if (key !== undefined && key !== null) { fields.push('key = ?'); params.push(key); }
    if (label !== undefined) { fields.push('label = ?'); params.push(label); }
    if (bacs !== undefined) { fields.push('bacs = ?'); params.push(bacs); }
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
    if (!af) return { ok: false, role: null };
    if (af.created_by === userId) return { ok: true, role: 'owner' };
    // Mig 107 : modèle « creator-only par défaut ». L'accès n'est plus
    // implicite — il faut une entrée explicite dans af_permissions.
    // Compat : la mig 107 a snapshoté tous les docs existants en posant
    // un grant 'write' à tous les users qui existaient au moment du
    // déploiement. Tous les nouveaux docs (créés après la mig) sont
    // strictement creator-only jusqu'au premier partage.
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

// ── Milestones de transition de phase (snapshots PDF + tag Git) ──────
// Stocke les snapshots figés lors des transitions validee / commissioning /
// commissioned / delivery (kind correspondant). La table garde son nom
// historique af_inspections pour ne pas reécrire les FK existantes.
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
  create(afId, { inspectorName, gitTag, pdfExportId, notes, createdBy, kind }) {
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

// ── Sites (synchro bidirectionnelle avec Fleet Manager) ─────────────
// Alias `id AS site_id` pour compat API frontend (Lot 1 : PK uniformisee
// en `id` cote DB ; le frontend continue de lire `site_id`/`zone_id`/`equipment_id`).
const SITES_SELECT = '*, id AS site_id';
const ZONES_SELECT = '*, id AS zone_id';
const EQUIPMENTS_SELECT = '*, id AS equipment_id';

const sites = {
  list({ includeDeleted = false, search } = {}) {
    let sql = `SELECT ${SITES_SELECT} FROM sites WHERE 1=1`;
    const params = [];
    if (!includeDeleted) sql += ' AND deleted_at IS NULL';
    if (search) {
      sql += ' AND (name LIKE ? OR customer_name LIKE ? OR address LIKE ?)';
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern);
    }
    sql += ' ORDER BY name';
    return db.prepare(sql).all(...params);
  },
  getById(id) {
    return db.prepare(`SELECT ${SITES_SELECT} FROM sites WHERE id = ?`).get(id);
  },
  getByUuid(uuid) {
    return db.prepare(`SELECT ${SITES_SELECT} FROM sites WHERE site_uuid = ?`).get(uuid);
  },
  create({ siteUuid, name, customerName, address, notes, createdBy, syncedAt }) {
    const result = db.prepare(`
      INSERT INTO sites (site_uuid, name, customer_name, address, notes, created_by, updated_by, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      siteUuid, name, customerName || null, address || null, notes || null,
      createdBy || null, createdBy || null, syncedAt || null,
    );
    return this.getById(result.lastInsertRowid);
  },
  update(id, fields) {
    const allowed = ['name', 'customer_name', 'address', 'notes', 'synced_at', 'deleted_at'];
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
    db.prepare(`UPDATE sites SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.getById(id);
  },
  // Cascade : la suppression d'un site marque le site + toutes ses zones
  // + tous les equipements de ces zones avec le MEME timestamp. Ca permet
  // a `restore()` de ne reanimer que les enfants supprimes par CETTE
  // cascade (pas ceux supprimes manuellement avant).
  softDelete(id) {
    const ts = db.prepare("SELECT strftime('%Y-%m-%d %H:%M:%f', 'now') AS ts").get().ts;
    const tx = db.transaction(() => {
      db.prepare('UPDATE sites SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(ts, ts, id);
      db.prepare('UPDATE zones SET deleted_at = ?, updated_at = ? WHERE site_id = ? AND deleted_at IS NULL').run(ts, ts, id);
      db.prepare(`
        UPDATE equipments SET deleted_at = ?, updated_at = ?
        WHERE deleted_at IS NULL
          AND zone_id IN (SELECT id FROM zones WHERE site_id = ? AND deleted_at = ?)
      `).run(ts, ts, id, ts);
    });
    tx();
  },
  restore(id) {
    const site = this.getById(id);
    if (!site || !site.deleted_at) return;
    const ts = site.deleted_at;
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE equipments SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE deleted_at = ? AND zone_id IN (SELECT id FROM zones WHERE site_id = ?)
      `).run(ts, id);
      db.prepare('UPDATE zones SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE site_id = ? AND deleted_at = ?').run(id, ts);
      db.prepare('UPDATE sites SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    });
    tx();
  },
};

// ── Zones (locales Buildy Docs, attachees a un site) ───────────────
const zones = {
  listBySite(siteId, { includeDeleted = false } = {}) {
    let sql = `SELECT ${ZONES_SELECT} FROM zones WHERE site_id = ?`;
    const params = [siteId];
    if (!includeDeleted) sql += ' AND deleted_at IS NULL';
    sql += ' ORDER BY position, name';
    return db.prepare(sql).all(...params);
  },
  getById(id) {
    return db.prepare(`SELECT ${ZONES_SELECT} FROM zones WHERE id = ?`).get(id);
  },
  create({ siteId, name, nature, kind, position, surfaceM2, notes }) {
    const result = db.prepare(`
      INSERT INTO zones (site_id, name, nature, kind, position, surface_m2, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(siteId, name, nature || null, kind || 'functional', position || 0, surfaceM2 ?? null, notes || null);
    return this.getById(result.lastInsertRowid);
  },
  update(id, fields) {
    const allowed = ['name', 'nature', 'kind', 'position', 'surface_m2', 'notes', 'notes_html', 'deleted_at'];
    const sets = [], params = [];
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      const col = k.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
      if (allowed.includes(col)) { sets.push(`${col} = ?`); params.push(v); }
    }
    if (!sets.length) return this.getById(id);
    sets.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    db.prepare(`UPDATE zones SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.getById(id);
  },
  // Cascade : suppression d'une zone ->
  //   - equipements de la zone : soft-delete (avec restore possible).
  //   - rows BACS audit (systems/meters/thermal_regulation) : hard-delete.
  //     Pourquoi hard ? Ces tables n'ont pas de colonne deleted_at et sont
  //     deja regenerables a la volee depuis le seeder. Les laisser orphelines
  //     creerait des "zones fantomes" reconstituees par le fallback frontend
  //     (audit.js loadAudit) et empecherait l'utilisateur de supprimer la
  //     zone (DELETE no-op sur zone deja soft-delete).
  //   - bacs_audit_system_devices : auto-cascade par FK ON DELETE CASCADE
  //     declenchee par la suppression des bacs_audit_systems parents.
  softDelete(id) {
    const ts = db.prepare("SELECT strftime('%Y-%m-%d %H:%M:%f', 'now') AS ts").get().ts;
    const tx = db.transaction(() => {
      db.prepare('UPDATE zones SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(ts, ts, id);
      db.prepare('UPDATE equipments SET deleted_at = ?, updated_at = ? WHERE zone_id = ? AND deleted_at IS NULL').run(ts, ts, id);
      db.prepare('DELETE FROM bacs_audit_systems WHERE zone_id = ?').run(id);
      db.prepare('DELETE FROM bacs_audit_meters WHERE zone_id = ?').run(id);
      db.prepare('DELETE FROM bacs_audit_thermal_regulation WHERE zone_id = ?').run(id);
    });
    tx();
  },
  restore(id) {
    const zone = this.getById(id);
    if (!zone || !zone.deleted_at) return;
    const ts = zone.deleted_at;
    const tx = db.transaction(() => {
      db.prepare('UPDATE equipments SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE zone_id = ? AND deleted_at = ?').run(id, ts);
      db.prepare('UPDATE zones SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    });
    tx();
  },
};

// ── Equipements (et compteurs) ──────────────────────────────────────
const equipments = {
  listByZone(zoneId, { includeDeleted = false } = {}) {
    let sql = `SELECT ${EQUIPMENTS_SELECT} FROM equipments WHERE zone_id = ?`;
    const params = [zoneId];
    if (!includeDeleted) sql += ' AND deleted_at IS NULL';
    sql += ' ORDER BY name';
    return db.prepare(sql).all(...params);
  },
  listBySite(siteId, { includeDeleted = false } = {}) {
    let sql = `
      SELECT e.*, e.id AS equipment_id FROM equipments e
      JOIN zones z ON z.id = e.zone_id
      WHERE z.site_id = ?
    `;
    const params = [siteId];
    if (!includeDeleted) sql += ' AND e.deleted_at IS NULL AND z.deleted_at IS NULL';
    sql += ' ORDER BY e.name';
    return db.prepare(sql).all(...params);
  },
  getById(id) {
    return db.prepare(`SELECT ${EQUIPMENTS_SELECT} FROM equipments WHERE id = ?`).get(id);
  },
  create({ zoneId, name, type, powerKw, communicationProtocol, installationDate, status, bacsClassification, notes }) {
    const result = db.prepare(`
      INSERT INTO equipments
        (zone_id, name, type, power_kw, communication_protocol, installation_date, status, bacs_classification, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      zoneId, name, type,
      powerKw == null ? null : powerKw,
      communicationProtocol || null,
      installationDate || null,
      status || 'operational',
      bacsClassification ? JSON.stringify(bacsClassification) : null,
      notes || null,
    );
    return this.getById(result.lastInsertRowid);
  },
  update(id, fields) {
    const allowed = [
      'zone_id', 'name', 'type', 'power_kw', 'communication_protocol',
      'installation_date', 'status', 'bacs_classification', 'notes', 'deleted_at',
    ];
    const sets = [], params = [];
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      const col = k.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
      if (allowed.includes(col)) {
        sets.push(`${col} = ?`);
        params.push(col === 'bacs_classification' && v && typeof v === 'object' ? JSON.stringify(v) : v);
      }
    }
    if (!sets.length) return this.getById(id);
    sets.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    db.prepare(`UPDATE equipments SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.getById(id);
  },
  softDelete(id) {
    db.prepare('UPDATE equipments SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  },
  restore(id) {
    db.prepare('UPDATE equipments SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  },
  // Cumul puissance chauffage + climatisation pour le seuil R175-2
  sumBacsPowerForSite(siteId) {
    const rows = db.prepare(`
      SELECT e.power_kw, e.bacs_classification
      FROM equipments e
      JOIN zones z ON z.id = e.zone_id
      WHERE z.site_id = ? AND e.deleted_at IS NULL AND z.deleted_at IS NULL
        AND e.status != 'decommissioned' AND e.power_kw IS NOT NULL
    `).all(siteId);
    let total = 0;
    for (const r of rows) {
      let cls = null;
      try { cls = r.bacs_classification ? JSON.parse(r.bacs_classification) : null; } catch { cls = null; }
      if (cls?.is_heating_system || cls?.is_air_cooling_system) total += r.power_kw;
    }
    return total;
  },
};

// ── Queue retry pour la synchro FM ──────────────────────────────────
const sitesSyncQueue = {
  enqueue(siteUuid, payload) {
    db.prepare(`
      INSERT INTO sites_sync_queue (site_uuid, payload)
      VALUES (?, ?)
    `).run(siteUuid, JSON.stringify(payload));
  },
  dueNow(limit = 50) {
    return db.prepare(`
      SELECT * FROM sites_sync_queue
      WHERE next_attempt_at <= CURRENT_TIMESTAMP
      ORDER BY next_attempt_at
      LIMIT ?
    `).all(limit).map(r => ({ ...r, payload: JSON.parse(r.payload) }));
  },
  reschedule(id, { error, delaySeconds }) {
    db.prepare(`
      UPDATE sites_sync_queue
      SET attempts = attempts + 1,
          last_error = ?,
          last_attempt_at = CURRENT_TIMESTAMP,
          next_attempt_at = datetime('now', ? || ' seconds')
      WHERE id = ?
    `).run(error || null, '+' + Math.max(60, delaySeconds || 60), id);
  },
  remove(id) {
    db.prepare('DELETE FROM sites_sync_queue WHERE id = ?').run(id);
  },
};

// ── Audit sync state (consolidation vers Fleet Manager) ─────────────
// Singleton (id=1). epoch identifie l'instance Docs cote FM. last_id avance
// au fur et a mesure que les batches sont pousses avec succes.
const auditSync = {
  // Lit l'etat ; si absent, l'initialise avec un nouvel epoch (UUID v4).
  // Idempotent : le premier appel cree le row, les suivants le retournent.
  getOrInit() {
    let row = db.prepare('SELECT epoch, last_id, last_pushed_at FROM audit_sync_state WHERE id = 1').get();
    if (!row) {
      const epoch = require('crypto').randomUUID();
      db.prepare('INSERT INTO audit_sync_state (id, epoch, last_id) VALUES (1, ?, 0)').run(epoch);
      row = { epoch, last_id: 0, last_pushed_at: null };
    }
    return row;
  },
  // Avance le curseur apres un push reussi.
  setLastId(lastId) {
    db.prepare(`
      UPDATE audit_sync_state
      SET last_id = ?, last_pushed_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run(lastId);
  },
  // Recupere un batch d'events a pousser (avec join users + sites pour
  // resoudre username + site_uuid). Limite a 500 (cap cote FM).
  fetchBatch(cursor, limit = 500) {
    return db.prepare(`
      SELECT a.id, a.created_at, a.action, a.af_id, a.section_id, a.template_id,
             a.payload, COALESCE(u.display_name, u.email) AS username,
             s.site_uuid
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.user_id
      LEFT JOIN afs af ON af.id = a.af_id
      LEFT JOIN sites s ON s.id = af.site_id
      WHERE a.id > ?
      ORDER BY a.id ASC
      LIMIT ?
    `).all(cursor, limit);
  },
};

// ── Prompts IA editables ────────────────────────────────────────────
const aiPrompts = {
  get(key) {
    return db.prepare('SELECT * FROM ai_prompts WHERE key = ?').get(key);
  },
  list() {
    return db.prepare(`
      SELECT p.*, u.display_name AS updated_by_name
      FROM ai_prompts p
      LEFT JOIN users u ON u.id = p.updated_by
      ORDER BY p.key
    `).all();
  },
  upsert({ key, body, updatedBy, label }) {
    const existing = this.get(key);
    db.transaction(() => {
      // Snapshot version courante AVANT modification
      if (existing && existing.body !== body) {
        db.prepare(`
          INSERT INTO ai_prompt_versions (key, body, created_by, label)
          VALUES (?, ?, ?, ?)
        `).run(key, existing.body, existing.updated_by || null, label || null);
      }
      // Insert ou update du prompt courant
      db.prepare(`
        INSERT INTO ai_prompts (key, body, updated_by, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
          body = excluded.body,
          updated_by = excluded.updated_by,
          updated_at = CURRENT_TIMESTAMP
      `).run(key, body, updatedBy || null);
    })();
    return this.get(key);
  },
  listVersions(key, { limit = 20 } = {}) {
    return db.prepare(`
      SELECT v.*, u.display_name AS created_by_name
      FROM ai_prompt_versions v
      LEFT JOIN users u ON u.id = v.created_by
      WHERE v.key = ?
      ORDER BY v.created_at DESC
      LIMIT ?
    `).all(key, limit);
  },
  getVersion(versionId) {
    return db.prepare('SELECT * FROM ai_prompt_versions WHERE id = ?').get(versionId);
  },
  delete(key) {
    db.transaction(() => {
      db.prepare('DELETE FROM ai_prompt_versions WHERE key = ?').run(key);
      db.prepare('DELETE FROM ai_prompts WHERE key = ?').run(key);
    })();
  },
};

// ── Brochure (lot A2) ───────────────────────────────────────────────
// Items composant une brochure (commerciale ou catalogue d'offres).
const brochureItems = {
  listByBrochure(brochureId) {
    return db.prepare(`
      SELECT * FROM brochure_items
      WHERE brochure_id = ?
      ORDER BY position, id
    `).all(brochureId);
  },
  getById(id) {
    return db.prepare('SELECT * FROM brochure_items WHERE id = ?').get(id);
  },
  create({ brochureId, position = 0, itemKind, sourceId = null, sourceSlug = null,
           title = null, bodyHtml = null, overrideTitle = null, overrideHtml = null }) {
    const result = db.prepare(`
      INSERT INTO brochure_items (brochure_id, position, item_kind, source_id,
                                  source_slug, title, body_html,
                                  override_title, override_html)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(brochureId, position, itemKind, sourceId, sourceSlug,
           title, bodyHtml, overrideTitle, overrideHtml);
    return this.getById(result.lastInsertRowid);
  },
  update(id, patch) {
    const sets = [];
    const args = [];
    const fieldMap = {
      position: 'position', overrideTitle: 'override_title',
      overrideHtml: 'override_html', title: 'title', bodyHtml: 'body_html',
    };
    for (const [k, col] of Object.entries(fieldMap)) {
      if (patch[k] !== undefined) { sets.push(`${col} = ?`); args.push(patch[k]); }
    }
    if (!sets.length) return this.getById(id);
    sets.push('updated_at = CURRENT_TIMESTAMP');
    args.push(id);
    db.prepare(`UPDATE brochure_items SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    return this.getById(id);
  },
  remove(id) {
    db.prepare('DELETE FROM brochure_items WHERE id = ?').run(id);
  },
};

const brochureLibrary = {
  list({ kind, includeInactive = false } = {}) {
    let sql = 'SELECT * FROM brochure_library_items WHERE 1=1';
    const args = [];
    if (kind) { sql += ' AND item_kind = ?'; args.push(kind); }
    if (!includeInactive) sql += ' AND is_active = 1';
    sql += ' ORDER BY item_kind, position, id';
    return db.prepare(sql).all(...args);
  },
  getById(id) {
    return db.prepare('SELECT * FROM brochure_library_items WHERE id = ?').get(id);
  },
  getBySlug(slug) {
    return db.prepare('SELECT * FROM brochure_library_items WHERE slug = ?').get(slug);
  },
};

// ── Offering levels (E/S/P avec nom + tagline + decoy editables) ──
const offeringLevels = {
  list() {
    return db.prepare('SELECT * FROM offering_levels ORDER BY position, id').all();
  },
  getBySlug(slug) {
    return db.prepare('SELECT * FROM offering_levels WHERE slug = ?').get(slug);
  },
  update(slug, { name, tagline, isHighlighted, highlightLabel, colorHex, updatedBy = null }) {
    const sets = [];
    const args = [];
    if (name != null) { sets.push('name = ?'); args.push(name); }
    if (tagline !== undefined) { sets.push('tagline = ?'); args.push(tagline); }
    if (isHighlighted != null) { sets.push('is_highlighted = ?'); args.push(isHighlighted ? 1 : 0); }
    if (highlightLabel !== undefined) { sets.push('highlight_label = ?'); args.push(highlightLabel); }
    if (colorHex !== undefined) { sets.push('color_hex = ?'); args.push(colorHex); }
    sets.push('updated_at = CURRENT_TIMESTAMP', 'updated_by = ?');
    args.push(updatedBy, slug);
    db.prepare(`UPDATE offering_levels SET ${sets.join(', ')} WHERE slug = ?`).run(...args);
    return this.getBySlug(slug);
  },
};

const pdfBoilerplate = {
  list({ kind, includeInactive = false } = {}) {
    let sql = 'SELECT * FROM pdf_boilerplate WHERE 1=1';
    const args = [];
    if (kind) { sql += ' AND kind = ?'; args.push(kind); }
    if (!includeInactive) sql += ' AND is_active = 1';
    sql += ' ORDER BY kind, position, id';
    return db.prepare(sql).all(...args);
  },
  getById(id) {
    return db.prepare('SELECT * FROM pdf_boilerplate WHERE id = ?').get(id);
  },
  create({ kind, position = 0, title = null, bodyHtml, updatedBy = null }) {
    const result = db.prepare(`
      INSERT INTO pdf_boilerplate (kind, position, title, body_html, updated_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(kind, position, title, bodyHtml, updatedBy);
    return this.getById(result.lastInsertRowid);
  },
  update(id, { position, title, bodyHtml, isActive, updatedBy = null }) {
    const sets = [];
    const args = [];
    if (position != null) { sets.push('position = ?'); args.push(position); }
    if (title !== undefined) { sets.push('title = ?'); args.push(title); }
    if (bodyHtml != null) { sets.push('body_html = ?'); args.push(bodyHtml); }
    if (isActive != null) { sets.push('is_active = ?'); args.push(isActive ? 1 : 0); }
    sets.push('updated_at = CURRENT_TIMESTAMP');
    sets.push('updated_by = ?'); args.push(updatedBy);
    args.push(id);
    db.prepare(`UPDATE pdf_boilerplate SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    return this.getById(id);
  },
  remove(id) {
    db.prepare('DELETE FROM pdf_boilerplate WHERE id = ?').run(id);
  },
};

// ── FAQ Buildy / Crisp Knowledge Base (lot 90) ──────────────────────
// crisp_settings = singleton (id=1) avec credentials chiffrés via lib/crypto.
const crispSettings = {
  get() {
    return db.prepare('SELECT * FROM crisp_settings WHERE id = 1').get() || null;
  },
  upsert({ apiIdentifierEncrypted, apiKeyEncrypted, websiteId, defaultLocale }) {
    db.prepare(`
      INSERT INTO crisp_settings (id, api_identifier_encrypted, api_key_encrypted, website_id, default_locale, updated_at)
      VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        api_identifier_encrypted = excluded.api_identifier_encrypted,
        api_key_encrypted = excluded.api_key_encrypted,
        website_id = excluded.website_id,
        default_locale = excluded.default_locale,
        updated_at = CURRENT_TIMESTAMP
    `).run(apiIdentifierEncrypted, apiKeyEncrypted, websiteId, defaultLocale || 'fr');
    return this.get();
  },
  setLastPull({ status, error }) {
    db.prepare(`
      UPDATE crisp_settings
      SET last_pull_at = CURRENT_TIMESTAMP, last_pull_status = ?, last_pull_error = ?
      WHERE id = 1
    `).run(status || null, error || null);
  },
};

const faqCategoriesTombstones = {
  list() {
    return db.prepare('SELECT * FROM faq_categories_tombstones ORDER BY deleted_at DESC').all();
  },
  has(crispId) {
    return !!db.prepare('SELECT 1 FROM faq_categories_tombstones WHERE crisp_id = ?').get(crispId);
  },
  add(crispId, { localId = null, reason = null } = {}) {
    db.prepare(`
      INSERT INTO faq_categories_tombstones (crisp_id, local_id, reason)
      VALUES (?, ?, ?)
      ON CONFLICT(crisp_id) DO UPDATE SET deleted_at = CURRENT_TIMESTAMP, reason = excluded.reason
    `).run(crispId, localId, reason);
  },
  remove(crispId) {
    db.prepare('DELETE FROM faq_categories_tombstones WHERE crisp_id = ?').run(crispId);
  },
};

const faqSettings = {
  getSeoKeywords() {
    const row = db.prepare('SELECT seo_keywords_json FROM faq_settings WHERE id = 1').get();
    if (!row || !row.seo_keywords_json) return null;
    try {
      const parsed = JSON.parse(row.seo_keywords_json);
      if (!Array.isArray(parsed)) return null;
      return parsed.filter((s) => typeof s === 'string' && s.trim().length > 0);
    } catch {
      return null;
    }
  },
  setSeoKeywords(keywords) {
    const json = JSON.stringify(Array.isArray(keywords) ? keywords : []);
    db.prepare(`
      UPDATE faq_settings
      SET seo_keywords_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run(json);
  },
  resetSeoKeywords() {
    db.prepare(`
      UPDATE faq_settings
      SET seo_keywords_json = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run();
  },
};

const faqCategories = {
  list({ locale } = {}) {
    if (locale) {
      return db.prepare('SELECT * FROM faq_categories WHERE locale = ? ORDER BY order_index, name').all(locale);
    }
    return db.prepare('SELECT * FROM faq_categories ORDER BY order_index, name').all();
  },
  getById(id) {
    return db.prepare('SELECT * FROM faq_categories WHERE id = ?').get(id);
  },
  getByCrispId(crispId) {
    return db.prepare('SELECT * FROM faq_categories WHERE crisp_id = ?').get(crispId);
  },
  create({ crispId = null, name, description = null, color = null, orderIndex = 0,
           parentId = null, locale = 'fr', dirty = 1, pulledAt = null }) {
    const r = db.prepare(`
      INSERT INTO faq_categories (crisp_id, name, description, color, order_index, parent_id, locale, dirty, pulled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(crispId, name, description, color, orderIndex, parentId, locale, dirty ? 1 : 0, pulledAt);
    return this.getById(r.lastInsertRowid);
  },
  update(id, patch) {
    const sets = [];
    const args = [];
    const map = {
      name: 'name', description: 'description', color: 'color',
      orderIndex: 'order_index', parentId: 'parent_id', locale: 'locale',
      crispId: 'crisp_id', dirty: 'dirty', pulledAt: 'pulled_at', pushedAt: 'pushed_at',
    };
    for (const [k, col] of Object.entries(map)) {
      if (patch[k] !== undefined) {
        sets.push(`${col} = ?`);
        args.push(k === 'dirty' ? (patch[k] ? 1 : 0) : patch[k]);
      }
    }
    if (!sets.length) return this.getById(id);
    sets.push('updated_at = CURRENT_TIMESTAMP');
    args.push(id);
    db.prepare(`UPDATE faq_categories SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    return this.getById(id);
  },
  remove(id) {
    db.prepare('DELETE FROM faq_categories WHERE id = ?').run(id);
  },
  countArticles(id) {
    return db.prepare('SELECT COUNT(*) as n FROM faq_articles WHERE category_id = ?').get(id).n;
  },
};

const faqArticles = {
  list({ categoryId = null, status = null, q = null, locale = null, limit = 500 } = {}) {
    const where = [];
    const args = [];
    if (categoryId !== null && categoryId !== undefined) { where.push('a.category_id = ?'); args.push(categoryId); }
    if (status) { where.push('a.status = ?'); args.push(status); }
    if (locale) { where.push('a.locale = ?'); args.push(locale); }
    if (q) {
      where.push('(a.title LIKE ? OR a.content_html LIKE ?)');
      args.push(`%${q}%`, `%${q}%`);
    }
    const sql = `
      SELECT a.id, a.crisp_id, a.category_id, a.title, a.slug, a.description, a.status, a.visibility,
             a.locale, a.dirty, a.pulled_at, a.pushed_at, a.crisp_updated_at, a.crisp_url,
             a.last_ai_assist_at, a.created_at, a.updated_at,
             a.seo_score, a.seo_scored_at,
             c.name AS category_name
      FROM faq_articles a
      LEFT JOIN faq_categories c ON c.id = a.category_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY a.updated_at DESC
      LIMIT ?
    `;
    args.push(limit);
    return db.prepare(sql).all(...args);
  },
  getById(id) {
    return db.prepare('SELECT * FROM faq_articles WHERE id = ?').get(id);
  },
  getByCrispId(crispId) {
    return db.prepare('SELECT * FROM faq_articles WHERE crisp_id = ?').get(crispId);
  },
  listAllTitles() {
    return db.prepare('SELECT id, title, category_id FROM faq_articles ORDER BY title').all();
  },
  // Corpus IA : articles publiés avec URL Crisp (pour permettre les liens internes).
  listForCorpus() {
    return db.prepare(`
      SELECT a.id, a.title, a.crisp_url, a.status, a.content_html,
             c.name AS category_name
      FROM faq_articles a
      LEFT JOIN faq_categories c ON c.id = a.category_id
      WHERE a.status = 'published' AND a.crisp_url IS NOT NULL
      ORDER BY a.title
    `).all();
  },
  // Snapshot des versions article (avant push, ou avant une réécriture IA).
  snapshot(articleId, { reason = null, userId = null } = {}) {
    const a = this.getById(articleId);
    if (!a) return null;
    const r = db.prepare(`
      INSERT INTO faq_article_versions (article_id, title, content_html, status, reason, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(articleId, a.title, a.content_html || '', a.status || 'draft', reason, userId);
    return r.lastInsertRowid;
  },
  listVersions(articleId, { limit = 30 } = {}) {
    return db.prepare(`
      SELECT v.id, v.article_id, v.title, v.status, v.reason, v.created_at,
             v.created_by, u.display_name AS created_by_name,
             length(v.content_html) AS content_size
      FROM faq_article_versions v
      LEFT JOIN users u ON u.id = v.created_by
      WHERE v.article_id = ?
      ORDER BY v.created_at DESC
      LIMIT ?
    `).all(articleId, limit);
  },
  getVersion(versionId) {
    return db.prepare('SELECT * FROM faq_article_versions WHERE id = ?').get(versionId);
  },
  // Modale "Insérer un lien vers un article" : recherche par titre, articles publiés.
  listForLinkPicker(q = null) {
    const where = ["a.crisp_url IS NOT NULL", "a.status = 'published'"];
    const args = [];
    if (q && q.trim()) {
      where.push('a.title LIKE ?');
      args.push(`%${q.trim()}%`);
    }
    return db.prepare(`
      SELECT a.id, a.title, a.crisp_url, c.name AS category_name
      FROM faq_articles a
      LEFT JOIN faq_categories c ON c.id = a.category_id
      WHERE ${where.join(' AND ')}
      ORDER BY a.title
      LIMIT 200
    `).all(...args);
  },
  create({ crispId = null, categoryId = null, title, slug = null, description = null,
           contentHtml = null, status = 'draft', visibility = 'public', locale = 'fr',
           dirty = 1, pulledAt = null, crispUpdatedAt = null, crispUrl = null,
           createdBy = null,
           // Sync biblio -> FAQ (mig 138)
           sourceSectionTemplateId = null, sourceSyncedVersion = null,
           sourceSyncedAt = null, sourceOverridden = 0, bacsArticles = null }) {
    const r = db.prepare(`
      INSERT INTO faq_articles (crisp_id, category_id, title, slug, description, content_html,
                                status, visibility, locale, dirty, pulled_at, crisp_updated_at,
                                crisp_url, created_by, updated_by,
                                source_section_template_id, source_synced_version,
                                source_synced_at, source_overridden, bacs_articles)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(crispId, categoryId, title, slug, description, contentHtml,
           status, visibility, locale, dirty ? 1 : 0, pulledAt, crispUpdatedAt,
           crispUrl, createdBy, createdBy,
           sourceSectionTemplateId, sourceSyncedVersion,
           sourceSyncedAt, sourceOverridden ? 1 : 0, bacsArticles);
    return this.getById(r.lastInsertRowid);
  },
  update(id, patch, userId = null) {
    const sets = [];
    const args = [];
    const map = {
      categoryId: 'category_id', title: 'title', slug: 'slug', description: 'description',
      contentHtml: 'content_html', status: 'status', visibility: 'visibility',
      locale: 'locale', crispId: 'crisp_id', dirty: 'dirty',
      pulledAt: 'pulled_at', pushedAt: 'pushed_at', crispUpdatedAt: 'crisp_updated_at',
      crispUrl: 'crisp_url',
      lastAiAssistAt: 'last_ai_assist_at',
      // Sync biblio -> FAQ (mig 138)
      sourceSectionTemplateId: 'source_section_template_id',
      sourceSyncedVersion: 'source_synced_version',
      sourceSyncedAt: 'source_synced_at',
      sourceOverridden: 'source_overridden',
      bacsArticles: 'bacs_articles',
    };
    for (const [k, col] of Object.entries(map)) {
      if (patch[k] !== undefined) {
        sets.push(`${col} = ?`);
        const isBool = k === 'dirty' || k === 'sourceOverridden';
        args.push(isBool ? (patch[k] ? 1 : 0) : patch[k]);
      }
    }
    if (!sets.length) return this.getById(id);
    sets.push('updated_at = CURRENT_TIMESTAMP');
    if (userId) { sets.push('updated_by = ?'); args.push(userId); }
    args.push(id);
    db.prepare(`UPDATE faq_articles SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    return this.getById(id);
  },
  remove(id) {
    db.prepare('DELETE FROM faq_articles WHERE id = ?').run(id);
  },

  // ── SEO score (mig 101) ──────────────────────────────────────────
  // Persiste un score 0-100 + checks JSON + timestamp. Recalculé sur
  // chaque save/pull/generate via lib/seo-scorer.js.
  setSeoScore(id, { score, checks }) {
    const checksJson = checks ? JSON.stringify(checks) : null;
    db.prepare(`
      UPDATE faq_articles
      SET seo_score = ?, seo_checks_json = ?, seo_scored_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(score, checksJson, id);
  },

  // Liste les top articles pour few-shot examples Claude.
  // Retourne articles avec score >= minScore, ordonnés par score DESC,
  // optionnellement filtrés par même type d'article (pas de colonne
  // article_type en DB pour l'instant — on retourne tout).
  listTopScored({ excludeId = null, minScore = 80, limit = 3 } = {}) {
    const where = ['seo_score IS NOT NULL', 'seo_score >= ?', "status = 'published'", 'crisp_url IS NOT NULL'];
    const args = [minScore];
    if (excludeId) {
      where.push('id != ?');
      args.push(excludeId);
    }
    args.push(limit);
    return db.prepare(`
      SELECT id, title, content_html, seo_score, crisp_url
      FROM faq_articles
      WHERE ${where.join(' AND ')}
      ORDER BY seo_score DESC, updated_at DESC
      LIMIT ?
    `).all(...args);
  },

  // Sync biblio -> FAQ (mig 138) : retrouve l'article FAQ lié à une fonctionnalité.
  // Une fonctionnalité peut avoir 0 ou plusieurs articles ; on retourne le plus
  // récent (cas standard : 1 seul article par fonctionnalité).
  getBySectionTemplateId(sectionTemplateId) {
    return db.prepare(`
      SELECT * FROM faq_articles
      WHERE source_section_template_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(sectionTemplateId);
  },

  // Lookup articles BACS publiés qui couvrent un ou plusieurs codes BACS.
  // Reçoit ['R175-3 1°', 'R175-6'] -> retourne les articles dont bacs_articles
  // contient au moins un de ces codes. Utilisé pour le maillage SEO interne.
  listBacsCoverage(codes) {
    if (!Array.isArray(codes) || codes.length === 0) return [];
    const where = codes.map(() => 'bacs_articles LIKE ?').join(' OR ');
    const args = codes.map(c => `%${c}%`);
    return db.prepare(`
      SELECT id, title, crisp_url, bacs_articles
      FROM faq_articles
      WHERE crisp_url IS NOT NULL AND status = 'published' AND (${where})
      ORDER BY title
    `).all(...args);
  },
};

// Sync biblio -> FAQ (mig 138) : mapping entre attachment local et URL FTP
// publique. Permet d'éviter de re-uploader les captures à chaque regénération
// si le fichier n'a pas changé (file_hash sha256 inchangé).
const libraryAttachmentPublications = {
  get(attachmentId) {
    return db.prepare('SELECT * FROM library_attachment_publications WHERE attachment_id = ?').get(attachmentId);
  },
  upsert({ attachmentId, ftpUrl, fileHash }) {
    db.prepare(`
      INSERT INTO library_attachment_publications (attachment_id, ftp_url, file_hash, published_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(attachment_id) DO UPDATE SET
        ftp_url = excluded.ftp_url,
        file_hash = excluded.file_hash,
        published_at = CURRENT_TIMESTAMP
    `).run(attachmentId, ftpUrl, fileHash);
    return this.get(attachmentId);
  },
  remove(attachmentId) {
    db.prepare('DELETE FROM library_attachment_publications WHERE attachment_id = ?').run(attachmentId);
  },
};

// ── Bacs Audit — partage multi-zones d'un device (mig 98) ────────────
// Un même équipement physique (chaudière, VMC, luminaire) peut desservir
// plusieurs zones fonctionnelles. La zone d'origine est implicite (celle
// du système parent) ; les zones supplémentaires vivent dans cette table.
const bacsAuditDeviceZones = {
  // Zones supplémentaires desservies par un device. Renvoie [zoneId, ...].
  listExtraForDevice(deviceId) {
    return db.prepare(
      'SELECT zone_id FROM bacs_audit_device_extra_zones WHERE device_id = ? ORDER BY zone_id'
    ).all(deviceId).map(r => r.zone_id);
  },

  // Liste plate des { device_id, zone_id } pour tous les devices d'un
  // document : préfix de résolution sans N+1 pour le GET devices.
  listExtrasForDocument(documentId) {
    return db.prepare(`
      SELECT ez.device_id, ez.zone_id
      FROM bacs_audit_device_extra_zones ez
      JOIN bacs_audit_system_devices d ON d.id = ez.device_id
      JOIN bacs_audit_systems s ON s.id = d.system_id
      WHERE s.document_id = ?
    `).all(documentId);
  },

  // Remplace l'ensemble des zones supplémentaires d'un device.
  setExtraForDevice(deviceId, zoneIds) {
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM bacs_audit_device_extra_zones WHERE device_id = ?').run(deviceId);
      const stmt = db.prepare(
        'INSERT INTO bacs_audit_device_extra_zones (device_id, zone_id) VALUES (?, ?)'
      );
      for (const zid of zoneIds) stmt.run(deviceId, zid);
    });
    tx();
  },
};

// ── Bacs Audit — check-list de collecte (mig 100) ────────────────────
const bacsChecklistCatalog = {
  list({ active = true } = {}) {
    const where = active === null ? '' : 'WHERE active = ?';
    const args = active === null ? [] : [active ? 1 : 0];
    return db.prepare(`
      SELECT * FROM bacs_checklist_catalog ${where}
      ORDER BY position, key
    `).all(...args);
  },
  getByKey(key) {
    return db.prepare('SELECT * FROM bacs_checklist_catalog WHERE key = ?').get(key);
  },
  create({ key, label, description, iconValue, iconColor, position, active = 1 }) {
    db.prepare(`
      INSERT INTO bacs_checklist_catalog (key, label, description, icon_value, icon_color, position, active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(key, label, description || null, iconValue || null, iconColor || null, position || 0, active ? 1 : 0);
    return this.getByKey(key);
  },
  update(key, { label, description, iconValue, iconColor, position, active }) {
    db.prepare(`
      UPDATE bacs_checklist_catalog
      SET label = COALESCE(?, label),
          description = COALESCE(?, description),
          icon_value = COALESCE(?, icon_value),
          icon_color = COALESCE(?, icon_color),
          position = COALESCE(?, position),
          active = COALESCE(?, active),
          updated_at = CURRENT_TIMESTAMP
      WHERE key = ?
    `).run(label, description, iconValue, iconColor, position, active === undefined ? null : (active ? 1 : 0), key);
    return this.getByKey(key);
  },
  remove(key) {
    db.prepare('DELETE FROM bacs_checklist_catalog WHERE key = ?').run(key);
  },
};

const bacsAuditChecklist = {
  // Liste pour un audit : merge catalog (actifs) + état si existant + nb fichiers.
  // Si l'audit n'a pas de ligne pour un item, on retourne un placeholder
  // status='pending' sans créer de ligne (lazy create au 1er upsert).
  listForDocument(documentId) {
    const items = bacsChecklistCatalog.list({ active: true });
    // Auto-create des rows manquantes (status='pending') pour que chaque
    // item ait toujours un `id` stable. Sans ça, BacsPhotoButton reste
    // invisible jusqu'au 1er upsert (le bouton requiert un id pour rattacher).
    const existing = new Set(
      db.prepare('SELECT catalog_key FROM bacs_audit_checklist WHERE document_id = ?').all(documentId).map(r => r.catalog_key)
    );
    const missing = items.filter(it => !existing.has(it.key));
    if (missing.length) {
      const ins = db.prepare('INSERT INTO bacs_audit_checklist (document_id, catalog_key, status) VALUES (?, ?, ?)');
      db.transaction(() => { for (const it of missing) ins.run(documentId, it.key, 'pending'); })();
    }
    const states = db.prepare(
      'SELECT * FROM bacs_audit_checklist WHERE document_id = ?'
    ).all(documentId);
    const stateByKey = new Map(states.map(s => [s.catalog_key, s]));
    const fileCounts = db.prepare(`
      SELECT bacs_audit_checklist_id AS id, COUNT(*) AS n
      FROM site_documents
      WHERE bacs_audit_checklist_id IS NOT NULL
      GROUP BY bacs_audit_checklist_id
    `).all();
    const filesByStateId = new Map(fileCounts.map(r => [r.id, r.n]));
    return items.map(it => {
      const state = stateByKey.get(it.key);
      return {
        catalog_key: it.key,
        label: it.label,
        description: it.description,
        icon_value: it.icon_value,
        icon_color: it.icon_color,
        position: it.position,
        id: state?.id || null,
        status: state?.status || 'pending',
        notes_html: state?.notes_html || null,
        not_available_reason: state?.not_available_reason || null,
        files_count: state?.id ? (filesByStateId.get(state.id) || 0) : 0,
        updated_at: state?.updated_at || null,
      };
    });
  },
  upsert(documentId, catalogKey, patch = {}) {
    const existing = db.prepare(
      'SELECT id FROM bacs_audit_checklist WHERE document_id = ? AND catalog_key = ?'
    ).get(documentId, catalogKey);
    if (!existing) {
      const r = db.prepare(`
        INSERT INTO bacs_audit_checklist (document_id, catalog_key, status, notes_html, not_available_reason)
        VALUES (?, ?, ?, ?, ?)
      `).run(documentId, catalogKey,
        patch.status || 'pending',
        patch.notes_html ?? null,
        patch.not_available_reason ?? null);
      return db.prepare('SELECT * FROM bacs_audit_checklist WHERE id = ?').get(r.lastInsertRowid);
    }
    db.prepare(`
      UPDATE bacs_audit_checklist
      SET status = COALESCE(?, status),
          notes_html = COALESCE(?, notes_html),
          not_available_reason = COALESCE(?, not_available_reason),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(patch.status, patch.notes_html, patch.not_available_reason, existing.id);
    return db.prepare('SELECT * FROM bacs_audit_checklist WHERE id = ?').get(existing.id);
  },
  // Couverture photo : compte combien d'entités (zones / systems présents
  // / meters / bms) ont au moins 1 site_document attaché.
  photoCoverage(documentId) {
    // Zones : on liste celles qui apparaissent dans les systèmes de l'audit
    // (un audit peut avoir des zones-fantômes du site rattaché qu'il
    // n'utilise pas — on ne les compte que si elles ont au moins 1 système).
    const sysRows = db.prepare(`
      SELECT DISTINCT s.zone_id, z.name, z.nature
      FROM bacs_audit_systems s
      LEFT JOIN zones z ON z.id = s.zone_id
      WHERE s.document_id = ?
    `).all(documentId);
    const zoneIds = sysRows.map(r => r.zone_id).filter(Boolean);
    const zonesWithPhotos = zoneIds.length === 0 ? [] :
      db.prepare(`
        SELECT DISTINCT bacs_audit_zone_id AS zone_id
        FROM site_documents
        WHERE bacs_audit_zone_id IN (${zoneIds.map(() => '?').join(',')})
      `).all(...zoneIds).map(r => r.zone_id);
    const zonesCovered = new Set(zonesWithPhotos);
    const zonesMissing = sysRows.filter(r => !zonesCovered.has(r.zone_id))
      .map(r => ({
        id: r.zone_id,
        name: r.name || `Zone #${r.zone_id}`,
        nature: r.nature || null,
      }));

    // Systèmes : on compte ceux marqués present=1. Une photo sur un device
    // du système compte aussi (le device est physique, l'instance compte).
    const sysAll = db.prepare(
      'SELECT id, system_category, zone_id FROM bacs_audit_systems WHERE document_id = ? AND present = 1'
    ).all(documentId);
    const sysIds = sysAll.map(s => s.id);
    const sysWithPhotos = sysIds.length === 0 ? [] :
      db.prepare(`
        SELECT DISTINCT bacs_audit_system_id AS id
        FROM site_documents
        WHERE bacs_audit_system_id IN (${sysIds.map(() => '?').join(',')})
      `).all(...sysIds).map(r => r.id);
    const sysWithDevicePhotos = sysIds.length === 0 ? [] :
      db.prepare(`
        SELECT DISTINCT d.system_id AS id
        FROM site_documents sd
        JOIN bacs_audit_system_devices d ON d.id = sd.bacs_audit_device_id
        WHERE d.system_id IN (${sysIds.map(() => '?').join(',')})
      `).all(...sysIds).map(r => r.id);
    const sysCovered = new Set([...sysWithPhotos, ...sysWithDevicePhotos]);
    const zoneNameById = new Map(sysRows.map(r => [r.zone_id, r.name]));
    const sysMissing = sysAll.filter(s => !sysCovered.has(s.id))
      .map(s => ({
        id: s.id,
        category: s.system_category,
        zone_id: s.zone_id,
        zone_name: zoneNameById.get(s.zone_id) || null,
        name: `${s.system_category} — ${zoneNameById.get(s.zone_id) || `Zone #${s.zone_id}`}`,
      }));

    // Compteurs (avec zone pour navigation + identification PWA)
    const metersAll = db.prepare(`
      SELECT m.id, m.usage, m.meter_type, m.zone_id, z.name AS zone_name
      FROM bacs_audit_meters m
      LEFT JOIN zones z ON z.id = m.zone_id
      WHERE m.document_id = ?
    `).all(documentId);
    const meterIds = metersAll.map(m => m.id);
    const metersWithPhotos = meterIds.length === 0 ? [] :
      db.prepare(`
        SELECT DISTINCT bacs_audit_meter_id AS id
        FROM site_documents
        WHERE bacs_audit_meter_id IN (${meterIds.map(() => '?').join(',')})
      `).all(...meterIds).map(r => r.id);
    const metersCovered = new Set(metersWithPhotos);
    const metersMissing = metersAll.filter(m => !metersCovered.has(m.id))
      .map(m => ({
        id: m.id,
        usage: m.usage,
        meter_type: m.meter_type,
        zone_id: m.zone_id,
        zone_name: m.zone_name || null,
        name: `${m.usage} / ${m.meter_type}${m.zone_name ? ' · ' + m.zone_name : ' · général'}`,
      }));

    // BMS / GTB : table bacs_audit_bms a document_id comme PK (1 ligne par
    // audit). La FK site_documents.bacs_audit_bms_document_id pointe vers
    // ce document_id.
    const bmsRow = db.prepare('SELECT document_id FROM bacs_audit_bms WHERE document_id = ?').get(documentId);
    let bmsFiles = 0;
    if (bmsRow) {
      bmsFiles = db.prepare(
        'SELECT COUNT(*) AS n FROM site_documents WHERE bacs_audit_bms_document_id = ?'
      ).get(documentId).n;
    }

    // Site : 1 entité unique. "Couvert" = au moins 1 photo du site sans
    // rattachement à une entité (zone / system / etc.) — typiquement
    // façade, toiture, vue d'ensemble.
    const af = db.prepare('SELECT site_id FROM afs WHERE id = ?').get(documentId);
    let sitePhotos = 0;
    if (af?.site_id) {
      sitePhotos = db.prepare(`
        SELECT COUNT(*) AS n FROM site_documents
        WHERE site_id = ? AND category = 'photo'
          AND bacs_audit_zone_id IS NULL
          AND bacs_audit_system_id IS NULL
          AND bacs_audit_meter_id IS NULL
          AND bacs_audit_device_id IS NULL
          AND bacs_audit_bms_document_id IS NULL
          AND bacs_audit_action_item_id IS NULL
      `).get(af.site_id).n;
    }

    return {
      site: { total: 1, covered: sitePhotos > 0 ? 1 : 0, files_count: sitePhotos },
      zones: { total: zoneIds.length, covered: zonesCovered.size, missing: zonesMissing },
      systems: { total: sysAll.length, covered: sysCovered.size, missing: sysMissing },
      meters: { total: metersAll.length, covered: metersCovered.size, missing: metersMissing },
      bms: { total: bmsRow ? 1 : 0, covered: bmsFiles > 0 ? 1 : 0, files_count: bmsFiles },
    };
  },

  /**
   * Counts de photos par entité (Vague 4 audit BACS — affordance UI :
   * badge « 📷 N » sur chaque ligne dans MetersSection / SystemsSection
   * / etc. plutôt que d'aller dans la check-list documentaire).
   *
   * Retourne un objet plat :
   *   { zones: { [zoneId]: count }, systems: { [systemId]: count },
   *     meters: { [meterId]: count }, devices: { [deviceId]: count },
   *     bms: count }
   */
  photoCountsByEntity(documentId) {
    const af = db.prepare('SELECT site_id FROM afs WHERE id = ?').get(documentId);
    if (!af) return { zones: {}, systems: {}, meters: {}, devices: {}, bms: 0 };

    const tally = (col, scope) => {
      // Pour zones : seulement celles du site rattaché.
      // Pour systems / meters / devices : seulement ceux de ce document.
      let rows;
      if (col === 'bacs_audit_zone_id') {
        rows = db.prepare(`
          SELECT ${col} AS id, COUNT(*) AS n
          FROM site_documents sd
          JOIN zones z ON z.id = sd.${col}
          WHERE sd.${col} IS NOT NULL AND z.site_id = ?
          GROUP BY ${col}
        `).all(af.site_id);
      } else if (col === 'bacs_audit_device_id') {
        rows = db.prepare(`
          SELECT ${col} AS id, COUNT(*) AS n
          FROM site_documents sd
          JOIN bacs_audit_system_devices d ON d.id = sd.${col}
          JOIN bacs_audit_systems s ON s.id = d.system_id
          WHERE sd.${col} IS NOT NULL AND s.document_id = ?
          GROUP BY ${col}
        `).all(documentId);
      } else {
        // bacs_audit_system_id, bacs_audit_meter_id : direct via document_id
        const tbl = scope === 'systems' ? 'bacs_audit_systems' : 'bacs_audit_meters';
        rows = db.prepare(`
          SELECT sd.${col} AS id, COUNT(*) AS n
          FROM site_documents sd
          JOIN ${tbl} t ON t.id = sd.${col}
          WHERE sd.${col} IS NOT NULL AND t.document_id = ?
          GROUP BY sd.${col}
        `).all(documentId);
      }
      const out = {};
      for (const r of rows) out[r.id] = r.n;
      return out;
    };

    const zones = tally('bacs_audit_zone_id', 'zones');
    const systems = tally('bacs_audit_system_id', 'systems');
    const meters = tally('bacs_audit_meter_id', 'meters');
    const devices = tally('bacs_audit_device_id', 'devices');
    const bms = db.prepare(`
      SELECT COUNT(*) AS n FROM site_documents
      WHERE bacs_audit_bms_document_id = ?
    `).get(documentId).n;
    // Photos du site (sans rattachement à une entité spécifique : façade,
    // toiture, vue d'ensemble…). On couvre les photos du site rattaché à
    // l'audit qui n'ont AUCUNE FK BACS ; sinon on dédoublerait avec les
    // counts par entité (zone / system / meter / device / bms).
    const site = db.prepare(`
      SELECT COUNT(*) AS n FROM site_documents
      WHERE site_id = ? AND category = 'photo'
        AND bacs_audit_zone_id IS NULL
        AND bacs_audit_system_id IS NULL
        AND bacs_audit_meter_id IS NULL
        AND bacs_audit_device_id IS NULL
        AND bacs_audit_bms_document_id IS NULL
        AND bacs_audit_action_item_id IS NULL
    `).get(af.site_id).n;

    return { zones, systems, meters, devices, bms, site };
  },
};

// ─── Constats GTB hors-décret + opportunités Buildy (mig 108) ──────
const gtbTopicsCatalog = {
  list({ active = true } = {}) {
    const where = active === null ? '' : 'WHERE active = ?';
    const args = active === null ? [] : [active ? 1 : 0];
    return db.prepare(`
      SELECT * FROM gtb_topics_catalog ${where}
      ORDER BY position, key
    `).all(...args);
  },
  getByKey(key) {
    return db.prepare('SELECT * FROM gtb_topics_catalog WHERE key = ?').get(key);
  },
};

const bacsAuditGtbObservations = {
  // Liste pour un audit : merge catalog (actifs) + état si saisi.
  // Pas de lazy create : pas d'id stable nécessaire (pas de pièces jointes
  // à rattacher contrairement à la check-list).
  listForDocument(documentId) {
    const topics = gtbTopicsCatalog.list({ active: true });
    const states = db.prepare(
      'SELECT * FROM bacs_audit_gtb_observations WHERE document_id = ?'
    ).all(documentId);
    const stateByKey = new Map(states.map(s => [s.topic_key, s]));
    return topics.map(t => {
      const state = stateByKey.get(t.key);
      return {
        topic_key: t.key,
        label: t.label,
        description: t.description,
        icon_value: t.icon_value,
        position: t.position,
        observation_html: state?.observation_html || null,
        opportunity_html: state?.opportunity_html || null,
        updated_at: state?.updated_at || null,
      };
    });
  },
  upsert(documentId, topicKey, patch = {}) {
    const existing = db.prepare(
      'SELECT id FROM bacs_audit_gtb_observations WHERE document_id = ? AND topic_key = ?'
    ).get(documentId, topicKey);
    if (!existing) {
      db.prepare(`
        INSERT INTO bacs_audit_gtb_observations
          (document_id, topic_key, observation_html, opportunity_html)
        VALUES (?, ?, ?, ?)
      `).run(documentId, topicKey,
        patch.observation_html ?? null,
        patch.opportunity_html ?? null);
    } else {
      db.prepare(`
        UPDATE bacs_audit_gtb_observations
        SET observation_html = COALESCE(?, observation_html),
            opportunity_html = COALESCE(?, opportunity_html),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(patch.observation_html, patch.opportunity_html, existing.id);
    }
    return db.prepare(
      'SELECT * FROM bacs_audit_gtb_observations WHERE document_id = ? AND topic_key = ?'
    ).get(documentId, topicKey);
  },
  // Map topic_key -> observation_html, pour l'export PDF (lookup direct
  // sous chaque sous-section du chapitre 6 GTB).
  notesByTopic(documentId) {
    const rows = db.prepare(
      'SELECT topic_key, observation_html FROM bacs_audit_gtb_observations WHERE document_id = ?'
    ).all(documentId);
    const map = {};
    for (const r of rows) {
      if (r.observation_html?.replace(/<[^>]*>/g, '').trim()) map[r.topic_key] = r.observation_html;
    }
    return map;
  },
};

module.exports = {
  init,
  pdfBoilerplate,
  offeringLevels,
  brochureItems,
  brochureLibrary,
  users,
  sessions,
  equipmentTemplates,
  equipmentTemplatePoints,
  equipmentTemplateVersions,
  sectionTemplates,
  sectionTemplateVersions,
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
  sites,
  zones,
  equipments,
  sitesSyncQueue,
  auditSync,
  aiPrompts,
  crispSettings,
  faqSettings,
  faqCategoriesTombstones,
  faqCategories,
  faqArticles,
  libraryAttachmentPublications,
  bacsAuditDeviceZones,
  bacsChecklistCatalog,
  bacsAuditChecklist,
  gtbTopicsCatalog,
  bacsAuditGtbObservations,
  get db() { return db; },
};
