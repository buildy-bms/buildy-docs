<script setup>
/**
 * Modale d'édition détaillée d'un équipement (« système » au sens métier).
 * Item 3 — saisie organisée en sections. Les états binaires sont des
 * boutons Oui / Non (SegmentedToggle, rien sélectionné tant que non
 * répondu), placés juste après la question. Un bandeau de complétude
 * indique si l'équipement est « validé » (= complètement renseigné).
 */
import { computed } from 'vue'
import BaseModal from '@/components/BaseModal.vue'
import SearchableSelect from '@/components/SearchableSelect.vue'
import ProtocolMultiPicker from '@/components/ProtocolMultiPicker.vue'
import SegmentedToggle from '@/components/audit/SegmentedToggle.vue'
import { updateBacsDevice } from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useAuditStore } from '@/stores/audit'
import { ENERGY_OPTIONS, ROLE_OPTIONS, COMM_OPTIONS, isThermalCategory, isDeviceComplete, deviceMissingFields } from '@/lib/audit-options'

const props = defineProps({
  device: { type: Object, required: true },
  system: { type: Object, required: true },
  systemLabel: { type: String, default: '' },
  zoneName: { type: String, default: '' },
})
const emit = defineEmits(['close', 'changed'])
const { error } = useNotification()
const audit = useAuditStore()

// Item 8 — type de calcul de puissance (guide PROFEEL p.8).
const POWER_CALC_OPTIONS = [
  { value: 'thermodynamic_max', label: 'Thermodynamique (max chaud/froid)' },
  { value: 'boiler_sum', label: 'Chaudière (somme nominales)' },
  { value: 'joule_sum', label: 'Effet joule (somme élec.)' },
  { value: 'district_heating_substation', label: 'Sous-station réseau' },
  { value: 'out_of_scope', label: 'Hors cumul (secours, process…)' },
]
const YESNO = [
  { value: true, label: 'Oui', tone: 'green' },
  { value: false, label: 'Non', tone: 'slate' },
]
const METERING_OPTS = [
  { value: 'yes', label: 'Oui', tone: 'green' },
  { value: 'partial', label: 'Partiel', tone: 'amber' },
  { value: 'no', label: 'Non', tone: 'slate' },
]
const POWER_RELEVANT = new Set(['heating', 'cooling', 'ventilation', 'dhw'])

const showPower = computed(() => POWER_RELEVANT.has(props.system?.system_category))
const roleApplies = computed(() => isThermalCategory(props.system?.system_category))
const isShared = computed(() => Array.isArray(props.device.extra_system_ids) && props.device.extra_system_ids.length > 0)

// Usages desservis par l'équipement : système primaire + systèmes partagés
// (extra_system_ids). On n'affiche la puissance chaud / froid que pour
// l'usage concerné — les deux uniquement quand l'équipement sert à la fois
// le chauffage ET le refroidissement (équipement réversible partagé).
const servedCategories = computed(() => {
  const cats = new Set()
  if (props.system?.system_category) cats.add(props.system.system_category)
  const extra = props.device.extra_system_ids || []
  for (const s of (audit.systems || [])) {
    if (extra.includes(s.id) && s.system_category) cats.add(s.system_category)
  }
  return cats
})
const hasHeating = computed(() => servedCategories.value.has('heating'))
const hasCooling = computed(() => servedCategories.value.has('cooling'))
// Champ « chaud » : usages chauffage, mais aussi ventilation / ECS où il
// porte la puissance nominale. Masqué pour un usage refroidissement seul.
const showHeatPower = computed(() => showPower.value && (hasHeating.value || !hasCooling.value))
const showCoolPower = computed(() => showPower.value && hasCooling.value)
const heatPowerLabel = computed(() => (hasHeating.value ? 'Puissance chaud (kW)' : 'Puissance (kW)'))
// `power_kw` est LA colonne lue par le cumul R175-2 et le PDF. `power_kw_cooling`
// n'est qu'un complément, réservé aux équipements réversibles (chaud ET froid).
// Donc : usage refroidissement seul → la puissance froid va dans `power_kw` ;
// équipement réversible (les deux champs affichés) → le froid va dans
// `power_kw_cooling`, le chaud restant dans `power_kw`.
const coolPowerField = computed(() => (showHeatPower.value ? 'power_kw_cooling' : 'power_kw'))
const deviceRole = computed(() =>
  Array.isArray(props.device.device_role)
    ? props.device.device_role
    : (props.device.device_role ? [props.device.device_role] : []))

