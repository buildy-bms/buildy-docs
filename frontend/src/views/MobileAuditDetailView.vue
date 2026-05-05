<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter, useRoute } from 'vue-router'
import {
  ChevronLeftIcon,
  IdentificationIcon,
  Squares2X2Icon,
  BoltIcon,
  WrenchScrewdriverIcon,
  ClipboardDocumentListIcon,
  EllipsisHorizontalIcon,
  SignalSlashIcon,
  Cog6ToothIcon,
  TrashIcon,
  CheckCircleIcon,
  FireIcon,
  BuildingOffice2Icon,
} from '@heroicons/vue/24/outline'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { useOnlineStatus } from '@/composables/useOnlineStatus'
import { useConfirm } from '@/composables/useConfirm'
import { updateAf, deleteAf, deliverBacsAudit } from '@/api'
import MobileSheet from '@/components/mobile-audit/MobileSheet.vue'
import MobileShareSheet from '@/components/mobile-audit/MobileShareSheet.vue'
import { UserPlusIcon } from '@heroicons/vue/24/outline'

import MobileSiteTab from '@/components/mobile-audit/MobileSiteTab.vue'
import MobileZonesTab from '@/components/mobile-audit/MobileZonesTab.vue'
import MobileMetersTab from '@/components/mobile-audit/MobileMetersTab.vue'
import MobileSystemsTab from '@/components/mobile-audit/MobileSystemsTab.vue'
import MobileBmsTab from '@/components/mobile-audit/MobileBmsTab.vue'

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
const { document, loading } = storeToRefs(auditStore)
const { error, success } = useNotification()
const { isOnline } = useOnlineStatus()
const { confirm } = useConfirm()

const docId = parseInt(route.params.id, 10)

const TABS = [
  { key: 'site',     label: 'Site',     icon: IdentificationIcon },
  { key: 'zones',    label: 'Zones',    icon: Squares2X2Icon },
  { key: 'meters',   label: 'Compteurs',icon: BoltIcon },
  { key: 'systems',  label: 'Systèmes', icon: WrenchScrewdriverIcon },
  { key: 'bms',      label: 'GTB',      icon: ClipboardDocumentListIcon },
]

const STORAGE_KEY = `mobile-audit-tab:${docId}`
const activeTab = ref(localStorage.getItem(STORAGE_KEY) || 'site')
watch(activeTab, v => localStorage.setItem(STORAGE_KEY, v))

const isBacs = computed(() => (document.value?.kind || 'bacs_audit') === 'bacs_audit')

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
const showShare = ref(false)
const switching = ref(false)
const delivering = ref(false)

function openShare() {
  showSettings.value = false
  showShare.value = true
}

async function switchKind(newKind) {
  if (!document.value || newKind === document.value.kind) return
  if (newKind !== 'bacs_audit' && newKind !== 'site_audit') return
  switching.value = true
  try {
    await updateAf(docId, { kind: newKind })
    success(newKind === 'bacs_audit' ? 'Audit basculé en mode BACS' : 'Audit basculé en mode GTB')
    await refresh()
    const target = newKind === 'bacs_audit' ? `/bacs-audit/${docId}` : `/site-audit/${docId}`
    if (route.path !== target) router.replace(target)
  } catch (e) {
    error(e.response?.data?.detail || 'Bascule impossible')
  } finally {
    switching.value = false
  }
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
            {{ document?.project_name || (isBacs ? 'Audit BACS' : 'Audit GTB') }}
          </h1>
          <p v-if="document?.client_name" class="text-[11px] text-white/70 truncate leading-tight">
            {{ document.client_name }}
          </p>
        </div>
        <!-- Indicateur connexion : signal barré rouge pulse si hors-ligne -->
        <div
          v-if="!isOnline"
          class="inline-flex items-center justify-center w-9 h-9 rounded-full bg-red-500/30 text-red-100 animate-pulse"
          title="Hors-ligne — les modifications ne sont pas sauvegardées"
          aria-label="Hors-ligne"
        >
          <SignalSlashIcon class="w-5 h-5" />
        </div>
        <div class="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md bg-white/15 text-white/90">
          {{ isBacs ? 'BACS' : 'GTB' }}
        </div>
        <button
          @click="showSettings = true"
          class="tap-target inline-flex items-center justify-center text-white/90 hover:text-white"
          aria-label="Paramètres de l'audit"
        >
          <Cog6ToothIcon class="w-6 h-6" />
        </button>
      </div>

      <!-- Bandeau hors-ligne complet sous le header -->
      <transition name="slide-down">
        <div
          v-if="!isOnline"
          class="px-3 py-2 bg-red-600 text-white text-xs flex items-center gap-2 leading-tight"
        >
          <SignalSlashIcon class="w-4 h-4 shrink-0" />
          <span class="flex-1">
            <strong>Hors-ligne.</strong> Tes modifications ne seront pas sauvegardées tant que la connexion n'est pas rétablie.
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
        <!-- Type d'audit (kind) -->
        <div>
          <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Type d'audit</p>
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              @click="switchKind('bacs_audit')"
              :disabled="switching"
              :class="['flex flex-col items-center justify-center gap-2 p-4 rounded-xl border-2 transition disabled:opacity-50',
                       isBacs
                         ? 'border-orange-500 bg-orange-50 text-orange-700'
                         : 'border-gray-200 bg-white text-gray-600']"
            >
              <FireIcon class="w-7 h-7" />
              <span class="text-sm font-medium">BACS R175</span>
            </button>
            <button
              type="button"
              @click="switchKind('site_audit')"
              :disabled="switching"
              :class="['flex flex-col items-center justify-center gap-2 p-4 rounded-xl border-2 transition disabled:opacity-50',
                       !isBacs
                         ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                         : 'border-gray-200 bg-white text-gray-600']"
            >
              <BuildingOffice2Icon class="w-7 h-7" />
              <span class="text-sm font-medium">GTB classique</span>
            </button>
          </div>
          <p class="text-xs text-gray-500 mt-2 leading-relaxed">
            Bascule sans perte de données. Les saisies (zones, compteurs, systèmes…)
            sont conservées ; seuls les blocs spécifiques R175 changent d'affichage.
          </p>
        </div>

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
