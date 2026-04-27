'use strict';

/**
 * Decret BACS — Articles R175-1 a R175-6 du Code de la construction et de
 * l'habitation, dans leur version consolidee suite au decret n° 2023-259
 * du 7 avril 2023.
 *
 * Source : page Notion "Decret BACS 2023"
 * https://www.notion.so/buildy/D-cret-BACS-2023-19a6af1b001d80a1894bf142412d06d8
 *
 * Le contenu est rendu en HTML brut dans l'annexe optionnelle du PDF AF.
 */

const BACS_INTRO_HTML = `
<p>Décret n° 2020-887 du 20 juillet 2020 relatif au système d'automatisation et de contrôle des bâtiments tertiaires, modifié par le décret n° 2023-259 du 7 avril 2023, codifié aux articles R175-1 à R175-6 du Code de la construction et de l'habitation.</p>
<p><strong>Principales évolutions du décret 2023 :</strong></p>
<ul>
  <li>Abaissement du seuil de puissance de 290 kW à <strong>70 kW</strong></li>
  <li>Temps de retour sur investissement passé de 6 ans à <strong>10 ans</strong></li>
  <li>Nouvelle obligation d'<strong>inspection périodique</strong> (article R175-5-1)</li>
  <li>Nouvelles échéances pour les bâtiments &gt; 70 kW : permis déposés après le 8 avril 2024 ou existants au plus tard le 1<sup>er</sup> janvier 2027</li>
</ul>
`.trim();

