<script setup>
import { defineAsyncComponent } from 'vue'
import { useViewport } from '@/composables/useViewport'

/**
 * Wrapper qui choisit dynamiquement entre la vue desktop et la vue mobile
 * de l'audit BACS / GTB selon la largeur de viewport.
 *
 * - < 1024px (iPhone, iPad portrait)  → MobileAuditDetailView
 * - ≥ 1024px (iPad landscape, desktop) → BacsAuditDetailView
 *
 * Les deux vues partagent le même store Pinia useAuditStore — pas de
 * duplication de logique métier.
 */

const { isNarrow } = useViewport()

const DesktopView = defineAsyncComponent(() => import('@/views/BacsAuditDetailView.vue'))
const MobileView = defineAsyncComponent(() => import('@/views/MobileAuditDetailView.vue'))
</script>

<template>
  <component :is="isNarrow ? MobileView : DesktopView" />
</template>
