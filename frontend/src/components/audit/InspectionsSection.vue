<script setup>
import { storeToRefs } from 'pinia'
import { ClockIcon, PlusIcon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'

// Section "Inspection périodique par un tiers" (R175-5-1) — utilise
// directement le store Pinia useAuditStore, plus de props nécessaires.
defineProps({
  step: { type: Object, default: null },
  active: { type: Boolean, default: false },
})
const emit = defineEmits(['validate-step', 'invalidate-step'])
const audit = useAuditStore()
const { inspections, latestInspection, todayIso } = storeToRefs(audit)
const { error } = useNotification()
const { confirm } = useConfirm()

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
      <SectionHeader number="7" title="Inspection périodique par un tiers"
                     subtitle="R175-5-1 — rapport conservé 10 ans"
                     :icon="ClockIcon" icon-color="text-amber-600"
                     :step="step"
                     @validate="emit('validate-step', $event)"
                     @invalidate="emit('invalidate-step', $event)">
        <template #subtitle-extra><R175Tooltip article="R175-5-1" /></template>
        <template #actions>
          <button @click.stop="addInspection" class="btn-primary text-xs px-2.5 py-1">
            <PlusIcon class="w-3.5 h-3.5" /> Ajouter
          </button>
        </template>
      </SectionHeader>
    </template>
    <template #summary>
      <span v-if="inspections.length">
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
      <p v-if="!inspections.length" class="text-xs text-gray-500 italic">
        Trace ici les inspections officielles réalisées par un tiers (organisme indépendant). L'audit Buildy est interne et ne se substitue pas à cette obligation.
      </p>
      <div v-for="ins in inspections" :key="ins.id" class="border border-gray-200 rounded-lg p-3">
        <div class="grid grid-cols-2 gap-3">
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
    </div>
  </CollapsibleSection>
</template>
