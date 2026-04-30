<script setup>
/**
 * Modale d'insertion / édition de lien Tiptap. Remplace `window.prompt`
 * pour offrir validation, retrait explicite et raccourci Entrée/Esc.
 *
 * Usage :
 *   <LinkInputModal
 *     v-if="showLinkModal"
 *     :initial-url="currentLinkUrl"
 *     @save="onSaveLink"        // (url: string) => void  — chaîne vide = retirer
 *     @close="showLinkModal = false"
 *   />
 */
import { ref, watch, nextTick, useTemplateRef } from 'vue'
import BaseModal from './BaseModal.vue'

const props = defineProps({
  initialUrl: { type: String, default: '' },
})
const emit = defineEmits(['save', 'close'])

const url = ref(props.initialUrl)
const inputRef = useTemplateRef('inputRef')

watch(() => props.initialUrl, (v) => { url.value = v }, { immediate: true })

// Focus auto à l'ouverture
nextTick(() => inputRef.value?.focus())

// Validation simple : on accepte http(s)://, mailto:, tel:, # ancres, et
// chemins relatifs. Le but n'est pas de bloquer mais de prévenir les
// fautes de frappe évidentes.
const isInvalid = ref(false)
function validate(v) {
  const t = (v || '').trim()
  if (!t) return true // chaîne vide = retirer le lien (valide)
  return /^(https?:\/\/|mailto:|tel:|#|\/)/i.test(t)
}

function onSubmit() {
  const t = url.value.trim()
  if (!validate(t)) { isInvalid.value = true; return }
  emit('save', t)
}

function onRemove() {
  emit('save', '')
}
</script>

<template>
  <BaseModal title="Insérer un lien" size="lg" @close="emit('close')">
    <form @submit.prevent="onSubmit" class="space-y-3 min-w-lg">
      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">URL</label>
        <input
          ref="inputRef"
          v-model="url"
          type="text"
          autocomplete="off"
          placeholder="https://exemple.com — ou laisser vide pour retirer"
          class="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"
          :class="isInvalid && 'border-red-300 focus:ring-red-500/30 focus:border-red-500'"
          @input="isInvalid = false"
        />
        <p v-if="isInvalid" class="mt-1 text-xs text-red-600">
          Format attendu : URL absolue (https://…), mailto:, tel:, ancre (#…) ou chemin (/…).
        </p>
      </div>
    </form>
    <template #footer>
      <button
        v-if="initialUrl"
        type="button"
        @click="onRemove"
        class="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition"
      >
        Retirer le lien
      </button>
      <button
        type="button"
        @click="emit('close')"
        class="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
      >
        Annuler
      </button>
      <button
        type="button"
        @click="onSubmit"
        class="px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition"
      >
        {{ initialUrl ? 'Mettre à jour' : 'Insérer' }}
      </button>
    </template>
  </BaseModal>
</template>
