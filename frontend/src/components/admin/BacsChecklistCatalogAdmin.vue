<script setup>
/**
 * CRUD du catalogue d'items de check-list documentaire (mig 100,
 * table `bacs_checklist_catalog`). Affiché en onglet de la page
 * /admin/bacs-parameters. Routes API existantes :
 *   GET    /api/bacs-checklist-catalog?include_inactive=1
 *   POST   /api/bacs-checklist-catalog
 *   PATCH  /api/bacs-checklist-catalog/:key
 *   DELETE /api/bacs-checklist-catalog/:key
 *   PATCH  /api/bacs-checklist-catalog/reorder { keys: [...] }
 *
 * Drag & drop SortableJS sur le tbody pour réordonner. Les items
 * désactivés restent visibles (opacity-50) ; un item désactivé n'est
 * plus injecté dans les nouveaux audits mais l'historique des audits
 * existants qui le référencent est préservé.
 */
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import Sortable from 'sortablejs'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import {
  PlusIcon, PencilSquareIcon, TrashIcon, Bars3Icon,
  EyeIcon, EyeSlashIcon,
} from '@heroicons/vue/24/outline'
import {
  listChecklistCatalog, createChecklistCatalogItem,
  updateChecklistCatalogItem, deleteChecklistCatalogItem,
  reorderChecklistCatalog,
} from '@/api'
import BaseModal from '@/components/BaseModal.vue'
import FaIconPicker from '@/components/FaIconPicker.vue'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'

const { success, error } = useNotification()
const { confirm } = useConfirm()

const items = ref([])
const loading = ref(true)

// FA stocke `fa-xxx` en DB ; FontAwesomeIcon accepte juste le nom.
function faName(value) {
  if (!value) return null
  return value.startsWith('fa-') ? value.slice(3) : value
}

async function load() {
  loading.value = true
  try {
    const { data } = await listChecklistCatalog({ include_inactive: 1 })
    items.value = (data || []).slice().sort((a, b) => a.position - b.position)
  } catch {
    error('Chargement du catalogue impossible')
  } finally {
    loading.value = false
  }
}
onMounted(load)

// Drag & drop sur le tbody.
const tbodyRef = ref(null)
let sortable = null
function teardownSortable() {
  if (sortable) { try { sortable.destroy() } catch { /* ignore */ } sortable = null }
}
function setupSortable() {
  teardownSortable()
  const el = tbodyRef.value
  if (!el) return
  sortable = Sortable.create(el, {
    draggable: 'tr.catalog-row',
    handle: '.drag-handle',
    animation: 150,
    ghostClass: 'sortable-ghost',
    onEnd: async () => {
      const keys = Array.from(el.querySelectorAll('tr.catalog-row'))
        .map(tr => tr.getAttribute('data-key'))
        .filter(Boolean)
      try {
        await reorderChecklistCatalog(keys)
        await load()
      } catch {
        error('Réordonnancement impossible')
        await load()
      }
    },
  })
}
watch(items, async () => { await nextTick(); setupSortable() }, { immediate: true, flush: 'post' })
onBeforeUnmount(teardownSortable)

// ── Édition / création via modale ─────────────────────────────
const editing = ref(null)
const draftLabel = ref('')
const draftDescription = ref('')
const draftIconValue = ref('')
const draftIconColor = ref('#6b7280')
const draftActive = ref(true)
const saving = ref(false)

function openCreate() {
  editing.value = { key: null }
  draftLabel.value = ''
  draftDescription.value = ''
  draftIconValue.value = ''
  draftIconColor.value = '#6b7280'
  draftActive.value = true
}
function openEdit(item) {
  editing.value = { key: item.key }
  draftLabel.value = item.label || ''
  draftDescription.value = item.description || ''
  draftIconValue.value = faName(item.icon_value) || ''
  draftIconColor.value = item.icon_color || '#6b7280'
  draftActive.value = !!item.active
}
function closeEdit() { editing.value = null }

async function saveEdit() {
  if (!draftLabel.value.trim()) return
  saving.value = true
  const payload = {
    label: draftLabel.value.trim(),
    description: draftDescription.value.trim() || null,
    icon_value: draftIconValue.value ? `fa-${draftIconValue.value}` : null,
    icon_color: draftIconColor.value || null,
    active: draftActive.value,
  }
  try {
    if (editing.value.key) {
      await updateChecklistCatalogItem(editing.value.key, payload)
      success('Item mis à jour')
    } else {
      await createChecklistCatalogItem(payload)
      success('Item créé')
    }
    await load()
    closeEdit()
  } catch (e) {
    error(e.response?.data?.detail || 'Sauvegarde impossible')
  } finally {
    saving.value = false
  }
}

async function toggleActive(item) {
  try {
    await updateChecklistCatalogItem(item.key, { active: !item.active })
    item.active = !item.active
  } catch {
    error('Mise à jour impossible')
  }
}

async function removeItem(item) {
  const ok = await confirm({
    title: `Supprimer « ${item.label} » ?`,
    message: 'Les audits existants qui référencent cet item conservent leur état (les lignes orphelines restent en base). À utiliser pour des items qui n\'ont jamais servi.',
    confirmLabel: 'Supprimer',
    danger: true,
  })
  if (!ok) return
  try {
    await deleteChecklistCatalogItem(item.key)
    items.value = items.value.filter(i => i.key !== item.key)
    success('Item supprimé')
  } catch (e) {
    error(e.response?.data?.detail || 'Suppression impossible')
  }
}
</script>

