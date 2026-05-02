<script setup>
/**
 * Admin du boilerplate des PDFs (Lot B4).
 *
 * Permet d'editer la methodologie (Annexe B) et les disclaimers
 * (Annexe D) du rapport PDF audit BACS sans redeployer le code.
 *
 * Source de verite : table pdf_boilerplate. Lecture par kind, ordre par
 * `position`. Le PDF lit les valeurs courantes a chaque generation.
 */
import { ref, onMounted, computed } from 'vue'
import {
  PlusIcon, TrashIcon, ArrowUpIcon, ArrowDownIcon, EyeSlashIcon, EyeIcon,
} from '@heroicons/vue/24/outline'
import {
  listPdfBoilerplate, createPdfBoilerplate, updatePdfBoilerplate, deletePdfBoilerplate,
} from '@/api'
import RichTextEditor from '@/components/RichTextEditor.vue'
import { useNotification } from '@/composables/useNotification'
import { useConfirm } from '@/composables/useConfirm'

const { success, error } = useNotification()
const { confirm } = useConfirm()

const items = ref([])
const loading = ref(true)

const methodology = computed(() => items.value.filter(i => i.kind === 'methodology'))
const disclaimers = computed(() => items.value.filter(i => i.kind === 'disclaimer'))

async function load() {
  loading.value = true
  try {
    const { data } = await listPdfBoilerplate()
    items.value = data
  } catch (e) {
    error('Chargement impossible')
  } finally {
    loading.value = false
  }
}
onMounted(load)

const saveTimers = new Map()
function scheduleSave(item, patch) {
  Object.assign(item, patch)
  clearTimeout(saveTimers.get(item.id))
  saveTimers.set(item.id, setTimeout(async () => {
    try {
      await updatePdfBoilerplate(item.id, patch)
    } catch (e) {
      error(e.response?.data?.detail || 'Sauvegarde impossible')
    }
  }, 500))
}

async function addItem(kind) {
  try {
    const sameKind = items.value.filter(i => i.kind === kind)
    const nextPos = sameKind.length ? Math.max(...sameKind.map(i => i.position)) + 1 : 0
    const { data } = await createPdfBoilerplate({
      kind,
      position: nextPos,
      title: kind === 'methodology' ? 'Nouveau point' : null,
      body_html: '<p>À rédiger…</p>',
    })
    items.value.push(data)
    success('Section ajoutée')
  } catch (e) {
    error(e.response?.data?.detail || 'Création impossible')
  }
}

async function removeItem(item) {
  const ok = await confirm({
    title: 'Supprimer cette section ?',
    message: item.title || (item.body_html || '').replace(/<[^>]*>/g, '').slice(0, 80) + '…',
    confirmLabel: 'Supprimer',
    danger: true,
  })
  if (!ok) return
  try {
    await deletePdfBoilerplate(item.id)
    items.value = items.value.filter(i => i.id !== item.id)
    success('Section supprimée')
  } catch (e) {
    error('Suppression impossible')
  }
}

async function move(item, direction) {
  const sameKind = items.value
    .filter(i => i.kind === item.kind)
    .sort((a, b) => a.position - b.position)
  const idx = sameKind.findIndex(i => i.id === item.id)
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1
  if (targetIdx < 0 || targetIdx >= sameKind.length) return
  const other = sameKind[targetIdx]
  // Swap des positions
  const aPos = item.position, bPos = other.position
  try {
    await Promise.all([
      updatePdfBoilerplate(item.id, { position: bPos }),
      updatePdfBoilerplate(other.id, { position: aPos }),
    ])
    item.position = bPos
    other.position = aPos
  } catch (e) {
    error('Réordonnancement impossible')
  }
}

async function toggleActive(item) {
  scheduleSave(item, { is_active: !item.is_active })
}
</script>

