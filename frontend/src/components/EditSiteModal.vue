<script setup>
/**
 * Modale d'édition du site rattaché à l'audit : nom, client, adresse
 * (avec autocomplétion + capture des coordonnées GPS), notes.
 *
 * La table `sites` est la source de vérité de l'adresse — la synchro
 * bidirectionnelle avec Fleet Manager propage automatiquement.
 */
import { ref, computed, onMounted } from 'vue'
import BaseModal from './BaseModal.vue'
import AddressAutocomplete from './AddressAutocomplete.vue'
import ZoneMapPicker from './ZoneMapPicker.vue'
import { loadGoogleMaps } from '@/lib/google-maps'
import { updateSite } from '@/api'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  site: { type: Object, required: true },
})
const emit = defineEmits(['close', 'saved'])
const audit = useAuditStore()
const { success, error: notifyError } = useNotification()

const form = ref({
  name: props.site.name || '',
  customer_name: props.site.customer_name || '',
  address: props.site.address || '',
  notes: props.site.notes || '',
  latitude: props.site.latitude ?? null,
  longitude: props.site.longitude ?? null,
  map_zoom: props.site.map_zoom ?? null,
})
const submitting = ref(false)
const canSubmit = computed(() => !!form.value.name.trim() && !submitting.value)

const inputCls = 'w-full px-3 py-2 min-h-11 sm:min-h-0 border border-gray-200 rounded-lg text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition'

// Capture les coordonnées GPS renvoyées par l'autocomplétion d'adresse (BAN).
function onAddressSelected(s) {
  form.value.latitude = s?.lat ?? null
  form.value.longitude = s?.lng ?? null
}

// Le site a une adresse mais pas encore de coordonnées : on géocode
// l'adresse au chargement pour pré-placer le pin sur la carte. L'auditeur
// peut ensuite le déplacer si la position issue de l'adresse est imprécise.
onMounted(async () => {
  if (form.value.latitude != null || !form.value.address) return
  try {
    const google = await loadGoogleMaps()
    const { results } = await new google.maps.Geocoder()
      .geocode({ address: form.value.address, region: 'FR' })
    const loc = results?.[0]?.geometry?.location
    if (loc && form.value.latitude == null) {
      form.value.latitude = loc.lat()
      form.value.longitude = loc.lng()
    }
  } catch { /* repli silencieux : le pin reste à poser manuellement */ }
})

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    const uuid = props.site.site_uuid || props.site.uuid
    const { data } = await updateSite(uuid, {
      name: form.value.name.trim(),
      customer_name: form.value.customer_name.trim() || null,
      address: form.value.address.trim() || null,
      notes: form.value.notes.trim() || null,
      latitude: form.value.latitude,
      longitude: form.value.longitude,
      map_zoom: form.value.map_zoom,
    })
    // Garde le store de l'audit synchronisé (source de vérité de l'adresse).
    if (audit.site && (audit.site.site_uuid === uuid || audit.site.uuid === uuid)) {
      audit.site = data
    }
    success('Site mis à jour')
    emit('saved', data)
    emit('close')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Sauvegarde du site impossible')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <BaseModal title="Modifier le site" size="lg" @close="emit('close')">
    <form @submit.prevent="submit" class="space-y-4">
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1.5">
          Nom du site <span class="text-red-500">*</span>
        </label>
        <input v-model="form.name" type="text" required autofocus
               placeholder="ex : Plateforme logistique Lyon Sud" :class="inputCls" />
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1.5">Client</label>
        <input v-model="form.customer_name" type="text"
               autocomplete="off" data-1p-ignore="true" data-lpignore="true"
               placeholder="ex : Acme SAS" :class="inputCls" />
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1.5">Adresse</label>
        <AddressAutocomplete
          v-model="form.address"
          placeholder="Rechercher une adresse française…"
          @selected="onAddressSelected"
        />
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1.5">
          Position du site sur la carte
          <span class="text-gray-400 font-normal">— déplacez le pin si la position issue de l'adresse est imprécise</span>
        </label>
        <ZoneMapPicker
          v-model:latitude="form.latitude"
          v-model:longitude="form.longitude"
          v-model:zoom="form.map_zoom"
          kind="site"
          point-label="le site"
          :zones="audit.zones || []"
          :site="{ address: form.address }"
          :allow-site-edit="false"
        />
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1.5">Notes</label>
        <textarea v-model="form.notes" rows="3"
                  placeholder="Informations utiles sur le site (accès, contact…)"
                  class="w-full px-3 py-2 border border-gray-200 rounded-lg text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"></textarea>
      </div>
    </form>

    <template #footer>
      <button type="button" @click="emit('close')"
              class="px-4 py-2 text-sm rounded-lg text-gray-700 hover:bg-gray-100 transition-colors">
        Annuler
      </button>
      <button type="button" @click="submit" :disabled="!canSubmit"
              class="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors">
        {{ submitting ? 'Enregistrement…' : 'Enregistrer' }}
      </button>
    </template>
  </BaseModal>
</template>
