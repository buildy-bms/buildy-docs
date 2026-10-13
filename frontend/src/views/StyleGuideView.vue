<script setup>
// Galerie des infobulles (route cachée /style-guide, 2026-10-12) : chaque format et chaque cas
// limite, survolable pour de vrai. Sert de référence visuelle et de banc d'essai (Playwright).
import { ref } from 'vue'
import TipLabel from '@/components/tooltip/TipLabel.vue'
import TipCard from '@/components/tooltip/TipCard.vue'
import Tooltip from '@/components/Tooltip.vue'
import HelpTip from '@/components/HelpTip.vue'
import R175Tooltip from '@/components/R175Tooltip.vue'
import SegmentedToggle from '@/components/audit/SegmentedToggle.vue'
import '@/lib/tooltip-icons'
import { normalizeTip, ACCENTS } from '@/lib/tooltip-content'

const labels = [
  'Supprimer ce compteur',
  'Dupliquer le système',
  'Aperçu du rapport',
  { label: 'Gras', keys: ['Mod', 'B'] },
  'Valider l’étape',
]
const infoLabels = ['Dernière sauvegarde à 08:15', 'Bureaux du 2e étage — aile nord']

const cards = [
  {
    title: 'Compteur requis absent',
    tone: 'error',
    text: 'Il faut mesurer l’électricité de la ventilation de cette zone, heure par heure.',
    rows: [
      { label: 'Zone', value: 'Circulation X' },
      { label: 'Usage', value: 'Ventilation', accent: 'ventilation' },
    ],
    todo: 'Ajoute un compteur, ou indique qu’il est présent sur le site.',
    article: 'R175-3',
  },
  {
    title: 'Présence à vérifier',
    tone: 'warning',
    text: 'Personne n’a encore dit si ce compteur existe sur le site. Le rapport l’indiquera « à qualifier ».',
    todo: 'Réponds Oui ou Non dans la colonne Présent.',
  },
  {
    title: 'Équipement complet',
    tone: 'success',
    text: 'Toutes les informations utiles au rapport sont renseignées.',
  },
  {
    title: 'Zone fonctionnelle',
    tone: 'info',
    text: 'Ensemble de locaux aux usages homogènes : mêmes activités, mêmes horaires.',
    article: 'R175-1 6°',
  },
  {
    title: 'Usage non concerné',
    tone: 'neutral',
    text: 'Cette zone n’a pas de climatisation. Rien n’est attendu pour cet usage.',
  },
]

const ACCENT_NAMES = {
  heating: 'Chauffage', cooling: 'Refroidissement', ventilation: 'Ventilation', dhw: 'Eau chaude sanitaire',
  lighting: 'Éclairage', lighting_indoor: 'Éclairage intérieur', lighting_outdoor: 'Éclairage extérieur',
  electricity_production: 'Production d’électricité', pv: 'Photovoltaïque', electric: 'Électricité',
  electric_production: 'Électricité produite', gas: 'Gaz', water: 'Eau', thermal: 'Énergie thermique', other: 'Autre',
  site: 'Phase Site', equipment: 'Phase Équipements', supervision: 'Phase Supervision', dossier: 'Phase Dossier',
  role_production: 'Rôle Production', role_distribution: 'Rôle Distribution', role_emission: 'Rôle Émission',
  role_regulation: 'Rôle Régulation', role_other: 'Rôle Autre',
}
const accents = Object.keys(ACCENTS).map((k) => ({
  key: ACCENT_NAMES[k] || k,
  tip: { title: ACCENT_NAMES[k] || k, accent: k, text: 'Icône et couleur reprises de l’application.' },
}))

const edges = [
  { cls: 'left-2 top-2', tip: 'Coin haut gauche : la bulle passe dessous' },
  { cls: 'right-2 top-2', tip: 'Coin haut droit : la bulle reste à l’écran' },
  { cls: 'left-2 bottom-2', tip: { title: 'Coin bas gauche', text: 'La carte passe au-dessus et reste entière à l’écran.' } },
  { cls: 'right-2 bottom-2', tip: { title: 'Coin bas droit', text: 'La carte passe au-dessus, à distance du bord de l’écran.', tone: 'warning' } },
]

