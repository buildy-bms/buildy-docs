<script setup>
/**
 * Modale d'aide pédagogique « Comprendre la zone fonctionnelle » (item 7a).
 *
 * Le découpage en zones fonctionnelles est le point le plus mal compris du
 * décret BACS. Cette modale explique le principe avec des exemples concrets.
 * Accessible depuis l'icône « ? » de la section Zones et depuis la modale
 * d'ajout de zone. Pleine largeur en PWA pour rester lisible au tactile.
 */
import BaseModal from '@/components/BaseModal.vue'

defineEmits(['close'])
</script>

<template>
  <BaseModal title="Comprendre la zone fonctionnelle" size="xl" @close="$emit('close')">
    <div class="space-y-5 text-sm leading-relaxed text-gray-700">

      <!-- Définition -->
      <section>
        <h3 class="text-base font-semibold text-gray-900 mb-1.5">Ce qu'est une zone fonctionnelle</h3>
        <p>
          Une zone fonctionnelle <strong>n'est pas une pièce</strong>. C'est un ensemble de
          locaux qu'on suit ensemble du point de vue de l'énergie — une
          <strong>unité de suivi</strong>.
        </p>
      </section>

      <!-- Le test en une question -->
      <div class="rounded-xl bg-indigo-50 border border-indigo-200 p-4">
        <p class="text-xs font-semibold uppercase tracking-wider text-indigo-700 mb-1.5">
          Le test en une question
        </p>
        <p class="text-gray-800">
          « Est-ce que ça a du sens de suivre la consommation de cette zone
          séparément du reste ? »
        </p>
        <p class="mt-1.5 text-gray-700">
          <strong>Oui</strong> → c'est une zone fonctionnelle.
          <strong>Non</strong> → ça fait partie d'une zone plus large.
        </p>
      </div>

      <!-- Les 3 conditions -->
      <section>
        <h3 class="text-base font-semibold text-gray-900 mb-1.5">Les 3 conditions pour créer une zone séparée</h3>
        <p class="mb-2">Les <strong>trois</strong> doivent être réunies :</p>
        <ol class="space-y-2">
          <li class="flex gap-2.5">
            <span class="shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-semibold inline-flex items-center justify-center">1</span>
            <span>L'usage est <strong>vraiment différent</strong> — activité <em>ou</em> horaires différents.</span>
          </li>
          <li class="flex gap-2.5">
            <span class="shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-semibold inline-flex items-center justify-center">2</span>
            <span>Le poste <strong>pèse assez lourd</strong> pour mériter un suivi (cf. règle des 5 %).</span>
          </li>
          <li class="flex gap-2.5">
            <span class="shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-semibold inline-flex items-center justify-center">3</span>
            <span>Le suivi séparé est <strong>techniquement faisable</strong>.</span>
          </li>
        </ol>
        <p class="mt-2 text-gray-600 italic">Si une seule condition manque → on regroupe.</p>
      </section>

      <!-- Exemples -->
      <section class="space-y-3">
        <h3 class="text-base font-semibold text-gray-900">Trois exemples concrets</h3>

        <div class="rounded-lg border border-gray-200 p-3.5">
          <p class="font-semibold text-gray-900 mb-1">Exemple 1 — Plateforme logistique</p>
          <p>
            Un plot de bureaux + 2 cellules logistiques = <strong>3 zones fonctionnelles,
            pas 15</strong>. Les vestiaires, sanitaires, circulations et salles de réunion
            sont <strong>inclus dans le plot de bureaux</strong> : même rythme, poids
            négligeable, pas de compteur dédié.
          </p>
        </div>

        <div class="rounded-lg border border-gray-200 p-3.5">
          <p class="font-semibold text-gray-900 mb-1">Exemple 2 — École</p>
          <p>
            Restaurant scolaire + salles de classe. Pour le <strong>chauffage</strong>
            (1 chaudière, circuit unique) → <strong>1 seule zone fonctionnelle</strong>.
            Pour l'<strong>éclairage</strong> (tableaux électriques distincts) →
            <strong>2 zones fonctionnelles</strong>.
          </p>
          <p class="mt-1.5 text-gray-600 italic">
            La zone fonctionnelle peut donc différer selon le système technique concerné.
          </p>
        </div>

        <div class="rounded-lg border border-gray-200 p-3.5">
          <p class="font-semibold text-gray-900 mb-1">Exemple 3 — Immeuble de bureaux R+3</p>
          <p>
            Même usage à tous les étages. Si 1 circuit de chauffage par étage avec
            compteur → <strong>3 zones fonctionnelles</strong>. Si colonnes montantes
            communes → <strong>1 seule</strong>.
          </p>
          <p class="mt-1.5 text-gray-600 italic">
            La technique tranche quand l'usage est homogène.
          </p>
        </div>
      </section>

      <!-- Quand on découpe quand même / ce qu'on ne découpe jamais -->
      <div class="grid sm:grid-cols-2 gap-3">
        <div class="rounded-lg bg-emerald-50 border border-emerald-200 p-3.5">
          <p class="text-xs font-semibold uppercase tracking-wider text-emerald-700 mb-1.5">
            Quand on découpe quand même
          </p>
          <p class="text-gray-700 mb-1.5">Dans un plot de bureaux :</p>
          <ul class="space-y-1 list-disc list-inside text-gray-700">
            <li>une salle serveurs / data center (clim dédiée 24/7, horaires différents, poids réel) ;</li>
            <li>un restaurant d'entreprise avec cuisine (gros poste, horaires décalés).</li>
          </ul>
        </div>
        <div class="rounded-lg bg-amber-50 border border-amber-200 p-3.5">
          <p class="text-xs font-semibold uppercase tracking-wider text-amber-700 mb-1.5">
            Ce qu'on ne découpe jamais
          </p>
          <ul class="space-y-1 list-disc list-inside text-gray-700">
            <li>vestiaires ;</li>
            <li>sanitaires ;</li>
            <li>circulations ;</li>
            <li>local de rangement.</li>
          </ul>
        </div>
      </div>
    </div>

    <template #footer>
      <button type="button" @click="$emit('close')"
              class="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">
        J'ai compris
      </button>
    </template>
  </BaseModal>
</template>
