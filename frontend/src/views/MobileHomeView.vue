<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  ChevronRightIcon,
  FireIcon,
  BuildingOffice2Icon,
  ClockIcon,
  CheckCircleIcon,
  PencilSquareIcon,
  ClipboardDocumentListIcon,
  PlusIcon,
} from '@heroicons/vue/24/outline'
import { listAfs, createAf } from '@/api'
import { currentUser } from '@/router'
import { useNotification } from '@/composables/useNotification'
import { useOnlineStatus } from '@/composables/useOnlineStatus'
import MobileSheet from '@/components/mobile-audit/MobileSheet.vue'
import MobileField from '@/components/mobile-audit/MobileField.vue'
import SitePicker from '@/components/SitePicker.vue'

const router = useRouter()
const { error, success } = useNotification()
const { isOnline } = useOnlineStatus()

const audits = ref([])
const loading = ref(true)
const filter = ref(localStorage.getItem('mobile-home-filter') || 'all') // 'all' | 'bacs_audit' | 'site_audit'

const STATUS_LABEL = {
  draft:    { label: 'Brouillon', cls: 'bg-gray-100 text-gray-700' },
  review:   { label: 'À relire',  cls: 'bg-amber-100 text-amber-800' },
  delivered:{ label: 'Livré',     cls: 'bg-emerald-100 text-emerald-800' },
}

async function refresh() {
  loading.value = true
  try {
    const { data } = await listAfs()
    // Mobile : on ne liste QUE les audits (bacs_audit + site_audit), pas les AF/brochures
    audits.value = (data || []).filter(a =>
      (a.kind || 'af') === 'bacs_audit' || (a.kind || 'af') === 'site_audit'
    )
  } catch {
    error('Échec du chargement des audits')
  } finally {
    loading.value = false
  }
}

onMounted(refresh)

const filteredAudits = computed(() => {
  let list = audits.value
  if (filter.value !== 'all') list = list.filter(a => (a.kind || 'af') === filter.value)
  // Tri par date d'édition desc (plus récent en haut)
  return [...list].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
})

function selectFilter(v) {
  filter.value = v
  localStorage.setItem('mobile-home-filter', v)
}

function openAudit(a) {
  const path = (a.kind === 'site_audit') ? `/site-audit/${a.id}` : `/bacs-audit/${a.id}`
  router.push(path)
}

function relativeTime(s) {
  if (!s) return ''
  const d = new Date(s.replace(' ', 'T'))
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diffSec < 60) return 'à l\'instant'
  if (diffSec < 3600) return Math.floor(diffSec / 60) + ' min'
  if (diffSec < 86400) return 'il y a ' + Math.floor(diffSec / 3600) + ' h'
  if (diffSec < 7 * 86400) return 'il y a ' + Math.floor(diffSec / 86400) + ' j'
  return new Date(s.replace(' ', 'T')).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

const stats = computed(() => ({
  total: audits.value.length,
  bacs: audits.value.filter(a => a.kind === 'bacs_audit').length,
  site: audits.value.filter(a => a.kind === 'site_audit').length,
}))

// Création nouvel audit
const showCreate = ref(false)
const newForm = ref({ kind: 'bacs_audit', site_id: null, project_name: '' })
const creating = ref(false)
const selectedSite = ref(null)

function openCreate() {
  newForm.value = { kind: 'bacs_audit', site_id: null, project_name: '' }
  selectedSite.value = null
  showCreate.value = true
}
function onSiteSelected(site) {
  selectedSite.value = site
  newForm.value.site_id = site?.uuid || null
  // Pré-remplit le project_name avec le nom du site
  if (site?.name && !newForm.value.project_name) {
    newForm.value.project_name = `Audit ${site.name}`
  }
}

async function submitCreate() {
  if (!newForm.value.site_id) {
    error('Choisis un site')
    return
  }
  if (!newForm.value.project_name?.trim()) {
    error('Donne un nom à l\'audit')
    return
  }
  creating.value = true
  try {
    const { data } = await createAf({
      kind: newForm.value.kind,
      site_id: newForm.value.site_id,
      project_name: newForm.value.project_name.trim(),
    })
    success('Audit créé')
    showCreate.value = false
    openAudit(data)
  } catch (e) {
    error(e.response?.data?.detail || 'Création impossible')
  } finally {
    creating.value = false
  }
}

