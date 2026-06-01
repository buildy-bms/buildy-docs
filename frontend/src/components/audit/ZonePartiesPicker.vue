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
    const stored = (data || []).map(l => l.party_id)
    // Auto-seed UNIQUEMENT à la première édition (zone vide en DB) :
    // on hérite alors toutes les parties du site comme point de départ.
    // Une fois qu'au moins une partie est rattachée à la zone, on
    // respecte la sélection explicite de l'auditeur (sans réinjecter
    // ce qu'il a explicitement retiré).
    if (!stored.length && props.siteParties.length) {
      const siteIds = props.siteParties.map(p => p.id)
      await setZoneParties(props.zoneId, siteIds)
      selectedIds.value = siteIds
      await audit.refreshSiteParties()
    } else {
      selectedIds.value = stored
    }
  } catch {
    error('Chargement des parties de la zone impossible')
  } finally {
    loading.value = false
  }
}

async function toggle(partyId) {
  const next = selectedIds.value.includes(partyId)
    ? selectedIds.value.filter(id => id !== partyId)
    : [...selectedIds.value, partyId]
  selectedIds.value = next
  try {
    await setZoneParties(props.zoneId, next)
    await audit.refreshSiteParties()
  } catch {
    error('Sauvegarde des parties de la zone impossible')
  }
}

onMounted(load)
watch(() => props.zoneId, load)
</script>

<template>
  <div>
    <p class="text-xs font-medium text-gray-600 mb-1">Parties prenantes rattachées à cette zone</p>

    <!-- Aucune partie définie sur le site -->
    <p v-if="!siteParties.length" class="text-[11px] text-gray-400 italic">
      Aucune partie prenante — à définir dans l'identification du site.
    </p>

    <!-- Sélection libre : à la création de la zone, toutes les parties du
         site sont héritées par défaut. L'auditeur peut décocher au cas
         par cas (ex. un preneur ne loue qu'une zone). Les changements
         sont persistés à chaque toggle. -->
    <ul v-else class="space-y-1">
      <li v-for="p in siteParties" :key="p.id">
        <label class="inline-flex items-center gap-2 min-h-11 sm:min-h-0 cursor-pointer">
          <input
            type="checkbox"
            :checked="selectedIds.includes(p.id)"
            @change="toggle(p.id)"
            class="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500/30"
          />
          <FontAwesomeIcon
            :icon="['fas', resolveFaIconName(partyKind(p.kind)?.icon)]"
            :style="{ color: partyKind(p.kind)?.color || '#6b7280' }"
            class="w-4 h-4 shrink-0"
          />
          <span class="text-sm text-gray-700">{{ p.name }}</span>
          <span class="text-[11px] text-gray-400">({{ partyKindLabel(p.kind) }})</span>
        </label>
      </li>
    </ul>
  </div>
</template>
