<script setup>
import { ref, watch, computed } from 'vue'
import { ArrowPathIcon, XMarkIcon, CheckIcon, ChevronRightIcon, ArrowsRightLeftIcon } from '@heroicons/vue/24/outline'
import { getAfTemplateUpdates, applySectionTemplateUpdate, dismissSectionTemplateUpdate } from '@/api'
import { useNotification } from '@/composables/useNotification'
import BaseModal from '@/components/BaseModal.vue'

const props = defineProps({
  afId: { type: Number, required: true },
})
const emit = defineEmits(['updated'])

const { success: notifySuccess, error: notifyError } = useNotification()

const updates = ref([])
const loading = ref(false)
const showModal = ref(false)
const expanded = ref(new Set())
const busy = ref(new Set())

const totalChanges = computed(() => updates.value.reduce((acc, u) => acc + (u.total_changes || 0), 0))

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
  if (!confirm(`Appliquer les ${updates.value.length} mises à jour ? Le contenu actuel des sections n'est pas modifié — seul le pointeur de version est synchronisé.`)) return
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
        <span class="font-semibold">{{ updates.length }} template{{ updates.length > 1 ? 's' : '' }}</span>
        de la bibliothèque {{ updates.length > 1 ? 'ont évolué' : 'a évolué' }}
        <span class="text-amber-700">· {{ totalChanges }} changement{{ totalChanges > 1 ? 's' : '' }} au total</span>
      </p>
    </div>
    <button
      @click="showModal = true"
      class="text-xs font-medium text-amber-900 hover:text-amber-950 underline underline-offset-2 shrink-0"
    >
      Voir les modifications
    </button>
  </div>

  <BaseModal v-if="showModal" title="Mises à jour des templates équipement" size="lg" @close="showModal = false">
    <div class="space-y-3 max-h-[65vh] overflow-y-auto">
      <p class="text-xs text-gray-500">
        La bibliothèque a évolué depuis que ces sections ont été créées ou synchronisées la dernière fois.
        Le contenu affiché dans l'éditeur reflète déjà la version actuelle ; appliquer sert à acquitter
        explicitement la mise à jour pour cette section.
      </p>

      <div v-for="item in updates" :key="item.section_id" class="border border-gray-200 rounded-lg">
        <div class="px-4 py-3 flex items-center justify-between gap-3 bg-gray-50">
          <button @click="toggle(item.section_id)" class="flex items-center gap-2 min-w-0 text-left">
            <ChevronRightIcon :class="['w-4 h-4 text-gray-400 transition-transform', expanded.has(item.section_id) && 'rotate-90']" />
            <div class="min-w-0">
              <p class="text-sm font-semibold text-gray-800 truncate">
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
                <span class="ml-2 text-amber-700">· {{ item.total_changes }} changement{{ item.total_changes > 1 ? 's' : '' }}</span>
              </p>
            </div>
          </button>
          <div class="flex items-center gap-2 shrink-0">
            <button
              @click="dismiss(item)"
              :disabled="busy.has(item.section_id)"
              class="px-2 py-1 text-[11px] text-gray-500 hover:text-gray-800 disabled:opacity-50"
              title="Acquitter sans rien changer"
            >
              <XMarkIcon class="w-3.5 h-3.5 inline" /> Reporter
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
          <div v-if="item.added.length" class="">
            <p class="font-semibold text-emerald-700 mb-1">+ {{ item.added.length }} point{{ item.added.length > 1 ? 's' : '' }} ajouté{{ item.added.length > 1 ? 's' : '' }}</p>
            <ul class="space-y-0.5 ml-3">
              <li v-for="p in item.added" :key="'a-'+p.slug" class="text-gray-700">
                <span class="text-emerald-700">+</span> {{ p.label }}
                <span class="text-gray-400">({{ p.data_type }} · {{ p.direction === 'read' ? 'lecture' : 'écriture' }}<span v-if="p.unit"> · {{ p.unit }}</span>)</span>
              </li>
            </ul>
          </div>
          <div v-if="item.removed.length">
            <p class="font-semibold text-red-700 mb-1">− {{ item.removed.length }} point{{ item.removed.length > 1 ? 's' : '' }} retiré{{ item.removed.length > 1 ? 's' : '' }}</p>
            <ul class="space-y-0.5 ml-3">
              <li v-for="p in item.removed" :key="'r-'+p.slug" class="text-gray-700">
                <span class="text-red-700">−</span> {{ p.label }}
                <span class="text-gray-400">({{ p.data_type }})</span>
              </li>
            </ul>
          </div>
          <div v-if="item.modified.length">
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
