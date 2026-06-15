<script setup>
/**
 * Panneau de statistiques de clics réutilisable.
 * Affiche : 3 KPIs (total / uniques / dernière visite), graphes par jour,
 * provenances. Utilisé pour les whitepapers (1 instance par doc) et pour
 * la library/functionalities (1 instance par PDF publié).
 */
import { computed } from 'vue'
import { ChartBarIcon, ArrowPathIcon, ClipboardDocumentIcon } from '@heroicons/vue/24/outline'

const props = defineProps({
  title: { type: String, default: 'Lien traçable & statistiques' },
  trackerUrl: { type: String, default: null },
  clicks: { type: Object, default: null },
  loading: { type: Boolean, default: false },
})
const emit = defineEmits(['refresh', 'copy-url'])

const maxByDay = computed(() => Math.max(1, ...(props.clicks?.by_day || []).map(d => d.count)))
function barWidth(count) { return `${Math.round((count / maxByDay.value) * 100)}%` }
function formatDateTime(s) {
  if (!s) return ''
  try { return new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z')).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return s }
}
function formatDay(d) {
  try { return new Date(d + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) }
  catch { return d }
}
</script>

<template>
  <div class="bg-white rounded-lg border border-gray-200 p-5">
    <div class="flex items-center justify-between gap-4 mb-4">
      <h2 class="text-base font-semibold text-gray-800 flex items-center gap-2">
        <ChartBarIcon class="w-5 h-5 text-indigo-500 shrink-0" /> {{ title }}
      </h2>
      <button
        @click="emit('refresh')"
        :disabled="loading"
        class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
      >
        <ArrowPathIcon class="w-3.5 h-3.5 shrink-0" :class="{ 'animate-spin': loading }" />
        {{ loading ? 'Mise à jour…' : 'Rafraîchir' }}
      </button>
    </div>

    <!-- Lien à partager (LinkedIn, email, etc.) -->
    <div v-if="trackerUrl" class="flex items-center gap-2 mb-4 p-3 bg-indigo-50 rounded-lg text-sm min-w-0">
      <span class="font-medium text-indigo-900 shrink-0">À partager :</span>
      <a :href="trackerUrl" target="_blank" rel="noopener"
         class="text-indigo-600 hover:underline truncate">{{ trackerUrl }}</a>
      <button @click="emit('copy-url')" class="text-indigo-400 hover:text-indigo-700 shrink-0" v-tooltip="'Copier le lien'">
        <ClipboardDocumentIcon class="w-4 h-4" />
      </button>
    </div>

    <!-- KPIs -->
    <div class="grid grid-cols-3 gap-3 mb-4">
      <div class="rounded-lg bg-gray-50 p-3">
        <div class="text-2xl font-semibold text-gray-800">{{ clicks?.total ?? 0 }}</div>
        <div class="text-xs text-gray-500 mt-0.5">clic{{ (clicks?.total ?? 0) > 1 ? 's' : '' }} au total</div>
      </div>
      <div class="rounded-lg bg-gray-50 p-3">
        <div class="text-2xl font-semibold text-gray-800">{{ clicks?.uniques ?? 0 }}</div>
        <div class="text-xs text-gray-500 mt-0.5">visiteurs uniques</div>
      </div>
      <div class="rounded-lg bg-gray-50 p-3">
        <div class="text-sm font-semibold text-gray-800 leading-tight">{{ clicks?.last_hit_at ? formatDateTime(clicks.last_hit_at) : '—' }}</div>
        <div class="text-xs text-gray-500 mt-0.5">dernière visite</div>
      </div>
    </div>

    <p v-if="!clicks?.total" class="text-sm text-gray-400">
      Aucun clic enregistré pour l'instant. Les statistiques sont actualisées automatiquement chaque jour ; « Rafraîchir » force une mise à jour immédiate.
    </p>
    <div v-else class="grid grid-cols-2 gap-6">
      <div>
        <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Activité récente</h3>
        <div class="space-y-1">
          <div v-for="d in clicks.by_day" :key="d.day" class="flex items-center gap-2 text-sm">
            <span class="text-gray-500 w-16 shrink-0">{{ formatDay(d.day) }}</span>
            <div class="flex-1 bg-gray-100 rounded h-2 overflow-hidden">
              <div class="bg-indigo-400 h-full rounded" :style="{ width: barWidth(d.count) }"></div>
            </div>
            <span class="text-gray-700 font-medium w-7 text-right shrink-0">{{ d.count }}</span>
          </div>
        </div>
      </div>
      <div>
        <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Provenances</h3>
        <div class="space-y-1.5">
          <div v-for="r in clicks.by_referer" :key="r.source" class="flex items-center justify-between gap-3 text-sm">
            <span class="text-gray-600 truncate">{{ r.source }}</span>
            <span class="text-gray-700 font-medium shrink-0">{{ r.count }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
