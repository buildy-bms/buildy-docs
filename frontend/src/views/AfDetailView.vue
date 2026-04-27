<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getAf, listSections, getSection } from '@/api'
import CycleBandeau from '@/components/CycleBandeau.vue'
import SectionTree from '@/components/editor/SectionTree.vue'
import SectionEditor from '@/components/editor/SectionEditor.vue'
import PointsTable from '@/components/editor/PointsTable.vue'
import EquipmentInstancesTable from '@/components/editor/EquipmentInstancesTable.vue'
import AttachmentsGrid from '@/components/editor/AttachmentsGrid.vue'

const route = useRoute()
const router = useRouter()
const af = ref(null)
const sections = ref([])
const selectedSection = ref(null)
const selectedId = ref(null)
const loading = ref(true)

const sectionsCountByKind = computed(() => {
  const c = { standard: 0, equipment: 0, hyperveez_page: 0, synthesis: 0 }
  for (const s of sections.value) c[s.kind] = (c[s.kind] || 0) + 1
  return c
})

async function refreshAf() {
  af.value = (await getAf(route.params.id)).data
}

async function refreshSections() {
  sections.value = (await listSections(route.params.id)).data
  // Si rien de sélectionné encore, prendre la 1ère section root
  if (!selectedId.value && sections.value.length) {
    selectSection(sections.value[0].id)
  }
}

async function selectSection(id) {
  selectedId.value = id
  const { data } = await getSection(id)
  selectedSection.value = data
}

function onSectionUpdated(updated) {
  // Mettre à jour la liste plate (titre, body_html, service_level, etc.)
  const idx = sections.value.findIndex(s => s.id === updated.id)
  if (idx !== -1) {
    sections.value[idx] = { ...sections.value[idx], ...updated }
  }
  // Garder selectedSection en sync
  if (selectedSection.value?.id === updated.id) {
    selectedSection.value = { ...selectedSection.value, ...updated }
  }
}

function onAfUpdated(updated) {
  af.value = { ...af.value, ...updated }
}

onMounted(async () => {
  loading.value = true
  try {
    await Promise.all([refreshAf(), refreshSections()])
  } finally {
    loading.value = false
  }
})

watch(() => route.params.id, async () => {
  selectedId.value = null
  selectedSection.value = null
  loading.value = true
  try {
    await Promise.all([refreshAf(), refreshSections()])
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div v-if="loading" class="text-center py-12 text-gray-400 text-sm">Chargement…</div>

  <div v-else-if="af" class="-mx-5 lg:-mx-6 -mt-4 lg:-mt-5 h-[calc(100vh-1rem)] flex flex-col">
    <!-- Bandeau cycle de vie (en haut, full-width) -->
    <div class="px-5 lg:px-6 pt-4">
      <CycleBandeau :af="af" @updated="onAfUpdated" @back="router.push('/')" />
    </div>

    <!-- Layout split : arbre 320px + éditeur flex -->
    <div class="flex-1 min-h-0 flex gap-4 px-5 lg:px-6 pb-4">
      <!-- Sidebar arbre des sections -->
      <aside class="w-80 shrink-0 bg-white rounded-none border border-gray-200 overflow-y-auto">
        <div class="px-4 py-3 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Sections ({{ sections.length }})
          </h3>
          <p class="text-[11px] text-gray-400 mt-0.5">
            {{ sectionsCountByKind.standard }} texte ·
            {{ sectionsCountByKind.equipment }} équip. ·
            {{ sectionsCountByKind.hyperveez_page }} Hyperveez ·
            {{ sectionsCountByKind.synthesis }} synth.
          </p>
        </div>
        <div class="p-2">
          <SectionTree :sections="sections" :selected-id="selectedId" @select="selectSection" />
        </div>
      </aside>

      <!-- Éditeur principal (scrollable) -->
      <div class="flex-1 min-w-0 overflow-y-auto pr-1 space-y-4">
        <template v-if="selectedSection">
          <SectionEditor
            :key="selectedSection.id"
            :section="selectedSection"
            @updated="onSectionUpdated"
          />

          <!-- Pour kind='equipment' : tableaux points + instances -->
          <template v-if="selectedSection.kind === 'equipment'">
            <PointsTable :section-id="selectedSection.id" />
            <EquipmentInstancesTable :section-id="selectedSection.id" />
          </template>

          <!-- Pour kind='hyperveez_page' : info de la page Hyperveez -->
          <div v-if="selectedSection.kind === 'hyperveez_page' && selectedSection.hyperveez_page_slug" class="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
            <p class="font-semibold mb-1">📖 Page Hyperveez : <code class="bg-blue-100 px-1.5 py-0.5 rounded text-xs">{{ selectedSection.hyperveez_page_slug }}</code></p>
            <p class="text-xs text-blue-800">
              Cette section décrit une page réelle de l'UI Hyperveez. La description est pré-remplie depuis le code Hyperveez.
              Tu peux la peaufiner pour le contexte du projet.
            </p>
          </div>

          <!-- Pour kind='synthesis' : note auto-generation -->
          <div v-if="selectedSection.kind === 'synthesis'" class="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
            <p class="font-semibold mb-1">📊 Tableau de synthèse</p>
            <p class="text-xs text-amber-800">
              Ce tableau matriciel sera auto-généré à l'export PDF (Lot 6) depuis le contenu des chapitres précédents.
              Tu peux ajuster la note d'introduction si besoin.
            </p>
          </div>

          <!-- Captures (toutes sections sauf synthesis qui est auto-généré) -->
          <AttachmentsGrid
            v-if="selectedSection.kind !== 'synthesis'"
            :section-id="selectedSection.id"
            :af-id="af.id"
          />
        </template>
        <div v-else class="bg-white rounded-none border border-gray-200 p-12 text-center text-sm text-gray-400">
          Sélectionne une section dans l'arbre à gauche pour commencer.
        </div>
      </div>
    </div>
  </div>
</template>
