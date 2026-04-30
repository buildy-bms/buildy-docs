<script setup>
import { ref, computed } from 'vue'
import { InformationCircleIcon } from '@heroicons/vue/24/outline'

/**
 * Tooltip explicatif pour un article R175 du décret BACS.
 * Affiche le texte complet de l'article au hover, avec un peu de contexte
 * pour aider l'auditeur à comprendre l'enjeu de la section.
 *
 * Usage : <R175Tooltip article="R175-1 §6" />
 *         <R175Tooltip article="R175-3" />
 *         <R175Tooltip><p>Texte custom HTML</p></R175Tooltip>
 *
 * Le contenu est en dur côté front (extrait des articles seedés) — éviter
 * d'aller chercher un endpoint à chaque survol.
 */
const props = defineProps({
  article: { type: String, default: null },
  title: { type: String, default: null }, // override du titre auto
})

const open = ref(false)
let timer = null

function show() {
  clearTimeout(timer)
  open.value = true
}
function hideDelayed() {
  clearTimeout(timer)
  timer = setTimeout(() => { open.value = false }, 150)
}

// Extraits abrégés des articles R175 (seuls les points clés pour la saisie)
const ARTICLE_SUMMARIES = {
  'R175-1': {
    title: 'R175-1 — Définitions',
    body: `Définit les systèmes techniques du bâtiment (chauffage, climatisation, ventilation, ECS, éclairage intégré, automatisation et contrôle, production électrique sur site), la <strong>zone fonctionnelle</strong> (espace dans lequel les usages sont homogènes) et l'<strong>interopérabilité</strong> (capacité d'un produit à communiquer et interagir avec d'autres dans le respect des exigences de sécurité).`,
  },
  'R175-1 §4': {
    title: 'R175-1 §4 — Systèmes techniques de bâtiment',
    body: `Tout équipement technique de chauffage, refroidissement, ventilation, production d'eau chaude sanitaire, éclairage intégré, automatisation et contrôle des bâtiments, production d'électricité sur site, ou combinant plusieurs de ces systèmes.<br/><br/>L'audit identifie pour chaque zone les systèmes attendus, leur présence effective et leurs équipements (marque, modèle, énergie, puissance, communication).`,
  },
  'R175-1 §6': {
    title: 'R175-1 §6 — Zone fonctionnelle',
    body: `Toute zone dans laquelle les usages sont homogènes (open-space tertiaire, salle de réunion, atelier, local technique, parking…). Le découpage zonal est la base du suivi R175-3 §1 : <strong>chaque zone doit être suivie indépendamment</strong>.`,
  },
  'R175-2': {
    title: 'R175-2 — Champ d\'application',
    body: `Le décret BACS s'applique aux bâtiments tertiaires dotés d'une puissance nominale utile <strong>cumulée chauffage + climatisation</strong> :<br/>· <strong>&gt; 290 kW</strong> : échéance 1<sup>er</sup> janvier 2025 (immédiate pour les permis postérieurs au 8 avril 2024)<br/>· <strong>70 à 290 kW</strong> : échéance 1<sup>er</sup> janvier 2027<br/>· <strong>&lt; 70 kW</strong> : non assujetti.<br/><br/>Une clause de dispense existe si le TRI des travaux dépasse 10 ans (à la charge du propriétaire — Buildy ne calcule pas le TRI).`,
  },
  'R175-3': {
    title: 'R175-3 — 4 exigences fonctionnelles',
    body: `<strong>P1.</strong> Suivi continu, à pas horaire, conservation 5 ans (capacité de la GTB)<br/><strong>P2.</strong> Détection des pertes d'efficacité (capacité de la GTB)<br/><strong>P3.</strong> Interopérabilité (par système : protocole standard ouvert)<br/><strong>P4.</strong> Arrêt manuel + reprise autonome (par équipement)`,
  },
  'R175-3 §1': {
    title: 'R175-3 §1 — Suivi continu et conservation',
    body: `La consommation énergétique des systèmes techniques doit être suivie en continu, à pas horaire, et les données conservées à l'échelle mensuelle pendant 5 ans minimum. Un compteur de chaque énergie (gaz, électricité, fioul, réseau de chaleur…) est requis au niveau du bâtiment, et un sous-comptage par zone fonctionnelle pour les usages chauffage / refroidissement / ECS / éclairage.`,
  },
  'R175-3 §3': {
    title: 'R175-3 §3 — Interopérabilité',
    body: `Les systèmes techniques doivent pouvoir communiquer entre eux dans le respect des exigences de sécurité. Buildy considère un équipement <strong>communicant</strong> s'il expose au moins un protocole standard ouvert : <strong>BACnet/IP, BACnet MS/TP, Modbus TCP, Modbus RTU, KNX, M-Bus, MQTT, LoRaWAN</strong>.`,
  },
  'R175-3 §4': {
    title: 'R175-3 §4 — Arrêt manuel + fonctionnement autonome',
    body: `Chaque équipement doit pouvoir être <strong>arrêté manuellement</strong> par l'utilisateur, et la GTB doit ensuite <strong>reprendre la main de manière autonome</strong> sans intervention humaine. Buildy évalue ces 2 critères individuellement par équipement.`,
  },
  'R175-4': {
    title: 'R175-4 — Vérifications périodiques',
    body: `Le BACS doit faire l'objet de <strong>vérifications périodiques</strong> documentées par des consignes écrites de maintenance. Buildy vérifie l'existence de ces consignes ; leur absence constitue une non-conformité majeure.<br/><br/><em>Bonus commercial :</em> R175-4 dispense les bâtiments équipés d'un BACS conforme des contrôles R224-31 à R224-41-3 (générateurs).`,
  },
  'R175-5': {
    title: 'R175-5 — Formation de l\'exploitant',
    body: `L'exploitant du BACS doit être formé à son paramétrage. Buildy demande la preuve documentée de cette formation.<br/><br/><strong>Particularité Buildy :</strong> lorsque la solution déployée est Buildy, cette exigence est <strong>nativement couverte</strong> par le support utilisateur intégré (assistance contextuelle, documentation embarquée, support continu).`,
  },
  'R175-6': {
    title: 'R175-6 — Régulation thermique automatique',
    body: `Une régulation thermique automatique <strong>par pièce ou par zone</strong> doit être installée, appréciée à l'installation ou au remplacement du générateur de chaleur. Les appareils indépendants de chauffage au bois bénéficient d'une exemption explicite.`,
  },
}

const data = computed(() => {
  if (!props.article) return null
  return ARTICLE_SUMMARIES[props.article] || {
    title: props.title || props.article,
    body: `Aucun résumé disponible pour ${props.article}. Consulte le texte intégral en annexe A du PDF d'audit.`,
  }
})
</script>

<template>
  <span class="relative inline-flex items-center" @mouseenter="show" @mouseleave="hideDelayed">
    <button type="button" class="text-gray-400 hover:text-indigo-600 transition" tabindex="-1">
      <InformationCircleIcon class="w-4 h-4" />
    </button>
    <transition
      enter-active-class="transition ease-out duration-100"
      enter-from-class="opacity-0 translate-y-1"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="open"
           class="absolute z-50 left-0 top-6 w-96 bg-white border border-gray-200 rounded-lg shadow-xl p-3 text-sm"
           @mouseenter="show" @mouseleave="hideDelayed">
        <div class="font-semibold text-gray-800 mb-1.5">{{ data?.title || article }}</div>
        <div class="text-gray-600 text-xs leading-relaxed" v-html="data?.body" />
        <slot />
      </div>
    </transition>
  </span>
</template>
