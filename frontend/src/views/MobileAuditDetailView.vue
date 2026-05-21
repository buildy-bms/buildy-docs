<script setup>
import { ref, computed, onMounted, watch, inject } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter, useRoute } from 'vue-router'
// Toutes les icônes via FontAwesome Pro Solid (charte Buildy Docs).
// Le registre `lib/equipment-icons.js` enregistre déjà les icônes
// utilisées ici dans la library FA (tree-shake garanti).
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
import { useAuditStore } from '@/stores/audit'
import { useAuditAutoSync } from '@/composables/useAuditAutoSync'
import { useNotification } from '@/composables/useNotification'
import { useOnlineStatus } from '@/composables/useOnlineStatus'
import { useConfirm } from '@/composables/useConfirm'
import { updateAf, deleteAf, deliverBacsAudit } from '@/api'
import api from '@/api'
import MobileSheet from '@/components/mobile-audit/MobileSheet.vue'
import MobileShareSheet from '@/components/mobile-audit/MobileShareSheet.vue'
import MobileEditAuditMetadataSheet from '@/components/mobile-audit/MobileEditAuditMetadataSheet.vue'
import EditSiteModal from '@/components/EditSiteModal.vue'
import MobileSynthesisSheet from '@/components/mobile-audit/MobileSynthesisSheet.vue'

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
// PWA : sync agressif (5s) — une chaudière ajoutée desktop doit apparaître
// quasi instantanément côté terrain pour que l'auditeur ne saisisse pas
// en double. Charge réseau négligeable (l'écran d'audit est dédié, pas
// d'autres polls concurrents).
useAuditAutoSync({ intervalMs: 5000 })

// Queue offline (PWA terrain) : injectée par App.vue. Un badge dans la
// topbar indique le nombre de modifs en attente de sync au retour
// réseau. Permet à l'auditeur en sous-sol de continuer à saisir sans
// perdre ses changements.
const offlineQueue = inject('offlineQueue', { pendingCount: ref(0) })
const {
  document, loading, zones, systems, meters, bms, actionItems,
} = storeToRefs(auditStore)
const { error, success } = useNotification()
const { isOnline } = useOnlineStatus()
const { confirm } = useConfirm()

const docId = parseInt(route.params.id, 10)

// Ordre aligné sur le stepper desktop (BacsAuditDetailView STEP_DEFINITIONS) :
// Site → Zones → Systèmes → Compteurs → GTB. La régulation thermique R175-6
// est nichée dans l'onglet Systèmes côté mobile.
// Onglets PWA — icônes FontAwesome Pro Solid (registre dans lib/equipment-icons.js).
// Pas de variante "outline" en FA solid : l'onglet actif est distingué par
// la couleur indigo + l'indicateur de top-bar qui glisse, pas par un
// changement d'icône.
const TABS = [
  { key: 'site',    label: 'Site',     icon: 'id-card' },
  { key: 'zones',   label: 'Zones',    icon: 'table-cells-large' },
  { key: 'systems', label: 'Systèmes', icon: 'screwdriver-wrench' },
  { key: 'meters',  label: 'Comp.',    icon: 'bolt' },
  { key: 'bms',     label: 'GTB',      icon: 'clipboard-list' },
  { key: 'docs',    label: 'Docs',     icon: 'clipboard-check' },
  { key: 'plan',    label: 'Plan',     icon: 'list' },
]

const STORAGE_KEY = `mobile-audit-tab:${docId}`
const activeTab = ref(localStorage.getItem(STORAGE_KEY) || 'site')
watch(activeTab, v => localStorage.setItem(STORAGE_KEY, v))

// Resync à chaque changement d'onglet : rattrape les modifications faites
// côté desktop quand le polling 30s ou le visibilitychange iOS PWA
// standalone n'a pas (encore) tiré le rafraîchissement.
watch(activeTab, () => auditStore.softRefresh())

// Navigation depuis les KPIs de couverture photo (onglet Docs) : bascule
// l'onglet et set un pendingFocus dans le store. Le tab cible (zones /
// meters / systems) observe pendingFocus pour ouvrir directement l'entité
// puis le reset.
function onNavigateFromDocs({ kind, entityId }) {
  const tabByKind = {
    site: 'site',
    zones: 'zones',
    systems: 'systems',
    meters: 'meters',
    bms: 'bms',
  }
  const target = tabByKind[kind]
  if (target) activeTab.value = target
  if (entityId != null) {
    auditStore.pendingFocus = { kind, id: entityId }
  }
}


// Tous les onglets visibles dans les deux modes (BACS + site_audit).
// La logique R175-spécifique (régulation thermique, capacités GTB R175-3/4/5)
// se masque à l'intérieur des onglets concernés selon le kind.
const visibleTabs = computed(() => TABS)

