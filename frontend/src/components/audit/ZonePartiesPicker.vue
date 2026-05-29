<script setup>
// Multi-select des parties prenantes affectées à une zone (item 4 —
// structure juridique). Réutilisé en desktop (ZonesSection, ligne
// d'expansion) et en mobile (MobileZonesTab, sheet d'édition).
//
// Le composant reçoit la liste des parties du site (`siteParties`) déjà
// chargée par le parent, et gère lui-même le chargement / la sauvegarde
// des affectations propres à la zone via getZoneParties / setZoneParties.
import { ref, onMounted, watch } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { resolveFaIconName } from '@/lib/equipment-icons'
import { useNotification } from '@/composables/useNotification'
import { useAuditStore } from '@/stores/audit'
import { getZoneParties, setZoneParties } from '@/api'
import { PARTY_KINDS } from '@/lib/audit-options'

const props = defineProps({
  zoneId: { type: [Number, String], required: true },
  // [{ id, name, kind }] — parties prenantes du site courant.
  siteParties: { type: Array, default: () => [] },
})

const { error } = useNotification()
const audit = useAuditStore()

const selectedIds = ref([])   // ids des parties affectées à la zone
const loading = ref(false)

function partyKind(kind) {
  return PARTY_KINDS.find(k => k.value === kind) || null
}
function partyKindLabel(kind) {
  return partyKind(kind)?.label || kind
}

async function load() {
  if (!props.zoneId) return
  loading.value = true
  try {
    const { data } = await getZoneParties(props.zoneId)
    selectedIds.value = (data || []).map(l => l.party_id)
    // Auto-seed : les parties du site sont héritées par toutes les zones
    // (accord Kevin 2026-05-29 — pas de surcharge locale). Si la zone
    // n'a encore aucune partie en DB, on persiste l'héritage complet
    // pour rester cohérent avec ce que les PDF / agrégations attendent.
    const siteIds = (props.siteParties || []).map(p => p.id)
    const missing = siteIds.filter(id => !selectedIds.value.includes(id))
    if (missing.length) {
      const merged = [...selectedIds.value, ...missing]
      await setZoneParties(props.zoneId, merged)
      selectedIds.value = merged
      await audit.refreshSiteParties()
    }
  } catch {
    error('Chargement des parties de la zone impossible')
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => props.zoneId, load)
// Si l'auditeur ajoute une nouvelle partie au site pendant qu'il édite
// la zone, on la propage immédiatement (héritage automatique).
watch(() => props.siteParties.map(p => p.id).join(','), async (newKey, oldKey) => {
  if (newKey === oldKey) return
  if (!props.zoneId || loading.value) return
  await load()
})
</script>

<template>
  <div>
    <p class="text-xs font-medium text-gray-600 mb-1">Parties prenantes rattachées à cette zone</p>

    <!-- Aucune partie définie sur le site -->
    <p v-if="!siteParties.length" class="text-[11px] text-gray-400 italic">
      Aucune partie prenante — à définir dans l'identification du site.
    </p>

    <!-- Toutes les parties du site sont héritées (cochées + verrouillées).
         Pour retirer une partie d'une zone, on la retire au niveau du site
         dans la carte Identification — pas de surcharge locale. -->
    <ul v-else class="space-y-1">
      <li v-for="p in siteParties" :key="p.id">
        <div class="inline-flex items-center gap-2 min-h-11 sm:min-h-0 opacity-90">
          <input
            type="checkbox"
            checked
            disabled
            class="rounded border-gray-300 text-emerald-600 cursor-not-allowed"
          />
          <FontAwesomeIcon
            :icon="['fas', resolveFaIconName(partyKind(p.kind)?.icon)]"
            :style="{ color: partyKind(p.kind)?.color || '#6b7280' }"
            class="w-4 h-4 shrink-0"
          />
          <span class="text-sm text-gray-700">{{ p.name }}</span>
          <span class="text-[11px] text-gray-400">({{ partyKindLabel(p.kind) }})</span>
          <span class="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded font-medium">hérité du site</span>
        </div>
      </li>
    </ul>
    <p v-if="siteParties.length" class="text-[11px] text-gray-400 italic mt-2">
      Pour retirer une partie, ouvrez la carte « Identification » du site.
    </p>
  </div>
</template>
