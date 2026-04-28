<script setup>
/**
 * Modale "Générer la description avec Claude Desktop".
 *
 * Construit un prompt complet, autonome, prêt à coller dans Claude Desktop,
 * qui inclut :
 *   - Le positionnement Buildy (non-GTB, supervision/hypervision agnostique)
 *   - Les 8 règles strictes de rédaction
 *   - Le format de sortie attendu (HTML aéré)
 *   - L'exemple de référence CTA
 *   - Les infos de l'équipement courant
 *
 * Bouton "Copier le prompt" → presse-papier.
 */
import { computed, ref } from 'vue'
import { ClipboardDocumentIcon, CheckIcon, SparklesIcon } from '@heroicons/vue/24/outline'
import BaseModal from './BaseModal.vue'
import { useNotification } from '@/composables/useNotification'

const props = defineProps({
  template: { type: Object, required: true },
})
const emit = defineEmits(['close'])
const { success } = useNotification()

const copied = ref(false)

const prompt = computed(() => {
  const t = props.template
  return `Tu es un ingénieur GTB rédacteur d'analyses fonctionnelles (AF) pour Buildy. Tu vas rédiger la **description fonctionnelle** d'un équipement pour la bibliothèque Buildy AF, dans le respect ABSOLU des règles ci-dessous.

═══════════════════════════════════════════════════════════════════════
POSITIONNEMENT BUILDY (à respecter dans toute la description)
═══════════════════════════════════════════════════════════════════════

Buildy est une **solution logicielle de supervision et d'hypervision** des bâtiments tertiaires, **multi-sites et multi-systèmes**, **agnostique des marques, modèles et protocoles**.

Buildy n'est PAS un intégrateur GTB classique (type Schneider EcoStruxure / Siemens Desigo). Buildy ne refait JAMAIS la régulation des équipements. Chaque système (CTA, chaudière, DRV, éclairage…) **reste autonome et indépendant** avec sa propre régulation native (fournie par le fabricant) ou sa régulation paramétrée par l'intégrateur du système concerné (chaufferiste, frigoriste, intégrateur process, électricien…).

Buildy intervient EN AVAL, en interconnectant les équipements existants entre eux pour assurer :
- l'interopérabilité (R175-1 §7)
- le pilotage à distance (lecture états/mesures + transmission commandes/consignes)
- la conformité au décret BACS (suivi continu, alarmes, arrêt manuel, gestion autonome)
- les logiques applicatives transverses (programmations horaires, scénarios par usage, mise en cohérence multi-systèmes)

═══════════════════════════════════════════════════════════════════════
RÈGLES STRICTES DE RÉDACTION (8 critères)
═══════════════════════════════════════════════════════════════════════

1. **Agnostique** des marques, fabricants et protocoles. Pas de Schneider, Daikin, Modbus, BACnet dans le texte. Les protocoles vont dans un champ séparé.

2. **Pas de référence à des zones ou locaux du bâtiment** (parking, bureau, salle, étage, niveau N1…). Parler des USAGES (chauffage, climatisation, ECS, sanitaires, process) sans citer d'emplacement.

3. **Pas de liste de points exhaustive** dans la description. Les points typiques sont fournis dans un tableau séparé.

4. **Ne pas inventer**. S'appuyer sur la connaissance métier GTB générique. Si une info précise manque, la formuler de manière neutre.

5. **Analyse fonctionnelle**, pas un manuel utilisateur. Décrire ce que fait l'équipement et comment Buildy interagit avec, pas comment configurer.

6. **Types de données autorisés** dans les tableaux : Mesure, État, Alarme, Commande, Consigne uniquement.

7. **AUCUNE programmation horaire** dans la régulation des équipements. Toutes les programmations, scénarios, calendriers, horloges astronomiques, déclenchements par usage sont portés par la solution Buildy au-dessus des régulations natives.

8. **Insister explicitement** que la régulation de l'équipement est portée par l'équipement lui-même, en précisant la source : soit fournie nativement par le fabricant, soit portée par l'intégrateur du système concerné lors de sa mise en service. Bien préciser que cet intégrateur n'est PAS Buildy.

═══════════════════════════════════════════════════════════════════════
FORMAT DE SORTIE ATTENDU
═══════════════════════════════════════════════════════════════════════

Renvoie UNIQUEMENT du HTML simple (compatible Tiptap), structuré en **3 à 4 paragraphes courts** (1 idée = 1 \`<p>\`), avec :
- éventuellement un \`<ul>\` pour les définitions BACS multiples
- \`<strong>\` pour mettre en évidence les phrases-clés (régulation par l'équipement, BACS applicable, etc.)
- pas de classes CSS, pas de \`<div>\`, pas de \`<h1/h2/h3>\` (les titres sont gérés par l'app)

Structure type :
\`\`\`
<p>[1 phrase] Description courte de ce qu'est l'équipement et de sa fonction.</p>

<p>[1-2 phrases] Cadrage BACS si applicable : à quel(s) titre(s) l'équipement est concerné par le décret BACS (référence aux articles R175-X §Y).</p>

<p><strong>La régulation de l'équipement est assurée par l'équipement lui-même</strong>, [préciser la source : fabricant et/ou intégrateur du système concerné, avec exemple de métier]. Cette régulation pilote [fonctions techniques bas niveau].</p>

<p>La solution Buildy intervient en aval : elle supervise [états/mesures] et transmet [commandes/consignes]. Elle porte les logiques applicatives transverses (programmations horaires, scénarios par usage, mise en cohérence multi-systèmes) [si pertinent].</p>
\`\`\`

═══════════════════════════════════════════════════════════════════════
EXEMPLE DE RÉFÉRENCE — Centrale de traitement d'air (CTA)
═══════════════════════════════════════════════════════════════════════

\`\`\`html
<p>Une centrale de traitement d'air assure le renouvellement, le filtrage et le conditionnement de l'air insufflé dans le bâtiment.</p>

<p>Selon sa configuration, une CTA peut être concernée par une ou plusieurs définitions du décret BACS :</p>
<ul>
<li>Système de ventilation (R175-1 §3) — dans tous les cas</li>
<li>Système de chauffage (R175-1 §1) — si la CTA intègre une batterie de chauffe</li>
<li>Système de climatisation (R175-1 §2) — si la CTA intègre une batterie de froid</li>
</ul>

<p><strong>La régulation de la CTA est assurée par l'équipement lui-même</strong>, via la régulation embarquée fournie par le fabricant ou via une régulation portée par l'intégrateur du lot CVC (frigoriste, intégrateur ventilation) lors de la mise en service. Cette régulation gère en autonomie la logique de fonctionnement bas niveau : séquences chaud/froid, modulation, sécurités.</p>

<p>La solution Buildy intervient en aval, en interconnectant la CTA aux autres systèmes du bâtiment. Elle supervise les états et mesures, transmet les commandes et consignes nécessaires, et porte les logiques applicatives transverses (programmations horaires, scénarios par usage, mise en cohérence multi-systèmes).</p>
\`\`\`

═══════════════════════════════════════════════════════════════════════
ÉQUIPEMENT À RÉDIGER
═══════════════════════════════════════════════════════════════════════

- **Nom** : ${t.name}
- **Catégorie** : ${t.category || '(non catégorisé)'}
- **Slug** : ${t.slug}
- **Référence(s) BACS applicable(s)** : ${t.bacs_articles || '(aucune — l\'équipement n\'est pas directement visé par le décret BACS, ne pas mentionner BACS dans la description)'}
- **Protocoles techniques exigés** (à NE PAS mentionner dans la description) : ${t.preferred_protocols || '(aucun)'}

═══════════════════════════════════════════════════════════════════════

Génère maintenant la description fonctionnelle de cet équipement en respectant à la lettre les règles ci-dessus. Renvoie UNIQUEMENT le HTML, sans préambule, sans commentaire, sans markdown.`
})

