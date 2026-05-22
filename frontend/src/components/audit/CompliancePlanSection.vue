<script setup>
import { computed } from 'vue'
import { ArrowPathIcon, ExclamationTriangleIcon, CheckCircleIcon, PencilSquareIcon, MapPinIcon, EyeSlashIcon, EyeIcon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import SafeHtml from '@/components/SafeHtml.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import Button from '@/components/Button.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'

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

// Numero affiche par action : "BACS-001" pour faciliter la reference
// dans les devis des integrateurs GTB.
function actionNumber(idx) {
  return 'BACS-' + String(idx + 1).padStart(3, '0')
}

// Actions regroupées par zone fonctionnelle (lisibilité). Les actions
// sans zone (GTB, inspections) vont dans un groupe « Site / Général ».
// L'index global est conservé pour la numérotation BACS-XXX.
const groupedItems = computed(() => {
  const groups = new Map()
  props.visibleActionItems.forEach((it, idx) => {
    const key = it.zone_name || '__general__'
    if (!groups.has(key)) {
      groups.set(key, { key, zone_name: it.zone_name || null, items: [] })
    }
    groups.get(key).items.push({ it, idx })
  })
  return [...groups.values()]
})

function hasNotes(html) {
  if (!html) return false
  return html.replace(/<[^>]*>/g, '').trim().length > 0
}
</script>

<template>
  <CollapsibleSection storage-key="review" section-id="section-review" :active="active">
    <template #header>
      <SectionHeader number="12" :title="'Plan de mise en conformité'"
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
    <div class="px-5 py-4 space-y-3">
      <div v-if="!visibleActionItems.length" class="py-10 text-center">
        <CheckCircleIcon class="w-10 h-10 text-emerald-500 mx-auto" />
        <p class="mt-2 text-sm text-gray-700 font-medium">Aucune action corrective à ce stade</p>
        <p class="text-xs text-gray-500">Saisis les systèmes et la GTB ci-dessus pour générer le plan.</p>
      </div>
      <!-- Actions regroupées par zone fonctionnelle -->
      <div v-for="grp in groupedItems" :key="grp.key" class="space-y-2">
        <div class="flex items-center gap-1.5 pt-1">
          <MapPinIcon class="w-4 h-4 text-indigo-500 shrink-0" />
          <h3 class="text-sm font-semibold text-gray-700">{{ grp.zone_name || 'Site / Général' }}</h3>
          <span class="text-[11px] text-gray-400">· {{ grp.items.length }} action{{ grp.items.length > 1 ? 's' : '' }}</span>
        </div>
        <div
          v-for="{ it, idx } in grp.items"
          :key="it.id"
          :class="['border rounded-lg overflow-hidden transition bg-white',
            it.status === 'declined' ? 'opacity-50' : '',
            it.severity === 'blocking' ? 'border-red-200' : (it.severity === 'major' ? 'border-orange-200' : 'border-amber-200')]">
        <!-- Ligne unique condensée : tags + titre/description + actions -->
        <div class="px-3 py-2 flex items-start gap-2.5">
          <div class="flex items-center gap-1.5 shrink-0 pt-0.5">
            <span class="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-mono rounded bg-gray-800 text-white whitespace-nowrap">
              {{ actionNumber(idx) }}
            </span>
            <span :class="['pill', severityLabels[it.severity].cls]">
              {{ severityLabels[it.severity].label }}
            </span>
            <span class="text-[10px] text-gray-400 font-mono whitespace-nowrap">{{ it.r175_article || '—' }}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm text-gray-800 font-medium leading-snug">{{ it.title }}</div>
            <div v-if="it.description" class="text-[11px] text-gray-500 mt-0.5 leading-snug">{{ it.description }}</div>
          </div>
          <!-- Actions compactes à droite -->
          <div class="flex items-center gap-1 shrink-0">
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
      </div>
    </div>
  </CollapsibleSection>
</template>
