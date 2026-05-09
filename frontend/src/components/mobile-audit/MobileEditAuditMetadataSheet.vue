<script setup>
/**
 * Variante PWA mobile de EditAuditMetadataModal — utilise MobileSheet
 * (slide-up plein écran iOS-natif) au lieu de BaseModal centrée. Vague 3
 * item 10 de l'audit BACS.
 *
 * La modale desktop dépassait mal en portrait iOS (centered, backdrop)
 * et rompait avec le reste de l'app PWA (sheets partout).
 *
 * Champs : Site rattaché + Client + Nom du projet. Pas de service_level
 * (l'audit ne porte pas de niveau d'offre) ni de kind switch (mig 106 :
 * tout audit est BACS désormais).
 *
 * Props :  audit : { id, client_name, project_name, site_id }
 * Émet  :  close → fermer | saved (audit) → fermer + rafraîchir parent
 */
import { ref, watch, computed } from 'vue'
import MobileSheet from './MobileSheet.vue'
import MobileField from './MobileField.vue'
import SitePicker from '@/components/SitePicker.vue'
import { updateAf } from '@/api'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  open: { type: Boolean, default: false },
  audit: { type: Object, default: null },
})
const emit = defineEmits(['close', 'saved'])
const { success, error: notifyError } = useNotification()

const form = ref({
  client_name: '',
  project_name: '',
  site_id: null,
})
const submitting = ref(false)

watch(() => props.audit, (a) => {
  if (!a) return
  form.value = {
    client_name: a.client_name || '',
    project_name: a.project_name || '',
    site_id: a.site_id || null,
  }
}, { immediate: true })

const canSubmit = computed(() =>
  !!form.value.client_name.trim() && !!form.value.project_name.trim() && !submitting.value,
)

function onSiteChange(site) {
  if (!site) return
  if (site.customer_name && !form.value.client_name) form.value.client_name = site.customer_name
}

async function submit() {
  if (!canSubmit.value || !props.audit?.id) return
  submitting.value = true
  try {
    const { data } = await updateAf(props.audit.id, {
      client_name: form.value.client_name.trim(),
      project_name: form.value.project_name.trim(),
      site_id: form.value.site_id,
    })
    success('Paramètres mis à jour')
    emit('saved', data)
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Sauvegarde impossible')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <MobileSheet
    :open="open"
    title="Paramètres de l'audit"
    save-label="Enregistrer"
    :saving="submitting"
    @close="emit('close')"
    @save="submit"
  >
    <form @submit.prevent="submit" class="p-4 space-y-4">
      <MobileField
        label="Site rattaché"
        hint="Optionnel — partage adresse / zones / équipements avec les autres documents du site"
      >
        <SitePicker v-model="form.site_id" @change="onSiteChange" />
      </MobileField>

      <MobileField label="Client" required>
        <input
          v-model="form.client_name"
          type="text"
          autocomplete="off"
          autocapitalize="words"
          data-1p-ignore="true"
          placeholder="ex : Atlas Logistics SAS"
          class="w-full min-h-11 px-3 py-3 text-base bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
        />
      </MobileField>

      <MobileField label="Nom du projet" required>
        <input
          v-model="form.project_name"
          type="text"
          autocomplete="off"
          autocapitalize="sentences"
          data-1p-ignore="true"
          placeholder="ex : Mise en conformité BACS Atlas Sud"
          class="w-full min-h-11 px-3 py-3 text-base bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
        />
      </MobileField>
    </form>
  </MobileSheet>
</template>
