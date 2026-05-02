<script setup>
import { storeToRefs } from 'pinia'
import { WrenchScrewdriverIcon, PencilSquareIcon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import BacsPhotoButton from '@/components/BacsPhotoButton.vue'
import PhotoDropzone from '@/components/PhotoDropzone.vue'
import VerticalStepper from '@/components/VerticalStepper.vue'
import BmsComponentsTable from '@/components/BmsComponentsTable.vue'
import ProtocolMultiPicker from '@/components/ProtocolMultiPicker.vue'
import Tooltip from '@/components/Tooltip.vue'
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import MeterTypePill from '@/components/MeterTypePill.vue'
import MeterUsagePill from '@/components/MeterUsagePill.vue'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { updateBacsDevice, updateBacsMeter } from '@/api'

// Section "Solution GTB / GTC en place" (R175-3 / R175-4 / R175-5).
// Lit l'etat depuis useAuditStore (bms, document, meters, devices) et
// recoit les computed lourds (bmsSteps, devicesWithMeta, metersPresent)
// en props pour eviter de les dupliquer.
const props = defineProps({
  bmsSteps: { type: Array, required: true },
  devicesWithMeta: { type: Array, required: true },
  metersPresent: { type: Array, required: true },
  systemLabels: { type: Object, required: true },
  protocolOptions: { type: Array, required: true },
  step: { type: Object, default: null },
  active: { type: Boolean, default: false },
})
const emit = defineEmits([
  'open-notes', 'validate-step', 'invalidate-step',
  'save-doc', 'refresh-audit-data',
])

const audit = useAuditStore()
const { bms, document, meters } = storeToRefs(audit)
const { error } = useNotification()

let saveTimer = null
function saveBmsDebounced() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try { await audit.saveBms() }
    catch { error('Sauvegarde GTB impossible') }
  }, 500)
}

async function patchDeviceMb(d, patch) {
  // Cohérence "Operationnel" : si on decoche Integré, on remet aussi
  // l'autre flag a 0 pour eviter un etat aberrant.
  const fullPatch = { ...patch }
  if ('managed_by_bms' in patch && patch.managed_by_bms === false) {
    fullPatch.bms_integration_out_of_service = 0
  }
  Object.assign(d, fullPatch)
  try {
    await updateBacsDevice(d.id, fullPatch)
    await audit.refreshActionItems()
  } catch { error('Sauvegarde équipement impossible') }
}

async function patchMeter(m, patch) {
  const fullPatch = { ...patch }
  if ('managed_by_bms' in patch && patch.managed_by_bms === false) {
    fullPatch.bms_integration_out_of_service = 0
  }
  Object.assign(m, fullPatch)
  try {
    await updateBacsMeter(m.id, fullPatch)
    await audit.refreshActionItems()
  } catch { error('Sauvegarde compteur impossible') }
}

function hasNotes(html) {
  if (!html) return false
  return html.replace(/<[^>]*>/g, '').trim().length > 0
}
</script>

