<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronLeftIcon, TagIcon, ArrowsRightLeftIcon, ArrowUturnLeftIcon, BookmarkIcon, ClockIcon } from '@heroicons/vue/24/outline'
import { getAf, listAfVersions, getAfVersionsDiff, restoreAfVersion, checkpointAf } from '@/api'
import { useNotification } from '@/composables/useNotification'
import BaseModal from '@/components/BaseModal.vue'

const route = useRoute()
const router = useRouter()
const { success, error: notifyError } = useNotification()

const af = ref(null)
const commits = ref([])
const loading = ref(true)
const selected = ref([]) // [shaA, shaB] pour le diff
const diff = ref(null)
const showDiff = ref(false)
const showCheckpoint = ref(false)
const checkpointMsg = ref('')
const checkpointTag = ref('')

const selectedSet = computed(() => new Set(selected.value))

async function refresh() {
  loading.value = true
  try {
    const [{ data: afRes }, { data: verRes }] = await Promise.all([
      getAf(route.params.id),
      listAfVersions(route.params.id),
    ])
    af.value = afRes
    commits.value = verRes.commits || []
  } catch (e) {
    notifyError('Échec du chargement de l\'historique')
  } finally {
    loading.value = false
  }
}

function toggleSelect(sha) {
  const idx = selected.value.indexOf(sha)
  if (idx !== -1) {
    selected.value.splice(idx, 1)
    return
  }
  if (selected.value.length >= 2) selected.value.shift()
  selected.value.push(sha)
}

async function compareDiff() {
  if (selected.value.length !== 2) return
  // L'ordre attendu : older -> newer. Trie selon position dans commits (0 = newest).
  const positions = selected.value.map(sha => commits.value.findIndex(c => c.sha === sha))
  const [from, to] = positions[0] > positions[1]
    ? [selected.value[0], selected.value[1]]
    : [selected.value[1], selected.value[0]]
  try {
    const { data } = await getAfVersionsDiff(route.params.id, from, to)
    diff.value = data
    showDiff.value = true
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec du diff')
  }
}

async function restore(sha) {
  if (!confirm(`Restaurer la version ${sha.slice(0, 7)} ? Cela va écraser les sections actuelles avec leur contenu d'alors. Un nouveau commit "Restauration de ${sha.slice(0, 7)}" sera créé pour garder la trace.`)) return
  try {
    const { data } = await restoreAfVersion(route.params.id, sha)
    success(`Restauration : ${data.touched} sections mises à jour, ${data.missing} introuvables`)
    await refresh()
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec restauration')
  }
}

async function submitCheckpoint() {
  if (!checkpointMsg.value.trim()) return
  try {
    const { data } = await checkpointAf(route.params.id, checkpointMsg.value.trim(), checkpointTag.value.trim() || null)
    if (data.sha) {
      success(`Checkpoint posé : ${data.sha_short}`)
      showCheckpoint.value = false
      checkpointMsg.value = ''
      checkpointTag.value = ''
      await refresh()
    } else {
      notifyError('Aucun changement à commiter')
    }
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec checkpoint')
  }
}

function formatDate(iso) {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
}

onMounted(refresh)
</script>

