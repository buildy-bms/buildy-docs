<script setup>
import { computed } from 'vue'
import { ClockIcon, PlusIcon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import {
  getBacsInspections, createBacsInspection, updateBacsInspection, deleteBacsInspection,
  getBacsActionItems,
} from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'

// Section "Inspection périodique par un tiers" (R175-5-1) du wizard
// d'audit BACS. Trace les inspections officielles réalisées par un
// organisme indépendant (rapport conservé 10 ans).
//
// L'état est local à ce composant : il appelle directement l'API et
// notifie le parent via @action-items-changed quand le plan d'actions
// correctives doit être rafraîchi (échéance dépassée → action auto).
const props = defineProps({
  documentId: { type: Number, required: true },
  inspections: { type: Array, required: true },
  todayIso: { type: String, required: true },
})
const emit = defineEmits(['refresh-inspections', 'action-items-changed'])
const { error } = useNotification()
const { confirm } = useConfirm()

const latestInspection = computed(() => props.inspections[0] || null)

async function addInspection() {
  try {
    await createBacsInspection(props.documentId, {})
    emit('refresh-inspections')
    emit('action-items-changed')
  } catch {
    error('Création de l\'inspection impossible')
  }
}

const timers = new Map()
function patchInspectionDebounced(ins, patch) {
  Object.assign(ins, patch)
  clearTimeout(timers.get(ins.id))
  timers.set(ins.id, setTimeout(async () => {
    try {
      await updateBacsInspection(ins.id, patch)
      emit('action-items-changed')
    } catch {
      error('Sauvegarde inspection impossible')
    }
  }, 500))
}

async function removeInspection(ins) {
  const ok = await confirm({
    title: 'Supprimer cette inspection ?',
    message: 'L\'historique de cette inspection périodique sera perdu.',
    confirmLabel: 'Supprimer',
  })
  if (!ok) return
  try {
    await deleteBacsInspection(ins.id)
    emit('refresh-inspections')
    emit('action-items-changed')
  } catch {
    error('Suppression impossible')
  }
}
</script>

<template>
  <CollapsibleSection storage-key="inspections" section-id="section-inspections">
    <template #header>
      <ClockIcon class="w-5 h-5 text-amber-600" />
      <h2 class="text-base font-semibold text-gray-800">7. Inspection périodique par un tiers</h2>
      <span class="text-xs text-gray-500">R175-5-1 — rapport conservé 10 ans</span>
      <R175Tooltip article="R175-5-1" />
      <button @click.stop="addInspection"
              class="ml-auto inline-flex items-center gap-1 px-2.5 py-1 text-xs text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">
        <PlusIcon class="w-3.5 h-3.5" /> Ajouter
      </button>
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
                   class="w-full text-sm px-2 py-1.5 border border-gray-200 rounded" />
          </div>
          <div>
            <label class="block text-[11px] text-gray-600 mb-1">Tiers inspecteur (nom / société)</label>
            <input :value="ins.last_inspection_inspector || ''" type="text"
                   placeholder="ex : APAVE, SOCOTEC, Bureau Veritas…"
                   @input="e => patchInspectionDebounced(ins, { last_inspection_inspector: e.target.value || null })"
                   class="w-full text-sm px-2 py-1.5 border border-gray-200 rounded" />
          </div>
          <div>
            <label class="block text-[11px] text-gray-600 mb-1">Prochaine échéance prévue</label>
            <input :value="ins.next_inspection_due_date || ''" type="date"
                   @input="e => patchInspectionDebounced(ins, { next_inspection_due_date: e.target.value || null })"
                   class="w-full text-sm px-2 py-1.5 border border-gray-200 rounded" />
          </div>
          <div>
            <label class="block text-[11px] text-gray-600 mb-1">À conserver jusqu'au</label>
            <input :value="ins.retained_until_date || ''" type="date"
                   @input="e => patchInspectionDebounced(ins, { retained_until_date: e.target.value || null })"
                   class="w-full text-sm px-2 py-1.5 border border-gray-200 rounded" />
          </div>
          <div class="col-span-2">
            <label class="block text-[11px] text-gray-600 mb-1">Anomalies identifiées</label>
            <textarea :value="ins.last_inspection_anomalies_html || ''" rows="2"
                      @input="e => patchInspectionDebounced(ins, { last_inspection_anomalies_html: e.target.value || null })"
                      class="w-full text-xs px-2 py-1.5 border border-gray-200 rounded"></textarea>
          </div>
          <div class="col-span-2">
            <label class="block text-[11px] text-gray-600 mb-1">Recommandations à reprendre</label>
            <textarea :value="ins.last_inspection_recommendations_html || ''" rows="2"
                      @input="e => patchInspectionDebounced(ins, { last_inspection_recommendations_html: e.target.value || null })"
                      class="w-full text-xs px-2 py-1.5 border border-gray-200 rounded"></textarea>
          </div>
          <div class="col-span-2">
            <label class="block text-[11px] text-gray-600 mb-1">Notes</label>
            <input :value="ins.notes || ''" type="text"
                   @input="e => patchInspectionDebounced(ins, { notes: e.target.value || null })"
                   class="w-full text-xs px-2 py-1.5 border border-gray-200 rounded" />
          </div>
        </div>
        <div class="mt-2 flex items-center gap-2">
          <span v-if="ins.next_inspection_due_date && ins.next_inspection_due_date < todayIso"
                class="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-0.5">
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
