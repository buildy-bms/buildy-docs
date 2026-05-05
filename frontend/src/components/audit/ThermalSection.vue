<script setup>
import { FireIcon, PencilSquareIcon, InformationCircleIcon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import Tooltip from '@/components/Tooltip.vue'
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import { useAuditStore } from '@/stores/audit'
import { useNotification } from '@/composables/useNotification'
import { updateBacsThermal } from '@/api'

// Section 5 — Régulation thermique automatique (R175-6).
// 1 ligne par couple (zone, catégorie heating/cooling) avec un détail
// déplié (sonde / thermostat / robinets) si la régulation est active.
const props = defineProps({
  thermalFiltered: { type: Array, required: true },
  regulationOptions: { type: Array, required: true },
  generatorOptions: { type: Array, required: true },
  generatorDevicesForZoneCategory: { type: Function, required: true },
  step: { type: Object, default: null },
  active: { type: Boolean, default: false },
})
const emit = defineEmits(['validate-step', 'invalidate-step', 'open-notes'])

function hasNotes(html) {
  if (!html) return false
  return html.replace(/<[^>]*>/g, '').trim().length > 0
}

const audit = useAuditStore()
const { error } = useNotification()

async function patchThermal(t, patch) {
  Object.assign(t, patch)
  try {
    await updateBacsThermal(t.id, patch)
    await audit.refreshActionItems()
  } catch { error('Sauvegarde impossible') }
}
</script>

<template>
  <CollapsibleSection storage-key="thermal" section-id="section-thermal" :active="active">
    <template #header>
      <SectionHeader number="5" title="Régulation thermique automatique"
                     subtitle="R175-6"
                     :icon="FireIcon" icon-color="text-red-500"
                     :step="step"
                     @validate="emit('validate-step', $event)"
                     @invalidate="emit('invalidate-step', $event)">
        <template #subtitle-extra><R175Tooltip article="R175-6" /></template>
      </SectionHeader>
    </template>
    <template #summary>
      <span v-if="thermalFiltered.length">
        {{ thermalFiltered.length }} zone{{ thermalFiltered.length > 1 ? 's' : '' }} thermique{{ thermalFiltered.length > 1 ? 's' : '' }}
        · {{ thermalFiltered.filter(t => t.has_automatic_regulation).length }} régulation{{ thermalFiltered.filter(t => t.has_automatic_regulation).length > 1 ? 's' : '' }} auto
        <span v-if="thermalFiltered.filter(t => t.generator_exempt_wood).length">
          · {{ thermalFiltered.filter(t => t.generator_exempt_wood).length }} exempté{{ thermalFiltered.filter(t => t.generator_exempt_wood).length > 1 ? 's' : '' }} bois
        </span>
      </span>
      <span v-else class="italic">Aucune régulation thermique relevée</span>
    </template>
    <!-- Intro pédagogique : qu'est-ce qu'on demande au lecteur de saisir
         et pourquoi. Sans ce contexte, l'auditeur novice se perd entre
         « régulation auto », « type de régulation », « générateur lié »… -->
    <div class="mx-3 mt-2 mb-3 p-3 bg-amber-50/50 border border-amber-100 rounded-lg text-xs text-gray-700 leading-relaxed">
      <p class="flex items-start gap-1.5">
        <InformationCircleIcon class="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <span>
          <strong>R175-6</strong> impose qu'à compter du <strong>1ᵉʳ janvier 2027</strong>, chaque émetteur de chauffage et
          de refroidissement soit équipé d'une <strong>régulation thermique automatique en fonction de la température
          intérieure</strong> de la zone qu'il dessert. Pour chaque couple <em>(zone × usage chaud/froid)</em>,
          documenter : la régulation est-elle déjà en place ? Quel équipement (générateur) la pilote ? Si oui,
          renseigner le détail (sonde, thermostat, robinets) en bas de la ligne. Les <strong>appareils indépendants
          de chauffage au bois</strong> sont exemptés (R175-6 II).
        </span>
      </p>
    </div>

    <div class="overflow-x-auto">
    <table class="w-full text-sm min-w-225">
      <thead class="text-xs text-gray-500 font-medium bg-gray-50">
        <tr>
          <th class="text-center px-5 py-2">Zone</th>
          <th class="text-center py-2 w-32">
            <Tooltip text="Chauffage ou refroidissement — chaque ligne = 1 usage thermique sur 1 zone. Une zone peut donc apparaître 2 fois (1 ligne chaud + 1 ligne froid)."><span>Usage</span></Tooltip>
          </th>
          <th class="text-center py-2 w-32">
            <Tooltip text="La zone dispose-t-elle d'une régulation automatique en fonction de la température intérieure (ex : thermostat d'ambiance qui pilote l'émetteur) ? Cocher uniquement si une boucle de régulation est effectivement en place."><span>Régulation auto ?</span></Tooltip>
          </th>
          <th class="text-center py-2 w-40">
            <Tooltip text="Granularité de la régulation : zone unique, par pièce, par étage… Plus la granularité est fine, plus le confort et l'économie d'énergie sont optimisés (R175-6 II §2)."><span>Type de régulation</span></Tooltip>
          </th>
          <th class="text-center py-2 w-44">
            <Tooltip text="Quel équipement de la liste des systèmes (chap. 3) produit le chaud/froid de cette zone ? Sélectionner l'équipement physique (chaudière, PAC, DRV, rooftop…) déjà saisi en chap. 3."><span>Générateur lié</span></Tooltip>
          </th>
          <th class="text-center py-2 w-44">
            <Tooltip text="Technologie du générateur (PAC, chaudière gaz/fioul, DRV…). Sert à apprécier le potentiel d'économie d'énergie attendu de la régulation et l'éligibilité à l'exemption R175-6 II."><span>Type générateur</span></Tooltip>
          </th>
          <th class="text-center py-2 w-24">
            <Tooltip text="Année de mise en service du générateur. Un équipement vieillissant est candidat au remplacement plutôt qu'à un retrofit régulation."><span>Âge (ans)</span></Tooltip>
          </th>
          <th class="text-center py-2 w-24">
            <Tooltip text="Appareil indépendant de chauffage au bois (poêle, insert, cheminée fermée…) → exempté de R175-6 (II du décret). Ne déclenche pas d'action corrective."><span>Exempté bois</span></Tooltip>
          </th>
          <th class="text-center px-5 py-2">Notes</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100">
        <template v-for="t in thermalFiltered" :key="t.id">
        <tr>
          <td class="px-5 py-2 text-gray-700 text-center">{{ t.zone_name }}</td>
          <td class="py-2 text-center">
            <span class="inline-flex items-center gap-1.5 justify-center text-xs font-medium"
                  :class="(t.category || 'heating') === 'heating' ? 'text-red-600' : 'text-cyan-600'">
              <SystemCategoryIcon :category="t.category || 'heating'" size="sm" />
              {{ (t.category || 'heating') === 'heating' ? 'Chauffage' : 'Refroidissement' }}
            </span>
          </td>
          <td class="py-2 text-center">
            <input type="checkbox" :checked="!!t.has_automatic_regulation"
                   @change="e => patchThermal(t, { has_automatic_regulation: e.target.checked })"
                   class="rounded border-gray-300" />
          </td>
          <td class="py-2 text-center">
            <select :value="t.regulation_type"
                    @change="e => patchThermal(t, { regulation_type: e.target.value || null })"
                    class="text-xs px-2 py-1 border border-gray-200 rounded text-center">
              <option v-for="o in regulationOptions" :key="o.value || 'null'" :value="o.value">{{ o.label }}</option>
            </select>
          </td>
          <td class="py-2 px-2">
            <select :value="t.generator_device_id"
                    @change="e => patchThermal(t, { generator_device_id: e.target.value ? parseInt(e.target.value, 10) : null })"
                    class="w-full text-xs px-2 py-1 border border-gray-200 rounded">
              <option :value="null">— aucun</option>
              <option v-for="d in generatorDevicesForZoneCategory(t.zone_id, t.category || 'heating')" :key="d.id" :value="d.id">
                {{ d.name || d.brand || d.model_reference || `Équipement #${d.id}` }}
              </option>
            </select>
          </td>
          <td class="py-2 text-center">
            <select :value="t.generator_type"
                    @change="e => patchThermal(t, { generator_type: e.target.value || null })"
                    class="text-xs px-2 py-1 border border-gray-200 rounded text-center">
              <option v-for="o in generatorOptions" :key="o.value || 'null'" :value="o.value">{{ o.label }}</option>
            </select>
          </td>
          <td class="py-2 text-center">
            <input type="number" :value="t.generator_age_years" min="0"
                   @blur="e => patchThermal(t, { generator_age_years: e.target.value ? parseInt(e.target.value, 10) : null })"
                   class="w-16 text-xs px-2 py-1 border border-gray-200 rounded text-center" />
          </td>
          <td class="py-2 text-center">
            <Tooltip text="Si coché : générateur = appareil indépendant de chauffage au bois → exempté R175-6 (cf décret R175-6 II)">
              <input type="checkbox" :checked="!!t.generator_exempt_wood"
                     @change="e => patchThermal(t, { generator_exempt_wood: e.target.checked })"
                     class="rounded border-gray-300" />
            </Tooltip>
          </td>
          <td class="px-5 py-2 text-center">
            <button type="button"
                    @click="emit('open-notes', {
                      title: 'Notes régulation thermique',
                      contextLabel: t.zone_name + ' — ' + ((t.category || 'heating') === 'heating' ? 'Chauffage' : 'Refroidissement'),
                      entityType: 'thermal',
                      entityRef: t,
                      currentHtml: t.notes_html || t.notes || '',
                    })"
                    :class="['inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border transition',
                      hasNotes(t.notes_html || t.notes)
                        ? 'border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                        : 'border-gray-200 text-gray-500 bg-white hover:border-gray-300 hover:text-gray-700']"
                    :title="hasNotes(t.notes_html || t.notes) ? 'Modifier les notes' : 'Ajouter une note'">
              <PencilSquareIcon class="w-3.5 h-3.5" />
              {{ hasNotes(t.notes_html || t.notes) ? 'Notes' : '+ Notes' }}
            </button>
          </td>
        </tr>
        <!-- Détail R175-6 — placé directement sous sa ligne parent pour
             que l'utilisateur sache à quelle zone/usage ça se rapporte.
             Affiché uniquement si la régulation auto est cochée. -->
        <tr v-if="t.has_automatic_regulation" class="bg-amber-50/30 text-xs">
          <td class="px-5 py-2.5 text-gray-500 italic">
            ↳ détail<br />
            <span class="text-[10px] text-gray-400">{{ t.zone_name }} · {{ (t.category || 'heating') === 'heating' ? 'Chauffage' : 'Refroidissement' }}</span>
          </td>
          <td colspan="8" class="py-2.5 pr-5">
            <div class="grid grid-cols-3 gap-4">
              <div>
                <Tooltip text="Où est physiquement placée la sonde de température ? Sa position influence la qualité de la régulation : en sortie d'air repris (gaine), au mur (1,5m du sol), au sol… Le décret n'impose pas une position précise mais une régulation effective.">
                  <label class="text-[11px] font-medium text-gray-600 mb-1 inline-flex items-center gap-1">
                    Position de la sonde
                    <InformationCircleIcon class="w-3 h-3 text-gray-400" />
                  </label>
                </Tooltip>
                <input type="text" :value="t.sensor_position" placeholder="ex : murale 1,5m, gaine reprise, plancher…"
                       @blur="e => patchThermal(t, { sensor_position: e.target.value || null })"
                       class="w-full px-2 py-1 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 placeholder:italic placeholder:text-gray-300" />
              </div>
              <div>
                <Tooltip text="Type de thermostat installé. Plus il est avancé (programmable / adaptatif / connecté), plus la régulation est fine et l'économie d'énergie élevée. Manuel = thermostat à molette sans programmation horaire.">
                  <label class="text-[11px] font-medium text-gray-600 mb-1 inline-flex items-center gap-1">
                    Type de thermostat
                    <InformationCircleIcon class="w-3 h-3 text-gray-400" />
                  </label>
                </Tooltip>
                <select :value="t.thermostat_type"
                        @change="e => patchThermal(t, { thermostat_type: e.target.value || null })"
                        class="w-full px-2 py-1 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500">
                  <option :value="null">— à choisir</option>
                  <option value="manual">Manuel (molette, sans programmation)</option>
                  <option value="programmable">Programmable (plages horaires)</option>
                  <option value="adaptive">Adaptatif (auto-apprentissage)</option>
                  <option value="connected">Connecté (smart, pilotable à distance)</option>
                </select>
              </div>
              <div class="flex items-end">
                <Tooltip text="Robinets thermostatiques présents sur les radiateurs/émetteurs ? Permettent une régulation pièce par pièce sans automate central. Comptent comme régulation R175-6 si présents et fonctionnels sur tous les émetteurs de la zone.">
                  <label class="flex items-center gap-2 cursor-pointer text-gray-700">
                    <input type="checkbox" :checked="!!t.has_thermostatic_valves"
                           @change="e => patchThermal(t, { has_thermostatic_valves: e.target.checked })"
                           class="rounded border-gray-300" />
                    <span class="inline-flex items-center gap-1">
                      Robinets thermostatiques
                      <InformationCircleIcon class="w-3 h-3 text-gray-400" />
                    </span>
                  </label>
                </Tooltip>
              </div>
            </div>
          </td>
        </tr>
        </template>
      </tbody>
    </table>
    </div>
  </CollapsibleSection>
</template>
