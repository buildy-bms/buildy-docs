<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import '@/lib/equipment-icons'
/**
 * Sous-page tactile (drill-down) qui regroupe la saisie de la régulation
 * thermique R175-6 d'un système heating/cooling, sortie de la liste des
 * systèmes (jusque-là affichée inline dans un panneau ambré).
 *
 * Ouverte depuis MobileSystemsTab via un bouton « Régulation thermique »
 * sur chaque système heating/cooling présent en mode BACS.
 *
 * Conventions tactile iOS appliquées :
 * - Cartes cliquables plein-largeur pour les toggles (zone tap >= 44pt) ;
 *   la checkbox visuelle reste à droite mais c'est tout le bloc qui est
 *   un button.
 * - Toutes les listes déroulantes utilisent `<MobileSelectSheet>` =
 *   bottom sheet iOS-natif custom avec icônes/pilules colorées et
 *   recherche auto. Les listes creatable (type production) ajoutent
 *   un item terminal « + Saisir une autre valeur… ».
 * - Inputs numériques : inputmode="numeric" pattern="[0-9]*".
 * - Auto-save 400 ms (identique au comportement précédent), donc le sheet
 *   n'a pas de bouton « Enregistrer » dans son header (hide-save).
 */
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { updateBacsThermal } from '@/api'
import MobileSheet from './MobileSheet.vue'
import MobileField from './MobileField.vue'
import MobileSelectSheet from './MobileSelectSheet.vue'
import { filterAndSortByRole } from '@/composables/useDeviceRoleFilter'

const LEVEL_NOTES_FIELD = {
  production: 'production_notes_html',
  distribution: 'distribution_notes_html',
  emission: 'emission_notes_html',
}
const LEVEL_LABEL = {
  production: 'Production',
  distribution: 'Distribution',
  emission: 'Émission',
}

const props = defineProps({
  open: { type: Boolean, default: false },
  zoneId: { type: [Number, String], default: null },
  category: { type: String, default: 'heating' }, // 'heating' | 'cooling'
})
const emit = defineEmits(['close'])

const audit = useAuditStore()
const { systems, devices, thermal } = storeToRefs(audit)
const { error } = useNotification()

const thermalRow = computed(() =>
  thermal.value.find(t =>
    t.zone_id === props.zoneId && (t.category || 'heating') === props.category
  ) || null
)

const zoneName = computed(() => {
  if (thermalRow.value?.zone_name) return thermalRow.value.zone_name
  const sys = systems.value.find(s => s.zone_id === props.zoneId && s.system_category === props.category)
  return sys?.zone_name || ''
})

const sheetTitle = computed(() => {
  const cat = props.category === 'cooling' ? 'Refroidissement' : 'Chauffage'
  return zoneName.value ? `${cat} — ${zoneName.value}` : `Régulation ${cat.toLowerCase()}`
})

// Liste des équipements de la zone + catégorie. Inclut les équipements
// partagés depuis un autre usage via bacs_audit_device_shared_systems (mig 143).
const candidateDevices = computed(() => {
  const sysIds = new Set(systems.value
    .filter(s => s.zone_id === props.zoneId && s.present && s.system_category === props.category)
    .map(s => s.id))
  return devices.value.filter(d =>
    sysIds.has(d.system_id) ||
    (Array.isArray(d.extra_system_ids) && d.extra_system_ids.some(sid => sysIds.has(sid)))
  )
})

function toOption(d) {
  return {
    value: d.id,
    label: d.name || d.brand || d.model_reference || `Équipement #${d.id}`,
    hint: d.brand && d.model_reference ? `${d.brand} ${d.model_reference}` : (d.brand || d.model_reference || ''),
  }
}

// Filtrage tolérant par rôle : pertinents en tête, sans rôle en bas, rôles
// incompatibles masqués (cohérent avec ThermalSection desktop).
const productionDeviceOptions = computed(() =>
  filterAndSortByRole(candidateDevices.value, 'production').map(toOption)
)
const distributionDeviceOptions = computed(() =>
  filterAndSortByRole(candidateDevices.value, 'distribution').map(toOption)
)
const emissionDeviceOptions = computed(() =>
  filterAndSortByRole(candidateDevices.value, 'emission').map(toOption)
)
// Liste partagée pour les 3 sélecteurs « équipement de régulation » P/D/E.
// Filtre rôle 'regulation' (sondes, thermostats, GTB, vannes motorisées).
const regulationDeviceOptions = computed(() =>
  filterAndSortByRole(candidateDevices.value, 'regulation').map(toOption)
)

