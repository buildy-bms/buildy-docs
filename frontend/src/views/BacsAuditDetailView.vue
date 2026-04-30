<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  ArrowLeftIcon, BuildingOffice2Icon, MapPinIcon, ExclamationTriangleIcon,
  CheckCircleIcon, ArrowPathIcon, DocumentArrowDownIcon, PlusIcon, TrashIcon,
  WrenchScrewdriverIcon, BoltIcon, FireIcon,
} from '@heroicons/vue/24/outline'
import {
  getAf, getSite,
  getBacsSystems, updateBacsSystem,
  getBacsMeters, createBacsMeter, updateBacsMeter, deleteBacsMeter,
  getBacsBms, updateBacsBms,
  getBacsThermal, updateBacsThermal,
  getBacsActionItems, regenerateBacsActionItems, updateBacsActionItem,
  getBacsActionItemsCsvUrl,
} from '@/api'
import { useNotification } from '@/composables/useNotification'

const router = useRouter()
const route = useRoute()
const { success, error } = useNotification()

const docId = parseInt(route.params.id, 10)

const document = ref(null)
const site = ref(null)
const loading = ref(true)
const systems = ref([])
const meters = ref([])
const bms = ref({})
const thermal = ref([])
const actionItems = ref([])

const SYSTEM_LABEL = {
  heating: 'Chauffage',
  cooling: 'Refroidissement',
  ventilation: 'Ventilation',
  dhw: 'ECS',
  lighting_indoor: 'Éclairage intérieur',
  lighting_outdoor: 'Éclairage extérieur',
  electricity_production: 'Production électrique',
}
const COMM_OPTIONS = [
  { value: null, label: '—' },
  { value: 'modbus_tcp', label: 'Modbus TCP' },
  { value: 'modbus_rtu', label: 'Modbus RTU' },
  { value: 'bacnet_ip', label: 'BACnet IP' },
  { value: 'bacnet_mstp', label: 'BACnet MS/TP' },
  { value: 'knx', label: 'KNX' },
  { value: 'mbus', label: 'M-Bus' },
  { value: 'mqtt', label: 'MQTT' },
  { value: 'autre', label: 'Autre' },
  { value: 'non_communicant', label: 'Non communicant' },
  { value: 'absent', label: 'Absent' },
]
const REGULATION_OPTIONS = [
  { value: null, label: '—' },
  { value: 'per_room', label: 'Par pièce' },
  { value: 'per_zone', label: 'Par zone' },
  { value: 'central_only', label: 'Centrale uniquement' },
  { value: 'none', label: 'Aucune' },
]
const GENERATOR_OPTIONS = [
  { value: null, label: '—' },
  { value: 'gas', label: 'Gaz' },
  { value: 'electric', label: 'Effet Joule' },
  { value: 'heat_pump', label: 'Pompe à chaleur' },
  { value: 'wood_appliance', label: 'Appareil bois (exempté R175-6)' },
  { value: 'district_heating', label: 'Réseau de chaleur' },
  { value: 'other', label: 'Autre' },
]
const SEVERITY_LABEL = {
  blocking: { label: 'Bloquante', cls: 'bg-red-100 text-red-700 border-red-300' },
  major: { label: 'Majeure', cls: 'bg-orange-100 text-orange-700 border-orange-300' },
  minor: { label: 'Mineure', cls: 'bg-yellow-100 text-yellow-700 border-yellow-300' },
}
const STATUS_LABEL = {
  open: 'Ouverte',
  quoted: 'Chiffrée',
  in_progress: 'En cours',
  done: 'Terminée',
  declined: 'Refusée',
}

const systemsByZone = computed(() => {
  const groups = new Map()
  for (const s of systems.value) {
    const k = s.zone_id
    if (!groups.has(k)) groups.set(k, { zone_name: s.zone_name, zone_nature: s.zone_nature, items: [] })
    groups.get(k).items.push(s)
  }
  return [...groups.values()]
})

