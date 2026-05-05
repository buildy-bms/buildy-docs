<script setup>
import { computed } from 'vue'
import {
  IdentificationIcon,
  Squares2X2Icon,
  BoltIcon,
  WrenchScrewdriverIcon,
  ClipboardDocumentListIcon,
} from '@heroicons/vue/24/outline'

const props = defineProps({
  activeStepKey: { type: String, default: null },
  showCompliance: { type: Boolean, default: true },
})
const emit = defineEmits(['navigate'])

const ITEMS = [
  { key: 'identification', label: 'Site',     icon: IdentificationIcon,         sectionId: 'section-identification' },
  { key: 'zones',          label: 'Zones',    icon: Squares2X2Icon,              sectionId: 'section-zones' },
  { key: 'meters',         label: 'Compteurs',icon: BoltIcon,                    sectionId: 'section-meters' },
  { key: 'systems',        label: 'Systèmes', icon: WrenchScrewdriverIcon,       sectionId: 'section-systems' },
  { key: 'review',         label: 'Plan',     icon: ClipboardDocumentListIcon,   sectionId: 'section-review',
    requires: 'showCompliance' },
]

const items = computed(() => ITEMS.filter(it => !it.requires || props[it.requires]))

function go(item) {
  emit('navigate', item.key)
  const el = window.document.getElementById(item.sectionId)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <nav
    class="fixed inset-x-0 bottom-0 z-40 bg-white border-t border-gray-200 lg:hidden"
    :style="{ paddingBottom: 'env(safe-area-inset-bottom)' }"
    role="navigation"
    aria-label="Navigation audit"
  >
    <ul class="flex items-stretch h-14">
      <li v-for="item in items" :key="item.key" class="flex-1">
        <button
          type="button"
          @click="go(item)"
          :class="[
            'w-full h-full flex flex-col items-center justify-center gap-0.5 px-1 transition select-none',
            'tap-target',
            activeStepKey === item.key
              ? 'text-indigo-600'
              : 'text-gray-500 active:text-gray-800'
          ]"
        >
          <component :is="item.icon" class="w-5 h-5 shrink-0" />
          <span class="text-[10px] font-medium leading-none whitespace-nowrap">{{ item.label }}</span>
        </button>
      </li>
    </ul>
  </nav>
</template>

