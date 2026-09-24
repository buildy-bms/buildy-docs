<script setup>
import { computed, ref, watch } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
import { ArrowPathIcon, ExclamationTriangleIcon, CheckCircleIcon, PencilSquareIcon, EyeSlashIcon, EyeIcon, InformationCircleIcon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import SafeHtml from '@/components/SafeHtml.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import Button from '@/components/Button.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import { groupByCard, CARD_FLAT_OPTIONS, cardOfAction } from '@/lib/action-cards'
import ActionDescription from '@/components/audit/ActionDescription.vue'

const CARD_OPTIONS = CARD_FLAT_OPTIONS()

// Section "Plan de mise en conformité" (R175 — actions correctives auto
// + manuelles + annotations commerciales). Affiche les items visibles
// (filtres severite + statut), permet de patch chaque item et de
// rediger les preconisations Buildy.
const props = defineProps({
  visibleActionItems: { type: Array, required: true },
  itemsBySeverity: { type: Object, required: true },
  resolvedCount: { type: Number, default: 0 },
  step: { type: Object, default: null },
  active: { type: Boolean, default: false },
  severityLabels: {
    type: Object,
    default: () => ({
      blocking: { label: 'Bloquante', cls: 'sev-blocking' },
      major: { label: 'Majeure', cls: 'sev-major' },
      minor: { label: 'Mineure', cls: 'sev-minor' },
    }),
  },
  statusLabels: {
    type: Object,
    default: () => ({
      open: 'Ouverte', quoted: 'Chiffrée', in_progress: 'En cours',
      done: 'Terminée', declined: 'Non retenue',
    }),
  },
  // Régénération en cours : disable le bouton + spinner. Évite les
  // doubles-clics et signale visuellement à l'auditeur que c'est en
  // train de tourner (sinon les items disparaissent puis réapparaissent
  // sans feedback, donne l'impression que rien ne se passe).
  regenerating: { type: Boolean, default: false },
  // site_uuid de l'audit pour rattacher les photos terrain de chaque
  // action via le bouton « Photos » (parité avec zones / systems / etc.).
  siteUuid: { type: String, default: '' },
})

const emit = defineEmits([
  'regenerate', 'open-commercial', 'validate-step', 'invalidate-step',
  'patch-item', 'open-alternatives',
])

// La numerotation BACS-001..NNN est calculee cote backend (route GET
// /action-items) pour que UI desktop, PWA mobile, PDF audit et MCP
// affichent EXACTEMENT le meme numero pour la meme action. On lit donc
// directement `it.display_number`.
// Plan numéroté (actions et réserves) ; informations (exemption 5 %,
// vigilance) à part et sans numéro, comme dans le PDF.
const planItems = computed(() => props.visibleActionItems.filter(it => !it.is_info))
const infoItems = computed(() => props.visibleActionItems.filter(it => it.is_info))
const groupedCards = computed(() => groupByCard(planItems.value))

// Niveau affiché : « Réserve » et « Information » comme dans le PDF (les
// couleurs aussi : indigo, gris), sinon la sévérité.
function levelOf(it) {
  if (it.is_reserve) return { label: 'Réserve', cls: 'tone-info' }
  if (it.is_info) return { label: 'Information', cls: 'tone-muted' }
  return props.severityLabels[it.severity] || { label: it.severity, cls: 'tone-muted' }
}
// Définition des niveaux : même texte que la légende « Lecture du plan » du PDF.
const LEVEL_HELP = {
  blocking: 'Bloquante : écart qui empêche à lui seul la conformité, par exemple l\'absence de GTB ou d\'un compteur requis.',
  major: 'Majeure : exigence du décret non satisfaite, à traiter pour atteindre la conformité.',
  minor: 'Mineure : recommandation, ou raccordement exigé seulement sous condition de temps de retour sur investissement.',
  reserve: 'Réserve : obligation du propriétaire à respecter dans la durée (maintenance, inspection périodique, export des données), sans effet sur la conformité de l\'installation.',
}
// Décomptes d'une carte : réserves à part (groupByCard compte par sévérité).
function countsOf(items) {
  const acts = (items || []).filter(x => !x.is_reserve)
  return {
    actions: acts.length,
    blocking: acts.filter(x => x.severity === 'blocking').length,
    major: acts.filter(x => x.severity === 'major').length,
    minor: acts.filter(x => x.severity === 'minor').length,
    reserves: (items || []).length - acts.length,
  }
}
const plural = (n, one, many) => (n > 1 ? many : one)
// Décomptes affichés dans les bandeaux de carte / sous-section.
function countParts(items) {
  const c = countsOf(items)
  const parts = []
  if (c.actions) parts.push({ text: `${c.actions} ${plural(c.actions, 'action', 'actions')}`, cls: '' })
  if (c.blocking) parts.push({ text: `${c.blocking} ${plural(c.blocking, 'bloquante', 'bloquantes')}`, cls: 'text-red-700 font-semibold' })
  if (c.major) parts.push({ text: `${c.major} ${plural(c.major, 'majeure', 'majeures')}`, cls: 'text-orange-700' })
  if (c.minor) parts.push({ text: `${c.minor} ${plural(c.minor, 'mineure', 'mineures')}`, cls: 'text-amber-700' })
  if (c.reserves) parts.push({ text: `${c.reserves} ${plural(c.reserves, 'réserve', 'réserves')}`, cls: 'text-indigo-700' })
  return parts
}
const subtitle = computed(() => {
  const c = countsOf(planItems.value)
  const parts = [`${c.actions} ${plural(c.actions, 'action', 'actions')}`]
  if (c.reserves) parts.push(`${c.reserves} ${plural(c.reserves, 'réserve', 'réserves')}`)
  if (infoItems.value.length) parts.push(`${infoItems.value.length} ${plural(infoItems.value.length, 'information', 'informations')}`)
  if (props.resolvedCount) parts.push(`${props.resolvedCount} ${plural(props.resolvedCount, 'résolue masquée', 'résolues masquées')}`)
  return parts.join(' · ')
})

// Lecture : titres seuls par défaut ; le détail (constat, exigence,
// recommandation, préconisations) se déplie au clic. « Tout déplier » est
// mémorisé pour les prochaines ouvertures.
const OPEN_ALL_KEY = 'bacs-plan-details-open'
const openIds = ref(new Set())
const sourcesOpen = ref(false)
function isOpen(it) { return openIds.value.has(it.id) }
function toggleOpen(it) {
  const s = new Set(openIds.value)
  if (s.has(it.id)) s.delete(it.id); else s.add(it.id)
  openIds.value = s
}
const allOpen = computed(() => props.visibleActionItems.length > 0
  && props.visibleActionItems.every(it => openIds.value.has(it.id)))
function setAll(open) {
  openIds.value = open ? new Set(props.visibleActionItems.map(it => it.id)) : new Set()
  try { localStorage.setItem(OPEN_ALL_KEY, open ? '1' : '0') } catch { /* navigation privée */ }
}
watch(() => props.visibleActionItems.length, (n, old) => {
  if (!n || old) return
  let pref = null
  try { pref = localStorage.getItem(OPEN_ALL_KEY) } catch { pref = null }
  if (pref === '1') setAll(true)
}, { immediate: true })

function manualAssignedValue(it) {
  const c = cardOfAction(it)
  if (!c.card || c.card === 'misc') return ''
  if (c.subsection) return `${c.card}/${c.subsection}`
  return c.card
}

function reassignManual(it, value) {
  let assigned_card = null
  let assigned_subsection = null
  if (value) {
    const [card, sub] = value.split('/')
    assigned_card = card
    assigned_subsection = sub || null
  }
  emit('patch-item', { item: it, patch: { assigned_card, assigned_subsection } })
}

function hasNotes(html) {
  if (!html) return false
  return html.replace(/<[^>]*>/g, '').trim().length > 0
}
</script>

<template>
  <CollapsibleSection storage-key="review" section-id="section-review" :active="active">
    <template #header>
      <SectionHeader number="11" :title="'Plan de mise en conformité'"
                     :subtitle="subtitle"
                     :icon="ExclamationTriangleIcon" icon-color="text-orange-500"
                     :step="step"
                     @validate="emit('validate-step', $event)"
                     @invalidate="emit('invalidate-step', $event)">
        <template #actions>
          <Button
            variant="secondary"
            size="sm"
            :loading="regenerating"
            @click.stop="emit('regenerate')"
            v-tooltip="'Recalcule le plan d\'actions correctives à partir des données saisies (préserve les annotations commerciales)'"
          >
            <template v-if="!regenerating" #icon-left>
              <ArrowPathIcon class="w-3.5 h-3.5 shrink-0" />
            </template>
            {{ regenerating ? 'Régénération…' : 'Régénérer' }}
          </Button>
          <button @click.stop="emit('open-commercial')"
                  class="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
            Vue commerciale →
          </button>
        </template>
      </SectionHeader>
    </template>
    <template #summary>
      <span v-if="visibleActionItems.length">
        <span v-if="itemsBySeverity.blocking?.length" class="text-red-700 font-semibold">{{ itemsBySeverity.blocking.length }} bloquante{{ itemsBySeverity.blocking.length > 1 ? 's' : '' }}</span>
        <span v-if="itemsBySeverity.blocking?.length && (itemsBySeverity.major?.length || itemsBySeverity.minor?.length)"> · </span>
        <span v-if="itemsBySeverity.major?.length" class="text-orange-700">{{ itemsBySeverity.major.length }} majeure{{ itemsBySeverity.major.length > 1 ? 's' : '' }}</span>
        <span v-if="itemsBySeverity.major?.length && itemsBySeverity.minor?.length"> · </span>
        <span v-if="itemsBySeverity.minor?.length" class="text-amber-700">{{ itemsBySeverity.minor.length }} mineure{{ itemsBySeverity.minor.length > 1 ? 's' : '' }}</span>
        <span v-if="itemsBySeverity.reserves?.length" class="text-indigo-700"> · {{ itemsBySeverity.reserves.length }} réserve{{ itemsBySeverity.reserves.length > 1 ? 's' : '' }}</span>
        <span v-if="resolvedCount" class="text-emerald-600"> · {{ resolvedCount }} résolue{{ resolvedCount > 1 ? 's' : '' }}</span>
      </span>
      <span v-else class="italic text-emerald-700">✓ Aucune action corrective</span>
    </template>
    <div class="px-5 py-4 space-y-5">
      <!-- Encart sources : hiérarchie des références citées dans les
           descriptions. Le décret est la seule source juridiquement
           opposable ; le reste sert d'aide à l'interprétation. -->
      <!-- Barre de lecture : décompte par niveau (définition au survol, comme
           la légende « Lecture du plan » du PDF), sources repliables,
           tout déplier / replier. -->
      <div v-if="visibleActionItems.length" class="flex flex-wrap items-center gap-2">
        <span v-if="itemsBySeverity.blocking?.length" class="pill sev-blocking" v-tooltip="LEVEL_HELP.blocking">
          {{ itemsBySeverity.blocking.length }} {{ plural(itemsBySeverity.blocking.length, 'bloquante', 'bloquantes') }}
        </span>
        <span v-if="itemsBySeverity.major?.length" class="pill sev-major" v-tooltip="LEVEL_HELP.major">
          {{ itemsBySeverity.major.length }} {{ plural(itemsBySeverity.major.length, 'majeure', 'majeures') }}
        </span>
        <span v-if="itemsBySeverity.minor?.length" class="pill sev-minor" v-tooltip="LEVEL_HELP.minor">
          {{ itemsBySeverity.minor.length }} {{ plural(itemsBySeverity.minor.length, 'mineure', 'mineures') }}
        </span>
        <span v-if="itemsBySeverity.reserves?.length" class="pill tone-info" v-tooltip="LEVEL_HELP.reserve">
          {{ itemsBySeverity.reserves.length }} {{ plural(itemsBySeverity.reserves.length, 'réserve', 'réserves') }}
        </span>
        <span v-if="infoItems.length" class="pill tone-muted"
              v-tooltip="'Exemptions et points de vigilance : hors plan, sans numéro, comme dans le rapport.'">
          {{ infoItems.length }} {{ plural(infoItems.length, 'information', 'informations') }}
        </span>
        <span class="ml-auto flex items-center gap-4">
          <button type="button" @click="sourcesOpen = !sourcesOpen"
                  class="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800">
            <InformationCircleIcon class="w-3.5 h-3.5 shrink-0" />
            Sources
          </button>
          <button type="button" @click="setAll(!allOpen)"
                  class="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800">
            <FontAwesomeIcon :icon="['fas', allOpen ? 'chevron-down' : 'chevron-right']" class="w-2.5 h-2.5" />
            {{ allOpen ? 'Tout replier' : 'Tout déplier' }}
          </button>
        </span>
      </div>
      <!-- Sources (repliables) : même hiérarchie que l'encart du PDF. -->
      <div v-if="visibleActionItems.length && sourcesOpen" class="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-indigo-50/70 border border-indigo-200">
        <InformationCircleIcon class="w-4 h-4 shrink-0 text-indigo-500 mt-0.5" />
        <div class="text-xs leading-relaxed text-indigo-900/90">
          <p><strong class="font-semibold">Sources d'aide à l'interprétation (non opposables).</strong> Les actions ci-dessous reposent sur le décret BACS (articles L. 174-3, L. 175-2 et R. 175-1 à R. 175-6 du code de la construction et de l'habitation, et arrêté du 7 avril 2023 : seuls textes juridiquement opposables), éclairé par :</p>
          <ul class="mt-1 space-y-0.5 list-disc pl-4">
            <li>Guide d'application du décret BACS — ministère, version 2, janvier 2026.</li>
            <li>FAQ BACS du ministère.</li>
            <li>Guide pratique d'application du décret BACS — PROFEEL, novembre 2025.</li>
          </ul>
        </div>
      </div>
      <div v-if="!visibleActionItems.length" class="py-10 text-center">
        <CheckCircleIcon class="w-10 h-10 text-emerald-500 mx-auto" />
        <p class="mt-2 text-sm text-gray-700 font-medium">Aucune action corrective à ce stade</p>
        <p class="text-xs text-gray-500">Saisis les systèmes et la GTB ci-dessus pour générer le plan.</p>
      </div>
      <!-- Actions regroupees par CARTE de l'audit (stepper). Carte GTB
           sous-divisee en sous-sections (Capacites, Integration
           equipements, Integration compteurs, Maintenance & formation). -->
      <section v-for="(card, ci) in groupedCards" :key="card.key" class="space-y-3">
        <!-- Bandeau de carte : full-width, fond emeraude prononce, numero
             d'ordre dans la pastille pour rythmer le scroll. -->
        <!-- Bandeau neutre (ardoise) : la couleur reste réservée aux niveaux ;
             décomptes sur la même ligne, réserves à part. -->
        <header class="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-100 border-l-4 border-slate-600">
          <span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-700 text-white text-xs font-bold shrink-0">{{ ci + 1 }}</span>
          <h3 class="text-sm font-semibold text-slate-900 leading-tight">{{ card.label }}</h3>
          <p class="ml-auto text-xs text-slate-500 whitespace-nowrap">
            <template v-for="(part, pi) in countParts(card.items)" :key="pi"><template v-if="pi"> · </template><span :class="part.cls">{{ part.text }}</span></template>
          </p>
        </header>
        <template v-for="(sub, si) in (card.subsections || [{ key: card.key, items: card.items }])" :key="card.key + '-' + sub.key">
          <!-- Sous-titre uniquement si la carte a plusieurs sous-sections
               (cas GTB) — bandeau ardoise indente, design parallele au
               bandeau de carte avec une pastille a/b/c/d pour le rythme. -->
          <div v-if="card.subsections && card.subsections.length > 1"
               class="flex items-center gap-2.5 ml-4 mt-3 px-3 py-2 rounded-md bg-slate-100 border-l-[3px] border-slate-400">
            <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-500 text-white text-[10px] font-bold shrink-0">{{ String.fromCharCode(97 + si) }}</span>
            <div class="flex-1 min-w-0">
              <h4 class="text-sm font-semibold text-slate-800 leading-tight">{{ sub.label }}</h4>
              <p class="text-[11px] text-slate-500 mt-0.5">
                <template v-for="(part, pi) in countParts(sub.items)" :key="pi"><template v-if="pi"> · </template><span :class="part.cls">{{ part.text }}</span></template>
              </p>
            </div>
          </div>
          <div
            v-for="it in sub.items"
            :key="it.id"
            :class="['border rounded-lg overflow-hidden transition bg-white',
              card.subsections && card.subsections.length > 1 ? 'ml-4' : '',
              it.status === 'declined' ? 'opacity-50' : '',
              it.is_reserve ? 'border-indigo-200' : (it.severity === 'blocking' ? 'border-red-200' : (it.severity === 'major' ? 'border-orange-200' : 'border-amber-200'))]">
        <!-- Ligne condensée : titre seul ; le détail se déplie au clic
             (chevron ou titre). Numéro, niveau et article en largeur fixe :
             alignés d'une ligne à l'autre. -->
        <div class="px-3 py-2 flex items-start gap-2.5">
          <button type="button" @click="toggleOpen(it)" :aria-expanded="isOpen(it)"
                  class="mt-0.5 p-0.5 text-gray-400 hover:text-gray-700 shrink-0"
                  v-tooltip="isOpen(it) ? 'Masquer le détail' : 'Afficher le détail : constat, exigence, recommandation'">
            <FontAwesomeIcon :icon="['fas', isOpen(it) ? 'chevron-down' : 'chevron-right']" class="w-3 h-3" />
          </button>
          <div class="flex items-center gap-1.5 shrink-0 pt-0.5">
            <span class="inline-flex items-center justify-center w-19 px-1.5 py-0.5 text-[10px] font-mono rounded bg-gray-800 text-white whitespace-nowrap">
              {{ it.display_number || '—' }}
            </span>
            <span :class="['pill justify-center w-25', levelOf(it).cls]">
              {{ levelOf(it).label }}
            </span>
            <span v-truncate-tooltip class="w-26 truncate text-[10px] text-gray-500 font-mono whitespace-nowrap">{{ it.r175_article || '—' }}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm text-gray-800 font-medium leading-snug cursor-pointer" @click="toggleOpen(it)">
              <ActionDescription :text="it.title" />
            </div>
            <div v-if="it.description && isOpen(it)" class="mt-2 px-3 py-2 rounded-md bg-gray-50 text-xs text-gray-700 leading-relaxed">
              <ActionDescription :text="it.description" />
            </div>
            <!-- Pas de pill « 📍 zone » ici : la zone apparaît déjà dans le
                 titre et la description via les pilules cliquables
                 {{zone:N}} rendues par ActionDescription. -->
          </div>
          <!-- Actions compactes à droite -->
          <div class="flex items-center gap-1 shrink-0">
            <!-- Selecteur de carte sur les items MANUELS uniquement
                 (les autos sont rattaches automatiquement par helper). -->
            <select
              v-if="!it.auto_generated"
              :value="manualAssignedValue(it)"
              @change="e => reassignManual(it, e.target.value)"
              class="text-[11px] rounded border border-gray-200 bg-white px-1.5 py-1 text-gray-600 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              title="Affecter cette préconisation à une carte de l'audit"
            >
              <option value="">Divers</option>
              <option v-for="opt in CARD_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
            <button
              type="button"
              @click="emit('open-alternatives', it)"
              :class="['inline-flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-medium rounded border transition whitespace-nowrap',
                hasNotes(it.alternative_solutions_html)
                  ? 'border-violet-300 text-violet-700 bg-violet-50 hover:bg-violet-100'
                  : (it.status === 'open'
                    ? 'border-red-300 text-red-700 bg-red-50 hover:bg-red-100'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50')]"
              v-tooltip="hasNotes(it.alternative_solutions_html) ? 'Modifier les préconisations Buildy' : 'Aucune préconisation — cliquer pour rédiger'">
              <PencilSquareIcon class="w-3.5 h-3.5 shrink-0" />
              {{ hasNotes(it.alternative_solutions_html) ? 'Préconisations' : 'Préconiser' }}
            </button>
            <BacsPhotoButton
              v-if="siteUuid"
              :site-uuid="siteUuid"
              :attach-to="{ action_item_id: it.id }"
              :label="it.title || 'Action'" />
            <button
              type="button"
              @click="emit('patch-item', { item: it, patch: { status: it.status === 'declined' ? 'open' : 'declined' } })"
              class="btn-icon"
              v-tooltip="it.status === 'declined' ? 'Réintégrer cette action dans le plan' : 'Écarter cette action du plan et du PDF'">
              <component :is="it.status === 'declined' ? EyeIcon : EyeSlashIcon" class="w-4 h-4 shrink-0" />
            </button>
          </div>
        </div>
        <div v-if="hasNotes(it.alternative_solutions_html) && isOpen(it)"
             class="px-3 py-1.5 bg-violet-50 border-t border-violet-200 text-[12px] text-violet-900 leading-relaxed">
          <SafeHtml class="prose prose-sm max-w-none text-violet-900" :html="it.alternative_solutions_html" />
        </div>
        </div>
        </template>
      </section>
      <!-- Informations hors plan (exemption 5 %, vigilance…) : sans numéro ni
           effet sur la conformité, comme le bloc « Exemptions et points de
           vigilance » du PDF. -->
      <section v-if="infoItems.length" class="space-y-3">
        <header class="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 border-l-4 border-gray-300">
          <h3 class="text-sm font-semibold text-gray-800 leading-tight">Informations hors plan</h3>
          <p class="ml-auto text-xs text-gray-500">Exemptions et points de vigilance : sans numéro ni effet sur la conformité</p>
        </header>
        <div v-for="it in infoItems" :key="it.id" class="border border-gray-200 rounded-lg bg-white">
          <div class="px-3 py-2 flex items-start gap-2.5">
            <button type="button" @click="toggleOpen(it)" :aria-expanded="isOpen(it)"
                    class="mt-0.5 p-0.5 text-gray-400 hover:text-gray-700 shrink-0"
                    v-tooltip="isOpen(it) ? 'Masquer le détail' : 'Afficher le détail'">
              <FontAwesomeIcon :icon="['fas', isOpen(it) ? 'chevron-down' : 'chevron-right']" class="w-3 h-3" />
            </button>
            <span class="pill justify-center w-25 shrink-0 tone-muted">Information</span>
            <div class="flex-1 min-w-0">
              <div class="text-sm text-gray-800 font-medium leading-snug cursor-pointer" @click="toggleOpen(it)">
                <ActionDescription :text="it.title" />
              </div>
              <div v-if="it.description && isOpen(it)" class="mt-2 px-3 py-2 rounded-md bg-gray-50 text-xs text-gray-700 leading-relaxed">
                <ActionDescription :text="it.description" />
              </div>
            </div>
            <button
              type="button"
              @click="emit('patch-item', { item: it, patch: { status: it.status === 'declined' ? 'open' : 'declined' } })"
              class="btn-icon shrink-0"
              v-tooltip="it.status === 'declined' ? 'Réintégrer cette information' : 'Écarter cette information du PDF'">
              <component :is="it.status === 'declined' ? EyeIcon : EyeSlashIcon" class="w-4 h-4 shrink-0" />
            </button>
          </div>
        </div>
      </section>
    </div>
  </CollapsibleSection>
</template>
