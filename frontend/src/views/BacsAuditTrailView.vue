<script setup>
/**
 * Historique d'un audit BACS particulier. Reutilise le endpoint /api/afs/:id/audit
 * car les BACS audits sont stockes dans la meme table afs (kind='bacs_audit').
 */
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeftIcon, ClockIcon } from '@heroicons/vue/24/outline'
import { getAfAudit, getAf } from '@/api'
import { auditTrailTip, formatDateTime } from '@/lib/audit-tips-shell'

const route = useRoute()
const router = useRouter()
const docId = parseInt(route.params.id, 10)

const rows = ref([])
const document = ref(null)
const loading = ref(true)

const ACTION_LABELS = {
  'bacs_audit.step.validate': { label: 'Étape validée', color: 'bg-emerald-100 text-emerald-700' },
  'bacs_audit.step.invalidate': { label: 'Validation annulée', color: 'bg-amber-100 text-amber-700' },
  'bacs_audit.synthesis.generate': { label: 'Synthèse Claude', color: 'bg-violet-100 text-violet-700' },
  'export.bacs-audit': { label: 'Export PDF', color: 'bg-blue-100 text-blue-700' },
  'document.delivered': { label: 'Audit livré', color: 'bg-emerald-100 text-emerald-700' },
  'site_document.upload': { label: 'Document ajouté', color: 'bg-blue-50 text-blue-600' },
  'site_document.delete': { label: 'Document supprimé', color: 'bg-red-50 text-red-600' },
  'credential.revealed': { label: 'Mot de passe affiché', color: 'bg-amber-100 text-amber-700' },
  'credential.create': { label: 'Accès ajouté', color: 'bg-blue-50 text-blue-600' },
  // Libellés en clair des autres événements de l'audit (sinon la clé technique s'affichait).
  'bacs_audit.deliver.forced': { label: 'Livraison forcée', color: 'bg-amber-100 text-amber-700' },
  'bacs_audit.alternatives.generate': { label: 'Préconisations Claude', color: 'bg-violet-100 text-violet-700' },
  'bacs.system.create': { label: 'Système ajouté', color: 'bg-indigo-50 text-indigo-700' },
  'bacs.system.update': { label: 'Système modifié', color: 'bg-indigo-50 text-indigo-700' },
  'bacs.system.delete': { label: 'Système supprimé', color: 'bg-red-50 text-red-600' },
  'bacs.device.create': { label: 'Équipement ajouté', color: 'bg-indigo-50 text-indigo-700' },
  'bacs.device.update': { label: 'Équipement modifié', color: 'bg-indigo-50 text-indigo-700' },
  'bacs.device.delete': { label: 'Équipement supprimé', color: 'bg-red-50 text-red-600' },
  'bacs.device.move': { label: 'Équipement déplacé', color: 'bg-indigo-50 text-indigo-700' },
  'bacs.device.share': { label: 'Équipement partagé', color: 'bg-indigo-50 text-indigo-700' },
  'bacs.meter.create': { label: 'Compteur ajouté', color: 'bg-indigo-50 text-indigo-700' },
  'bacs.meter.update': { label: 'Compteur modifié', color: 'bg-indigo-50 text-indigo-700' },
  'bacs.meter.delete': { label: 'Compteur supprimé', color: 'bg-red-50 text-red-600' },
  'bacs.thermal.create': { label: 'Régulation ajoutée', color: 'bg-indigo-50 text-indigo-700' },
  'bacs.thermal.update': { label: 'Régulation modifiée', color: 'bg-indigo-50 text-indigo-700' },
  'bacs.thermal.delete': { label: 'Régulation supprimée', color: 'bg-red-50 text-red-600' },
  'bacs.bms.update': { label: 'GTB modifiée', color: 'bg-indigo-50 text-indigo-700' },
  'bacs.inspection.create': { label: 'Inspection ajoutée', color: 'bg-indigo-50 text-indigo-700' },
  'bacs.inspection.update': { label: 'Inspection modifiée', color: 'bg-indigo-50 text-indigo-700' },
  'bacs.inspection.delete': { label: 'Inspection supprimée', color: 'bg-red-50 text-red-600' },
  'bacs.checklist.update': { label: 'Check-list modifiée', color: 'bg-indigo-50 text-indigo-700' },
  'bacs.action_item.create': { label: 'Action ajoutée', color: 'bg-indigo-50 text-indigo-700' },
  'bacs.action_item.update': { label: 'Action modifiée', color: 'bg-indigo-50 text-indigo-700' },
  'bacs.action_item.delete': { label: 'Action supprimée', color: 'bg-red-50 text-red-600' },
  'bacs.action_item.regenerate': { label: 'Plan régénéré', color: 'bg-indigo-50 text-indigo-700' },
  'bacs.precheck.auto_fix': { label: 'Correction automatique', color: 'bg-indigo-50 text-indigo-700' },
  'bacs.transcript.upload': { label: 'Transcription importée', color: 'bg-violet-100 text-violet-700' },
  'bacs.transcript.suggestions': { label: 'Suggestions Claude', color: 'bg-violet-100 text-violet-700' },
  'bacs.suggestion.apply': { label: 'Suggestion appliquée', color: 'bg-violet-100 text-violet-700' },
  'bacs.suggestion.reject': { label: 'Suggestion rejetée', color: 'bg-gray-100 text-gray-700' },
}

