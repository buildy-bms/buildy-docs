<script setup>
// Vue détail d'un rapport annuel de maintenance (kind='maintenance_report').
// Topbar : retour + titre éditable + période (dates) + statut + actions
// (Aperçu HTML, Export PDF, Enregistrer). Corps : éditeur riche unique
// (WhitepaperRichTextEditor réutilisé tel quel — H2 entrées datées,
// H3 Signalement / Réponse Buildy / Résultat).
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeftIcon, ArrowDownTrayIcon, EyeIcon, CheckIcon,
} from '@heroicons/vue/24/outline'
import {
  getMaintenanceReport, updateMaintenanceReport, exportMaintenanceReportPdf,
} from '@/api'
import { useNotification } from '@/composables/useNotification'
import StatusBadge from '@/components/StatusBadge.vue'
import WhitepaperRichTextEditor from '@/components/WhitepaperRichTextEditor.vue'

const route = useRoute()
const router = useRouter()
const { success, error } = useNotification()

const report = ref(null)
const loading = ref(true)
const saving = ref(false)
const exporting = ref(false)

// Champs éditables + snapshot pour le flag dirty.
const title = ref('')
const periodStart = ref(null)
const periodEnd = ref(null)
const bodyHtml = ref('')
const snapshot = ref('')

function currentState() {
  return JSON.stringify({ t: title.value, s: periodStart.value, e: periodEnd.value, b: bodyHtml.value })
}
const dirty = computed(() => !loading.value && currentState() !== snapshot.value)

async function load() {
  loading.value = true
  try {
    const { data } = await getMaintenanceReport(route.params.id)
    report.value = data
    title.value = data.title || ''
    periodStart.value = data.mr_period_start
    periodEnd.value = data.mr_period_end
    bodyHtml.value = data.body_html || ''
    snapshot.value = currentState()
  } catch (e) {
    error(e.response?.data?.detail || 'Échec du chargement du rapport')
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function save() {
  if (!dirty.value || saving.value) return
  saving.value = true
  try {
    const { data } = await updateMaintenanceReport(report.value.id, {
      title: title.value.trim() || undefined,
      mr_period_start: periodStart.value || null,
      mr_period_end: periodEnd.value || null,
      body_html: bodyHtml.value,
    })
    report.value = data
    snapshot.value = currentState()
    success('Rapport enregistré')
  } catch (e) {
    error(e.response?.data?.detail || 'Échec de l\'enregistrement')
  } finally {
    saving.value = false
  }
}

async function toggleStatus() {
  const next = report.value.status === 'published' ? 'draft' : 'published'
  try {
    const { data } = await updateMaintenanceReport(report.value.id, { status: next })
    report.value = data
    success(next === 'published' ? 'Rapport marqué publié' : 'Rapport repassé en brouillon')
  } catch (e) {
    error(e.response?.data?.detail || 'Échec du changement de statut')
  }
}

function openPreview() {
  window.open(`/api/maintenance-reports/${report.value.id}/preview`, '_blank')
}

async function exportPdf() {
  if (dirty.value) await save()
  exporting.value = true
  try {
    const { data } = await exportMaintenanceReportPdf(report.value.id)
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = `rapport-maintenance-${(report.value.site_name || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    error(e.response?.data?.detail || 'Échec de l\'export PDF')
  } finally {
    exporting.value = false
  }
}

// Garde-fou : prévenir la perte de saisie non enregistrée à la fermeture.
function onBeforeUnload(e) {
  if (dirty.value) { e.preventDefault(); e.returnValue = '' }
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))
</script>

<template>
  <div class="w-full max-w-5xl mx-auto">
    <div v-if="loading" class="py-16 text-center text-sm text-gray-400">Chargement…</div>

    <template v-else-if="report">
      <!-- Topbar -->
      <div class="flex items-center gap-3 mb-4 flex-wrap">
        <button @click="router.push('/')" class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition">
          <ArrowLeftIcon class="w-4 h-4" /> Mes documents
        </button>
        <div class="flex-1"></div>
        <StatusBadge :status="report.status" />
        <button @click="toggleStatus" class="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
          {{ report.status === 'published' ? 'Repasser en brouillon' : 'Marquer publié' }}
        </button>
        <button @click="openPreview" class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
          <EyeIcon class="w-4 h-4" /> Aperçu
        </button>
        <button @click="exportPdf" :disabled="exporting"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition disabled:opacity-50">
          <ArrowDownTrayIcon class="w-4 h-4" /> {{ exporting ? 'Export…' : 'Exporter PDF' }}
        </button>
        <button @click="save" :disabled="!dirty || saving"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition disabled:opacity-50">
          <CheckIcon class="w-4 h-4" /> {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
        </button>
      </div>

      <!-- Métadonnées -->
      <div class="bg-white border border-gray-200 rounded-xl p-4 mb-4 space-y-3">
        <div>
          <label class="block text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-1">Titre du rapport</label>
          <input v-model="title" type="text" placeholder="ex : Rapport annuel de maintenance — DIMO SOFTWARE"
                 class="w-full px-3 py-2 border border-gray-200 rounded-lg text-lg font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition" />
        </div>
        <div class="flex items-end gap-4 flex-wrap">
          <div class="text-sm text-gray-600">
            <span class="block text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-1">Site</span>
            {{ report.site_name || '—' }}
            <span v-if="report.client_name" class="text-gray-400"> · {{ report.client_name }}</span>
          </div>
          <div>
            <label class="block text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-1">Début de période</label>
            <input v-model="periodStart" type="date"
                   class="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
          </div>
          <div>
            <label class="block text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-1">Fin de période</label>
            <input v-model="periodEnd" type="date"
                   class="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
          </div>
          <div v-if="report.period_label" class="text-xs text-gray-500 pb-2">
            Sur la cover : « {{ report.period_label }} »
          </div>
        </div>
      </div>

      <!-- Corps : éditeur riche unique -->
      <div class="bg-white border border-gray-200 rounded-xl p-4">
        <p class="text-xs text-gray-500 mb-3">
          Structure conseillée : un titre <strong>H2</strong> par sollicitation
          (« JJ/MM/AAAA — Objet »), des sous-titres <strong>H3</strong>
          (Signalement, Réponse Buildy, Résultat…), puis un H2 « Synthèse » en fin de rapport.
        </p>
        <WhitepaperRichTextEditor v-model="bodyHtml" min-height="600px"
                                  placeholder="Rédige ici la chronologie des sollicitations puis la synthèse…" />
      </div>
    </template>
  </div>
</template>
