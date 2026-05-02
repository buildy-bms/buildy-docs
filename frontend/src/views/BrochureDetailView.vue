<script setup>
/**
 * Composition de brochure (commerciale ou catalogue d'offres) — Lot A3.
 *
 * Layout 2 colonnes :
 *  - Catalogue gauche : items réutilisables (presentation Buildy, niveaux
 *    d'offre E/S/P, CGV, etc.) + équipements + pages Hyperveez + custom
 *  - Composition centrale : items déjà ajoutés à cette brochure, dans
 *    l'ordre de l'export PDF.
 *
 * Réordonnancement par boutons ↑↓ (le drag-drop sortablejs sera ajoute
 * plus tard si besoin).
 *
 * Override par item : titre + body_html éditables via Tiptap, conserve
 * les valeurs par défaut de la bibliothèque pour les autres brochures.
 */
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  PlusIcon, TrashIcon, ArrowUpIcon, ArrowDownIcon, ArrowLeftIcon,
  PencilSquareIcon, BookOpenIcon, RectangleStackIcon, DocumentTextIcon,
} from '@heroicons/vue/24/outline'
import {
  getAf, updateAf,
  listBrochureLibrary, listBrochureItems, createBrochureItem,
  updateBrochureItem, deleteBrochureItem, updateBrochureLayout,
  listEquipmentTemplates,
} from '@/api'
import RichTextEditor from '@/components/RichTextEditor.vue'
import RelatedSiteDocsPanel from '@/components/RelatedSiteDocsPanel.vue'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'

const route = useRoute()
const router = useRouter()
const { success, error } = useNotification()
const { confirm } = useConfirm()

const brochureId = computed(() => parseInt(route.params.id, 10))

const brochure = ref(null)
const items = ref([])
const library = ref([])
const equipmentTemplates = ref([])
const loading = ref(true)
const filterKind = ref('all') // catalog filter
const expandedItem = ref(null) // id de l'item depliable pour edition

const filteredLibrary = computed(() => {
  if (filterKind.value === 'all') return library.value
  return library.value.filter(i => i.item_kind === filterKind.value)
})

