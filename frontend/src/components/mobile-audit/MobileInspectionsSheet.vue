<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
/**
 * Sous-page mobile pour les inspections périodiques R175-5-1.
 *
 * Refonte compacte alignée sur InspectionsSection desktop :
 * - Liste accordéon (1 ligne par inspection, détails repliables).
 * - Auto-pré-calc des échéances (5 ans / 10 ans) à la saisie de la date.
 * - Boutons rapides « Aujourd'hui », « +5 ans », « +10 ans ».
 * - Pill statut (à jour / < 6 mois / dépassée) sur la ligne d'accroche.
 */
import { ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import { addYearsIso, todayIso as todayIsoLocal } from '@/lib/date-helpers'
import MobileSheet from './MobileSheet.vue'
import MobileField from './MobileField.vue'
import InspectionReportDrop from '@/components/audit/InspectionReportDrop.vue'

defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

const audit = useAuditStore()
const { inspections, todayIso } = storeToRefs(audit)
const { error } = useNotification()
const { confirm } = useConfirm()

const openIds = ref(new Set())
watch(inspections, (list) => {
  if (list?.length === 1) openIds.value.add(list[0].id)
}, { immediate: true })
function isOpen(id) { return openIds.value.has(id) }
function toggleOpen(id) {
  const s = new Set(openIds.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  openIds.value = s
}

const adding = ref(false)
async function addInspection() {
  if (adding.value) return
  adding.value = true
  try {
    await audit.addInspection()
    const last = inspections.value[0]
    if (last) openIds.value.add(last.id)
  }
  catch (e) { error(e.response?.data?.detail || 'Création de l\'inspection impossible') }
  finally { adding.value = false }
}

const timers = new Map()
function patchDebounced(ins, patch) {
  // Pré-calc R175-5-1 : si on saisit la date d'inspection, pré-remplir
  // les échéances vides (5 ans suivante, 10 ans conservation).
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
    catch (e) { error(e.response?.data?.detail || 'Sauvegarde inspection impossible') }
  }, 500))
}

function setToday(ins) {
  patchDebounced(ins, { last_inspection_date: todayIsoLocal() })
}
function setPlusYears(ins, field, years) {
  const base = ins.last_inspection_date || todayIsoLocal()
  patchDebounced(ins, { [field]: addYearsIso(base, years) })
}

async function removeInspection(ins) {
  const ok = await confirm({
    title: 'Supprimer cette inspection ?',
    message: 'L\'historique de cette inspection périodique sera perdu.',
    confirmLabel: 'Supprimer',
    danger: true,
  })
  if (!ok) return
  try { await audit.removeInspection(ins.id) }
  catch (e) { error(e.response?.data?.detail || 'Suppression impossible') }
}

