<script setup>
import { ref, watch, computed } from 'vue'
import { ArrowPathIcon, XMarkIcon, CheckIcon, ChevronRightIcon, ArrowsRightLeftIcon } from '@heroicons/vue/24/outline'
import { getAfTemplateUpdates, applySectionTemplateUpdate, dismissSectionTemplateUpdate } from '@/api'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'
import BaseModal from '@/components/BaseModal.vue'

const props = defineProps({
  afId: { type: Number, required: true },
})
const emit = defineEmits(['updated'])

const { success: notifySuccess, error: notifyError } = useNotification()
const { confirm } = useConfirm()

const updates = ref([])
const loading = ref(false)
const showModal = ref(false)
const expanded = ref(new Set())
const busy = ref(new Set())

const totalChanges = computed(() => updates.value.reduce((acc, u) => acc + (u.total_changes || 0), 0))

// Resume des sources : "2 équipements · 3 sections · 1 fonctionnalité"
const sourcesSummary = computed(() => {
  const counts = { equipment: 0, section_template: 0, functionality: 0 }
  for (const u of updates.value) {
    const s = u.source || 'equipment'
    if (counts[s] != null) counts[s]++
  }
  const parts = []
  if (counts.equipment) parts.push(`${counts.equipment} équipement${counts.equipment > 1 ? 's' : ''}`)
  if (counts.section_template) parts.push(`${counts.section_template} section${counts.section_template > 1 ? 's' : ''}`)
  if (counts.functionality) parts.push(`${counts.functionality} fonctionnalité${counts.functionality > 1 ? 's' : ''}`)
  return parts.join(' · ')
})

const SOURCE_LABELS = {
  equipment: { label: 'Équipement', class: 'bg-blue-100 text-blue-800' },
  section_template: { label: 'Section', class: 'bg-green-100 text-green-800' },
  functionality: { label: 'Fonctionnalité', class: 'bg-purple-100 text-purple-800' },
}
function sourceLabel(s) { return SOURCE_LABELS[s || 'equipment']?.label || s }
function sourceClass(s) { return SOURCE_LABELS[s || 'equipment']?.class || 'bg-gray-100 text-gray-700' }

async function refresh() {
  loading.value = true
  try {
    const { data } = await getAfTemplateUpdates(props.afId)
    updates.value = data.items || []
  } catch (e) {
    // silencieux : on ne polue pas l'UI si l'endpoint n'existe pas (deploiement en cours)
    updates.value = []
  } finally {
    loading.value = false
  }
}

function toggle(id) {
  if (expanded.value.has(id)) expanded.value.delete(id)
  else expanded.value.add(id)
  expanded.value = new Set(expanded.value)
}

async function apply(item) {
  busy.value.add(item.section_id)
  busy.value = new Set(busy.value)
  try {
    await applySectionTemplateUpdate(item.section_id)
    notifySuccess(`§ ${item.section_number || '?'} synchronisée sur v${item.to_version}`)
    updates.value = updates.value.filter(u => u.section_id !== item.section_id)
    emit('updated')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec de la synchronisation')
  } finally {
    busy.value.delete(item.section_id)
    busy.value = new Set(busy.value)
  }
}

async function dismiss(item) {
  busy.value.add(item.section_id)
  busy.value = new Set(busy.value)
  try {
    await dismissSectionTemplateUpdate(item.section_id)
    updates.value = updates.value.filter(u => u.section_id !== item.section_id)
    emit('updated')
  } catch (e) {
    notifyError(e.response?.data?.detail || 'Échec')
  } finally {
    busy.value.delete(item.section_id)
    busy.value = new Set(busy.value)
  }
}

async function applyAll() {
  const ok = await confirm({
    title: `Appliquer ${updates.value.length} mise(s) à jour ?`,
    message: 'Le contenu actuel des sections n\'est pas modifié — seul le pointeur de version est synchronisé.',
    confirmLabel: 'Appliquer',
  })
  if (!ok) return
  for (const u of [...updates.value]) await apply(u)
  showModal.value = false
}

watch(() => props.afId, refresh, { immediate: true })
defineExpose({ refresh })
</script>

