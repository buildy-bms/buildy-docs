<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  BookOpenIcon, PlusIcon, ArrowPathIcon, DocumentTextIcon,
} from '@heroicons/vue/24/outline'
import { listWhitepapers, createWhitepaper } from '@/api'
import { useNotification } from '@/composables/useNotification'
import BaseModal from '@/components/BaseModal.vue'

const router = useRouter()
const { success, error } = useNotification()

const whitepapers = ref([])
const loading = ref(false)

const showForm = ref(false)
const form = ref({ title: '', audience: '' })
const submitting = ref(false)

const AUDIENCE_LABELS = {
  property_manager: 'Property manager',
  asset_manager: 'Asset manager',
  moa_moe: 'MOA / MOE / BE',
  exploitant: 'Exploitant',
}

const total = computed(() => whitepapers.value.length)

function formatDate(s) {
  if (!s) return '—'
  return new Date(s.replace(' ', 'T')).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function statusBadge(status) {
  return status === 'published'
    ? { label: 'Publié', cls: 'bg-emerald-100 text-emerald-700' }
    : { label: 'Brouillon', cls: 'bg-gray-100 text-gray-600' }
}

async function refresh() {
  loading.value = true
  try {
    const { data } = await listWhitepapers()
    whitepapers.value = data
  } catch {
    error('Échec du chargement des livres blancs')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  form.value = { title: '', audience: '' }
  showForm.value = true
}

async function submit() {
  if (!form.value.title.trim()) return
  submitting.value = true
  try {
    const { data } = await createWhitepaper({
      title: form.value.title.trim(),
      audience: form.value.audience || null,
    })
    success('Livre blanc créé')
    showForm.value = false
    router.push({ name: 'whitepaper-detail', params: { id: data.id } })
  } catch (e) {
    error(e.response?.data?.detail || 'Erreur lors de la création')
  } finally {
    submitting.value = false
  }
}

function open(wp) {
  router.push({ name: 'whitepaper-detail', params: { id: wp.id } })
}

onMounted(refresh)
</script>

<template>
  <div class="max-w-6xl mx-auto">
    <!-- Header -->
    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold text-gray-800">Livres blancs</h1>
        <p class="text-sm text-gray-500 mt-1">
          {{ total }} livre{{ total > 1 ? 's' : '' }} blanc{{ total > 1 ? 's' : '' }} —
          rédaction du contenu, mise en page automatique, export PDF.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button @click="refresh" class="p-2 text-gray-500 hover:text-gray-700" v-tooltip="'Rafraîchir'">
          <ArrowPathIcon class="w-4 h-4" :class="loading ? 'animate-spin' : ''" />
        </button>
        <button
          @click="openCreate"
          class="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 shadow-sm whitespace-nowrap"
        >
          <PlusIcon class="w-4 h-4 shrink-0" />
          Nouveau livre blanc
        </button>
      </div>
    </div>

    <div v-if="loading && !total" class="text-center py-12 text-gray-400 text-sm">Chargement...</div>

    <!-- Empty state -->
    <div
      v-else-if="!total"
      class="bg-white rounded-lg border border-gray-200 p-12 text-center"
    >
      <div class="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center mx-auto">
        <BookOpenIcon class="w-9 h-9 text-indigo-500" />
      </div>
      <h2 class="mt-4 text-base font-semibold text-gray-800">Aucun livre blanc</h2>
      <p class="mt-2 text-sm text-gray-500 max-w-md mx-auto leading-relaxed">
        Crée un livre blanc : tu rédiges le contenu chapitre par chapitre,
        la mise en page et la pagination sont gérées automatiquement à l'export PDF.
      </p>
      <button
        @click="openCreate"
        class="mt-5 inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
      >
        <PlusIcon class="w-4 h-4" />
        Nouveau livre blanc
      </button>
    </div>

    <!-- Tableau -->
    <div v-else class="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs font-semibold uppercase tracking-wider text-gray-500 border-b border-gray-200">
            <th class="px-4 py-3">Titre</th>
            <th class="px-4 py-3">Audience</th>
            <th class="px-4 py-3">Statut</th>
            <th class="px-4 py-3 whitespace-nowrap">Version</th>
            <th class="px-4 py-3 whitespace-nowrap">Compagnons</th>
            <th class="px-4 py-3 whitespace-nowrap">Modifié</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="wp in whitepapers"
            :key="wp.id"
            @click="open(wp)"
            class="border-b border-gray-100 last:border-0 hover:bg-indigo-50/40 cursor-pointer transition"
          >
            <td class="px-4 py-3">
              <div class="flex items-center gap-2.5">
                <BookOpenIcon class="w-4 h-4 text-indigo-500 shrink-0" />
                <span class="font-medium text-gray-800">{{ wp.title }}</span>
              </div>
            </td>
            <td class="px-4 py-3 text-gray-600">
              {{ AUDIENCE_LABELS[wp.audience] || '—' }}
            </td>
            <td class="px-4 py-3">
              <span class="inline-block px-2 py-0.5 rounded text-xs font-semibold" :class="statusBadge(wp.status).cls">
                {{ statusBadge(wp.status).label }}
              </span>
            </td>
            <td class="px-4 py-3 text-gray-600 whitespace-nowrap">{{ wp.version || '—' }}</td>
            <td class="px-4 py-3 text-gray-600 whitespace-nowrap">
              <span v-if="wp.companion_count" class="inline-flex items-center gap-1">
                <DocumentTextIcon class="w-3.5 h-3.5 text-gray-400" />
                {{ wp.companion_count }}
              </span>
              <span v-else class="text-gray-300">—</span>
            </td>
            <td class="px-4 py-3 text-gray-500 whitespace-nowrap">{{ formatDate(wp.updated_at) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modale création -->
    <BaseModal v-if="showForm" title="Nouveau livre blanc" :dismiss-on-backdrop="false" @close="showForm = false">
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Titre</label>
          <input
            v-model="form.title"
            type="text"
            placeholder="ex : Méthode interne d'audit BACS"
            autofocus
            @keydown.enter="submit"
            class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Audience cible</label>
          <select
            v-model="form.audience"
            class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"
          >
            <option value="">Non précisée</option>
            <option v-for="(label, key) in AUDIENCE_LABELS" :key="key" :value="key">{{ label }}</option>
          </select>
        </div>
      </div>
      <template #footer>
        <button
          @click="showForm = false"
          class="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
        >
          Annuler
        </button>
        <button
          @click="submit"
          :disabled="submitting || !form.title.trim()"
          class="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {{ submitting ? 'Création…' : 'Créer' }}
        </button>
      </template>
    </BaseModal>
  </div>
</template>
