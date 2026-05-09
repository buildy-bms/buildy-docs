<script setup>
import { ref, computed, onMounted, watch, inject } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter, useRoute } from 'vue-router'
import {
  ChevronLeftIcon,
  IdentificationIcon,
  Squares2X2Icon,
  BoltIcon,
  WrenchScrewdriverIcon,
  ClipboardDocumentListIcon,
  ClipboardDocumentCheckIcon,
  ListBulletIcon,
  EllipsisHorizontalIcon,
  SignalSlashIcon,
  Cog6ToothIcon,
  TrashIcon,
  CheckCircleIcon,
  ArrowPathIcon,
} from '@heroicons/vue/24/outline'
import { useAuditStore } from '@/stores/audit'
import { useAuditAutoSync } from '@/composables/useAuditAutoSync'
import { useNotification } from '@/composables/useNotification'
import { useOnlineStatus } from '@/composables/useOnlineStatus'
import { useConfirm } from '@/composables/useConfirm'
import { updateAf, deleteAf, deliverBacsAudit } from '@/api'
import MobileSheet from '@/components/mobile-audit/MobileSheet.vue'
import MobileShareSheet from '@/components/mobile-audit/MobileShareSheet.vue'
import EditAuditMetadataModal from '@/components/EditAuditMetadataModal.vue'
import { UserPlusIcon, PencilSquareIcon } from '@heroicons/vue/24/outline'

import MobileSiteTab from '@/components/mobile-audit/MobileSiteTab.vue'
import MobileZonesTab from '@/components/mobile-audit/MobileZonesTab.vue'
import MobileMetersTab from '@/components/mobile-audit/MobileMetersTab.vue'
import MobileSystemsTab from '@/components/mobile-audit/MobileSystemsTab.vue'
import MobileBmsTab from '@/components/mobile-audit/MobileBmsTab.vue'
import MobileChecklistTab from '@/components/mobile-audit/MobileChecklistTab.vue'
import MobilePlanTab from '@/components/mobile-audit/MobilePlanTab.vue'

/**
 * Vue mobile native de l'audit BACS / GTB.
 * - Top bar fixe : back / titre / menu
 * - Contenu plein-écran de l'onglet actif (un seul visible à la fois)
 * - Bottom tab bar fixe : 5 onglets
 *
 * Réutilise le store Pinia useAuditStore (même source de vérité que la
 * vue desktop). Pas de duplication de logique métier.
 */

const route = useRoute()
const router = useRouter()
const auditStore = useAuditStore()
// Sync desktop ↔ PWA : revalide à chaque retour sur l'onglet (utile
// quand l'auditeur revient à l'app après un appel ou un changement
// d'app) + polling 30 s tant que l'écran est visible.
useAuditAutoSync()

// Queue offline (PWA terrain) : injectée par App.vue. Un badge dans la
// topbar indique le nombre de modifs en attente de sync au retour
// réseau. Permet à l'auditeur en sous-sol de continuer à saisir sans
// perdre ses changements.
const offlineQueue = inject('offlineQueue', { pendingCount: ref(0) })
const { document, loading } = storeToRefs(auditStore)
const { error, success } = useNotification()
const { isOnline } = useOnlineStatus()
const { confirm } = useConfirm()

const docId = parseInt(route.params.id, 10)

// Ordre aligné sur le stepper desktop (BacsAuditDetailView STEP_DEFINITIONS) :
// Site → Zones → Systèmes → Compteurs → GTB. La régulation thermique R175-6
// est nichée dans l'onglet Systèmes côté mobile.
const TABS = [
  { key: 'site',     label: 'Site',     icon: IdentificationIcon },
  { key: 'zones',    label: 'Zones',    icon: Squares2X2Icon },
  { key: 'systems',  label: 'Systèmes', icon: WrenchScrewdriverIcon },
  { key: 'meters',   label: 'Comp.',    icon: BoltIcon },
  { key: 'bms',      label: 'GTB',      icon: ClipboardDocumentListIcon },
  { key: 'docs',     label: 'Docs',     icon: ClipboardDocumentCheckIcon },
  { key: 'plan',     label: 'Plan',     icon: ListBulletIcon },
]

const STORAGE_KEY = `mobile-audit-tab:${docId}`
const activeTab = ref(localStorage.getItem(STORAGE_KEY) || 'site')
watch(activeTab, v => localStorage.setItem(STORAGE_KEY, v))


