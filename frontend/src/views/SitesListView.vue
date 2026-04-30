<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import {
  BuildingOffice2Icon, MapPinIcon, MagnifyingGlassIcon, XMarkIcon,
  PlusIcon, PencilSquareIcon, TrashIcon, ArrowPathIcon,
} from '@heroicons/vue/24/outline'
import { listSites, createSite, updateSite, deleteSite } from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import BaseModal from '@/components/BaseModal.vue'
import AddressAutocomplete from '@/components/AddressAutocomplete.vue'

const { success, error } = useNotification()
const { confirm } = useConfirm()

const sites = ref([])
const loading = ref(false)
const searchQuery = ref('')

const showForm = ref(false)
const editing = ref(null) // null = création, sinon site complet
const form = ref({ name: '', customer_name: '', address: '', notes: '' })
const submitting = ref(false)

function normalize(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const filtered = computed(() => {
  const q = normalize(searchQuery.value)
  if (q.length < 2) return sites.value
  return sites.value.filter(s =>
    normalize(s.name).includes(q) ||
    normalize(s.customer_name).includes(q) ||
    normalize(s.address).includes(q)
  )
})

async function refresh() {
  loading.value = true
  try {
    const { data } = await listSites()
    sites.value = data
  } catch {
    error('Échec du chargement des sites')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  form.value = { name: '', customer_name: '', address: '', notes: '' }
  showForm.value = true
}

function openEdit(site) {
  editing.value = site
  form.value = {
    name: site.name,
    customer_name: site.customer_name || '',
    address: site.address || '',
    notes: site.notes || '',
  }
  showForm.value = true
}

async function submit() {
  if (!form.value.name.trim()) return
  submitting.value = true
  try {
    if (editing.value) {
      await updateSite(editing.value.site_uuid, form.value)
      success('Site mis à jour')
    } else {
      await createSite(form.value)
      success('Site créé')
    }
    showForm.value = false
    refresh()
  } catch (e) {
    error(e.response?.data?.detail || 'Erreur lors de l\'enregistrement')
  } finally {
    submitting.value = false
  }
}

async function confirmDelete(site) {
  const ok = await confirm({
    title: 'Supprimer ce site ?',
    message: `« ${site.name} »\n\nLes documents rattachés conservent leurs zones et équipements ; le site sera désactivé chez Fleet Manager au prochain sync.`,
    confirmLabel: 'Supprimer',
    danger: true,
  })
  if (!ok) return
  try {
    await deleteSite(site.site_uuid)
    success('Site supprimé')
    refresh()
  } catch {
    error('Échec de la suppression')
  }
}

function formatDate(s) {
  if (!s) return '—'
  return new Date(s.replace(' ', 'T')).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function syncBadge(site) {
  if (!site.synced_at) return { label: 'Jamais synchronisé', cls: 'bg-amber-100 text-amber-700' }
  return { label: `Sync ${formatDate(site.synced_at)}`, cls: 'bg-emerald-100 text-emerald-700' }
}

onMounted(refresh)
</script>

<template>
  <div class="max-w-6xl mx-auto">
    <!-- Header -->
    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold text-gray-800">Mes Sites</h1>
        <p class="text-sm text-gray-500 mt-1">
          {{ sites.length }} site{{ sites.length > 1 ? 's' : '' }} —
          partagé{{ sites.length > 1 ? 's' : '' }} avec Fleet Manager via synchronisation bidirectionnelle.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button
          @click="refresh"
          class="p-2 text-gray-500 hover:text-gray-700"
          title="Rafraîchir"
        >
          <ArrowPathIcon class="w-4 h-4" :class="loading ? 'animate-spin' : ''" />
        </button>
        <button
          @click="openCreate"
          class="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 shadow-sm"
        >
          <PlusIcon class="w-4 h-4" />
          Nouveau site
        </button>
      </div>
    </div>

    <!-- Recherche -->
    <div v-if="sites.length" class="mb-4">
      <div class="relative max-w-md">
        <MagnifyingGlassIcon class="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Rechercher par nom, client ou adresse…"
          autocomplete="off"
          class="w-full pl-9 pr-9 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"
        />
        <button v-if="searchQuery" @click="searchQuery = ''" class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
          <XMarkIcon class="w-4 h-4" />
        </button>
      </div>
    </div>

    <div v-if="loading && !sites.length" class="text-center py-12 text-gray-400 text-sm">Chargement...</div>

    <!-- Empty state -->
    <div
      v-else-if="!sites.length"
      class="bg-white rounded-lg border border-gray-200 p-12 text-center"
    >
      <div class="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center mx-auto">
        <BuildingOffice2Icon class="w-9 h-9 text-indigo-500" />
      </div>
      <h2 class="mt-4 text-base font-semibold text-gray-800">Aucun site enregistré</h2>
      <p class="mt-2 text-sm text-gray-500 max-w-md mx-auto leading-relaxed">
        Crée un site ici, ou laisse Fleet Manager le pousser au prochain sync.
        Les zones et équipements seront partagés entre tous les documents (AF, audit BACS, brochure) du site.
      </p>
      <button
        @click="openCreate"
        class="mt-5 inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
      >
        <PlusIcon class="w-4 h-4" /> Nouveau site
      </button>
    </div>

    <!-- Tableau -->
    <div v-else class="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-gray-50 text-xs uppercase text-gray-500 tracking-wider">
          <tr>
            <th class="text-left px-4 py-2.5">Site</th>
            <th class="text-left px-4 py-2.5">Client</th>
            <th class="text-left px-4 py-2.5">Adresse</th>
            <th class="text-left px-4 py-2.5 w-36">Synchro FM</th>
            <th class="text-left px-4 py-2.5 w-32">Modifié</th>
            <th class="text-right px-4 py-2.5 w-20">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in filtered" :key="s.site_uuid" class="border-t border-gray-100 hover:bg-indigo-50/40 group">
            <td class="px-4 py-2.5 font-semibold text-gray-800 whitespace-nowrap">
              {{ s.name }}
              <span class="block text-[10px] text-gray-400 font-mono font-normal">{{ s.site_uuid.slice(0, 8) }}</span>
            </td>
            <td class="px-4 py-2.5 text-gray-700">{{ s.customer_name || '—' }}</td>
            <td class="px-4 py-2.5 text-gray-500 text-xs">
              <div v-if="s.address" class="flex items-center gap-1">
                <MapPinIcon class="w-3 h-3 shrink-0" />{{ s.address }}
              </div>
              <span v-else class="italic">—</span>
            </td>
            <td class="px-4 py-2.5">
              <span :class="['inline-block px-2 py-0.5 text-[10px] font-medium rounded', syncBadge(s).cls]">
                {{ syncBadge(s).label }}
              </span>
            </td>
            <td class="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{{ formatDate(s.updated_at) }}</td>
            <td class="px-4 py-2.5 text-right">
              <div class="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                <button @click="openEdit(s)" class="text-gray-400 hover:text-indigo-600 p-1" title="Éditer">
                  <PencilSquareIcon class="w-4 h-4" />
                </button>
                <button @click="confirmDelete(s)" class="text-gray-400 hover:text-red-600 p-1" title="Supprimer">
                  <TrashIcon class="w-4 h-4" />
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="!filtered.length">
            <td colspan="6" class="px-4 py-10 text-center">
              <p class="text-sm text-gray-500">
                Aucun site ne correspond à « <strong>{{ searchQuery }}</strong> ».
              </p>
              <button @click="searchQuery = ''" class="mt-2 text-xs text-indigo-600 hover:underline">
                Effacer la recherche
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal création / édition -->
    <BaseModal
      v-if="showForm"
      :title="editing ? 'Modifier le site' : 'Nouveau site'"
      size="md"
      @close="showForm = false"
    >
      <form @submit.prevent="submit" class="space-y-4">
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Nom du site *</label>
          <input
            v-model="form.name"
            type="text"
            required
            placeholder="ex : Lyon Part-Dieu — Bâtiment B"
            class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Client</label>
          <input
            v-model="form.customer_name"
            type="text"
            placeholder="ex : Acme SAS"
            class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Adresse</label>
          <AddressAutocomplete
            v-model="form.address"
            placeholder="ex : 42 rue de la Tête d'Or, 69006 Lyon"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Notes</label>
          <textarea
            v-model="form.notes"
            rows="3"
            placeholder="Informations complémentaires (gestionnaire, contraintes d'accès, etc.)"
            class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"
          />
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button
            type="button"
            @click="showForm = false"
            class="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition"
          >
            Annuler
          </button>
          <button
            type="submit"
            :disabled="submitting || !form.name.trim()"
            class="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {{ submitting ? 'Enregistrement...' : (editing ? 'Mettre à jour' : 'Créer') }}
          </button>
        </div>
      </form>
    </BaseModal>
  </div>
</template>