<template>
  <CollapsibleSection storage-key="bms" section-id="section-bms" :active="active">
    <template #header>
      <SectionHeader :number="audit.isBacs ? '6' : '5'"
                     :title="audit.isBacs ? 'Solution GTB / GTC en place' : 'Solution de supervision en place'"
                     :subtitle="audit.isBacs ? 'R175-3 + R175-4 + R175-5' : 'Inventaire du superviseur en place'"
                     :icon="WrenchScrewdriverIcon" icon-color="text-purple-600"
                     :step="step"
                     @validate="emit('validate-step', $event)"
                     @invalidate="emit('invalidate-step', $event)">
        <template v-if="audit.isBacs" #subtitle-extra>
          <R175Tooltip article="R175-3" />
          <R175Tooltip article="R175-4" />
          <R175Tooltip article="R175-5" />
        </template>
        <template #actions>
          <button
            type="button"
            @click="emit('open-notes', { title: 'Notes GTB', contextLabel: 'Solution GTB / GTC : ' + (bms.existing_solution || 'a renseigner'), entityType: 'bms', entityRef: bms, currentHtml: bms.notes_html || '' })"
            :class="['inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border transition',
              hasNotes(bms.notes_html)
                ? 'border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                : 'border-gray-300 text-gray-600 hover:bg-gray-50']"
            title="Editer les notes GTB">
            <PencilSquareIcon class="w-4 h-4" />
            {{ hasNotes(bms.notes_html) ? 'Notes' : '+ Notes' }}
          </button>
          <BacsPhotoButton
            v-if="document?.site_uuid && bms.document_id"
            :site-uuid="document.site_uuid"
            :attach-to="{ bms_document_id: bms.document_id }"
            label="GTB" size="md" />
        </template>
      </SectionHeader>
    </template>
    <template #summary>
      <span v-if="bms.existing_solution">
        {{ bms.existing_solution }}<span v-if="bms.existing_solution_brand"> · {{ bms.existing_solution_brand }}</span>
        · suivi 5 ans {{ bms.meets_r175_3_p1 ? '✓' : '✗' }}
        · détection dérives {{ bms.meets_r175_3_p2 ? '✓' : '✗' }}
        · maintenance {{ bms.has_maintenance_procedures ? '✓' : '✗' }}
      </span>
      <span v-else class="italic">GTB non renseignée</span>
    </template>
    <PhotoDropzone
      :site-uuid="document?.site_uuid || ''"
      :attach-to="{ bms_document_id: bms.document_id }"
      :enabled="!!(document?.site_uuid && bms.document_id)"
      @changed="emit('refresh-audit-data')">
      <div class="px-5 py-4 grid grid-cols-1 lg:grid-cols-[180px_1fr] gap-6">
        <aside class="border-r border-gray-100 pr-4 sticky top-4 self-start">
          <h4 class="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-3">Progression de la saisie</h4>
          <VerticalStepper :steps="bmsSteps" />
        </aside>
        <div class="space-y-4 min-w-0">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Solution en place</label>
              <input v-model="bms.existing_solution" type="text"
                     placeholder="ex : Niagara, Schneider EcoStruxure, Buildy…"
                     @input="saveBmsDebounced"
                     class="input-base" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Marque / éditeur</label>
              <input v-model="bms.existing_solution_brand" type="text" placeholder="—"
                     @input="saveBmsDebounced"
                     class="input-base" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Localisation</label>
              <input v-model="bms.location" type="text" placeholder="ex : Local technique sous-sol"
                     @input="saveBmsDebounced"
                     class="input-base" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Référence modèle</label>
              <input v-model="bms.model_reference" type="text" placeholder="ex : JACE 8000"
                     @input="saveBmsDebounced"
                     class="input-base" />
            </div>
            <div v-if="!bms.out_of_service" class="col-span-2">
              <label class="block text-xs font-medium text-gray-700 mb-1">
                Protocoles de mise à disposition des points
                <span class="text-gray-400 font-normal">— vers la supervision Buildy ou un tiers</span>
              </label>
              <ProtocolMultiPicker
                :model-value="bms.provided_protocols"
                :options="protocolOptions"
                size="sm"
                placeholder="Aucun protocole renseigné"
                @update:modelValue="v => { bms.provided_protocols = v; saveBmsDebounced() }" />
            </div>
          </div>

          <div class="border-t border-gray-100 pt-3">
            <label class="flex items-center gap-2 cursor-pointer text-sm">
              <input type="checkbox" v-model="bms.out_of_service" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="rounded" />
              <span class="text-gray-700 font-medium">GTB Hors-Service</span>
              <span class="text-[11px] text-gray-400">— le plan d'action ignore alors les exigences GTB et les sous-blocs ci-dessous sont masqués</span>
            </label>
          </div>

          <div class="border-t border-gray-100 pt-3">
            <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
              Analyse fonctionnelle de la GTB existante
            </h3>
            <div v-if="document?.audit_existing_af_status !== 'absent'" class="flex items-center gap-3 flex-wrap">
              <BacsPhotoButton
                v-if="document?.site_uuid"
                :site-uuid="document.site_uuid"
                :attach-to="{ bms_document_id: bms.document_id }"
                label="Analyse fonctionnelle GTB" size="md" />
              <p class="text-xs text-gray-500 italic flex-1">
                Glisse ici le document d'AF de la GTB existante (PDF, Word, schéma) si le propriétaire ou l'exploitant le fournit.
              </p>
            </div>
            <p v-else class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              ⚠ Aucun document d'<strong>analyse fonctionnelle</strong> n'est disponible pour la GTB existante.
            </p>
            <label class="inline-flex items-center gap-1.5 text-xs cursor-pointer mt-2 text-gray-600">
              <input type="checkbox"
                     :checked="document?.audit_existing_af_status === 'absent'"
                     @change="e => emit('save-doc', { audit_existing_af_status: e.target.checked ? 'absent' : null })"
                     class="rounded" />
              Le document d'analyse fonctionnelle n'existe pas
            </label>
          </div>

          <div v-if="!bms.out_of_service && audit.docId" class="border-t border-gray-100 pt-3">
            <BmsComponentsTable :document-id="audit.docId" />
          </div>

          <div v-if="!bms.out_of_service" class="border-t border-gray-100 pt-3">
            <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Usages traités par la GTB</h3>
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-sm">
              <label v-for="(usage, key) in { manages_heating: 'Chauffage', manages_cooling: 'Refroidissement', manages_ventilation: 'Ventilation', manages_dhw: 'ECS', manages_lighting: 'Éclairage' }"
                     :key="key"
                     class="flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                <input type="checkbox" v-model="bms[key]" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="rounded" />
                {{ usage }}
              </label>
            </div>
          </div>

          <div v-if="!bms.out_of_service" class="border-t border-gray-100 pt-3 space-y-6">
            <div>
              <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
                Équipements intégrés à la GTB
                <span class="font-normal normal-case text-gray-500 text-[10px]">— « Opérationnel » = vérifié sur place par l'auditeur</span>
              </h3>
              <table v-if="devicesWithMeta.length" class="w-full text-sm">
                <thead class="text-[10px] uppercase text-gray-500 tracking-wider bg-gray-50">
                  <tr>
                    <th class="text-left px-2 py-1 font-semibold">Équipement</th>
                    <th class="text-center py-1 font-semibold w-16"><Tooltip text="Intégré à la GTB"><span>Intégré</span></Tooltip></th>
                    <th class="text-center py-1 font-semibold w-24"><Tooltip text="L'auditeur a vérifié sur place que la GTB voit cet équipement et que les valeurs remontent correctement."><span>Opérationnel</span></Tooltip></th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  <tr v-for="d in devicesWithMeta" :key="d.id"
                      :class="[d.out_of_service ? 'opacity-50' : '', d.bms_integration_out_of_service ? 'text-red-700 bg-red-50/40' : '']">
                    <td class="px-2 py-1">
                      <span class="inline-flex items-center gap-2">
                        <SystemCategoryIcon :category="d.system_category" size="sm" />
                        <strong>{{ d.name || d.brand || d.model_reference || 'Sans nom' }}</strong>
                        <span :class="d.bms_integration_out_of_service ? 'text-red-500' : 'text-gray-400'">
                          — {{ systemLabels[d.system_category] || d.system_category }} / {{ d.zone_name || '?' }}
                        </span>
                      </span>
                    </td>
                    <td class="py-1 text-center">
                      <input type="checkbox" :checked="!!d.managed_by_bms"
                             :disabled="d.out_of_service"
                             @change="e => patchDeviceMb(d, { managed_by_bms: e.target.checked })"
                             class="rounded disabled:opacity-30" />
                    </td>
                    <td class="py-1 text-center">
                      <Tooltip
                        :text="!d.managed_by_bms ? 'Coche d\'abord « Intégré » pour vérifier le bon fonctionnement.' : !d.wired ? 'Équipement non câblé — par définition non opérationnel dans la GTB.' : 'Cocher après avoir vérifié sur place que la GTB voit l\'équipement.'">
                        <input type="checkbox"
                               :checked="d.managed_by_bms && d.wired && !d.bms_integration_out_of_service"
                               :disabled="!d.managed_by_bms || !d.wired"
                               @change="e => patchDeviceMb(d, { bms_integration_out_of_service: !e.target.checked })"
                               class="rounded disabled:opacity-30 disabled:cursor-not-allowed accent-emerald-500" />
                      </Tooltip>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="text-xs text-gray-400 italic">Aucun équipement saisi.</p>
            </div>
            <div>
              <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
                Compteurs intégrés à la GTB
                <span class="font-normal normal-case text-gray-500 text-[10px]">— uniquement les compteurs présents</span>
              </h3>
              <table v-if="metersPresent.length" class="w-full text-sm">
                <thead class="text-[10px] uppercase text-gray-500 tracking-wider bg-gray-50">
                  <tr>
                    <th class="text-left px-2 py-1 font-semibold">Compteur</th>
                    <th class="text-center py-1 font-semibold w-16"><Tooltip text="Intégré à la GTB"><span>Intégré</span></Tooltip></th>
                    <th class="text-center py-1 font-semibold w-24"><Tooltip text="L'auditeur a vérifié sur place que la GTB relève bien le compteur et que les index remontent."><span>Opérationnel</span></Tooltip></th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  <tr v-for="m in metersPresent" :key="m.id"
                      :class="[m.out_of_service ? 'opacity-50' : '', m.bms_integration_out_of_service ? 'text-red-700 bg-red-50/40' : '']">
                    <td class="px-2 py-1">
                      <span class="inline-flex items-center gap-2">
                        <MeterTypePill :type="m.meter_type" />
                        <MeterUsagePill :usage="m.usage" />
                        <span :class="m.bms_integration_out_of_service ? 'text-red-500' : 'text-gray-400'">
                          — {{ m.zone_name || 'général' }}
                        </span>
                      </span>
                    </td>
                    <td class="py-1 text-center">
                      <Tooltip :text="!m.communicating ? 'Compteur non communicant — il ne peut pas être intégré à la GTB.' : ''">
                        <input type="checkbox" :checked="!!m.managed_by_bms"
                               :disabled="m.out_of_service || !m.communicating"
                               @change="e => patchMeter(m, { managed_by_bms: e.target.checked })"
                               class="rounded disabled:opacity-30 disabled:cursor-not-allowed" />
                      </Tooltip>
                    </td>
                    <td class="py-1 text-center">
                      <Tooltip :text="!m.managed_by_bms ? 'Coche d\'abord « Intégré » pour vérifier le bon fonctionnement.' : !m.wired ? 'Compteur non câblé — par définition non opérationnel dans la GTB.' : 'Cocher après avoir vérifié sur place que la GTB relève le compteur.'">
                        <input type="checkbox"
                               :checked="m.managed_by_bms && m.wired && !m.bms_integration_out_of_service"
                               :disabled="!m.managed_by_bms || !m.wired"
                               @change="e => patchMeter(m, { bms_integration_out_of_service: !e.target.checked })"
                               class="rounded disabled:opacity-30 disabled:cursor-not-allowed accent-emerald-500" />
                      </Tooltip>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="text-xs text-gray-400 italic">
                Aucun compteur présent à raccorder.
                <span v-if="meters.length" class="block mt-1">Coche « Présent » dans la section 4 pour rendre les compteurs disponibles ici.</span>
              </p>
            </div>
          </div>

          <div v-if="audit.isBacs && !bms.out_of_service" class="border-t border-gray-100 pt-3">
            <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2 inline-flex items-center gap-1">
              R175-3 — Capacités de la solution de supervision
              <Tooltip text="L'interopérabilité (P3) et l'arrêt manuel + autonome (P4) sont désormais évalués au niveau de chaque système — cf section 3.">
                <span class="font-normal normal-case text-gray-500 text-[10px]">ⓘ P3 et P4 sont au niveau des systèmes (section 3)</span>
              </Tooltip>
            </h3>
            <div class="space-y-2 text-sm">
              <label class="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" v-model="bms.meets_r175_3_p1" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="mt-0.5 rounded" />
                <span><strong>P1.</strong> Suivi continu par zone, pas horaire, conservation 5 ans</span>
              </label>
              <div v-if="bms.meets_r175_3_p1" class="ml-6 grid grid-cols-2 gap-3 mt-1">
                <div>
                  <label class="block text-[11px] text-gray-600 mb-1">Format d'archivage</label>
                  <input v-model="bms.r175_3_p1_archival_format" type="text" placeholder="ex : CSV, base SQL, API InfluxDB"
                         @input="saveBmsDebounced"
                         class="w-full text-xs px-2 py-1 border border-gray-200 rounded" />
                </div>
                <div class="flex items-end">
                  <label class="flex items-center gap-1.5 cursor-pointer text-xs text-gray-700">
                    <input type="checkbox" v-model="bms.r175_3_p1_retention_verified" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="rounded" />
                    Rétention 5 ans vérifiée sur place
                  </label>
                </div>
              </div>
              <label class="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" v-model="bms.meets_r175_3_p2" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="mt-0.5 rounded" />
                <span><strong>P2.</strong> Détection des pertes d'efficacité</span>
              </label>
              <div v-if="bms.meets_r175_3_p2" class="ml-6">
                <label class="block text-[11px] text-gray-600 mb-1">Règles / seuils / alertes actives</label>
                <textarea v-model="bms.r175_3_p2_anomaly_rules_html" @input="saveBmsDebounced"
                          placeholder="ex : alerte si ΔT > 5 °C, surconso > 20% j-1, COP < 2.5…"
                          rows="2"
                          class="w-full text-xs px-2 py-1 border border-gray-200 rounded"></textarea>
              </div>
            </div>
          </div>

          <div v-if="audit.isBacs && !bms.out_of_service" class="border-t border-gray-100 pt-3">
            <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
              R175-3 — Mise à disposition des données
              <span class="font-normal normal-case text-gray-500 text-[10px] ml-1">(dernier alinéa)</span>
            </h3>
            <div class="space-y-2 text-sm">
              <label class="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" v-model="bms.data_provision_to_manager" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="mt-0.5 rounded" />
                <span>Procédure de mise à disposition des données au <strong>gestionnaire du bâtiment</strong> documentée</span>
              </label>
              <label class="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" v-model="bms.data_provision_to_operators" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="mt-0.5 rounded" />
                <span>Procédure de transmission des données aux <strong>exploitants des systèmes techniques</strong> documentée</span>
              </label>
            </div>
            <template v-if="bms.data_provision_to_manager || bms.data_provision_to_operators">
              <textarea v-model="bms.notes_data_provision" @input="saveBmsDebounced"
                        placeholder="Décris le mécanisme : extraction CSV, accès portail web, API, planning d'envoi…"
                        class="mt-2 input-base text-xs py-1.5" rows="2"></textarea>
              <div class="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-[11px] text-gray-600 mb-1">Fréquence de mise à dispo</label>
                  <input v-model="bms.data_provision_frequency" type="text"
                         placeholder="ex : temps réel, quotidien, hebdo, mensuel"
                         @input="saveBmsDebounced"
                         class="w-full text-xs px-2 py-1 border border-gray-200 rounded" />
                </div>
                <div>
                  <label class="block text-[11px] text-gray-600 mb-1">Format de sortie</label>
                  <input v-model="bms.data_provision_format" type="text"
                         placeholder="ex : CSV, PDF mensuel, dashboard web, API"
                         @input="saveBmsDebounced"
                         class="w-full text-xs px-2 py-1 border border-gray-200 rounded" />
                </div>
              </div>
            </template>
          </div>

          <div v-if="audit.isBacs && !bms.out_of_service" class="border-t border-gray-100 pt-3 space-y-4">
            <div>
              <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">R175-4 — Vérifications périodiques</h3>
              <label class="flex items-start gap-2 cursor-pointer text-sm">
                <input type="checkbox" v-model="bms.has_maintenance_procedures" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="mt-0.5 rounded" />
                <span>Consignes écrites des maintenances passées</span>
              </label>
              <div v-if="bms.has_maintenance_procedures" class="ml-6 mt-2 grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-[11px] text-gray-600 mb-1">Périodicité</label>
                  <input v-model="bms.maintenance_periodicity" type="text"
                         placeholder="ex : trimestrielle, semestrielle, annuelle"
                         @input="saveBmsDebounced"
                         class="w-full text-xs px-2 py-1 border border-gray-200 rounded" />
                </div>
                <div>
                  <label class="block text-[11px] text-gray-600 mb-1">Responsable</label>
                  <input v-model="bms.maintenance_responsible" type="text"
                         placeholder="ex : prestataire X, équipe interne, fournisseur GTB"
                         @input="saveBmsDebounced"
                         class="w-full text-xs px-2 py-1 border border-gray-200 rounded" />
                </div>
              </div>
            </div>
            <div>
              <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">R175-5 — Formation exploitant</h3>
              <label class="flex items-start gap-2 cursor-pointer text-sm">
                <input type="checkbox" v-model="bms.operator_trained" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="mt-0.5 rounded" />
                <span>Exploitant formé à l'utilisation de la supervision</span>
              </label>
              <div v-if="bms.operator_trained" class="ml-6 mt-2 grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-[11px] text-gray-600 mb-1">Date de formation</label>
                  <input v-model="bms.operator_training_date" type="date"
                         @input="saveBmsDebounced"
                         class="w-full text-xs px-2 py-1 border border-gray-200 rounded" />
                </div>
                <div>
                  <label class="block text-[11px] text-gray-600 mb-1">Organisme / formateur</label>
                  <input v-model="bms.operator_training_provider" type="text"
                         placeholder="ex : intégrateur GTB, fournisseur"
                         @input="saveBmsDebounced"
                         class="w-full text-xs px-2 py-1 border border-gray-200 rounded" />
                </div>
                <div class="col-span-2">
                  <label class="block text-[11px] text-gray-600 mb-1">Domaines couverts</label>
                  <input v-model="bms.operator_training_topics" type="text"
                         placeholder="ex : paramétrage des consignes, lecture des alarmes, escalade niveau 2"
                         @input="saveBmsDebounced"
                         class="w-full text-xs px-2 py-1 border border-gray-200 rounded" />
                </div>
              </div>
              <p v-if="(bms.existing_solution || '').toLowerCase().includes('buildy')" class="mt-2 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                ✓ Buildy : exigence R175-5 nativement couverte par le support utilisateur intégré
              </p>
            </div>
          </div>
        </div>
      </div>
    </PhotoDropzone>
  </CollapsibleSection>
</template>
