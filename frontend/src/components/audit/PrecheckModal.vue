<script setup>
/**
 * Modale de pré-vérification de cohérence avant livraison d'un audit BACS
 * (Lot 4 du plan « Qualité du livrable PDF »).
 *
 * Appelle `GET /api/bacs-audit/:id/precheck` et affiche les blockings + warnings
 * groupés par entité. Permet à l'auditeur de localiser et corriger les
 * incohérences avant de cliquer « Livrer ».
 *
 * Le backend `audit_deliver` refuse maintenant la livraison si `blocking.length > 0`
 * (cf. lifecycle.js). L'auditeur peut forcer via `?force=1` pour les cas
 * exceptionnels (tracé dans audit_log).
 */
import { ref, onMounted, computed } from 'vue'
import BaseModal from '../BaseModal.vue'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  auditId: { type: Number, required: true },
})
const emit = defineEmits(['close'])
const { error: notifyError } = useNotification()

const loading = ref(true)
const data = ref(null)

async function load() {
  loading.value = true
  try {
    const res = await fetch(`/api/bacs-audit/${props.auditId}/precheck`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    data.value = await res.json()
  } catch (e) {
    notifyError(`Pré-check échoué : ${e.message}`)
    data.value = { blocking: [], warnings: [], summary: { blocking_count: 0, warnings_count: 0 } }
  } finally {
    loading.value = false
  }
}

onMounted(load)

const groupedBlocking = computed(() => groupByEntity(data.value?.blocking || []))
const groupedWarnings = computed(() => groupByEntity(data.value?.warnings || []))

function groupByEntity(arr) {
  const map = new Map()
  for (const f of arr) {
    const key = f.entity || 'autre'
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(f)
  }
  return [...map.entries()].map(([entity, findings]) => ({ entity, findings }))
}

const ENTITY_LABEL = {
  document: 'Identification',
  system:   'Systèmes',
  device:   'Équipements',
  meter:    'Compteurs',
  thermal:  'Régulation thermique',
  bms:      'GTB',
  zone:     'Zones',
}
function entityLabel(e) { return ENTITY_LABEL[e] || e }
</script>

<template>
  <BaseModal title="Vérification avant livraison" size="xl" @close="emit('close')">
    <div v-if="loading" class="p-8 text-center text-gray-500">
      <div class="animate-pulse">Analyse de l'audit en cours…</div>
    </div>
    <div v-else class="space-y-4">
      <!-- Bandeau verdict global -->
      <div v-if="data.can_deliver"
           class="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-start gap-3">
        <span class="text-2xl">✓</span>
        <div>
          <div class="font-semibold">Aucune incohérence bloquante détectée</div>
          <div class="text-sm text-emerald-700 mt-1">
            L'audit peut être livré. {{ data.summary.warnings_count }} point(s) d'attention à parcourir si possible.
          </div>
        </div>
      </div>
      <div v-else
           class="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 flex items-start gap-3">
        <span class="text-2xl">⚠</span>
        <div>
          <div class="font-semibold">{{ data.summary.blocking_count }} incohérence(s) bloquante(s) — livraison refusée</div>
          <div class="text-sm text-rose-700 mt-1">
            Corrigez les points ci-dessous avant de cliquer « Livrer ». Le backend refusera l'envoi tant qu'il
            reste un bloquant non résolu (les cas exceptionnels nécessitent un appel API avec <code>?force=1</code>).
          </div>
        </div>
      </div>

      <!-- Blockings -->
      <section v-if="data.blocking?.length" class="space-y-3">
        <h3 class="text-sm font-semibold text-rose-700 uppercase tracking-wider">Incohérences bloquantes</h3>
        <div v-for="g in groupedBlocking" :key="'b-' + g.entity" class="border border-rose-200 rounded-lg overflow-hidden">
          <div class="bg-rose-50 px-3 py-2 text-sm font-medium text-rose-900">{{ entityLabel(g.entity) }} · {{ g.findings.length }} point{{ g.findings.length > 1 ? 's' : '' }}</div>
          <ul class="divide-y divide-rose-100">
            <li v-for="f in g.findings" :key="f.code + '-' + f.entity_id" class="px-3 py-2.5 text-sm">
              <div class="font-medium text-gray-900">{{ f.message }}</div>
              <div v-if="f.hint" class="text-xs text-gray-600 mt-1">{{ f.hint }}</div>
              <div v-if="f.fix_hint" class="text-xs text-rose-700 mt-1">→ {{ f.fix_hint }}</div>
              <div class="text-[10px] text-gray-400 uppercase tracking-wider mt-1">{{ f.code }}</div>
            </li>
          </ul>
        </div>
      </section>

      <!-- Warnings -->
      <section v-if="data.warnings?.length" class="space-y-3">
        <h3 class="text-sm font-semibold text-amber-700 uppercase tracking-wider">Points d'attention</h3>
        <div v-for="g in groupedWarnings" :key="'w-' + g.entity" class="border border-amber-200 rounded-lg overflow-hidden">
          <div class="bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">{{ entityLabel(g.entity) }} · {{ g.findings.length }} point{{ g.findings.length > 1 ? 's' : '' }}</div>
          <ul class="divide-y divide-amber-100">
            <li v-for="f in g.findings" :key="f.code + '-' + f.entity_id" class="px-3 py-2.5 text-sm">
              <div class="font-medium text-gray-900">{{ f.message }}</div>
              <div v-if="f.hint" class="text-xs text-gray-600 mt-1">{{ f.hint }}</div>
              <div v-if="f.fix_hint" class="text-xs text-amber-700 mt-1">→ {{ f.fix_hint }}</div>
              <div class="text-[10px] text-gray-400 uppercase tracking-wider mt-1">{{ f.code }}</div>
            </li>
          </ul>
        </div>
      </section>

      <!-- Tout va bien -->
      <div v-if="!data.blocking?.length && !data.warnings?.length"
           class="p-6 text-center text-emerald-700 bg-emerald-50 rounded-lg border border-emerald-200">
        <div class="text-3xl mb-2">🎯</div>
        <div class="font-semibold">Audit parfaitement cohérent</div>
        <div class="text-sm mt-1">Aucune contradiction détectée — prêt à livrer.</div>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-between items-center w-full">
        <button type="button" @click="load"
                class="h-9 px-3 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
          ↻ Re-vérifier
        </button>
        <button type="button" @click="emit('close')"
                class="h-9 px-4 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition">
          Fermer
        </button>
      </div>
    </template>
  </BaseModal>
</template>