async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(prompt.value)
    copied.value = true
    success('Prompt copié — colle-le maintenant dans Claude Desktop')
    setTimeout(() => { copied.value = false }, 3000)
  } catch {
    // Fallback : sélectionner le texte
    const ta = document.querySelector('textarea[data-claude-prompt]')
    if (ta) { ta.focus(); ta.select() }
  }
}
</script>

<template>
  <BaseModal title="Générer la description avec Claude Desktop" size="lg" @close="emit('close')">
    <div class="space-y-4">
      <div class="bg-violet-50 border border-violet-200 px-4 py-3 text-xs text-violet-900 leading-relaxed">
        <p class="font-medium mb-1 inline-flex items-center gap-1.5">
          <SparklesIcon class="w-4 h-4" />
          Comment utiliser ce prompt
        </p>
        <ol class="list-decimal pl-5 space-y-0.5">
          <li>Clique sur <strong>« Copier le prompt »</strong> ci-dessous.</li>
          <li>Ouvre <strong>Claude Desktop</strong> (ou claude.ai) et colle le prompt dans une nouvelle conversation.</li>
          <li>Claude génère la description HTML respectant les 8 règles Buildy.</li>
          <li>Copie le HTML généré et colle-le dans le champ <strong>« Description fonctionnelle »</strong> de l'équipement.</li>
        </ol>
      </div>

      <div>
        <label class="block text-xs font-medium text-gray-700 mb-1">Prompt complet ({{ prompt.length }} caractères)</label>
        <textarea
          data-claude-prompt
          :value="prompt"
          readonly
          rows="14"
          class="w-full px-3 py-2 border border-gray-300 text-[11px] font-mono leading-snug focus:outline-none focus:ring-2 focus:ring-violet-500 resize-y"
        ></textarea>
      </div>
    </div>
    <template #footer>
      <button @click="emit('close')" class="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">Fermer</button>
      <button
        @click="copyPrompt"
        :class="['px-3 py-1.5 text-xs text-white inline-flex items-center gap-1.5', copied ? 'bg-emerald-600' : 'bg-violet-600 hover:bg-violet-700']"
      >
        <CheckIcon v-if="copied" class="w-4 h-4" />
        <ClipboardDocumentIcon v-else class="w-4 h-4" />
        {{ copied ? 'Copié !' : 'Copier le prompt' }}
      </button>
    </template>
  </BaseModal>
</template>
