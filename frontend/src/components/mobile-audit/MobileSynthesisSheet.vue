<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
/**
 * Synthese Claude — sheet mobile (PR-V Vague 3 item 12).
 * Permet a l'auditeur de declencher la generation Claude depuis le terrain
 * + relire / editer la synthese. Editeur richtext desactive en mobile pour
 * eviter le clavier qui pousse le contenu : on garde une zone simple de
 * texte non-editable + un bouton "Re-generer". L'edition fine se fait au
 * bureau.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { generateBacsAuditSynthesis, updateBacsAuditSynthesis } from '@/api'
import MobileSheet from './MobileSheet.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
})
defineEmits(['close'])

const audit = useAuditStore()
const { document, synthesisHtml } = storeToRefs(audit)
const { error, success } = useNotification()

const generating = ref(false)
const localHtml = ref('')

watch(() => props.open, (v) => {
  if (v) localHtml.value = synthesisHtml.value || ''
})

const generatedAt = computed(() => document.value?.audit_synthesis_generated_at || null)

async function generate() {
  if (generating.value) return
  if (synthesisHtml.value && !window.confirm('Une synthese existe deja. Re-generer va ecraser le texte actuel — continuer ?')) return
  generating.value = true
  try {
    const { data } = await generateBacsAuditSynthesis(audit.docId)
    if (data?.html) {
      audit.setSynthesisHtml(data.html)
      localHtml.value = data.html
      if (document.value) {
        document.value.audit_synthesis_html = data.html
        document.value.audit_synthesis_generated_at = data.generated_at
      }
      success('Synthese generee')
    }
  } catch (e) {
    error(e.response?.data?.detail || 'Echec generation Claude')
  } finally {
    generating.value = false
  }
}

async function clearSynthesis() {
  if (!window.confirm('Supprimer la synthese ?')) return
  try {
    await updateBacsAuditSynthesis(audit.docId, null)
    audit.setSynthesisHtml('')
    localHtml.value = ''
    if (document.value) document.value.audit_synthesis_html = ''
  } catch (e) {
    error(e.response?.data?.detail || 'Suppression impossible')
  }
}
</script>

<template>
  <MobileSheet :open="open" title="Synthèse Claude" hide-save @close="$emit('close')">
    <div class="p-4 space-y-4">
      <div class="bg-violet-50 border border-violet-200 rounded-xl p-4 flex items-start gap-3">
        <FontAwesomeIcon :icon="['fas', 'sparkles']" class="w-5 h-5 text-violet-600 shrink-0 mt-0.5" />
        <div class="flex-1 text-sm text-violet-900">
          <p class="font-medium">Note de synthèse client</p>
          <p class="text-xs text-violet-700 mt-1 leading-relaxed">
            Claude lit l'audit complet (zones, systèmes, compteurs, GTB, plan) et rédige une note client. La génération prend ~30 secondes. L'édition fine se fait au bureau.
          </p>
        </div>
      </div>

      <button
        @click="generate"
        :disabled="generating"
        class="w-full inline-flex items-center justify-center gap-2 px-4 py-4 text-base font-medium text-white bg-violet-600 active:bg-violet-700 rounded-xl disabled:opacity-50"
      >
        <FontAwesomeIcon :icon="['fas', 'sparkles']" :class="['w-5 h-5', generating ? 'animate-pulse' : '']" />
        {{ generating
            ? 'Génération en cours…'
            : (synthesisHtml ? 'Régénérer avec Claude' : 'Rédiger avec Claude') }}
      </button>

      <div v-if="generatedAt" class="text-xs text-gray-500 text-center">
        Dernière génération :
        {{ new Date(generatedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) }}
      </div>

      <div v-if="synthesisHtml" class="space-y-2">
        <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">Aperçu</p>
        <div
          class="bg-white border border-gray-200 rounded-xl p-4 text-sm leading-relaxed prose prose-sm max-w-none"
          v-html="synthesisHtml"
        ></div>
        <button
          @click="clearSynthesis"
          class="w-full text-center text-xs text-red-600 active:text-red-800 py-2"
        >
          Supprimer la synthèse
        </button>
      </div>
      <div v-else class="text-sm text-gray-500 italic text-center py-8">
        Pas encore de synthèse — clique sur le bouton violet pour la générer.
      </div>
    </div>
  </MobileSheet>
</template>
