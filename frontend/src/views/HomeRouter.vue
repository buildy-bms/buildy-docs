<script setup>
import { defineAsyncComponent } from 'vue'
import { useViewport } from '@/composables/useViewport'

/**
 * Wrapper home page : sur mobile, on affiche MobileHomeView (audits
 * uniquement, layout natif) ; sur desktop, AfsListView (full).
 */

const { isNarrow } = useViewport()

const DesktopView = defineAsyncComponent(() => import('@/views/AfsListView.vue'))
const MobileView = defineAsyncComponent(() => import('@/views/MobileHomeView.vue'))
</script>

<template>
  <component :is="isNarrow ? MobileView : DesktopView" />
</template>