<template>
  <div v-if="updates.length > 0" class="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 flex items-center justify-between gap-3">
    <div class="flex items-center gap-2 min-w-0">
      <ArrowPathIcon class="w-4 h-4 text-amber-700 shrink-0" />
      <p class="text-xs text-amber-900 truncate">
        <span class="font-semibold">{{ updates.length }} {{ updates.length > 1 ? 'éléments' : 'élément' }}</span>
        de la bibliothèque {{ updates.length > 1 ? 'ont évolué' : 'a évolué' }}
        <span v-if="sourcesSummary" class="text-amber-700">· {{ sourcesSummary }}</span>
      </p>
    </div>
    <button
      @click="showModal = true"
      class="text-xs font-medium text-amber-900 hover:text-amber-950 underline underline-offset-2 shrink-0"
    >
      Voir les modifications
    </button>
  </div>

  <BaseModal v-if="showModal" title="Mises à jour de la bibliothèque" size="lg" @close="showModal = false">
    <div class="space-y-3 max-h-[65vh] overflow-y-auto">
      <p class="text-xs text-gray-500">
        La bibliothèque a évolué depuis que ces sections ont été créées ou synchronisées la dernière fois.
        <strong>Pour les équipements</strong>, appliquer sert à acquitter — le contenu est résolu dynamiquement.
        <strong>Pour les sections narratives et les fonctionnalités</strong>, appliquer remplace le contenu
        local de la section par le nouveau texte canonique du template.
      </p>

      <div v-for="item in updates" :key="item.section_id" class="border border-gray-200 rounded-lg">
        <div class="px-4 py-3 flex items-center justify-between gap-3 bg-gray-50">
          <button @click="toggle(item.section_id)" class="flex items-center gap-2 min-w-0 text-left">
            <ChevronRightIcon :class="['w-4 h-4 text-gray-400 transition-transform', expanded.has(item.section_id) && 'rotate-90']" />
            <div class="min-w-0">
              <p class="text-sm font-semibold text-gray-800 truncate">
                <span :class="['inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider mr-1.5 align-middle', sourceClass(item.source)]">
                  {{ sourceLabel(item.source) }}
                </span>
                <span class="text-gray-400 font-mono mr-1">{{ item.section_number || '?' }}</span>
                {{ item.section_title }}
              </p>
              <p class="text-[11px] text-gray-500 mt-0.5">
                Template <span class="font-medium">{{ item.template_name }}</span>
                <span class="ml-2 inline-flex items-center gap-1">
                  v{{ item.from_version || 0 }}
                  <ArrowsRightLeftIcon class="w-3 h-3" />
                  v{{ item.to_version }}
                </span>
                <span v-if="item.total_changes" class="ml-2 text-amber-700">· {{ item.total_changes }} changement{{ item.total_changes > 1 ? 's' : '' }}</span>
              </p>
            </div>
          </button>
          <div class="flex items-center gap-2 shrink-0">
            <button
              @click="dismiss(item)"
              :disabled="busy.has(item.section_id)"
              class="px-2 py-1 text-[11px] text-gray-500 hover:text-gray-800 disabled:opacity-50"
              title="Acquitter sans changer le contenu local"
            >
              <XMarkIcon class="w-3.5 h-3.5 inline" /> Garder ma version
            </button>
            <button
              @click="apply(item)"
              :disabled="busy.has(item.section_id)"
              class="px-3 py-1 text-[11px] bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-1"
            >
              <CheckIcon class="w-3.5 h-3.5" /> Appliquer
            </button>
          </div>
        </div>

        <div v-if="expanded.has(item.section_id)" class="px-4 py-3 text-xs space-y-2">
          <!-- Diff equipement (points read/write) -->
          <template v-if="item.source === 'equipment' || !item.source">
            <div v-if="item.added?.length">
              <p class="font-semibold text-emerald-700 mb-1">+ {{ item.added.length }} point{{ item.added.length > 1 ? 's' : '' }} ajouté{{ item.added.length > 1 ? 's' : '' }}</p>
              <ul class="space-y-0.5 ml-3">
                <li v-for="p in item.added" :key="'a-'+p.slug" class="text-gray-700">
                  <span class="text-emerald-700">+</span> {{ p.label }}
                  <span class="text-gray-400">({{ p.data_type }} · {{ p.direction === 'read' ? 'lecture' : 'écriture' }}<span v-if="p.unit"> · {{ p.unit }}</span>)</span>
                </li>
              </ul>
            </div>
            <div v-if="item.removed?.length">
              <p class="font-semibold text-red-700 mb-1">− {{ item.removed.length }} point{{ item.removed.length > 1 ? 's' : '' }} retiré{{ item.removed.length > 1 ? 's' : '' }}</p>
              <ul class="space-y-0.5 ml-3">
                <li v-for="p in item.removed" :key="'r-'+p.slug" class="text-gray-700">
                  <span class="text-red-700">−</span> {{ p.label }}
                  <span class="text-gray-400">({{ p.data_type }})</span>
                </li>
              </ul>
            </div>
            <div v-if="item.modified?.length">
              <p class="font-semibold text-amber-700 mb-1">~ {{ item.modified.length }} point{{ item.modified.length > 1 ? 's' : '' }} modifié{{ item.modified.length > 1 ? 's' : '' }}</p>
              <ul class="space-y-0.5 ml-3">
                <li v-for="p in item.modified" :key="'m-'+p.slug" class="text-gray-700">
                  <span class="text-amber-700">~</span> {{ p.label }}
                  <span class="text-gray-400 ml-1">
                    ({{ Object.entries(p.changes).map(([k, v]) => `${k}: ${v.from || '∅'} → ${v.to || '∅'}`).join(', ') }})
                  </span>
                </li>
              </ul>
            </div>
            <div v-if="item.description_changed" class="text-gray-700">
              <p class="font-semibold text-blue-700">~ Description fonctionnelle modifiée</p>
            </div>
          </template>

          <!-- Diff section narrative / fonctionnalite -->
          <template v-else>
            <div v-if="item.body_changed" class="text-gray-700">
              <p class="font-semibold text-amber-700 mb-1">~ Texte canonique modifié</p>
              <p class="text-gray-500 text-[11px] leading-relaxed">
                Le contenu rédigé du template a évolué.
                Cliquer <strong>Appliquer</strong> remplacera le contenu local de cette section
                par le nouveau texte canonique. Tes éventuelles modifications locales seront perdues —
                clique <strong>Garder ma version</strong> pour conserver ton texte actuel.
              </p>
            </div>
            <div v-else class="text-gray-500 text-[11px]">
              Mise à jour de version sans changement de contenu (synchronisation cosmétique).
            </div>
          </template>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-between items-center w-full">
        <p class="text-[11px] text-gray-500">
          Appliquer = acquitter ; le contenu de la section est déjà à jour automatiquement.
        </p>
        <div class="flex items-center gap-2">
          <button @click="showModal = false" class="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">
            Fermer
          </button>
          <button
            v-if="updates.length > 1"
            @click="applyAll"
            class="px-3 py-1.5 text-xs bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Tout appliquer
          </button>
        </div>
      </div>
    </template>
  </BaseModal>
</template>
