<script setup>
// Item 4 — Structure juridique du site + parties prenantes.
// Carte autonome réutilisée en desktop (IdentificationSection) et en
// mobile (MobileSiteTab). Gère la structure juridique du site et le CRUD
// des parties prenantes (propriétaires / preneurs / syndicat / réseau).
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { PencilSquareIcon } from '@heroicons/vue/24/outline'
import '@/lib/equipment-icons'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { useViewport } from '@/composables/useViewport'
import { createSiteParty, updateSiteParty, deleteSiteParty } from '@/api'
import { OWNERSHIP_STRUCTURES, PARTY_KINDS } from '@/lib/audit-options'
import PartyZonesPicker from '@/components/audit/PartyZonesPicker.vue'

// `flush` : rendu en sous-section (sans chrome de card) quand la carte est
// imbriquée dans une autre section — évite l'effet « card dans une card ».
defineProps({
  flush: { type: Boolean, default: false },
})
const emit = defineEmits(['open-notes'])

const audit = useAuditStore()
// Parties prenantes : source unique partagée via le store (renommées
// `parties` / `suggestion` localement pour le template).
const { site, siteParties: parties, sitePartiesSuggestion: suggestion } = storeToRefs(audit)
const { error, success } = useNotification()
const { isNarrow } = useViewport()

function hasNotes(html) {
  if (!html) return false
  return html.replace(/<[^>]*>/g, '').trim().length > 0
}

// Champ de formulaire — hauteur uniforme h-9 (36px), alignée sur les
// autres éléments de la card.
const fieldCls = 'h-9 px-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition'

const adding = ref(false)
const newParty = ref({ name: '', kind: 'owner_occupant' })

const partyKindLabel = (kind) => PARTY_KINDS.find(k => k.value === kind)?.label || kind

async function saveOwnership(patch) {
  try {
    await audit.updateSiteFields(patch)
    success('Structure juridique mise à jour')
    // La suggestion de partie par défaut dépend de la structure.
    if (!parties.value.length) await audit.refreshSiteParties()
  } catch {
    error('Sauvegarde impossible')
  }
}

let notesTimer = null
function saveNotesDebounced(value) {
  clearTimeout(notesTimer)
  notesTimer = setTimeout(() => {
    audit.updateSiteFields({ ownership_notes: value || null }).catch(() => error('Sauvegarde impossible'))
  }, 500)
}

async function addParty(preset) {
  const uuid = site.value?.site_uuid || site.value?.uuid || audit.document?.site_uuid
  if (!uuid) return
  const payload = preset || { name: newParty.value.name.trim(), kind: newParty.value.kind }
  if (!payload.name) return error('Nom de la partie requis')
  try {
    const { data } = await createSiteParty(uuid, payload)
    parties.value.push({ ...data, zone_ids: [] })
    suggestion.value = null
    newParty.value = { name: '', kind: 'owner_occupant' }
    adding.value = false
  } catch (e) {
    error(e.response?.data?.detail || 'Ajout impossible')
  }
}

async function patchParty(party, patch) {
  Object.assign(party, patch)
  try { await updateSiteParty(party.id, patch) }
  catch { error('Sauvegarde impossible') }
}

async function removeParty(party) {
  if (!confirm(`Supprimer la partie « ${party.name} » ?`)) return
  try {
    await deleteSiteParty(party.id)
    parties.value = parties.value.filter(p => p.id !== party.id)
  } catch {
    error('Suppression impossible')
  }
}

const structure = computed({
  get: () => site.value?.ownership_structure || '',
  set: (v) => saveOwnership({ ownership_structure: v || null }),
})
</script>

