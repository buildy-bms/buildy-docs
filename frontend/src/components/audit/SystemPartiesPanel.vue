<script setup>
// Item 4c/4d — Affectation des parties prenantes à un système (surcharge
// de l'héritage zone) + affichage de l'assujetti calculé.
//
// Refactor 2026-05-26 — Les 2 anciennes questions « sous-station de
// réseau urbain » et « système multi-bâtiments » ont été supprimées :
//  · sous-station = dérivée du modèle d'équipement choisi (slug
//    'sous-station-reseau-urbain', cf. _export-data.js)
//  · multi-bâtiments = flag déplacé sur l'équipement (mig 175)
// Sur desktop, ce panel n'est plus utilisé directement — il vit dans
// SystemSettingsModal. Sur mobile, il reste utilisé inline.
import { ref, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import {
  getSystemParties, setSystemParties, getBacsLiability,
} from '@/api'
import { PARTY_KINDS } from '@/lib/audit-options'

const props = defineProps({
  system: { type: Object, required: true },
})

const audit = useAuditStore()
// `parties` (toutes les parties du site) vient du store partagé — même
// liste que la carte Structure juridique, toujours à jour.
const { document, siteParties: parties } = storeToRefs(audit)
const { error } = useNotification()

const systemLinks = ref([])      // [{ party_id, responsible_for_works }]
const liability = ref(null)      // { label, explanation, caseLabel }
const loading = ref(false)

const partyKindLabel = (kind) => PARTY_KINDS.find(k => k.value === kind)?.label || kind

async function loadAll() {
  if (!document.value?.id) return
  loading.value = true
  try {
    const [sysp, liab] = await Promise.all([
      getSystemParties(props.system.id),
      getBacsLiability(document.value.id),
    ])
    systemLinks.value = sysp.data || []
    liability.value = liab.data.by_system?.[props.system.id] || null
    // Auto-seed : héritage transitif (site → zone → système). Si une
    // partie du site n'est pas encore liée à ce système, on la lie
    // automatiquement (accord Kevin 2026-05-29 — pas de surcharge
    // locale, le toggle est verrouillé côté UI). `responsible_for_works`
    // reste à false par défaut (saisie locale via le toggle dédié).
    const siteIds = (parties.value || []).map(p => p.id)
    const linkedIds = new Set(systemLinks.value.map(l => l.party_id))
    const missing = siteIds.filter(id => !linkedIds.has(id))
    if (missing.length) {
      const merged = [
        ...systemLinks.value,
        ...missing.map(id => ({ party_id: id, responsible_for_works: 0 })),
      ]
      await setSystemParties(props.system.id, merged.map(l => ({
        party_id: l.party_id,
        responsible_for_works: !!l.responsible_for_works,
      })))
      systemLinks.value = merged
      const liab2 = await getBacsLiability(document.value.id)
      liability.value = liab2.data.by_system?.[props.system.id] || null
    }
  } catch {
    error('Chargement des parties prenantes impossible')
  } finally {
    loading.value = false
  }
}

onMounted(loadAll)
watch(() => props.system.id, loadAll)
// Si une partie est ajoutée au site, la propager immédiatement ici.
watch(() => (parties.value || []).map(p => p.id).join(','), async (newKey, oldKey) => {
  if (newKey === oldKey || loading.value) return
  await loadAll()
})

function linkFor(partyId) {
  return systemLinks.value.find(l => l.party_id === partyId) || null
}

async function persistLinks() {
  try {
    const payload = systemLinks.value.map(l => ({
      party_id: l.party_id,
      responsible_for_works: !!l.responsible_for_works,
    }))
    await setSystemParties(props.system.id, payload)
    // Recalcule l'assujetti après modification.
    const liab = await getBacsLiability(document.value.id)
    liability.value = liab.data.by_system?.[props.system.id] || null
  } catch {
    error('Sauvegarde impossible')
  }
}

function toggleWorks(partyId, checked) {
  const link = linkFor(partyId)
  if (link) { link.responsible_for_works = checked ? 1 : 0; persistLinks() }
}
</script>

<template>
  <div class="space-y-2.5">
    <!-- Assujetti calculé -->
    <div v-if="liability"
         class="flex items-start gap-2 rounded-md bg-slate-100 border border-slate-200 px-2.5 py-2">
      <span class="text-sm">⚖️</span>
      <div class="text-xs text-gray-700 leading-relaxed">
        <strong class="text-slate-800">{{ liability.label }}</strong>
        <span v-if="liability.explanation" class="text-gray-500"> — {{ liability.explanation }}</span>
      </div>
    </div>

    <!-- Toutes les parties du site sont héritées par le système (cochées
         + verrouillées). Seule la sub-saisie « travaux preneurs » reste
         éditable car elle est spécifique à ce système. -->
    <div v-if="parties.length">
      <span class="text-xs font-medium text-gray-600">Parties rattachées à ce système</span>
      <p class="text-[11px] text-gray-400 mb-1">
        Héritage automatique depuis le site (via la zone). Pour retirer une partie, ouvrez la carte « Identification » du site.
      </p>
      <ul class="space-y-1">
        <li v-for="p in parties" :key="p.id"
            class="flex items-center gap-2 flex-wrap text-xs">
          <div class="inline-flex items-center gap-1.5 opacity-90">
            <input type="checkbox" checked disabled
                   class="rounded border-gray-300 text-emerald-600 cursor-not-allowed" />
            <span class="text-gray-700">{{ p.name }}</span>
            <span class="text-[10px] text-gray-400">({{ partyKindLabel(p.kind) }})</span>
            <span class="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded font-medium">hérité de la zone</span>
          </div>
          <label v-if="linkFor(p.id) && p.kind === 'tenant'"
                 class="inline-flex items-center gap-1 cursor-pointer text-[11px] text-amber-700">
            <input type="checkbox" :checked="!!linkFor(p.id)?.responsible_for_works"
                   @change="e => toggleWorks(p.id, e.target.checked)"
                   class="rounded border-amber-300" />
            <span>travaux preneurs</span>
          </label>
        </li>
      </ul>
    </div>
    <p v-else class="text-[11px] text-gray-400 italic">
      Aucune partie prenante définie pour le site (section Identification).
    </p>
  </div>
</template>
