'use strict';

// Lien traçable des livres blancs.
//
// Le serveur Buildy Docs (docs.buildy.fr) est sur le VPN interne : il ne peut
// pas servir de redirecteur public. Le tracker vit donc sur buildy.fr (OVH,
// PHP) : un script /dl/<slug> journalise le clic puis redirige vers le PDF.
//
//   ensureTracker()  -> publie index.php + .htaccess sur le FTP (idempotent)
//   ingestClicks()   -> ramène hits.log par FTP et l'ingère en base (idempotent)

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { Client } = require('basic-ftp');
const config = require('../config');
const db = require('../database');
const log = require('./logger').system;

// ── Sources du tracker ───────────────────────────────────────────────
// Le script /dl/<slug> SERT le PDF lui-même (lecture disque) après avoir
// journalisé le clic. Le dossier des PDF étant interdit en accès HTTP
// direct (PDF_DIR_HTACCESS), ce script est le seul point d'entrée :
// impossible de télécharger un PDF sans être comptabilisé.
function trackerPhp() {
  // Chemin relatif du dossier des PDF, vu depuis le dossier du tracker.
  const pdfRel = path.posix.relative(config.wpTrackerRemoteDir, config.wpFtpRemoteDir) || '.';
  return `<?php
// Redirecteur traçable des livres blancs Buildy — généré par Buildy Docs.
$d = isset($_GET['d']) ? strtolower(trim($_GET['d'])) : '';
if (!preg_match('/^[a-z0-9-]{1,80}$/', $d)) {
  http_response_code(404);
  header('Content-Type: text/plain; charset=utf-8');
  echo 'Document introuvable.';
  exit;
}
$pdf = __DIR__ . '/${pdfRel}/' . $d . '.pdf';
if (!is_file($pdf)) {
  http_response_code(404);
  header('Content-Type: text/plain; charset=utf-8');
  echo 'Document introuvable.';
  exit;
}
$ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '';
if (strpos($ip, '.') !== false) {
  $ip = preg_replace('/\\.\\d+$/', '.0', $ip);          // IPv4 : dernier octet masqué
} elseif (strpos($ip, ':') !== false) {
  $ip = substr($ip, 0, strrpos($ip, ':')) . ':0';      // IPv6 : dernier groupe masqué
}
$clean = function ($s) { return str_replace(array("\\t", "\\n", "\\r"), ' ', (string) $s); };
$line = implode("\\t", array(
  uniqid('', true),
  gmdate('Y-m-d\\TH:i:s\\Z'),
  $d,
  $ip,
  $clean(isset($_SERVER['HTTP_REFERER']) ? $_SERVER['HTTP_REFERER'] : ''),
  $clean(isset($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : '')
)) . "\\n";
@file_put_contents(__DIR__ . '/hits.log', $line, FILE_APPEND | LOCK_EX);
// Streaming par morceaux avec buffers purgés : readfile() derrière l'output
// buffering + compression du mutualisé OVH retardait le premier octet sur
// les gros PDF (7 Mo+) au point de faire tomber le Varnish du CDN en
// « 503 Backend fetch failed » (incident 2026-07-28, brochure 7,6 Mo).
@set_time_limit(0);
@ini_set('zlib.output_compression', 'Off');
if (function_exists('apache_setenv')) { @apache_setenv('no-gzip', '1'); }
while (ob_get_level() > 0) { @ob_end_clean(); }
header('Content-Type: application/pdf');
header('Content-Disposition: inline; filename="' . $d . '.pdf"');
header('Content-Length: ' . filesize($pdf));
header('Cache-Control: public, max-age=300');
$fh = fopen($pdf, 'rb');
if ($fh === false) {
  http_response_code(500);
  exit;
}
while (!feof($fh)) {
  echo fread($fh, 65536);
  flush();
}
fclose($fh);
exit;
`;
}