<template>
  <div :class="flush ? '' : 'bg-white rounded-2xl border border-gray-200 overflow-hidden'">
    <div :class="['flex items-center gap-2',
                  flush ? 'pb-2.5' : 'px-4 py-3 border-b border-gray-100']">
      <FontAwesomeIcon :icon="['fas', 'scale-balanced']" class="w-5 h-5 text-indigo-600 shrink-0" />
      <h3 class="text-base font-medium text-gray-900">Structure juridique &amp; parties prenantes</h3>
    </div>
    <div :class="flush ? 'space-y-3' : 'p-4 space-y-3'">
      <!-- Structure juridique + bouton Notes des particularités à droite -->
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-0.5">
          Structure de propriété / occupation
          <span class="font-normal text-gray-400">— détermine l'assujetti au décret, calculé par système</span>
        </label>
        <div class="flex items-center gap-2">
          <select v-model="structure" :class="fieldCls" class="flex-1 min-w-0">
            <option value="">Non renseignée</option>
            <option v-for="o in OWNERSHIP_STRUCTURES" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <button
            v-if="!isNarrow"
            type="button"
            @click="emit('open-notes', {
              title: 'Particularités de la structure juridique',
              contextLabel: 'Structure juridique du site',
              entityType: 'site_ownership',
              entityRef: site,
              currentHtml: site?.ownership_notes || '',
              noteField: 'ownership_notes',
            })"
            :class="['inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border transition whitespace-nowrap shrink-0',
              hasNotes(site?.ownership_notes)
                ? 'border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                : 'border-gray-200 text-gray-600 bg-white hover:bg-gray-50']"
            v-tooltip="hasNotes(site?.ownership_notes) ? 'Modifier les particularités de la structure' : 'Ajouter des particularités de la structure'"
          >
            <PencilSquareIcon class="w-4 h-4 shrink-0" />
            {{ hasNotes(site?.ownership_notes) ? 'Notes' : '+ Notes' }}
          </button>
        </div>
        <textarea
          v-if="isNarrow"
          :value="site?.ownership_notes || ''"
          @input="e => saveNotesDebounced(e.target.value)"
          rows="2"
          placeholder="Particularités de la structure (optionnel)…"
          class="mt-1.5 w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white leading-relaxed"
        ></textarea>
      </div>

      <!-- Parties prenantes -->
      <div class="border-t border-gray-100 pt-2.5">
        <span class="block text-xs font-medium text-gray-700 mb-1.5">Parties prenantes</span>

        <!-- Suggestion par défaut -->
        <div v-if="suggestion && !parties.length && !adding"
             class="mb-1.5 flex items-center justify-between gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
          <span class="text-xs text-amber-800">
            Suggestion : <strong>{{ suggestion.name }}</strong> ({{ partyKindLabel(suggestion.kind) }})
          </span>
          <button @click="addParty(suggestion)"
                  class="text-xs font-medium text-amber-800 underline whitespace-nowrap shrink-0">
            Créer
          </button>
        </div>

        <!-- Liste des parties — nom + rôle + suppression sur une ligne -->
        <ul v-if="parties.length" class="space-y-1.5">
          <li v-for="p in parties" :key="p.id"
              class="border border-gray-200 rounded-lg p-2">
            <!-- Nom · type · zones affectées sur une seule ligne -->
            <div class="flex flex-wrap items-center gap-1.5">
              <input
                :value="p.name"
                @blur="e => e.target.value !== p.name && patchParty(p, { name: e.target.value })"
                placeholder="Nom de la partie"
                :class="fieldCls" class="flex-1 min-w-40"
              />
              <select
                :value="p.kind"
                @change="e => patchParty(p, { kind: e.target.value })"
                :class="fieldCls" class="w-56 shrink-0"
              >
                <option v-for="k in PARTY_KINDS" :key="k.value" :value="k.value">{{ k.label }}</option>
              </select>
              <!-- Zones affectées (item 5) — à droite du type -->
              <div class="flex-2 min-w-56">
                <PartyZonesPicker :party-id="p.id" :zones="audit.zones" v-model="p.zone_ids" />
              </div>
              <button @click="removeParty(p)"
                      class="btn-icon btn-icon-danger"
                      v-tooltip="'Supprimer cette partie prenante'">
                <FontAwesomeIcon :icon="['fas', 'trash']" class="w-4 h-4" />
              </button>
            </div>
          </li>
        </ul>
        <p v-else-if="!suggestion && !adding" class="text-xs text-gray-400 italic">
          Aucune partie prenante.
        </p>

        <!-- Bouton d'ajout, pleine largeur sous la liste -->
        <button
          v-if="!adding"
          @click="adding = true"
          class="btn-add mt-1.5"
        >
          <FontAwesomeIcon :icon="['fas', 'plus']" class="w-4 h-4 shrink-0" /> Ajouter une partie prenante
        </button>

        <!-- Formulaire d'ajout — nom + rôle sur une ligne -->
        <div v-if="adding" class="mt-1.5 border border-indigo-200 bg-indigo-50/40 rounded-lg p-2 space-y-1.5">
          <div class="flex flex-wrap items-center gap-1.5">
            <input
              v-model="newParty.name"
              placeholder="Nom de la partie (ex : Foncière X, Locataire Y…)"
              :class="fieldCls" class="flex-1 min-w-36"
            />
            <select v-model="newParty.kind" :class="fieldCls" class="w-56 shrink-0">
              <option v-for="k in PARTY_KINDS" :key="k.value" :value="k.value">{{ k.label }}</option>
            </select>
          </div>
          <div class="flex gap-2 justify-end">
            <button @click="adding = false"
                    class="h-9 text-xs font-medium text-gray-600 px-3 rounded-lg hover:bg-gray-100 transition">
              Annuler
            </button>
            <button @click="addParty()"
                    class="h-9 text-xs font-medium text-white bg-indigo-600 px-3 rounded-lg hover:bg-indigo-700 whitespace-nowrap transition">
              Ajouter la partie
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