<template>
  <div class="max-w-5xl mx-auto">
    <button @click="router.push(`/afs/${route.params.id}`)" class="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3">
      <ChevronLeftIcon class="w-4 h-4" /> Retour à l'AF
    </button>

    <div class="flex items-end justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold text-gray-800">Historique des versions</h1>
        <p v-if="af" class="text-sm text-gray-500 mt-1">
          {{ af.client_name }} — {{ af.project_name }} · {{ commits.length }} commit{{ commits.length > 1 ? 's' : '' }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button
          v-if="selected.length === 2"
          @click="compareDiff"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600 text-white hover:bg-indigo-700"
        >
          <ArrowsRightLeftIcon class="w-3.5 h-3.5" /> Comparer ces 2 versions
        </button>
        <button
          @click="showCheckpoint = true"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 hover:bg-gray-50 text-gray-700"
        >
          <BookmarkIcon class="w-3.5 h-3.5" /> Marquer comme version
        </button>
      </div>
    </div>

    <div v-if="loading" class="text-center py-12 text-gray-400 text-sm">Chargement…</div>

    <div v-else-if="!commits.length" class="bg-white border border-gray-200 rounded-lg p-12 text-center text-sm text-gray-400">
      Aucun commit pour cette AF. Le premier commit sera créé automatiquement au prochain export PDF
      (ou via le bouton « Marquer comme version »).
    </div>

    <ol v-else class="relative border-l border-gray-200 ml-3">
      <li v-for="(c, i) in commits" :key="c.sha" class="mb-5 ml-5">
        <div :class="['absolute -left-[7px] mt-1.5 w-3 h-3 rounded-full border-2 border-white', i === 0 ? 'bg-emerald-500' : 'bg-gray-300']"></div>

        <div :class="['bg-white border rounded-lg p-3', selectedSet.has(c.sha) ? 'border-indigo-400 ring-1 ring-indigo-200' : 'border-gray-200']">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 mb-1 flex-wrap">
                <code class="text-[11px] bg-gray-100 px-1.5 py-0.5 font-mono">{{ c.sha_short }}</code>
                <span v-for="t in c.tags" :key="t" class="inline-flex items-center gap-1 text-[10px] bg-amber-50 border border-amber-200 text-amber-800 px-1.5 py-0.5 font-semibold">
                  <TagIcon class="w-3 h-3" /> {{ t }}
                </span>
                <span v-if="i === 0" class="inline-block px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-800">HEAD</span>
              </div>
              <p class="text-sm font-medium text-gray-800">{{ c.message }}</p>
              <p class="text-[11px] text-gray-500 mt-0.5 inline-flex items-center gap-1">
                <ClockIcon class="w-3 h-3" /> {{ formatDate(c.date) }} · {{ c.author_name }}
              </p>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <label class="inline-flex items-center gap-1 text-[11px] text-gray-500 cursor-pointer">
                <input type="checkbox" :checked="selectedSet.has(c.sha)" @change="toggleSelect(c.sha)" class="w-3.5 h-3.5" />
                Sélect.
              </label>
              <button
                v-if="i !== 0"
                @click="restore(c.sha)"
                class="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                title="Restaurer cette version"
              >
                <ArrowUturnLeftIcon class="w-3 h-3" /> Restaurer
              </button>
            </div>
          </div>
        </div>
      </li>
    </ol>

    <BaseModal v-if="showDiff" title="Différences entre versions" size="lg" @close="showDiff = false">
      <div v-if="diff" class="text-xs space-y-3 max-h-[65vh] overflow-y-auto">
        <p class="text-gray-500">
          <code class="bg-gray-100 px-1">{{ diff.from_sha?.slice(0, 7) }}</code>
          <ArrowsRightLeftIcon class="w-3 h-3 inline mx-1" />
          <code class="bg-gray-100 px-1">{{ diff.to_sha?.slice(0, 7) }}</code>
          <span class="ml-2 text-amber-700">{{ diff.total_changes }} changement{{ diff.total_changes > 1 ? 's' : '' }}</span>
        </p>

        <div v-if="Object.keys(diff.af_meta_changes).length" class="border border-gray-200 p-2">
          <p class="font-semibold text-gray-700 mb-1">Métadonnées AF</p>
          <ul class="ml-3">
            <li v-for="(c, k) in diff.af_meta_changes" :key="k">
              <span class="text-gray-500">{{ k }}</span> :
              <span class="line-through text-red-700">{{ c.from || '∅' }}</span>
              →
              <span class="text-emerald-700">{{ c.to || '∅' }}</span>
            </li>
          </ul>
        </div>

        <div v-if="diff.sections.added.length">
          <p class="font-semibold text-emerald-700 mb-1">+ {{ diff.sections.added.length }} section(s) ajoutée(s)</p>
          <ul class="ml-3 space-y-0.5">
            <li v-for="s in diff.sections.added" :key="'a-'+s.id">
              <code class="text-gray-500">§ {{ s.number || '?' }}</code> {{ s.title }}
            </li>
          </ul>
        </div>

        <div v-if="diff.sections.removed.length">
          <p class="font-semibold text-red-700 mb-1">− {{ diff.sections.removed.length }} section(s) supprimée(s)</p>
          <ul class="ml-3 space-y-0.5">
            <li v-for="s in diff.sections.removed" :key="'r-'+s.id">
              <code class="text-gray-500">§ {{ s.number || '?' }}</code> {{ s.title }}
            </li>
          </ul>
        </div>

        <div v-if="diff.sections.modified.length">
          <p class="font-semibold text-amber-700 mb-1">~ {{ diff.sections.modified.length }} section(s) modifiée(s)</p>
          <div v-for="s in diff.sections.modified" :key="'m-'+s.id" class="border border-gray-200 p-2 mb-1.5">
            <p class="font-semibold text-gray-800"><code class="text-gray-500 mr-1">§ {{ s.number || '?' }}</code> {{ s.title }}</p>
            <ul class="ml-3 mt-1 space-y-0.5">
              <li v-for="(c, k) in s.changes" :key="k">
                <template v-if="k === 'points'">
                  <span class="text-gray-700">Points :</span>
                  <span v-if="c.added.length" class="text-emerald-700 ml-1">+{{ c.added.length }}</span>
                  <span v-if="c.removed.length" class="text-red-700 ml-1">−{{ c.removed.length }}</span>
                  <span v-if="c.modified.length" class="text-amber-700 ml-1">~{{ c.modified.length }}</span>
                </template>
                <template v-else-if="k === 'attachments'">
                  <span class="text-gray-700">Captures :</span>
                  <span v-if="c.added.length" class="text-emerald-700 ml-1">+{{ c.added.length }}</span>
                  <span v-if="c.removed.length" class="text-red-700 ml-1">−{{ c.removed.length }}</span>
                </template>
                <template v-else-if="k === 'body_html'">
                  <span class="text-gray-500">{{ k }}</span> : <span class="text-amber-700">contenu modifié ({{ (c.from?.length || 0) }} → {{ (c.to?.length || 0) }} car.)</span>
                </template>
                <template v-else>
                  <span class="text-gray-500">{{ k }}</span> :
                  <span class="line-through text-red-700">{{ c.from || '∅' }}</span>
                  →
                  <span class="text-emerald-700">{{ c.to || '∅' }}</span>
                </template>
              </li>
            </ul>
          </div>
        </div>

        <p v-if="!diff.total_changes" class="text-gray-400 italic">Aucune différence.</p>
      </div>
      <template #footer>
        <button @click="showDiff = false" class="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">Fermer</button>
      </template>
    </BaseModal>

    <BaseModal v-if="showCheckpoint" title="Marquer comme version" size="md" @close="showCheckpoint = false">
      <form @submit.prevent="submitCheckpoint" class="space-y-3">
        <div>
          <label class="block text-xs font-semibold text-gray-700 mb-1">Message du commit *</label>
          <input v-model="checkpointMsg" type="text" required autocomplete="off" data-1p-ignore="true" data-bwignore="true" data-lpignore="true"
                 placeholder="Ex : Validation client, version transmise au BE…"
                 class="w-full px-3 py-2 border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label class="block text-xs font-semibold text-gray-700 mb-1">Tag (optionnel)</label>
          <input v-model="checkpointTag" type="text" autocomplete="off" data-1p-ignore="true" data-bwignore="true" data-lpignore="true"
                 placeholder="Ex : v1.0-livraison-DOE"
                 class="w-full px-3 py-2 border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <p class="text-[11px] text-gray-500 mt-1">Posera un tag Git annoté visible dans la timeline.</p>
        </div>
      </form>
      <template #footer>
        <button @click="showCheckpoint = false" class="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">Annuler</button>
        <button @click="submitCheckpoint" class="px-3 py-1.5 text-xs bg-indigo-600 text-white hover:bg-indigo-700">Marquer</button>
      </template>
    </BaseModal>
  </div>
</template>
