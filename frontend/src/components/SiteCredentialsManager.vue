<script setup>
import { ref, onMounted, watch } from 'vue'
import {
  EyeIcon, EyeSlashIcon, TrashIcon, PencilSquareIcon,
  PlusIcon, KeyIcon,
} from '@heroicons/vue/24/outline'
import {
  listSiteCredentials, createSiteCredential, updateSiteCredential,
  deleteSiteCredential, revealSiteCredential,
} from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import BaseModal from '@/components/BaseModal.vue'

const props = defineProps({
  siteUuid: { type: String, required: true },
  systems: { type: Array, default: () => [] },
})

const { success, error } = useNotification()
const { confirm } = useConfirm()

const TYPES = [
  { value: 'web', label: 'Web (https://)' },
  { value: 'ssh', label: 'SSH' },
  { value: 'vpn', label: 'VPN' },
  { value: 'snmp', label: 'SNMP' },
  { value: 'rdp', label: 'RDP' },
  { value: 'autre', label: 'Autre' },
]

const credentials = ref([])
const revealedById = ref({}) // id -> password (en mémoire seulement)
const loading = ref(false)
const showModal = ref(false)
const editing = ref(null)
const form = ref({
  title: '', type: 'web', url: '', username: '', password: '', notes: '',
  bacs_audit_system_id: null,
})

