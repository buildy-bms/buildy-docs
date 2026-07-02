<script setup>
/**
 * Modal de paramètres d'un système BACS — regroupe les choix rares
 * qui n'ont pas besoin d'être visibles en permanence sur la card :
 *
 *  1. Poste négligeable (R175 — règle des 5 %) + justification.
 *  2. Surcharge des parties prenantes assujetties (hérite de la zone
 *     par défaut, surcharge possible ici).
 *
 * Les 2 anciennes questions « sous-station de réseau urbain » et
 * « système centralisé multi-bâtiments » sont SUPPRIMÉES de cette
 * modal (elles ne sont plus saisies au niveau système) :
 *  - sous-station = dérivée du modèle d'équipement choisi
 *  - multi-bâtiments = champ déplacé au niveau équipement (DeviceEditModal)
 */
import { ref, computed, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import BaseModal from '@/components/BaseModal.vue'
import SegmentedToggle from '@/components/audit/SegmentedToggle.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import {
  getSystemParties, setSystemParties, getBacsLiability, updateBacsSystem,
} from '@/api'
import { PARTY_KINDS } from '@/lib/audit-options'

const props = defineProps({
  system: { type: Object, required: true },
  systemWeightPct: { type: Number, default: null },
})
const emit = defineEmits(['close', 'patched'])

const audit = useAuditStore()
const { document, siteParties: parties } = storeToRefs(audit)
const { error } = useNotification()

const systemLinks = ref([])
const liability = ref(null)
const partyKindLabel = (k) => PARTY_KINDS.find(p => p.value === k)?.label || k
const triState = (v) => (v == null ? null : !!v)

