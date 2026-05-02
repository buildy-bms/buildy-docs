<script setup>
import { ArrowPathIcon, ExclamationTriangleIcon, CheckCircleIcon, PencilSquareIcon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import SafeHtml from '@/components/SafeHtml.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'

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
      done: 'Terminée', declined: 'Refusée',
    }),
  },
})

const emit = defineEmits([
  'regenerate', 'open-commercial', 'validate-step', 'invalidate-step',
  'patch-item', 'open-alternatives',
])

// Numero affiche par action : "BACS-001" pour faciliter la reference
// dans les devis des integrateurs GTB.
function actionNumber(idx) {
  return 'BACS-' + String(idx + 1).padStart(3, '0')
}

function hasNotes(html) {
  if (!html) return false
  return html.replace(/<[^>]*>/g, '').trim().length > 0
}
</script>

<template>
  <CollapsibleSection storage-key="review" section-id="section-review" :active="active">
    <template #header>
      <SectionHeader number="11" title="Plan de mise en conformité"
                     :subtitle="`${visibleActionItems.length} action${visibleActionItems.length > 1 ? 's' : ''}${resolvedCount ? ' · ' + resolvedCount + ' résolue' + (resolvedCount > 1 ? 's' : '') + ' masquée' + (resolvedCount > 1 ? 's' : '') : ''}`"
                     :icon="ExclamationTriangleIcon" icon-color="text-orange-500"
                     :step="step"
                     @validate="emit('validate-step', $event)"
                     @invalidate="emit('invalidate-step', $event)">
        <template #actions>
          <button @click.stop="emit('regenerate')"
                  title="Recalcule le plan d'actions correctives à partir des données saisies (préserve les annotations commerciales)"
                  class="inline-flex items-center gap-1 text-xs text-gray-700 bg-white border border-gray-200 rounded-lg px-2 py-1 hover:bg-gray-50">
            <ArrowPathIcon class="w-3.5 h-3.5" /> Régénérer
          </button>
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
    <div class="px-4 py-3 space-y-3">
      <div v-if="!visibleActionItems.length" class="py-10 text-center">
        <CheckCircleIcon class="w-10 h-10 text-emerald-500 mx-auto" />
        <p class="mt-2 text-sm text-gray-700 font-medium">Aucune action corrective à ce stade</p>
        <p class="text-xs text-gray-500">Saisis les systèmes et la GTB ci-dessus pour générer le plan.</p>
      </div>
      <div
        v-for="(it, idx) in visibleActionItems"
        :key="it.id"
        :class="['border rounded-lg overflow-hidden transition bg-white',
          it.status === 'declined' ? 'opacity-50' : '',
          it.severity === 'blocking' ? 'border-red-200' : (it.severity === 'major' ? 'border-orange-200' : 'border-amber-200')]">
        <!-- Ligne 1 : tags identifiants + titre + description -->
        <div class="px-4 pt-3 pb-2 flex items-start gap-3">
          <div class="flex flex-wrap items-center gap-1.5 shrink-0">
            <span class="inline-flex items-center justify-center min-w-12 px-2 py-1 text-[11px] font-mono rounded bg-gray-800 text-white whitespace-nowrap">
              {{ actionNumber(idx) }}
            </span>
            <span :class="['pill', severityLabels[it.severity].cls]">
              {{ severityLabels[it.severity].label }}
            </span>
            <span class="text-[11px] text-gray-500 font-mono whitespace-nowrap">{{ it.r175_article || '—' }}</span>
            <span v-if="it.zone_name" class="pill tone-muted whitespace-nowrap">📍 {{ it.zone_name }}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm text-gray-800 font-medium leading-snug">{{ it.title }}</div>
            <div v-if="it.description" class="text-[12px] text-gray-500 mt-1 leading-relaxed">{{ it.description }}</div>
          </div>
        </div>
        <!-- Ligne 2 : actions commerciales (statut, ref, preconisations) -->
        <div class="px-4 pb-3 pt-1 flex flex-wrap items-end gap-3 border-t border-gray-100">
          <div>
            <label class="block text-[10px] font-medium text-gray-500 mb-0.5">Statut</label>
            <select :value="it.status"
                    @change="e => emit('patch-item', { item: it, patch: { status: e.target.value } })"
                    class="text-xs px-2 py-1 border border-gray-200 rounded w-36">
              <option v-for="(label, val) in statusLabels" :key="val" :value="val">{{ label }}</option>
            </select>
          </div>
          <div class="flex-1 min-w-48">
            <label class="block text-[10px] font-medium text-gray-500 mb-0.5">Note commerciale</label>
            <input type="text" :value="it.commercial_notes" placeholder="ex : ref produit, prix estimé, fournisseur"
                   @blur="e => emit('patch-item', { item: it, patch: { commercial_notes: e.target.value || null } })"
                   class="w-full text-xs px-2 py-1 border border-gray-200 rounded placeholder:italic placeholder:text-gray-400" />
          </div>
          <div>
            <label class="block text-[10px] font-medium text-gray-500 mb-0.5">Préconisations Buildy</label>
            <button
              type="button"
              @click="emit('open-alternatives', it)"
              :class="['inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded border transition whitespace-nowrap',
                hasNotes(it.alternative_solutions_html)
                  ? 'border-violet-300 text-violet-700 bg-violet-50 hover:bg-violet-100'
                  : (it.status === 'open'
                    ? 'border-red-300 text-red-700 bg-red-50 hover:bg-red-100 ring-1 ring-red-200'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50')]"
              :title="hasNotes(it.alternative_solutions_html) ? 'Modifier les préconisations' : 'Aucune préconisation — cliquer pour rédiger'">
              <PencilSquareIcon class="w-3.5 h-3.5" />
              {{ hasNotes(it.alternative_solutions_html)
                  ? 'Modifier'
                  : (it.status === 'open' ? '⚠ Rédiger' : '+ Rédiger') }}
            </button>
          </div>
        </div>
        <div v-if="hasNotes(it.alternative_solutions_html)"
             class="px-4 py-2 bg-violet-50 border-t border-violet-200 text-[12px] text-violet-900 leading-relaxed">
          <p class="text-[11px] font-medium font-semibold text-violet-700 mb-1">Préconisations Buildy</p>
          <SafeHtml class="prose prose-sm max-w-none text-violet-900" :html="it.alternative_solutions_html" />
        </div>
        <div v-else-if="it.status === 'open'"
             class="px-4 py-2 bg-red-50 border-t border-red-200 text-[11px] text-red-700 leading-relaxed flex items-center gap-2">
          <span>⚠</span>
          <span>Aucune préconisation Buildy renseignée pour cette action.</span>
          <button @click="emit('open-alternatives', it)" class="ml-auto text-red-700 underline hover:text-red-900 font-medium">
            Préconiser maintenant
          </button>
        </div>
      </div>
    </div>
  </CollapsibleSection>
</template>
