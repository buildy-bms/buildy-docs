<script setup>
/**
 * Bouton d'enregistrement de notes vocales (PWA terrain).
 *
 * L'auditeur enregistre une note vocale (MediaRecorder) rattachée à une
 * zone / un système / un compteur / un device / la GTB. L'audio est uploadé
 * dans site_documents (media_type='audio'). La transcription IA (OpenAI)
 * est déclenchée à la demande — l'audio est écoutable immédiatement, la
 * transcription reste une action volontaire.
 *
 * Calqué sur BacsPhotoButton : mêmes props, même galerie popover/sheet.
 */
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import {
  MicrophoneIcon, StopIcon, TrashIcon, XMarkIcon, SparklesIcon, ArrowPathIcon,
  ArrowDownTrayIcon, CheckIcon,
} from '@heroicons/vue/24/outline'
import {
  listSiteDocuments, uploadSiteDocument, deleteSiteDocument,
  transcribeSiteDocument, exportSiteDocumentTranscript, getSiteDocumentDownloadUrl,
} from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useViewport } from '@/composables/useViewport'
import { useOnlineStatus } from '@/composables/useOnlineStatus'

const props = defineProps({
  siteUuid: { type: String, required: true },
  attachTo: { type: Object, required: true },
  label: { type: String, default: '' },
  size: { type: String, default: 'sm' },
})
const emit = defineEmits(['changed'])

const { success, error: notifyError } = useNotification()
const { isMobile } = useViewport()
const { isOnline } = useOnlineStatus()

const notes = ref([])
const loading = ref(false)
const showGallery = ref(false)
const uploading = ref(false)
const recording = ref(false)
const elapsed = ref(0)
const rootEl = ref(null)

// Refs non réactives (objets MediaRecorder / stream / timers).
let mediaRecorder = null
let mediaStream = null
let chunks = []
let timer = null
let cancelled = false

const filterParams = computed(() => {
  const p = {}
  if (props.attachTo.zone_id != null)         p.bacs_audit_zone_id = props.attachTo.zone_id
  if (props.attachTo.meter_id != null)        p.bacs_audit_meter_id = props.attachTo.meter_id
  if (props.attachTo.system_id != null)       p.bacs_audit_system_id = props.attachTo.system_id
  if (props.attachTo.device_id != null)       p.bacs_audit_device_id = props.attachTo.device_id
  if (props.attachTo.bms_document_id != null) p.bacs_audit_bms_document_id = props.attachTo.bms_document_id
  if (props.attachTo.action_item_id != null)  p.bacs_audit_action_item_id = props.attachTo.action_item_id
  return p
})

async function refresh() {
  if (!props.siteUuid) return
  loading.value = true
  try {
    const { data } = await listSiteDocuments(props.siteUuid, filterParams.value)
    notes.value = (data || []).filter(d => d.media_type === 'audio')
  } catch {
    notifyError('Erreur chargement des notes vocales')
  } finally {
    loading.value = false
  }
}

function onDocsChanged() { refresh() }
function onDocClick(e) {
  if (!showGallery.value || isMobile.value) return
  if (rootEl.value && !rootEl.value.contains(e.target)) showGallery.value = false
}
onMounted(() => {
  refresh()
  window.addEventListener('site-documents:changed', onDocsChanged)
  document.addEventListener('mousedown', onDocClick)
})
onBeforeUnmount(() => {
  window.removeEventListener('site-documents:changed', onDocsChanged)
  document.removeEventListener('mousedown', onDocClick)
  teardownRecording()
})
watch(() => JSON.stringify(filterParams.value), refresh)

// ── Enregistrement ────────────────────────────────────────────────
function pickMime() {
  const prefs = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
  for (const m of prefs) {
    if (window.MediaRecorder?.isTypeSupported?.(m)) return m
  }
  return ''
}

function teardownRecording() {
  if (timer) { clearInterval(timer); timer = null }
  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null }
  mediaRecorder = null
}

