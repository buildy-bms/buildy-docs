<script setup>
/**
 * Modale d'ajout d'un équipement à un système BACS — 2 onglets (item 6) :
 *  - « Depuis la bibliothèque » (par défaut) : sélection d'un modèle
 *    préconfiguré, liste préfiltrée sur la catégorie du système.
 *  - « Saisie manuelle » : formulaire complet.
 *
 * Réutilise LibraryDevicePicker et AddDeviceModal en mode `embedded`
 * (rendus sans leur propre BaseModal). Les deux panneaux restent montés
 * (v-show) pour conserver la liste filtrée / la saisie en cours d'un
 * onglet à l'autre.
 */
import { ref } from 'vue'
import BaseModal from './BaseModal.vue'
import LibraryDevicePicker from './LibraryDevicePicker.vue'
import AddDeviceModal from './AddDeviceModal.vue'
import { ENERGY_OPTIONS, ROLE_OPTIONS, COMM_OPTIONS } from '@/lib/audit-options'

const props = defineProps({
  // Système BACS courant { id, system_category, is_bacs, ... }.
  system: { type: Object, required: true },
  systemLabel: { type: String, required: true },
  zoneName: { type: String, default: '' },
})
const emit = defineEmits(['close', 'changed'])

const tab = ref('library')
</script>

<template>
  <BaseModal
    :title="`Ajouter un équipement — ${systemLabel}${zoneName ? ' / ' + zoneName : ''}`"
    size="xl"
    :dismiss-on-backdrop="false"
    @close="emit('close')"
  >
    <div class="space-y-3">
      <!-- Onglets -->
      <div class="flex border-b border-gray-200">
        <button
          type="button"
          @click="tab = 'library'"
          :class="['px-4 py-2 text-sm font-medium border-b-2 -mb-px transition whitespace-nowrap',
            tab === 'library'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-gray-500 hover:text-gray-700']"
        >
          Depuis la bibliothèque
        </button>
        <button
          type="button"
          @click="tab = 'manual'"
          :class="['px-4 py-2 text-sm font-medium border-b-2 -mb-px transition whitespace-nowrap',
            tab === 'manual'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-gray-500 hover:text-gray-700']"
        >
          Saisie manuelle
        </button>
      </div>

      <LibraryDevicePicker
        v-show="tab === 'library'"
        embedded
        :system="system"
        :system-label="systemLabel"
        :zone-name="zoneName"
        @added="emit('changed')"
        @close="emit('close')"
      />
      <AddDeviceModal
        v-show="tab === 'manual'"
        embedded
        :system-id="system.id"
        :system-label="systemLabel"
        :system-category="system.system_category"
        :zone-name="zoneName"
        :energy-options="ENERGY_OPTIONS"
        :role-options="ROLE_OPTIONS"
        :comm-options="COMM_OPTIONS"
        @created="emit('changed')"
        @close="emit('close')"
      />
    </div>
  </BaseModal>
</template>
