'use strict';

// Generation de charts pour les PDFs Buildy via chartjs-node-canvas.
// Sortie : data URL PNG inline (base64) que les templates Handlebars peuvent
// embeder via <img src="...">. Plus rapide que Puppeteer pour les graphiques
// (pas de second navigateur a lancer).
//
// Charts disponibles :
//   - donutSeverity({ blocking, major, minor })
//       page de garde audit BACS : repartition des actions correctives
//   - radarCompliance({ axes: [{ label, score }] })
//       page synthese audit BACS : score 0-100 par axe R175
//   - barUsagePower({ items: [{ label, kw, color }] })
//       audit BACS : kW par usage (chauffage / clim / vent / ECS / eclairage)
//   - barAfCoverage({ levels: { E, S, P } })
//       AF : couverture niveau service (nb sections par niveau)
//
// Convention couleurs : aligne sur la charte Buildy + palette severites
//   sev-blocking = rouge 600     (#dc2626)
//   sev-major    = orange 500    (#f97316)
//   sev-minor    = amber 400     (#fbbf24)
//   tone-success = emerald 500   (#10b981)
//   tone-info    = indigo 500    (#6366f1)
//   tone-recco   = violet 500    (#8b5cf6)

const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const log = require('./logger').system;

// Une instance Canvas reutilisable. Plus economique que d'en creer une par
// chart. Taille de base 600x600 — chaque chart override son width/height
// dans la config si besoin.
const _canvas = new ChartJSNodeCanvas({
  width: 600,
  height: 400,
  backgroundColour: 'transparent',
  chartCallback: (ChartJS) => {
    // Disable l'animation (irrelevant en PNG static)
    ChartJS.defaults.animation = false;
    ChartJS.defaults.font.family = 'Manrope, Helvetica, Arial, sans-serif';
    ChartJS.defaults.font.size = 13;
    ChartJS.defaults.color = '#374151'; // gray-700
  },
});

const COLORS = {
  blocking: '#dc2626',
  major: '#f97316',
  minor: '#fbbf24',
  success: '#10b981',
  info: '#6366f1',
  recco: '#8b5cf6',
  muted: '#9ca3af',
  heating: '#ef4444',
  cooling: '#06b6d4',
  ventilation: '#64748b',
  dhw: '#0ea5e9',
  lighting: '#f59e0b',
};

async function _renderToDataUrl(config, { width = 600, height = 400 } = {}) {
  try {
    const canvas = (width === 600 && height === 400)
      ? _canvas
      : new ChartJSNodeCanvas({ width, height, backgroundColour: 'transparent' });
    const buffer = await canvas.renderToBuffer(config, 'image/png');
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch (err) {
    log.warn(`Chart render failed: ${err.message}`);
    return null;
  }
}

/**
 * Donut sévérité — 3 segments (bloquantes, majeures, mineures).
 * Si total = 0, retourne null (pas de chart).
 */
async function donutSeverity({ blocking = 0, major = 0, minor = 0 } = {}) {
  const total = blocking + major + minor;
  if (total === 0) return null;
  const config = {
    type: 'doughnut',
    data: {
      labels: ['Bloquantes', 'Majeures', 'Mineures'],
      datasets: [{
        data: [blocking, major, minor],
        backgroundColor: [COLORS.blocking, COLORS.major, COLORS.minor],
        borderWidth: 0,
      }],
    },
    options: {
      cutout: '62%',
      plugins: {
        legend: {
          position: 'right',
          labels: { boxWidth: 14, padding: 12, font: { size: 13 } },
        },
        tooltip: { enabled: false },
      },
    },
  };
  return _renderToDataUrl(config, { width: 500, height: 320 });
}

/**
 * Radar conformite — score 0-100 sur N axes (R175-3 §1, §2, §3, §4 + R175-4
 * + R175-5 + R175-6).
 */
async function radarCompliance({ axes = [] } = {}) {
  if (!axes.length) return null;
  const config = {
    type: 'radar',
    data: {
      labels: axes.map(a => a.label),
      datasets: [{
        label: 'Score conformité',
        data: axes.map(a => a.score),
        backgroundColor: 'rgba(99, 102, 241, 0.18)', // indigo-500 a 18%
        borderColor: COLORS.info,
        borderWidth: 2,
        pointBackgroundColor: COLORS.info,
        pointRadius: 4,
      }],
    },
    options: {
      scales: {
        r: {
          beginAtZero: true,
          max: 100,
          ticks: { stepSize: 20, font: { size: 10 } },
          pointLabels: { font: { size: 12, weight: '500' } },
          grid: { color: '#e5e7eb' }, // gray-200
          angleLines: { color: '#e5e7eb' },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
    },
  };
  return _renderToDataUrl(config, { width: 600, height: 460 });
}

/**
 * Bar horizontal — puissance kW par usage GTB.
 * items: [{ label, kw, color? }]
 */
async function barUsagePower({ items = [] } = {}) {
  if (!items.length) return null;
  const config = {
    type: 'bar',
    data: {
      labels: items.map(i => i.label),
      datasets: [{
        data: items.map(i => i.kw),
        backgroundColor: items.map(i => i.color || COLORS.info),
        borderWidth: 0,
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      scales: {
        x: {
          beginAtZero: true,
          title: { display: true, text: 'Puissance (kW)', font: { size: 12 } },
          grid: { color: '#f3f4f6' },
        },
        y: { grid: { display: false } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
        datalabels: { display: false },
      },
    },
  };
  return _renderToDataUrl(config, { width: 600, height: Math.max(200, 50 + items.length * 32) });
}

/**
 * Bar AF — couverture niveau service (Essentials / Smart / Premium).
 * levels: { E, S, P } counts.
 */
async function barAfCoverage({ levels = {} } = {}) {
  const data = ['E', 'S', 'P'].map(k => levels[k] || 0);
  if (data.every(v => v === 0)) return null;
  const config = {
    type: 'bar',
    data: {
      labels: ['Essentials', 'Smart', 'Premium'],
      datasets: [{
        data,
        backgroundColor: [COLORS.muted, COLORS.info, COLORS.recco],
        borderWidth: 0,
        borderRadius: 4,
      }],
    },
    options: {
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, font: { size: 11 } },
          grid: { color: '#f3f4f6' },
        },
        x: { grid: { display: false } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
    },
  };
  return _renderToDataUrl(config, { width: 500, height: 280 });
}

module.exports = {
  donutSeverity,
  radarCompliance,
  barUsagePower,
  barAfCoverage,
  COLORS,
};
