<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { TrashIcon, UserCircleIcon, EyeIcon, PencilIcon } from '@heroicons/vue/24/outline'
import { listAfPermissions, grantAfPermission, revokeAfPermission, listUsers } from '@/api'
import { useNotification } from '@/composables/useNotification'
import BaseModal from './BaseModal.vue'

const props = defineProps({
  afId: { type: Number, required: true },
})
const emit = defineEmits(['close'])
const { success, error: notifyError } = useNotification()

const data = ref({ owner_id: null, grants: [] })
const allUsers = ref([])
const search = ref('')
const newRole = ref('write')
const selectedUserId = ref(null)
const submitting = ref(false)

async function refresh() {
  try {
    const [pRes, uRes] = await Promise.all([listAfPermissions(props.afId), listUsers()])
    data.value = pRes.data
    allUsers.value = uRes.data
  } catch (e) { notifyError('Échec chargement permissions') }
}

const grantedUserIds = computed(() => new Set([data.value.owner_id, ...data.value.grants.map(g => g.user_id)]))

const candidateUsers = computed(() => {
  const q = (search.value || '').toLowerCase().trim()
  return allUsers.value.filter(u =>
    !grantedUserIds.value.has(u.id) &&
    (q.length < 2 || (u.display_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
  ).slice(0, 8)
})

async function grant(user) {
  submitting.value = true
  try {
    await grantAfPermission(props.afId, user.id, newRole.value)
    success(`${user.display_name || user.email} ajouté en ${newRole.value === 'write' ? 'écriture' : 'lecture'}`)
    search.value = ''
    selectedUserId.value = null
    await refresh()
  } catch (e) { notifyError(e.response?.data?.detail || 'Échec') }
  finally { submitting.value = false }
}

async function changeRole(grant) {
  const newR = grant.role === 'write' ? 'read' : 'write'
  try {
    await grantAfPermission(props.afId, grant.user_id, newR)
    await refresh()
  } catch (e) { notifyError('Échec') }
}

async function revoke(grant) {
  if (!confirm(`Retirer l'accès de ${grant.user_display_name || grant.user_email} ?`)) return
  try { await revokeAfPermission(props.afId, grant.user_id); await refresh() }
  catch (e) { notifyError('Échec') }
}

watch(() => props.afId, refresh)
onMounted(refresh)
</script>

<template>
  <BaseModal title="Partager cette AF" size="lg" @close="emit('close')">
    <div class="space-y-5">
      <p class="text-xs text-gray-500 leading-relaxed">
        Donnez accès à d'autres utilisateurs en lecture ou écriture.
        <strong>Note V1 :</strong> tant qu'aucun partage n'est posé, l'AF reste visible par tous les utilisateurs Buildy
        (mode legacy). Le partage sert pour l'instant à <em>formaliser</em> les responsabilités ; l'enforcement strict est prévu en V2.
      </p>

      <!-- Liste des grants existants -->
      <div>
        <p class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
          Personnes ayant accès ({{ (data.grants?.length || 0) + 1 }})
        </p>
        <div class="space-y-1.5">
          <!-- Owner -->
          <div class="flex items-center gap-3 px-3 py-2 bg-emerald-50 border border-emerald-200">
            <UserCircleIcon class="w-5 h-5 text-emerald-700 shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-800">Créateur de l'AF (vous, ou un autre)</p>
              <p class="text-[11px] text-gray-500">user #{{ data.owner_id }} — owner implicite, non révocable</p>
            </div>
            <span class="inline-flex items-center px-2 py-0.5 text-[11px] font-bold bg-emerald-100 text-emerald-800 rounded">Owner</span>
          </div>
          <!-- Grants -->
          <div v-for="g in data.grants" :key="g.user_id" class="flex items-center gap-3 px-3 py-2 border border-gray-200 hover:bg-gray-50">
            <UserCircleIcon class="w-5 h-5 text-gray-400 shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-800 truncate">{{ g.user_display_name || g.user_email }}</p>
              <p class="text-[11px] text-gray-500">{{ g.user_email }} · ajouté le {{ new Date(g.granted_at + 'Z').toLocaleDateString('fr-FR') }}</p>
            </div>
            <button @click="changeRole(g)" :class="['inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold rounded', g.role === 'write' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800']" :title="`Cliquer pour passer en ${g.role === 'write' ? 'lecture' : 'écriture'}`">
              <PencilIcon v-if="g.role === 'write'" class="w-3 h-3" />
              <EyeIcon v-else class="w-3 h-3" />
              {{ g.role === 'write' ? 'Écriture' : 'Lecture' }}
            </button>
            <button @click="revoke(g)" class="text-gray-400 hover:text-red-600 p-1" :title="`Retirer l'accès`">
              <TrashIcon class="w-3.5 h-3.5" />
            </button>
          </div>
          <p v-if="!data.grants.length" class="text-xs text-gray-400 italic px-3 py-2">Aucun partage explicite pour l'instant.</p>
        </div>
      </div>

      <!-- Ajouter un utilisateur -->
      <div class="border-t border-gray-100 pt-4">
        <p class="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Ajouter un utilisateur</p>
        <div class="flex items-center gap-2 mb-2">
          <input v-model="search" type="text" placeholder="Rechercher par nom ou email…" autocomplete="off" data-1p-ignore="true"
                 class="flex-1 px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <select v-model="newRole" class="px-3 py-2 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="read">Lecture</option>
            <option value="write">Écriture</option>
          </select>
        </div>
        <div v-if="search.length >= 2 || candidateUsers.length" class="border border-gray-200 max-h-48 overflow-y-auto">
          <button v-for="u in candidateUsers" :key="u.id" @click="grant(u)" :disabled="submitting"
                  class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-indigo-50 border-b border-gray-100 last:border-0 disabled:opacity-50">
            <UserCircleIcon class="w-5 h-5 text-gray-400 shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="text-sm text-gray-800 truncate">{{ u.display_name || u.email }}</p>
              <p class="text-[11px] text-gray-500 truncate">{{ u.email }}</p>
            </div>
            <span class="text-[11px] text-indigo-600">+ Ajouter</span>
          </button>
          <p v-if="!candidateUsers.length" class="px-3 py-3 text-xs text-gray-400 italic">Aucun utilisateur ne correspond.</p>
        </div>
      </div>
    </div>
    <template #footer>
      <button @click="emit('close')" class="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">Fermer</button>
    </template>
  </BaseModal>
</template>
