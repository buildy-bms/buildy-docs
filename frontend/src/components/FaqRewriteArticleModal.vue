<script setup>
// Modale de réécriture IA de l'article complet, avec champ instructions
// optionnel. Vide = comportement standard (clarté + structure + SEO).
// Renseigné = priorité absolue, en plus des règles standard.
import { ref } from 'vue'
import { XMarkIcon, SparklesIcon } from '@heroicons/vue/24/outline'

const props = defineProps({
  articleTitle: { type: String, default: '' },
  loading: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'submit'])

const instructions = ref('')

function onSubmit() {
  if (props.loading) return
  emit('submit', instructions.value.trim() || null)
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <div class="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
      <div class="flex items-center justify-between px-5 py-4 border-b border-gray-200">
        <div class="min-w-0">
          <h2 class="text-lg font-semibold text-gray-900">Réécrire l'article avec l'IA</h2>
          <p v-if="articleTitle" class="text-xs text-gray-500 mt-0.5 truncate">{{ articleTitle }}</p>
        </div>
        <button type="button" @click="emit('close')" :disabled="loading"
                class="text-gray-400 hover:text-gray-600 disabled:opacity-50">
          <XMarkIcon class="w-5 h-5" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        <label class="block text-sm font-medium text-gray-700">
          Instructions <span class="text-gray-400 font-normal">(optionnel)</span>
        </label>
        <textarea v-model="instructions" rows="8" :disabled="loading"
                  placeholder="Exemples :&#10;– Reformule en mettant l'accent sur les bénéfices pour un asset manager.&#10;– Garde 3 sections H2 maximum.&#10;– Ne mentionne pas de protocoles techniques (Modbus, BACnet…).&#10;– N'invente aucun chiffre ; si une donnée n'est pas dans le contenu actuel, ne l'invente pas.&#10;– Réduis à 600 mots maximum."
                  class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 disabled:opacity-50"></textarea>
        <div class="text-xs text-gray-500 space-y-1">
          <p><strong class="text-gray-700">Vide</strong> → réécriture standard (clarté, structure, SEO, légendes images…).</p>
          <p><strong class="text-gray-700">Avec instructions</strong> → tes consignes deviennent prioritaires, en plus des règles standard.</p>
          <p class="text-amber-700">Astuce anti-hallucination : précise « N'invente aucune donnée qui ne figure pas dans le contenu actuel ».</p>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200 bg-gray-50">
        <button type="button" @click="emit('close')" :disabled="loading"
                class="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg whitespace-nowrap disabled:opacity-50">
          Annuler
        </button>
        <button type="button" @click="onSubmit" :disabled="loading"
                class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 whitespace-nowrap">
          <SparklesIcon class="w-4 h-4 shrink-0" :class="loading ? 'animate-pulse' : ''" />
          {{ loading ? 'Réécriture en cours…' : 'Réécrire' }}
        </button>
      </div>
    </div>
  </div>
</template>