const GENERATOR_OPTIONS = [
  { value: 'gas',              label: 'Gaz',                              icon: 'fa-fire-flame-curved', color: '#f97316' },
  { value: 'electric',         label: 'Effet Joule',                      icon: 'fa-bolt',              color: '#eab308' },
  { value: 'heat_pump',        label: 'Pompe à chaleur',                  icon: 'fa-temperature-half',  color: '#0ea5e9' },
  { value: 'wood_appliance',   label: 'Appareil bois (exempté R175-6)',   icon: 'fa-tree',              color: '#65a30d' },
  { value: 'district_heating', label: 'Réseau de chaleur',                icon: 'fa-pipe',              color: '#dc2626' },
  { value: 'other',            label: 'Autre',                            icon: 'fa-circle-question',   color: '#6b7280' },
]
// Granularité de régulation : pilules colorées selon niveau de finesse.
const REGULATION_TYPE_OPTIONS = [
  { value: 'per_room',     label: 'Par pièce',           pill: 'Fin',         pillTone: 'emerald' },
  { value: 'per_zone',     label: 'Par zone',            pill: 'Zone',        pillTone: 'amber'   },
  { value: 'central_only', label: 'Centrale uniquement', pill: 'Centrale',    pillTone: 'rose'    },
  { value: 'none',         label: 'Aucune',              pill: 'Aucune',      pillTone: 'slate'   },
]

let saveTimer = null
async function patch(p) {
  const t = thermalRow.value
  if (!t) return
  Object.assign(t, p)
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      await updateBacsThermal(t.id, p)
      await audit.refreshActionItems()
    } catch { error('Sauvegarde régulation impossible') }
  }, 400)
}

// ── Sous-MobileSheet de notes par niveau (production / distribution /
// émission). Pattern identique à MobileBmsTopicNoteButton : textarea simple,
// conversion text ↔ HTML basique. Le formatage rich saisi côté desktop est
// aplati à l'ouverture mobile et perdu au save (mention dans le footer).

const noteSheetLevel = ref(null) // 'production' | 'distribution' | 'emission'
const noteSheetText = ref('')

const noteSheetOpen = computed(() => noteSheetLevel.value !== null)
const noteSheetTitle = computed(() => {
  if (!noteSheetLevel.value) return ''
  return `Note ${LEVEL_LABEL[noteSheetLevel.value].toLowerCase()}`
})

