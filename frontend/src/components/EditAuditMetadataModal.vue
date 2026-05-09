<script setup>
/**
 * Modale d'édition des paramètres d'un audit BACS :
 * Site rattaché, Client, Nom du projet.
 *
 * Pendant audit du composant CycleBandeau « Éditer les informations de l'AF »
 * mais simplifié (pas de service_level — l'audit ne porte pas de niveau d'offre).
 *
 * Le sélecteur de kind a été retiré (mig 106) : tout audit est désormais
 * un BACS R175.
 *
 * Props :
 *   audit : { id, client_name, project_name, site_id }
 *
 * Émet :
 *   close → fermer sans rien faire
 *   saved (audit) → fermer et rafraîchir le parent
 */
import { ref, watch, computed } from 'vue'
import BaseModal from './BaseModal.vue'
import SitePicker from './SitePicker.vue'
import { updateAf } from '@/api'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  audit: { type: Object, required: true },
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
  // Hydrate le client par défaut si vide (pattern AF).
  if (!site) return
  if (site.customer_name && !form.value.client_name) form.value.client_name = site.customer_name
}

async function submit() {
  if (!canSubmit.value) return
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
  <BaseModal title="Modifier les paramètres de l'audit" size="lg" @close="emit('close')">
    <form @submit.prevent="submit" class="space-y-5">
      <!-- ── Identité du chantier ───────────────────────────────────── -->
      <section class="space-y-3">
        <h3 class="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Identité du chantier</h3>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1.5">
            Site rattaché
            <span class="text-gray-400 font-normal">— optionnel, partage adresse / zones / équipements avec les autres documents du site</span>
          </label>
          <SitePicker v-model="form.site_id" @change="onSiteChange" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1.5">Client <span class="text-red-500">*</span></label>
            <input
              v-model="form.client_name"
              type="text"
              required
              autocomplete="off"
              data-1p-ignore="true"
              data-bwignore="true"
              data-lpignore="true"
              placeholder="Ex : Acme SAS"
              class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1.5">Nom du projet <span class="text-red-500">*</span></label>
            <input
              v-model="form.project_name"
              type="text"
              required
              autocomplete="off"
              data-1p-ignore="true"
              data-bwignore="true"
              data-lpignore="true"
              placeholder="Ex : Plateforme logistique Lyon"
              class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all"
            />
          </div>
        </div>
      </section>

    </form>

    <template #footer>
      <button
        type="button"
        @click="emit('close')"
        class="px-4 py-2 text-sm rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
      >
        Annuler
      </button>
      <button
        type="button"
        @click="submit"
        :disabled="!canSubmit"
        class="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {{ submitting ? 'Enregistrement…' : 'Enregistrer' }}
      </button>
    </template>
  </BaseModal>
</template>
