<script setup>
/**
 * Affiche la description d'une action du plan en remplaçant les balises
 * `{{type:id}}` injectées par le générateur backend par des pilules
 * cliquables qui scrollent vers l'entité concernée dans la card audit.
 *
 * Balises supportées :
 *  - `{{zone:N}}`    → pilule indigo « 📍 Nom de la zone »
 *  - `{{system:N}}`  → pilule colorée par catégorie « Chauffage » (icône)
 *  - `{{device:N}}`  → pilule slate « Chaudière De Dietrich »
 *
 * Clic = scrollIntoView vers `[data-{type}-id="N"]` qui existe déjà sur
 * les cards audit (cf. BacsAuditDetailView.vue gotoChecklist*).
 *
 * En PWA / si l'élément cible n'est pas dans le DOM (autre onglet),
 * la pilule reste cliquable mais sans effet — pas d'erreur visible.
 */
import { computed, h } from 'vue'
import { useAuditStore } from '@/stores/audit'
import { storeToRefs } from 'pinia'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'

const props = defineProps({
  text: { type: String, required: true },
})

const audit = useAuditStore()
const { zones, systems, devices } = storeToRefs(audit)

// Mapping catégorie système → icône FA + couleur (cf. SystemCategoryIcon.vue).
const SYSTEM_DECOR = {
  heating:                { icon: 'fire',        color: '#dc2626' },
  cooling:                { icon: 'snowflake',   color: '#0891b2' },
  ventilation:            { icon: 'fan',         color: '#64748b' },
  dhw:                    { icon: 'faucet',      color: '#0284c7' },
  lighting_indoor:        { icon: 'lightbulb',   color: '#f59e0b' },
  lighting_outdoor:       { icon: 'tower-cell',  color: '#f59e0b' },
  electricity_production: { icon: 'solar-panel', color: '#16a34a' },
}
const SYSTEM_LABEL_FR = {
  heating: 'Chauffage',
  cooling: 'Refroidissement',
  ventilation: 'Ventilation',
  dhw: 'Eau chaude sanitaire',
  lighting_indoor: 'Éclairage intérieur',
  lighting_outdoor: 'Éclairage extérieur',
  electricity_production: 'Production photovoltaïque',
}

function zoneLabel(id) {
  const z = (zones.value || []).find(z => z.id === id)
  return z?.name || `Zone #${id}`
}
function systemMeta(id) {
  const s = (systems.value || []).find(s => s.id === id)
  if (!s) return { label: `Système #${id}`, decor: null }
  const cat = s.system_category
  return {
    label: s.custom_label || SYSTEM_LABEL_FR[cat] || cat || `Système #${id}`,
    decor: SYSTEM_DECOR[cat] || null,
    zoneName: s.zone_name || null,
  }
}
function deviceLabel(id) {
  const d = (devices.value || []).find(d => d.id === id)
  if (!d) return `Équipement #${id}`
  return d.name || [d.brand, d.model_reference].filter(Boolean).join(' ') || `Équipement #${id}`
}

function gotoZone(id) {
  const el = document.querySelector(`[data-zone-id="${id}"]`)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function gotoSystem(id) {
  const el = document.querySelector(`[data-system-id="${id}"]`)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function gotoDevice(id) {
  const el = document.querySelector(`[data-device-id="${id}"]`)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

// Parse une chaîne en tokens (text + pill) en suivant les balises {{type:id}}.
function parseInline(src) {
  const out = []
  const re = /\{\{(zone|system|device):(\d+)\}\}/g
  let last = 0
  let m
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) out.push({ kind: 'text', value: src.slice(last, m.index) })
    out.push({ kind: 'pill', type: m[1], id: Number(m[2]) })
    last = m.index + m[0].length
  }
  if (last < src.length) out.push({ kind: 'text', value: src.slice(last) })
  return out
}

// Découpe la description en sections « Titre\nContenu » séparées par
// `\n\n`. Si le texte ne contient pas de section identifiable (titre court
// = une ligne < 80 caractères sans balise), on rend tout en mode inline.
const sections = computed(() => {
  const src = props.text || ''
  // Si pas de paragraphes, mode inline (titres d'actions, descriptions
  // historiques sans structure).
  if (!src.includes('\n\n')) {
    return [{ title: null, body: src }]
  }
  return src.split('\n\n').map(block => {
    const idx = block.indexOf('\n')
    if (idx < 0) return { title: null, body: block }
    const candidate = block.slice(0, idx).trim()
    // On considere comme titre une 1re ligne courte (< 80 char) qui ne
    // contient pas de balise et qui n'est pas une puce.
    if (candidate.length > 0 && candidate.length < 80 && !candidate.includes('{{') && !candidate.startsWith('•') && !candidate.startsWith('  •')) {
      return { title: candidate, body: block.slice(idx + 1) }
    }
    return { title: null, body: block }
  })
})

function faIcon(name, color) {
  return h(FontAwesomeIcon, { icon: ['fas', name], class: 'w-3 h-3 shrink-0', style: { color } })
}
function renderPill(token) {
  if (token.type === 'zone') {
    const label = zoneLabel(token.id)
    return h('button', {
      type: 'button',
      class: 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition align-baseline',
      onClick: (e) => { e.stopPropagation(); gotoZone(token.id) },
    }, [faIcon('location-dot', '#4f46e5'), h('span', label)])
  }
  if (token.type === 'system') {
    const meta = systemMeta(token.id)
    const tone = meta.decor || { icon: 'gear', color: '#6b7280' }
    return h('button', {
      type: 'button',
      class: 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border hover:opacity-90 transition align-baseline',
      style: { color: tone.color, borderColor: tone.color + '66', backgroundColor: tone.color + '1A' },
      onClick: (e) => { e.stopPropagation(); gotoSystem(token.id) },
    }, [faIcon(tone.icon, tone.color), h('span', meta.label), meta.zoneName ? h('span', { class: 'opacity-60' }, ` · ${meta.zoneName}`) : null])
  }
  if (token.type === 'device') {
    const label = deviceLabel(token.id)
    return h('button', {
      type: 'button',
      class: 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 transition align-baseline',
      onClick: (e) => { e.stopPropagation(); gotoDevice(token.id) },
    }, [faIcon('gear', '#475569'), h('span', label)])
  }
  return h('span', '')
}

function renderInline(text) {
  return parseInline(text).map(t => t.kind === 'text' ? t.value : renderPill(t))
}

// Si une seule section sans titre → rendu inline simple (compatibilité
// titres et descriptions historiques). Sinon → liste de sections avec
// sous-titres uppercase distinctifs.
const render = () => {
  const ss = sections.value
  if (ss.length === 1 && !ss[0].title) {
    return h('span', { class: 'whitespace-pre-line' }, renderInline(ss[0].body))
  }
  return h(
    'div',
    { class: 'space-y-2' },
    ss.map((s, i) => h(
      'div',
      { key: i },
      [
        s.title
          ? h('div', { class: 'text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-0.5' }, s.title)
          : null,
        h('div', { class: 'whitespace-pre-line' }, renderInline(s.body)),
      ].filter(Boolean),
    )),
  )
}
</script>

<template>
  <render />
</template>
