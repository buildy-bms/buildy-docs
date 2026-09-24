<script setup>
/**
 * Onglets d'étapes de l'audit BACS desktop, groupés en 4 phases colorées
 * (Site · Équipements · Supervision · Dossier). Une seule étape est affichée
 * à la fois : le parent (BacsAuditDetailView) écoute `select`.
 *
 * Chaque onglet : pastille d'état (✓ validée, n° cerclé ambre = prête à
 * valider, n° gris + point ambré = points restants, ⊘ = sans objet) +
 * libellé. Infobulle = objectif + ce qui reste à faire. La progression
 * « n/12 étapes validées » occupe la ligne des noms de phase, à droite
 * (position absolue : elle ne prend pas de largeur aux onglets).
 *
 * Quand la barre ne tient pas en largeur (sidebar dépliée, écran 1024-1366),
 * seuls le libellé de l'onglet actif reste affiché ; la barre défile.
 */
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { faCheck, faBan } from '@fortawesome/pro-solid-svg-icons'
import { AUDIT_PHASES } from '@/lib/audit-steps-ui'
import { useRovingTabs } from '@/composables/useRovingTabs'

library.add(faCheck, faBan)

const props = defineProps({
  // Étapes « onglets » de la vue : { key, number, label, objective, disabled,
  // disabledReason, validated, validated_at, validated_by_name, with_pending,
  // complete, blocking, incompleteReasons }
  steps: { type: Array, required: true },
  activeKey: { type: String, default: null },
})
const emit = defineEmits(['select'])

const scroller = ref(null)
const { onKeydown, ensureVisible } = useRovingTabs(scroller, { keyAttr: 'data-audit-step-tab' })

const groups = computed(() => AUDIT_PHASES
  .map(p => ({ ...p, items: p.steps.map(k => props.steps.find(s => s.key === k)).filter(Boolean) }))
  .filter(g => g.items.length))

// Progression (étapes « sans objet » exclues)
const countable = computed(() => props.steps.filter(s => !s.disabled).length)
const validatedCount = computed(() => props.steps.filter(s => !s.disabled && s.validated).length)
const percent = computed(() => (countable.value ? Math.round((validatedCount.value / countable.value) * 100) : 0))

function stateOf(s) {
  if (s.disabled) return 'disabled'
  if (s.validated) return 'validated'
  if (s.complete) return 'ready'
  return 'todo'
}

function bubbleClass(s) {
  switch (stateOf(s)) {
    case 'validated': return 'bg-emerald-500 text-white'
    case 'ready': return 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-400'
    case 'disabled': return 'bg-gray-100 text-gray-300'
    default: return 'bg-white text-gray-500 ring-1 ring-inset ring-gray-300'
  }
}

// Onglet actif : navy plein, texte blanc (bien visible), soulignement à la
// couleur de la phase. Autres onglets : pastilles gris clair cliquables.
function tabClass(s, g) {
  const base = 'relative inline-flex items-center gap-1.5 h-8 pl-1.5 pr-2.5 rounded-lg text-[12.5px] leading-none whitespace-nowrap transition outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-indigo-500/50 after:absolute after:left-2 after:right-2 after:-bottom-[7px] after:h-[3px] after:rounded-full'
  if (s.disabled) return [base, 'bg-slate-50 text-gray-400 ring-1 ring-inset ring-slate-200 cursor-not-allowed after:hidden']
  if (s.key === props.activeKey) return [base, 'bg-indigo-600 text-white font-medium shadow-md shadow-indigo-900/20', g.tone.underline]
  return [base, 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-200 hover:text-slate-900 after:hidden']
}

function formatWhen(v) {
  if (!v) return ''
  const d = new Date(String(v).includes('T') ? v : String(v).replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
}

function statusText(s) {
  switch (stateOf(s)) {
    case 'disabled': return 'sans objet'
    case 'validated': return 'validée'
    case 'ready': return 'prête à valider'
    default: return s.incompleteReasons.length > 1
      ? `${s.incompleteReasons.length} points restants`
      : 'à compléter'
  }
}

function tooltipFor(s) {
  const lines = [`${s.number}. ${s.label}`]
  if (s.disabled) {
    if (s.disabledReason) lines.push(s.disabledReason)
    return lines.join('\n')
  }
  if (s.objective) lines.push(s.objective)
  if (s.validated) {
    const when = formatWhen(s.validated_at)
    lines.push(`✓ Validée${when ? ` le ${when}` : ''}${s.validated_by_name ? ` par ${s.validated_by_name}` : ''}`)
    if (s.with_pending) lines.push('Validée avec des éléments encore en attente.')
  } else if (s.complete) {
    lines.push('Tout est renseigné : étape prête à être validée.')
  } else if (s.incompleteReasons.length) {
    lines.push('Reste à faire :')
    for (const r of s.incompleteReasons) lines.push(`• ${r}`)
  }
  return lines.join('\n')
}

// ── Mode compact : libellés masqués (sauf onglet actif) quand ça déborde ──
// À chaque mesure, on réessaie l'affichage complet : libellés remis, mesure
// du débordement, puis compact si nécessaire. Tout se passe dans la même
// micro-tâche (avant le rendu), donc sans clignotement. Mesures déclenchées
// au montage, polices chargées, redimensionnement et changement d'état.
const compact = ref(false)
let measuring = false
let ro = null
async function measure() {
  const sc = scroller.value
  if (!sc || measuring) return
  measuring = true
  try {
    if (compact.value) {
      compact.value = false
      await nextTick()
    }
    compact.value = sc.scrollWidth > sc.clientWidth + 2
  } finally {
    measuring = false
  }
}
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && scroller.value) {
    ro = new ResizeObserver(() => measure())
    ro.observe(scroller.value)
  }
  nextTick(async () => {
    await measure()
    ensureVisible(props.activeKey)
  })
  // Poppins / Sora chargées après le 1er rendu : les largeurs changent.
  window.document.fonts?.ready?.then(() => measure())
})
onBeforeUnmount(() => { ro?.disconnect(); ro = null })

