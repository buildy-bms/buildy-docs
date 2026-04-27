'use strict';

/**
 * Decret BACS — Articles R175-1 a R175-6 du Code de la construction et de
 * l'habitation (decret n°2023-259 du 7 avril 2023).
 *
 * Source : page Notion "Decret BACS"
 * https://www.notion.so/19a6af1b001d80a1894bf142412d06d8
 *
 * Utilise pour :
 *   - Annexe optionnelle du PDF AF (option a l'export)
 *   - Tooltip / lien sur les badges ⚖️ Decret BACS
 *
 * V1 : titres et synthese uniquement. Le contenu integral des articles sera
 * fetched depuis Notion via un script de re-seed dedie (cf. routes/admin reseed-bacs).
 */

const BACS_ARTICLES = [
  {
    code: 'R175-1',
    title: 'Definitions des systemes couverts par le decret',
    sections: [
      { num: '§1', title: 'Systemes de chauffage' },
      { num: '§2', title: 'Systemes de climatisation' },
      { num: '§3', title: 'Systemes de ventilation' },
      { num: '§4', title: 'Autres systemes techniques (eclairage, ECS, production d\'electricite, etc.)' },
    ],
    summary: 'Liste les systemes techniques du batiment concernes par le decret, sur lesquels la GTB doit acquerir des donnees et permettre des actions.',
  },
  {
    code: 'R175-2',
    title: 'Champ d\'application',
    summary: 'Definit les batiments tertiaires et types d\'usage soumis aux exigences du decret BACS.',
  },
  {
    code: 'R175-3',
    title: 'Quatre exigences fonctionnelles auxquelles la GTB doit repondre',
    sections: [
      { num: '§1', title: 'Suivi, enregistrement et analyse en continu des donnees energetiques a pas horaire, conservees mensuellement 5 ans' },
      { num: '§2', title: 'Detection des pertes d\'efficacite par rapport a des valeurs de reference, information de l\'exploitant' },
      { num: '§3', title: 'Interoperabilite avec les systemes techniques' },
      { num: '§4', title: 'Arret manuel et gestion autonome' },
    ],
    summary: 'Article central : les 4 exigences que la solution Buildy adresse via Hyperveez (acquisition, alarmes, multi-protocoles, programmations horaires).',
  },
  {
    code: 'R175-4',
    title: 'Echeances de mise en conformite',
    summary: 'Calendrier reglementaire d\'application des exigences selon les annees et puissances installees.',
  },
  {
    code: 'R175-5',
    title: 'Inspection periodique et controles',
    sections: [
      { num: '5-1', title: 'Inspection periodique obligatoire avec presentation de l\'analyse fonctionnelle' },
    ],
    summary: 'Article qui fonde l\'existence du present document : l\'AF est presentee lors de chaque inspection periodique.',
  },
  {
    code: 'R175-6',
    title: 'Sanctions et controle',
    summary: 'Modalites de sanction en cas de non-conformite.',
  },
];

// Mapping rapide article → titre court (utilise par les badges et tooltips)
const ARTICLE_TITLES = Object.fromEntries(
  BACS_ARTICLES.map(a => [a.code, a.title])
);

module.exports = { BACS_ARTICLES, ARTICLE_TITLES };