function htmlToText(html) {
  if (!html) return ''
  return html.replace(/<\/?p[^>]*>/gi, '\n').replace(/<[^>]*>/g, '').trim()
}
function textToHtml(text) {
  if (!text || !text.trim()) return ''
  return text.split(/\n+/).filter(Boolean)
    .map(p => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('')
}
function hasLevelNote(level) {
  const html = thermalRow.value?.[LEVEL_NOTES_FIELD[level]] || ''
  return !!html.replace(/<[^>]*>/g, '').trim()
}

function openLevelNote(level) {
  noteSheetLevel.value = level
  noteSheetText.value = htmlToText(thermalRow.value?.[LEVEL_NOTES_FIELD[level]] || '')
}
function closeLevelNote() {
  noteSheetLevel.value = null
  noteSheetText.value = ''
}
async function saveLevelNote() {
  const lvl = noteSheetLevel.value
  if (!lvl) return
  const field = LEVEL_NOTES_FIELD[lvl]
  await patch({ [field]: textToHtml(noteSheetText.value) || null })
  closeLevelNote()
}
</script>

<template>
  <MobileSheet :open="open" :title="sheetTitle" hide-save @close="emit('close')">
    <div v-if="thermalRow" class="p-4 space-y-4">
      <!-- Carte d'aide contextuelle -->
      <div class="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <p class="text-xs font-semibold text-amber-800 uppercase tracking-wider mb-1">
          R175-6
        </p>
        <p class="text-sm text-amber-900 leading-relaxed">
          Régulation automatique de la température, par pièce ou par zone homogène.
          Renseigne ci-dessous l'état réel constaté sur site.
        </p>
      </div>

      <!-- Granularité de la régulation (la présence d'une régulation se
           déduit du type choisi : « Aucune » = pas de régulation). -->
      <div class="bg-white rounded-xl border border-gray-200 px-4 py-4 space-y-2">
          <MobileField label="Granularité de la régulation">
            <MobileSelectSheet
              :model-value="thermalRow.regulation_type"
              @update:modelValue="v => patch({ regulation_type: v || null })"
              :options="REGULATION_TYPE_OPTIONS"
              title="Granularité"
              placeholder="— Sélectionner —"
            />
          </MobileField>
        </div>

        <!-- Production -->
        <div class="bg-white rounded-xl border border-gray-200 px-4 py-4 space-y-3">
          <p class="text-sm font-semibold text-gray-700">🔧 Production</p>
          <MobileField label="Équipement de production">
            <MobileSelectSheet
              :model-value="thermalRow.generator_device_id"
              @update:modelValue="v => patch({ generator_device_id: v != null && v !== '' ? parseInt(v, 10) : null })"
              :options="productionDeviceOptions"
              title="Équipement de production"
              placeholder="— aucun équipement"
            />
          </MobileField>
          <div class="space-y-3 pl-4 border-l-4 border-amber-300">
            <template v-if="thermalRow.generator_device_id">
              <MobileField label="Type de production">
                <MobileSelectSheet
                  :model-value="thermalRow.generator_type"
                  @update:modelValue="v => patch({ generator_type: v || null })"
                  :options="GENERATOR_OPTIONS"
                  creatable
                  title="Type de production"
                  placeholder="— Sélectionner —"
                  custom-placeholder="ex : chaudière condensation, PAC air-eau…"
                />
              </MobileField>
              <MobileField label="Âge de l'équipement (années)">
                <input
                  type="number" inputmode="numeric" pattern="[0-9]*" min="0"
                  :value="thermalRow.generator_age_years ?? ''"
                  @blur="e => patch({ generator_age_years: e.target.value ? parseInt(e.target.value, 10) : null })"
                  placeholder="ex : 8"
                  class="pwa-input w-full"
                />
              </MobileField>
            </template>
            <MobileField label="Équipement de régulation (sonde, thermostat, GTB)">
              <MobileSelectSheet
                :model-value="thermalRow.production_regulation_device_id"
                @update:modelValue="v => patch({ production_regulation_device_id: v != null && v !== '' ? parseInt(v, 10) : null })"
                :options="regulationDeviceOptions"
                title="Équipement de régulation"
                placeholder="— aucun"
              />
            </MobileField>
            <button
              type="button"
              @click="openLevelNote('production')"
              :class="['w-full tap-target inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border text-sm font-medium transition',
                hasLevelNote('production')
                  ? 'border-indigo-300 text-indigo-700 bg-indigo-50'
                  : 'border-gray-200 text-gray-600 bg-white']"
            >
              <FontAwesomeIcon :icon="['fas', 'pen-to-square']" class="w-4 h-4 shrink-0" />
              {{ hasLevelNote('production') ? 'Note production' : '+ Note production' }}
            </button>
          </div>
        </div>

        <!-- Distribution -->
        <div class="bg-white rounded-xl border border-gray-200 px-4 py-4 space-y-3">
          <p class="text-sm font-semibold text-gray-700">🚰 Distribution</p>
          <MobileField label="Équipement de distribution">
            <MobileSelectSheet
              :model-value="thermalRow.distribution_device_id"
              @update:modelValue="v => patch({ distribution_device_id: v != null && v !== '' ? parseInt(v, 10) : null })"
              :options="distributionDeviceOptions"
              title="Équipement de distribution"
              placeholder="— aucune (DRV, poêle…)"
            />
          </MobileField>
          <div class="space-y-3 pl-4 border-l-4 border-amber-300">
            <MobileField label="Équipement de régulation">
              <MobileSelectSheet
                :model-value="thermalRow.distribution_regulation_device_id"
                @update:modelValue="v => patch({ distribution_regulation_device_id: v != null && v !== '' ? parseInt(v, 10) : null })"
                :options="regulationDeviceOptions"
                title="Équipement de régulation"
                placeholder="— aucun"
              />
            </MobileField>
            <button
              type="button"
              @click="openLevelNote('distribution')"
              :class="['w-full tap-target inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border text-sm font-medium transition',
                hasLevelNote('distribution')
                  ? 'border-indigo-300 text-indigo-700 bg-indigo-50'
                  : 'border-gray-200 text-gray-600 bg-white']"
            >
              <FontAwesomeIcon :icon="['fas', 'pen-to-square']" class="w-4 h-4 shrink-0" />
              {{ hasLevelNote('distribution') ? 'Note distribution' : '+ Note distribution' }}
            </button>
          </div>
        </div>

        <!-- Émission -->
        <div class="bg-white rounded-xl border border-gray-200 px-4 py-4 space-y-3">
          <p class="text-sm font-semibold text-gray-700">♨️ Émission</p>
          <MobileField label="Équipement d'émission">
            <MobileSelectSheet
              :model-value="thermalRow.emission_device_id"
              @update:modelValue="v => patch({ emission_device_id: v != null && v !== '' ? parseInt(v, 10) : null })"
              :options="emissionDeviceOptions"
              title="Équipement d'émission"
              placeholder="— aucun"
            />
          </MobileField>
          <div class="space-y-3 pl-4 border-l-4 border-amber-300">
            <MobileField label="Équipement de régulation">
              <MobileSelectSheet
                :model-value="thermalRow.emission_regulation_device_id"
                @update:modelValue="v => patch({ emission_regulation_device_id: v != null && v !== '' ? parseInt(v, 10) : null })"
                :options="regulationDeviceOptions"
                title="Équipement de régulation"
                placeholder="— aucun"
              />
            </MobileField>
            <button
              type="button"
              @click="openLevelNote('emission')"
              :class="['w-full tap-target inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border text-sm font-medium transition',
                hasLevelNote('emission')
                  ? 'border-indigo-300 text-indigo-700 bg-indigo-50'
                  : 'border-gray-200 text-gray-600 bg-white']"
            >
              <FontAwesomeIcon :icon="['fas', 'pen-to-square']" class="w-4 h-4 shrink-0" />
              {{ hasLevelNote('emission') ? 'Note émission' : '+ Note émission' }}
            </button>
          </div>
        </div>
      <p class="text-xs text-gray-500 text-center pt-2">
        Sauvegarde automatique. Tu peux fermer cette page à tout moment.
      </p>
    </div>

    <!-- Cas où aucune ligne n'existe encore (ne devrait pas arriver mais protège) -->
    <div v-else class="p-8 text-center text-sm text-gray-500">
      Aucune régulation thermique enregistrée pour cette zone.
    </div>
  </MobileSheet>

  <!-- Sous-MobileSheet de notes par niveau (Production / Distribution / Émission).
       Pattern identique à MobileBmsTopicNoteButton : textarea simple, pas Tiptap. -->
  <MobileSheet :open="noteSheetOpen" :title="noteSheetTitle" save-label="Enregistrer"
               @close="closeLevelNote" @save="saveLevelNote">
    <div class="p-4 space-y-3">
      <p class="text-xs text-gray-500 leading-relaxed">
        Note libre pour ce niveau (état observé, défauts, contournements). Apparaîtra dans le PDF rapport sous cette sous-section.
      </p>
      <textarea
        v-model="noteSheetText"
        rows="8"
        placeholder="Ce que tu observes…"
        class="w-full text-sm rounded-lg border border-gray-200 p-3 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
      ></textarea>
      <p class="text-xs text-gray-500 italic">
        Formatage simplifié sur mobile (pas de gras / listes). Saisir une note riche depuis le poste de bureau si besoin.
      </p>
    </div>
  </MobileSheet>
</template>
