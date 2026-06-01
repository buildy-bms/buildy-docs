<script setup>
import { ref, computed, nextTick } from 'vue'
import BaseModal from './BaseModal.vue'
import SearchableSelect from './SearchableSelect.vue'
import ProtocolMultiPicker from './ProtocolMultiPicker.vue'
import { createBacsDevice } from '@/api'
import { isThermalCategory, deviceRoleAllowsEnergySource } from '@/lib/audit-options'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  systemId: { type: Number, required: true },
  systemLabel: { type: String, required: true },
  systemCategory: { type: String, default: null },
  zoneName: { type: String, default: '' },
  energyOptions: { type: Array, required: true },
  roleOptions: { type: Array, required: true },
  commOptions: { type: Array, required: true },
  // Mode onglet : rend le formulaire sans son BaseModal propre (panneau
  // « Saisie manuelle » de la modale d'ajout d'équipement à 2 onglets).
  embedded: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'created'])
const { success, error } = useNotification()

// Le niveau (Production / Distribution / Émission / Régulation) découle du
// découpage thermique R175-6 : champ masqué et non requis hors chauffage /
// climatisation.
const roleApplies = computed(() => isThermalCategory(props.systemCategory))

// Item 3c — la puissance nominale n'a de sens que pour les usages
// thermiques / aérauliques (masquée pour éclairage, production élec.).
const POWER_RELEVANT = new Set(['heating', 'cooling', 'ventilation', 'dhw'])
const showPower = computed(() => POWER_RELEVANT.has(props.systemCategory))

const EMPTY_FORM = () => ({
  name: '', brand: '', model_reference: '', power_kw: null,
  // Multi-rôle (mig 117). communication_protocols = JSON array (multi),
  // cohérent avec le tableau des équipements (plus de champ mono-enum).
  energy_source: null, device_role: [], communication_protocols: null,
  location: '', notes: '',
})
const form = ref(EMPTY_FORM())
const submitting = ref(false)
const nameInput = ref(null)

// Nombre de protocoles sélectionnés (communication_protocols = JSON string).
function protocolCount() {
  try {
    const a = JSON.parse(form.value.communication_protocols || '[]')
    return Array.isArray(a) ? a.length : 0
  } catch { return 0 }
}

const hasIdentity = () => !!(form.value.name?.trim() || form.value.brand?.trim() || form.value.model_reference?.trim())
// Doctrine mig 194 — l'énergie primaire n'est exigée que si le rôle inclut
// Production. Pour un radiateur à eau chaude (émission seule), c'est
// l'équipement amont qui porte l'énergie, pas celui-ci.
const energyRequired = computed(() => deviceRoleAllowsEnergySource(form.value.device_role))
const canSubmit = () =>
  hasIdentity() &&
  (!energyRequired.value || !!form.value.energy_source) &&
  (!roleApplies.value || (Array.isArray(form.value.device_role) && form.value.device_role.length > 0)) &&
  protocolCount() > 0

// Liste des champs obligatoires manquants (affichée sous le bouton grisé).
const missingFields = () => {
  const out = []
  if (!hasIdentity()) out.push('un nom, une marque ou une référence')
  if (energyRequired.value && !form.value.energy_source) out.push('l\'énergie primaire')
  if (roleApplies.value && !(Array.isArray(form.value.device_role) && form.value.device_role.length)) out.push('la fonction')
  if (protocolCount() === 0) out.push('le(s) protocole(s)')
  return out
}

