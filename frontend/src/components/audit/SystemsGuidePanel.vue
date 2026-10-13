<script setup>
/**
 * Fiche d'un équipement (étape Systèmes, mise en page guidée), à droite de la liste. Mêmes
 * actions que la fiche de la mise en page actuelle (précédent / suivant, agrandir, fermer, notes,
 * photos, notes vocales, déplacer ou partager, dupliquer, supprimer) et le même formulaire
 * complet (DeviceEditModal en panneau), avec en tête :
 *  - une carte par point « à vérifier » (explication en clair, valeurs saisies, quoi faire,
 *    correction automatique quand le pré-contrôle en propose une) ;
 *  - la ligne « À compléter » (ce qui manque encore) ;
 * et en pied le bouton « Suivant à reprendre », qui enchaîne les points de toute l'étape.
 */
import { ref, computed, watch } from 'vue'
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { faRoute, faWandMagicSparkles, faArrowRight } from '@fortawesome/free-solid-svg-icons'
import '@/lib/equipment-icons'
import Tooltip from '@/components/Tooltip.vue'
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import DeviceEditModal from '@/components/audit/DeviceEditModal.vue'
import DeviceMoveShare from '@/components/DeviceMoveShare.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import VoiceNoteButton from '@/components/VoiceNoteButton.vue'
import { useNotification } from '@/composables/useNotification'
import {
  checkText, checkRows, checkFixLabel, CHECK_FIX_TIP, nextStopLabel, nextStopTip,
  checkGoLabel, CHECK_RUBRIC, CHECK_GO_TIPS,
} from '@/lib/audit-tips-systems-guide'
import { ENERGY_OPTIONS } from '@/lib/audit-options'
import { requestAuditReveal } from '@/lib/audit-reveal'

library.add(faRoute, faWandMagicSparkles, faArrowRight)

const props = defineProps({
  device: { type: Object, required: true },
  system: { type: Object, required: true },
  systemLabel: { type: String, default: '' },
  zoneName: { type: String, default: '' },
  index: { type: Number, default: -1 },          // position dans la zone (0…)
  total: { type: Number, default: 0 },
  hasPrev: { type: Boolean, default: false },
  hasNext: { type: Boolean, default: false },
  checks: { type: Array, default: () => [] },    // points « à vérifier » de l'équipement
  missing: { type: Array, default: () => [] },   // deviceMissingFields (vide si complet)
  nextLabel: { type: String, default: '' },      // prochain point du parcours (vide : plus rien)
  siteUuid: { type: String, default: null },
  auditId: { type: [Number, String], default: null },
  systems: { type: Array, default: () => [] },   // tous les usages (déplacer ou partager)
  hasNotes: { type: Boolean, default: false },
  maxHeight: { type: String, default: '' },
})
const emit = defineEmits(['prev', 'next', 'close', 'notes', 'duplicate', 'remove', 'changed', 'next-stop', 'precheck'])
const { error: notifyError, success } = useNotification()

const expanded = ref(false)
watch(() => props.device.id, () => { expanded.value = false })

const deviceName = computed(() => props.device.name
  || [props.device.brand, props.device.model_reference].filter(Boolean).join(' ')
  || `Équipement #${props.device.id}`)
// Ligne de faits sous le nom (maquette piste D) : marque et référence, quantité, puissance,
// énergie, âge.
const facts = computed(() => {
  const d = props.device
  const ref = [d.brand, d.model_reference].filter(Boolean).join(' ')
  const power = d.power_kw_unknown ? 'puissance inconnue'
    : [d.power_kw, d.power_kw_cooling].filter(v => Number(v) > 0)
      .map(v => `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kW`).join(' / ')
  const energy = d.energy_source ? (ENERGY_OPTIONS.find(o => o.value === d.energy_source)?.label || d.energy_source) : ''
  return [ref && ref !== deviceName.value ? ref : '', (d.quantity || 1) > 1 ? `× ${d.quantity}` : '',
    power, energy, d.age_years != null ? `${d.age_years} ans` : ''].filter(Boolean)
})
// « Corriger dans … » : ouvre la rubrique de la fiche, ou l'étape GTB pour « Intégré à la GTB ».
const editRef = ref(null)
function goFix(f) {
  if (f.code === 'DEV-008') {
    requestAuditReveal({ kind: 'step', step: 'bms', selector: '#bms-block-integrated' })
    return
  }
  editRef.value?.openRubric(CHECK_RUBRIC[f.code] || 'identification')
}

