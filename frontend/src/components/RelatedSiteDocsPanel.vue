<script setup>
/**
 * Panneau "Documents liés sur ce site" (Lot A4).
 *
 * Liste tous les documents (AF + audits + brochures) du même site_id
 * que le document courant, hors document actuel. Permet de naviguer
 * facilement entre les documents d'un même projet.
 *
 * Usage :
 *   <RelatedSiteDocsPanel :site-id="123" :exclude-id="42" />
 */
import { ref, watch, onMounted, computed } from 'vue'
import { listAfs } from '@/api'
import {
  DocumentTextIcon, ShieldCheckIcon, BookOpenIcon,
} from '@heroicons/vue/24/outline'
import { docKindTip } from '@/lib/misc-tips'

const props = defineProps({
  siteId: { type: Number, default: null },
  excludeId: { type: Number, default: null },
})

const docs = ref([])
const loading = ref(false)

async function load() {
  if (!props.siteId) { docs.value = []; return }
  loading.value = true
  try {
    const { data } = await listAfs({ site_id: props.siteId })
    // Types inconnus ignorés (garde-fou : un nouveau type ne doit pas faire planter le panneau).
    docs.value = (data.items || data).filter(d => d.id !== props.excludeId && !d.deleted_at && KIND_META[d.kind])
  } catch (e) {
    docs.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => [props.siteId, props.excludeId], load)

const KIND_META = {
  af: { label: 'AF', color: 'text-indigo-700 bg-indigo-50 border-indigo-200', icon: DocumentTextIcon, route: id => `/afs/${id}` },
  bacs_audit: { label: 'Audit BACS', color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: ShieldCheckIcon, route: id => `/bacs-audit/${id}` },
  brochure: { label: 'Brochure', color: 'text-violet-700 bg-violet-50 border-violet-200', icon: BookOpenIcon, route: id => `/brochures/${id}` },
  // listAfs({ site_id }) renvoie TOUS les types : sans ces entrées, un audit GTB ou un rapport
  // de maintenance sur le site faisait planter le panneau (KIND_META[kind] indéfini).
  site_audit: { label: 'Audit GTB', color: 'text-sky-700 bg-sky-50 border-sky-200', icon: ShieldCheckIcon, route: id => `/site-audit/${id}` },
  maintenance_report: { label: 'Maintenance', color: 'text-amber-700 bg-amber-50 border-amber-200', icon: DocumentTextIcon, route: id => `/maintenance-reports/${id}` },
  whitepaper: { label: 'Livre blanc', color: 'text-pink-700 bg-pink-50 border-pink-200', icon: BookOpenIcon, route: id => `/marketing/whitepapers/${id}` },
}

const grouped = computed(() => {
  const out = {}
  for (const d of docs.value) {
    if (!out[d.kind]) out[d.kind] = []
    out[d.kind].push(d)
  }
  return out
})
</script>

<template>
  <div v-if="docs.length || loading"
       class="bg-white rounded-lg border border-gray-200 px-4 py-3">
    <h3 class="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
      📍 Sur ce site
    </h3>
    <div v-if="loading" class="text-xs text-gray-400 italic">Chargement…</div>
    <div v-else class="space-y-1.5">
      <router-link v-for="d in docs" :key="d.id"
                   :to="KIND_META[d.kind].route(d.id)"
                   class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 text-xs transition">
        <component :is="KIND_META[d.kind].icon" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span :class="['inline-block px-1.5 py-0 text-[9px] rounded border shrink-0', KIND_META[d.kind].color]"
              v-tooltip="docKindTip(d.kind)">
          {{ KIND_META[d.kind].label }}
        </span>
        <span class="flex-1 min-w-0 truncate text-gray-700" v-tooltip.overflow>
          {{ d.project_name || d.client_name || `#${d.id}` }}
        </span>
      </router-link>
    </div>
  </div>
</template>