// keepContext=true : « Enregistrer et ajouter un autre ». Réinitialise
// l'identité du système mais conserve énergie / niveau / protocoles
// (généralement communs aux équipements d'un même système) et garde la
// modale ouverte. Sinon : ferme la modale après la création.
async function submit(keepContext = false) {
  if (!canSubmit() || submitting.value) return
  submitting.value = true
  try {
    await createBacsDevice(props.systemId, { ...form.value })
    emit('created')
    if (keepContext) {
      const kept = {
        energy_source: form.value.energy_source,
        device_role: [...form.value.device_role],
        communication_protocols: form.value.communication_protocols,
      }
      form.value = { ...EMPTY_FORM(), ...kept }
      success('Système ajouté — saisissez le suivant')
      await nextTick()
      nameInput.value?.focus()
    } else {
      success('Système ajouté')
      emit('close')
    }
  } catch (e) {
    error(e.response?.data?.detail || 'Création du système impossible')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <component
    :is="embedded ? 'div' : BaseModal"
    v-bind="embedded ? {} : { title: `Ajouter un système — ${systemLabel}${zoneName ? ' / ' + zoneName : ''}`, size: 'xl', dismissOnBackdrop: false }"
    @close="emit('close')"
  >
    <form @submit.prevent="submit(false)" class="space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Nom du système</label>
          <input v-model="form.name" type="text" autofocus ref="nameInput"
                 placeholder="ex : Chaudière gaz principale, Groupe DRV…"
                 class="w-full px-3 py-2 min-h-11 sm:min-h-0 border border-gray-200 rounded-lg text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Localisation</label>
          <input v-model="form.location" type="text"
                 placeholder="ex : Local technique sous-sol, Toiture…"
                 class="w-full px-3 py-2 min-h-11 sm:min-h-0 border border-gray-200 rounded-lg text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Marque</label>
          <input v-model="form.brand" type="text" placeholder="ex : Atlantic, Daikin, Aldes…"
                 class="w-full px-3 py-2 min-h-11 sm:min-h-0 border border-gray-200 rounded-lg text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Référence / modèle</label>
          <input v-model="form.model_reference" type="text" placeholder="ex : Varmax 70, VRV-IV 75…"
                 class="w-full px-3 py-2 min-h-11 sm:min-h-0 border border-gray-200 rounded-lg text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
        </div>
        <div v-if="roleApplies" :class="{ 'sm:col-span-2': true }">
          <label class="block text-xs font-medium text-gray-700 mb-1">Fonction(s) de l'équipement <span class="text-red-500">*</span></label>
          <SearchableSelect
            v-model="form.device_role"
            :options="roleOptions"
            :multiple="true"
            :clearable="true"
            :creatable="true"
            placeholder="Production / Distribution / Émission / Régulation"
          />
          <p class="text-xs text-gray-500 mt-1 leading-snug">
            <strong>Production</strong> = transforme une énergie primaire (gaz, élec, soleil) en chaleur, froid ou lumière sur place. <strong>Émission seule</strong> = reçoit un fluide d'un autre équipement (radiateur à eau, ventilo-convecteur…).
          </p>
        </div>
        <div v-if="energyRequired">
          <label class="block text-xs font-medium text-gray-700 mb-1">Énergie primaire <span class="text-red-500">*</span></label>
          <SearchableSelect
            v-model="form.energy_source"
            :options="energyOptions"
            placeholder="Sélectionner une énergie"
          />
        </div>
        <div v-if="showPower">
          <label class="block text-xs font-medium text-gray-700 mb-1">Puissance (kW)</label>
          <input v-model.number="form.power_kw" type="number" inputmode="decimal" pattern="[0-9.,]*" min="0" step="0.1"
                 placeholder="—"
                 class="w-full px-3 py-2 min-h-11 sm:min-h-0 border border-gray-200 rounded-lg text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Protocole(s) de communication <span class="text-red-500">*</span></label>
          <ProtocolMultiPicker
            v-model="form.communication_protocols"
            :options="commOptions"
            placeholder="Sélectionner un ou plusieurs protocoles"
          />
        </div>
        <div class="sm:col-span-2">
          <label class="block text-xs font-medium text-gray-700 mb-1">Notes <span class="text-gray-400 font-normal">(optionnel)</span></label>
          <textarea v-model="form.notes" rows="2" placeholder="Observations terrain (état, mise en service, particularités…)"
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"></textarea>
        </div>
      </div>
      <p v-if="!canSubmit() && !submitting" class="text-xs text-amber-600">
        Renseignez {{ missingFields().join(', ') }} pour pouvoir ajouter le système.
      </p>
      <div class="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-2">
        <button type="button" @click="emit('close')"
                class="px-4 py-2 min-h-11 sm:min-h-0 text-sm text-gray-700 hover:bg-gray-100 rounded-lg whitespace-nowrap">
          Annuler
        </button>
        <button type="button" @click="submit(true)" :disabled="!canSubmit() || submitting"
                class="px-4 py-2 min-h-11 sm:min-h-0 text-sm font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 rounded-lg border border-emerald-200 whitespace-nowrap">
          Enregistrer et ajouter un autre
        </button>
        <button type="submit" :disabled="!canSubmit() || submitting"
                class="px-4 py-2 min-h-11 sm:min-h-0 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg shadow-sm whitespace-nowrap">
          {{ submitting ? 'Création…' : 'Ajouter le système' }}
        </button>
      </div>
    </form>
  </component>
</template>