const toggle = ref(null)
const disabledReason = { title: 'Pas encore disponible', tone: 'neutral', text: 'Réponds d’abord à la question « Intégré à la GTB ».' }
const longName = 'Centrale de traitement d’air double flux du bâtiment B, niveau R+2, aile est (bureaux paysagers)'
</script>

<template>
  <div class="max-w-6xl mx-auto space-y-10 pb-24">
    <header>
      <h1 class="text-xl font-medium text-gray-900">Galerie des infobulles</h1>
      <p class="text-sm text-gray-500 mt-1">Survole chaque élément. Toutes les bulles sont navy ; les règles sont dans CLAUDE.md § « Infobulles (UI) ».</p>
    </header>

    <section class="space-y-3">
      <h2 class="text-sm font-medium text-gray-700">Étiquettes — rendu</h2>
      <div class="flex flex-wrap items-start gap-4 bg-gray-100 rounded-xl p-5">
        <TipLabel v-for="(l, i) in labels" :key="i" :tip="normalizeTip(l)" :arrow="null" />
        <TipLabel v-for="(l, i) in infoLabels" :key="'i' + i" :tip="normalizeTip(l)" variant="info" :arrow="null" />
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <button v-for="(l, i) in labels" :key="'b' + i" v-tooltip="l" class="btn-secondary text-xs">Survol {{ i + 1 }}</button>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-medium text-gray-700">Cartes — tons</h2>
      <div class="flex flex-wrap items-start gap-4 bg-gray-100 rounded-xl p-5">
        <TipCard v-for="(c, i) in cards" :key="i" :tip="normalizeTip(c)" />
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <span v-for="(c, i) in cards" :key="'s' + i" v-tooltip="c" class="px-2 py-1 rounded-full bg-white ring-1 ring-gray-200 text-xs text-gray-700">{{ c.title }}</span>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-medium text-gray-700">Accents métier</h2>
      <div class="flex flex-wrap gap-2">
        <span v-for="a in accents" :key="a.key" v-tooltip="a.tip" class="px-2 py-1 rounded-full bg-white ring-1 ring-gray-200 text-xs text-gray-700">{{ a.key }}</span>
      </div>
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-medium text-gray-700">Cas limites</h2>
      <div class="flex flex-wrap items-center gap-6">
        <Tooltip :text="disabledReason">
          <button type="button" class="btn-primary text-xs" disabled>Bouton grisé</button>
        </Tooltip>
        <SegmentedToggle v-model="toggle" disabled tooltip="Réponds d’abord à la question précédente" />
        <span class="inline-block w-48 truncate text-sm text-gray-700" v-tooltip.overflow>{{ longName }}</span>
        <HelpTip title="Aide d’une colonne" text="Une icône ⓘ ouvre une carte, aussi au doigt." />
        <span class="inline-flex items-center gap-1 text-sm text-gray-700">Article du décret <R175Tooltip article="R175-3 1°" /></span>
      </div>
      <div v-tooltip="{ title: 'Ligne entière', text: 'Sur une ligne large, la bulle se place au-dessus du curseur, pas au milieu de la ligne.' }"
           class="flex items-center justify-between rounded-lg bg-white ring-1 ring-gray-200 px-4 py-3 text-sm text-gray-700">
        <span>Ligne de tableau large (survole à gauche puis à droite)</span>
        <button type="button" v-tooltip="'Supprimer cette ligne'" class="text-gray-400 hover:text-red-600 px-2">✕</button>
      </div>
      <div class="relative h-56 rounded-xl bg-gray-100 ring-1 ring-gray-200">
        <span v-for="(e, i) in edges" :key="i" :class="['absolute px-2 py-1 rounded bg-white ring-1 ring-gray-300 text-xs', e.cls]" v-tooltip="e.tip">Bord {{ i + 1 }}</span>
      </div>
    </section>
  </div>
</template>