// Correction automatique proposée par le pré-contrôle (DEV-003, DEV-006).
const fixing = ref(null)
async function autoFix(f) {
  if (!props.auditId || !f.auto_fix_action) return
  fixing.value = f.code
  try {
    const res = await fetch(`/api/bacs-audit/${props.auditId}/precheck/auto-fix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: f.auto_fix_action, entity_id: f.entity_id }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `HTTP ${res.status}`)
    }
    const out = await res.json()
    success('Point corrigé')
    emit('precheck', out.precheck)
    emit('changed')
  } catch (e) {
    notifyError(`Correction automatique impossible : ${e.message}`)
  } finally {
    fixing.value = null
  }
}
</script>

<template>
  <div class="bg-white rounded-xl ring-1 ring-slate-200 shadow-md overflow-hidden flex flex-col"
       :style="maxHeight ? { maxHeight } : null" data-guide-panel>
    <header class="px-4 pt-3 pb-2 border-b border-slate-100">
      <div class="flex items-center gap-2">
        <SystemCategoryIcon :category="system.system_category" size="xs" :with-tooltip="false" />
        <p class="min-w-0 flex-1 text-[11px] text-gray-500 truncate" v-tooltip.overflow>{{ zoneName }} › {{ systemLabel }}</p>
        <div class="flex items-center gap-1 shrink-0">
          <Tooltip :text="hasPrev ? 'Équipement précédent' : 'Premier équipement de la zone'">
            <button type="button" class="btn-icon" :disabled="!hasPrev" @click="emit('prev')">
              <FontAwesomeIcon :icon="['fas', 'chevron-left']" class="w-3 h-3" />
            </button>
          </Tooltip>
          <span v-if="index >= 0" class="text-[11px] text-gray-500 tabular-nums px-0.5"
                v-tooltip="`Équipement ${index + 1} sur ${total} dans cette zone`">{{ index + 1 }}/{{ total }}</span>
          <Tooltip :text="hasNext ? 'Équipement suivant' : 'Dernier équipement de la zone'">
            <button type="button" class="btn-icon" :disabled="!hasNext" @click="emit('next')">
              <FontAwesomeIcon :icon="['fas', 'chevron-right']" class="w-3 h-3" />
            </button>
          </Tooltip>
          <button type="button" class="btn-icon" @click="expanded = true" v-tooltip="'Agrandir la fiche'">
            <FontAwesomeIcon :icon="['fas', 'up-right-and-down-left-from-center']" class="w-3 h-3" />
          </button>
          <button type="button" class="btn-icon" @click="emit('close')" v-tooltip="'Fermer la fiche'">
            <FontAwesomeIcon :icon="['fas', 'xmark']" class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <h3 class="mt-1 text-[15px] font-semibold text-indigo-600 truncate" v-tooltip.overflow>{{ deviceName }}</h3>
      <p v-if="facts.length" class="mt-0.5 text-xs text-gray-600 truncate" v-tooltip.overflow>{{ facts.join(' · ') }}</p>
      <!-- Actions de l'équipement : les mêmes que dans la mise en page actuelle -->
      <div class="mt-2 flex items-center gap-1 flex-wrap">
        <button type="button" @click="emit('notes')"
                :class="['btn-icon', hasNotes && 'is-active']"
                v-tooltip="hasNotes ? 'Modifier les notes de l’équipement' : 'Ajouter une note à l’équipement'">
          <FontAwesomeIcon :icon="['fas', 'pen-to-square']" class="w-3.5 h-3.5" />
        </button>
        <BacsPhotoButton v-if="siteUuid" :key="`photo-${device.id}`" :site-uuid="siteUuid"
                         :attach-to="{ device_id: device.id, system_id: system.id }" :label="deviceName" />
        <VoiceNoteButton v-if="siteUuid" :key="`voice-${device.id}`" :site-uuid="siteUuid"
                         :attach-to="{ device_id: device.id }" :label="deviceName" />
        <DeviceMoveShare :key="`move-${device.id}`" searchable dialog :device="device" :systems="systems"
                         @updated="emit('changed')" />
        <span class="w-px h-5 bg-gray-200 mx-0.5"></span>
        <button type="button" class="btn-icon" @click="emit('duplicate')" v-tooltip="'Dupliquer cet équipement'">
          <FontAwesomeIcon :icon="['fas', 'clone']" class="w-3.5 h-3.5" />
        </button>
        <button type="button" class="btn-icon btn-icon-danger" @click="emit('remove')" v-tooltip="'Supprimer cet équipement'">
          <FontAwesomeIcon :icon="['fas', 'trash']" class="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
    <div class="overflow-y-auto min-h-0 flex-1">
      <!-- Ce qui manque est montré rubrique par rubrique, dans la fiche. -->
      <div v-if="checks.length" class="px-3 pt-3 flex flex-col gap-2">
        <!-- À vérifier : un encadré par point -->
        <section v-for="f in checks" :key="f.code" class="rounded-xl border border-rose-200 bg-rose-50 p-3"
                 data-guide-check>
          <h4 class="flex items-center gap-2 text-[13px] font-semibold text-rose-900">
            <span class="shrink-0 rounded-full bg-white px-2 py-px text-[11px] font-medium text-rose-700 ring-1 ring-inset ring-rose-200">À vérifier</span>
            <span class="min-w-0">{{ checkText(f.code).title }}</span>
          </h4>
          <p class="mt-1 text-[13px] leading-snug text-rose-950">{{ checkText(f.code).text }}</p>
          <dl v-if="checkRows(f.code, device, system.system_category).length"
              class="mt-2 grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-1.5">
            <div v-for="r in checkRows(f.code, device, system.system_category)" :key="r.label" class="rounded-lg bg-white px-2 py-1.5">
              <dt class="text-[11px] text-slate-500">{{ r.label }}</dt>
              <dd class="text-[13px] font-semibold text-rose-900 truncate" v-tooltip.overflow>{{ r.value }}</dd>
            </div>
          </dl>
          <ul v-if="checkText(f.code).todo.length" class="mt-2 flex flex-col gap-1 text-[13px] text-rose-950">
            <li v-for="t in checkText(f.code).todo" :key="t" class="flex gap-1.5"><span aria-hidden="true" class="text-rose-400">›</span>{{ t }}</li>
          </ul>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" @click="goFix(f)" data-guide-check-go
                    v-tooltip="f.code === 'DEV-008' ? CHECK_GO_TIPS.bms : CHECK_GO_TIPS.rubric"
                    class="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-rose-900 ring-1 ring-inset ring-rose-300 hover:bg-rose-100">
              <FontAwesomeIcon :icon="['fas', 'arrow-right']" class="w-3 h-3" />
              {{ checkGoLabel(f.code) }}
            </button>
            <Tooltip v-if="f.auto_fix_action && checkFixLabel(f.code)" :text="CHECK_FIX_TIP">
              <button type="button" @click="autoFix(f)" :disabled="fixing === f.code"
                      class="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-rose-900 ring-1 ring-inset ring-rose-300 hover:bg-rose-100 disabled:opacity-60">
                <FontAwesomeIcon :icon="['fas', 'wand-magic-sparkles']" class="w-3 h-3" />
                {{ fixing === f.code ? 'Correction…' : checkFixLabel(f.code) }}
              </button>
            </Tooltip>
          </div>
        </section>
      </div>
      <DeviceEditModal
        ref="editRef"
        :key="`edit-${device.id}-${system.id}`"
        panel
        rubrics
        :checks="checks"
        :device="device"
        :system="system"
        :system-label="systemLabel"
        :zone-name="zoneName"
        @changed="emit('changed')"
        @close="emit('close')">
        <!-- Pied de la fiche : le point suivant du parcours, sinon « Fermer » comme d'habitude. -->
        <template v-if="nextLabel" #footer-action>
          <button type="button" @click="emit('next-stop')" v-tooltip="() => nextStopTip(nextLabel)" data-guide-next
                  class="inline-flex h-9 min-w-0 max-w-full items-center gap-2 rounded-lg bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-700 transition">
            <FontAwesomeIcon :icon="['fas', 'route']" class="w-3.5 h-3.5 shrink-0" />
            <span class="truncate">{{ nextStopLabel(nextLabel) }}</span>
          </button>
        </template>
      </DeviceEditModal>
    </div>
    <!-- Fiche agrandie (grande fenêtre, téléportée dans <body>) -->
    <DeviceEditModal
      v-if="expanded"
      :key="`edit-full-${device.id}-${system.id}`"
      :device="device"
      :system="system"
      :system-label="systemLabel"
      :zone-name="zoneName"
      @changed="emit('changed')"
      @close="expanded = false" />
  </div>
</template>
