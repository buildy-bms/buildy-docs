<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
import { computed, ref, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { regenerateBacsActionItems, updateBacsActionItem } from '@/api'
import MobileSheet from './MobileSheet.vue'
import MobileField from './MobileField.vue'
import MobileSelectSheet from './MobileSelectSheet.vue'
import ActionDescription from '@/components/audit/ActionDescription.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import { groupByCard, CARD_FLAT_OPTIONS, cardOfAction } from '@/lib/action-cards'

const CARD_OPTIONS = CARD_FLAT_OPTIONS()

const audit = useAuditStore()
const { actionItems, document } = storeToRefs(audit)
const { error, success } = useNotification()

const SEVERITY_LABEL = {
  blocking: { label: 'Bloquante', cls: 'bg-red-50 border-red-200 text-red-700' },
  major: { label: 'Majeure', cls: 'bg-orange-50 border-orange-200 text-orange-700' },
  minor: { label: 'Mineure', cls: 'bg-amber-50 border-amber-200 text-amber-700' },
}
const STATUS_OPTIONS = [
  { value: 'open',        label: 'Ouverte' },
  { value: 'quoted',      label: 'Chiffrée' },
  { value: 'in_progress', label: 'En cours' },
  { value: 'done',        label: 'Terminée' },
  { value: 'declined',    label: 'Non retenue' },
]
const EFFORT_OPTIONS = [
  { value: 'low',    label: 'Faible' },
  { value: 'medium', label: 'Moyen' },
  { value: 'high',   label: 'Élevé' },
]
const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS.map(o => [o.value, o.label]))

// On affiche tous les items dans le mobile (incluant done/declined) ;
// l'auditeur a besoin de remettre un item "done" en "open" si la
// remédiation n'a pas tenu, par exemple. La barre de filtre permet de
// masquer.
const filter = ref('open') // 'open' | 'all' | 'done'
const filteredItems = computed(() => {
  const all = actionItems.value || []
  if (filter.value === 'all') return all
  if (filter.value === 'done') return all.filter(i => i.status === 'done' || i.status === 'declined')
  return all.filter(i => i.status !== 'done' && i.status !== 'declined')
})
const itemsBySeverity = computed(() => ({
  blocking: filteredItems.value.filter(i => i.severity === 'blocking'),
  major: filteredItems.value.filter(i => i.severity === 'major'),
  minor: filteredItems.value.filter(i => i.severity === 'minor'),
}))

// Regroupement par CARTE de l'audit (alignement stepper, identique au
// desktop et au PDF). La carte GTB embarque ses sous-sections. La
// numerotation BACS-NNN vient directement du backend (champ
// `display_number`) — pas de recalcul local.
const groupedCards = computed(() => groupByCard(filteredItems.value))

function manualAssignedValue(it) {
  const c = cardOfAction(it)
  if (!c.card || c.card === 'misc') return ''
  if (c.subsection) return `${c.card}/${c.subsection}`
  return c.card
}
async function reassignManual(it, value) {
  let assigned_card = null
  let assigned_subsection = null
  if (value) {
    const [card, sub] = value.split('/')
    assigned_card = card
    assigned_subsection = sub || null
  }
  try {
    await updateBacsActionItem(it.id, { assigned_card, assigned_subsection })
    await audit.refreshActionItems()
  } catch (e) {
    error(e.response?.data?.detail || 'Réaffectation impossible')
  }
}

const regenerating = ref(false)
async function regenerate() {
  regenerating.value = true
  try {
    const { data } = await regenerateBacsActionItems(document.value.id)
    success(`+${data.added} nouvelles · ${data.updated} synchronisées · ${data.resolved} résolues`)
    await audit.refreshAuditCore()
  } catch {
    error('Régénération impossible')
  } finally {
    regenerating.value = false
  }
}

// ── Édition par sheet ─────────────────────────────────────────────
const editing = ref(null)            // l'item en cours d'édition
const draft = ref({})
const saving = ref(false)

// Titre du sheet d'édition : numéro BACS-NNN + titre court de l'action,
// au lieu du libellé générique « BACS · Mineure » qui ne renseignait
// pas sur le contenu.
const actionSheetTitle = computed(() => {
  if (!editing.value) return ''
  const num = editing.value.display_number || 'BACS'
  const title = editing.value.title || SEVERITY_LABEL[editing.value.severity]?.label || ''
  return title ? `${num} — ${title}` : num
})