async function load() {
  loading.value = true
  try {
    const [{ data: af }, { data: itm }, { data: lib }, { data: tpl }] = await Promise.all([
      getAf(brochureId.value),
      listBrochureItems(brochureId.value),
      listBrochureLibrary(),
      listEquipmentTemplates(),
    ])
    brochure.value = af
    items.value = itm
    library.value = lib
    equipmentTemplates.value = tpl
  } catch (e) {
    error('Chargement impossible')
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(brochureId, load)

const layout = computed({
  get: () => brochure.value?.layout_template || 'commercial-brochure',
  set: async (v) => {
    try {
      await updateBrochureLayout(brochureId.value, v)
      brochure.value.layout_template = v
    } catch (e) { error('Layout non sauvegardé') }
  },
})

async function addLibItem(libItem) {
  try {
    const data = (await createBrochureItem(brochureId.value, {
      item_kind: libItem.item_kind === 'company' || libItem.item_kind === 'feature' || libItem.item_kind === 'offering_level' ? 'feature' : libItem.item_kind,
      source_id: libItem.id,
    })).data
    items.value.push(data)
    success(`« ${libItem.title} » ajouté à la brochure`)
  } catch (e) {
    error(e.response?.data?.detail || 'Ajout impossible')
  }
}

async function addEquipmentTemplate(tpl) {
  try {
    const data = (await createBrochureItem(brochureId.value, {
      item_kind: 'equipment_template',
      source_id: tpl.id,
      title: tpl.name,
      body_html: tpl.description_html || '',
    })).data
    items.value.push(data)
    success(`« ${tpl.name} » ajouté`)
  } catch (e) {
    error(e.response?.data?.detail || 'Ajout impossible')
  }
}

async function addCustomItem() {
  try {
    const data = (await createBrochureItem(brochureId.value, {
      item_kind: 'custom',
      title: 'Section libre',
      body_html: '<p>À rédiger…</p>',
    })).data
    items.value.push(data)
    expandedItem.value = data.id
    success('Section libre ajoutée')
  } catch (e) {
    error('Ajout impossible')
  }
}

const saveTimers = new Map()
function scheduleSave(item, patch) {
  Object.assign(item, patch)
  clearTimeout(saveTimers.get(item.id))
  saveTimers.set(item.id, setTimeout(async () => {
    try {
      await updateBrochureItem(item.id, patch)
    } catch (e) {
      error('Sauvegarde impossible')
    }
  }, 500))
}

async function removeItem(item) {
  const ok = await confirm({
    title: 'Retirer cet item de la brochure ?',
    message: item.override_title || item.title || 'Section sans titre',
    confirmLabel: 'Retirer',
    danger: true,
  })
  if (!ok) return
  try {
    await deleteBrochureItem(item.id)
    items.value = items.value.filter(i => i.id !== item.id)
    success('Item retiré')
  } catch (e) {
    error('Suppression impossible')
  }
}

async function move(item, direction) {
  const sorted = [...items.value].sort((a, b) => a.position - b.position)
  const idx = sorted.findIndex(i => i.id === item.id)
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1
  if (targetIdx < 0 || targetIdx >= sorted.length) return
  const other = sorted[targetIdx]
  const aPos = item.position, bPos = other.position
  try {
    await Promise.all([
      updateBrochureItem(item.id, { position: bPos }),
      updateBrochureItem(other.id, { position: aPos }),
    ])
    item.position = bPos
    other.position = aPos
  } catch (e) {
    error('Réordonnancement impossible')
  }
}

const sortedItems = computed(() => [...items.value].sort((a, b) => a.position - b.position))

function effectiveTitle(item) {
  return item.override_title || item.title || '(sans titre)'
}
function effectiveBody(item) {
  return item.override_html || item.body_html || ''
}

const KIND_LABELS = {
  feature: 'Présentation',
  offering_level: 'Niveau d\'offre',
  company: 'Entreprise',
  cgv: 'Conditions',
  equipment_template: 'Équipement',
  hyperveez_page: 'Hyperveez',
  custom: 'Section libre',
}
const KIND_COLORS = {
  feature: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  offering_level: 'bg-violet-50 text-violet-700 border-violet-200',
  company: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cgv: 'bg-gray-50 text-gray-700 border-gray-200',
  equipment_template: 'bg-orange-50 text-orange-700 border-orange-200',
  hyperveez_page: 'bg-blue-50 text-blue-700 border-blue-200',
  custom: 'bg-amber-50 text-amber-700 border-amber-200',
}

function isInBrochure(libItem) {
  return items.value.some(i => i.source_id === libItem.id);
}
</script>

<template>
  <div v-if="loading" class="text-center py-12 text-gray-400 text-sm">Chargement…</div>

  <div v-else-if="brochure" class="-mx-5 lg:-mx-6 -mt-4 lg:-mt-5 h-[calc(100vh-1rem)] flex flex-col">
    <!-- Header brochure -->
    <header class="bg-white border-b border-gray-200 px-5 lg:px-6 py-3 flex items-center gap-3">
      <button @click="router.push('/')" class="p-1 -ml-1 text-gray-500 hover:text-gray-800">
        <ArrowLeftIcon class="w-4 h-4" />
      </button>
      <div class="flex-1 min-w-0">
        <h2 class="text-sm font-semibold text-gray-800 truncate flex items-center gap-2">
          <BookOpenIcon class="w-4 h-4 text-violet-600" />
          {{ brochure.client_name }}
          <span v-if="brochure.project_name" class="text-gray-500">— {{ brochure.project_name }}</span>
        </h2>
        <p class="text-[11px] text-gray-500">
          {{ items.length }} item{{ items.length > 1 ? 's' : '' }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <label class="text-xs text-gray-500">Variante</label>
        <select v-model="layout"
                class="text-xs px-2 py-1 border border-gray-200 rounded-lg bg-white">
          <option value="commercial-brochure">Brochure commerciale</option>
          <option value="offering-catalog">Catalogue d'offres</option>
        </select>
      </div>
    </header>

    <!-- Layout 2 colonnes -->
    <div class="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 px-5 lg:px-6 py-4">
      <!-- Catalogue gauche -->
      <aside class="bg-white rounded-lg border border-gray-200 overflow-y-auto flex flex-col">
        <header class="px-4 py-3 border-b border-gray-100 sticky top-0 bg-white z-10 space-y-2">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500">Catalogue</h3>
          <div class="flex flex-wrap gap-1">
            <button v-for="opt in [
              { v: 'all', l: 'Tout' },
              { v: 'feature', l: 'Présentations' },
              { v: 'offering_level', l: 'Niveaux' },
              { v: 'company', l: 'Buildy' },
              { v: 'cgv', l: 'CGV' },
            ]" :key="opt.v"
                    @click="filterKind = opt.v"
                    :class="['text-[10px] px-2 py-0.5 rounded-md border',
                      filterKind === opt.v ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                           : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50']">
              {{ opt.l }}
            </button>
          </div>
        </header>

        <div class="p-3 space-y-2">
          <div v-for="lib in filteredLibrary" :key="lib.id"
               :class="['p-2.5 rounded-lg border transition cursor-pointer text-xs',
                 isInBrochure(lib) ? 'bg-emerald-50 border-emerald-200'
                                   : 'bg-white border-gray-200 hover:bg-gray-50']"
               @click="!isInBrochure(lib) && addLibItem(lib)">
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5 mb-1">
                  <span :class="['inline-block px-1.5 py-0 text-[9px] rounded border', KIND_COLORS[lib.item_kind]]">
                    {{ KIND_LABELS[lib.item_kind] || lib.item_kind }}
                  </span>
                  <span v-if="lib.service_level" class="text-[9px] font-mono text-violet-600">
                    [{{ lib.service_level }}]
                  </span>
                </div>
                <div class="font-medium text-gray-800 truncate">{{ lib.title }}</div>
                <div v-if="lib.summary" class="text-[10px] text-gray-500 line-clamp-2">{{ lib.summary }}</div>
              </div>
              <PlusIcon v-if="!isInBrochure(lib)" class="w-4 h-4 text-indigo-500 shrink-0" />
              <span v-else class="text-[10px] text-emerald-600 font-medium">✓</span>
            </div>
          </div>
          <div v-if="!filteredLibrary.length" class="text-center text-xs text-gray-400 italic py-6">
            Aucun item dans cette catégorie.
          </div>
        </div>

        <!-- Section libre -->
        <div class="border-t border-gray-100 p-3">
          <button @click="addCustomItem" class="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100">
            <PlusIcon class="w-3.5 h-3.5" /> Section libre rédigée à la main
          </button>
        </div>

        <!-- Documents lies sur ce site (Lot A4) -->
        <div v-if="brochure?.site_id" class="border-t border-gray-100 p-3">
          <RelatedSiteDocsPanel :site-id="brochure.site_id" :exclude-id="brochure.id" />
        </div>
      </aside>

      <!-- Composition centrale -->
      <main class="bg-white rounded-lg border border-gray-200 overflow-y-auto flex flex-col">
        <header class="px-5 py-3 border-b border-gray-200 sticky top-0 bg-white z-10">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Composition de la brochure
          </h3>
          <p class="text-[11px] text-gray-500 mt-0.5">
            Ordre des items dans le PDF final. Clique sur un item pour personnaliser titre + contenu pour ce client.
          </p>
        </header>

        <div v-if="!sortedItems.length" class="p-12 text-center">
          <div class="max-w-md mx-auto space-y-3">
            <RectangleStackIcon class="w-12 h-12 text-gray-300 mx-auto" />
            <p class="text-sm font-medium text-gray-700">La brochure est vide</p>
            <p class="text-xs text-gray-500">
              Pioche dans le catalogue à gauche pour ajouter des items, ou crée
              une section libre pour rédiger un contenu propre à ce client.
            </p>
          </div>
        </div>

        <div v-else class="divide-y divide-gray-100">
          <div v-for="(item, idx) in sortedItems" :key="item.id" class="group">
            <div class="px-5 py-3 flex items-start gap-3">
              <span class="font-mono text-xs text-gray-400 mt-1 w-6 text-right shrink-0">{{ idx + 1 }}</span>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span :class="['inline-block px-1.5 py-0 text-[10px] rounded border', KIND_COLORS[item.item_kind]]">
                    {{ KIND_LABELS[item.item_kind] || item.item_kind }}
                  </span>
                  <span v-if="item.override_title || item.override_html" class="text-[10px] text-violet-600 font-mono">
                    [override]
                  </span>
                </div>
                <button @click="expandedItem = expandedItem === item.id ? null : item.id"
                        class="text-left text-sm font-medium text-gray-800 hover:text-indigo-700">
                  {{ effectiveTitle(item) }}
                </button>
                <div v-if="effectiveBody(item) && expandedItem !== item.id"
                     class="text-[11px] text-gray-500 mt-0.5 line-clamp-2"
                     v-html="effectiveBody(item).replace(/<[^>]+>/g, ' ')" />
              </div>
              <div class="flex flex-col gap-1 shrink-0">
                <button @click="move(item, 'up')" :disabled="idx === 0"
                        class="p-1 text-gray-400 hover:text-indigo-600 disabled:opacity-30">
                  <ArrowUpIcon class="w-4 h-4" />
                </button>
                <button @click="move(item, 'down')" :disabled="idx === sortedItems.length - 1"
                        class="p-1 text-gray-400 hover:text-indigo-600 disabled:opacity-30">
                  <ArrowDownIcon class="w-4 h-4" />
                </button>
                <button @click="expandedItem = expandedItem === item.id ? null : item.id"
                        class="p-1 text-gray-400 hover:text-indigo-600"
                        title="Modifier le titre / le contenu pour ce client">
                  <PencilSquareIcon class="w-4 h-4" />
                </button>
                <button @click="removeItem(item)" class="p-1 text-gray-400 hover:text-red-600">
                  <TrashIcon class="w-4 h-4" />
                </button>
              </div>
            </div>

            <!-- Editeur deplie pour override -->
            <div v-if="expandedItem === item.id" class="px-5 pb-4 ml-9 space-y-2 bg-gray-50/50">
              <p class="text-[11px] text-gray-500 italic">
                Personnalise titre + contenu uniquement pour ce client. La bibliothèque reste inchangée.
              </p>
              <input type="text"
                     :value="item.override_title || item.title"
                     @input="e => scheduleSave(item, { override_title: e.target.value || null })"
                     :placeholder="item.title || 'Titre'"
                     class="w-full px-3 py-2 text-sm font-medium text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500" />
              <RichTextEditor
                :model-value="item.override_html ?? item.body_html ?? ''"
                @update:model-value="v => scheduleSave(item, { override_html: v })"
                min-height="160px" />
              <div v-if="item.override_title || item.override_html" class="flex justify-end">
                <button @click="scheduleSave(item, { override_title: null, override_html: null })"
                        class="text-[11px] text-gray-500 hover:text-red-600">
                  Réinitialiser à la version bibliothèque
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>
