<script setup>
/**
 * Modale « Parties prenantes de la zone » (item 4/5). Ouverte depuis le
 * bouton dédié de la ligne d'une zone — remplace l'ancienne ligne
 * d'expansion inline. Présente le multi-select des parties prenantes
 * rattachées à la zone (ZonePartiesPicker).
 */
import BaseModal from '@/components/BaseModal.vue'
import ZonePartiesPicker from '@/components/audit/ZonePartiesPicker.vue'

const props = defineProps({
  zone: { type: Object, required: true },
  // [{ id, name, kind }] — parties prenantes du site (store partagé).
  siteParties: { type: Array, default: () => [] },
})
const emit = defineEmits(['close'])
</script>

<template>
  <BaseModal :title="`Parties prenantes — ${zone.name}`" size="md" @close="emit('close')">
    <div class="space-y-4">
      <p class="text-sm text-gray-600 leading-relaxed">
        Cochez les parties prenantes (propriétaires, preneurs, syndicat…)
        rattachées à cette zone. Ce rattachement alimente le calcul
        automatique de l'assujetti au décret BACS, système par système.
      </p>

      <div class="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
        <ZonePartiesPicker :zone-id="zone.zone_id" :site-parties="siteParties" />
      </div>

      <p v-if="!siteParties.length" class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        Aucune partie prenante n'est encore définie sur le site. Ajoutez-les
        depuis la carte « Structure juridique &amp; parties prenantes ».
      </p>

      <div class="flex justify-end">
        <button type="button" @click="emit('close')"
                class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition">
          Fermer
        </button>
      </div>
    </div>
  </BaseModal>
</template>
