<script setup>
import { storeToRefs } from 'pinia'
import { WrenchScrewdriverIcon } from '@heroicons/vue/24/outline'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import StepValidateBadge from '@/components/StepValidateBadge.vue'
import SiteCredentialsManager from '@/components/SiteCredentialsManager.vue'
import { useAuditStore } from '@/stores/audit'

// Section 10 — Credentials d'accès (logins web/SSH/VPN aux GTB et
// systèmes, chiffrés AES-256-GCM côté backend).
const props = defineProps({
  siteCredCount: { type: Number, default: 0 },
  step: { type: Object, default: null },
})
const emit = defineEmits(['validate-step', 'invalidate-step'])

const audit = useAuditStore()
const { document, systems } = storeToRefs(audit)
</script>

<template>
  <CollapsibleSection storage-key="credentials" section-id="section-credentials">
    <template #header>
      <WrenchScrewdriverIcon class="w-5 h-5 text-amber-600" />
      <h2 class="text-base font-semibold text-gray-800">10. Credentials d'accès</h2>
      <span class="text-xs text-gray-500">Logins web/SSH/VPN aux GTB et systèmes (chiffrés AES-256-GCM)</span>
      <StepValidateBadge class="ml-auto" :step="step" @validate="emit('validate-step', $event)" @invalidate="emit('invalidate-step', $event)" />
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
