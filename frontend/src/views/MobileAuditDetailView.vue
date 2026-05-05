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
} from '@heroicons/vue/24/outline'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'

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
const { error } = useNotification()

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
        <div class="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md bg-white/15 text-white/90">
          {{ isBacs ? 'BACS' : 'GTB' }}
        </div>
      </div>
    </header>

    <!-- Contenu de l'onglet actif (scroll vertical, un seul visible) -->
    <main
      class="flex-1 overflow-y-auto overscroll-contain"
      :style="{ paddingBottom: 'calc(64px + env(safe-area-inset-bottom))' }"
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
      class="fixed inset-x-0 bottom-0 z-30 bg-white border-t border-gray-200"
      :style="{ paddingBottom: 'env(safe-area-inset-bottom)' }"
      role="navigation"
      aria-label="Navigation audit"
    >
      <ul class="flex items-stretch h-16">
        <li v-for="tab in visibleTabs" :key="tab.key" class="flex-1">
          <button
            type="button"
            @click="activeTab = tab.key"
            :class="[
              'w-full h-full flex flex-col items-center justify-center gap-0.5 transition-colors select-none',
              activeTab === tab.key
                ? 'text-indigo-600'
                : 'text-gray-500 active:text-gray-700'
            ]"
          >
            <component :is="tab.icon" class="w-6 h-6 shrink-0" />
            <span class="text-[10px] font-medium leading-none">{{ tab.label }}</span>
          </button>
        </li>
      </ul>
    </nav>
  </div>
</template>
