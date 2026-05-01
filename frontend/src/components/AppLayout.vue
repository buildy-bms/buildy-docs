<script setup>
import { ref, onMounted, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import api from '@/api'
import { resetAuth, currentUser } from '@/router'
import {
  DocumentTextIcon,
  RectangleStackIcon,
  BookmarkIcon,
  SparklesIcon,
  MagnifyingGlassIcon,
  CogIcon,
  Bars3Icon,
  XMarkIcon,
  ArrowRightStartOnRectangleIcon,
  UserCircleIcon,
  ClockIcon,
  BuildingOffice2Icon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
} from '@heroicons/vue/24/outline'
import CommandPalette from './CommandPalette.vue'

const route = useRoute()
const router = useRouter()
const sidebarOpen = ref(false)
const SIDEBAR_STORAGE_KEY = 'buildy.docs.sidebarCollapsed'
const sidebarCollapsed = ref(localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1')
watch(sidebarCollapsed, (v) => {
  localStorage.setItem(SIDEBAR_STORAGE_KEY, v ? '1' : '0')
})

const tooltip = ref(null)
function showTooltip(label, event) {
  if (!sidebarCollapsed.value) return
  const rect = event.currentTarget.getBoundingClientRect()
  tooltip.value = {
    label,
    top: rect.top + rect.height / 2,
    left: rect.right + 8,
  }
}
function hideTooltip() { tooltip.value = null }

const appVersion = ref('')

onMounted(async () => {
  try {
    const { data } = await api.get('/health')
    appVersion.value = data.version
  } catch { /* offline */ }
})

const paletteRef = ref(null)
const nav = [
  { name: 'Mes documents', to: '/', icon: DocumentTextIcon },
  { name: 'Mes Sites', to: '/sites', icon: BuildingOffice2Icon },
  { section: 'Bibliothèque' },
  { name: 'Sections types', to: '/library/sections', icon: BookmarkIcon },
  { name: 'Systèmes techniques', to: '/library/equipments', icon: RectangleStackIcon },
  { name: 'Fonctionnalités', to: '/library/functionalities', icon: SparklesIcon },
  { section: 'Système' },
  { name: 'Prompts IA', to: '/ai-prompts', icon: SparklesIcon },
  { name: 'Audit trail', to: '/audit', icon: ClockIcon },
]
const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
const cmdKey = isMac ? '⌘' : 'Ctrl'

function isActive(to) {
  if (to === '/') return route.path === '/'
  return route.path.startsWith(to)
}

async function logout() {
  try { await api.post('/auth/logout') } catch { /* ignore */ }
  resetAuth()
  router.push('/login')
}
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <!-- Mobile header -->
    <div class="lg:hidden flex items-center justify-between bg-indigo-600 px-4 py-3">
      <div class="flex items-center gap-2">
        <img src="/logo-buildy-blanc.svg" alt="Buildy" class="h-6" />
        <span class="text-white font-semibold text-sm">Buildy Docs</span>
      </div>
      <button @click="sidebarOpen = !sidebarOpen" class="text-white/70 hover:text-white">
        <Bars3Icon v-if="!sidebarOpen" class="w-6 h-6" />
        <XMarkIcon v-else class="w-6 h-6" />
      </button>
    </div>

    <div class="flex">
      <!-- Sidebar : repliable comme dans Buildy Tools.
           Mode replie : 64px, icones seulement avec tooltip au survol.
           Mode etendu : 224px, libelles + sections.
           Etat persiste dans localStorage. -->
      <aside
        :class="[
          'fixed inset-y-0 left-0 z-30 w-60 h-screen bg-indigo-600 flex flex-col transform transition-transform lg:translate-x-0 lg:sticky lg:top-0 lg:h-screen lg:transition-[width] lg:duration-200 shrink-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          sidebarCollapsed ? 'lg:w-16' : 'lg:w-56',
        ]"
      >
        <!-- Toggle desktop -->
        <button
          @click="sidebarCollapsed = !sidebarCollapsed"
          @mouseenter="showTooltip(sidebarCollapsed ? 'Déplier le menu' : 'Replier le menu', $event)"
          @mouseleave="hideTooltip"
          class="hidden lg:flex absolute top-3 -right-3 z-40 w-6 h-6 items-center justify-center rounded-full bg-indigo-600 border border-white/20 text-white/60 hover:text-white hover:bg-indigo-700 transition-colors"
        >
          <ChevronDoubleLeftIcon v-if="!sidebarCollapsed" class="w-3.5 h-3.5" />
          <ChevronDoubleRightIcon v-else class="w-3.5 h-3.5" />
        </button>

        <div class="hidden lg:flex flex-col items-center justify-center py-4 px-2 border-b border-white/10 shrink-0 text-center">
          <img v-if="sidebarCollapsed" src="/logo-buildy-blanc.svg" alt="Buildy" class="h-7" />
          <img v-else src="/logo-buildy-blanc.svg" alt="Buildy" class="h-8 mx-auto" />
          <span v-if="!sidebarCollapsed" class="mt-1.5 text-[10px] font-medium text-white/40 uppercase tracking-[0.18em] text-center block">Documentation</span>
        </div>

        <div :class="['px-2.5 mt-3', sidebarCollapsed ? 'lg:px-2' : '']">
          <button
            @click="paletteRef?.openPalette ? paletteRef.openPalette() : null"
            @mouseenter="showTooltip('Rechercher…', $event)"
            @mouseleave="hideTooltip"
            :class="[
              'w-full flex items-center gap-2 rounded-lg text-xs text-white/60 hover:text-white/90 hover:bg-white/8 border border-white/10',
              sidebarCollapsed ? 'justify-center px-2 py-2' : 'justify-between px-2.5 py-1.5'
            ]"
          >
            <span class="flex items-center gap-2">
              <MagnifyingGlassIcon class="w-4 h-4 shrink-0" />
              <span v-if="!sidebarCollapsed">Rechercher…</span>
            </span>
            <kbd v-if="!sidebarCollapsed" class="text-[10px] px-1 py-0.5 bg-white/10 font-mono">{{ cmdKey }} K</kbd>
          </button>
        </div>

        <nav class="mt-3 px-2.5 space-y-0.5 flex-1 overflow-y-auto">
          <template v-for="(item, i) in nav" :key="item.section || item.to || i">
            <template v-if="item.section">
              <div v-if="sidebarCollapsed" class="my-2 border-t border-white/10 lg:mx-2" />
              <div v-else class="mt-4 mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-white/30">
                {{ item.section }}
              </div>
            </template>
            <RouterLink
              v-else
              :to="item.to"
              @click="sidebarOpen = false"
              @mouseenter="showTooltip(item.name, $event)"
              @mouseleave="hideTooltip"
              :class="[
                'flex items-center gap-2.5 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                sidebarCollapsed ? 'lg:justify-center lg:px-2 px-2.5' : 'px-2.5',
                isActive(item.to) ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/8 hover:text-white/90',
              ]"
            >
              <component :is="item.icon" class="w-4.5 h-4.5 shrink-0" />
              <span :class="sidebarCollapsed ? 'lg:hidden' : ''">{{ item.name }}</span>
            </RouterLink>
          </template>
        </nav>

        <div class="shrink-0 px-2.5 py-3 border-t border-white/10">
          <div
            @mouseenter="showTooltip(currentUser?.display_name || currentUser?.email || 'Utilisateur', $event)"
            @mouseleave="hideTooltip"
            :class="[
              'flex items-center gap-2 py-1.5 mb-1 text-xs text-white/70',
              sidebarCollapsed ? 'lg:justify-center px-1' : 'px-2.5'
            ]"
          >
            <UserCircleIcon class="w-4 h-4 shrink-0" />
            <span v-if="!sidebarCollapsed" class="truncate">{{ currentUser?.display_name || currentUser?.email || 'Utilisateur' }}</span>
          </div>
          <button
            @click="logout"
            @mouseenter="showTooltip('Déconnexion', $event)"
            @mouseleave="hideTooltip"
            :class="[
              'flex items-center gap-2 w-full py-1.5 mb-2 text-xs text-white/50 hover:text-white/90 hover:bg-white/8 rounded-lg transition-colors',
              sidebarCollapsed ? 'lg:justify-center px-2' : 'px-2.5'
            ]"
          >
            <ArrowRightStartOnRectangleIcon class="w-4 h-4 shrink-0" />
            <span v-if="!sidebarCollapsed">Déconnexion</span>
          </button>
          <p v-if="!sidebarCollapsed" class="text-[10px] text-white/40 px-2.5">Buildy Docs v{{ appVersion || '0.1.0' }}</p>
        </div>
      </aside>

      <!-- Tooltip teleporte (visible uniquement quand sidebar repliee) -->
      <Teleport to="body">
        <div
          v-if="tooltip"
          :style="{ top: tooltip.top + 'px', left: tooltip.left + 'px' }"
          class="fixed z-100 -translate-y-1/2 px-2.5 py-1 text-[11px] font-medium text-white bg-indigo-600 rounded-md shadow-lg pointer-events-none whitespace-nowrap"
        >
          {{ tooltip.label }}
        </div>
      </Teleport>

      <!-- Overlay mobile -->
      <div v-if="sidebarOpen" class="fixed inset-0 z-20 bg-black/40 lg:hidden" @click="sidebarOpen = false" />

      <!-- Main content -->
      <main class="flex-1 min-w-0 px-5 py-4 lg:px-6 lg:py-5">
        <slot />
      </main>
    </div>

    <CommandPalette ref="paletteRef" />
  </div>
</template>
