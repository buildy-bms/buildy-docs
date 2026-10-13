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
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import BaseModal from '@/components/BaseModal.vue'
import SearchableSelect from '@/components/SearchableSelect.vue'
import Tooltip from '@/components/Tooltip.vue'
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import { createBacsSystem } from '@/api'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { SYSTEM_CATEGORY_LABELS } from '@/lib/audit-options'
import { resolveFaIconName } from '@/lib/equipment-icons'
import { createSystemDisabledTip } from '@/lib/audit-tips-systems'
import {
  GUIDE_TEXTS, CREATE_SYSTEM_NAME_HINT, OTHER_USAGES_TITLE, usageTileStatus,
} from '@/lib/audit-tips-systems-guide'

const props = defineProps({
  zone: { type: Object, required: true }, // { id, name }
  // Catégories de la bibliothèque (clé/label/icon/color) chargées par le parent.
  libraryCategories: { type: Array, default: () => [] },
  // Pré-remplissage optionnel pour le raccourci « + Système similaire » :
  // { category: 'heating' | '__custom__' | 'lib:<key>', label: 'Chaudière gaz (2)' }.
  initial: { type: Object, default: null },
  // Mise en page guidée de l'étape Systèmes : usages en tuiles (un clic), avec ce qui existe
  // déjà dans la zone (`zoneSystems`). Sans elle : liste déroulante, fenêtre inchangée.
  variant: { type: String, default: 'select' },  // 'select' | 'tiles'
  zoneSystems: { type: Array, default: () => [] },
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

// Pré-remplissage depuis le raccourci « + Système similaire » : on évite
// d'écraser la valeur si le composant est ré-utilisé ; le parent contrôle
// le cycle de vie via v-if sur la modale.
onMounted(() => {
  if (props.initial) {
    if (props.initial.category) categoryValue.value = props.initial.category
    if (props.initial.label) labelValue.value = props.initial.label
    // Focus direct sur le nom : la catégorie est déjà choisie, l'auditeur
    // n'a qu'à confirmer / ajuster le nom suggéré.
    nextTick(() => labelInput.value?.focus?.())
  }
})

// Lorsqu'une catégorie BACS est choisie, on pré-remplit le label avec son nom
// (« Chauffage », « Refroidissement »…) — l'auditeur peut le préciser
// derrière (« Chauffage gaz », « Chauffage PAC »…).
// Tuiles : ce qui existe déjà dans la zone pour chaque usage BACS.
const tiles = computed(() => BACS_STANDARD.map(c => {
  const all = props.zoneSystems.filter(s => s.is_bacs && s.system_category === c.value)
  const count = all.filter(s => !s.not_concerned).length
  // Libellé court dans la tuile (« Éclairage extérieur »), complet dans sa bulle.
  return { ...c, short: c.label.replace(/\s*\(.*\)$/, ''), status: usageTileStatus({ count, notConcerned: all.length > 0 && !count }) }
}))
// Tuiles : changer d'usage remplace le nom proposé par défaut (jamais un nom saisi).
function defaultLabelOf(v) {
  if (!v || v === '__custom__') return ''
  if (v.startsWith('lib:')) return (libraryOpts.value.find(o => o.value === v)?.label || '').replace(' (hors décret)', '')
  return BACS_STANDARD.find(c => c.value === v)?.label || ''
}
function pickTile(v) {
  const prevDefault = defaultLabelOf(categoryValue.value)
  if (labelValue.value && labelValue.value === prevDefault) labelValue.value = ''
  categoryValue.value = v
}

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
  <BaseModal :title="`Ajouter un système — ${zone.name}`" :size="variant === 'tiles' ? 'lg' : 'md'"
             :dismiss-on-backdrop="false"
             @close="emit('close')">
    <!-- Mise en page guidée : usages en tuiles, avec ce qui existe déjà dans la zone. -->
    <div v-if="variant === 'tiles'" class="space-y-4 pb-2" data-create-system-tiles>
      <p class="text-sm text-gray-600">{{ GUIDE_TEXTS.createSystemIntro }}</p>
      <div role="radiogroup" aria-label="Usage du système" class="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <button v-for="c in tiles" :key="c.value" type="button" role="radio"
                :aria-checked="categoryValue === c.value ? 'true' : 'false'"
                v-tooltip="c.short !== c.label ? c.label : null"
                @click="pickTile(c.value)"
                :class="['flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50',
                         categoryValue === c.value ? 'border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600' : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50']">
          <SystemCategoryIcon :category="c.value" size="md" :with-tooltip="false" />
          <span class="text-[13px] font-medium text-gray-900 leading-tight">{{ c.short }}</span>
          <span class="text-[11px] text-gray-500">{{ c.status }}</span>
        </button>
        <button type="button" role="radio"
                :aria-checked="categoryValue === '__custom__' ? 'true' : 'false'"
                @click="pickTile('__custom__')"
                :class="['flex flex-col items-start gap-1 rounded-xl border border-dashed px-3 py-2.5 text-left transition outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50',
                         categoryValue === '__custom__' ? 'border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600' : 'border-gray-300 bg-white hover:bg-gray-50']">
          <FontAwesomeIcon :icon="['fas', 'cube']" class="w-5 h-5 text-gray-500" />
          <span class="text-[13px] font-medium text-gray-900 leading-tight">Autre usage</span>
          <span class="text-[11px] text-gray-500">{{ usageTileStatus({ other: true }) }}</span>
        </button>
      </div>
      <div v-if="libraryOpts.length">
        <p class="text-[11px] font-medium text-gray-600 mb-1.5">{{ OTHER_USAGES_TITLE }}</p>
        <div class="flex flex-wrap gap-1.5">
          <button v-for="o in libraryOpts" :key="o.value" type="button"
                  :aria-pressed="categoryValue === o.value ? 'true' : 'false'"
                  @click="pickTile(o.value)"
                  :class="['inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition',
                           categoryValue === o.value ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50']">
            <FontAwesomeIcon v-if="o.icon" :icon="['fas', resolveFaIconName(o.icon)]" class="w-3 h-3" :style="o.color ? { color: o.color } : null" />
            {{ o.label.replace(' (hors décret)', '') }}
          </button>
        </div>
      </div>
      <div>
        <label for="create-system-name" class="block text-[11px] font-medium text-gray-600 mb-0.5">Nom du système</label>
        <input id="create-system-name" ref="labelInput" type="text" v-model="labelValue"
               placeholder="Par exemple : chaudière gaz d’appoint"
               class="h-9 px-2.5 w-full border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"
               @keydown.enter="save" />
        <p class="text-[11px] text-gray-500 mt-1">{{ CREATE_SYSTEM_NAME_HINT }}</p>
      </div>
    </div>
    <div v-else class="space-y-4 pb-2">
      <p class="text-xs text-gray-500 leading-relaxed">
        Plusieurs systèmes peuvent coexister dans la même zone : par exemple deux chaudières indépendantes,
        ou une pompe à chaleur réversible (refroidissement) avec un chauffage gaz d'appoint. Chaque système
        est évalué séparément, notamment pour la régulation de la température pièce par pièce.
      </p>
      <div>
        <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Catégorie</label>
        <SearchableSelect v-model="categoryValue" :options="allOptions"
                          :clearable="false" size="sm" placeholder="Choisir une catégorie…" />
      </div>
      <div>
        <label class="block text-[11px] font-medium text-gray-600 mb-0.5">Nom du système</label>
        <input ref="labelInput" type="text" v-model="labelValue"
               placeholder="ex : Chaudière gaz centrale, pompe à chaleur bureaux RDC…"
               class="h-9 px-2.5 w-full border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"
               @keydown.enter="save" />
        <p class="text-[11px] text-gray-500 mt-1">
          Ce nom sera affiché à l'étape 4 · Régulation et dans le PDF (chapitre 5).
        </p>
      </div>
    </div>
    <template #footer>
      <div class="flex items-center justify-end gap-2 w-full">
        <button type="button" @click="emit('close')"
                class="h-9 px-3 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition">
          Annuler
        </button>
        <Tooltip :text="busy ? null : createSystemDisabledTip({ hasCategory: !!categoryValue, hasName: labelValue.trim().length > 0 })">
          <button type="button" @click="save" :disabled="!canSave"
                  class="h-9 px-4 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg transition">
            Ajouter
          </button>
        </Tooltip>
      </div>
    </template>
  </BaseModal>
</template>
