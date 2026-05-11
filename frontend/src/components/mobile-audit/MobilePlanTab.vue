<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { regenerateBacsActionItems, updateBacsActionItem } from '@/api'
import MobileSheet from './MobileSheet.vue'
import MobileField from './MobileField.vue'
import MobileNativeSelect from './MobileNativeSelect.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'

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
    <!-- Filtre -->
    <div class="flex gap-1.5">
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

    <!-- 3 stats severities -->
    <div class="grid grid-cols-3 gap-2">
      <div v-for="sev in ['blocking', 'major', 'minor']" :key="sev"
           :class="['rounded-xl border p-3 text-center', SEVERITY_LABEL[sev].cls]">
        <p class="text-2xl font-medium leading-none">{{ itemsBySeverity[sev].length }}</p>
        <p class="text-[10px] uppercase tracking-wider mt-1 opacity-80">{{ SEVERITY_LABEL[sev].label }}</p>
      </div>
    </div>

    <!-- Bouton régénérer -->
    <button
      @click="regenerate"
      :disabled="regenerating"
      class="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-xl active:bg-gray-50"
    >
      <FontAwesomeIcon :icon="['fas', 'arrows-rotate']" :class="['w-4 h-4', regenerating ? 'animate-spin' : '']" />
      {{ regenerating ? 'Régénération…' : 'Régénérer le plan' }}
    </button>

    <!-- Liste actions -->
    <div v-if="filteredItems.length" class="space-y-2">
      <button
        v-for="(it, idx) in filteredItems"
        :key="it.id"
        type="button"
        @click="openEdit(it)"
        :class="['w-full text-left bg-white rounded-2xl border-2 p-4 active:bg-gray-50 transition',
          it.severity === 'blocking' ? 'border-red-200' : it.severity === 'major' ? 'border-orange-200' : 'border-amber-200',
          (it.status === 'done' || it.status === 'declined') ? 'opacity-60' : '']"
      >
        <div class="flex items-start gap-2 mb-2 flex-wrap">
          <span class="inline-flex items-center justify-center min-w-12 px-2 py-1 text-[10px] font-mono rounded bg-gray-800 text-white whitespace-nowrap">
            BACS-{{ String(idx + 1).padStart(3, '0') }}
          </span>
          <span :class="['inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full', SEVERITY_LABEL[it.severity].cls]">
            {{ SEVERITY_LABEL[it.severity].label }}
          </span>
          <span class="text-[10px] text-gray-500 font-mono">{{ it.r175_article || '—' }}</span>
          <span class="ml-auto inline-flex items-center gap-1 text-[10px] text-gray-500">
            <FontAwesomeIcon :icon="['fas', 'pen-to-square']" class="w-3 h-3" />
            {{ STATUS_LABEL[it.status] || it.status }}
          </span>
        </div>
        <p class="text-sm font-medium text-gray-900 leading-snug">{{ it.title }}</p>
        <p v-if="it.description" class="text-xs text-gray-600 mt-1.5 leading-relaxed">{{ it.description }}</p>
        <p v-if="it.zone_name" class="text-xs text-gray-500 mt-2">📍 {{ it.zone_name }}</p>
        <p v-if="it.commercial_notes" class="text-xs text-indigo-700 mt-2 italic">💬 {{ it.commercial_notes }}</p>
      </button>
    </div>
    <div v-else class="bg-white rounded-2xl border border-dashed border-emerald-300 p-8 text-center">
      <FontAwesomeIcon :icon="['fas', 'circle-check']" class="w-12 h-12 text-emerald-500 mx-auto" />
      <p class="text-base font-medium text-emerald-700 mt-3">
        {{ filter === 'open' ? 'Aucune action ouverte' : filter === 'done' ? 'Aucune action terminée' : 'Aucune action' }}
      </p>
      <p v-if="filter === 'open'" class="text-xs text-gray-500 mt-1">Tu peux passer à la livraison</p>
    </div>

    <!-- Sheet d'édition d'un item -->
    <MobileSheet
      :open="!!editing"
      :title="editing ? `BACS · ${SEVERITY_LABEL[editing.severity]?.label || ''}` : ''"
      :saving="saving"
      save-label="Enregistrer"
      @close="closeEdit"
      @save="saveEdit"
    >
      <div v-if="editing" class="p-4 space-y-4">
        <!-- Lecture seule : titre, description, méta -->
        <div class="bg-white rounded-xl border border-gray-200 px-4 py-3 space-y-2">
          <p class="text-sm font-semibold text-gray-900 leading-snug">{{ editing.title }}</p>
          <p v-if="editing.description" class="text-xs text-gray-600 leading-relaxed">{{ editing.description }}</p>
          <div class="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
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

        <!-- Statut -->
        <MobileField label="Statut">
          <MobileNativeSelect
            :model-value="draft.status"
            @update:modelValue="v => draft.status = v || 'open'"
            :options="STATUS_OPTIONS"
            placeholder="— Statut —"
          />
        </MobileField>

        <!-- Effort estimé -->
        <MobileField label="Effort estimé" hint="Pour le devis commercial. Peut être laissé vide.">
          <MobileNativeSelect
            :model-value="draft.estimated_effort"
            @update:modelValue="v => draft.estimated_effort = v || null"
            :options="EFFORT_OPTIONS"
            placeholder="— À évaluer —"
          />
        </MobileField>

        <!-- Notes commerciales -->
        <MobileField label="Notes commerciales" hint="Visible uniquement en interne (devis, suivi).">
          <textarea
            v-model="draft.commercial_notes"
            rows="3"
            placeholder="ex : Devis Sodexo en cours, attente d'arbitrage MOA…"
            class="w-full min-h-11 px-3 py-3 text-base bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 resize-y"
          ></textarea>
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