// Les badges / états changent la largeur des onglets : on remesure.
watch(() => props.steps.map(s => `${s.key}:${stateOf(s)}:${s.incompleteReasons.length}`).join('|'), () => {
  nextTick(measure)
})
watch(() => props.activeKey, (k) => nextTick(async () => {
  await measure()
  ensureVisible(k)
}))
</script>

<template>
  <nav class="relative flex items-end" data-audit-step-tabs aria-label="Étapes de l'audit">
    <!-- Progression, dans la ligne des noms de phase (à droite) -->
    <div class="audit-tabs-progress absolute right-0 top-0 flex items-center gap-2 pointer-events-none" aria-live="polite">
      <span class="text-[11px] leading-none text-gray-500 whitespace-nowrap">
        <span class="text-gray-900 font-medium">{{ validatedCount }}</span>/{{ countable }} étapes validées
      </span>
      <div class="w-24 h-1.5 rounded-full bg-slate-200 overflow-hidden">
        <div class="h-full bg-emerald-500 transition-all duration-500" :style="{ width: percent + '%' }"></div>
      </div>
    </div>
    <div
      ref="scroller"
      role="tablist"
      aria-orientation="horizontal"
      class="relative flex-1 min-w-0 flex items-end gap-2.5 overflow-x-auto pb-2 [scrollbar-width:thin]"
      @keydown="onKeydown"
    >
      <div v-for="g in groups" :key="g.key" role="presentation" class="flex flex-col shrink-0">
        <span
          aria-hidden="true"
          :class="['audit-tabs-phase-label px-1 mb-1 text-[10px] uppercase tracking-wider font-medium', g.tone.label]"
        >{{ g.label }}</span>
        <div role="presentation" :class="['flex items-center gap-1 border-t-2 pt-1.5', g.tone.bar]">
          <button
            v-for="s in g.items"
            :key="s.key"
            type="button"
            role="tab"
            :id="`audit-step-tab-${s.key}`"
            :aria-controls="`audit-step-panel-${s.key}`"
            :aria-selected="s.key === activeKey ? 'true' : 'false'"
            :aria-disabled="s.disabled ? 'true' : undefined"
            :aria-label="`${s.number}. ${s.label} — ${statusText(s)}`"
            :tabindex="s.key === activeKey ? 0 : -1"
            :data-audit-step-tab="s.key"
            :class="tabClass(s, g)"
            v-tooltip="{ text: tooltipFor(s), placement: 'bottom' }"
            @click="!s.disabled && emit('select', s.key)"
          >
            <span
              :class="['relative shrink-0 w-[18px] h-[18px] rounded-full inline-flex items-center justify-center text-[10px] leading-none', bubbleClass(s)]"
              aria-hidden="true"
            >
              <FontAwesomeIcon v-if="stateOf(s) === 'validated'" :icon="['fas', 'check']" class="w-2.5 h-2.5" />
              <FontAwesomeIcon v-else-if="stateOf(s) === 'disabled'" :icon="['fas', 'ban']" class="w-2.5 h-2.5" />
              <span v-else>{{ s.number }}</span>
              <!-- Point ambré : validée avec des éléments en attente, ou
                   points restants à compléter (détail dans l'infobulle). -->
              <span
                v-if="(s.validated && s.with_pending) || (stateOf(s) === 'todo' && s.incompleteReasons.length)"
                class="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-white"
              ></span>
            </span>
            <span v-show="!compact || s.key === activeKey">{{ s.label }}</span>
          </button>
        </div>
      </div>
    </div>
  </nav>
</template>
