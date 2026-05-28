<script setup>
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { ClockIcon, PlusIcon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import SegmentedToggle from '@/components/audit/SegmentedToggle.vue'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'

// Section "Inspection périodique par un tiers" (R175-5-1) — utilise
// directement le store Pinia useAuditStore, plus de props nécessaires.
defineProps({
  step: { type: Object, default: null },
  active: { type: Boolean, default: false },
})
const emit = defineEmits(['validate-step', 'invalidate-step', 'save-doc'])
const audit = useAuditStore()
const { inspections, latestInspection, todayIso, document } = storeToRefs(audit)
const { error } = useNotification()
const { confirm } = useConfirm()

// Mig 187 — toggle « Aucune inspection à déclarer ». Tri-état dérivé du
// document : 1 = oui (skip), 0/null = à déclarer.
const notApplicable = computed(() => {
  const v = document.value?.inspection_not_applicable
  return v === 1 || v === true
})
function setNotApplicable(v) {
  // v: true = pas d'inspection à déclarer, false = remettre à déclarer.
  // null géré comme remise à false (état initial).
  const payload = { inspection_not_applicable: v === true }
  if (v !== true) payload.inspection_not_applicable_reason = null
  emit('save-doc', payload)
  // MAJ optimiste du state local pour l'UX (le saveDocDebounced renverra
  // le document à jour mais avec 500 ms de debounce).
  if (document.value) {
    document.value.inspection_not_applicable = v === true ? 1 : 0
    if (v !== true) document.value.inspection_not_applicable_reason = null
  }
}
let reasonTimer = null
function onReasonInput(val) {
  if (document.value) document.value.inspection_not_applicable_reason = val || null
  clearTimeout(reasonTimer)
  reasonTimer = setTimeout(() => {
    emit('save-doc', { inspection_not_applicable_reason: val || null })
  }, 500)
}

async function addInspection() {
  try { await audit.addInspection() }
  catch { error('Création de l\'inspection impossible') }
}

const timers = new Map()
function patchInspectionDebounced(ins, patch) {
  Object.assign(ins, patch)
  clearTimeout(timers.get(ins.id))
  timers.set(ins.id, setTimeout(async () => {
    try { await audit.patchInspection(ins, patch) }
    catch { error('Sauvegarde inspection impossible') }
  }, 500))
}

async function removeInspection(ins) {
  const ok = await confirm({
    title: 'Supprimer cette inspection ?',
    message: 'L\'historique de cette inspection périodique sera perdu.',
    confirmLabel: 'Supprimer',
  })
  if (!ok) return
  try { await audit.removeInspection(ins.id) }
  catch { error('Suppression impossible') }
}
</script>

<template>
  <CollapsibleSection storage-key="inspections" section-id="section-inspections" :active="active">
    <template #header>
      <SectionHeader number="8" :title="'Inspection périodique par un tiers'"
                     subtitle="R175-5-1 — rapport conservé 10 ans"
                     :icon="ClockIcon" icon-color="text-amber-600"
                     :step="step"
                     @validate="emit('validate-step', $event)"
                     @invalidate="emit('invalidate-step', $event)">
        <template #subtitle-extra><R175Tooltip article="R175-5-1" /></template>
      </SectionHeader>
    </template>
    <template #summary>
      <span v-if="notApplicable" class="italic text-emerald-700">Aucune inspection à déclarer</span>
      <span v-else-if="inspections.length">
        {{ inspections.length }} inspection{{ inspections.length > 1 ? 's' : '' }} tracée{{ inspections.length > 1 ? 's' : '' }}
        <span v-if="latestInspection" class="text-gray-500">
          · dernière : {{ latestInspection.last_inspection_date || '—' }}
          <span v-if="latestInspection.next_inspection_due_date">
            · prochaine : {{ latestInspection.next_inspection_due_date }}
          </span>
        </span>
      </span>
      <span v-else class="italic text-amber-700">Aucune inspection R175-5-1 tracée — action corrective générée</span>
    </template>
    <div class="px-5 py-4 space-y-3">
      <!-- Mig 187 — toggle « Aucune inspection à déclarer » : utile quand le
           site n'est pas soumis à inspection (ex. ERP non concerné) ou n'a
           pas encore été inspecté pour des raisons légitimes. Bypass la
           génération de l'action corrective R175-5-1 et débloque la
           validation de cette card. -->
      <div class="rounded-lg border border-gray-200 bg-gray-50/50 px-3 py-2.5 flex items-start justify-between gap-3">
        <div class="text-xs text-gray-700 leading-snug">
          <div class="font-medium text-gray-800">Aucune inspection à déclarer ?</div>
          <div class="text-gray-500 mt-0.5">Coche Oui si le site n'est pas soumis à inspection périodique ou si aucune n'a encore été réalisée. Cela débloque la validation de la card et n'ajoute pas d'action corrective.</div>
        </div>
        <SegmentedToggle :model-value="notApplicable === false ? null : (notApplicable ? true : null)"
                         :options="[{ value: true, label: 'Oui', tone: 'green' }, { value: false, label: 'Non', tone: 'slate' }]"
                         @update:model-value="setNotApplicable" />
      </div>
      <div v-if="notApplicable" class="px-1">
        <label class="block text-[11px] text-gray-600 mb-1">Raison (optionnelle, apparaît dans le PDF)</label>
        <input :value="document?.inspection_not_applicable_reason || ''" type="text"
               placeholder="ex : ERP non concerné par R175-5-1, ou inspection prévue après livraison du chantier…"
               @input="e => onReasonInput(e.target.value)"
               class="input-base text-sm py-1.5 w-full" />
      </div>
      <p v-if="!inspections.length && !notApplicable" class="text-xs text-gray-500 italic">
        Trace ici les inspections officielles réalisées par un tiers (organisme indépendant). L'audit Buildy est interne et ne se substitue pas à cette obligation.
      </p>
      <div v-for="ins in inspections" :key="ins.id" class="border border-gray-200 rounded-lg p-3">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-[11px] text-gray-600 mb-1">Date de l'inspection</label>
            <input :value="ins.last_inspection_date || ''" type="date"
                   @input="e => patchInspectionDebounced(ins, { last_inspection_date: e.target.value || null })"
                   class="input-base text-sm py-1.5" />
          </div>
          <div>
            <label class="block text-[11px] text-gray-600 mb-1">Tiers inspecteur (nom / société)</label>
            <input :value="ins.last_inspection_inspector || ''" type="text"
                   placeholder="ex : APAVE, SOCOTEC, Bureau Veritas…"
                   @input="e => patchInspectionDebounced(ins, { last_inspection_inspector: e.target.value || null })"
                   class="input-base text-sm py-1.5" />
          </div>
          <div>
            <label class="block text-[11px] text-gray-600 mb-1">Prochaine échéance prévue</label>
            <input :value="ins.next_inspection_due_date || ''" type="date"
                   @input="e => patchInspectionDebounced(ins, { next_inspection_due_date: e.target.value || null })"
                   class="input-base text-sm py-1.5" />
          </div>
          <div>
            <label class="block text-[11px] text-gray-600 mb-1">À conserver jusqu'au</label>
            <input :value="ins.retained_until_date || ''" type="date"
                   @input="e => patchInspectionDebounced(ins, { retained_until_date: e.target.value || null })"
                   class="input-base text-sm py-1.5" />
          </div>
          <div class="col-span-2">
            <label class="block text-[11px] text-gray-600 mb-1">Anomalies identifiées</label>
            <textarea :value="ins.last_inspection_anomalies_html || ''" rows="2"
                      @input="e => patchInspectionDebounced(ins, { last_inspection_anomalies_html: e.target.value || null })"
                      class="input-base text-xs py-1.5"></textarea>
          </div>
          <div class="col-span-2">
            <label class="block text-[11px] text-gray-600 mb-1">Recommandations à reprendre</label>
            <textarea :value="ins.last_inspection_recommendations_html || ''" rows="2"
                      @input="e => patchInspectionDebounced(ins, { last_inspection_recommendations_html: e.target.value || null })"
                      class="input-base text-xs py-1.5"></textarea>
          </div>
          <div class="col-span-2">
            <label class="block text-[11px] text-gray-600 mb-1">Notes</label>
            <input :value="ins.notes || ''" type="text"
                   @input="e => patchInspectionDebounced(ins, { notes: e.target.value || null })"
                   class="input-base text-xs py-1.5" />
          </div>
        </div>
        <div class="mt-2 flex items-center gap-2">
          <span v-if="ins.next_inspection_due_date && ins.next_inspection_due_date < todayIso"
                class="pill bg-red-50 text-red-700 border border-red-200">
            ⚠ Échéance dépassée
          </span>
          <button @click="removeInspection(ins)"
                  class="ml-auto text-[11px] text-red-600 hover:text-red-800">
            Supprimer
          </button>
        </div>
      </div>
      <button @click="addInspection" class="btn-add">
        <PlusIcon class="w-4 h-4 shrink-0" /> Ajouter une inspection
      </button>
    </div>
  </CollapsibleSection>
</template>
