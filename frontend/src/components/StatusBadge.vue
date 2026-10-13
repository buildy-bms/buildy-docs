<script setup>
import { docStatusTip } from '@/lib/af-tips'

defineProps({
  status: { type: String, required: true }, // 'redaction' | 'validee' | 'commissioning' | 'commissioned' | 'livree'
  // Type de document (af | bacs_audit | maintenance_report | brochure) : adapte seulement le texte de l'infobulle.
  kind: { type: String, default: 'af' },
})

const config = {
  redaction:     { label: 'Rédaction en cours',          classes: 'bg-gray-100 text-gray-700' },
  validee:       { label: 'Validée',                     classes: 'bg-blue-100 text-blue-800' },
  commissioning: { label: 'Commissionnement en cours',   classes: 'bg-amber-100 text-amber-800' },
  commissioned:  { label: 'Commissionnée',               classes: 'bg-indigo-100 text-indigo-800' },
  livree:        { label: 'Projet livré',                classes: 'bg-emerald-100 text-emerald-800' },
  // Statuts whitepaper / rapport de maintenance (mig 140/203)
  draft:         { label: 'Brouillon',                   classes: 'bg-gray-100 text-gray-700' },
  published:     { label: 'Publié',                      classes: 'bg-emerald-100 text-emerald-800' },
}
</script>

<template>
  <span
    :class="['inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-full', config[status]?.classes || 'bg-gray-100 text-gray-700']"
    v-tooltip="docStatusTip(status, kind)"
  >
    {{ config[status]?.label || status }}
  </span>
</template>
