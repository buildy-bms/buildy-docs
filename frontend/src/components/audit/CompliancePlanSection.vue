<script setup>
import { computed } from 'vue'
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
const groupedCards = computed(() => groupByCard(props.visibleActionItems))

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
                     :subtitle="`${visibleActionItems.length} action${visibleActionItems.length > 1 ? 's' : ''}${resolvedCount ? ' · ' + resolvedCount + ' résolue' + (resolvedCount > 1 ? 's' : '') + ' masquée' + (resolvedCount > 1 ? 's' : '') : ''}`"
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
        <span v-if="resolvedCount" class="text-emerald-600"> · {{ resolvedCount }} résolue{{ resolvedCount > 1 ? 's' : '' }}</span>
      </span>
      <span v-else class="italic text-emerald-700">✓ Aucune action corrective</span>
    </template>
    <div class="px-5 py-4 space-y-5">
      <!-- Encart sources : hiérarchie des références citées dans les
           descriptions. Le décret est la seule source juridiquement
           opposable ; le reste sert d'aide à l'interprétation. -->
      <div v-if="visibleActionItems.length" class="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-indigo-50/70 border border-indigo-200">
        <InformationCircleIcon class="w-4 h-4 shrink-0 text-indigo-500 mt-0.5" />
        <div class="text-[11px] leading-relaxed text-indigo-900/90">
          <p><strong class="font-semibold">Sources d'aide à l'interprétation (non opposables).</strong> Les actions ci-dessous reposent sur le décret R175 (seule source juridiquement opposable), complété par les références suivantes pour le détail d'application :</p>
          <ul class="mt-1 space-y-0.5 list-disc pl-4">
            <li>Guide d'application du décret BACS — ministère, version 2, janvier 2026.</li>
            <li>Guide pratique d'application du décret BACS — PROFEEL, novembre 2025.</li>
            <li>Norme NF EN ISO 52120-1 (Performance énergétique des bâtiments — Contribution de l'automatisation, de la régulation et de la gestion technique des bâtiments).</li>
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
        <header class="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-emerald-50 border-l-4 border-emerald-500">
          <span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-600 text-white text-xs font-bold shrink-0">{{ ci + 1 }}</span>
          <div class="flex-1 min-w-0">
            <h3 class="text-base font-semibold text-emerald-900 leading-tight">{{ card.label }}</h3>
            <p class="text-xs text-emerald-700/80 mt-0.5">
              {{ card.count }} action{{ card.count > 1 ? 's' : '' }}<template v-if="card.blocking"> · <span class="text-red-700 font-semibold">{{ card.blocking }} bloquante{{ card.blocking > 1 ? 's' : '' }}</span></template><template v-if="card.major"> · <span class="text-orange-700">{{ card.major }} majeure{{ card.major > 1 ? 's' : '' }}</span></template><template v-if="card.minor"> · <span class="text-amber-700">{{ card.minor }} mineure{{ card.minor > 1 ? 's' : '' }}</span></template>
            </p>
          </div>
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
                {{ sub.count }} action{{ sub.count > 1 ? 's' : '' }}<template v-if="sub.blocking"> · <span class="text-red-700 font-semibold">{{ sub.blocking }} bloquante{{ sub.blocking > 1 ? 's' : '' }}</span></template><template v-if="sub.major"> · <span class="text-orange-700">{{ sub.major }} majeure{{ sub.major > 1 ? 's' : '' }}</span></template><template v-if="sub.minor"> · <span class="text-amber-700">{{ sub.minor }} mineure{{ sub.minor > 1 ? 's' : '' }}</span></template>
              </p>
            </div>
          </div>
          <div
            v-for="it in sub.items"
            :key="it.id"
            :class="['border rounded-lg overflow-hidden transition bg-white',
              card.subsections && card.subsections.length > 1 ? 'ml-4' : '',
              it.status === 'declined' ? 'opacity-50' : '',
              it.severity === 'blocking' ? 'border-red-200' : (it.severity === 'major' ? 'border-orange-200' : 'border-amber-200')]">
        <!-- Ligne unique condensée : tags + titre/description + actions -->
        <div class="px-3 py-2 flex items-start gap-2.5">
          <div class="flex items-center gap-1.5 shrink-0 pt-0.5">
            <span class="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-mono rounded bg-gray-800 text-white whitespace-nowrap">
              {{ it.display_number || '—' }}
            </span>
            <span :class="['pill', severityLabels[it.severity].cls]">
              {{ severityLabels[it.severity].label }}
            </span>
            <span class="text-[10px] text-gray-400 font-mono whitespace-nowrap">{{ it.r175_article || '—' }}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm text-gray-800 font-medium leading-snug">
              <ActionDescription :text="it.title" />
            </div>
            <div v-if="it.description" class="text-[11px] text-gray-500 mt-0.5 leading-snug">
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
        <div v-if="hasNotes(it.alternative_solutions_html)"
             class="px-3 py-1.5 bg-violet-50 border-t border-violet-200 text-[12px] text-violet-900 leading-relaxed">
          <SafeHtml class="prose prose-sm max-w-none text-violet-900" :html="it.alternative_solutions_html" />
        </div>
        </div>
        </template>
      </section>
    </div>
  </CollapsibleSection>
</template>
