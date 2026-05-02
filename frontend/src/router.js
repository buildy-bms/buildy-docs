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
    path: '/bacs-audit/:id',
    name: 'bacs-audit-detail',
    meta: { title: 'Audit BACS' },
    component: () => import('@/views/BacsAuditDetailView.vue'),
    props: true,
  },
  {
    // Variante site (devis Buildy) — meme composant, kind=site_audit
    // basculé en interne via le champ document.kind. Le composant
    // affiche conditionnellement les blocs R175 selon ce kind.
    path: '/site-audit/:id',
    name: 'site-audit-detail',
    meta: { title: 'Audit GTB (Classique)' },
    component: () => import('@/views/BacsAuditDetailView.vue'),
    props: true,
  },
  {
    path: '/bacs-audit/:id/action-items',
    name: 'bacs-audit-action-items',
    meta: { title: 'Plan de mise en conformité' },
    component: () => import('@/views/BacsAuditActionItemsView.vue'),
    props: true,
  },
  {
    path: '/bacs-audit/:id/audit-trail',
    name: 'bacs-audit-trail',
    meta: { title: 'Historique audit BACS' },
    component: () => import('@/views/BacsAuditTrailView.vue'),
    props: true,
  },
  {
    // Variante site_audit — meme composant
    path: '/site-audit/:id/audit-trail',
    name: 'site-audit-trail',
    meta: { title: 'Historique audit GTB' },
    component: () => import('@/views/BacsAuditTrailView.vue'),
    props: true,
  },
  {
    path: '/afs/:id/versions',
    name: 'af-versions',
    meta: { title: 'Versions de l\'AF' },
    component: () => import('@/views/AfVersionsView.vue'),
    props: true,
  },
  {
    path: '/sites',
    name: 'sites',
    meta: { title: 'Mes Sites' },
    component: () => import('@/views/SitesListView.vue'),
  },
  {
    path: '/library',
    redirect: '/library/sections',
  },
  {
    path: '/library/sections',
    name: 'library-sections',
    meta: { title: 'Bibliothèque sections types' },
    component: () => import('@/views/LibrarySectionsView.vue'),
  },
  {
    path: '/library/equipments',
    name: 'library-systems',
    meta: { title: 'Systèmes techniques' },
    component: () => import('@/views/LibrarySystemsView.vue'),
  },
  {
    path: '/library/functionalities',
    name: 'library-functionalities',
    meta: { title: 'Bibliothèque fonctionnalités' },
    component: () => import('@/views/LibraryFunctionalitiesView.vue'),
  },
  {
    // Compat retro : ancienne URL des categories -> onglet du wrapper
    path: '/library/categories',
    redirect: '/library/equipments?tab=categories',
  },
  {
    path: '/audit',
    name: 'audit-trail',
    meta: { title: 'Audit trail' },
    component: () => import('@/views/AuditTrailView.vue'),
  },
  {
    path: '/ai-prompts',
    name: 'ai-prompts',
    meta: { title: 'Prompts IA' },
    component: () => import('@/views/AiPromptsView.vue'),
  },
  {
    path: '/admin/boilerplate',
    name: 'boilerplate-admin',
    meta: { title: 'Boilerplate PDF' },
    component: () => import('@/views/BoilerplateAdminView.vue'),
  },
  {
    path: '/admin/offerings-config',
    name: 'offerings-config',
    meta: { title: 'Configuration Offres PDF' },
    component: () => import('@/views/OfferingsConfigView.vue'),
  },
  {
    path: '/brochures/:id',
    name: 'brochure-detail',
    meta: { title: 'Brochure' },
    component: () => import('@/views/BrochureDetailView.vue'),
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
  document.title = to.meta.title ? `${to.meta.title} — Buildy Docs` : 'Buildy Docs'
})

export function resetAuth() {
  authChecked = false
  isAuthenticated = false
  currentUser.value = null
}

export default router