const initials = computed(() => {
  const name = currentUser.value?.display_name || currentUser.value?.email || ''
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join('')
})
</script>

<template>
  <div class="fixed inset-0 flex flex-col bg-gray-50 overflow-hidden">
    <!-- Top bar -->
    <header
      class="shrink-0 bg-indigo-600 text-white shadow-sm z-30"
      :style="{ paddingTop: 'env(safe-area-inset-top)' }"
    >
      <div class="flex items-center gap-2 h-14 px-3">
        <h1 class="flex-1 min-w-0 text-lg font-medium">Mes audits</h1>
        <!-- Indicateur connexion -->
        <div
          v-if="!isOnline"
          class="inline-flex items-center justify-center w-9 h-9 rounded-full bg-red-500/30 text-red-100 animate-pulse"
          v-tooltip="'Hors-ligne'"
          aria-label="Hors-ligne"
        >
          <ClockIcon class="w-5 h-5" />
        </div>
        <div
          v-if="initials"
          class="inline-flex items-center justify-center w-9 h-9 rounded-full bg-white/15 text-white text-sm font-medium"
          v-tooltip="currentUser?.display_name || currentUser?.email"
        >
          {{ initials }}
        </div>
      </div>
    </header>

    <!-- Filter chips -->
    <div class="shrink-0 bg-white border-b border-gray-200 px-3 py-2 flex items-center gap-2 overflow-x-auto">
      <button
        type="button"
        @click="selectFilter('all')"
        :class="['px-4 py-2 text-sm font-medium rounded-full whitespace-nowrap shrink-0 transition',
                 filter === 'all'
                   ? 'bg-indigo-600 text-white'
                   : 'bg-gray-100 text-gray-700']"
      >
        Tous <span class="opacity-60">· {{ stats.total }}</span>
      </button>
      <button
        type="button"
        @click="selectFilter('bacs_audit')"
        :class="['px-4 py-2 text-sm font-medium rounded-full whitespace-nowrap shrink-0 transition inline-flex items-center gap-1.5',
                 filter === 'bacs_audit'
                   ? 'bg-orange-500 text-white'
                   : 'bg-gray-100 text-gray-700']"
      >
        <FireIcon class="w-4 h-4" />
        BACS <span class="opacity-60">· {{ stats.bacs }}</span>
      </button>
      <button
        type="button"
        @click="selectFilter('site_audit')"
        :class="['px-4 py-2 text-sm font-medium rounded-full whitespace-nowrap shrink-0 transition inline-flex items-center gap-1.5',
                 filter === 'site_audit'
                   ? 'bg-emerald-600 text-white'
                   : 'bg-gray-100 text-gray-700']"
      >
        <BuildingOffice2Icon class="w-4 h-4" />
        GTB <span class="opacity-60">· {{ stats.site }}</span>
      </button>
    </div>

    <!-- Liste -->
    <main class="flex-1 overflow-y-auto overscroll-contain p-3 space-y-3"
          :style="{ paddingBottom: 'calc(80px + env(safe-area-inset-bottom))' }">
      <!-- Bouton Nouvel audit en haut -->
      <button
        type="button"
        @click="openCreate"
        class="w-full flex items-center justify-center gap-2 px-4 py-4 text-base font-medium text-white bg-emerald-600 active:bg-emerald-700 rounded-2xl shadow-sm"
      >
        <PlusIcon class="w-5 h-5" />
        Nouvel audit
      </button>

      <!-- Loading -->
      <div v-if="loading" class="text-center py-12 text-gray-400 text-sm">Chargement…</div>

      <!-- Empty -->
      <div v-else-if="!filteredAudits.length" class="bg-white rounded-2xl border border-dashed border-gray-300 p-8 text-center">
        <ClipboardDocumentListIcon class="w-12 h-12 text-gray-300 mx-auto" />
        <p class="text-base font-medium text-gray-700 mt-3">Aucun audit pour l'instant</p>
        <p class="text-sm text-gray-500 mt-1">Tape « Nouvel audit » pour commencer</p>
      </div>

      <!-- Liste cards -->
      <div v-else class="space-y-2">
        <button
          v-for="a in filteredAudits"
          :key="a.id"
          type="button"
          @click="openAudit(a)"
          class="w-full bg-white rounded-2xl border border-gray-200 p-4 text-left active:bg-gray-50 flex items-start gap-3"
        >
          <!-- Icone kind -->
          <div :class="['w-12 h-12 rounded-xl inline-flex items-center justify-center shrink-0',
                        a.kind === 'bacs_audit' ? 'bg-orange-50 text-orange-600' : 'bg-emerald-50 text-emerald-600']">
            <FireIcon v-if="a.kind === 'bacs_audit'" class="w-6 h-6" />
            <BuildingOffice2Icon v-else class="w-6 h-6" />
          </div>

          <!-- Contenu -->
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-2">
              <p class="text-base font-medium text-gray-900 truncate leading-tight">
                {{ a.project_name || (a.kind === 'bacs_audit' ? 'Audit BACS' : 'Audit GTB') }}
              </p>
              <ChevronRightIcon class="w-5 h-5 text-gray-300 shrink-0 mt-0.5" />
            </div>
            <p v-if="a.client_name" class="text-sm text-gray-600 truncate mt-0.5">{{ a.client_name }}</p>
            <div class="flex items-center gap-2 mt-2 flex-wrap">
              <span :class="['inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full', STATUS_LABEL[a.status]?.cls || 'bg-gray-100 text-gray-700']">
                {{ STATUS_LABEL[a.status]?.label || a.status }}
              </span>
              <span class="text-xs text-gray-500">
                <ClockIcon class="w-3.5 h-3.5 inline-block -mt-0.5 mr-0.5" />
                {{ relativeTime(a.updated_at) }}
              </span>
              <span v-if="a.delivered_at" class="text-xs text-emerald-700 inline-flex items-center gap-1">
                <CheckCircleIcon class="w-3.5 h-3.5" /> Livré
              </span>
            </div>
          </div>
        </button>
      </div>
    </main>

    <!-- Sheet Création -->
    <MobileSheet
      :open="showCreate"
      :title="'Nouvel audit'"
      save-label="Créer"
      :saving="creating"
      @close="showCreate = false"
      @save="submitCreate"
    >
      <div class="p-4 space-y-4">
        <MobileField label="Type d'audit">
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              @click="newForm.kind = 'bacs_audit'"
              :class="['flex flex-col items-center justify-center gap-2 p-4 rounded-xl border-2 transition',
                       newForm.kind === 'bacs_audit'
                         ? 'border-orange-500 bg-orange-50 text-orange-700'
                         : 'border-gray-200 bg-white text-gray-600']"
            >
              <FireIcon class="w-7 h-7" />
              <span class="text-sm font-medium">BACS R175</span>
            </button>
            <button
              type="button"
              @click="newForm.kind = 'site_audit'"
              :class="['flex flex-col items-center justify-center gap-2 p-4 rounded-xl border-2 transition',
                       newForm.kind === 'site_audit'
                         ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                         : 'border-gray-200 bg-white text-gray-600']"
            >
              <BuildingOffice2Icon class="w-7 h-7" />
              <span class="text-sm font-medium">GTB classique</span>
            </button>
          </div>
        </MobileField>

        <MobileField label="Site" required hint="Choisis le site sur lequel l'audit sera réalisé.">
          <SitePicker
            :model-value="selectedSite"
            @update:model-value="onSiteSelected"
          />
        </MobileField>

        <MobileField label="Nom de l'audit" required>
          <input
            v-model="newForm.project_name"
            type="text"
            placeholder="ex : Audit BACS Atlas Sud 2026"
            autocapitalize="sentences"
            class="w-full px-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
          />
        </MobileField>
      </div>
    </MobileSheet>
  </div>
</template>