// Tous les onglets visibles dans les deux modes (BACS + site_audit).
// La logique R175-spécifique (régulation thermique, capacités GTB R175-3/4/5)
// se masque à l'intérieur des onglets concernés selon le kind.
const visibleTabs = computed(() => TABS)

async function refresh() {
  try {
    await auditStore.loadAudit(docId)
  } catch {
    error('Échec chargement de l\'audit')
  }
}

onMounted(refresh)

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/')
}

// Sheet paramètres audit (kind, livrer, supprimer)
const showSettings = ref(false)
const showEditMetadata = ref(false)
function openEditMetadata() {
  showSettings.value = false
  showEditMetadata.value = true
}
async function onMetadataSaved(updated) {
  showEditMetadata.value = false
  const oldKind = document.value?.kind
  const newKind = updated.kind
  await refresh()
  if (oldKind && oldKind !== newKind) {
    const target = newKind === 'bacs_audit' ? `/bacs-audit/${docId}` : `/site-audit/${docId}`
    if (route.path !== target) router.replace(target)
  }
}
const showShare = ref(false)
const delivering = ref(false)

function openShare() {
  showSettings.value = false
  showShare.value = true
}

async function deliver() {
  const ok = await confirm({
    title: 'Livrer cet audit ?',
    message: 'Le PDF final sera généré et tagué dans Git. Re-livrer plus tard créera une nouvelle version.',
    confirmLabel: 'Livrer',
  })
  if (!ok) return
  delivering.value = true
  try {
    const { data } = await deliverBacsAudit(docId)
    success(`Audit livré — tag ${data.delivered_git_tag}`)
    showSettings.value = false
    await refresh()
  } catch (e) {
    error(e.response?.data?.detail || 'Échec de la livraison')
  } finally {
    delivering.value = false
  }
}

// Forcer le rechargement complet : utile en PWA standalone iOS où le SW
// peut servir un app-shell obsolète. Désinscrit le SW + purge les caches
// + reload bypass-cache.
const forcing = ref(false)
async function forceRefresh() {
  forcing.value = true
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(r => r.unregister()))
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    }
  } catch { /* silencieux */ }
  // Bypass cache HTTP via timestamp
  const url = new URL(window.location.href)
  url.searchParams.set('__t', Date.now().toString())
  window.location.replace(url.toString())
}

async function removeAudit() {
  const ok = await confirm({
    title: `Supprimer « ${document.value?.project_name || 'cet audit'} » ?`,
    message: 'Action irréversible. Toutes les données saisies (zones, compteurs, systèmes, photos) seront perdues.',
    confirmLabel: 'Supprimer',
    danger: true,
  })
  if (!ok) return
  try {
    await deleteAf(docId)
    success('Audit supprimé')
    router.push('/')
  } catch (e) {
    error(e.response?.data?.detail || 'Suppression impossible')
  }
}
</script>

