<script setup>
import { storeToRefs } from 'pinia'
import { DocumentArrowDownIcon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import SiteDocumentsManager from '@/components/SiteDocumentsManager.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import { useAuditStore } from '@/stores/audit'

// Section 9 — Documents du site (DOE).
const props = defineProps({
  siteDocCounts: { type: Object, required: true },
  step: { type: Object, default: null },
  active: { type: Boolean, default: false },
})
const emit = defineEmits(['validate-step', 'invalidate-step'])

const audit = useAuditStore()
const { document, systems, zones, meters, devices, bms } = storeToRefs(audit)
</script>

<template>
  <CollapsibleSection storage-key="documents" section-id="section-documents" :active="active">
    <template #header>
      <SectionHeader number="9" title="Documents du site"
                     subtitle="DOE — plans, schémas, AF, datasheets, manuels…"
                     :icon="DocumentArrowDownIcon" icon-color="text-blue-600"
                     :step="step"
                     @validate="emit('validate-step', $event)"
                     @invalidate="emit('invalidate-step', $event)" />
    </template>
    <template #summary>
      <span v-if="siteDocCounts.doe || siteDocCounts.photo">
        {{ siteDocCounts.doe }} document{{ siteDocCounts.doe > 1 ? 's' : '' }} DOE
        · {{ siteDocCounts.photo }} photo{{ siteDocCounts.photo > 1 ? 's' : '' }}
      </span>
      <span v-else class="italic">Aucun document</span>
    </template>
    <div class="px-5 py-4">
      <SiteDocumentsManager
        v-if="document?.site_uuid"
        :site-uuid="document.site_uuid"
        :systems="systems"
        :zones="zones"
        :meters="meters"
        :devices="devices"
        :bms="bms"
      />
      <p v-else class="text-sm text-gray-500 italic text-center py-4">
        L'audit n'est rattaché à aucun site.
      </p>
    </div>
  </CollapsibleSection>
</template>