const itemsBySeverity = computed(() => {
  const out = { blocking: [], major: [], minor: [] }
  for (const it of actionItems.value) {
    if (it.status === 'done' || it.status === 'declined') continue
    out[it.severity]?.push(it)
  }
  return out
})

async function refresh() {
  loading.value = true
  try {
    const [d, s, m, b, t, a] = await Promise.all([
      getAf(docId), getBacsSystems(docId), getBacsMeters(docId),
      getBacsBms(docId), getBacsThermal(docId), getBacsActionItems(docId),
    ])
    document.value = d.data
    if (d.data.site_id) {
      const siteRes = await getSite(d.data.site_id ? '' : '') // bypass : on charge via le picker en data complementaire
      // Note : getSite prend un uuid, pas un site_id. On laisse undefined en MVP.
    }
    systems.value = s.data
    meters.value = m.data
    bms.value = b.data || {}
    thermal.value = t.data
    actionItems.value = a.data
  } catch (e) {
    error('Échec du chargement de l\'audit BACS')
  } finally {
    loading.value = false
  }
}

async function patchSystem(s, patch) {
  try {
    const { data } = await updateBacsSystem(s.id, patch)
    Object.assign(s, data)
    // Recharge action items (potentiellement modifies par regen)
    const a = await getBacsActionItems(docId)
    actionItems.value = a.data
  } catch {
    error('Sauvegarde impossible')
  }
}

async function patchThermal(t, patch) {
  try {
    const { data } = await updateBacsThermal(t.id, patch)
    Object.assign(t, data)
    const a = await getBacsActionItems(docId)
    actionItems.value = a.data
  } catch {
    error('Sauvegarde impossible')
  }
}

let bmsSaveTimer = null
function saveBmsDebounced() {
  clearTimeout(bmsSaveTimer)
  bmsSaveTimer = setTimeout(async () => {
    try {
      await updateBacsBms(docId, bms.value)
      const a = await getBacsActionItems(docId)
      actionItems.value = a.data
    } catch {
      error('Sauvegarde GTB impossible')
    }
  }, 500)
}

async function patchActionItem(item, patch) {
  try {
    const { data } = await updateBacsActionItem(item.id, patch)
    Object.assign(item, data)
  } catch {
    error('Sauvegarde action impossible')
  }
}

async function regenerate() {
  try {
    const { data } = await regenerateBacsActionItems(docId)
    success(`Régénération : +${data.added} nouvelles, ${data.updated} synchronisées, ${data.resolved} résolues`)
    const a = await getBacsActionItems(docId)
    actionItems.value = a.data
  } catch {
    error('Régénération impossible')
  }
}

function downloadCsv() {
  window.location.href = getBacsActionItemsCsvUrl(docId)
}

onMounted(refresh)
</script>

