<script setup>
import { ref, watch, computed } from 'vue'
import { ClockIcon, ArrowPathIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { getAfAudit } from '@/api'

const props = defineProps({
  afId: { type: Number, required: true },
  // 'af' | 'bacs_audit' | 'site_audit' — utilisé pour adapter les libellés
  // génériques (af.update → « a modifié l'audit » au lieu de « a modifié l'AF »).
  kind: { type: String, default: 'af' },
  // Affiche une croix de fermeture dans le header (slide-out usage).
  closable: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const isAudit = computed(() => props.kind === 'bacs_audit' || props.kind === 'site_audit')
const docLabel = computed(() => isAudit.value ? 'l\'audit' : 'l\'AF')

const entries = ref([])
const loading = ref(false)

// Libellés communs (af.* + section.* + export.* + claude.*) qui dépendent
// du kind du document. Construit une map dynamique selon docLabel.
const ACTION_LABELS = computed(() => ({
  // Sections / contenu narratif AF (jamais déclenchés sur un audit)
  'section.update': { label: 'a édité', color: 'text-gray-700' },
  'section.override.add': { label: 'a ajouté un override de point', color: 'text-amber-700' },
  'section.override.remove': { label: 'a retiré un override de point', color: 'text-amber-700' },
  'section.instance.add': { label: 'a ajouté une instance', color: 'text-blue-700' },
  'section.template.sync': { label: 'a synchronisé un template', color: 'text-emerald-700' },
  'section.template.dismiss': { label: 'a reporté une mise à jour template', color: 'text-gray-600' },
  'export.points-list': { label: 'a exporté la liste de points', color: 'text-indigo-700' },
  'export.af': { label: `a exporté ${docLabel.value} (PDF)`, color: 'text-indigo-700' },
  'export.bacs-audit': { label: 'a exporté l\'audit (PDF)', color: 'text-indigo-700' },
  'export.synthesis': { label: 'a exporté la synthèse', color: 'text-indigo-700' },
  'af.checkpoint': { label: 'a marqué une version', color: 'text-emerald-700' },
  'af.restore': { label: 'a restauré une version', color: 'text-red-700' },
  'af.delivered': { label: `a livré ${docLabel.value}${isAudit.value ? '' : ' (DOE)'}`, color: 'text-emerald-700' },
  // af.update est aussi déclenché pour les audits (table afs partagée)
  'af.update': { label: `a modifié ${docLabel.value}`, color: 'text-gray-700' },
  'af.create': { label: `a créé ${docLabel.value}`, color: 'text-emerald-700' },
  'claude.draft': { label: 'a généré un brouillon Claude', color: 'text-violet-700' },
  // Audits BACS / GTB
  'bacs_audit.create': { label: 'a créé l\'audit', color: 'text-emerald-700' },
  'site_audit.create': { label: 'a créé l\'audit GTB', color: 'text-emerald-700' },
  'bacs_audit.step.validate': { label: 'a validé une étape', color: 'text-emerald-700' },
  'bacs_audit.step.invalidate': { label: 'a annulé une validation d\'étape', color: 'text-amber-700' },
  'bacs_audit.synthesis.generate': { label: 'a généré la synthèse Claude', color: 'text-violet-700' },
  'bacs_audit.alternatives.generate': { label: 'a généré des préconisations Claude', color: 'text-violet-700' },
  'bacs_audit.fixture.create': { label: 'a créé un audit de démonstration', color: 'text-emerald-700' },
  'document.delivered': { label: 'a livré l\'audit', color: 'text-emerald-700' },
  'site_document.upload': { label: 'a ajouté un document', color: 'text-blue-700' },
  'site_document.delete': { label: 'a supprimé un document', color: 'text-red-700' },
  'credential.create': { label: 'a ajouté un credential', color: 'text-blue-700' },
  'credential.update': { label: 'a modifié un credential', color: 'text-gray-700' },
  'credential.delete': { label: 'a supprimé un credential', color: 'text-red-700' },
  'credential.revealed': { label: 'a révélé un credential', color: 'text-amber-700' },
}))

async function refresh() {
  loading.value = true
  try {
    const { data } = await getAfAudit(props.afId)
    entries.value = data
  } catch {
    entries.value = []
  } finally {
    loading.value = false
  }
}

function fmtDate(iso) {
  // SQLite renvoie sans Z, on assume UTC
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
  const now = new Date()
  const diff = (now - d) / 1000
  if (diff < 60) return 'à l\'instant'
  if (diff < 3600) return `il y a ${Math.round(diff / 60)} min`
  if (diff < 86400) return `il y a ${Math.round(diff / 3600)} h`
  return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function payloadOf(entry) {
  if (!entry.payload) return null
  try { return JSON.parse(entry.payload) }
  catch { return null }
}

function summary(entry) {
  const p = payloadOf(entry)
  if (!p) return null
  if (entry.action.startsWith('export.')) return p.version || p.motif
  if (entry.action === 'section.update') return Array.isArray(p) ? p.join(', ') : null
  if (entry.action === 'af.checkpoint') return p.tag || (p.sha ? p.sha.slice(0, 7) : null)
  if (entry.action === 'af.restore') return `vers ${p.sha?.slice(0, 7) || '?'}`
  if (entry.action === 'claude.draft') return p.length ? `${p.length} caractères générés` : null
  return null
}

watch(() => props.afId, refresh, { immediate: true })
defineExpose({ refresh })
</script>

<template>
  <div class="bg-white rounded-lg border border-gray-200">
    <div class="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500 inline-flex items-center gap-1.5">
        <ClockIcon class="w-3.5 h-3.5" /> Activité récente
      </h3>
      <div class="inline-flex items-center gap-2">
        <button @click="refresh" class="text-gray-400 hover:text-gray-700" title="Rafraîchir">
          <ArrowPathIcon :class="['w-3.5 h-3.5', loading && 'animate-spin']" />
        </button>
        <button v-if="closable" @click="emit('close')" class="text-gray-400 hover:text-gray-700" title="Fermer">
          <XMarkIcon class="w-4 h-4" />
        </button>
      </div>
    </div>

    <div v-if="loading && !entries.length" class="px-4 py-6 text-center text-xs text-gray-400">Chargement…</div>
    <div v-else-if="!entries.length" class="px-4 py-6 text-center text-xs text-gray-400 italic">
      Aucune activité encore. Les modifications et exports apparaîtront ici.
    </div>

    <ul v-else class="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
      <li v-for="e in entries" :key="e.id" class="px-4 py-2 text-xs">
        <p class="text-gray-700 leading-snug">
          <span class="font-semibold text-gray-800">{{ e.user_display_name || 'Système' }}</span>
          <span :class="ACTION_LABELS[e.action]?.color || 'text-gray-500'" class="ml-1">
            {{ ACTION_LABELS[e.action]?.label || e.action }}
          </span>
        </p>
        <p v-if="summary(e)" class="text-[11px] text-gray-500 mt-0.5 truncate">{{ summary(e) }}</p>
        <p class="text-[10px] text-gray-400 mt-0.5">{{ fmtDate(e.created_at) }}</p>
      </li>
    </ul>
  </div>
</template>