const TRACKER_HTACCESS = `RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteRule ^([a-z0-9-]+)/?$ index.php?d=$1 [L,QSA]

# Le journal des clics n'est jamais servi publiquement (ramené par FTP).
<Files "hits.log">
  Require all denied
</Files>
`;

// Placé dans le dossier des PDF : interdit tout accès HTTP direct. Les PDF
// ne sont lisibles que par le script /dl/ (lecture disque, hors HTTP).
const PDF_DIR_HTACCESS = `# PDF des livres blancs : accès HTTP direct interdit.
# Seul le redirecteur traçable /dl/ peut les servir.
Require all denied
`;

function _ftpConfig() {
  if (!config.faqFtpHost || !config.faqFtpUser || !config.faqFtpPassword) {
    throw new Error('FTP non configuré (FTP_HOST / FTP_USER / FTP_PASSWORD manquants)');
  }
  return {
    host: config.faqFtpHost,
    port: config.faqFtpPort,
    user: config.faqFtpUser,
    password: config.faqFtpPassword,
    secure: false,
  };
}

// Publie (ou met à jour) le tracker PHP + verrouille le dossier des PDF.
// Idempotent — appelé à chaque publication d'un livre blanc.
async function ensureTracker() {
  const client = new Client(30_000);
  client.ftp.verbose = false;
  try {
    await client.access(_ftpConfig());
    const home = await client.pwd();
    // 1. Le redirecteur traçable dans www/dl/
    await client.ensureDir(config.wpTrackerRemoteDir);
    await client.uploadFrom(Readable.from(trackerPhp()), 'index.php');
    await client.uploadFrom(Readable.from(TRACKER_HTACCESS), '.htaccess');
    // 2. Le verrou d'accès direct dans le dossier des PDF
    await client.cd(home);
    await client.ensureDir(config.wpFtpRemoteDir);
    await client.uploadFrom(Readable.from(PDF_DIR_HTACCESS), '.htaccess');
  } finally {
    client.close();
  }
  log.info(`Tracker livres blancs publié sur ${config.wpTrackerPublicBase}/`);
}

// Reduit un referer à son nom d'hôte ('linkedin.com', '' si direct/inconnu).
function _refererHost(raw) {
  if (!raw) return '';
  try { return new URL(raw).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

// Ramène hits.log par FTP et ingère les nouveaux clics. Idempotent (hit_uid).
async function ingestClicks() {
  const tmp = path.join(os.tmpdir(), `wp-hits-${Date.now()}.log`);
  const client = new Client(30_000);
  client.ftp.verbose = false;
  let raw = '';
  try {
    await client.access(_ftpConfig());
    try {
      await client.downloadTo(tmp, `${config.wpTrackerRemoteDir}/hits.log`);
      raw = fs.readFileSync(tmp, 'utf-8');
    } catch {
      // Pas encore de hits.log (aucun clic) — cas normal.
      return { newRows: 0, lines: 0 };
    }
  } finally {
    client.close();
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }

  const lines = raw.split('\n').filter((l) => l.trim());
  const slugToAf = new Map();
  const rows = [];
  for (const line of lines) {
    const p = line.split('\t');
    if (p.length < 4) continue;
    const [hit_uid, hit_at, slug, ip_prefix, referer = '', user_agent = ''] = p;
    if (!hit_uid || !slug) continue;
    if (!slugToAf.has(slug)) {
      const af = db.afs.getBySlug(slug);
      slugToAf.set(slug, af ? af.id : null);
    }
    rows.push({
      hit_uid,
      af_id: slugToAf.get(slug),
      slug,
      hit_at,
      ip_prefix: ip_prefix || null,
      referer: _refererHost(referer) || null,
      user_agent: (user_agent || '').slice(0, 400) || null,
    });
  }
  const newRows = db.whitepaperClicks.insertMany(rows);
  return { newRows, lines: lines.length };
}

module.exports = { ensureTracker, ingestClicks };