<template>
  <div>
    <header class="mb-3 flex items-start justify-between gap-3">
      <div>
        <h2 class="text-sm font-semibold text-gray-800">📋 Catalogue de la check-list documentaire</h2>
        <p class="text-[12px] text-gray-500 mt-0.5">
          {{ items.length }} item{{ items.length > 1 ? 's' : '' }} ·
          {{ items.filter(i => i.active).length }} actif{{ items.filter(i => i.active).length > 1 ? 's' : '' }}.
          Glisser pour réordonner. Les items désactivés ne sont plus injectés dans les nouveaux audits.
        </p>
      </div>
      <button @click="openCreate" class="btn-primary text-xs px-2.5 py-1.5 whitespace-nowrap">
        <PlusIcon class="w-3.5 h-3.5 shrink-0" /> Ajouter un item
      </button>
    </header>

    <div v-if="loading" class="text-center py-12 text-gray-400 text-sm">Chargement…</div>

    <div v-else class="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <table class="w-full text-sm">
        <thead class="text-xs text-gray-500 font-medium bg-gray-50">
          <tr>
            <th class="w-8"></th>
            <th class="text-center py-2.5 w-16">Icône</th>
            <th class="text-left py-2.5">Libellé</th>
            <th class="text-left py-2.5">Description</th>
            <th class="text-left py-2.5 w-32">Clé technique</th>
            <th class="text-center py-2.5 w-20">Actif</th>
            <th class="text-right px-3 py-2.5 w-24"></th>
          </tr>
        </thead>
        <tbody ref="tbodyRef" class="divide-y divide-gray-100">
          <tr v-for="item in items" :key="item.key"
              :class="['catalog-row group', !item.active ? 'opacity-50' : '']"
              :data-key="item.key">
            <td class="text-center align-middle">
              <button type="button"
                      class="drag-handle inline-flex p-1 text-gray-300 hover:text-gray-600 cursor-grab active:cursor-grabbing"
                      v-tooltip="'Glisser pour réordonner'">
                <Bars3Icon class="w-4 h-4" />
              </button>
            </td>
            <td class="py-2.5 text-center">
              <FontAwesomeIcon v-if="faName(item.icon_value)"
                               :icon="['fas', faName(item.icon_value)]"
                               :style="{ color: item.icon_color || '#6b7280' }"
                               class="text-base" />
              <span v-else class="text-gray-300">—</span>
            </td>
            <td class="py-2.5 font-medium text-gray-800">{{ item.label }}</td>
            <td class="py-2.5 text-gray-600 text-[13px]">
              {{ item.description || '—' }}
            </td>
            <td class="py-2.5 font-mono text-[11px] text-gray-500">{{ item.key }}</td>
            <td class="py-2.5 text-center">
              <button @click="toggleActive(item)"
                      :class="['inline-flex items-center justify-center p-1 rounded transition',
                               item.active ? 'text-emerald-600 hover:bg-emerald-50' : 'text-gray-400 hover:bg-gray-100']"
                      v-tooltip="item.active ? 'Cliquer pour désactiver' : 'Cliquer pour réactiver'">
                <EyeIcon v-if="item.active" class="w-4 h-4" />
                <EyeSlashIcon v-else class="w-4 h-4" />
              </button>
            </td>
            <td class="px-3 py-2.5 text-right whitespace-nowrap">
              <button @click="openEdit(item)"
                      class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-indigo-600 p-1 transition"
                      v-tooltip="'Modifier'">
                <PencilSquareIcon class="w-4 h-4" />
              </button>
              <button @click="removeItem(item)"
                      class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 p-1 transition"
                      v-tooltip="'Supprimer'">
                <TrashIcon class="w-4 h-4" />
              </button>
            </td>
          </tr>
          <tr v-if="!items.length">
            <td colspan="7" class="px-5 py-8 text-center text-xs text-gray-500 italic">
              Aucun item. Ajoute le premier avec le bouton ci-dessus.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modale création / édition -->
    <BaseModal v-if="editing"
               :title="editing.key ? 'Modifier l\'item' : 'Nouvel item de check-list'"
               size="lg"
               :dismiss-on-backdrop="false"
               @close="closeEdit">
      <div class="space-y-4">
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">Libellé</label>
          <input type="text" v-model="draftLabel"
                 placeholder="Ex. : Plan d'adressage IP"
                 class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">Description (optionnelle)</label>
          <textarea v-model="draftDescription" rows="2"
                    placeholder="Aide-mémoire affiché sous le libellé dans la check-list de l'audit."
                    class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 resize-y"></textarea>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-medium text-gray-600 mb-1">Icône FontAwesome</label>
            <FaIconPicker v-model="draftIconValue" />
          </div>
          <div>
            <label class="block text-xs font-medium text-gray-600 mb-1">Couleur icône</label>
            <div class="flex items-center gap-2">
              <input type="color" v-model="draftIconColor"
                     class="h-9 w-12 border border-gray-200 rounded cursor-pointer" />
              <input type="text" v-model="draftIconColor"
                     placeholder="#6b7280"
                     class="flex-1 px-3 py-2 text-sm font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500" />
            </div>
          </div>
        </div>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" v-model="draftActive" class="rounded border-gray-300" />
          <span>Actif (injecté dans les nouveaux audits)</span>
        </label>
      </div>
      <template #footer>
        <button type="button" @click="closeEdit"
                class="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-lg whitespace-nowrap">
          Annuler
        </button>
        <button type="button" @click="saveEdit" :disabled="saving || !draftLabel.trim()"
                class="px-3 py-1.5 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg shadow-sm font-medium disabled:opacity-50 whitespace-nowrap">
          {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
        </button>
      </template>
    </BaseModal>
  </div>
</template>
