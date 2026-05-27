<script setup>
/**
 * Création d'un système supplémentaire dans une zone.
 *
 * Cas typiques :
 *  - Une zone a 2 chaudières indépendantes (gaz + électrique de secours) →
 *    2 systèmes Chauffage avec custom_label distincts.
 *  - Une zone a une PAC réversible ET un chauffage gaz d'appoint → 1 système
 *    Refroidissement (la PAC) + 2 systèmes Chauffage (PAC + gaz).
 *  - Un usage hors décret (bornes de recharge, occultation) → catégorie
 *    « autre » qui crée un usage non BACS (custom:uuid, is_bacs=0).
 *
 * Mig 182 (2026-05-27) : la contrainte UNIQUE(doc, zone, system_category)
 * a été retirée, donc on peut créer N systèmes BACS standards de même
 * catégorie dans une même zone. Avant : seuls les usages manuels (catégorie
 * « autre »/personnalisé) étaient possibles, via un workaround `custom:uuid`.
 */
import { ref, computed, watch, nextTick } from 'vue'
import BaseModal from '@/components/BaseModal.vue'
import SearchableSelect from '@/components/SearchableSelect.vue'
import { createBacsSystem } from '@/api'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { SYSTEM_CATEGORY_LABELS } from '@/lib/audit-options'

const props = defineProps({
  zone: { type: Object, required: true }, // { id, name }
  // Catégories de la bibliothèque (clé/label/icon/color) chargées par le parent.
  libraryCategories: { type: Array, default: () => [] },
})
const emit = defineEmits(['close', 'created'])
const audit = useAuditStore()
const { error } = useNotification()

// 7 catégories BACS standard du décret R175 — base de la matrice de
// conformité, identifiables par leur `system_category` enum.
const BACS_STANDARD = [
  { value: 'heating',                 label: SYSTEM_CATEGORY_LABELS.heating,                 icon: 'fa-fire',          color: '#ef4444' },
  { value: 'cooling',                 label: SYSTEM_CATEGORY_LABELS.cooling,                 icon: 'fa-snowflake',     color: '#0ea5e9' },
  { value: 'ventilation',             label: SYSTEM_CATEGORY_LABELS.ventilation,             icon: 'fa-fan',           color: '#10b981' },
  { value: 'dhw',                     label: SYSTEM_CATEGORY_LABELS.dhw,                     icon: 'fa-droplet',       color: '#0ea5e9' },
  { value: 'lighting_indoor',         label: SYSTEM_CATEGORY_LABELS.lighting_indoor,         icon: 'fa-lightbulb',     color: '#facc15' },
  { value: 'lighting_outdoor',        label: SYSTEM_CATEGORY_LABELS.lighting_outdoor,        icon: 'fa-lightbulb',     color: '#fb923c' },
  { value: 'electricity_production',  label: SYSTEM_CATEGORY_LABELS.electricity_production,  icon: 'fa-solar-panel',   color: '#f59e0b' },
]

// Catégories de la bibliothèque (non BACS) — donnent une catégorie d'usage
// libre (filtre la biblio d'équipements) sans entrer dans le périmètre R175.
const libraryOpts = computed(() =>
  (props.libraryCategories || []).map(c => ({
    value: 'lib:' + c.key,
    label: c.label + ' (hors décret)',
    icon: c.icon_value,
    color: c.icon_color,
    library_key: c.key,
  }))
)

// Option « personnalisé » : laisse l'auditeur saisir n'importe quel nom
// d'usage qui ne rentre dans aucune catégorie connue (ex: « Borne de
// recharge », « Occultation »…). Stocké en is_bacs=0 / category=custom:uuid.
const allOptions = computed(() => [
  ...BACS_STANDARD,
  ...libraryOpts.value,
  { value: '__custom__', label: 'Autre usage (saisie libre)' },
])

const categoryValue = ref(null)
const labelValue = ref('')
const busy = ref(false)
const labelInput = ref(null)

// Lorsqu'une catégorie BACS est choisie, on pré-remplit le label avec son nom
// (« Chauffage », « Refroidissement »…) — l'auditeur peut le préciser
// derrière (« Chauffage gaz », « Chauffage PAC »…).
watch(categoryValue, (v) => {
  if (!v) return
  if (v === '__custom__') {
    if (!labelValue.value) labelValue.value = ''
  } else if (v.startsWith('lib:')) {
    const opt = libraryOpts.value.find(o => o.value === v)
    if (opt && !labelValue.value) labelValue.value = opt.label.replace(' (hors décret)', '')
  } else {
    const std = BACS_STANDARD.find(c => c.value === v)
    if (std && !labelValue.value) labelValue.value = std.label
  }
  nextTick(() => labelInput.value?.focus?.())
})

const canSave = computed(() => !!categoryValue.value && labelValue.value.trim().length > 0 && !busy.value)

async function save() {
  if (!canSave.value) return
  busy.value = true
  try {
    const payload = { zone_id: props.zone.id, label: labelValue.value.trim() }
    const v = categoryValue.value
    if (v === '__custom__') {
      // Pas de system_category → backend génère custom:<uuid>, is_bacs=0.
    } else if (v.startsWith('lib:')) {
      const opt = libraryOpts.value.find(o => o.value === v)
      if (opt) payload.library_category_key = opt.library_key
    } else {
      // Catégorie BACS standard.
      payload.system_category = v
    }
    const { data } = await createBacsSystem(audit.docId, payload)
    emit('created', data)
    emit('close')
  } catch (e) {
    error(e.response?.data?.detail || 'Création du système impossible')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BaseModal :title="`Ajouter un système — ${zone.name}`" size="md"
             :dismiss-on-backdrop="false"
             @close="emit('close')">
    <div class="space-y-4 pb-2">
      <p class="text-xs text-gray-500 leading-relaxed">
        Plusieurs systèmes peuvent coexister dans la même zone : par exemple deux chaudières indépendantes,
        ou une PAC réversible (refroidissement) avec un chauffage gaz d'appoint. Chaque système est évalué
        séparément au regard de R175-6.
      </p>
      <div>
        <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Catégorie</label>
        <SearchableSelect v-model="categoryValue" :options="allOptions"
                          :clearable="false" size="sm" placeholder="Choisir une catégorie…" />
      </div>
      <div>
        <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Nom du système</label>
        <input ref="labelInput" type="text" v-model="labelValue"
               placeholder="ex : Chaudière gaz centrale, PAC bureaux RDC…"
               class="h-9 px-2.5 w-full border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"
               @keydown.enter="save" />
        <p class="text-[11px] text-gray-500 mt-1">
          Ce nom sera affiché dans la card 06 (Régulation thermique) et le PDF chapitre 5.
        </p>
      </div>
    </div>
    <template #footer>
      <div class="flex items-center justify-end gap-2 w-full">
        <button type="button" @click="emit('close')"
                class="h-9 px-3 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition">
          Annuler
        </button>
        <button type="button" @click="save" :disabled="!canSave"
                class="h-9 px-4 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg transition">
          Ajouter
        </button>
      </div>
    </template>
  </BaseModal>
</template>
