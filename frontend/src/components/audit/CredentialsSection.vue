<script setup>
import { storeToRefs } from 'pinia'
import { WrenchScrewdriverIcon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import SiteCredentialsManager from '@/components/SiteCredentialsManager.vue'
import SectionHeader from '@/components/audit/SectionHeader.vue'
import { useAuditStore } from '@/stores/audit'

// Section 10 — Credentials d'accès (logins web/SSH/VPN aux GTB et
// systèmes, chiffrés AES-256-GCM côté backend).
const props = defineProps({
  siteCredCount: { type: Number, default: 0 },
  step: { type: Object, default: null },
  active: { type: Boolean, default: false },
})
const emit = defineEmits(['validate-step', 'invalidate-step'])

const audit = useAuditStore()
const { document, systems } = storeToRefs(audit)
</script>

<template>
  <CollapsibleSection storage-key="credentials" section-id="section-credentials" :active="active">
    <template #header>
      <SectionHeader number="10" title="Credentials d'accès"
                     subtitle="Logins web/SSH/VPN aux GTB et systèmes (chiffrés AES-256-GCM)"
                     :icon="WrenchScrewdriverIcon" icon-color="text-amber-600"
                     :step="step"
                     @validate="emit('validate-step', $event)"
                     @invalidate="emit('invalidate-step', $event)" />
    </template>
    <template #summary>
      <span v-if="siteCredCount">{{ siteCredCount }} credential{{ siteCredCount > 1 ? 's' : '' }} chiffré{{ siteCredCount > 1 ? 's' : '' }}</span>
      <span v-else class="italic">Aucun credential</span>
    </template>
    <div class="px-5 py-4">
      <SiteCredentialsManager
        v-if="document?.site_uuid"
        :site-uuid="document.site_uuid"
        :systems="systems"
      />
      <p v-else class="text-sm text-gray-500 italic text-center py-4">
        L'audit n'est rattaché à aucun site.
      </p>
    </div>
  </CollapsibleSection>
</template>