// ── Navigation drill-down 3 niveaux (parité avec MobileSystemsTab) ─────
// Niveau 1 (cards)        : liste des cartes du stepper
// Niveau 2 (subsections) : sous-sections (uniquement carte GTB)
// Niveau 3 (items)        : liste des items BACS-NNN
// Le sticky header retour remonte d'un niveau ; scroll reset à chaque
// changement de niveau (cf. nextTick + window.scrollTo).
const selectedCardKey = ref(null)
const selectedSubKey = ref(null)
const currentCard = computed(() =>
  selectedCardKey.value ? groupedCards.value.find(c => c.key === selectedCardKey.value) : null)
const currentSub = computed(() => {
  if (!currentCard.value || !selectedSubKey.value) return null
  return (currentCard.value.subsections || []).find(s => s.key === selectedSubKey.value) || null
})
// Liste des items à afficher au niveau le plus bas.
const currentItems = computed(() => {
  if (currentSub.value) return currentSub.value.items
  if (currentCard.value && (!currentCard.value.subsections || currentCard.value.subsections.length <= 1)) {
    return currentCard.value.items
  }
  return []
})
const drillView = computed(() => {
  if (!currentCard.value) return 'cards'
  if (currentCard.value.subsections && currentCard.value.subsections.length > 1 && !currentSub.value) return 'subsections'
  return 'items'
})
function enterCard(card) {
  selectedCardKey.value = card.key
  selectedSubKey.value = null
  // Si la carte n'a pas de sous-sections (autres que la fictive), on
  // saute directement au niveau items.
  if (!card.subsections || card.subsections.length <= 1) {
    selectedSubKey.value = null
  }
  scrollTop()
}
function enterSub(sub) {
  selectedSubKey.value = sub.key
  scrollTop()
}
function backOne() {
  if (selectedSubKey.value) { selectedSubKey.value = null; scrollTop(); return }
  if (selectedCardKey.value) { selectedCardKey.value = null; scrollTop(); return }
}
function scrollTop() {
  nextTick(() => window.scrollTo({ top: 0, behavior: 'auto' }))
}

function openEdit(item) {
  editing.value = item
  draft.value = {
    status: item.status || 'open',
    estimated_effort: item.estimated_effort || null,
    commercial_notes: item.commercial_notes || '',
    alternative_solutions_html: item.alternative_solutions_html || '',
  }
}
function closeEdit() {
  editing.value = null
  draft.value = {}
}

