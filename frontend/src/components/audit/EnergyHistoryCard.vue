<script setup>
// Item 13 — Base de consommations mensuelles de référence.
// Carte autonome réutilisée en desktop (IdentificationSection) et en
// mobile (MobileSiteTab). L'auditeur saisit 12 à 24 mois de consommation
// par énergie depuis les factures du client / des locataires :
//  - saisie ligne par ligne
//  - import par collage (Excel) ou CSV — lignes parsées côté client
//  - rattachement d'une facture à un preneur (parties prenantes)
//  - upload des factures PDF en pièces jointes
import { ref, computed, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import {
  getSiteEnergyHistory, createSiteEnergyHistory, importSiteEnergyHistory,
  updateSiteEnergyHistory, deleteSiteEnergyHistory,
  uploadSiteDocument, getSiteDocumentDownloadUrl,
} from '@/api'
import { ENERGY_HISTORY_TYPES, MONTH_LABELS } from '@/lib/audit-options'

// `flush` : rendu en sous-section (sans chrome de card) quand imbriquée.
defineProps({
  flush: { type: Boolean, default: false },
})

const audit = useAuditStore()
const { site } = storeToRefs(audit)
const { error, success } = useNotification()

const rows = ref([])
// Preneurs : dérivés de la liste partagée des parties prenantes du site
// (store) — filtrés sur le genre « locataire ». Toujours à jour.
const tenants = computed(() => (audit.siteParties || []).filter(p => p.kind === 'tenant'))
const loading = ref(false)
const adding = ref(false)
const importing = ref(false)
const pasteText = ref('')

const currentYear = new Date().getFullYear()
const newRow = ref({
  energy_type: 'electricity',
  year: currentYear,
  month: 1,
  quantity: null,
  unit: 'kWh',
  cost_eur: null,
  tenant_id: null,
  contract_label: '',
})

const siteUuid = () => site.value?.site_uuid || site.value?.uuid || audit.document?.site_uuid

const energyMeta = (type) => ENERGY_HISTORY_TYPES.find(e => e.value === type) || ENERGY_HISTORY_TYPES[0]
const energyLabel = (type) => energyMeta(type).label
const monthLabel = (m) => MONTH_LABELS[m - 1] || m

// Regroupe les lignes par (énergie + contrat) pour un affichage lisible :
// chaque groupe = un compteur suivi sur N mois.
const groups = computed(() => {
  const map = new Map()
  for (const r of rows.value) {
    const key = `${r.energy_type}::${r.contract_label || ''}`
    if (!map.has(key)) {
      map.set(key, {
        key,
        energy_type: r.energy_type,
        contract_label: r.contract_label || '',
        rows: [],
      })
    }
    map.get(key).rows.push(r)
  }
  return [...map.values()].map(g => {
    const total = g.rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0)
    const cost = g.rows.reduce((s, r) => s + (Number(r.cost_eur) || 0), 0)
    return {
      ...g,
      total: Math.round(total),
      cost: cost > 0 ? Math.round(cost) : null,
      unit: g.rows[0]?.unit || 'kWh',
      monthsCount: g.rows.length,
    }
  })
})

async function loadHistory() {
  const uuid = siteUuid()
  if (!uuid) return
  loading.value = true
  try {
    const { data } = await getSiteEnergyHistory(uuid)
    rows.value = data || []
  } catch {
    error('Chargement de l\'historique de consommation impossible')
  } finally {
    loading.value = false
  }
}

onMounted(loadHistory)
watch(() => site.value?.site_uuid, loadHistory)

// Adapte l'unité par défaut quand on change le type d'énergie.
watch(() => newRow.value.energy_type, (t) => {
  newRow.value.unit = energyMeta(t).defaultUnit
})

