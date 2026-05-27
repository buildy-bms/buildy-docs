<script setup>
/**
 * Modale de saisie meta (titre + categorie) pour une file de PDF a uploader
 * en bulk apres un drop sur une ligne d'audit (zone/systeme/compteur/...).
 *
 * Le composable usePhotoDropzone met les PDFs dans `pendingDocs` ; le parent
 * monte cette modale tant que la liste contient des fichiers, puis appelle
 * `uploadDocsWithMeta(metaList)` une fois validee.
 */
import { ref, watch } from 'vue'
import BaseModal from './BaseModal.vue'

const props = defineProps({
  files: { type: Array, required: true }, // [File, ...]
  uploading: { type: Boolean, default: false },
})

const emit = defineEmits(['confirm', 'cancel'])

const CATEGORIES = [
  { value: 'plan', label: 'Plan' },
  { value: 'schema_electrique', label: 'Schéma électrique' },
  { value: 'schema_synoptique', label: 'Schéma synoptique' },
  { value: 'analyse_fonctionnelle', label: 'Analyse fonctionnelle' },
  { value: 'datasheet', label: 'Fiche technique' },
  { value: 'manuel_utilisateur', label: 'Manuel utilisateur' },
  { value: 'rapport_essais', label: "Rapport d'essais" },
  { value: 'autre', label: 'Autre' },
]

// Une ligne meta par fichier. Champs VIDES par defaut (titre + categorie),
// pour forcer l'auditeur a saisir explicitement les deux — sinon les
// valeurs par defaut sont reprises a l'identique et la qualite de
// nommage chute.
const rows = ref([])

watch(() => props.files, (files) => {
  rows.value = files.map(f => ({
    file: f,
    title: '',
    category: '',
  }))
}, { immediate: true })

function applyCategoryToAll(cat) {
  rows.value.forEach(r => { r.category = cat })
}

function canConfirm() {
  return rows.value.length > 0
    && rows.value.every(r => r.title.trim().length > 0 && r.category)
    && !props.uploading
}

function submit() {
  if (!canConfirm()) return
  emit('confirm', rows.value.map(r => ({
    file: r.file,
    title: r.title.trim(),
    category: r.category,
  })))
}

function formatSize(n) {
  if (n < 1024) return `${n} o`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`
  return `${(n / 1024 / 1024).toFixed(1)} Mo`
}
</script>

<template>
  <BaseModal
    :title="files.length > 1 ? `Ajouter ${files.length} documents` : 'Ajouter un document'"
    size="xl"
    :dismiss-on-backdrop="false"
    @close="emit('cancel')"
  >
    <div class="space-y-4">
      <div v-if="files.length > 1" class="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
        <span>Appliquer la même catégorie à tous :</span>
        <select
          class="rounded-lg border border-gray-200 px-2 py-1 text-xs focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
          @change="applyCategoryToAll($event.target.value)"
        >
          <option value="">—</option>
          <option v-for="c in CATEGORIES" :key="c.value" :value="c.value">{{ c.label }}</option>
        </select>
      </div>

      <div class="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
        <div
          v-for="(row, i) in rows"
          :key="i"
          class="border border-gray-200 rounded-lg p-3 space-y-2"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2 min-w-0">
              <span class="inline-flex items-center justify-center w-7 h-7 rounded-md bg-red-50 text-red-600 text-[10px] font-bold shrink-0">PDF</span>
              <div class="min-w-0">
                <div class="text-sm font-medium text-gray-900 truncate" :title="row.file.name">{{ row.file.name }}</div>
                <div class="text-[10px] text-gray-500">{{ formatSize(row.file.size) }}</div>
              </div>
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div class="sm:col-span-2">
              <label class="block text-[11px] font-medium text-gray-600 mb-1">Titre <span class="text-red-500">*</span></label>
              <input
                v-model="row.title"
                type="text"
                class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                :placeholder="`ex. : Schéma synoptique CTA — ${row.file.name}`"
              />
            </div>
            <div>
              <label class="block text-[11px] font-medium text-gray-600 mb-1">Catégorie <span class="text-red-500">*</span></label>
              <select
                v-model="row.category"
                class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 bg-white"
              >
                <option value="" disabled>— Choisir —</option>
                <option v-for="c in CATEGORIES" :key="c.value" :value="c.value">{{ c.label }}</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-2">
        <button
          type="button"
          class="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 whitespace-nowrap"
          :disabled="uploading"
          @click="emit('cancel')"
        >
          Annuler
        </button>
        <button
          type="button"
          class="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          :disabled="!canConfirm()"
          @click="submit"
        >
          {{ uploading ? 'Téléversement…' : (files.length > 1 ? `Téléverser ${files.length} documents` : 'Téléverser') }}
        </button>
      </div>
    </template>
  </BaseModal>
</template>
