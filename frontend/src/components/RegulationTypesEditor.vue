<script setup>
/**
 * Éditeur d'une liste de suggestions de type de régulation
 * (`[{ value, label }, ...]`). Utilisé dans EquipmentTemplateEditor pour
 * configurer les listes par modèle (mig 184), niveau par niveau (Production /
 * Distribution / Émission).
 *
 * - Pas de liste → l'audit utilise les défauts par catégorie d'usage du
 *   système. Bouton « Remettre les défauts » pour charger ces valeurs comme
 *   point de départ éditable.
 * - Lignes : libellé FR + identifiant technique (snake_case stable). Le
 *   libellé est ce que voit l'auditeur ; l'identifiant ne se voit que dans la
 *   DB (mais doit rester unique dans la liste).
 */
import { computed } from 'vue'
import { TrashIcon, PlusIcon, ArrowPathIcon } from '@heroicons/vue/24/outline'

const props = defineProps({
  modelValue: { type: Array, required: true },     // [{ value, label }]
  defaultValues: { type: Array, default: () => [] }, // défaut par catégorie
  level: { type: String, required: true },         // 'production' | 'distribution' | 'emission'
})
const emit = defineEmits(['update:modelValue'])

const items = computed(() => props.modelValue || [])

function slugify(label) {
  return (label || '')
    .toString().toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function update(next) { emit('update:modelValue', next) }
function add() {
  update([...items.value, { value: '', label: '' }])
}
function remove(idx) {
  update(items.value.filter((_, i) => i !== idx))
}
function patchLabel(idx, newLabel) {
  const next = items.value.map((it, i) => {
    if (i !== idx) return it
    // Si l'identifiant est vide ou semble auto-généré, on le re-dérive du label.
    const autoSlug = !it.value || it.value === slugify(it.label)
    return { ...it, label: newLabel, value: autoSlug ? slugify(newLabel) : it.value }
  })
  update(next)
}
function patchValue(idx, newValue) {
  update(items.value.map((it, i) => i === idx ? { ...it, value: newValue } : it))
}
function loadDefaults() {
  update(props.defaultValues.map(d => ({ ...d })))
}

const placeholder = computed(() => {
  if (props.level === 'emission') return 'ex : Détection de présence, Thermostat ambiant…'
  if (props.level === 'production') return "ex : Loi d'eau, MPPT, Cascade…"
  return 'ex : Vanne 3 voies, Bouclage régulé…'
})
</script>

<template>
  <div class="space-y-2">
    <div v-if="!items.length" class="rounded-lg border border-dashed border-gray-200 px-3 py-3 text-xs text-gray-500 flex items-center justify-between gap-3">
      <span class="leading-snug">
        Aucune liste personnalisée — l'audit affichera les suggestions par défaut de la catégorie d'usage du système.
      </span>
      <button v-if="defaultValues.length" type="button"
              class="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded transition whitespace-nowrap"
              @click="loadDefaults">
        <ArrowPathIcon class="w-3.5 h-3.5" /> Partir des défauts
      </button>
    </div>

    <div v-else class="rounded-lg border border-gray-200 overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-gray-50 text-[11px] uppercase text-gray-500 tracking-wider">
          <tr>
            <th class="text-left px-3 py-1.5">Libellé affiché</th>
            <th class="text-left px-3 py-1.5">Identifiant technique</th>
            <th class="w-10"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(it, idx) in items" :key="idx" class="border-t border-gray-100">
            <td class="px-2 py-1">
              <input :value="it.label" :placeholder="placeholder"
                     class="w-full h-8 px-2 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"
                     @input="e => patchLabel(idx, e.target.value)" />
            </td>
            <td class="px-2 py-1">
              <input :value="it.value" placeholder="auto"
                     class="w-full h-8 px-2 border border-gray-200 rounded text-xs font-mono text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"
                     @input="e => patchValue(idx, e.target.value)" />
            </td>
            <td class="px-2 py-1 text-right">
              <button type="button" class="p-1 text-gray-400 hover:text-rose-600 transition"
                      @click="remove(idx)" title="Supprimer cette ligne">
                <TrashIcon class="w-4 h-4" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="flex items-center gap-2">
      <button type="button"
              class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg transition"
              @click="add">
        <PlusIcon class="w-3.5 h-3.5" /> Ajouter
      </button>
      <button v-if="items.length && defaultValues.length" type="button"
              class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-600 hover:text-gray-800 transition"
              @click="loadDefaults" title="Remplace par les suggestions par défaut de la catégorie">
        <ArrowPathIcon class="w-3.5 h-3.5" /> Remettre les défauts
      </button>
      <button v-if="items.length" type="button"
              class="ml-auto inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-500 hover:text-rose-600 transition"
              @click="update([])" title="Supprime la surcharge → retour aux défauts de catégorie">
        Vider la liste
      </button>
    </div>
  </div>
</template>