async function addRow() {
  const uuid = siteUuid()
  if (!uuid) return
  if (newRow.value.quantity == null || newRow.value.quantity === '') {
    return error('Quantité requise')
  }
  try {
    const { data } = await createSiteEnergyHistory(uuid, {
      energy_type: newRow.value.energy_type,
      year: Number(newRow.value.year),
      month: Number(newRow.value.month),
      quantity: Number(newRow.value.quantity),
      unit: newRow.value.unit || 'kWh',
      cost_eur: newRow.value.cost_eur != null && newRow.value.cost_eur !== ''
        ? Number(newRow.value.cost_eur) : null,
      tenant_id: newRow.value.tenant_id || null,
      contract_label: newRow.value.contract_label.trim(),
    })
    rows.value.push(data)
    // On garde le contexte (énergie, contrat, preneur, année) pour
    // enchaîner la saisie du mois suivant.
    newRow.value.month = newRow.value.month < 12 ? newRow.value.month + 1 : 1
    newRow.value.quantity = null
    newRow.value.cost_eur = null
    success('Consommation enregistrée')
  } catch (e) {
    error(e.response?.data?.detail || 'Ajout impossible')
  }
}

async function patchRow(row, patch) {
  Object.assign(row, patch)
  try { await updateSiteEnergyHistory(row.id, patch) }
  catch (e) { error(e.response?.data?.detail || 'Sauvegarde impossible') }
}

async function removeRow(row) {
  if (!confirm(`Supprimer la consommation de ${monthLabel(row.month)} ${row.year} ?`)) return
  try {
    await deleteSiteEnergyHistory(row.id)
    rows.value = rows.value.filter(r => r.id !== row.id)
  } catch {
    error('Suppression impossible')
  }
}

// Parse un collage Excel / CSV. Format attendu d'une ligne (tab ou ;) :
//   année  mois  quantité  [coût]
// Le type d'énergie + contrat + preneur du formulaire d'import s'appliquent
// à toutes les lignes collées.
function parsePastedRows() {
  const out = []
  const lines = pasteText.value.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  for (const line of lines) {
    const cells = line.split(/[\t;,]/).map(c => c.trim())
    if (cells.length < 3) continue
    const year = parseInt(cells[0], 10)
    const month = parseInt(cells[1], 10)
    const quantity = parseFloat(String(cells[2]).replace(/\s/g, '').replace(',', '.'))
    if (!year || !month || month < 1 || month > 12 || !Number.isFinite(quantity)) continue
    const cost = cells[3] != null && cells[3] !== ''
      ? parseFloat(String(cells[3]).replace(/\s/g, '').replace(',', '.'))
      : null
    out.push({
      energy_type: newRow.value.energy_type,
      year, month, quantity,
      unit: newRow.value.unit || 'kWh',
      cost_eur: Number.isFinite(cost) ? cost : null,
      tenant_id: newRow.value.tenant_id || null,
      contract_label: newRow.value.contract_label.trim(),
    })
  }
  return out
}

async function doImport() {
  const uuid = siteUuid()
  if (!uuid) return
  const parsed = parsePastedRows()
  if (!parsed.length) {
    return error('Aucune ligne valide détectée — format attendu : année, mois, quantité [, coût]')
  }
  try {
    const { data } = await importSiteEnergyHistory(uuid, parsed)
    rows.value = data.rows || []
    pasteText.value = ''
    importing.value = false
    success(`${data.created} ligne(s) ajoutée(s), ${data.updated} mise(s) à jour`)
  } catch (e) {
    error(e.response?.data?.detail || 'Import impossible')
  }
}

// Upload d'une facture PDF en pièce jointe (site_document, catégorie
// « autre ») puis rattachement à la ligne de consommation.
const invoiceUploadRow = ref(null)
async function uploadInvoice(row, file) {
  const uuid = siteUuid()
  if (!uuid || !file) return
  invoiceUploadRow.value = row.id
  try {
    const fd = new FormData()
    fd.append('file', file)
    const { data } = await uploadSiteDocument(uuid, fd, {
      title: `Facture ${energyLabel(row.energy_type)} ${monthLabel(row.month)} ${row.year}`,
      category: 'autre',
    })
    await patchRow(row, { invoice_attachment_id: data.id })
    row.invoice_name = data.original_name || file.name
    success('Facture rattachée')
  } catch (e) {
    error(e.response?.data?.detail || 'Upload de la facture impossible')
  } finally {
    invoiceUploadRow.value = null
  }
}