// Pastilles de complétude par onglet (Vague 3 item 13). Format :
//   { tone: 'red'|'amber', count?: number }   (null = rien à signaler)
//
// Quand `count` est fourni, on affiche un badge chiffré façon iOS Mail
// (cercle de couleur avec le compteur). Sinon un simple dot. Permet à
// l'auditeur de voir d'un coup d'œil combien d'éléments réclament son
// attention dans chaque onglet, sans devoir y entrer.
//
// Volontairement permissif : on n'affiche pas un dot vert sur tout
// (pollution visuelle), juste un signal rouge/jaune si l'auditeur doit
// y revenir.
const tabDot = computed(() => {
  const out = {}
  out.site = null
  // Zones : aucune zone → red (count omis : c'est binaire)
  out.zones = (zones.value?.length || 0) === 0 ? { tone: 'red' } : null
  // Systèmes : nombre de systèmes ni present ni not_concerned
  const sys = systems.value || []
  const sysToFill = sys.filter(s => !s.present && !s.not_concerned).length
  out.systems = sysToFill > 0 ? { tone: 'amber', count: sysToFill } : null
  // Compteurs : nombre de compteurs required absents (pas HS)
  const m = meters.value || []
  const missingMeters = m.filter(x => x.required && !x.present_actual && !x.out_of_service).length
  out.meters = missingMeters > 0 ? { tone: 'red', count: missingMeters } : null
  // GTB : si BMS vide → amber (pas de compteur, juste un dot)
  const b = bms.value || {}
  const bmsHasContent = !!(b.existing_solution || b.existing_solution_brand || b.location || b.overall_compliance)
  out.bms = !bmsHasContent ? { tone: 'amber' } : null
  out.docs = null
  // Plan : nombre d'actions blocking ouvertes (priorité) ou major
  const actions = actionItems.value || []
  const blocking = actions.filter(a => a.severity === 'blocking' && a.status !== 'done' && a.status !== 'declined').length
  const major = actions.filter(a => a.severity === 'major' && a.status !== 'done' && a.status !== 'declined').length
  out.plan = blocking > 0
    ? { tone: 'red', count: blocking }
    : (major > 0 ? { tone: 'amber', count: major } : null)
  return out
})

// Index de l'onglet actif dans visibleTabs : alimente l'indicateur top-bar
// qui glisse sous chaque onglet sélectionné.
const activeTabIndex = computed(() =>
  Math.max(0, visibleTabs.value.findIndex(t => t.key === activeTab.value)),
)

async function refresh() {
  try {
    await auditStore.loadAudit(docId)
  } catch {
    error('Échec chargement de l\'audit')
  }
}

onMounted(refresh)

// Numéro de version (affiché dans le sheet paramètres pour faciliter le
// support : Kévin sait quelle version tourne sur la PWA du terrain).
const appVersion = ref('')
const buildSha = ref('')
onMounted(async () => {
  try {
    const { data } = await api.get('/health')
    appVersion.value = data.version
    buildSha.value = data.build_sha || ''
  } catch { /* offline */ }
})

function goBack() {
  // Sur PWA standalone iOS, window.history.length n'est pas fiable (le
  // SW peut reset l'historique au cold-start). On force le retour à la
  // liste d'accueil pour éviter les cas où router.back() sortait de
  // l'app sans donner accès à la liste des audits.
  router.push('/')
}