async function refresh() {
  loading.value = true
  try {
    const { data } = await listSiteCredentials(props.siteUuid)
    credentials.value = data
  } catch {
    error('Échec du chargement des credentials')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  form.value = { title: '', type: 'web', url: '', username: '', password: '', notes: '', bacs_audit_system_id: null }
  showModal.value = true
}

function openEdit(c) {
  editing.value = c
  form.value = {
    title: c.title, type: c.type,
    url: c.url || '', username: c.username || '',
    password: '', // jamais pre-rempli
    notes: c.notes || '',
    bacs_audit_system_id: c.bacs_audit_system_id,
  }
  showModal.value = true
}

async function submit() {
  try {
    const payload = { ...form.value }
    if (!payload.password) delete payload.password // ne pas remplacer si non saisi
    if (editing.value) {
      await updateSiteCredential(editing.value.id, payload)
      success('Credential mis à jour')
    } else {
      await createSiteCredential(props.siteUuid, payload)
      success('Credential ajouté')
    }
    showModal.value = false
    refresh()
  } catch (e) {
    error(e.response?.data?.detail || 'Erreur')
  }
}

async function toggleReveal(c) {
  if (revealedById.value[c.id]) {
    delete revealedById.value[c.id]
    revealedById.value = { ...revealedById.value }
    return
  }
  try {
    const { data } = await revealSiteCredential(c.id)
    revealedById.value = { ...revealedById.value, [c.id]: data.password || '' }
  } catch {
    error('Déchiffrement impossible')
  }
}

async function removeCred(c) {
  const ok = await confirm({
    title: 'Supprimer ce credential ?',
    message: `« ${c.title} » sera supprimé définitivement.`,
    confirmLabel: 'Supprimer', danger: true,
  })
  if (!ok) return
  try {
    await deleteSiteCredential(c.id)
    credentials.value = credentials.value.filter(x => x.id !== c.id)
    success('Credential supprimé')
  } catch {
    error('Suppression impossible')
  }
}

watch(() => props.siteUuid, refresh)
onMounted(refresh)
</script>

<template>
  <div>
    <div class="flex justify-end mb-2">
      <button @click="openCreate"
              class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 whitespace-nowrap">
        <PlusIcon class="w-3.5 h-3.5" /> Ajouter un credential
      </button>
    </div>

    <div v-if="loading" class="text-center py-6 text-sm text-gray-400">Chargement…</div>
    <div v-else-if="!credentials.length" class="text-center py-6 text-sm text-gray-500">
      Aucun credential. Ajoute un accès web / SSH / VPN pour la GTB ou les systèmes.
    </div>
    <table v-else class="w-full text-sm">
      <thead class="text-xs uppercase text-gray-500 tracking-wider bg-gray-50">
        <tr>
          <th class="text-center px-3 py-2 w-20">Type</th>
          <th class="text-center py-2">Titre</th>
          <th class="text-center py-2">URL</th>
          <th class="text-center py-2 w-32">Utilisateur</th>
          <th class="text-center py-2 w-44">Mot de passe</th>
          <th class="text-center py-2 w-44">Rattaché à</th>
          <th class="text-center px-3 py-2 w-24">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100">
        <tr v-for="c in credentials" :key="c.id" class="group">
          <td class="px-3 py-2 text-center">
            <span class="inline-block px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded bg-gray-100 text-gray-700">
              {{ c.type }}
            </span>
          </td>
          <td class="py-2 text-center text-gray-700">{{ c.title }}</td>
          <td class="py-2 text-center text-xs text-gray-500">
            <a v-if="c.url" :href="c.url" target="_blank" class="hover:text-indigo-600 truncate inline-block max-w-50">{{ c.url }}</a>
            <span v-else>—</span>
          </td>
          <td class="py-2 text-center text-xs text-gray-700 font-mono">{{ c.username || '—' }}</td>
          <td class="py-2 text-center">
            <div v-if="!c.has_password" class="text-xs text-gray-400 italic">Aucun</div>
            <div v-else class="inline-flex items-center gap-2">
              <code v-if="revealedById[c.id]" class="text-xs bg-amber-50 border border-amber-200 px-2 py-0.5 rounded font-mono">
                {{ revealedById[c.id] }}
              </code>
              <span v-else class="text-xs text-gray-500 font-mono">••••••</span>
              <button @click="toggleReveal(c)" class="text-gray-400 hover:text-indigo-600">
                <EyeIcon v-if="!revealedById[c.id]" class="w-4 h-4" />
                <EyeSlashIcon v-else class="w-4 h-4" />
              </button>
            </div>
          </td>
          <td class="py-2 text-center text-xs text-gray-500">
            <span v-if="c.bacs_audit_system_id">
              {{ systems.find(s => s.id === c.bacs_audit_system_id)?.system_category || '?' }}
            </span>
            <span v-else>— site</span>
          </td>
          <td class="px-3 py-2 text-center">
            <button @click="openEdit(c)" class="text-gray-400 hover:text-indigo-600 mx-1" title="Modifier">
              <PencilSquareIcon class="w-4 h-4" />
            </button>
            <button @click="removeCred(c)" class="text-gray-400 hover:text-red-600 mx-1" title="Supprimer">
              <TrashIcon class="w-4 h-4" />
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <BaseModal v-if="showModal"
               :title="editing ? 'Modifier le credential' : 'Nouveau credential'"
               size="md" @close="showModal = false">
      <form @submit.prevent="submit" class="space-y-3">
        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">Type *</label>
            <select v-model="form.type" required
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
              <option v-for="t in TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </div>
          <div class="col-span-2">
            <label class="block text-xs font-medium text-gray-700 mb-1">Titre *</label>
            <input v-model="form.title" type="text" required placeholder="ex : GTB administrateur, VPN intégrateur"
                   class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">URL</label>
          <input v-model="form.url" type="text" placeholder="https://gtb.local ou ssh://10.0.0.1:22"
                 class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">Utilisateur</label>
            <input v-model="form.username" type="text"
                   class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono" />
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-700 mb-1">
              Mot de passe
              <span v-if="editing" class="text-gray-400 font-normal">— laisser vide pour ne pas modifier</span>
            </label>
            <input v-model="form.password" type="password"
                   :placeholder="editing ? '(non modifié)' : ''"
                   class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono" />
          </div>
        </div>
        <div v-if="systems.length">
          <label class="block text-xs font-medium text-gray-700 mb-1">
            Rattacher à un système (optionnel)
          </label>
          <select v-model="form.bacs_audit_system_id"
                  class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
            <option :value="null">— rattaché au site uniquement</option>
            <option v-for="s in systems" :key="s.id" :value="s.id">
              {{ s.system_category }} / {{ s.zone_name }}
            </option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-700 mb-1">Notes</label>
          <textarea v-model="form.notes" rows="2"
                    class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" @click="showModal = false"
                  class="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg whitespace-nowrap">
            Annuler
          </button>
          <button type="submit" :disabled="!form.title.trim()"
                  class="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap">
            {{ editing ? 'Mettre à jour' : 'Créer' }}
          </button>
        </div>
      </form>
    </BaseModal>
  </div>
</template>
