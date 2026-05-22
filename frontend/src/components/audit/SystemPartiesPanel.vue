<script setup>
// Item 4c/4d — Affectation des parties prenantes à un système + flags
// d'assujettissement (sous-station réseau, multi-bâtiments) + affichage
// de l'assujetti calculé.
import { ref, computed, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import SegmentedToggle from '@/components/audit/SegmentedToggle.vue'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import {
  getSystemParties, setSystemParties, getBacsLiability,
  updateBacsSystem,
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
  } catch {
    error('Chargement des parties prenantes impossible')
  } finally {
    loading.value = false
  }
}

onMounted(loadAll)
watch(() => props.system.id, loadAll)

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

function toggleParty(partyId, checked) {
  if (checked) {
    if (!linkFor(partyId)) systemLinks.value.push({ party_id: partyId, responsible_for_works: 0 })
  } else {
    systemLinks.value = systemLinks.value.filter(l => l.party_id !== partyId)
  }
  persistLinks()
}

function toggleWorks(partyId, checked) {
  const link = linkFor(partyId)
  if (link) { link.responsible_for_works = checked ? 1 : 0; persistLinks() }
}

async function patchFlag(field, checked) {
  try {
    await updateBacsSystem(props.system.id, { [field]: checked })
    props.system[field] = checked ? 1 : 0
    const liab = await getBacsLiability(document.value.id)
    liability.value = liab.data.by_system?.[props.system.id] || null
  } catch {
    error('Sauvegarde impossible')
  }
}

const isSubstation = computed(() => !!props.system.is_district_heating_substation)
const servesMulti = computed(() => !!props.system.serves_multiple_buildings)
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

    <!-- Multi-select parties + travaux preneurs -->
    <div v-if="parties.length">
      <span class="text-xs font-medium text-gray-600">Parties rattachées à ce système</span>
      <p class="text-[11px] text-gray-400 mb-1">
        Par défaut, le système hérite des parties de sa zone. Cochez ici pour surcharger.
      </p>
      <ul class="space-y-1">
        <li v-for="p in parties" :key="p.id"
            class="flex items-center gap-2 flex-wrap text-xs">
          <label class="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" :checked="!!linkFor(p.id)"
                   @change="e => toggleParty(p.id, e.target.checked)"
                   class="rounded border-gray-300" />
            <span class="text-gray-700">{{ p.name }}</span>
            <span class="text-[10px] text-gray-400">({{ partyKindLabel(p.kind) }})</span>
          </label>
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

    <!-- Flags cas E / F -->
    <div class="space-y-2 border-t border-gray-100 pt-2">
      <div class="flex items-center gap-3">
        <span class="text-xs text-gray-700">Ce système est-il une sous-station de réseau de chaleur urbain ?
          <span class="text-[10px] text-gray-400">(le gestionnaire de réseau n'est pas assujetti)</span></span>
        <SegmentedToggle :model-value="isSubstation"
                         @update:model-value="v => patchFlag('is_district_heating_substation', v)" />
      </div>
      <div class="flex items-center gap-3">
        <span class="text-xs text-gray-700">Ce système centralisé dessert-il plusieurs bâtiments ?</span>
        <SegmentedToggle :model-value="servesMulti"
                         @update:model-value="v => patchFlag('serves_multiple_buildings', v)" />
      </div>
    </div>
  </div>
</template>
