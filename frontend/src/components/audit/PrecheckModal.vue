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
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { resolveFaIconName } from '@/lib/equipment-icons'

// Lot 9 — décor par catégorie d'usage (chauffage/refroidissement/etc.) +
// décor par type d'entité (système/équipement/compteur/etc.). Aligne la
// modale Précheck sur la charte visuelle Buildy partagée avec DeviceEditModal,
// SystemCategoryIcon, etc.
const SYSTEM_CATEGORY_DECOR = {
  heating:                { icon: 'fa-fire',        color: '#dc2626', label: 'Chauffage' },
  cooling:                { icon: 'fa-snowflake',   color: '#0891b2', label: 'Refroidissement' },
  ventilation:            { icon: 'fa-fan',         color: '#64748b', label: 'Ventilation' },
  dhw:                    { icon: 'fa-faucet',      color: '#0284c7', label: 'ECS' },
  lighting_indoor:        { icon: 'fa-lightbulb',   color: '#f59e0b', label: 'Éclairage intérieur' },
  lighting_outdoor:       { icon: 'fa-tower-cell',  color: '#f59e0b', label: 'Éclairage extérieur' },
  electricity_production: { icon: 'fa-solar-panel', color: '#16a34a', label: 'Production PV' },
}
const ENTITY_DECOR = {
  document: { icon: 'fa-id-card',        color: '#6b7280' },
  system:   { icon: 'fa-layer-group',    color: '#6b7280' },
  device:   { icon: 'fa-cube',           color: '#6b7280' },
  meter:    { icon: 'fa-gauge',          color: '#6b7280' },
  thermal:  { icon: 'fa-sliders',        color: '#a855f7' },
  bms:      { icon: 'fa-microchip',      color: '#0ea5e9' },
  zone:     { icon: 'fa-map-pin',        color: '#6b7280' },
}
function decorFor(f) {
  // Priorité à la catégorie d'usage (chauffage/refroidissement/…) si fournie.
  // Sinon retombe sur l'icône générique du type d'entité.
  if (f.system_category && SYSTEM_CATEGORY_DECOR[f.system_category]) {
    return SYSTEM_CATEGORY_DECOR[f.system_category];
  }
  return ENTITY_DECOR[f.entity] || { icon: 'fa-circle-exclamation', color: '#6b7280' };
}
function faName(icon) { return resolveFaIconName(icon) }

const props = defineProps({
  auditId: { type: Number, required: true },
})
const emit = defineEmits(['close'])
const { error: notifyError } = useNotification()

const loading = ref(true)
const data = ref(null)
const fixing = ref({}) // map de findingKey → bool

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

async function autoFix(finding) {
  const key = `${finding.code}-${finding.entity_id}`
  fixing.value[key] = true
  try {
    const res = await fetch(`/api/bacs-audit/${props.auditId}/precheck/auto-fix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: finding.auto_fix_action, entity_id: finding.entity_id }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `HTTP ${res.status}`)
    }
    const out = await res.json()
    data.value = out.precheck
  } catch (e) {
    notifyError(`Correction automatique échouée : ${e.message}`)
  } finally {
    fixing.value[key] = false
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
          <div class="font-semibold">{{ data.summary.blocking_count }} point(s) bloquant(s) — la livraison est suspendue</div>
          <div class="text-sm text-rose-700 mt-1">
            Corrige les points ci-dessous avant de cliquer « Livrer ». Chaque finding indique comment et où corriger.
            Une fois tout résolu, reviens dans cette modale et clique « Re-vérifier » pour confirmer.
          </div>
        </div>
      </div>

      <!-- Blockings -->
      <section v-if="data.blocking?.length" class="space-y-3">
        <h3 class="text-sm font-semibold text-rose-700 uppercase tracking-wider">Incohérences bloquantes</h3>
        <div v-for="g in groupedBlocking" :key="'b-' + g.entity" class="border border-rose-200 rounded-lg overflow-hidden">
          <div class="bg-rose-50 px-3 py-2 text-sm font-medium text-rose-900">{{ entityLabel(g.entity) }} · {{ g.findings.length }} point{{ g.findings.length > 1 ? 's' : '' }}</div>
          <ul class="divide-y divide-rose-100">
            <li v-for="f in g.findings" :key="f.code + '-' + f.entity_id" class="px-3 py-2.5 text-sm flex items-start gap-3" :title="f.code">
              <FontAwesomeIcon :icon="['fas', faName(decorFor(f).icon)]"
                               :style="{ color: decorFor(f).color }"
                               class="w-4 h-4 shrink-0 mt-0.5" />
              <div class="flex-1 min-w-0">
                <div class="font-medium text-gray-900">{{ f.message }}</div>
                <div v-if="f.hint" class="text-xs text-gray-600 mt-1.5 leading-snug">{{ f.hint }}</div>
                <div v-if="f.fix_hint" class="text-xs text-rose-800 bg-rose-100/60 mt-2 px-2 py-1.5 rounded leading-snug">
                  <strong>Comment corriger :</strong> {{ f.fix_hint }}
                </div>
                <button v-if="f.auto_fix_action" type="button"
                        :disabled="fixing[f.code + '-' + f.entity_id]"
                        @click="autoFix(f)"
                        class="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-lg transition">
                  <span v-if="fixing[f.code + '-' + f.entity_id]">⟳ Correction en cours…</span>
                  <span v-else>✓ {{ f.auto_fix_label || 'Corriger automatiquement' }}</span>
                </button>
              </div>
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
            <li v-for="f in g.findings" :key="f.code + '-' + f.entity_id" class="px-3 py-2.5 text-sm flex items-start gap-3" :title="f.code">
              <FontAwesomeIcon :icon="['fas', faName(decorFor(f).icon)]"
                               :style="{ color: decorFor(f).color }"
                               class="w-4 h-4 shrink-0 mt-0.5" />
              <div class="flex-1 min-w-0">
                <div class="font-medium text-gray-900">{{ f.message }}</div>
                <div v-if="f.hint" class="text-xs text-gray-600 mt-1.5 leading-snug">{{ f.hint }}</div>
                <div v-if="f.fix_hint" class="text-xs text-amber-800 bg-amber-100/60 mt-2 px-2 py-1.5 rounded leading-snug">
                  <strong>Comment corriger :</strong> {{ f.fix_hint }}
                </div>
                <button v-if="f.auto_fix_action" type="button"
                        :disabled="fixing[f.code + '-' + f.entity_id]"
                        @click="autoFix(f)"
                        class="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-lg transition">
                  <span v-if="fixing[f.code + '-' + f.entity_id]">⟳ Correction en cours…</span>
                  <span v-else>✓ {{ f.auto_fix_label || 'Corriger automatiquement' }}</span>
                </button>
              </div>
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