<template>
  <div class="max-w-5xl mx-auto px-5 lg:px-6 py-6">
    <header class="mb-6">
      <h1 class="text-xl font-semibold text-gray-900">Boilerplate PDF audit BACS</h1>
      <p class="text-sm text-gray-500 mt-1">
        Édite la <strong>méthodologie</strong> (Annexe B) et les
        <strong>disclaimers légaux</strong> (Annexe D) du rapport PDF
        sans redéployer le code. Les modifications s'appliquent
        immédiatement aux prochains exports — les PDFs déjà générés
        ne sont pas affectés (fichiers figés sur disque).
      </p>
    </header>

    <div v-if="loading" class="text-center py-12 text-gray-400 text-sm">Chargement…</div>

    <div v-else class="space-y-8">
      <!-- ── Méthodologie (Annexe B) ── -->
      <section class="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <header class="px-5 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
          <div>
            <h2 class="text-sm font-semibold text-gray-800">📖 Méthodologie — Annexe B</h2>
            <p class="text-[11px] text-gray-500">{{ methodology.length }} point{{ methodology.length > 1 ? 's' : '' }}</p>
          </div>
          <button @click="addItem('methodology')" class="btn-primary text-xs px-2.5 py-1">
            <PlusIcon class="w-3.5 h-3.5" /> Ajouter un point
          </button>
        </header>
        <div class="divide-y divide-gray-100">
          <div v-for="(item, idx) in methodology" :key="item.id"
               :class="['p-4', !item.is_active ? 'opacity-50' : '']">
            <div class="flex items-start gap-3">
              <span class="font-mono text-xs text-gray-400 mt-2 w-6 text-right">{{ idx + 1 }}.</span>
              <div class="flex-1 min-w-0 space-y-2">
                <input type="text"
                       :value="item.title"
                       @input="e => scheduleSave(item, { title: e.target.value })"
                       placeholder="Titre du point méthodologique"
                       class="w-full px-3 py-2 text-sm font-medium text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500" />
                <RichTextEditor
                  :model-value="item.body_html"
                  @update:model-value="v => scheduleSave(item, { body_html: v })"
                  min-height="120px"
                  placeholder="Texte du point méthodologique…"
                />
              </div>
              <div class="flex flex-col gap-1 shrink-0">
                <button @click="move(item, 'up')" :disabled="idx === 0"
                        class="p-1 text-gray-400 hover:text-indigo-600 disabled:opacity-30"
                        title="Monter">
                  <ArrowUpIcon class="w-4 h-4" />
                </button>
                <button @click="move(item, 'down')" :disabled="idx === methodology.length - 1"
                        class="p-1 text-gray-400 hover:text-indigo-600 disabled:opacity-30"
                        title="Descendre">
                  <ArrowDownIcon class="w-4 h-4" />
                </button>
                <button @click="toggleActive(item)"
                        class="p-1 text-gray-400 hover:text-indigo-600"
                        :title="item.is_active ? 'Désactiver (ne plus inclure dans le PDF)' : 'Réactiver'">
                  <EyeSlashIcon v-if="item.is_active" class="w-4 h-4" />
                  <EyeIcon v-else class="w-4 h-4" />
                </button>
                <button @click="removeItem(item)"
                        class="p-1 text-gray-400 hover:text-red-600"
                        title="Supprimer">
                  <TrashIcon class="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
          <div v-if="!methodology.length" class="p-8 text-center text-sm text-gray-500 italic">
            Aucun point méthodologique. Le PDF utilisera le contenu par défaut hardcodé.
          </div>
        </div>
      </section>

      <!-- ── Disclaimers (Annexe D) ── -->
      <section class="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <header class="px-5 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
          <div>
            <h2 class="text-sm font-semibold text-gray-800">⚠️ Disclaimers légaux — Annexe D</h2>
            <p class="text-[11px] text-gray-500">{{ disclaimers.length }} mention{{ disclaimers.length > 1 ? 's' : '' }} · Toute modification doit être relue par un juriste avant déploiement.</p>
          </div>
          <button @click="addItem('disclaimer')" class="btn-primary text-xs px-2.5 py-1">
            <PlusIcon class="w-3.5 h-3.5" /> Ajouter une mention
          </button>
        </header>
        <div class="divide-y divide-gray-100">
          <div v-for="(item, idx) in disclaimers" :key="item.id"
               :class="['p-4', !item.is_active ? 'opacity-50' : '']">
            <div class="flex items-start gap-3">
              <span class="font-mono text-xs text-gray-400 mt-2 w-6 text-right">{{ idx + 1 }}.</span>
              <div class="flex-1 min-w-0">
                <RichTextEditor
                  :model-value="item.body_html"
                  @update:model-value="v => scheduleSave(item, { body_html: v })"
                  min-height="100px"
                  placeholder="Mention légale…"
                />
              </div>
              <div class="flex flex-col gap-1 shrink-0">
                <button @click="move(item, 'up')" :disabled="idx === 0"
                        class="p-1 text-gray-400 hover:text-indigo-600 disabled:opacity-30">
                  <ArrowUpIcon class="w-4 h-4" />
                </button>
                <button @click="move(item, 'down')" :disabled="idx === disclaimers.length - 1"
                        class="p-1 text-gray-400 hover:text-indigo-600 disabled:opacity-30">
                  <ArrowDownIcon class="w-4 h-4" />
                </button>
                <button @click="toggleActive(item)"
                        class="p-1 text-gray-400 hover:text-indigo-600">
                  <EyeSlashIcon v-if="item.is_active" class="w-4 h-4" />
                  <EyeIcon v-else class="w-4 h-4" />
                </button>
                <button @click="removeItem(item)"
                        class="p-1 text-gray-400 hover:text-red-600">
                  <TrashIcon class="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
          <div v-if="!disclaimers.length" class="p-8 text-center text-sm text-gray-500 italic">
            Aucun disclaimer. Le PDF utilisera le contenu par défaut hardcodé.
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
