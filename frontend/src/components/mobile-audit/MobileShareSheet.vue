<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { TrashIcon, UserCircleIcon, EyeIcon, PencilIcon, MagnifyingGlassIcon } from '@heroicons/vue/24/outline'
import { listAfPermissions, grantAfPermission, revokeAfPermission, listUsers, ensureUserFromPocketId } from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import MobileSheet from './MobileSheet.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  docId: { type: Number, required: true },
})
const emit = defineEmits(['close'])

const { success, error: notifyError } = useNotification()
const { confirm } = useConfirm()

const data = ref({ owner_id: null, grants: [] })
const allUsers = ref([])
const search = ref('')
const newRole = ref('write')
const submitting = ref(false)
const loading = ref(false)

async function refresh() {
  loading.value = true
  try {
    const [pRes, uRes] = await Promise.all([
      listAfPermissions(props.docId),
      listUsers(),
    ])
    data.value = pRes.data
    allUsers.value = uRes.data
  } catch {
    notifyError('Échec chargement des partages')
  } finally {
    loading.value = false
  }
}

const grantedUserIds = computed(() => new Set([data.value.owner_id, ...data.value.grants.map(g => g.user_id)]))

const candidateUsers = computed(() => {
  const q = (search.value || '').toLowerCase().trim()
  if (q.length < 2) return []
  return allUsers.value.filter(u =>
    !grantedUserIds.value.has(u.id) &&
    ((u.display_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
  ).slice(0, 8)
})

async function grant(user) {
  submitting.value = true
  try {
    let userId = user.id
    // Si c'est un user PocketID pas encore en DB locale, on le crée d'abord
    if (typeof userId === 'string' && userId.startsWith('pocketid:')) {
      const { data: localUser } = await ensureUserFromPocketId(user.pocketid_id)
      userId = localUser.id
    }
    await grantAfPermission(props.docId, userId, newRole.value)
    success(`${user.display_name || user.email} ajouté en ${newRole.value === 'write' ? 'écriture' : 'lecture'}`)
    search.value = ''
    await refresh()
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec')
  } finally {
    submitting.value = false
  }
}

async function changeRole(g) {
  const newR = g.role === 'write' ? 'read' : 'write'
  try {
    await grantAfPermission(props.docId, g.user_id, newR)
    await refresh()
  } catch {
    notifyError('Modification impossible')
  }
}

async function revoke(g) {
  const ok = await confirm({
    title: 'Retirer l\'accès ?',
    message: `${g.user_display_name || g.user_email}`,
    confirmLabel: 'Retirer',
    danger: true,
  })
  if (!ok) return
  try {
    await revokeAfPermission(props.docId, g.user_id)
    await refresh()
  } catch {
    notifyError('Suppression impossible')
  }
}

watch(() => props.open, (v) => { if (v) refresh() })
onMounted(() => { if (props.open) refresh() })
</script>

<template>
  <MobileSheet
    :open="open"
    title="Partager l'audit"
    hide-save
    @close="emit('close')"
  >
    <div class="p-4 space-y-4">
      <p class="text-sm text-gray-600 leading-relaxed">
        Par défaut, cet audit n'est visible que par toi. Ajoute ci-dessous
        les collaborateurs qui doivent pouvoir l'ouvrir (avec leur login
        PocketID) en lecture ou en écriture. Seul le propriétaire peut
        gérer les partages.
      </p>

      <!-- Personnes ayant accès -->
      <div>
        <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Accès actuels ({{ (data.grants?.length || 0) + 1 }})
        </p>
        <div class="bg-white border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
          <!-- Owner -->
          <div class="flex items-center gap-3 px-4 py-3 bg-emerald-50">
            <UserCircleIcon class="w-6 h-6 text-emerald-700 shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="text-base font-medium text-gray-800">Créateur de l'audit</p>
              <p class="text-xs text-gray-500">user #{{ data.owner_id }} — owner non-révocable</p>
            </div>
            <span class="inline-flex items-center px-2 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-800 rounded-full">OWNER</span>
          </div>
          <!-- Grants -->
          <div v-for="g in data.grants" :key="g.user_id" class="flex items-center gap-3 px-4 py-3">
            <UserCircleIcon class="w-6 h-6 text-gray-400 shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="text-base font-medium text-gray-800 truncate">{{ g.user_display_name || g.user_email }}</p>
              <p class="text-xs text-gray-500 truncate">{{ g.user_email }}</p>
            </div>
            <button
              @click="changeRole(g)"
              :class="['inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-full',
                       g.role === 'write' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800']"
              v-tooltip="`Cliquer pour passer en ${g.role === 'write' ? 'lecture' : 'écriture'}`"
            >
              <PencilIcon v-if="g.role === 'write'" class="w-3 h-3" />
              <EyeIcon v-else class="w-3 h-3" />
              {{ g.role === 'write' ? 'Écriture' : 'Lecture' }}
            </button>
            <button @click="revoke(g)" class="tap-target text-gray-400 hover:text-red-600 inline-flex items-center justify-center" v-tooltip="`Retirer`">
              <TrashIcon class="w-5 h-5" />
            </button>
          </div>
          <p v-if="!loading && !data.grants.length" class="text-sm text-gray-500 italic px-4 py-4 text-center">
            Personne d'autre n'a accès pour l'instant.
          </p>
          <p v-if="loading" class="text-sm text-gray-400 px-4 py-4 text-center">Chargement…</p>
        </div>
      </div>

      <!-- Ajouter un utilisateur -->
      <div class="border-t border-gray-200 pt-4">
        <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Ajouter un utilisateur</p>
        <div class="space-y-2">
          <div class="relative">
            <MagnifyingGlassIcon class="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
            <input
              v-model="search"
              type="text"
              placeholder="Rechercher par nom ou email…"
              autocomplete="off"
              data-1p-ignore="true"
              class="w-full pl-11 pr-4 py-3.5 text-base border border-gray-200 rounded-xl bg-white"
            />
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm text-gray-600">Rôle :</span>
            <button
              type="button"
              @click="newRole = 'read'"
              :class="['px-3 py-1.5 text-sm font-medium rounded-full transition',
                       newRole === 'read' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600']"
            >
              <EyeIcon class="w-3.5 h-3.5 inline-block -mt-0.5 mr-1" />Lecture
            </button>
            <button
              type="button"
              @click="newRole = 'write'"
              :class="['px-3 py-1.5 text-sm font-medium rounded-full transition',
                       newRole === 'write' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600']"
            >
              <PencilIcon class="w-3.5 h-3.5 inline-block -mt-0.5 mr-1" />Écriture
            </button>
          </div>
        </div>
        <div v-if="search.length >= 2" class="mt-2 bg-white border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
          <button
            v-for="u in candidateUsers"
            :key="u.id"
            @click="grant(u)"
            :disabled="submitting"
            class="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-indigo-50 disabled:opacity-50"
          >
            <UserCircleIcon class="w-6 h-6 text-gray-400 shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="text-base text-gray-800 truncate">{{ u.display_name || u.email }}</p>
              <p class="text-xs text-gray-500 truncate">{{ u.email }}</p>
            </div>
            <span class="text-sm font-medium text-indigo-600">+ Ajouter</span>
          </button>
          <p v-if="!candidateUsers.length" class="px-4 py-4 text-sm text-gray-400 italic text-center">
            Aucun utilisateur ne correspond à « {{ search }} »
          </p>
        </div>
      </div>
    </div>
  </MobileSheet>
</template>
