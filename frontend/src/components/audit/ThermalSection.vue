<script setup>
import { FireIcon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import Tooltip from '@/components/Tooltip.vue'
import SystemCategoryIcon from '@/components/SystemCategoryIcon.vue'
import BacsRefBadge from '@/components/BacsRefBadge.vue'
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
const emit = defineEmits(['validate-step', 'invalidate-step'])

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
    <table class="w-full text-sm">
      <thead class="text-xs uppercase text-gray-500 tracking-wider bg-gray-50">
        <tr>
          <th class="text-center px-5 py-2">Zone</th>
          <th class="text-center py-2 w-32">Usage</th>
          <th class="text-center py-2 w-32">Régulation auto ?</th>
          <th class="text-center py-2 w-40">Type de régulation</th>
          <th class="text-center py-2 w-44">Générateur lié</th>
          <th class="text-center py-2 w-44">Type générateur</th>
          <th class="text-center py-2 w-24">Âge (ans)</th>
          <th class="text-center py-2 w-24">
            <Tooltip text="Appareil indépendant de chauffage au bois — exempté R175-6 (II)"><span>Exempté bois</span></Tooltip>
          </th>
          <th class="text-center px-5 py-2">Notes</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100">
        <tr v-for="t in thermalFiltered" :key="t.id">
          <td class="px-5 py-2 text-gray-700 text-center">
            <div class="flex items-center justify-center gap-1.5">
              <BacsRefBadge kind="thermal" :id="t.id" />
              <span>{{ t.zone_name }}</span>
            </div>
          </td>
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
          <td class="px-5 py-2">
            <input type="text" :value="t.notes" placeholder="—"
                   @blur="e => patchThermal(t, { notes: e.target.value || null })"
                   class="w-full text-xs px-2 py-1 border border-gray-200 rounded" />
          </td>
        </tr>
        <tr v-for="t in thermalFiltered" :key="`detail-${t.id}`"
            v-show="t.has_automatic_regulation"
            class="bg-gray-50/50 text-xs">
          <td class="px-5 py-2 text-gray-400">↳ détail régulation</td>
          <td colspan="8" class="py-2 pr-5">
            <div class="grid grid-cols-3 gap-3">
              <div>
                <label class="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Position de la sonde</label>
                <input type="text" :value="t.sensor_position" placeholder="ex : murale, plancher, gaine reprise"
                       @blur="e => patchThermal(t, { sensor_position: e.target.value || null })"
                       class="w-full px-2 py-1 border border-gray-200 rounded" />
              </div>
              <div>
                <label class="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Type de thermostat</label>
                <select :value="t.thermostat_type"
                        @change="e => patchThermal(t, { thermostat_type: e.target.value || null })"
                        class="w-full px-2 py-1 border border-gray-200 rounded">
                  <option :value="null">—</option>
                  <option value="manual">Manuel</option>
                  <option value="programmable">Programmable</option>
                  <option value="adaptive">Adaptatif (auto-apprentissage)</option>
                  <option value="connected">Connecté (smart)</option>
                </select>
              </div>
              <div class="flex items-end">
                <label class="flex items-center gap-1.5 cursor-pointer text-gray-700">
                  <input type="checkbox" :checked="!!t.has_thermostatic_valves"
                         @change="e => patchThermal(t, { has_thermostatic_valves: e.target.checked ? 1 : 0 })"
                         class="rounded" />
                  Robinets thermostatiques
                </label>
              </div>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </CollapsibleSection>
</template>