async function startRecording() {
  if (recording.value || uploading.value) return
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    notifyError('Enregistrement audio non supporté par ce navigateur')
    return
  }
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    notifyError("Micro inaccessible — autorisez l'accès au microphone")
    return
  }
  chunks = []
  cancelled = false
  const mime = pickMime()
  mediaRecorder = new MediaRecorder(mediaStream, mime ? { mimeType: mime } : {})
  mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data) }
  mediaRecorder.onstop = onRecorderStop
  mediaRecorder.start()
  recording.value = true
  elapsed.value = 0
  timer = setInterval(() => { elapsed.value++ }, 1000)
}

function stopRecording() {
  if (!recording.value || !mediaRecorder) return
  cancelled = false
  mediaRecorder.stop()
}
function cancelRecording() {
  if (!recording.value || !mediaRecorder) return
  cancelled = true
  mediaRecorder.stop()
}

async function onRecorderStop() {
  recording.value = false
  if (timer) { clearInterval(timer); timer = null }
  const duration = elapsed.value
  const baseMime = (mediaRecorder?.mimeType || 'audio/webm').split(';')[0].trim()
  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null }
  mediaRecorder = null
  const localChunks = chunks
  chunks = []
  if (cancelled || !localChunks.length) return
  await uploadRecording(new Blob(localChunks, { type: baseMime }), baseMime, duration)
}

async function uploadRecording(blob, mime, duration) {
  uploading.value = true
  try {
    const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm'
    const fd = new FormData()
    fd.append('file', blob, `note-vocale.${ext}`)
    await uploadSiteDocument(props.siteUuid, fd, {
      title: props.label ? `Note vocale — ${props.label}` : 'Note vocale',
      category: 'autre',
      duration_seconds: duration,
      ...filterParams.value,
    })
    success('Note vocale enregistrée')
    window.dispatchEvent(new CustomEvent('site-documents:changed'))
    await refresh()
    emit('changed')
  } catch (err) {
    notifyError(err.response?.data?.detail || "Échec de l'envoi de la note vocale")
  } finally {
    uploading.value = false
  }
}

// ── Transcription / suppression ───────────────────────────────────
async function transcribeNote(note) {
  if (note.transcript_status === 'processing') return
  note.transcript_status = 'processing'
  try {
    const { data } = await transcribeSiteDocument(note.id)
    Object.assign(note, data)
  } catch (err) {
    note.transcript_status = 'failed'
    notifyError(err.response?.data?.detail || 'Transcription impossible')
  }
}

// Exporte la transcription vers les notes (notes_html) de l'élément rattaché.
async function exportToNotes(note) {
  if (note._exporting) return
  note._exporting = true
  try {
    const { data } = await exportSiteDocumentTranscript(note.id)
    Object.assign(note, data)
    success('Transcription exportée vers les notes de l\'élément')
    emit('changed')
  } catch (err) {
    notifyError(err.response?.data?.detail || 'Export vers les notes impossible')
  } finally {
    note._exporting = false
  }
}

async function deleteNote(note) {
  if (!confirm('Supprimer cette note vocale ?')) return
  try {
    await deleteSiteDocument(note.id)
    await refresh()
    emit('changed')
  } catch {
    notifyError('Échec suppression')
  }
}