// Glisser-déposer d'une facture (PDF / image) directement sur la ligne
// d'un mois de consommation.
const dragRow = ref(null)
function onInvoiceDragLeave(row, e) {
  // dragleave se déclenche aussi en passant sur un enfant : on ne retire
  // le surlignage que si le pointeur a réellement quitté la ligne.
  if (!e.currentTarget.contains(e.relatedTarget) && dragRow.value === row.id) {
    dragRow.value = null
  }
}
function onInvoiceDrop(row, e) {
  dragRow.value = null
  const file = e.dataTransfer?.files?.[0]
  if (!file) return
  if (file.type !== 'application/pdf' && !file.type.startsWith('image/')) {
    return error('Format non supporté — déposez une facture PDF ou une image.')
  }
  uploadInvoice(row, file)
}

function downloadUrl(id) {
  return getSiteDocumentDownloadUrl(id)
}

// Génère et télécharge un modèle CSV vide (en-tête + lignes d'exemple)
// dans le format exact attendu par parsePastedRows() : séparateur « ; ».
// L'auditeur le transmet au client pour récupérer ses relevés de factures.
function downloadCsvTemplate() {
  const lines = [
    'année;mois;quantité;coût',
    '2024;1;12500;2200',
    '2024;2;11800;2080',
    '2024;3;9400;1750',
  ]
  // BOM UTF-8 pour qu'Excel affiche correctement les accents de l'en-tête.
  const bom = String.fromCharCode(0xFEFF)
  const blob = new Blob([bom + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'modele-consommations.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div :class="flush ? '' : 'bg-white rounded-2xl border border-gray-200 overflow-hidden'">
    <div :class="['flex items-center gap-2',
                  flush ? 'pb-2.5' : 'px-4 py-3 border-b border-gray-100']">
      <FontAwesomeIcon :icon="['fas', 'chart-column']" class="w-5 h-5 text-indigo-600 shrink-0" />
      <h3 class="text-base font-medium text-gray-900">Consommations de référence</h3>
    </div>
    <div :class="flush ? 'space-y-4' : 'p-4 space-y-4'">
      <p class="text-xs text-gray-500 leading-relaxed">
        Saisissez 12 à 24 mois de consommation depuis les factures du client ou
        des locataires. Cette base de référence permettra de mesurer les
        économies réelles après la mise en place du BACS.
      </p>

      <!-- Groupes existants -->
      <div v-if="groups.length" class="space-y-3">
        <div v-for="g in groups" :key="g.key"
             class="border border-gray-200 rounded-xl overflow-hidden">
          <div class="px-3 py-2 bg-gray-50 border-b border-gray-100 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span class="inline-flex items-center gap-1.5 text-sm font-medium text-gray-900">
              <FontAwesomeIcon
                :icon="['fas', energyMeta(g.energy_type).icon.replace('fa-', '')]"
                :style="{ color: energyMeta(g.energy_type).color }"
                class="w-4 h-4 shrink-0" />
              {{ energyLabel(g.energy_type) }}
            </span>
            <span v-if="g.contract_label" class="text-xs text-gray-500">{{ g.contract_label }}</span>
            <span class="ml-auto text-xs text-gray-600 whitespace-nowrap">
              {{ g.monthsCount }} mois · <strong>{{ g.total.toLocaleString('fr-FR') }} {{ g.unit }}</strong>
              <template v-if="g.cost"> · {{ g.cost.toLocaleString('fr-FR') }} €</template>
            </span>
          </div>
          <div class="overflow-x-auto">
          <table class="w-full text-sm min-w-136">
            <thead>
              <tr class="text-[11px] uppercase tracking-wide text-gray-400">
                <th class="text-left font-medium px-3 py-1.5">Mois</th>
                <th class="text-right font-medium px-3 py-1.5">Quantité</th>
                <th class="text-right font-medium px-3 py-1.5">Coût (€)</th>
                <th class="text-left font-medium px-3 py-1.5">Preneur</th>
                <th class="text-left font-medium px-3 py-1.5">Facture</th>
                <th class="px-3 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in g.rows" :key="r.id"
                  @dragover.prevent="dragRow = r.id"
                  @dragleave="onInvoiceDragLeave(r, $event)"
                  @drop.prevent="onInvoiceDrop(r, $event)"
                  :class="['border-t border-gray-100 transition-colors',
                           dragRow === r.id ? 'bg-indigo-100' : '']">
                <td class="px-3 py-1.5 whitespace-nowrap text-gray-700">
                  {{ monthLabel(r.month) }} {{ r.year }}
                </td>
                <td class="px-3 py-1.5 text-right">
                  <input
                    :value="r.quantity"
                    @blur="e => Number(e.target.value) !== Number(r.quantity) && patchRow(r, { quantity: Number(e.target.value) })"
                    inputmode="decimal"
                    class="w-24 px-2 py-1 border border-gray-200 rounded-lg text-sm text-right bg-white" />
                  <span class="text-xs text-gray-400 ml-1">{{ r.unit }}</span>
                </td>
                <td class="px-3 py-1.5 text-right">
                  <input
                    :value="r.cost_eur ?? ''"
                    @blur="e => patchRow(r, { cost_eur: e.target.value === '' ? null : Number(e.target.value) })"
                    inputmode="decimal"
                    placeholder="—"
                    class="w-20 px-2 py-1 border border-gray-200 rounded-lg text-sm text-right bg-white" />
                </td>
                <td class="px-3 py-1.5">
                  <select
                    v-if="tenants.length"
                    :value="r.tenant_id || ''"
                    @change="e => patchRow(r, { tenant_id: e.target.value ? Number(e.target.value) : null })"
                    class="px-2 py-1 border border-gray-200 rounded-lg text-sm bg-white max-w-40">
                    <option value="">—</option>
                    <option v-for="t in tenants" :key="t.id" :value="t.id">{{ t.name }}</option>
                  </select>
                  <span v-else class="text-xs text-gray-400">—</span>
                </td>
                <td class="px-3 py-1.5">
                  <a v-if="r.invoice_attachment_id"
                     :href="downloadUrl(r.invoice_attachment_id)" target="_blank"
                     class="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1">
                    <FontAwesomeIcon :icon="['fas', 'file-pdf']" class="w-3 h-3 shrink-0" />
                    {{ r.invoice_name || 'Facture' }}
                  </a>
                  <label v-else
                         class="text-xs text-gray-500 hover:text-indigo-600 cursor-pointer inline-flex items-center gap-1"
                         v-tooltip="'Cliquer ou glisser-déposer une facture (PDF / image) sur la ligne'">
                    <FontAwesomeIcon
                      :icon="['fas', invoiceUploadRow === r.id ? 'spinner' : 'paperclip']"
                      :class="['w-3 h-3 shrink-0', { 'fa-spin': invoiceUploadRow === r.id }]" />
                    Joindre
                    <input type="file" accept="application/pdf,image/*" class="hidden"
                           @change="e => uploadInvoice(r, e.target.files[0])" />
                  </label>
                </td>
                <td class="px-3 py-1.5 text-right">
                  <button @click="removeRow(r)"
                          class="btn-icon btn-icon-danger"
                          v-tooltip="'Supprimer cette ligne'">
                    <FontAwesomeIcon :icon="['fas', 'trash']" class="w-4 h-4" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>
      </div>
      <p v-else-if="!loading && !adding && !importing" class="text-xs text-gray-400 italic">
        Aucune consommation saisie.
      </p>

      <!-- Actions -->
      <div v-if="!adding && !importing" class="space-y-2">
        <button @click="adding = true"
                class="btn-add">
          <FontAwesomeIcon :icon="['fas', 'plus']" class="w-4 h-4 shrink-0" /> Saisir un mois
        </button>
        <div class="flex flex-wrap gap-2">
          <button @click="importing = true"
                  class="text-xs font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-100 whitespace-nowrap inline-flex items-center gap-1.5">
            <FontAwesomeIcon :icon="['fas', 'table-cells']" class="w-3 h-3 shrink-0" /> Importer (Excel / CSV)
          </button>
          <button @click="downloadCsvTemplate"
                  class="text-xs font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-100 whitespace-nowrap inline-flex items-center gap-1.5">
            <FontAwesomeIcon :icon="['fas', 'file-arrow-down']" class="w-3 h-3 shrink-0" /> Télécharger un modèle CSV
          </button>
        </div>
      </div>

      <!-- Formulaire de saisie d'un mois -->
      <div v-if="adding" class="border border-indigo-200 bg-indigo-50/40 rounded-xl p-3 space-y-2">
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <label class="text-xs font-medium text-gray-700">
            Énergie
            <select v-model="newRow.energy_type"
                    class="mt-1 w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white">
              <option v-for="e in ENERGY_HISTORY_TYPES" :key="e.value" :value="e.value">{{ e.label }}</option>
            </select>
          </label>
          <label class="text-xs font-medium text-gray-700">
            Année
            <input v-model.number="newRow.year" inputmode="numeric"
                   class="mt-1 w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
          </label>
          <label class="text-xs font-medium text-gray-700">
            Mois
            <select v-model.number="newRow.month"
                    class="mt-1 w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white">
              <option v-for="(m, i) in MONTH_LABELS" :key="i" :value="i + 1">{{ m }}</option>
            </select>
          </label>
          <label class="text-xs font-medium text-gray-700">
            Quantité ({{ newRow.unit }})
            <input v-model="newRow.quantity" inputmode="decimal" placeholder="ex : 12500"
                   class="mt-1 w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
          </label>
          <label class="text-xs font-medium text-gray-700">
            Unité
            <input v-model="newRow.unit" placeholder="kWh / m³ / MWh"
                   class="mt-1 w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
          </label>
          <label class="text-xs font-medium text-gray-700">
            Coût (€, optionnel)
            <input v-model="newRow.cost_eur" inputmode="decimal" placeholder="—"
                   class="mt-1 w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
          </label>
          <label class="text-xs font-medium text-gray-700 col-span-2">
            Compteur / contrat
            <input v-model="newRow.contract_label" placeholder="ex : Compteur général, Chaufferie…"
                   class="mt-1 w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
          </label>
          <label v-if="tenants.length" class="text-xs font-medium text-gray-700 col-span-2">
            Preneur (optionnel)
            <select v-model="newRow.tenant_id"
                    class="mt-1 w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white">
              <option :value="null">— Aucun</option>
              <option v-for="t in tenants" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
          </label>
        </div>
        <div class="flex gap-2 justify-end">
          <button @click="adding = false"
                  class="text-xs font-medium text-gray-600 px-3 py-2 rounded-lg hover:bg-gray-100">
            Fermer
          </button>
          <button @click="addRow"
                  class="text-xs font-medium text-white bg-indigo-600 px-3 py-2 rounded-lg hover:bg-indigo-700 whitespace-nowrap">
            Enregistrer ce mois
          </button>
        </div>
      </div>

      <!-- Import par collage / CSV -->
      <div v-if="importing" class="border border-indigo-200 bg-indigo-50/40 rounded-xl p-3 space-y-2">
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <label class="text-xs font-medium text-gray-700">
            Énergie
            <select v-model="newRow.energy_type"
                    class="mt-1 w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white">
              <option v-for="e in ENERGY_HISTORY_TYPES" :key="e.value" :value="e.value">{{ e.label }}</option>
            </select>
          </label>
          <label class="text-xs font-medium text-gray-700">
            Unité
            <input v-model="newRow.unit"
                   class="mt-1 w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
          </label>
          <label class="text-xs font-medium text-gray-700 col-span-2">
            Compteur / contrat
            <input v-model="newRow.contract_label" placeholder="ex : Compteur général"
                   class="mt-1 w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
          </label>
        </div>
        <p class="text-[11px] text-gray-500 leading-relaxed">
          Collez les lignes depuis Excel — une ligne par mois, colonnes
          <strong>année</strong>, <strong>mois</strong>, <strong>quantité</strong>
          et <strong>coût</strong> (optionnel). Séparateur tabulation, point-virgule ou virgule.
        </p>
        <textarea v-model="pasteText" rows="6"
                  placeholder="2024	1	12500	2200&#10;2024	2	11800	2080&#10;…"
                  class="w-full px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white font-mono leading-relaxed"></textarea>
        <div class="flex gap-2 justify-end">
          <button @click="importing = false; pasteText = ''"
                  class="text-xs font-medium text-gray-600 px-3 py-2 rounded-lg hover:bg-gray-100">
            Annuler
          </button>
          <button @click="doImport"
                  class="text-xs font-medium text-white bg-indigo-600 px-3 py-2 rounded-lg hover:bg-indigo-700 whitespace-nowrap">
            Importer les lignes
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
