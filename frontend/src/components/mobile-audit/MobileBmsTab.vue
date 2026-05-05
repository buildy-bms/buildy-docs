<script setup>
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import {
  WrenchScrewdriverIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '@heroicons/vue/24/outline'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { updateBacsDevice, updateBacsMeter } from '@/api'
import MobileField from './MobileField.vue'
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import MeterTypePill from '@/components/MeterTypePill.vue'
import MeterUsagePill from '@/components/MeterUsagePill.vue'

const audit = useAuditStore()
const { document, bms, devices, meters, systems } = storeToRefs(audit)
const { error } = useNotification()

const isBacs = computed(() => (document.value?.kind || 'bacs_audit') === 'bacs_audit')

const SYSTEM_LABEL = {
  heating: 'Chauffage',
  cooling: 'Refroidissement',
  ventilation: 'Ventilation',
  dhw: 'ECS',
  lighting_indoor: 'Éclairage intérieur',
  lighting_outdoor: 'Éclairage extérieur',
  electricity_production: 'Production photovoltaïque',
}

let saveTimer = null
function saveDebounced() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try { await audit.saveBms() }
    catch { error('Sauvegarde GTB impossible') }
  }, 400)
}

async function patchDeviceBms(d, patch) {
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

async function patchMeterBms(m, patch) {
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

const devicesWithMeta = computed(() => {
  const sysById = new Map(systems.value.map(s => [s.id, s]))
  return devices.value.map(d => {
    const sys = sysById.get(d.system_id)
    return {
      ...d,
      system_category: sys?.system_category || '?',
      zone_name: sys?.zone_name || '?',
    }
  })
})

const metersPresent = computed(() => meters.value.filter(m => m.present_actual))

const USAGES = [
  { key: 'manages_heating', label: 'Chauffage' },
  { key: 'manages_cooling', label: 'Refroidissement' },
  { key: 'manages_ventilation', label: 'Ventilation' },
  { key: 'manages_dhw', label: 'ECS' },
  { key: 'manages_lighting', label: 'Éclairage' },
]
</script>

<template>
  <div class="p-3 pb-24 space-y-3">
    <!-- Header card -->
    <div class="bg-white rounded-2xl border border-gray-200 p-4">
      <div class="flex items-center gap-3">
        <div class="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 inline-flex items-center justify-center">
          <WrenchScrewdriverIcon class="w-6 h-6" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-base font-medium text-gray-900 truncate">
            {{ bms?.existing_solution || 'GTB non renseignée' }}
          </p>
          <p v-if="bms?.existing_solution_brand" class="text-xs text-gray-500 truncate mt-0.5">
            {{ bms.existing_solution_brand }}
          </p>
        </div>
      </div>
    </div>

    <!-- Hors-service toggle -->
    <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <label class="flex items-center justify-between gap-3 px-4 py-5 cursor-pointer">
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-red-600">GTB hors-service</p>
          <p class="text-xs text-gray-500 mt-0.5">
            Plan d'action ignore alors les exigences GTB
          </p>
        </div>
        <input
          type="checkbox"
          :checked="!!bms.out_of_service"
          @change="e => { bms.out_of_service = e.target.checked ? 1 : 0; saveDebounced() }"
          class="w-5 h-5"
        />
      </label>
    </div>

    <template v-if="!bms.out_of_service">
      <!-- Identification GTB -->
      <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div class="px-4 py-3 border-b border-gray-100">
          <h3 class="text-base font-medium text-gray-900">Solution en place</h3>
        </div>
        <div class="p-4 space-y-4">
          <MobileField label="Solution">
            <input
              v-model="bms.existing_solution"
              type="text"
              placeholder="ex : Schneider EcoStruxure, Niagara, Buildy"
              autocapitalize="words"
              @input="saveDebounced"
              class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
            />
          </MobileField>
          <MobileField label="Marque / éditeur">
            <input
              v-model="bms.existing_solution_brand"
              type="text"
              placeholder="—"
              autocapitalize="words"
              @input="saveDebounced"
              class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
            />
          </MobileField>
          <MobileField label="Référence modèle">
            <input
              v-model="bms.model_reference"
              type="text"
              placeholder="ex : JACE 8000"
              @input="saveDebounced"
              class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
            />
          </MobileField>
          <MobileField label="Localisation">
            <input
              v-model="bms.location"
              type="text"
              placeholder="ex : Local technique sous-sol"
              autocapitalize="sentences"
              @input="saveDebounced"
              class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
            />
          </MobileField>
        </div>
      </div>

      <!-- Usages traités -->
      <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div class="px-4 py-3 border-b border-gray-100">
          <h3 class="text-base font-medium text-gray-900">Usages traités par la GTB</h3>
        </div>
        <div class="p-2">
          <label
            v-for="u in USAGES"
            :key="u.key"
            class="flex items-center justify-between gap-3 px-3 py-3 cursor-pointer rounded-xl active:bg-gray-50"
          >
            <span class="text-sm text-gray-800 font-medium">{{ u.label }}</span>
            <input
              type="checkbox"
              :checked="!!bms[u.key]"
              @change="e => { bms[u.key] = e.target.checked ? 1 : 0; saveDebounced() }"
              class="w-5 h-5"
            />
          </label>
        </div>
      </div>

      <!-- R175-3 Capacités (BACS uniquement) -->
      <template v-if="isBacs">
        <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div class="px-4 py-3 border-b border-gray-100">
            <h3 class="text-base font-medium text-gray-900">Capacités R175-3</h3>
          </div>
          <div class="p-4 space-y-3">
            <label class="flex items-start justify-between gap-3 cursor-pointer">
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-gray-900">P1 — Suivi continu</p>
                <p class="text-xs text-gray-500 mt-0.5">Pas horaire par zone, conservation 5 ans</p>
              </div>
              <input
                type="checkbox"
                :checked="!!bms.meets_r175_3_p1"
                @change="e => { bms.meets_r175_3_p1 = e.target.checked ? 1 : 0; saveDebounced() }"
                class="w-5 h-5 mt-1"
              />
            </label>
            <div v-if="bms.meets_r175_3_p1" class="ml-2 pl-3 border-l-2 border-gray-100 space-y-2">
              <input
                v-model="bms.r175_3_p1_archival_format"
                type="text"
                placeholder="Format d'archivage : CSV, SQL, API…"
                @input="saveDebounced"
                class="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm"
              />
              <label class="flex items-center justify-between gap-3 cursor-pointer text-xs text-gray-700">
                <span>Rétention 5 ans vérifiée sur place</span>
                <input
                  type="checkbox"
                  :checked="!!bms.r175_3_p1_retention_verified"
                  @change="e => { bms.r175_3_p1_retention_verified = e.target.checked ? 1 : 0; saveDebounced() }"
                  class="w-5 h-5"
                />
              </label>
            </div>

            <div class="border-t border-gray-100 pt-3"></div>

            <label class="flex items-start justify-between gap-3 cursor-pointer">
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-gray-900">P2 — Détection des dérives</p>
                <p class="text-xs text-gray-500 mt-0.5">Alertes en cas de pertes d'efficacité</p>
              </div>
              <input
                type="checkbox"
                :checked="!!bms.meets_r175_3_p2"
                @change="e => { bms.meets_r175_3_p2 = e.target.checked ? 1 : 0; saveDebounced() }"
                class="w-5 h-5 mt-1"
              />
            </label>
            <div v-if="bms.meets_r175_3_p2" class="ml-2 pl-3 border-l-2 border-gray-100">
              <textarea
                v-model="bms.r175_3_p2_anomaly_rules_html"
                @input="saveDebounced"
                rows="2"
                placeholder="Règles / seuils / alertes actives…"
                class="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm"
              ></textarea>
            </div>
          </div>
        </div>

        <!-- R175-3 Mise à dispo des données -->
        <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div class="px-4 py-3 border-b border-gray-100">
            <h3 class="text-base font-medium text-gray-900">Mise à disposition des données</h3>
          </div>
          <div class="p-4 space-y-3">
            <label class="flex items-start justify-between gap-3 cursor-pointer">
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-gray-900">Au gestionnaire du bâtiment</p>
              </div>
              <input
                type="checkbox"
                :checked="!!bms.data_provision_to_manager"
                @change="e => { bms.data_provision_to_manager = e.target.checked ? 1 : 0; saveDebounced() }"
                class="w-5 h-5 mt-1"
              />
            </label>
            <label class="flex items-start justify-between gap-3 cursor-pointer">
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-gray-900">Aux exploitants des systèmes techniques</p>
              </div>
              <input
                type="checkbox"
                :checked="!!bms.data_provision_to_operators"
                @change="e => { bms.data_provision_to_operators = e.target.checked ? 1 : 0; saveDebounced() }"
                class="w-5 h-5 mt-1"
              />
            </label>
            <template v-if="bms.data_provision_to_manager || bms.data_provision_to_operators">
              <input
                v-model="bms.data_provision_frequency"
                type="text"
                placeholder="Fréquence : temps réel, quotidien…"
                @input="saveDebounced"
                class="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm"
              />
              <input
                v-model="bms.data_provision_format"
                type="text"
                placeholder="Format : CSV, dashboard, API…"
                @input="saveDebounced"
                class="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm"
              />
            </template>
          </div>
        </div>

        <!-- R175-4 Maintenance -->
        <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div class="px-4 py-3 border-b border-gray-100">
            <h3 class="text-base font-medium text-gray-900">R175-4 — Maintenance</h3>
          </div>
          <div class="p-4 space-y-3">
            <label class="flex items-start justify-between gap-3 cursor-pointer">
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-gray-900">Consignes écrites des maintenances</p>
              </div>
              <input
                type="checkbox"
                :checked="!!bms.has_maintenance_procedures"
                @change="e => { bms.has_maintenance_procedures = e.target.checked ? 1 : 0; saveDebounced() }"
                class="w-5 h-5 mt-1"
              />
            </label>
            <template v-if="bms.has_maintenance_procedures">
              <input
                v-model="bms.maintenance_periodicity"
                type="text"
                placeholder="Périodicité : trimestrielle, annuelle…"
                @input="saveDebounced"
                class="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm"
              />
              <input
                v-model="bms.maintenance_responsible"
                type="text"
                placeholder="Responsable : prestataire, équipe interne…"
                @input="saveDebounced"
                class="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm"
              />
            </template>
          </div>
        </div>

        <!-- R175-5 Formation -->
        <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div class="px-4 py-3 border-b border-gray-100">
            <h3 class="text-base font-medium text-gray-900">R175-5 — Formation exploitant</h3>
          </div>
          <div class="p-4 space-y-3">
            <label class="flex items-start justify-between gap-3 cursor-pointer">
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-gray-900">Exploitant formé</p>
              </div>
              <input
                type="checkbox"
                :checked="!!bms.operator_trained"
                @change="e => { bms.operator_trained = e.target.checked ? 1 : 0; saveDebounced() }"
                class="w-5 h-5 mt-1"
              />
            </label>
            <template v-if="bms.operator_trained">
              <MobileField label="Date de formation">
                <input
                  v-model="bms.operator_training_date"
                  type="date"
                  @input="saveDebounced"
                  class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
                />
              </MobileField>
              <MobileField label="Organisme / formateur">
                <input
                  v-model="bms.operator_training_provider"
                  type="text"
                  placeholder="ex : intégrateur GTB"
                  @input="saveDebounced"
                  class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
                />
              </MobileField>
            </template>
          </div>
        </div>
      </template>

      <!-- Équipements intégrés -->
      <div v-if="devicesWithMeta.length" class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div class="px-4 py-3 border-b border-gray-100">
          <h3 class="text-base font-medium text-gray-900">Équipements intégrés à la GTB</h3>
          <p class="text-xs text-gray-500 mt-0.5">« Opérationnel » = vérifié sur place</p>
        </div>
        <div class="divide-y divide-gray-100">
          <div
            v-for="d in devicesWithMeta"
            :key="d.id"
            :class="['px-4 py-3', d.out_of_service ? 'opacity-50' : '', d.bms_integration_out_of_service ? 'bg-red-50/40' : '']"
          >
            <div class="flex items-center gap-2 mb-2">
              <SystemCategoryIcon :category="d.system_category" size="sm" />
              <p class="flex-1 min-w-0 text-sm font-medium text-gray-900 truncate">
                {{ d.name || d.brand || d.model_reference || 'Sans nom' }}
              </p>
            </div>
            <p class="text-xs text-gray-500 mb-2">{{ SYSTEM_LABEL[d.system_category] || d.system_category }} · {{ d.zone_name }}</p>
            <div class="flex items-center gap-3">
              <label class="flex-1 inline-flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 rounded-xl cursor-pointer">
                <span class="text-xs font-medium text-gray-700">Intégré</span>
                <input
                  type="checkbox"
                  :checked="!!d.managed_by_bms"
                  :disabled="d.out_of_service"
                  @change="e => patchDeviceBms(d, { managed_by_bms: e.target.checked })"
                  class="w-5 h-5"
                />
              </label>
              <label
                :class="['flex-1 inline-flex items-center justify-between gap-2 px-3 py-2 rounded-xl cursor-pointer',
                         (!d.managed_by_bms || !d.wired) ? 'bg-gray-50 opacity-50' : 'bg-emerald-50']"
              >
                <span class="text-xs font-medium text-gray-700">Opérationnel</span>
                <input
                  type="checkbox"
                  :checked="d.managed_by_bms && d.wired && !d.bms_integration_out_of_service"
                  :disabled="!d.managed_by_bms || !d.wired"
                  @change="e => patchDeviceBms(d, { bms_integration_out_of_service: !e.target.checked })"
                  class="w-5 h-5 accent-emerald-500"
                />
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- Compteurs intégrés -->
      <div v-if="metersPresent.length" class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div class="px-4 py-3 border-b border-gray-100">
          <h3 class="text-base font-medium text-gray-900">Compteurs intégrés à la GTB</h3>
          <p class="text-xs text-gray-500 mt-0.5">Uniquement les compteurs présents</p>
        </div>
        <div class="divide-y divide-gray-100">
          <div
            v-for="m in metersPresent"
            :key="m.id"
            :class="['px-4 py-3', m.out_of_service ? 'opacity-50' : '', m.bms_integration_out_of_service ? 'bg-red-50/40' : '']"
          >
            <div class="flex items-center gap-2 mb-2 flex-wrap">
              <MeterTypePill :type="m.meter_type" />
              <MeterUsagePill :usage="m.usage" />
              <span class="text-xs text-gray-500">{{ m.zone_name || 'général' }}</span>
            </div>
            <div class="flex items-center gap-3">
              <label
                :class="['flex-1 inline-flex items-center justify-between gap-2 px-3 py-2 rounded-xl cursor-pointer',
                         !m.communicating ? 'bg-gray-50 opacity-50' : 'bg-gray-50']"
              >
                <span class="text-xs font-medium text-gray-700">Intégré</span>
                <input
                  type="checkbox"
                  :checked="!!m.managed_by_bms"
                  :disabled="m.out_of_service || !m.communicating"
                  @change="e => patchMeterBms(m, { managed_by_bms: e.target.checked })"
                  class="w-5 h-5"
                />
              </label>
              <label
                :class="['flex-1 inline-flex items-center justify-between gap-2 px-3 py-2 rounded-xl cursor-pointer',
                         (!m.managed_by_bms || !m.wired) ? 'bg-gray-50 opacity-50' : 'bg-emerald-50']"
              >
                <span class="text-xs font-medium text-gray-700">Opérationnel</span>
                <input
                  type="checkbox"
                  :checked="m.managed_by_bms && m.wired && !m.bms_integration_out_of_service"
                  :disabled="!m.managed_by_bms || !m.wired"
                  @change="e => patchMeterBms(m, { bms_integration_out_of_service: !e.target.checked })"
                  class="w-5 h-5 accent-emerald-500"
                />
              </label>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
