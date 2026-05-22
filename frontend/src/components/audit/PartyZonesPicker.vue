<script setup>
// Multi-select des zones auxquelles une partie prenante (occupant) est
// affectée — item 5 : affecter un occupant à plusieurs zones d'un coup.
// Les zones sélectionnées s'affichent en pilules (une par zone) pour
// distinguer d'un coup d'œil les zones liées à chaque partie prenante.
// Self-contained : persiste via setPartyZones (PUT /site-parties/:id/zones).
import { ref, computed, watch } from 'vue'
import SearchableSelect from '@/components/SearchableSelect.vue'
import { useNotification } from '@/composables/useNotification'
import { setPartyZones } from '@/api'

const props = defineProps({
  partyId: { type: Number, required: true },
  // [{ zone_id, name, kind }] — zones du site.
  zones: { type: Array, default: () => [] },
  // zone_ids initialement affectés à cette partie.
  modelValue: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue'])

const { error } = useNotification()

const selected = ref([...(props.modelValue || [])])
watch(() => props.modelValue, (v) => { selected.value = [...(v || [])] })

const zoneOptions = computed(() => props.zones.map(z => ({
  value: z.zone_id,
  label: z.name,
  hint: z.kind === 'technical' ? 'technique' : '',
})))

async function onChange(ids) {
  selected.value = ids
  try {
    await setPartyZones(props.partyId, ids)
    emit('update:modelValue', [...ids])
  } catch {
    error('Affectation des zones impossible')
  }
}
</script>

<template>
  <SearchableSelect
    :model-value="selected"
    :options="zoneOptions"
    :multiple="true"
    :clearable="true"
    size="sm"
    placeholder="Zones affectées…"
    search-placeholder="Filtrer les zones…"
    @update:modelValue="onChange"
  />
</template>