// Tri-état : null/undefined → aucun bouton sélectionné ; 0/1 → Non/Oui.
const triState = (v) => (v == null ? null : !!v)

async function patch(p) {
  try {
    const { data } = await updateBacsDevice(props.device.id, p)
    Object.assign(props.device, data)
    emit('changed')
  } catch {
    error('Sauvegarde impossible')
  }
}
function patchInput(field, value) {
  const v = (value === '' || value == null) ? null : value
  if (v !== (props.device[field] ?? null)) patch({ [field]: v })
}

// Complétude — « validé » = complètement renseigné. Liste ce qu'il reste.
const missing = computed(() => deviceMissingFields(props.device, props.system?.system_category))
const forced = computed(() => !!props.device.validation_forced)
const complete = computed(() => isDeviceComplete(props.device, props.system?.system_category))

const inputCls = 'h-9 px-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition'
const headCls = 'px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-700 uppercase tracking-wider'
</script>

<template>
  <BaseModal
    :title="`Modifier l'équipement — ${systemLabel}${zoneName ? ' / ' + zoneName : ''}`"
    size="xl"
    @close="emit('close')"
  >
    <div class="space-y-3">
      <!-- Bandeau de complétude (« validé » = complètement renseigné) -->
      <div :class="['rounded-lg px-3 py-2 text-sm flex items-start gap-2',
                    complete
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-amber-50 text-amber-800 border border-amber-200']">
        <span class="font-semibold shrink-0">{{ complete ? '✓' : '⚠' }}</span>
        <span v-if="forced">
          Validation forcée manuellement — l'équipement est considéré validé.
          <template v-if="missing.length"> Champs encore non renseignés : <strong>{{ missing.join(', ') }}</strong>.</template>
        </span>
        <span v-else-if="complete">Équipement complet — il est pris en compte dans la validation de l'étape Systèmes.</span>
        <span v-else>
          Équipement incomplet — il reste à renseigner : <strong>{{ missing.join(', ') }}</strong>.
          L'étape Systèmes ne pourra pas être validée tant qu'un équipement est incomplet.
        </span>
      </div>

      <!-- Forçage manuel de la validation : pour les infos définitivement
           inconnues (équipement ancien, documentation perdue…). -->
      <div class="qa-grid rounded-lg border border-gray-200 px-3 py-2">
        <div class="qa-question text-sm font-medium">
          Forcer la validation de cet équipement ?
          <span class="qa-desc">À activer si certaines informations resteront définitivement inconnues. L'équipement sera considéré validé même incomplet.</span>
        </div>
        <SegmentedToggle :model-value="triState(device.validation_forced)" :options="YESNO"
                         @update:model-value="v => patch({ validation_forced: v })" />
      </div>

      <!-- Identité + Énergie & puissance côte à côte -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <section class="rounded-xl border border-gray-200 overflow-hidden">
          <h4 :class="headCls">Identité</h4>
          <div class="p-3 grid grid-cols-2 gap-2">
            <div class="col-span-2">
              <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Nom</label>
              <input type="text" :value="device.name || ''" placeholder="ex : Chaudière gaz principale"
                     @blur="e => patchInput('name', e.target.value)" :class="inputCls" class="w-full" />
            </div>
            <div class="col-span-2">
              <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Localisation</label>
              <input type="text" :value="device.location || ''" placeholder="ex : Local technique sous-sol"
                     @blur="e => patchInput('location', e.target.value)" :class="inputCls" class="w-full" />
            </div>
            <div>
              <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Marque</label>
              <input type="text" :value="device.brand || ''" placeholder="Atlantic"
                     @blur="e => patchInput('brand', e.target.value)" :class="inputCls" class="w-full" />
            </div>
            <div>
              <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Référence</label>
              <input type="text" :value="device.model_reference || ''" placeholder="Varmax 70"
                     @blur="e => patchInput('model_reference', e.target.value)" :class="inputCls" class="w-full" />
            </div>
            <div>
              <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Quantité</label>
              <input type="number" min="1" step="1" :value="device.quantity ?? 1"
                     @blur="e => patch({ quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })"
                     :class="inputCls" class="w-full" />
            </div>
            <div>
              <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Âge (années)</label>
              <input type="number" min="0" step="1" :value="device.age_years ?? ''" placeholder="—"
                     @blur="e => patch({ age_years: e.target.value === '' ? null : Math.max(0, parseInt(e.target.value, 10) || 0) })"
                     :class="inputCls" class="w-full" />
            </div>
          </div>
        </section>

        <section class="rounded-xl border border-gray-200 overflow-hidden">
          <h4 :class="headCls">Énergie &amp; puissance</h4>
          <div class="p-3 grid grid-cols-2 gap-2">
            <div class="col-span-2">
              <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Énergie</label>
              <SearchableSelect :model-value="device.energy_source" :options="ENERGY_OPTIONS"
                                :clearable="false" size="sm" placeholder="Énergie"
                                @update:model-value="v => patch({ energy_source: v || null })" />
            </div>
            <div v-if="roleApplies" class="col-span-2">
              <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Niveau(x) de régulation R175-6</label>
              <SearchableSelect :model-value="deviceRole" :options="ROLE_OPTIONS"
                                :multiple="true" :clearable="true" :creatable="true" size="sm"
                                placeholder="Production / Distribution / Émission…"
                                @update:model-value="v => patch({ device_role: Array.isArray(v) ? v : [] })" />
            </div>
            <template v-if="showPower">
              <div v-if="showHeatPower" :class="{ 'col-span-2': !showCoolPower }">
                <label class="block text-[11px] font-medium text-gray-600 mb-0.5">{{ heatPowerLabel }}</label>
                <input type="number" min="0" step="0.1" :value="device.power_kw ?? ''" placeholder="—"
                       @blur="e => patch({ power_kw: e.target.value === '' ? null : parseFloat(e.target.value) })"
                       :class="inputCls" class="w-full" />
              </div>
              <div v-if="showCoolPower" :class="{ 'col-span-2': !showHeatPower }">
                <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Puissance froid (kW)</label>
                <input type="number" min="0" step="0.1" :value="device[coolPowerField] ?? ''" placeholder="—"
                       @blur="e => patch({ [coolPowerField]: e.target.value === '' ? null : parseFloat(e.target.value) })"
                       :class="inputCls" class="w-full" />
              </div>
              <div class="col-span-2">
                <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Type de calcul de puissance</label>
                <SearchableSelect :model-value="device.power_calculation_type" :options="POWER_CALC_OPTIONS"
                                  :clearable="true" size="sm" placeholder="Calcul automatique"
                                  @update:model-value="v => patch({ power_calculation_type: v || null })" />
              </div>
            </template>
          </div>
        </section>
      </div>

      <!-- Communication & conformité R175-3 -->
      <section class="rounded-xl border border-gray-200 overflow-hidden">
        <h4 :class="headCls">Communication &amp; conformité R175-3</h4>
        <div class="p-3">
          <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Protocole(s) de communication</label>
          <ProtocolMultiPicker
            :model-value="device.communication_protocols || (device.communication_protocol && device.communication_protocol !== 'non_communicant' ? JSON.stringify([device.communication_protocol]) : null)"
            :options="COMM_OPTIONS" placeholder="Aucun protocole"
            @update:modelValue="v => patch({ communication_protocols: v, communication_protocol: null })" />
          <p class="text-xs text-gray-500 leading-snug mt-1">
            Langages par lesquels l'équipement échange avec la supervision. Un équipement qui ne
            communique avec aucun protocole ne peut être ni piloté ni suivi à distance.
          </p>
        </div>
        <div class="qa-grid border-t border-gray-100 px-3 py-3" style="row-gap: 1.5rem">
          <div class="qa-question text-sm font-medium">
            L'équipement est-il relié à la GTB par une liaison câblée ?
            <span class="font-normal text-gray-400 ml-1">· R175-3 §3</span>
            <span class="qa-desc">L'équipement est relié à la supervision par un câble dédié — la base de l'interopérabilité exigée par le décret.</span>
          </div>
          <SegmentedToggle :model-value="triState(device.wired)" :options="YESNO"
                           @update:model-value="v => patch({ wired: v })" />

          <div class="qa-question text-sm font-medium">
            Peut-on arrêter l'équipement manuellement, sur place ?
            <span class="font-normal text-gray-400 ml-1">· R175-3 §4</span>
            <span class="qa-desc">On peut arrêter l'équipement directement sur place, sans passer par la supervision.</span>
          </div>
          <SegmentedToggle :model-value="triState(device.meets_r175_3_p4)" :options="YESNO"
                           @update:model-value="v => patch({ meets_r175_3_p4: v })" />

          <div class="qa-question text-sm font-medium">
            L'équipement redémarre-t-il de façon autonome après une coupure ?
            <span class="font-normal text-gray-400 ml-1">· R175-3 §4</span>
            <span class="qa-desc">Après une coupure de courant ou un redémarrage de la GTB, l'équipement repart seul, sans intervention d'un technicien.</span>
          </div>
          <SegmentedToggle :model-value="triState(device.meets_r175_3_p4_autonomous)" :options="YESNO"
                           @update:model-value="v => patch({ meets_r175_3_p4_autonomous: v })" />
        </div>
      </section>

      <!-- Suivi énergétique BACS — comptage séparable + équipement centralisé multi-bâtiments -->
      <section class="rounded-xl border border-gray-200 overflow-hidden">
        <h4 :class="headCls">Suivi énergétique BACS</h4>
        <div class="qa-grid px-3 py-3" style="row-gap: 1.5rem">
          <!-- Comptage séparable : visible uniquement pour les équipements
               partagés entre plusieurs systèmes/zones. -->
          <template v-if="isShared">
            <div class="qa-question text-sm font-medium">
              Le comptage de cet équipement est-il séparable par zone ?
              <span class="qa-desc">La consommation de chaque zone desservie par cet équipement partagé peut être relevée séparément.</span>
            </div>
            <SegmentedToggle :model-value="device.metering_separable || null" :options="METERING_OPTS"
                             @update:model-value="v => patch({ metering_separable: v })" />
          </template>
          <!-- Multi-bâtiments — visible sur tous les équipements (chaudière
               centrale, GPC, sous-station…). Déplacé depuis le niveau
               système (refactor 2026-05-26, mig 175). Détermine le cas F
               d'assujettissement : tous les propriétaires du site sont
               assujettis ensemble. -->
          <div class="qa-question text-sm font-medium">
            Cet équipement dessert-il plusieurs bâtiments du site ?
            <span class="qa-desc">Chaudière commune, groupe de production de chaleur, sous-station : un équipement central qui sert plusieurs bâtiments du site. Tous les propriétaires du site deviennent alors assujettis ensemble (cas F du décret).</span>
          </div>
          <SegmentedToggle :model-value="triState(device.serves_multiple_buildings)" :options="YESNO"
                           @update:model-value="v => patch({ serves_multiple_buildings: v })" />
        </div>
        <div v-if="isShared" class="px-3 pb-3">
          <input type="text" :value="device.metering_separable_note || ''" placeholder="Justification courte sur la séparabilité du comptage…"
                 @blur="e => patchInput('metering_separable_note', e.target.value)"
                 :class="inputCls" class="w-full" />
        </div>
      </section>

      <!-- État de l'équipement -->
      <section class="rounded-xl border border-gray-200 overflow-hidden">
        <h4 :class="headCls">État de l'équipement</h4>
        <div class="qa-grid px-3 py-3" style="row-gap: 1.5rem">
          <div class="qa-question text-sm font-medium">
            Est-ce un équipement de secours ?
            <span class="qa-desc">Équipement de secours, non utilisé en fonctionnement normal — sa puissance n'entre pas dans le calcul d'assujettissement au décret.</span>
          </div>
          <SegmentedToggle :model-value="triState(device.is_backup)" :options="YESNO"
                           @update:model-value="v => patch({ is_backup: v })" />

          <div class="qa-question text-sm font-medium">
            L'équipement est-il hors service ?
            <span class="qa-desc">Équipement hors d'usage : il n'est pas pris en compte dans le plan de mise en conformité.</span>
          </div>
          <SegmentedToggle :model-value="triState(device.out_of_service)" :options="YESNO"
                           @update:model-value="v => patch({ out_of_service: v })" />
        </div>
      </section>

      <div class="flex justify-end">
        <button type="button" @click="emit('close')"
                class="h-9 px-4 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition">
          Fermer
        </button>
      </div>
    </div>
  </BaseModal>
</template>
