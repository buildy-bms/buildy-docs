<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
/**
 * Sous-page mobile pour les inspections périodiques R175-5-1 (rapport
 * conservé 10 ans). Vague 3 item 11 de l'audit BACS.
 *
 * Réplique fonctionnel de InspectionsSection desktop, optimisée tactile :
 * - MobileSheet plein écran (slide-up).
 * - Inputs date / texte 16px anti-zoom iOS, padding généreux.
 * - Auto-save 500 ms (Object.assign optimistic + PATCH debounce).
 * - Tags d'alerte « ⚠ Échéance dépassée » sur les inspections passées.
 *
 * Ouverte depuis MobileBmsTab (l'inspection est aussi liée à la GTB
 * réglementaire). Pas dans la bottom nav pour ne pas surcharger
 * (déjà 7 onglets).
 */
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import MobileSheet from './MobileSheet.vue'
import MobileField from './MobileField.vue'

defineProps({
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

const audit = useAuditStore()
const { inspections, todayIso } = storeToRefs(audit)
const { error } = useNotification()
const { confirm } = useConfirm()

const adding = ref(false)
async function addInspection() {
  if (adding.value) return
  adding.value = true
  try { await audit.addInspection() }
  catch (e) { error(e.response?.data?.detail || 'Création de l\'inspection impossible') }
  finally { adding.value = false }
}

// Auto-save 500 ms par champ (optimistic)
const timers = new Map()
function patchDebounced(ins, patch) {
  Object.assign(ins, patch)
  clearTimeout(timers.get(ins.id))
  timers.set(ins.id, setTimeout(async () => {
    try { await audit.patchInspection(ins, patch) }
    catch (e) { error(e.response?.data?.detail || 'Sauvegarde inspection impossible') }
  }, 500))
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
          Le rapport doit être conservé <strong>10 ans</strong>. L'audit Buildy est interne et
          ne se substitue pas à cette obligation.
        </p>
      </div>

      <!-- Bouton + ajouter -->
      <button
        type="button"
        @click="addInspection"
        :disabled="adding"
        class="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-base font-medium text-white bg-emerald-600 active:bg-emerald-700 rounded-xl disabled:opacity-50"
      >
        <FontAwesomeIcon :icon="['fas', 'plus']" class="w-5 h-5 shrink-0" />
        {{ adding ? 'Ajout…' : 'Ajouter une inspection' }}
      </button>

      <!-- Liste des inspections -->
      <div v-if="inspections.length" class="space-y-3">
        <div
          v-for="ins in inspections"
          :key="ins.id"
          class="bg-white rounded-2xl border border-gray-200 p-4 space-y-3"
        >
          <div class="flex items-center gap-2 justify-between">
            <span class="inline-flex items-center gap-1 text-xs text-gray-500">
              <FontAwesomeIcon :icon="['fas', 'clock']" class="w-3.5 h-3.5" />
              Inspection #{{ ins.id }}
            </span>
            <span
              v-if="ins.next_inspection_due_date && ins.next_inspection_due_date < todayIso"
              class="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-red-100 text-red-700 border border-red-200"
            >
              ⚠ Échéance dépassée
            </span>
          </div>

          <MobileField label="Date de l'inspection">
            <input
              :value="ins.last_inspection_date || ''"
              type="date"
              @input="e => patchDebounced(ins, { last_inspection_date: e.target.value || null })"
              class="touch-control w-full"
            />
          </MobileField>

          <MobileField label="Tiers inspecteur (nom / société)">
            <input
              :value="ins.last_inspection_inspector || ''"
              type="text"
              autocapitalize="words"
              placeholder="ex : APAVE, SOCOTEC, Bureau Veritas…"
              @input="e => patchDebounced(ins, { last_inspection_inspector: e.target.value || null })"
              class="touch-control w-full"
            />
          </MobileField>

          <div class="grid grid-cols-2 gap-3">
            <MobileField label="Prochaine échéance">
              <input
                :value="ins.next_inspection_due_date || ''"
                type="date"
                @input="e => patchDebounced(ins, { next_inspection_due_date: e.target.value || null })"
                class="touch-control w-full"
              />
            </MobileField>
            <MobileField label="Conserver jusqu'au">
              <input
                :value="ins.retained_until_date || ''"
                type="date"
                @input="e => patchDebounced(ins, { retained_until_date: e.target.value || null })"
                class="touch-control w-full"
              />
            </MobileField>
          </div>

          <MobileField label="Anomalies identifiées">
            <textarea
              :value="ins.last_inspection_anomalies_html || ''"
              rows="3"
              placeholder="ex : sonde extérieure défectueuse, défaut de programmation V3V…"
              @input="e => patchDebounced(ins, { last_inspection_anomalies_html: e.target.value || null })"
              class="touch-control w-full resize-y"
            ></textarea>
          </MobileField>

          <MobileField label="Recommandations à reprendre">
            <textarea
              :value="ins.last_inspection_recommendations_html || ''"
              rows="3"
              placeholder="ex : remplacer la pompe primaire, recalibrer les vannes 3V…"
              @input="e => patchDebounced(ins, { last_inspection_recommendations_html: e.target.value || null })"
              class="touch-control w-full resize-y"
            ></textarea>
          </MobileField>

          <MobileField label="Notes libres">
            <input
              :value="ins.notes || ''"
              type="text"
              placeholder="ex : N° de rapport, contact référent…"
              @input="e => patchDebounced(ins, { notes: e.target.value || null })"
              class="touch-control w-full"
            />
          </MobileField>

          <button
            type="button"
            @click="removeInspection(ins)"
            class="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium text-red-700 bg-red-50 active:bg-red-100 rounded-xl"
          >
            <FontAwesomeIcon :icon="['fas', 'trash']" class="w-4 h-4 shrink-0" />
            Supprimer cette inspection
          </button>
        </div>
      </div>
      <div v-else class="bg-white rounded-2xl border border-dashed border-gray-300 p-6 text-center">
        <FontAwesomeIcon :icon="['fas', 'clock']" class="w-10 h-10 text-gray-300 mx-auto" />
        <p class="text-sm font-medium text-gray-700 mt-3">Aucune inspection tracée</p>
        <p class="text-xs text-gray-500 mt-1">Une action corrective est générée automatiquement tant qu'aucune inspection R175-5-1 n'est documentée.</p>
      </div>

      <p class="text-xs text-gray-400 text-center pt-2">
        Sauvegarde automatique. Tu peux fermer cette page à tout moment.
      </p>
    </div>
  </MobileSheet>
</template>
