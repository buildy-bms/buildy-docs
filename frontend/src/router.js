import { ref } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import api from '@/api'

export const authReady = ref(false)
export const currentUser = ref(null)

const routes = [
  {
    path: '/login',
    name: 'login',
    meta: { title: 'Connexion', public: true },
    component: () => import('@/views/LoginView.vue'),
  },
  {
    path: '/',
    name: 'afs',
    meta: { title: 'Mes AFs' },
    component: () => import('@/views/AfsListView.vue'),
  },
  {
    path: '/afs/:id',
    name: 'af-detail',
    meta: { title: 'AF' },
    component: () => import('@/views/AfDetailView.vue'),
    props: true,
  },
  {
    path: '/library',
    name: 'library',
    meta: { title: 'Bibliothèque équipements' },
    component: () => import('@/views/LibraryView.vue'),
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

let authChecked = false
let isAuthenticated = false

router.beforeEach(async (to) => {
  if (to.meta.public) {
    authReady.value = true
    return true
  }

  if (!authChecked) {
    try {
      const { data } = await api.get('/auth/me')
      isAuthenticated = true
      currentUser.value = data
    } catch {
      isAuthenticated = false
    }
    authChecked = true
    authReady.value = true
  }

  if (!isAuthenticated) return { path: '/login', replace: true }
  return true
})

router.afterEach((to) => {
  if (to.path === '/login') {
    authChecked = false
    isAuthenticated = false
    currentUser.value = null
  }
  document.title = to.meta.title ? `${to.meta.title} — Buildy AF` : 'Buildy AF'
})

export function resetAuth() {
  authChecked = false
  isAuthenticated = false
  currentUser.value = null
}

export default router