<template>
  <div class="max-w-6xl mx-auto pb-12">
    <!-- Header -->
    <div class="flex items-start justify-between mb-6">
      <div>
        <button @click="router.push('/')" class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-2">
          <ArrowLeftIcon class="w-4 h-4" /> Retour
        </button>
        <h1 class="text-2xl font-semibold text-gray-800 flex items-center gap-2">
          <FireIcon class="w-6 h-6 text-orange-500" />
          Audit BACS — {{ document?.project_name || '…' }}
        </h1>
        <p class="text-sm text-gray-500 mt-1">
          {{ document?.client_name }}
          <span v-if="document?.bacs_applicable_deadline" class="ml-2 text-amber-700">
            • Échéance R175 : {{ document.bacs_applicable_deadline }}
          </span>
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button @click="regenerate" class="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
          <ArrowPathIcon class="w-4 h-4" /> Régénérer le plan
        </button>
        <button @click="downloadCsv" class="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">
          <DocumentArrowDownIcon class="w-4 h-4" /> CSV pour devis
        </button>
      </div>
    </div>

    <div v-if="loading" class="text-center py-12 text-gray-400 text-sm">Chargement…</div>

    <div v-else class="space-y-6">
      <!-- Synthese severities -->
      <div class="grid grid-cols-3 gap-3">
        <div v-for="sev in ['blocking','major','minor']" :key="sev"
             :class="['rounded-lg border p-4', SEVERITY_LABEL[sev].cls]">
          <div class="text-xs font-medium uppercase tracking-wider opacity-70">{{ SEVERITY_LABEL[sev].label }}</div>
          <div class="text-3xl font-semibold mt-1">{{ itemsBySeverity[sev].length }}</div>
          <div class="text-[11px] opacity-70 mt-0.5">action{{ itemsBySeverity[sev].length > 1 ? 's' : '' }} ouverte{{ itemsBySeverity[sev].length > 1 ? 's' : '' }}</div>
        </div>
      </div>

      <!-- Systemes par zone (R175-1 §4) -->
      <section class="bg-white border border-gray-200 rounded-lg shadow-sm">
        <header class="px-5 py-3 border-b border-gray-200 flex items-center gap-2">
          <BoltIcon class="w-5 h-5 text-indigo-600" />
          <h2 class="text-base font-semibold text-gray-800">Systèmes techniques par zone</h2>
          <span class="text-xs text-gray-500">R175-1 §4</span>
        </header>
        <div class="divide-y divide-gray-100">
          <div v-for="g in systemsByZone" :key="g.zone_name" class="px-5 py-3">
            <div class="flex items-center gap-2 mb-2">
              <MapPinIcon class="w-4 h-4 text-gray-400" />
              <span class="font-medium text-sm text-gray-800">{{ g.zone_name }}</span>
              <span v-if="g.zone_nature" class="text-[11px] text-gray-500">{{ g.zone_nature }}</span>
            </div>
            <table class="w-full text-sm">
              <thead class="text-xs uppercase text-gray-500 tracking-wider">
                <tr>
                  <th class="text-left py-1.5">Catégorie</th>
                  <th class="text-left py-1.5 w-28">Présent ?</th>
                  <th class="text-left py-1.5 w-44">Communication</th>
                  <th class="text-left py-1.5">Notes</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in g.items" :key="s.id" class="border-t border-gray-100">
                  <td class="py-1.5 text-gray-700">{{ SYSTEM_LABEL[s.system_category] || s.system_category }}</td>
                  <td class="py-1.5">
                    <input type="checkbox" :checked="!!s.present"
                           @change="e => patchSystem(s, { present: e.target.checked })"
                           class="rounded border-gray-300" />
                  </td>
                  <td class="py-1.5">
                    <select :value="s.communication"
                            @change="e => patchSystem(s, { communication: e.target.value || null })"
                            class="text-xs px-2 py-1 border border-gray-200 rounded">
                      <option v-for="o in COMM_OPTIONS" :key="o.value || 'null'" :value="o.value">{{ o.label }}</option>
                    </select>
                  </td>
                  <td class="py-1.5">
                    <input type="text" :value="s.notes" placeholder="—"
                           @blur="e => patchSystem(s, { notes: e.target.value || null })"
                           class="w-full text-xs px-2 py-1 border border-gray-200 rounded" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="!systemsByZone.length" class="px-5 py-6 text-center text-sm text-gray-500">
            Aucune zone définie pour ce site. Ajoute-en depuis la fiche site.
          </div>
        </div>
      </section>

      <!-- Régulation thermique (R175-6) -->
      <section class="bg-white border border-gray-200 rounded-lg shadow-sm">
        <header class="px-5 py-3 border-b border-gray-200 flex items-center gap-2">
          <FireIcon class="w-5 h-5 text-red-500" />
          <h2 class="text-base font-semibold text-gray-800">Régulation thermique automatique</h2>
          <span class="text-xs text-gray-500">R175-6</span>
        </header>
        <table class="w-full text-sm">
          <thead class="text-xs uppercase text-gray-500 tracking-wider bg-gray-50">
            <tr>
              <th class="text-left px-5 py-2">Zone</th>
              <th class="text-left py-2 w-32">Régulation auto ?</th>
              <th class="text-left py-2 w-40">Type de régulation</th>
              <th class="text-left py-2 w-44">Type générateur</th>
              <th class="text-left py-2 w-24">Âge (ans)</th>
              <th class="text-left px-5 py-2">Notes</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="t in thermal" :key="t.id">
              <td class="px-5 py-2 text-gray-700">{{ t.zone_name }}</td>
              <td class="py-2">
                <input type="checkbox" :checked="!!t.has_automatic_regulation"
                       @change="e => patchThermal(t, { has_automatic_regulation: e.target.checked })"
                       class="rounded border-gray-300" />
              </td>
              <td class="py-2">
                <select :value="t.regulation_type"
                        @change="e => patchThermal(t, { regulation_type: e.target.value || null })"
                        class="text-xs px-2 py-1 border border-gray-200 rounded">
                  <option v-for="o in REGULATION_OPTIONS" :key="o.value || 'null'" :value="o.value">{{ o.label }}</option>
                </select>
              </td>
              <td class="py-2">
                <select :value="t.generator_type"
                        @change="e => patchThermal(t, { generator_type: e.target.value || null })"
                        class="text-xs px-2 py-1 border border-gray-200 rounded">
                  <option v-for="o in GENERATOR_OPTIONS" :key="o.value || 'null'" :value="o.value">{{ o.label }}</option>
                </select>
              </td>
              <td class="py-2">
                <input type="number" :value="t.generator_age_years" min="0"
                       @blur="e => patchThermal(t, { generator_age_years: e.target.value ? parseInt(e.target.value, 10) : null })"
                       class="w-16 text-xs px-2 py-1 border border-gray-200 rounded" />
              </td>
              <td class="px-5 py-2">
                <input type="text" :value="t.notes" placeholder="—"
                       @blur="e => patchThermal(t, { notes: e.target.value || null })"
                       class="w-full text-xs px-2 py-1 border border-gray-200 rounded" />
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- GTB / GTC (R175-3 / R175-4 / R175-5) -->
      <section class="bg-white border border-gray-200 rounded-lg shadow-sm">
        <header class="px-5 py-3 border-b border-gray-200 flex items-center gap-2">
          <WrenchScrewdriverIcon class="w-5 h-5 text-purple-600" />
          <h2 class="text-base font-semibold text-gray-800">Solution GTB / GTC en place</h2>
          <span class="text-xs text-gray-500">R175-3 + R175-4 + R175-5</span>
        </header>
        <div class="px-5 py-4 space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Solution en place</label>
              <input v-model="bms.existing_solution" type="text" placeholder="ex : Niagara, Schneider EcoStruxure, Buildy…"
                     @input="saveBmsDebounced"
                     class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Marque / éditeur</label>
              <input v-model="bms.existing_solution_brand" type="text" placeholder="—"
                     @input="saveBmsDebounced"
                     class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
          </div>

          <div class="border-t border-gray-100 pt-3">
            <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">R175-3 — 4 exigences fonctionnelles</h3>
            <div class="space-y-2 text-sm">
              <label class="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" v-model="bms.meets_r175_3_p1" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="mt-0.5 rounded" />
                <span><strong>P1.</strong> Suivi continu par zone, pas horaire, conservation 5 ans</span>
              </label>
              <label class="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" v-model="bms.meets_r175_3_p2" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="mt-0.5 rounded" />
                <span><strong>P2.</strong> Détection des pertes d'efficacité</span>
              </label>
              <label class="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" v-model="bms.meets_r175_3_p3" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="mt-0.5 rounded" />
                <span><strong>P3.</strong> Interopérabilité multi-systèmes (BACnet / Modbus / KNX / M-Bus / MQTT)</span>
              </label>
              <label class="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" v-model="bms.meets_r175_3_p4" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="mt-0.5 rounded" />
                <span><strong>P4.</strong> Arrêt manuel + gestion autonome ensuite</span>
              </label>
            </div>
          </div>

          <div class="border-t border-gray-100 pt-3 grid grid-cols-2 gap-4">
            <div>
              <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">R175-4 — Vérifications périodiques</h3>
              <label class="flex items-start gap-2 cursor-pointer text-sm">
                <input type="checkbox" v-model="bms.has_maintenance_procedures" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="mt-0.5 rounded" />
                <span>Consignes écrites de maintenance présentes</span>
              </label>
            </div>
            <div>
              <h3 class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">R175-5 — Formation exploitant</h3>
              <label class="flex items-start gap-2 cursor-pointer text-sm">
                <input type="checkbox" v-model="bms.operator_trained" :true-value="1" :false-value="0" @change="saveBmsDebounced" class="mt-0.5 rounded" />
                <span>Exploitant formé au paramétrage</span>
              </label>
              <p v-if="(bms.existing_solution || '').toLowerCase().includes('buildy')" class="mt-2 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                ✓ Buildy : exigence R175-5 nativement couverte par le support utilisateur intégré
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- Plan de mise en conformité -->
      <section class="bg-white border border-gray-200 rounded-lg shadow-sm">
        <header class="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <ExclamationTriangleIcon class="w-5 h-5 text-orange-500" />
            <h2 class="text-base font-semibold text-gray-800">Plan de mise en conformité</h2>
            <span class="text-xs text-gray-500">{{ actionItems.length }} action{{ actionItems.length > 1 ? 's' : '' }}</span>
          </div>
        </header>
        <table class="w-full text-sm">
          <thead class="text-xs uppercase text-gray-500 tracking-wider bg-gray-50">
            <tr>
              <th class="text-left px-3 py-2 w-24">Sévérité</th>
              <th class="text-left py-2 w-24">Article</th>
              <th class="text-left py-2">Action</th>
              <th class="text-left py-2 w-28">Zone</th>
              <th class="text-left py-2 w-28">Effort</th>
              <th class="text-left py-2 w-28">Statut</th>
              <th class="text-left px-3 py-2 w-56">Notes commerciales</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="it in actionItems" :key="it.id"
                :class="['transition', it.status === 'done' || it.status === 'declined' ? 'opacity-50' : '']">
              <td class="px-3 py-2">
                <span :class="['inline-block px-2 py-0.5 text-[10px] font-medium rounded border', SEVERITY_LABEL[it.severity].cls]">
                  {{ SEVERITY_LABEL[it.severity].label }}
                </span>
              </td>
              <td class="py-2 text-[11px] text-gray-500 font-mono">{{ it.r175_article || '—' }}</td>
              <td class="py-2">
                <div class="text-gray-800">{{ it.title }}</div>
                <div v-if="it.description" class="text-[11px] text-gray-500 mt-0.5">{{ it.description }}</div>
              </td>
              <td class="py-2 text-xs text-gray-600">{{ it.zone_name || '—' }}</td>
              <td class="py-2">
                <select :value="it.estimated_effort"
                        @change="e => patchActionItem(it, { estimated_effort: e.target.value || null })"
                        class="text-xs px-2 py-1 border border-gray-200 rounded">
                  <option :value="null">—</option>
                  <option value="low">Faible</option>
                  <option value="medium">Moyen</option>
                  <option value="high">Élevé</option>
                </select>
              </td>
              <td class="py-2">
                <select :value="it.status"
                        @change="e => patchActionItem(it, { status: e.target.value })"
                        class="text-xs px-2 py-1 border border-gray-200 rounded">
                  <option v-for="(label, val) in STATUS_LABEL" :key="val" :value="val">{{ label }}</option>
                </select>
              </td>
              <td class="px-3 py-2">
                <input type="text" :value="it.commercial_notes" placeholder="ref produit, prix estimé…"
                       @blur="e => patchActionItem(it, { commercial_notes: e.target.value || null })"
                       class="w-full text-xs px-2 py-1 border border-gray-200 rounded" />
              </td>
            </tr>
            <tr v-if="!actionItems.length">
              <td colspan="7" class="py-10 text-center">
                <CheckCircleIcon class="w-10 h-10 text-emerald-500 mx-auto" />
                <p class="mt-2 text-sm text-gray-700 font-medium">Aucune action corrective à ce stade</p>
                <p class="text-xs text-gray-500">Saisis les systèmes et la GTB ci-dessus pour générer le plan.</p>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </div>
</template>
