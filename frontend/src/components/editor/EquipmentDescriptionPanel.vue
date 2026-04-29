<script setup>
/**
 * Affiche la description fonctionnelle rédigée dans le template équipement.
 * Cette description provient de la bibliothèque (equipment_templates.description_html)
 * et apparaît AUSSI dans le PDF AF (via _section.hbs).
 *
 * Pour V1 : lecture seule dans l'éditeur AF avec lien "Éditer dans la bibliothèque".
 * Tout commentaire spécifique au projet va dans le body Tiptap de la section, pas ici.
 */
import { ref, watch } from 'vue'
import { PencilSquareIcon, ArrowTopRightOnSquareIcon } from '@heroicons/vue/24/outline'
import { useRouter } from 'vue-router'
import { getEquipmentTemplate } from '@/api'

const props = defineProps({
  templateId: { type: Number, required: true },
})
const router = useRouter()
const template = ref(null)

async function refresh() {
  if (!props.templateId) { template.value = null; return }
  try {
    const { data } = await getEquipmentTemplate(props.templateId)
    template.value = data
  } catch { template.value = null }
}

watch(() => props.templateId, refresh, { immediate: true })

function openInLibrary() {
  router.push({ path: '/library/equipments', query: { open: template.value.slug } })
}
</script>

<template>
  <div v-if="template" class="bg-white border border-gray-200 rounded-lg">
    <div class="flex items-center justify-between px-5 py-2 border-b border-gray-100 bg-gray-50">
      <p class="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
        Description fonctionnelle de l'équipement <span class="text-gray-400 normal-case font-normal">(héritée de la bibliothèque)</span>
      </p>
      <button @click="openInLibrary" class="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-800">
        <PencilSquareIcon class="w-3 h-3" /> Éditer dans la bibliothèque
        <ArrowTopRightOnSquareIcon class="w-3 h-3" />
      </button>
    </div>
    <div v-if="template.description_html" v-html="template.description_html" class="prose prose-sm max-w-none p-5 text-gray-700 equipment-desc"></div>
    <div v-else class="p-5 text-sm text-gray-400 italic">
      Pas encore de description rédigée pour ce template équipement. Cliquez « Éditer dans la bibliothèque » pour la rédiger.
    </div>
  </div>
</template>

<style scoped>
.equipment-desc :deep(p) { margin: 0 0 1rem; line-height: 1.65; }
.equipment-desc :deep(p:last-child) { margin-bottom: 0; }
.equipment-desc :deep(ul), .equipment-desc :deep(ol) { padding-left: 1.4rem; margin: 0.75rem 0 1rem; list-style-position: outside; }
.equipment-desc :deep(ul) { list-style-type: disc; }
.equipment-desc :deep(ol) { list-style-type: decimal; }
.equipment-desc :deep(li) { margin: 0.4rem 0; line-height: 1.55; }
.equipment-desc :deep(strong) { color: #1f2937; font-weight: 500; }
</style>