async function loadAll() {
  if (!document.value?.id) return
  try {
    const [sysp, liab] = await Promise.all([
      getSystemParties(props.system.id),
      getBacsLiability(document.value.id),
    ])
    systemLinks.value = sysp.data || []
    liability.value = liab.data.by_system?.[props.system.id] || null
  } catch {
    error('Chargement des parties prenantes impossible')
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
    const liab = await getBacsLiability(document.value.id)
    liability.value = liab.data.by_system?.[props.system.id] || null
    emit('patched')
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

// Poste négligeable < 5 % : édité ici, mais mute toujours le système
// parent (props.system) puis émet `patched` pour que la liste se recharge.
// R175-2 §5 (FAQ ministère juin 2025) exige une justification textuelle
// — le backend refuse le flag=1 sans texte. Quand on active le flag on
// prompt inline l'auditeur ; sur annulation ou vide on ne persiste rien.
async function setNegligible(v) {
  try {
    if (v === true) {
      const existing = (props.system.negligible_justification || '').trim()
      const text = window.prompt(
        'Justifie l\'exemption R175-2 §5 (FAQ ministère juin 2025) — ex : « petits ballons ECS individuels », « groupe de secours ».\n\nLa justification est obligatoire pour un poste négligeable.',
        existing,
      )
      if (text == null) return  // annulation
      const trimmed = text.trim()
      if (!trimmed) {
        error('Justification obligatoire pour marquer un poste négligeable.')
        return
      }
      await updateBacsSystem(props.system.id, {
        marked_negligible_under_5pct: true,
        negligible_justification: trimmed,
      })
      props.system.marked_negligible_under_5pct = 1
      props.system.negligible_justification = trimmed
    } else {
      const patch = { marked_negligible_under_5pct: v }
      if (!v) patch.negligible_justification = null
      await updateBacsSystem(props.system.id, patch)
      props.system.marked_negligible_under_5pct = v === false ? 0 : null
      if (!v) props.system.negligible_justification = null
    }
    emit('patched')
  } catch (e) {
    error(e?.response?.data?.detail || 'Sauvegarde impossible')
  }
}
async function setJustification(text) {
  const trimmed = (text || '').trim()
  // Si le système est marqué négligeable, la justification ne peut pas
  // être vidée (le backend renverra 400) — on revert la saisie locale.
  if (props.system.marked_negligible_under_5pct === 1 && !trimmed) {
    error('Justification obligatoire tant que le poste est marqué négligeable.')
    return
  }
  try {
    await updateBacsSystem(props.system.id, { negligible_justification: trimmed || null })
    props.system.negligible_justification = trimmed || null
    emit('patched')
  } catch (e) {
    error(e?.response?.data?.detail || 'Sauvegarde impossible')
  }
}
</script>

<template>
  <BaseModal title="Paramètres du système" size="lg" @close="emit('close')">
    <div class="space-y-5 text-sm">
      <!-- Assujetti calculé (lecture seule) -->
      <div v-if="liability"
           class="flex items-start gap-2 rounded-md bg-slate-100 border border-slate-200 px-3 py-2">
        <span class="text-base">⚖️</span>
        <div class="text-xs text-gray-700 leading-relaxed">
          <strong class="text-slate-800">{{ liability.label }}</strong>
          <span v-if="liability.explanation" class="text-gray-500"> — {{ liability.explanation }}</span>
        </div>
      </div>

      <!-- Surcharge parties assujetties -->
      <section>
        <h4 class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
          Surcharge des parties assujetties
        </h4>
        <p class="text-xs text-gray-500 mb-2 leading-relaxed">
          Par défaut, le système hérite des parties prenantes de sa zone. Coche ici
          uniquement pour rattacher ce système à une partie spécifique (ex : système
          partagé entre plusieurs zones, équipement repris par un preneur).
        </p>
        <ul v-if="parties.length" class="space-y-1.5">
          <li v-for="p in parties" :key="p.id"
              class="flex items-center gap-2 flex-wrap text-sm">
            <label class="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" :checked="!!linkFor(p.id)"
                     @change="e => toggleParty(p.id, e.target.checked)"
                     class="rounded border-gray-300" />
              <span class="text-gray-800">{{ p.name }}</span>
              <span class="text-[11px] text-gray-400">({{ partyKindLabel(p.kind) }})</span>
            </label>
            <label v-if="linkFor(p.id) && p.kind === 'tenant'"
                   class="inline-flex items-center gap-1.5 cursor-pointer text-xs text-amber-700 ml-3">
              <input type="checkbox" :checked="!!linkFor(p.id)?.responsible_for_works"
                     @change="e => toggleWorks(p.id, e.target.checked)"
                     class="rounded border-amber-300" />
              <span>travaux preneurs</span>
            </label>
          </li>
        </ul>
        <p v-else class="text-xs text-gray-400 italic">
          Aucune partie prenante définie pour le site — à renseigner dans la section
          Identification.
        </p>
      </section>

      <!-- Poste négligeable < 5 % -->
      <section class="border-t border-gray-100 pt-4">
        <h4 class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
          Règle des 5 % (FAQ ministère)
        </h4>
        <div class="qa-grid">
          <div class="qa-question">
            Ce poste est-il négligeable (moins de 5 % de la consommation totale) ?
            <span class="qa-desc">
              <template v-if="systemWeightPct != null">
                Poids estimé ~<span :class="['font-mono', systemWeightPct > 10 ? 'text-amber-600 font-semibold' : 'text-gray-500']">{{ systemWeightPct }} %</span>
                <R175Tooltip class="ml-1 align-middle">
                  <div class="font-semibold text-gray-800 mb-1.5">Comment le poids est-il estimé ?</div>
                  <div class="text-xs text-gray-600 leading-relaxed">
                    Faute de relevés réels, le poids est approximé à partir de la
                    <strong>puissance installée</strong> du système rapportée à la
                    puissance totale du site. La règle des 5 % du décret repose sur
                    la <strong>consommation réelle</strong> : ce pourcentage n'est
                    qu'une approximation indicative.
                  </div>
                </R175Tooltip>
              </template>
              <template v-else>
                Un poste sous 5 % de la consommation totale peut être exempté de
                certaines exigences (FAQ ministère, juin 2025).
              </template>
            </span>
          </div>
          <SegmentedToggle :model-value="triState(system.marked_negligible_under_5pct)"
                           @update:model-value="setNegligible" />
        </div>
        <input v-if="system.marked_negligible_under_5pct"
               type="text"
               :value="system.negligible_justification || ''"
               @change="e => setJustification(e.target.value)"
               placeholder="Justification (ex : petits ballons ECS individuels, groupe de secours…)"
               class="w-full mt-2 text-sm rounded-md border border-gray-200 focus:border-indigo-400 focus:ring focus:ring-indigo-400/30 px-3 py-2" />
      </section>
    </div>
  </BaseModal>
</template>