// Sheet paramètres audit (kind, livrer, supprimer)
const showSettings = ref(false)
const showEditMetadata = ref(false)
function openEditMetadata() {
  showSettings.value = false
  showEditMetadata.value = true
}
const showEditSite = ref(false)
function openEditSite() {
  showSettings.value = false
  showEditSite.value = true
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
const showSynthesis = ref(false)
const delivering = ref(false)

function openShare() {
  showSettings.value = false
  showShare.value = true
}

function openSynthesis() {
  showSettings.value = false
  showSynthesis.value = true
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
          <FontAwesomeIcon :icon="['fas', 'chevron-left']" class="w-5 h-5" />
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
          <FontAwesomeIcon :icon="['fas', 'signal-slash']" class="w-5 h-5" />
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
          class="tap-target inline-flex items-center justify-center text-white/90 hover:text-white active:scale-90 transition-transform"
          aria-label="Paramètres de l'audit"
        >
          <FontAwesomeIcon :icon="['fas', 'gear']" class="w-5 h-5" />
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
          <FontAwesomeIcon :icon="['fas', 'signal-slash']" class="w-4 h-4 shrink-0" />
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

    <!-- Contenu de l'onglet actif (scroll vertical, un seul visible). Cross-fade
         + léger lift au switch d'onglet pour une transition iOS-like sans
         défaire la position de scroll (chaque tab reste monté via v-show). -->
    <main
      class="flex-1 overflow-y-auto overscroll-contain relative"
      :style="{ paddingBottom: 'calc(56px + max(4px, env(safe-area-inset-bottom)))' }"
    >
      <div v-if="loading" class="text-center py-12 text-gray-500 text-sm">Chargement…</div>
      <template v-else-if="document">
        <div :class="['tab-pane', activeTab === 'site' ? 'tab-pane-active' : '']">
          <MobileSiteTab v-show="activeTab === 'site'" />
        </div>
        <div :class="['tab-pane', activeTab === 'zones' ? 'tab-pane-active' : '']">
          <MobileZonesTab v-show="activeTab === 'zones'" />
        </div>
        <div :class="['tab-pane', activeTab === 'meters' ? 'tab-pane-active' : '']">
          <MobileMetersTab v-show="activeTab === 'meters'" />
        </div>
        <div :class="['tab-pane', activeTab === 'systems' ? 'tab-pane-active' : '']">
          <MobileSystemsTab v-show="activeTab === 'systems'" />
        </div>
        <div :class="['tab-pane', activeTab === 'bms' ? 'tab-pane-active' : '']">
          <MobileBmsTab v-show="activeTab === 'bms'" />
        </div>
        <div :class="['tab-pane', activeTab === 'docs' ? 'tab-pane-active' : '']">
          <MobileChecklistTab v-show="activeTab === 'docs'" @navigate="onNavigateFromDocs" />
        </div>
        <div :class="['tab-pane', activeTab === 'plan' ? 'tab-pane-active' : '']">
          <MobilePlanTab v-show="activeTab === 'plan'" />
        </div>
      </template>
    </main>

    <!-- Bottom tab bar : sticky, safe-area bottom -->
    <nav
      class="fixed inset-x-0 bottom-0 z-30 bg-white/95 backdrop-blur-sm border-t border-gray-200 flex flex-col"
      role="navigation"
      aria-label="Navigation audit"
    >
      <ul class="relative flex items-stretch h-14">
        <!-- Indicateur top-bar qui glisse sous l'onglet actif (largeur = 1/N
             du nav). Position via transform translateX(activeIndex * 100%)
             pour une transition fluide et performante. -->
        <span
          aria-hidden="true"
          class="pointer-events-none absolute top-0 left-0 h-0.5 bg-indigo-600 rounded-full transition-transform duration-300 ease-out"
          :style="{
            width: `${100 / visibleTabs.length}%`,
            transform: `translateX(${activeTabIndex * 100}%)`,
          }"
        ></span>
        <li v-for="tab in visibleTabs" :key="tab.key" class="flex-1">
          <button
            type="button"
            @click="activeTab = tab.key"
            :class="[
              'w-full h-full flex flex-col items-center justify-center gap-0.5 transition-colors select-none relative',
              activeTab === tab.key
                ? 'text-indigo-600'
                : 'text-gray-500 active:text-gray-700',
            ]"
          >
            <span class="relative inline-flex">
              <FontAwesomeIcon
                :icon="['fas', tab.icon]"
                :class="[
                  'w-6 h-6 shrink-0 transition-transform duration-200',
                  activeTab === tab.key ? 'scale-110' : 'scale-100',
                ]"
              />
              <!-- Badge complétude : chiffré façon iOS Mail si tabDot fournit
                   un count, sinon simple dot. Rouge = action requise, amber
                   = à compléter. Ring blanc pour bien détacher de l'icône. -->
              <span
                v-if="tabDot[tab.key]"
                :class="[
                  'absolute inline-flex items-center justify-center ring-2 ring-white rounded-full font-semibold',
                  tabDot[tab.key].count
                    ? '-top-1 -right-2 min-w-4 h-4 px-1 text-[10px] text-white leading-none'
                    : '-top-0.5 -right-0.5 w-2.5 h-2.5',
                  tabDot[tab.key].tone === 'red' ? 'bg-red-500' : 'bg-amber-400',
                ]"
                :aria-label="tabDot[tab.key].tone === 'red' ? 'Action requise' : 'À compléter'"
              >{{ tabDot[tab.key].count || '' }}</span>
            </span>
            <span :class="['text-[11px] leading-none transition-all', activeTab === tab.key ? 'font-semibold' : 'font-medium']">{{ tab.label }}</span>
          </button>
        </li>
      </ul>
      <!-- Spacer safe-area bottom : home indicator iOS. Min 4px sur iPad / Android sans notch
           pour eviter une bordure inferieure visuellement collee a 0. -->
      <div :style="{ height: 'max(4px, env(safe-area-inset-bottom))' }"></div>
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
          <FontAwesomeIcon :icon="['fas', 'pen-to-square']" class="w-5 h-5" />
          Modifier les paramètres
        </button>

        <!-- Modifier le site rattaché (nom, adresse, coordonnées GPS) -->
        <button
          v-if="auditStore.site"
          @click="openEditSite"
          class="w-full inline-flex items-center justify-center gap-2 px-4 py-4 text-base font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 active:bg-indigo-100 rounded-xl"
        >
          <FontAwesomeIcon :icon="['fas', 'map-pin']" class="w-5 h-5" />
          Modifier le site
        </button>

        <!-- Statut audit -->
        <div v-if="document?.delivered_at" class="px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3">
          <FontAwesomeIcon :icon="['fas', 'circle-check']" class="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
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
          <FontAwesomeIcon :icon="['fas', 'user-plus']" class="w-5 h-5" />
          Partager l'audit
        </button>

        <!-- Action : Synthèse Claude (PR-V Vague 3 item 12) -->
        <button
          @click="openSynthesis"
          class="w-full inline-flex items-center justify-center gap-2 px-4 py-4 text-base font-medium text-violet-700 bg-violet-50 border border-violet-200 active:bg-violet-100 rounded-xl"
        >
          <FontAwesomeIcon :icon="['fas', 'sparkles']" class="w-5 h-5" />
          Synthèse Claude
        </button>


        <!-- Action : Livrer -->
        <button
          @click="deliver"
          :disabled="delivering"
          class="w-full inline-flex items-center justify-center gap-2 px-4 py-4 text-base font-medium text-white bg-emerald-600 active:bg-emerald-700 rounded-xl disabled:opacity-50"
        >
          <FontAwesomeIcon :icon="['fas', 'circle-check']" class="w-5 h-5" />
          {{ delivering ? 'Livraison…' : (document?.delivered_at ? 'Re-livrer (nouvelle version)' : 'Livrer cet audit') }}
        </button>

        <!-- Action : Forcer le rechargement (cache PWA / SW) -->
        <div class="pt-4 border-t border-gray-200">
          <button
            @click="forceRefresh"
            :disabled="forcing"
            class="w-full inline-flex items-center justify-center gap-2 px-4 py-4 text-base font-medium text-gray-700 bg-white border border-gray-200 rounded-xl active:bg-gray-50 disabled:opacity-50"
          >
            <FontAwesomeIcon :icon="['fas', 'arrows-rotate']" :class="['w-5 h-5', forcing ? 'animate-spin' : '']" />
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
            <FontAwesomeIcon :icon="['fas', 'trash']" class="w-5 h-5" />
            Supprimer l'audit
          </button>
          <p class="text-xs text-gray-500 mt-2 leading-relaxed">
            Action irréversible. L'audit, les zones, compteurs, systèmes et photos seront perdus.
          </p>
        </div>

        <!-- Numéro de version Buildy Docs -->
        <p class="pt-2 text-center text-[11px] text-gray-500">
          Buildy Docs v{{ appVersion || '0.1.0' }}<span v-if="buildSha"> · {{ buildSha }}</span>
        </p>
      </div>
    </MobileSheet>

    <!-- Sheet Partager l'audit -->
    <MobileShareSheet
      :open="showShare"
      :doc-id="docId"
      @close="showShare = false"
    />

    <!-- Sheet Synthese Claude (PR-V) -->
    <MobileSynthesisSheet
      :open="showSynthesis"
      @close="showSynthesis = false"
    />

    <!-- Modifier les paramètres de l'audit — sheet plein écran iOS-natif
         (Vague 3 item 10, remplace la modale desktop centrée). -->
    <MobileEditAuditMetadataSheet
      :open="showEditMetadata"
      :audit="document"
      @close="showEditMetadata = false"
      @saved="onMetadataSaved"
    />

    <!-- Édition du site rattaché (nom, adresse, coordonnées GPS) -->
    <EditSiteModal
      v-if="showEditSite && auditStore.site"
      :site="auditStore.site"
      @close="showEditSite = false"
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

/* Cross-fade subtle + lift léger à chaque changement d'onglet.
   Les onglets restent montés (v-show) donc le scroll position de chacun
   est conservé. La transition n'agit que sur l'enveloppe `.tab-pane`
   active : opacity 0 → 1 + translateY(4px → 0) en 220 ms. */
.tab-pane {
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 220ms ease-out, transform 220ms ease-out;
}
.tab-pane-active {
  opacity: 1;
  transform: translateY(0);
}
</style>