async function saveEdit() {
  if (!editing.value) return
  saving.value = true
  try {
    const payload = {
      status: draft.value.status,
      estimated_effort: draft.value.estimated_effort || null,
      commercial_notes: draft.value.commercial_notes || null,
      alternative_solutions_html: draft.value.alternative_solutions_html || null,
    }
    await updateBacsActionItem(editing.value.id, payload)
    success('Action mise à jour')
    await audit.refreshActionItems()
    closeEdit()
  } catch (e) {
    error(e.response?.data?.detail || 'Sauvegarde impossible')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="p-3 pb-24 space-y-3">
    <!-- Breadcrumb sticky : niveau courant + bouton retour.
         Niveau 1 → pas de breadcrumb.
         Niveau 2/3 → bouton ← + label de la carte (+ sous-section). -->
    <div v-if="currentCard"
         class="sticky top-0 z-10 -mx-3 px-3 py-2 bg-white/95 backdrop-blur border-b border-gray-100 flex items-center gap-2">
      <button type="button" @click="backOne"
              class="tap-target inline-flex items-center gap-1 text-sm font-medium text-indigo-600 -ml-1.5 pl-1.5">
        <FontAwesomeIcon :icon="['fas', 'chevron-left']" class="w-3.5 h-3.5" />
        Retour
      </button>
      <div class="flex-1 min-w-0 text-xs text-gray-500 truncate">
        Plan d'action
        <span class="text-gray-400"> › </span>
        <strong class="text-gray-700">{{ currentCard.label }}</strong>
        <template v-if="currentSub">
          <span class="text-gray-400"> › </span>
          <strong class="text-gray-700">{{ currentSub.label }}</strong>
        </template>
      </div>
    </div>

    <!-- Filtre (niveau 1 uniquement) -->
    <div v-if="drillView === 'cards'" class="flex gap-1.5">
      <button
        v-for="opt in [{v:'open',l:'À traiter'}, {v:'done',l:'Faites'}, {v:'all',l:'Toutes'}]"
        :key="opt.v"
        type="button"
        @click="filter = opt.v"
        :class="['flex-1 tap-target text-sm font-medium rounded-xl transition',
                 filter === opt.v ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700']"
      >
        {{ opt.l }}
      </button>
    </div>

    <!-- 3 stats severities (niveau 1 uniquement) -->
    <div v-if="drillView === 'cards'" class="grid grid-cols-3 gap-2">
      <div v-for="sev in ['blocking', 'major', 'minor']" :key="sev"
           :class="['rounded-xl border p-3 text-center', SEVERITY_LABEL[sev].cls]">
        <p class="text-2xl font-medium leading-none">{{ itemsBySeverity[sev].length }}</p>
        <p class="text-xs uppercase tracking-wider mt-1 opacity-80">{{ SEVERITY_LABEL[sev].label }}</p>
      </div>
    </div>

    <!-- Bouton régénérer (niveau 1 uniquement) -->
    <button
      v-if="drillView === 'cards'"
      @click="regenerate"
      :disabled="regenerating"
      class="pwa-button pwa-button--neutral w-full"
    >
      <FontAwesomeIcon :icon="['fas', 'arrows-rotate']" :class="['w-4 h-4', regenerating ? 'animate-spin' : '']" />
      {{ regenerating ? 'Régénération…' : 'Régénérer le plan' }}
    </button>

    <!-- Encart sources : hiérarchie des références citées dans les
         descriptions. Visible seulement au niveau 1 (vue cartes). -->
    <div v-if="drillView === 'cards' && filteredItems.length"
         class="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-indigo-50/70 border border-indigo-200">
      <FontAwesomeIcon :icon="['fas', 'circle-info']" class="w-4 h-4 shrink-0 text-indigo-500 mt-0.5" />
      <div class="text-[11px] leading-relaxed text-indigo-900/90">
        <p><strong class="font-semibold">Sources d'aide à l'interprétation (non opposables).</strong> Les actions reposent sur le décret R175 (seule source opposable), complété par : Guide d'application ministère (janvier 2026) ; Guide PROFEEL (novembre 2025) ; norme NF EN ISO 52120-1.</p>
      </div>
    </div>

    <!-- NIVEAU 1 — Liste des cartes du stepper, chacune tactile. -->
    <div v-if="drillView === 'cards' && filteredItems.length" class="space-y-2">
      <button
        v-for="card in groupedCards" :key="card.key"
        type="button"
        @click="enterCard(card)"
        class="w-full text-left bg-white rounded-2xl border-2 border-emerald-200 p-4 active:bg-emerald-50/40 transition flex items-center gap-3"
      >
        <div class="flex-1 min-w-0">
          <p class="text-base font-semibold text-emerald-900 leading-tight">{{ card.label }}</p>
          <p class="text-xs text-emerald-700/80 mt-0.5">
            {{ card.count }} action{{ card.count > 1 ? 's' : '' }}
            <template v-if="card.blocking"> · <span class="text-red-700 font-semibold">{{ card.blocking }} bloquante{{ card.blocking > 1 ? 's' : '' }}</span></template>
            <template v-if="card.major"> · <span class="text-orange-700">{{ card.major }} majeure{{ card.major > 1 ? 's' : '' }}</span></template>
            <template v-if="card.minor"> · <span class="text-amber-700">{{ card.minor }} mineure{{ card.minor > 1 ? 's' : '' }}</span></template>
          </p>
        </div>
        <FontAwesomeIcon :icon="['fas', 'chevron-right']" class="w-4 h-4 text-emerald-500 shrink-0" />
      </button>
    </div>

    <!-- NIVEAU 2 — Sous-sections GTB. -->
    <div v-else-if="drillView === 'subsections'" class="space-y-2">
      <button
        v-for="sub in (currentCard.subsections || [])" :key="sub.key"
        type="button"
        @click="enterSub(sub)"
        class="w-full text-left bg-white rounded-2xl border-2 border-slate-200 p-4 active:bg-slate-50 transition flex items-center gap-3"
      >
        <div class="flex-1 min-w-0">
          <p class="text-base font-semibold text-slate-800 leading-tight">{{ sub.label }}</p>
          <p class="text-xs text-slate-500 mt-0.5">
            {{ sub.count }} action{{ sub.count > 1 ? 's' : '' }}
            <template v-if="sub.blocking"> · <span class="text-red-700 font-semibold">{{ sub.blocking }} bloquante{{ sub.blocking > 1 ? 's' : '' }}</span></template>
            <template v-if="sub.major"> · <span class="text-orange-700">{{ sub.major }} majeure{{ sub.major > 1 ? 's' : '' }}</span></template>
            <template v-if="sub.minor"> · <span class="text-amber-700">{{ sub.minor }} mineure{{ sub.minor > 1 ? 's' : '' }}</span></template>
          </p>
        </div>
        <FontAwesomeIcon :icon="['fas', 'chevron-right']" class="w-4 h-4 text-slate-500 shrink-0" />
      </button>
    </div>

    <!-- NIVEAU 3 — Liste des items BACS-NNN. -->
    <div v-else-if="drillView === 'items'" class="space-y-2">
      <button
        v-for="it in currentItems" :key="it.id"
        type="button"
        @click="openEdit(it)"
        :class="['w-full text-left bg-white rounded-2xl border-2 p-4 active:bg-gray-50 transition',
          it.severity === 'blocking' ? 'border-red-200' : it.severity === 'major' ? 'border-orange-200' : 'border-amber-200',
          (it.status === 'done' || it.status === 'declined') ? 'opacity-60' : '']"
      >
        <div class="flex items-start gap-2 mb-2 flex-wrap">
          <span class="inline-flex items-center justify-center min-w-12 px-2 py-1 text-xs font-mono rounded bg-gray-800 text-white whitespace-nowrap">
            {{ it.display_number || '—' }}
          </span>
          <span :class="['inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full', SEVERITY_LABEL[it.severity].cls]">
            {{ SEVERITY_LABEL[it.severity].label }}
          </span>
          <span class="text-xs text-gray-500 font-mono">{{ it.r175_article || '—' }}</span>
          <span v-if="it.status === 'declined'" class="ml-auto inline-flex items-center gap-1 text-xs text-gray-500 italic">
            Écartée
          </span>
        </div>
        <p class="text-sm font-medium text-gray-900 leading-snug">
          <ActionDescription :text="it.title" />
        </p>
        <p v-if="it.description" class="text-xs text-gray-600 mt-1.5 leading-relaxed">
          <ActionDescription :text="it.description" />
        </p>
        <p v-if="it.zone_name" class="text-xs text-gray-500 mt-2">📍 {{ it.zone_name }}</p>
      </button>
      <div v-if="!currentItems.length" class="bg-white rounded-2xl border border-dashed border-emerald-300 p-8 text-center">
        <FontAwesomeIcon :icon="['fas', 'circle-check']" class="w-10 h-10 text-emerald-500 mx-auto" />
        <p class="text-sm font-medium text-emerald-700 mt-3">Aucune action ici.</p>
      </div>
    </div>
    <div v-else class="bg-white rounded-2xl border border-dashed border-emerald-300 p-8 text-center">
      <FontAwesomeIcon :icon="['fas', 'circle-check']" class="w-12 h-12 text-emerald-500 mx-auto" />
      <p class="text-base font-medium text-emerald-700 mt-3">
        {{ filter === 'open' ? 'Aucune action ouverte' : filter === 'done' ? 'Aucune action terminée' : 'Aucune action' }}
      </p>
      <p v-if="filter === 'open'" class="text-xs text-gray-500 mt-1">Tu peux passer à la livraison</p>
    </div>

    <!-- Sheet d'édition d'un item — titre = BACS-NNN + titre court de
         l'action pour que l'auditeur sache ce qu'il édite. -->
    <MobileSheet
      :open="!!editing"
      :title="actionSheetTitle"
      :saving="saving"
      save-label="Enregistrer"
      @close="closeEdit"
      @save="saveEdit"
    >
      <div v-if="editing" class="p-4 space-y-4">
        <!-- Lecture seule : titre, description, méta -->
        <div class="bg-white rounded-xl border border-gray-200 px-4 py-3 space-y-2">
          <p class="text-sm font-semibold text-gray-900 leading-snug">
            <ActionDescription :text="editing.title" />
          </p>
          <p v-if="editing.description" class="text-xs text-gray-600 leading-relaxed">
            <ActionDescription :text="editing.description" />
          </p>
          <div class="flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span v-if="editing.r175_article" class="font-mono">{{ editing.r175_article }}</span>
            <span v-if="editing.zone_name">📍 {{ editing.zone_name }}</span>
            <span v-if="editing.auto_generated" class="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-medium">
              Auto-générée
            </span>
          </div>
        </div>

        <!-- Photos terrain en TÊTE : reflexe terrain, geste #1. -->
        <div v-if="document?.site_uuid" class="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p class="text-xs font-medium text-gray-600 uppercase tracking-wider mb-2">Photos</p>
          <BacsPhotoButton
            :site-uuid="document.site_uuid"
            :attach-to="{ action_item_id: editing.id }"
            :label="editing.title || 'Action'"
            size="md"
          />
        </div>

        <!-- Écarter / réintégrer l'action du plan -->
        <button type="button"
                @click="draft.status = draft.status === 'declined' ? 'open' : 'declined'"
                :class="['w-full min-h-11 inline-flex items-center justify-center gap-2 py-3 text-base font-medium rounded-xl border-2 transition',
                         draft.status === 'declined'
                           ? 'border-emerald-300 text-emerald-700 bg-emerald-50'
                           : 'border-gray-300 text-gray-600 bg-white']">
          <FontAwesomeIcon :icon="['fas', draft.status === 'declined' ? 'eye' : 'eye-slash']" class="w-4 h-4" />
          {{ draft.status === 'declined' ? 'Réintégrer dans le plan' : 'Écarter cette action' }}
        </button>

        <!-- Effort estimé -->
        <MobileField label="Effort estimé" hint="Pour le devis commercial. Peut être laissé vide.">
          <MobileSelectSheet
            :model-value="draft.estimated_effort"
            @update:modelValue="v => draft.estimated_effort = v || null"
            :options="EFFORT_OPTIONS"
            title="Effort estimé"
            placeholder="— À évaluer —"
          />
        </MobileField>

        <!-- Carte de l'audit (items MANUELS uniquement) -->
        <MobileField v-if="editing && !editing.auto_generated"
                     label="Carte de l'audit"
                     hint="Range cette préconisation dans une carte du stepper. Par défaut elle vit dans « Divers ».">
          <MobileSelectSheet
            :model-value="manualAssignedValue(editing) || ''"
            @update:modelValue="v => reassignManual(editing, v || '')"
            :options="[{ value: '', label: 'Divers' }, ...CARD_OPTIONS]"
            title="Carte de l'audit"
            placeholder="— Divers —"
          />
        </MobileField>

        <!-- Alternatives proposées (texte libre, V1 mobile sans richtext) -->
        <MobileField label="Alternatives proposées" hint="Variantes / préconisations Buildy listées dans le PDF (R175-5-1 4°).">
          <textarea
            :value="(draft.alternative_solutions_html || '').replace(/<[^>]*>/g, '').trim()"
            @input="e => draft.alternative_solutions_html = e.target.value ? `<p>${e.target.value.replace(/\n+/g, '</p><p>')}</p>` : null"
            rows="4"
            placeholder="ex : Passerelle CoolMaster Pro pour intégrer le DRV Daikin, ou remplacement par DRV Mitsubishi compatible BACnet."
            class="w-full min-h-11 px-3 py-3 text-base bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 resize-y"
          ></textarea>
        </MobileField>

        <p v-if="editing.auto_generated" class="text-xs text-gray-500 leading-relaxed">
          Item généré automatiquement depuis l'audit. Le titre, la description
          et la sévérité ne sont pas modifiables — ils suivent l'état de
          l'entité source (système, compteur, GTB…). Pour les changer, ajuste
          l'entité concernée puis « Régénérer le plan ».
        </p>
      </div>
    </MobileSheet>
  </div>
</template>
