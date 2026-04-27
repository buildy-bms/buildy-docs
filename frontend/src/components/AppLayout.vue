<script setup>
import { ref, onMounted } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import api from '@/api'
import { resetAuth, currentUser } from '@/router'
import {
  DocumentTextIcon,
  RectangleStackIcon,
  MagnifyingGlassIcon,
  CogIcon,
  Bars3Icon,
  XMarkIcon,
  ArrowRightStartOnRectangleIcon,
  UserCircleIcon,
} from '@heroicons/vue/24/outline'
import CommandPalette from './CommandPalette.vue'

const route = useRoute()
const router = useRouter()
const sidebarOpen = ref(false)
const appVersion = ref('')

onMounted(async () => {
  try {
    const { data } = await api.get('/health')
    appVersion.value = data.version
  } catch { /* offline */ }
})

const paletteRef = ref(null)
const nav = [
  { name: 'Mes AFs', to: '/', icon: DocumentTextIcon },
  { section: 'Bibliotheque' },
  { name: 'Equipements', to: '/library', icon: RectangleStackIcon },
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
        <span class="text-white font-semibold text-sm">Buildy AF</span>
      </div>
      <button @click="sidebarOpen = !sidebarOpen" class="text-white/70 hover:text-white">
        <Bars3Icon v-if="!sidebarOpen" class="w-6 h-6" />
        <XMarkIcon v-else class="w-6 h-6" />
      </button>
    </div>

    <div class="flex">
      <!-- Sidebar -->
      <aside
        :class="[
          'fixed inset-y-0 left-0 z-30 w-52 h-screen bg-indigo-600 flex flex-col transform transition-transform lg:translate-x-0 lg:sticky lg:top-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        ]"
      >
        <div class="hidden lg:flex flex-col items-center justify-center py-4 px-4 border-b border-white/10 shrink-0 text-center">
          <img src="/logo-buildy-blanc.svg" alt="Buildy" class="h-8 mx-auto" />
          <span class="mt-1.5 text-[10px] font-medium text-white/40 uppercase tracking-[0.18em] text-center block">Analyses Fonctionnelles</span>
        </div>

        <div class="px-2.5 mt-3">
          <button
            @click="paletteRef?.openPalette ? paletteRef.openPalette() : null"
            class="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs text-white/60 hover:text-white/90 hover:bg-white/8 border border-white/10"
          >
            <span class="flex items-center gap-2">
              <MagnifyingGlassIcon class="w-4 h-4" />
              Rechercher…
            </span>
            <kbd class="text-[10px] px-1 py-0.5 bg-white/10 font-mono">{{ cmdKey }} K</kbd>
          </button>
        </div>

        <nav class="mt-3 px-2.5 space-y-0.5 flex-1 overflow-y-auto">
          <template v-for="(item, i) in nav" :key="item.section || item.to || i">
            <div
              v-if="item.section"
              class="mt-4 mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-white/30"
            >
              {{ item.section }}
            </div>
            <RouterLink
              v-else
              :to="item.to"
              @click="sidebarOpen = false"
              :class="[
                'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive(item.to) ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/8 hover:text-white/90',
              ]"
            >
              <component :is="item.icon" class="w-4.5 h-4.5" />
              {{ item.name }}
            </RouterLink>
          </template>
        </nav>

        <div class="shrink-0 px-4 py-3 border-t border-white/10">
          <div class="flex items-center gap-2 px-2.5 py-1.5 mb-1 text-xs text-white/70">
            <UserCircleIcon class="w-4 h-4" />
            {{ currentUser?.display_name || currentUser?.email || 'Utilisateur' }}
          </div>
          <button
            @click="logout"
            class="flex items-center gap-2 w-full px-2.5 py-1.5 mb-2 text-xs text-white/50 hover:text-white/90 hover:bg-white/8 rounded-lg transition-colors"
          >
            <ArrowRightStartOnRectangleIcon class="w-4 h-4" />
            Deconnexion
          </button>
          <p class="text-[10px] text-white/40">Buildy AF v{{ appVersion || '0.1.0' }}</p>
        </div>
      </aside>

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
