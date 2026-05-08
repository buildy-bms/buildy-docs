<script setup>
/**
 * Modale d'édition des paramètres d'un audit BACS / GTB classique :
 * Site rattaché, Client, Nom du projet, Type d'audit (kind).
 *
 * Pendant audit du composant CycleBandeau « Éditer les informations de l'AF »
 * mais simplifié (pas de service_level — l'audit ne porte pas de niveau d'offre).
 *
 * Props :
 *   audit : { id, client_name, project_name, site_id, kind }
 *
 * Émet :
 *   close → fermer sans rien faire
 *   saved (audit) → fermer et rafraîchir le parent (kind a pu changer → redirect)
 */
import { ref, watch, computed } from 'vue'
import BaseModal from './BaseModal.vue'
import SitePicker from './SitePicker.vue'
import { FireIcon, BuildingOffice2Icon } from '@heroicons/vue/24/outline'
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
  kind: 'bacs_audit',
})
const submitting = ref(false)

watch(() => props.audit, (a) => {
  if (!a) return
  form.value = {
    client_name: a.client_name || '',
    project_name: a.project_name || '',
    site_id: a.site_id || null,
    kind: a.kind || 'bacs_audit',
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
      kind: form.value.kind,
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

      <!-- ── Type d'audit ──────────────────────────────────────────── -->
      <section class="space-y-3">
        <h3 class="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Type d'audit</h3>
        <div class="grid grid-cols-2 gap-2">
          <label
            :class="[
              'cursor-pointer rounded-lg border-2 px-4 py-3 transition-all flex items-center gap-3',
              form.kind === 'bacs_audit'
                ? 'border-orange-600 bg-orange-50 text-orange-900 shadow-sm'
                : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
            ]"
          >
            <input v-model="form.kind" value="bacs_audit" type="radio" class="sr-only" />
            <FireIcon class="w-6 h-6 shrink-0" />
            <div class="min-w-0">
              <p class="text-sm font-semibold">BACS R175</p>
              <p class="text-[11px] text-gray-500 leading-tight">Audit décret BACS</p>
            </div>
          </label>
          <label
            :class="[
              'cursor-pointer rounded-lg border-2 px-4 py-3 transition-all flex items-center gap-3',
              form.kind === 'site_audit'
                ? 'border-emerald-600 bg-emerald-50 text-emerald-900 shadow-sm'
                : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
            ]"
          >
            <input v-model="form.kind" value="site_audit" type="radio" class="sr-only" />
            <BuildingOffice2Icon class="w-6 h-6 shrink-0" />
            <div class="min-w-0">
              <p class="text-sm font-semibold">GTB classique</p>
              <p class="text-[11px] text-gray-500 leading-tight">Devis hors décret</p>
            </div>
          </label>
        </div>
        <p class="text-[11px] text-gray-500 leading-relaxed">
          Bascule sans perte de données. Les zones, compteurs, systèmes et photos sont conservés ;
          seuls les blocs spécifiques R175 changent d'affichage et d'export.
        </p>
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