// ── Formatage ─────────────────────────────────────────────────────
function fmtDuration(s) {
  if (s == null) return ''
  const total = Math.round(s)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

const btnCls = computed(() => {
  const base = 'inline-flex items-center justify-center rounded-md transition whitespace-nowrap'
  if (!isOnline.value) {
    if (isMobile.value) return `${base} opacity-40 cursor-not-allowed gap-1 px-4 py-3.5 text-base w-full font-medium border bg-gray-200 border-gray-200 text-gray-500`
    // Desktop : .btn-icon + attribut :disabled gère l'opacité.
    return 'btn-icon relative'
  }
  if (isMobile.value) {
    return `${base} gap-1 px-4 py-3.5 text-base w-full font-medium border bg-violet-600 border-violet-600 text-white active:bg-violet-700`
  }
  // Desktop : chip d'action commun (.btn-icon), teinte violette quand
  // des notes vocales existent.
  return `btn-icon relative${notes.value.length ? ' is-voice' : ''}`
})
</script>

<template>
  <div :class="['relative', isMobile ? 'block w-full' : 'inline-block']" ref="rootEl">
    <button
      type="button"
      :class="btnCls"
      :disabled="!isOnline"
      v-tooltip="!isOnline
        ? 'Notes vocales indisponibles hors ligne'
        : (label ? `Notes vocales - ${label}` : 'Notes vocales')"
      @click="showGallery = !showGallery"
    >
      <MicrophoneIcon :class="['shrink-0', isMobile ? 'w-5 h-5' : 'w-4 h-4']" />
      <template v-if="isMobile">
        <span class="font-medium">Note vocale<span v-if="notes.length"> ({{ notes.length }})</span></span>
      </template>
      <span v-else-if="notes.length"
            class="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 inline-flex items-center justify-center text-[9px] font-semibold bg-violet-600 text-white rounded-full">
        {{ notes.length }}
      </span>
    </button>

    <Teleport to="body" :disabled="!isMobile">
      <div
        v-if="showGallery"
        :class="isMobile
          ? 'fixed inset-0 z-60 flex flex-col bg-gray-50'
          : 'absolute right-0 top-full mt-1 z-30 w-80 bg-white border border-gray-200 rounded-lg shadow-xl flex flex-col max-h-[70vh]'"
        @click.stop
      >
        <!-- En-tête -->
        <header
          :class="isMobile
            ? 'shrink-0 bg-white border-b border-gray-200'
            : 'shrink-0 border-b border-gray-100'"
          :style="isMobile ? { paddingTop: 'env(safe-area-inset-top)' } : {}"
        >
          <div class="flex items-center gap-2 px-3" :class="isMobile ? 'h-12' : 'h-10'">
            <h2 class="flex-1 min-w-0 font-medium truncate text-gray-900" :class="isMobile ? 'text-base' : 'text-xs'">
              Notes vocales<span v-if="label"> · {{ label }}</span>
            </h2>
            <button @click="showGallery = false"
                    class="inline-flex items-center justify-center text-gray-500 hover:text-gray-800"
                    :class="isMobile ? 'tap-target' : 'p-1'" aria-label="Fermer">
              <XMarkIcon :class="isMobile ? 'w-6 h-6' : 'w-4 h-4'" />
            </button>
          </div>
        </header>

        <div class="flex-1 overflow-y-auto p-3 space-y-3"
             :style="isMobile ? { paddingBottom: 'calc(24px + env(safe-area-inset-bottom))' } : {}">
          <!-- Contrôle d'enregistrement -->
          <div v-if="recording" class="rounded-lg bg-red-50 border border-red-200 p-3">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse shrink-0"></span>
              <span class="flex-1 font-medium text-red-700 tabular-nums"
                    :class="isMobile ? 'text-base' : 'text-sm'">
                Enregistrement… {{ fmtDuration(elapsed) }}
              </span>
            </div>
            <div class="mt-2.5 flex items-center gap-2">
              <button type="button" @click="cancelRecording"
                      class="flex-1 inline-flex items-center justify-center font-medium text-gray-700 bg-white border border-gray-300 rounded-lg active:bg-gray-50"
                      :class="isMobile ? 'min-h-12 text-base' : 'min-h-9 text-sm'">
                Annuler
              </button>
              <button type="button" @click="stopRecording"
                      class="flex-1 inline-flex items-center justify-center gap-1.5 font-medium text-white bg-red-600 hover:bg-red-700 active:bg-red-700 rounded-lg"
                      :class="isMobile ? 'min-h-12 text-base' : 'min-h-9 text-sm'">
                <StopIcon class="w-5 h-5 shrink-0" /> Arrêter
              </button>
            </div>
          </div>
          <button v-else type="button" @click="startRecording" :disabled="uploading"
                  class="w-full inline-flex items-center justify-center gap-2 px-4 font-medium text-white bg-violet-600 hover:bg-violet-700 active:bg-violet-700 rounded-lg disabled:opacity-50"
                  :class="isMobile ? 'py-4 text-base' : 'py-2.5 text-sm'">
            <MicrophoneIcon class="w-5 h-5" />
            {{ uploading ? 'Envoi…' : 'Enregistrer une note vocale' }}
          </button>

          <!-- Liste des notes -->
          <div v-if="loading" class="text-center text-xs text-gray-500 py-3">Chargement…</div>
          <p v-else-if="!notes.length" class="text-center text-xs text-gray-500 py-3 italic">
            Aucune note vocale.
          </p>
          <div v-for="n in notes" :key="n.id"
               class="rounded-lg border border-gray-200 bg-white space-y-2"
               :class="isMobile ? 'p-3' : 'p-2.5'">
            <div class="flex items-center gap-2 text-xs text-gray-500">
              <span class="font-medium text-gray-700 tabular-nums">{{ fmtDuration(n.duration_seconds) || '—' }}</span>
              <span class="truncate flex-1">{{ fmtDate(n.uploaded_at) }}</span>
              <button type="button" @click="deleteNote(n)"
                      class="shrink-0 inline-flex items-center justify-center text-gray-400 hover:text-red-600 active:text-red-600 rounded-md"
                      :class="isMobile ? 'w-11 h-11 -my-2' : 'p-1'" v-tooltip="'Supprimer'" aria-label="Supprimer">
                <TrashIcon :class="isMobile ? 'w-5 h-5' : 'w-4 h-4'" />
              </button>
            </div>
            <audio controls preload="metadata" :src="getSiteDocumentDownloadUrl(n.id)"
                   :class="['w-full', isMobile ? 'h-12' : 'h-9']"></audio>

            <!-- Transcription -->
            <div v-if="n.transcript_status === 'done'" class="space-y-1.5">
              <div class="text-sm text-gray-700 bg-gray-50 border border-gray-100 rounded p-2 whitespace-pre-wrap">
                {{ n.transcript_text || '(transcription vide)' }}
              </div>
              <button type="button" @click="exportToNotes(n)" :disabled="n._exporting"
                      class="inline-flex items-center justify-center gap-1.5 font-medium rounded-lg border whitespace-nowrap transition disabled:opacity-50"
                      :class="[
                        n.transcript_exported_at
                          ? 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                          : 'text-indigo-700 bg-indigo-50 border-indigo-200 hover:bg-indigo-100',
                        isMobile ? 'w-full min-h-11 text-sm' : 'px-2.5 py-1 text-xs']">
                <component :is="n.transcript_exported_at ? CheckIcon : ArrowDownTrayIcon" class="w-4 h-4 shrink-0" />
                {{ n._exporting
                  ? 'Export…'
                  : (n.transcript_exported_at ? 'Exporté — ré-exporter vers les notes' : 'Exporter vers les notes') }}
              </button>
            </div>
            <p v-else-if="n.transcript_status === 'processing'"
               class="text-xs text-violet-600 inline-flex items-center gap-1.5">
              <ArrowPathIcon class="w-3.5 h-3.5 animate-spin" /> Transcription en cours…
            </p>
            <div v-else class="space-y-1">
              <button type="button" @click="transcribeNote(n)"
                      class="inline-flex items-center justify-center gap-1.5 font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 active:bg-violet-100 border border-violet-200 rounded-lg whitespace-nowrap"
                      :class="isMobile ? 'w-full min-h-12 text-sm' : 'px-2.5 py-1 text-xs'">
                <SparklesIcon class="w-4 h-4 shrink-0" />
                {{ n.transcript_status === 'failed' ? 'Réessayer la transcription' : 'Transcrire' }}
              </button>
              <p v-if="n.transcript_status === 'failed'" class="text-[11px] text-red-600">
                Échec de la transcription.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
