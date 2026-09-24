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
import { useConfirm } from '@/composables/useConfirm'
import { generateBacsAuditSynthesis, updateBacsAuditSynthesis, updateAf } from '@/api'
import { isSynthesisStale } from '@/lib/synthesis-staleness'
import MobileSheet from './MobileSheet.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
})
defineEmits(['close'])

const audit = useAuditStore()
const { document, synthesisHtml, actionItems } = storeToRefs(audit)
const { error, success } = useNotification()
const { confirm } = useConfirm()

const generating = ref(false)
const localHtml = ref('')

watch(() => props.open, (v) => {
  if (v) localHtml.value = synthesisHtml.value || ''
})

const generatedAt = computed(() => document.value?.audit_synthesis_generated_at || null)

// Note périmée (même règle que le serveur) : pas imprimée dans le rapport.
const isStale = computed(() => isSynthesisStale({
  html: synthesisHtml.value, generatedAt: generatedAt.value, actionItems: actionItems.value,
}))
// Note relue par l'auditeur : datée du jour, elle est de nouveau imprimée.
const confirming = ref(false)
async function confirmCurrent() {
  if (confirming.value || !document.value) return
  confirming.value = true
  const now = new Date().toISOString()
  try {
    await updateAf(audit.docId, { audit_synthesis_generated_at: now })
    document.value.audit_synthesis_generated_at = now
    success('Note de synthèse confirmée : elle sera imprimée dans le rapport')
  } catch (e) {
    error(e.response?.data?.detail || 'Confirmation impossible')
  } finally {
    confirming.value = false
  }
}

async function generate() {
  if (generating.value) return
  if (synthesisHtml.value) {
    const ok = await confirm({
      title: 'Régénérer la note de synthèse ?',
      message: 'Le texte actuel sera remplacé par une nouvelle note rédigée par Claude.',
      confirmLabel: 'Régénérer',
    })
    if (!ok) return
  }
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
      success('Note de synthèse générée')
    }
  } catch (e) {
    error(e.response?.data?.detail || 'Échec de la génération par Claude')
  } finally {
    generating.value = false
  }
}

async function clearSynthesis() {
  const ok = await confirm({
    title: 'Supprimer la note de synthèse ?',
    message: 'La note ne figurera plus en tête du rapport.',
    confirmLabel: 'Supprimer',
    danger: true,
  })
  if (!ok) return
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
        class="pwa-button pwa-button--primary w-full bg-violet-600 border-violet-600 active:bg-violet-700 disabled:opacity-50"
      >
        <FontAwesomeIcon :icon="['fas', 'sparkles']" :class="['w-5 h-5', generating ? 'animate-pulse' : '']" />
        {{ generating
            ? 'Génération en cours…'
            : (synthesisHtml ? 'Régénérer avec Claude' : 'Rédiger avec Claude') }}
      </button>

      <div v-if="generatedAt" class="text-xs text-gray-500 text-center">
        Note datée du
        {{ new Date(generatedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) }}
      </div>

      <!-- Note périmée : non imprimée tant qu'elle n'est pas régénérée ou
           confirmée (même bandeau que l'étape Synthèse desktop). -->
      <div v-if="isStale" class="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 space-y-2">
        <p class="text-sm font-medium text-amber-900 leading-snug">
          Le plan d'actions a changé depuis cette note : elle ne sera pas imprimée dans le rapport.
        </p>
        <p class="text-xs text-amber-800 leading-relaxed">
          Une note périmée contredirait le tableau de bord et le plan. Régénère-la avec Claude, ou relis-la puis confirme qu'elle est à jour.
        </p>
        <button type="button" @click="confirmCurrent" :disabled="confirming"
                class="pwa-button w-full border border-amber-300 bg-white text-amber-900 active:bg-amber-100 disabled:opacity-50">
          {{ confirming ? 'Enregistrement…' : 'Note relue et à jour' }}
        </button>
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