function fmtDate(iso) {
  if (!iso) return null
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function statusFor(ins) {
  if (!ins.next_inspection_due_date) return null
  if (ins.next_inspection_due_date < todayIso.value) {
    return { tone: 'red', label: 'Dépassée' }
  }
  const inSixMonths = new Date()
  inSixMonths.setMonth(inSixMonths.getMonth() + 6)
  const sixIso = inSixMonths.toISOString().slice(0, 10)
  if (ins.next_inspection_due_date < sixIso) {
    return { tone: 'amber', label: '< 6 mois' }
  }
  return { tone: 'emerald', label: 'À jour' }
}
</script>

<template>
  <MobileSheet
    :open="open"
    title="Inspections périodiques R175-5-1"
    hide-save
    @close="emit('close')"
  >
    <div class="p-4 space-y-3">
      <!-- Aide contextuelle R175-5-1 -->
      <div class="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <p class="text-xs font-semibold text-amber-800 uppercase tracking-wider mb-1">
          R175-5-1
        </p>
        <p class="text-sm text-amber-900 leading-relaxed">
          Trace ici les inspections officielles réalisées par un tiers (organisme indépendant).
          Rapport conservé <strong>10 ans</strong> (R175-5-1). Le décret n'impose pas de
          périodicité explicite ; Buildy propose <strong>+5 ans</strong> par défaut — à ajuster
          selon votre planning. L'audit Buildy est interne et ne se substitue pas à cette obligation.
        </p>
      </div>

      <!-- Liste compacte -->
      <div v-if="inspections.length" class="space-y-2">
        <div
          v-for="ins in inspections"
          :key="ins.id"
          class="bg-white rounded-2xl border border-gray-200 overflow-hidden"
        >
          <button
            type="button"
            @click="toggleOpen(ins.id)"
            class="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-gray-50 transition"
          >
            <FontAwesomeIcon :icon="['fas', 'clock']" class="w-4 h-4 text-amber-600 shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-gray-900 truncate">
                {{ fmtDate(ins.last_inspection_date) || 'Date à renseigner' }}
              </div>
              <div class="text-xs text-gray-500 truncate">
                {{ ins.last_inspection_inspector || '—' }}
                <span v-if="ins.next_inspection_due_date" class="ml-1">
                  · → {{ fmtDate(ins.next_inspection_due_date) }}
                </span>
              </div>
            </div>
            <span v-if="statusFor(ins)"
                  :class="[
                    'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border shrink-0',
                    statusFor(ins).tone === 'red' && 'bg-red-50 text-red-700 border-red-200',
                    statusFor(ins).tone === 'amber' && 'bg-amber-50 text-amber-700 border-amber-200',
                    statusFor(ins).tone === 'emerald' && 'bg-emerald-50 text-emerald-700 border-emerald-200',
                  ]">
              {{ statusFor(ins).label }}
            </span>
            <FontAwesomeIcon :icon="['fas', 'chevron-down']"
                             class="w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform"
                             :class="isOpen(ins.id) && 'rotate-180'" />
          </button>

          <div v-if="isOpen(ins.id)" class="border-t border-gray-200 px-4 py-4 space-y-3 bg-gray-50/30">
            <MobileField label="Date de l'inspection">
              <div class="flex items-center gap-2">
                <input
                  :value="ins.last_inspection_date || ''"
                  type="date"
                  @input="e => patchDebounced(ins, { last_inspection_date: e.target.value || null })"
                  class="pwa-input flex-1"
                />
                <button type="button" @click="setToday(ins)"
                        class="px-3 min-h-12 text-xs font-medium text-indigo-700 bg-indigo-50 active:bg-indigo-100 rounded-lg whitespace-nowrap shrink-0">
                  Aujourd'hui
                </button>
              </div>
            </MobileField>

            <MobileField label="Tiers inspecteur (nom / société)">
              <input
                :value="ins.last_inspection_inspector || ''"
                type="text"
                autocapitalize="words"
                placeholder="APAVE, SOCOTEC, Bureau Veritas…"
                @input="e => patchDebounced(ins, { last_inspection_inspector: e.target.value || null })"
                class="pwa-input w-full"
              />
            </MobileField>

            <MobileField label="Prochaine échéance">
              <div class="flex items-center gap-2">
                <input
                  :value="ins.next_inspection_due_date || ''"
                  type="date"
                  @input="e => patchDebounced(ins, { next_inspection_due_date: e.target.value || null })"
                  class="pwa-input flex-1"
                />
                <button type="button" @click="setPlusYears(ins, 'next_inspection_due_date', 5)"
                        class="px-3 min-h-12 text-xs font-medium text-indigo-700 bg-indigo-50 active:bg-indigo-100 rounded-lg whitespace-nowrap shrink-0">
                  +5 ans
                </button>
              </div>
            </MobileField>

            <MobileField label="Conserver jusqu'au">
              <div class="flex items-center gap-2">
                <input
                  :value="ins.retained_until_date || ''"
                  type="date"
                  @input="e => patchDebounced(ins, { retained_until_date: e.target.value || null })"
                  class="pwa-input flex-1"
                />
                <button type="button" @click="setPlusYears(ins, 'retained_until_date', 10)"
                        class="px-3 min-h-12 text-xs font-medium text-indigo-700 bg-indigo-50 active:bg-indigo-100 rounded-lg whitespace-nowrap shrink-0">
                  +10 ans
                </button>
              </div>
            </MobileField>

            <MobileField label="Anomalies identifiées">
              <textarea
                :value="ins.last_inspection_anomalies_html || ''"
                rows="3"
                placeholder="ex : sonde extérieure défectueuse, défaut de programmation V3V…"
                @input="e => patchDebounced(ins, { last_inspection_anomalies_html: e.target.value || null })"
                class="pwa-input w-full resize-y"
              ></textarea>
            </MobileField>

            <MobileField label="Recommandations à reprendre">
              <textarea
                :value="ins.last_inspection_recommendations_html || ''"
                rows="3"
                placeholder="ex : remplacer la pompe primaire, recalibrer les vannes 3V…"
                @input="e => patchDebounced(ins, { last_inspection_recommendations_html: e.target.value || null })"
                class="pwa-input w-full resize-y"
              ></textarea>
            </MobileField>

            <!-- Rapport PDF (disponible dès qu'une date d'inspection est saisie) -->
            <InspectionReportDrop v-if="ins.last_inspection_date" :inspection-id="ins.id" />

            <MobileField label="Notes libres">
              <input
                :value="ins.notes || ''"
                type="text"
                placeholder="ex : N° de rapport, contact référent…"
                @input="e => patchDebounced(ins, { notes: e.target.value || null })"
                class="pwa-input w-full"
              />
            </MobileField>

            <button
              type="button"
              @click="removeInspection(ins)"
              class="w-full inline-flex items-center justify-center gap-1.5 min-h-12 px-3 text-sm font-medium text-red-700 bg-red-50 active:bg-red-100 rounded-xl"
            >
              <FontAwesomeIcon :icon="['fas', 'trash']" class="w-4 h-4 shrink-0" />
              Supprimer cette inspection
            </button>
          </div>
        </div>
      </div>
      <div v-else class="bg-white rounded-2xl border border-dashed border-gray-300 p-6 text-center">
        <FontAwesomeIcon :icon="['fas', 'clock']" class="w-10 h-10 text-gray-300 mx-auto" />
        <p class="text-sm font-medium text-gray-700 mt-3">Aucune inspection tracée</p>
        <p class="text-xs text-gray-500 mt-1">Une action corrective est générée automatiquement tant qu'aucune inspection R175-5-1 n'est documentée.</p>
      </div>

      <button
        type="button"
        @click="addInspection"
        :disabled="adding"
        class="pwa-button pwa-button--add mt-2 disabled:opacity-50"
      >
        <FontAwesomeIcon :icon="['fas', 'plus']" class="w-5 h-5 shrink-0" />
        {{ adding ? 'Ajout…' : 'Ajouter une inspection' }}
      </button>

      <p class="text-xs text-gray-500 text-center pt-2">
        Sauvegarde automatique. Tu peux fermer cette page à tout moment.
      </p>
    </div>
  </MobileSheet>
</template>