const BACS_ARTICLES = [
  {
    code: 'R175-1',
    title: 'Définitions',
    summary: 'Définitions des systèmes techniques de bâtiment, du système d\'automatisation et de contrôle, des zones fonctionnelles et de l\'interopérabilité.',
    full_html: `
<p>Au sens de la présente section, on entend par :</p>
<ol>
  <li><strong>Système de chauffage</strong> : la combinaison des composantes nécessaires pour assurer l'augmentation contrôlée de la température de l'air intérieur.</li>
  <li><strong>Système de climatisation</strong> : la combinaison des composantes nécessaires pour assurer une forme de traitement de l'air intérieur, par laquelle la température est contrôlée ou peut être abaissée.</li>
  <li><strong>Système de ventilation</strong> : la combinaison des composantes nécessaires pour assurer le renouvellement de l'air intérieur.</li>
  <li><strong>Système technique de bâtiment</strong> : tout équipement technique de chauffage, refroidissement, ventilation, production d'eau chaude sanitaire, éclairage intégré, automatisation et contrôle des bâtiments, production d'électricité sur site, ou combinant plusieurs de ces systèmes, y compris les systèmes utilisant une énergie renouvelable.</li>
  <li><strong>Système d'automatisation et de contrôle de bâtiment</strong> : tout système comprenant tous les produits, logiciels et services d'ingénierie à même de soutenir le fonctionnement efficace sur les plans énergétique et économique, et sûr, des systèmes techniques de bâtiment au moyen de commandes automatiques et en facilitant la gestion manuelle de ces systèmes techniques de bâtiment.</li>
  <li><strong>Zone fonctionnelle</strong> : toute zone dans laquelle les usages sont homogènes.</li>
  <li><strong>Interopérable</strong> : la capacité que possède un produit ou un système à communiquer et interagir avec d'autres produits ou systèmes dans le respect des exigences de sécurité.</li>
  <li><strong>Générateur de chaleur</strong> : la partie du système de chauffage, composée d'une ou plusieurs unités, qui produit la chaleur utile à l'aide d'un ou plusieurs des processus suivants :
    <ul>
      <li>combustion de combustibles ;</li>
      <li>effet Joule, dans les éléments de chauffage d'un système de chauffage à résistance électrique ;</li>
      <li>capture de la chaleur de l'air ambiant, de l'air extrait de la ventilation, ou de l'eau ou d'une source de chaleur souterraine à l'aide d'une pompe à chaleur ;</li>
      <li>échange de chaleur avec un réseau de chaleur urbain ou un système permettant la récupération de chaleur fatale.</li>
    </ul>
  </li>
</ol>
`.trim(),
  },
  {
    code: 'R175-2',
    title: 'Champ d\'application',
    summary: 'Bâtiments tertiaires concernés selon la puissance nominale (> 70 kW depuis 2023, > 290 kW initialement) et calendrier d\'application.',
    full_html: `
<p><strong>I.</strong> Sont munis d'un système d'automatisation et de contrôle, prévu à l'article L. 174-3, les bâtiments dans lesquels sont exercées des activités tertiaires marchandes ou non marchandes, y compris ceux appartenant à des personnes morales du secteur primaire ou secondaire, équipés d'un système de chauffage ou d'un système de climatisation, combiné ou non avec un système de ventilation, dont la puissance nominale utile est supérieure à <strong>70 kW</strong>.</p>
<p>Sont assujettis à ces obligations le ou les propriétaires des systèmes de chauffage ou de climatisation des bâtiments. Pour les bâtiments dont la génération de chaleur ou de froid est produite par échange avec un réseau de chaleur ou de froid urbain, la puissance du générateur à considérer est celle de la station d'échange.</p>
<p><strong>II.</strong> Les obligations sont applicables :</p>
<ol>
  <li>Aux bâtiments &gt; <strong>290 kW</strong> dont le permis de construire est déposé après le 21 juillet 2021 ;</li>
  <li>Aux autres bâtiments &gt; 290 kW, au plus tard le <strong>1<sup>er</sup> janvier 2025</strong> ;</li>
  <li><strong>[Nouveau 2023]</strong> Aux bâtiments &gt; <strong>70 kW</strong> dont le permis de construire est déposé après le 8 avril 2024 ;</li>
  <li><strong>[Nouveau 2023]</strong> Aux autres bâtiments &gt; 70 kW, lors du renouvellement du système ou au plus tard le <strong>1<sup>er</sup> janvier 2027</strong>.</li>
</ol>
<p>Sauf si le propriétaire produit une étude établissant que l'installation d'un système d'automatisation et de contrôle n'est pas réalisable avec un temps de retour sur investissement inférieur à <strong>dix ans</strong>.</p>
`.trim(),
  },
  {
    code: 'R175-3',
    title: 'Exigences techniques des BACS',
    summary: 'Quatre exigences fonctionnelles auxquelles doit répondre le système d\'automatisation et de contrôle.',
    full_html: `
<p>Les systèmes d'automatisation et de contrôle des bâtiments mentionnés à l'article R. 175-2 :</p>
<ol>
  <li><strong>Suivent, enregistrent et analysent en continu</strong>, par zone fonctionnelle et à un pas de temps horaire, les données de production et de consommation énergétique des systèmes techniques du bâtiment et ajustent les systèmes techniques en conséquence. Ces données sont conservées à l'échelle mensuelle pendant <strong>cinq ans</strong>.</li>
  <li><strong>Situent l'efficacité énergétique du bâtiment</strong> par rapport à des valeurs de référence, correspondant aux données d'études énergétiques ou caractéristiques de chacun des systèmes techniques ; ils détectent les pertes d'efficacité des systèmes techniques et informent l'exploitant du bâtiment des possibilités d'amélioration de l'efficacité énergétique.</li>
  <li>Sont <strong>interopérables</strong> avec les différents systèmes techniques du bâtiment.</li>
  <li>Permettent un <strong>arrêt manuel</strong> et la <strong>gestion autonome</strong> d'un ou plusieurs systèmes techniques de bâtiment.</li>
</ol>
<p>Les données produites et archivées sont accessibles au propriétaire du système d'automatisation et de contrôle, qui en a la propriété. Ce dernier les met à disposition du gestionnaire du bâtiment, à sa demande, et transmet à chacun des exploitants des différents systèmes techniques reliés les données qui les concernent.</p>
`.trim(),
  },
  {
    code: 'R175-4',
    title: 'Vérifications périodiques',
    summary: 'Vérifications périodiques par prestataire externe ou personnel interne compétent, encadrées par des consignes écrites.',
    full_html: `
<p>Les systèmes d'automatisation et de contrôle des bâtiments font l'objet, en vue de garantir leur maintien en bon état de fonctionnement, de <strong>vérifications périodiques</strong> par un prestataire externe ou un personnel interne compétent.</p>
<p>Ces vérifications sont encadrées par des consignes écrites données au gestionnaire du système d'automatisation et de contrôle du bâtiment, qui doivent préciser la périodicité des interventions, les points à contrôler et prévoir la réparation rapide ou le remplacement des éléments défaillants.</p>
<p><em>[Modification 2023]</em> Les systèmes techniques reliés à un système d'automatisation et de contrôle des bâtiments sont exemptés des contrôles et inspections prévus par les articles R. 224-31 à R. 224-41-3 et R. 224-45 à R. 224-45-9 du Code de l'environnement.</p>
`.trim(),
  },
  {
    code: 'R175-5',
    title: 'Formation de l\'exploitant',
    summary: 'Le propriétaire veille à ce que l\'exploitant soit formé au fonctionnement et au paramétrage du système.',
    full_html: `
<p>Le propriétaire du système d'automatisation et de contrôle veille à ce que son exploitant soit <strong>formé à son fonctionnement</strong>, notamment en ce qui concerne les modalités de son paramétrage.</p>
`.trim(),
  },
  {
    code: 'R175-5-1',
    title: 'Inspection périodique [nouveau 2023]',
    summary: 'Inspection périodique à l\'initiative du propriétaire : examen de l\'AF, vérification du fonctionnement, évaluation des exigences R175-3, recommandations.',
    full_html: `
<p>À l'initiative de leur propriétaire, les systèmes d'automatisation et de contrôle des bâtiments mentionnés à l'article R. 175-2 sont soumis à <strong>inspection périodique</strong>.</p>
<p>Cette inspection comprend :</p>
<ol>
  <li>S'il s'agit de la première inspection du système, un <strong>examen de l'analyse fonctionnelle</strong> du système ;</li>
  <li>Une <strong>vérification du bon fonctionnement</strong> du système ;</li>
  <li>Une <strong>évaluation du respect des exigences</strong> mentionnées à l'article R. 175-3 et, sauf si le système, les systèmes techniques reliés et les besoins du bâtiment n'ont pas changé depuis la dernière inspection, une évaluation du paramétrage par rapport à l'usage du bâtiment ;</li>
  <li>La fourniture des <strong>recommandations nécessaires</strong> portant sur le bon usage du système, les améliorations possibles, l'intérêt éventuel du remplacement et les autres solutions envisageables.</li>
</ol>
<p>Dans un délai d'un mois, la personne ayant effectué l'inspection remet un <strong>rapport au propriétaire</strong>, qui le conserve pendant <strong>dix ans</strong>.</p>
<p><em>Échéance importante : la première inspection des systèmes en place à la date de publication du décret n° 2023-259 du 7 avril 2023 est effectuée au plus tard le 1<sup>er</sup> janvier 2025.</em></p>
`.trim(),
  },
  {
    code: 'R175-6',
    title: 'Régulation automatique de la chaleur',
    summary: 'Obligation de régulation automatique de la température par pièce ou par zone, à l\'installation ou au remplacement du générateur.',
    full_html: `
<p><strong>I.</strong> Sont assujettis à l'obligation mentionnée à l'article L. 175-2 le ou les propriétaires des émetteurs reliés au générateur installé ou remplacé.</p>
<p><strong>II.</strong> Les dispositions de l'article L. 175-2 ne sont pas applicables dans le cas où le générateur de chaleur du système de chauffage est un appareil indépendant de chauffage au bois.</p>
<p>Sous cette réserve, elles sont applicables :</p>
<ol>
  <li>Dans les bâtiments dont le permis de construire est déposé après le 21 juillet 2021 ;</li>
  <li>Dans les autres bâtiments, dès lors que des travaux d'installation ou de remplacement de générateurs de chaleur y sont engagés à compter du 21 juillet 2021, sauf si les propriétaires produisent une étude établissant que l'installation d'un système automatique de régulation de la température par pièce ou par zone chauffée n'est pas réalisable avec un temps de retour sur investissement inférieur à <strong>dix ans</strong>.</li>
</ol>
`.trim(),
  },
];

const ARTICLE_TITLES = Object.fromEntries(BACS_ARTICLES.map(a => [a.code, a.title]));

module.exports = { BACS_ARTICLES, BACS_INTRO_HTML, ARTICLE_TITLES };
