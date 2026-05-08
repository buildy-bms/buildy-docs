<script setup>
/**
 * Sélecteur tactile basé sur `<select>` natif (picker système iOS).
 * Sur mobile, c'est l'expérience la plus rapide : un tap ouvre la roue
 * iOS, un autre la ferme. Pas de popover Vue à gérer, pas de scroll
 * concurrent.
 *
 * Mode `creatable` : ajoute une option terminale « ✏️ Autre — saisir »
 * qui, quand sélectionnée, révèle un input texte en-dessous où
 * l'auditeur tape sa propre valeur. La valeur sortante reste une string
 * (qu'elle vienne d'une option de la liste OU de l'input libre) pour
 * être strictement compatible avec l'API SearchableSelect existante.
 */
import { computed, ref, nextTick, watch } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number, null], default: null },
  options: {
    type: Array,
    required: true,
    // [{ value: string|number, label: string }]
  },
  placeholder: { type: String, default: '— Sélectionner —' },
  creatable: { type: Boolean, default: false },
  customLabel: { type: String, default: '✏️ Autre — saisir' },
  customPlaceholder: { type: String, default: 'Saisir une valeur…' },
})
const emit = defineEmits(['update:modelValue'])

// Le sélecteur a un sentinel '__custom__' pour le mode creatable. La
// valeur retournée à l'extérieur reste toujours un value brut (string
// ou number), jamais ce sentinel.
const CUSTOM = '__custom__'

const isCustom = computed(() => {
  if (!props.creatable) return false
  const v = props.modelValue
  if (v == null || v === '') return false
  return !props.options.some(o => String(o.value) === String(v))
})

// Valeur affichée par le `<select>`
const selectValue = computed(() => {
  if (isCustom.value) return CUSTOM
  return props.modelValue == null ? '' : String(props.modelValue)
})

const customInput = ref(null)
const customDraft = ref(isCustom.value ? String(props.modelValue) : '')

// Si le parent passe une nouvelle valeur libre, refléter dans l'input.
watch(() => props.modelValue, (v) => {
  if (isCustom.value) customDraft.value = String(v)
})

async function onSelectChange(e) {
  const raw = e.target.value
  if (raw === '') {
    emit('update:modelValue', null)
    return
  }
  if (raw === CUSTOM) {
    // Bascule en mode libre. On ne pousse rien tant que l'utilisateur
    // n'a pas rempli l'input — sauf si un draft pré-existait.
    if (customDraft.value.trim()) {
      emit('update:modelValue', customDraft.value.trim())
    }
    await nextTick()
    customInput.value?.focus()
    return
  }
  // Choix d'une option canonique : on émet la valeur brute (string).
  emit('update:modelValue', raw)
}

function onCustomBlur(e) {
  const v = e.target.value.trim()
  if (!v) {
    // Vidé → revient à null (et le select repasse au placeholder)
    emit('update:modelValue', null)
    customDraft.value = ''
    return
  }
  // Une saisie libre qui matche en fait une option canonique : on
  // canonise pour que la prochaine ouverture du select la sélectionne.
  const matched = props.options.find(o => o.label.trim().toLowerCase() === v.toLowerCase())
  emit('update:modelValue', matched ? matched.value : v)
}
</script>

<template>
  <div class="space-y-2">
    <select
      :value="selectValue"
      @change="onSelectChange"
      class="w-full min-h-11 px-3 py-3 text-base bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
    >
      <option value="">{{ placeholder }}</option>
      <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
      <option v-if="creatable" :value="CUSTOM">{{ customLabel }}</option>
    </select>
    <input
      v-if="isCustom"
      ref="customInput"
      type="text"
      :value="customDraft"
      @input="e => customDraft = e.target.value"
      @blur="onCustomBlur"
      :placeholder="customPlaceholder"
      class="w-full min-h-11 px-3 py-3 text-base bg-white border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
    />
  </div>
</template>