function actionBadge(action) {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action]
  // fallbacks
  if (action.startsWith('site_document')) return { label: action, color: 'bg-blue-50 text-blue-600' }
  if (action.startsWith('bacs_audit')) return { label: action, color: 'bg-indigo-50 text-indigo-700' }
  return { label: action, color: 'bg-gray-100 text-gray-700' }
}

// Dates du journal : UTC sans fuseau en base (CURRENT_TIMESTAMP) → lues comme UTC, sinon
// l'heure affichée était décalée du fuseau (2 h en été).
function formatDate(s) {
  return formatDateTime(s) || '—'
}

function parsePayload(p) {
  if (!p) return null
  try { return JSON.parse(p) } catch { return p }
}

async function refresh() {
  loading.value = true
  try {
    const [d, log] = await Promise.all([getAf(docId), getAfAudit(docId)])
    document.value = d.data
    rows.value = log.data
  } finally {
    loading.value = false
  }
}

onMounted(refresh)
</script>

<template>
  <div class="max-w-screen-xl mx-auto pb-12">
    <div class="flex items-center gap-3 mb-4">
      <button @click="router.push('/bacs-audit/' + docId)" class="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1">
        <ArrowLeftIcon class="w-4 h-4" /> Retour à l'audit
      </button>
    </div>

    <div class="flex items-center gap-2 mb-4">
      <ClockIcon class="w-5 h-5 text-indigo-600" />
      <h1 class="text-lg font-semibold text-gray-800">
        Historique — {{ document?.project_name || '…' }}
        <span class="text-sm font-normal text-gray-500">— {{ document?.client_name }}</span>
      </h1>
    </div>

    <div v-if="loading" class="text-center py-12 text-gray-400 text-sm">Chargement…</div>
    <div v-else-if="!rows.length" class="bg-white border border-gray-200 rounded-lg p-12 text-center">
      <ClockIcon class="w-10 h-10 mx-auto text-gray-300" />
      <p class="mt-3 text-sm text-gray-500">Aucun événement enregistré pour cet audit.</p>
    </div>
    <div v-else class="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
      <table class="w-full text-sm">
        <thead class="bg-gray-50 text-xs uppercase text-gray-500 tracking-wider">
          <tr>
            <th class="text-left px-4 py-2.5 w-44">Date</th>
            <th class="text-left px-4 py-2.5 w-44">Action</th>
            <th class="text-left px-4 py-2.5 w-48">Utilisateur</th>
            <th class="text-left px-4 py-2.5">Détails</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="r in rows" :key="r.id" class="hover:bg-indigo-50/40">
            <td class="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{{ formatDate(r.created_at) }}</td>
            <td class="px-4 py-2">
              <!-- Bulle : explication des événements dont le libellé ne suffit pas (plus de clé technique). -->
              <span :class="['inline-block px-2 py-0.5 text-[11px] font-medium rounded', actionBadge(r.action).color]"
                    v-tooltip.right="auditTrailTip(r.action)">
                {{ actionBadge(r.action).label }}
              </span>
            </td>
            <td class="px-4 py-2 text-sm text-gray-700">
              {{ r.user_display_name || 'système' }}
            </td>
            <td class="px-4 py-2">
              <pre v-if="r.payload" class="text-[11px] text-gray-500 font-mono whitespace-pre-wrap break-all max-w-xl">{{ parsePayload(r.payload) }}</pre>
              <span v-else class="text-gray-400 italic">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
