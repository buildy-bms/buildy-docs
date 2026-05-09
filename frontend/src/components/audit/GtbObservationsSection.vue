<script setup>
/**
 * Section « Constats GTB & opportunités Buildy » — mig 108.
 *
 * Pour chaque sujet GTB (mesurage, historisation, régulation,
 * programmation, alarmes, supervision, accès distant, interopérabilité),
 * l'auditeur saisit deux narratifs libres :
 *  - observation : ce qu'il constate sur place (état actuel, défauts,
 *    contournements, écarts). Indépendant de la conformité R175.
 *  - opportunité : ce que Buildy peut apporter ici (Hyperveez, Connect,
 *    Gojee, intégration progressive).
 *
 * Visibles dans le PDF rapport entre la conformité R175 et le plan
 * d'action — même quand l'alinéa R175 correspondant est marqué « non
 * concerné ». But métier : tout doit pouvoir être noté et permettre de
 * justifier de l'état actuel ; tout est prétexte pour Buildy à proposer
 * des améliorations.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { ChatBubbleLeftRightIcon, SparklesIcon, CheckCircleIcon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import RichTextEditor from '@/components/RichTextEditor.vue'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import {
  getBacsGtbObservations, updateBacsGtbObservation, suggestBacsGtbObservation,
} from '@/api'

defineProps({
  active: { type: Boolean, default: false },
})

const audit = useAuditStore()
const { error, success } = useNotification()

const items = ref([])
const loading = ref(true)
const suggestingKey = ref(null)
const saveTimers = new Map()

async function load() {
  loading.value = true
  try {
    const r = await getBacsGtbObservations(audit.docId)
    items.value = r.data
  } catch (e) {
    error(e.response?.data?.detail || 'Chargement des constats GTB impossible')
  } finally {
    loading.value = false
  }
}

watch(() => audit.docId, (id) => { if (id) load() })
onMounted(() => { if (audit.docId) load() })

function patchLocal(key, patch) {
  const it = items.value.find(i => i.topic_key === key)
  if (!it) return
  Object.assign(it, patch)
}

function saveDebounced(key, patch) {
  patchLocal(key, patch)
  clearTimeout(saveTimers.get(key))
  saveTimers.set(key, setTimeout(async () => {
    try {
      await updateBacsGtbObservation(audit.docId, key, patch)
    } catch (e) {
      error(e.response?.data?.detail || 'Sauvegarde impossible')
    }
  }, 500))
}

async function suggest(key) {
  if (suggestingKey.value) return
  suggestingKey.value = key
  try {
    const r = await suggestBacsGtbObservation(audit.docId, key)
    patchLocal(key, {
      observation_html: r.data.observation_html || '',
      opportunity_html: r.data.opportunity_html || '',
    })
    await updateBacsGtbObservation(audit.docId, key, {
      observation_html: r.data.observation_html || '',
      opportunity_html: r.data.opportunity_html || '',
    })
    success('Suggestion Claude appliquée — relis et ajuste si besoin.')
  } catch (e) {
    error(e.response?.data?.detail || 'Suggestion Claude échouée')
  } finally {
    suggestingKey.value = null
  }
}

const filledCount = computed(() => items.value.filter(i =>
  (i.observation_html?.replace(/<[^>]*>/g, '').trim().length || 0) > 0 ||
  (i.opportunity_html?.replace(/<[^>]*>/g, '').trim().length || 0) > 0,
).length)
</script>

<template>
  <CollapsibleSection storage-key="gtb-observations" section-id="section-gtb-observations" :active="active">
    <template #header>
      <SectionHeader number="11"
                     :title="'Constats GTB & opportunités Buildy'"
                     subtitle="Tout ce qu'on observe sur la GTB existante (au-delà du décret) — autant de pistes d'amélioration."
                     :icon="ChatBubbleLeftRightIcon" icon-color="text-violet-500" />
    </template>
    <template #summary>
      <span v-if="loading" class="italic">Chargement…</span>
      <span v-else-if="filledCount">{{ filledCount }} sujet{{ filledCount > 1 ? 's renseignés' : ' renseigné' }} sur {{ items.length }}</span>
      <span v-else class="italic">Aucun constat saisi</span>
    </template>
    <div class="px-5 py-4 space-y-4">
      <p class="text-xs text-gray-500 leading-relaxed">
        Pour chaque sujet GTB, décris ce que tu observes sur site (état, défauts, contournements) et l'opportunité Buildy associée.
        <strong class="text-gray-700">Tout est intégré au PDF rapport</strong>, même les sujets non couverts par le décret BACS.
        Le bouton <em>Suggérer avec Claude</em> pré-remplit à partir des données de l'audit ; à toi de valider et préciser.
      </p>
      <div v-if="loading" class="text-sm text-gray-400 text-center py-6">Chargement…</div>
      <div v-else class="space-y-3">
        <div v-for="it in items" :key="it.topic_key"
             class="border border-gray-200 rounded-xl bg-white">
          <div class="px-4 py-3 flex items-center justify-between gap-3 border-b border-gray-100">
            <div class="min-w-0 flex-1">
              <div class="text-sm font-semibold text-gray-800">{{ it.label }}</div>
              <div v-if="it.description" class="text-[11px] text-gray-500 mt-0.5">{{ it.description }}</div>
            </div>
            <button
              type="button"
              @click="suggest(it.topic_key)"
              :disabled="suggestingKey !== null"
              class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-violet-700 bg-violet-50 border border-violet-200 hover:bg-violet-100 rounded-md whitespace-nowrap disabled:opacity-50"
              v-tooltip="`Pré-remplit observation + opportunité depuis le contexte de l'audit`"
            >
              <SparklesIcon :class="['w-3.5 h-3.5', suggestingKey === it.topic_key ? 'animate-pulse' : '']" />
              {{ suggestingKey === it.topic_key ? 'Génération…' : 'Suggérer' }}
            </button>
          </div>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-0">
            <div class="p-3 lg:border-r border-gray-100 space-y-1.5">
              <label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                Observation
              </label>
              <RichTextEditor
                :model-value="it.observation_html || ''"
                @update:model-value="v => saveDebounced(it.topic_key, { observation_html: v })"
                placeholder="Ce qu'on constate sur site — factuel, neutre."
                min-height="120px"
              />
            </div>
            <div class="p-3 space-y-1.5">
              <label class="block text-[11px] font-semibold text-violet-700 uppercase tracking-wider">
                Opportunité Buildy
              </label>
              <RichTextEditor
                :model-value="it.opportunity_html || ''"
                @update:model-value="v => saveDebounced(it.topic_key, { opportunity_html: v })"
                placeholder="Ce que Buildy peut apporter ici (Hyperveez, Connect, intégration progressive…)."
                min-height="120px"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </CollapsibleSection>
</template>
