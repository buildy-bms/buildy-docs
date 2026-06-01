<script setup>
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { ClockIcon, PlusIcon, ChevronDownIcon, TrashIcon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import SegmentedToggle from '@/components/audit/SegmentedToggle.vue'
import InspectionReportDrop from '@/components/audit/InspectionReportDrop.vue'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import { addYearsIso, todayIso as todayIsoLocal } from '@/lib/date-helpers'

// Section "Inspection périodique par un tiers" (R175-5-1).
// Refonte compacte : chaque inspection = ligne accordéon. Pré-calc auto
// des échéances dès qu'on saisit la date d'inspection (5 ans pour la
// prochaine, 10 ans pour la conservation du rapport).
defineProps({
  step: { type: Object, default: null },
  active: { type: Boolean, default: false },
})
const emit = defineEmits(['validate-step', 'invalidate-step', 'save-doc'])
const audit = useAuditStore()
const { inspections, latestInspection, todayIso, document } = storeToRefs(audit)
const { error } = useNotification()
const { confirm } = useConfirm()

// État d'ouverture local par inspection (Set d'ids).
const openIds = ref(new Set())

// Auto-expand quand 1 seule inspection : confort de saisie.
watch(inspections, (list) => {
  if (list?.length === 1) openIds.value.add(list[0].id)
}, { immediate: true })

function isOpen(id) { return openIds.value.has(id) }
function toggleOpen(id) {
  const s = new Set(openIds.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  openIds.value = s
}

// Mig 187 — toggle « Aucune inspection à déclarer ».
const notApplicable = computed(() => {
  const v = document.value?.inspection_not_applicable
  return v === 1 || v === true
})
function setNotApplicable(v) {
  const payload = { inspection_not_applicable: v === true }
  if (v !== true) payload.inspection_not_applicable_reason = null
  emit('save-doc', payload)
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
  try {
    await audit.addInspection()
    // La dernière inspection ajoutée s'ouvre automatiquement.
    const last = inspections.value[0] // tri DESC en backend
    if (last) openIds.value.add(last.id)
  }
  catch { error('Création de l\'inspection impossible') }
}

const timers = new Map()
function patchInspectionDebounced(ins, patch) {
  // Pré-calc R175-5-1 : si on saisit la date d'inspection, pré-remplir
  // automatiquement les échéances vides (5 ans pour la suivante, 10 ans
  // pour la conservation). L'utilisateur peut écraser ensuite.
  if (Object.prototype.hasOwnProperty.call(patch, 'last_inspection_date') && patch.last_inspection_date) {
    if (!ins.next_inspection_due_date) {
      patch.next_inspection_due_date = addYearsIso(patch.last_inspection_date, 5)
    }
    if (!ins.retained_until_date) {
      patch.retained_until_date = addYearsIso(patch.last_inspection_date, 10)
    }
  }
  Object.assign(ins, patch)
  clearTimeout(timers.get(ins.id))
  timers.set(ins.id, setTimeout(async () => {
    try { await audit.patchInspection(ins, patch) }
    catch { error('Sauvegarde inspection impossible') }
  }, 500))
}

function setToday(ins) {
  patchInspectionDebounced(ins, { last_inspection_date: todayIsoLocal() })
}
function setPlusYears(ins, field, years) {
  const base = ins.last_inspection_date || todayIsoLocal()
  patchInspectionDebounced(ins, { [field]: addYearsIso(base, years) })
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

function fmtDate(iso) {
  if (!iso) return null
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function statusFor(ins) {
  if (!ins.next_inspection_due_date) return null
  if (ins.next_inspection_due_date < todayIso.value) {
    return { tone: 'red', label: 'Échéance dépassée' }
  }
  const inSixMonths = new Date()
  inSixMonths.setMonth(inSixMonths.getMonth() + 6)
  const sixIso = inSixMonths.toISOString().slice(0, 10)
  if (ins.next_inspection_due_date < sixIso) {
    return { tone: 'amber', label: 'Échéance < 6 mois' }
  }
  return { tone: 'emerald', label: 'À jour' }
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
          · dernière : {{ fmtDate(latestInspection.last_inspection_date) || '—' }}
          <span v-if="latestInspection.next_inspection_due_date">
            · prochaine : {{ fmtDate(latestInspection.next_inspection_due_date) }}
          </span>
        </span>
      </span>
      <span v-else class="italic text-amber-700">Aucune inspection R175-5-1 tracée — action corrective générée</span>
    </template>
    <div class="px-5 py-4 space-y-3">
      <!-- Toggle factuel : « Y a-t-il une inspection à tracer ? »
           Oui = à tracer (état par défaut, action corrective si rien tracé).
           Non = rien à tracer (bypass + raison optionnelle au PDF).
           Volontairement sans référence au statut réglementaire R175-5-1
           — l'auditeur n'a pas toujours l'info pour le déterminer. -->
      <div class="rounded-lg border border-gray-200 bg-gray-50/50 px-3 py-2.5 flex items-start justify-between gap-3">
        <div class="text-xs text-gray-700 leading-snug">
          <div class="font-medium text-gray-800">Y a-t-il une inspection officielle à tracer pour ce site ?</div>
          <div class="text-gray-500 mt-0.5">Réponds Non si rien n'est à tracer (aucune inspection passée connue, ou site non concerné par R175-5-1). Cela débloque la validation de la card sans générer d'action corrective.</div>
        </div>
        <SegmentedToggle :model-value="notApplicable === true ? false : (notApplicable === false ? true : null)"
                         :options="[{ value: true, label: 'Oui', tone: 'green' }, { value: false, label: 'Non', tone: 'slate' }]"
                         @update:model-value="v => setNotApplicable(v === false)" />
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

      <!-- Liste compacte des inspections : 1 ligne d'accroche + détails repliables -->
      <div v-for="ins in inspections" :key="ins.id" class="border border-gray-200 rounded-lg overflow-hidden">
        <button type="button" @click="toggleOpen(ins.id)"
                class="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 transition">
          <ClockIcon class="w-4 h-4 text-amber-600 shrink-0" />
          <span class="text-sm font-medium text-gray-900">
            {{ fmtDate(ins.last_inspection_date) || 'Date à renseigner' }}
          </span>
          <span class="text-xs text-gray-500 truncate">
            {{ ins.last_inspection_inspector || '—' }}
          </span>
          <div class="ml-auto flex items-center gap-2 shrink-0">
            <span v-if="ins.next_inspection_due_date" class="text-xs text-gray-500">
              → {{ fmtDate(ins.next_inspection_due_date) }}
            </span>
            <span v-if="statusFor(ins)"
                  :class="[
                    'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border',
                    statusFor(ins).tone === 'red' && 'bg-red-50 text-red-700 border-red-200',
                    statusFor(ins).tone === 'amber' && 'bg-amber-50 text-amber-700 border-amber-200',
                    statusFor(ins).tone === 'emerald' && 'bg-emerald-50 text-emerald-700 border-emerald-200',
                  ]">
              {{ statusFor(ins).label }}
            </span>
            <ChevronDownIcon class="w-4 h-4 text-gray-400 transition-transform"
                             :class="isOpen(ins.id) && 'rotate-180'" />
          </div>
        </button>

        <div v-if="isOpen(ins.id)" class="border-t border-gray-200 px-3 py-3 space-y-3 bg-gray-50/30">
          <!-- 4 champs courts en grille compacte -->
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label class="text-[11px] text-gray-600 mb-1 flex items-center justify-between gap-2">
                <span>Date de l'inspection</span>
                <button type="button" @click="setToday(ins)"
                        class="text-[10px] text-indigo-600 hover:text-indigo-800 whitespace-nowrap">
                  Aujourd'hui
                </button>
              </label>
              <input :value="ins.last_inspection_date || ''" type="date"
                     @input="e => patchInspectionDebounced(ins, { last_inspection_date: e.target.value || null })"
                     class="input-base text-sm py-1.5 w-full" />
            </div>
            <div>
              <label class="block text-[11px] text-gray-600 mb-1">Tiers inspecteur</label>
              <input :value="ins.last_inspection_inspector || ''" type="text"
                     placeholder="APAVE, SOCOTEC, Bureau Veritas…"
                     @input="e => patchInspectionDebounced(ins, { last_inspection_inspector: e.target.value || null })"
                     class="input-base text-sm py-1.5 w-full" />
            </div>
            <div>
              <label class="text-[11px] text-gray-600 mb-1 flex items-center justify-between gap-2">
                <span>Prochaine échéance</span>
                <button type="button" @click="setPlusYears(ins, 'next_inspection_due_date', 5)"
                        class="text-[10px] text-indigo-600 hover:text-indigo-800 whitespace-nowrap">
                  +5 ans
                </button>
              </label>
              <input :value="ins.next_inspection_due_date || ''" type="date"
                     @input="e => patchInspectionDebounced(ins, { next_inspection_due_date: e.target.value || null })"
                     class="input-base text-sm py-1.5 w-full" />
            </div>
            <div>
              <label class="text-[11px] text-gray-600 mb-1 flex items-center justify-between gap-2">
                <span>Conserver jusqu'au</span>
                <button type="button" @click="setPlusYears(ins, 'retained_until_date', 10)"
                        class="text-[10px] text-indigo-600 hover:text-indigo-800 whitespace-nowrap">
                  +10 ans
                </button>
              </label>
              <input :value="ins.retained_until_date || ''" type="date"
                     @input="e => patchInspectionDebounced(ins, { retained_until_date: e.target.value || null })"
                     class="input-base text-sm py-1.5 w-full" />
            </div>
          </div>

          <!-- Champs longs : anomalies + recommandations côte à côte -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div>
              <label class="block text-[11px] text-gray-600 mb-1">Anomalies identifiées</label>
              <textarea :value="ins.last_inspection_anomalies_html || ''" rows="2"
                        placeholder="ex : sonde extérieure défectueuse, défaut de programmation V3V…"
                        @input="e => patchInspectionDebounced(ins, { last_inspection_anomalies_html: e.target.value || null })"
                        class="input-base text-xs py-1.5 w-full resize-y"></textarea>
            </div>
            <div>
              <label class="block text-[11px] text-gray-600 mb-1">Recommandations à reprendre</label>
              <textarea :value="ins.last_inspection_recommendations_html || ''" rows="2"
                        placeholder="ex : remplacer la pompe primaire, recalibrer les vannes 3V…"
                        @input="e => patchInspectionDebounced(ins, { last_inspection_recommendations_html: e.target.value || null })"
                        class="input-base text-xs py-1.5 w-full resize-y"></textarea>
            </div>
          </div>

          <!-- Rapport PDF (uniquement si l'inspection a déjà une date renseignée :
               on évite d'inciter à uploader avant que l'inspection ne soit traçable). -->
          <InspectionReportDrop v-if="ins.last_inspection_date" :inspection-id="ins.id" />

          <div class="flex items-end gap-3">
            <div class="flex-1">
              <label class="block text-[11px] text-gray-600 mb-1">Notes (n° de rapport, contact…)</label>
              <input :value="ins.notes || ''" type="text"
                     @input="e => patchInspectionDebounced(ins, { notes: e.target.value || null })"
                     class="input-base text-xs py-1.5 w-full" />
            </div>
            <button type="button" @click="removeInspection(ins)"
                    class="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md transition shrink-0">
              <TrashIcon class="w-3.5 h-3.5 shrink-0" />
              Supprimer
            </button>
          </div>
        </div>
      </div>

      <button @click="addInspection" class="btn-add">
        <PlusIcon class="w-4 h-4 shrink-0" /> Ajouter une inspection
      </button>
    </div>
  </CollapsibleSection>
</template>