<template>
  <div class="fixed inset-0 flex flex-col bg-gray-50 overflow-hidden">
    <!-- Top bar : sticky, safe-area top -->
    <header
      class="shrink-0 bg-indigo-600 text-white shadow-sm z-30"
      :style="{ paddingTop: 'env(safe-area-inset-top)' }"
    >
      <div class="flex items-center gap-2 h-12 px-2">
        <button
          @click="goBack"
          class="tap-target inline-flex items-center justify-center text-white/90 hover:text-white"
          aria-label="Retour"
        >
          <ChevronLeftIcon class="w-6 h-6" />
        </button>
        <div class="flex-1 min-w-0">
          <h1 class="text-base font-medium truncate leading-tight">
            {{ document?.project_name || 'Audit BACS' }}
          </h1>
          <p v-if="document?.client_name" class="text-[11px] text-white/70 truncate leading-tight">
            {{ document.client_name }}
          </p>
        </div>
        <!-- Indicateur connexion : signal barré rouge pulse si hors-ligne.
             Si des modifs sont en attente (queue offline), badge orange
             avec le compteur. Les 2 sont mutuellement exclusifs (offline =
             priorité affichage). -->
        <div
          v-if="!isOnline"
          class="inline-flex items-center justify-center w-9 h-9 rounded-full bg-red-500/30 text-red-100 animate-pulse"
          v-tooltip="`Hors-ligne — ${offlineQueue.pendingCount.value || 0} modif(s) en attente de sync`"
          aria-label="Hors-ligne"
        >
          <SignalSlashIcon class="w-5 h-5" />
        </div>
        <div
          v-else-if="offlineQueue.pendingCount.value > 0"
          class="inline-flex items-center justify-center min-w-9 h-9 px-2 rounded-full bg-amber-500/30 text-amber-100 text-xs font-semibold"
          v-tooltip="`${offlineQueue.pendingCount.value} modif(s) en cours de sync vers le serveur`"
          aria-label="Sync en cours"
        >
          ⇪ {{ offlineQueue.pendingCount.value }}
        </div>
        <div class="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md bg-white/15 text-white/90">
          BACS
        </div>
        <button
          @click="showSettings = true"
          class="tap-target inline-flex items-center justify-center text-white/90 hover:text-white"
          aria-label="Paramètres de l'audit"
        >
          <Cog6ToothIcon class="w-6 h-6" />
        </button>
      </div>

      <!-- Bandeau hors-ligne sous le header.
           Mig PR #90/91 : on a une queue offline qui sauvegarde les
           modifs en localStorage et les rejoue au retour réseau, donc
           le ton n'est plus alarmiste. Couleur orange pour signaler
           sans paniquer. -->
      <transition name="slide-down">
        <div
          v-if="!isOnline"
          class="px-3 py-2 bg-amber-500 text-white text-xs flex items-center gap-2 leading-tight"
        >
          <SignalSlashIcon class="w-4 h-4 shrink-0" />
          <span class="flex-1">
            <strong>Hors-ligne.</strong> Tes modifications sont mises en attente
            <span v-if="offlineQueue.pendingCount.value > 0">({{ offlineQueue.pendingCount.value }} en queue)</span>
            et seront synchronisées dès le retour réseau.
          </span>
        </div>
      </transition>
      <!-- Bandeau « sync en cours » : online avec queue non vide. Indique
           que des modifs faites hors-ligne sont en train d'être rejouées. -->
      <transition name="slide-down">
        <div
          v-if="isOnline && offlineQueue.pendingCount.value > 0"
          class="px-3 py-2 bg-amber-100 text-amber-900 text-xs flex items-center gap-2 leading-tight border-b border-amber-200"
        >
          <span class="inline-flex items-center justify-center w-4 h-4 shrink-0">⇪</span>
          <span class="flex-1">
            <strong>Synchronisation en cours…</strong>
            {{ offlineQueue.pendingCount.value }} modification{{ offlineQueue.pendingCount.value > 1 ? 's' : '' }} en attente d'envoi au serveur.
          </span>
        </div>
      </transition>
    </header>

    <!-- Contenu de l'onglet actif (scroll vertical, un seul visible) -->
    <main
      class="flex-1 overflow-y-auto overscroll-contain"
      :style="{ paddingBottom: 'calc(56px + env(safe-area-inset-bottom))' }"
    >
      <div v-if="loading" class="text-center py-12 text-gray-400 text-sm">Chargement…</div>
      <template v-else-if="document">
        <MobileSiteTab    v-show="activeTab === 'site'" />
        <MobileZonesTab   v-show="activeTab === 'zones'" />
        <MobileMetersTab  v-show="activeTab === 'meters'" />
        <MobileSystemsTab v-show="activeTab === 'systems'" />
        <MobileBmsTab     v-show="activeTab === 'bms'" />
        <MobileChecklistTab v-show="activeTab === 'docs'" />
        <MobilePlanTab    v-show="activeTab === 'plan'" />
      </template>
    </main>

    <!-- Bottom tab bar : sticky, safe-area bottom -->
    <nav
      class="fixed inset-x-0 bottom-0 z-30 bg-white border-t border-gray-200 flex flex-col"
      role="navigation"
      aria-label="Navigation audit"
    >
      <ul class="flex items-stretch h-14">
        <li v-for="tab in visibleTabs" :key="tab.key" class="flex-1">
          <button
            type="button"
            @click="activeTab = tab.key"
            :class="[
              'w-full h-full flex flex-col items-center justify-center gap-1 transition-colors select-none',
              activeTab === tab.key
                ? 'text-indigo-600'
                : 'text-gray-500 active:text-gray-700'
            ]"
          >
            <component :is="tab.icon" class="w-7 h-7 shrink-0" />
            <span class="text-[11px] font-medium leading-none">{{ tab.label }}</span>
          </button>
        </li>
      </ul>
      <!-- Spacer safe-area bottom : home indicator iOS, mêmes bg que la nav -->
      <div :style="{ height: 'env(safe-area-inset-bottom)' }"></div>
    </nav>

    <!-- Sheet Paramètres audit -->
    <MobileSheet
      :open="showSettings"
      title="Paramètres de l'audit"
      hide-save
      @close="showSettings = false"
    >
      <div class="p-4 space-y-4">
        <!-- Modifier les paramètres (parité AF) -->
        <button
          @click="openEditMetadata"
          class="w-full inline-flex items-center justify-center gap-2 px-4 py-4 text-base font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 active:bg-indigo-100 rounded-xl"
        >
          <PencilSquareIcon class="w-5 h-5" />
          Modifier les paramètres
        </button>

        <!-- Statut audit -->
        <div v-if="document?.delivered_at" class="px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3">
          <CheckCircleIcon class="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div class="flex-1 min-w-0 text-sm">
            <p class="font-medium text-emerald-800">Audit déjà livré</p>
            <p class="text-xs text-emerald-700 mt-0.5">
              Tag Git {{ document.delivered_git_tag || '—' }} le {{ new Date(document.delivered_at.replace(' ', 'T')).toLocaleDateString('fr-FR') }}
            </p>
          </div>
        </div>

        <!-- Action : Partager -->
        <button
          @click="openShare"
          class="w-full inline-flex items-center justify-center gap-2 px-4 py-4 text-base font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 active:bg-indigo-100 rounded-xl"
        >
          <UserPlusIcon class="w-5 h-5" />
          Partager l'audit
        </button>

        <!-- Action : Livrer -->
        <button
          @click="deliver"
          :disabled="delivering"
          class="w-full inline-flex items-center justify-center gap-2 px-4 py-4 text-base font-medium text-white bg-emerald-600 active:bg-emerald-700 rounded-xl disabled:opacity-50"
        >
          <CheckCircleIcon class="w-5 h-5" />
          {{ delivering ? 'Livraison…' : (document?.delivered_at ? 'Re-livrer (nouvelle version)' : 'Livrer cet audit') }}
        </button>

        <!-- Action : Forcer le rechargement (cache PWA / SW) -->
        <div class="pt-4 border-t border-gray-200">
          <button
            @click="forceRefresh"
            :disabled="forcing"
            class="w-full inline-flex items-center justify-center gap-2 px-4 py-4 text-base font-medium text-gray-700 bg-white border border-gray-200 rounded-xl active:bg-gray-50 disabled:opacity-50"
          >
            <ArrowPathIcon :class="['w-5 h-5', forcing ? 'animate-spin' : '']" />
            Forcer l'actualisation
          </button>
          <p class="text-xs text-gray-500 mt-2 leading-relaxed">
            Recharge l'app en purgeant le cache. Utile si une mise à jour ne s'affiche pas.
          </p>
        </div>

        <!-- Action : Supprimer -->
        <div class="pt-4 border-t border-gray-200">
          <button
            @click="removeAudit"
            class="w-full inline-flex items-center justify-center gap-2 px-4 py-4 text-base font-medium text-red-600 bg-red-50 border border-red-200 rounded-xl"
          >
            <TrashIcon class="w-5 h-5" />
            Supprimer l'audit
          </button>
          <p class="text-xs text-gray-500 mt-2 leading-relaxed">
            Action irréversible. L'audit, les zones, compteurs, systèmes et photos seront perdus.
          </p>
        </div>
      </div>
    </MobileSheet>

    <!-- Sheet Partager l'audit -->
    <MobileShareSheet
      :open="showShare"
      :doc-id="docId"
      @close="showShare = false"
    />

    <!-- Modifier les paramètres de l'audit (parité AF) -->
    <EditAuditMetadataModal
      v-if="showEditMetadata && document"
      :audit="document"
      @close="showEditMetadata = false"
      @saved="onMetadataSaved"
    />
  </div>
</template>

<style scoped>
.slide-down-enter-active,
.slide-down-leave-active {
  transition: max-height 220ms ease, opacity 200ms;
  overflow: hidden;
  max-height: 80px;
}
.slide-down-enter-from,
.slide-down-leave-to {
  max-height: 0;
  opacity: 0;
}
</style>
