'use strict';

/**
 * Body HTML riches pour le chapitre 14 « Pourquoi Buildy » du plan AF.
 *
 * - 14.1 (Conformité BACS) + ses 12 sous-sections : body_html figé,
 *   sert de pièce de défense en inspection R175-5-1 et de base brochure.
 * - 14.2 (Cybersécurité) + ses 4 sous-sections : body_placeholder structuré
 *   listant la matière première confirmée en code. Rédaction Kevin + IA.
 * - 14.3 (Cloud) + ses 7 sous-sections : idem placeholder structuré.
 * - 14.4 (Buildy Box) + ses 3 sous-sections : body_html depuis la page
 *   officielle https://www.buildy.fr/projets-gtb-installateurs/.
 *
 * Convention : si la valeur est null, le seeder calcule un placeholder italique
 * gris depuis le `body_placeholder` du node correspondant dans plan-af.js.
 * Si la valeur est une string, c'est utilisé tel quel comme body_html.
 */

// ─── Helpers de rédaction ────────────────────────────────────────────────

const cite = (article, alinea, text) => `<blockquote class="bacs-decret-quote">
<p class="bacs-decret-source"><strong>${article}${alinea ? ' ' + alinea : ''}</strong> du Code de la construction et de l'habitation</p>
<p>« ${text} »</p>
</blockquote>`;

// ─── 14.1 Conformité au décret BACS ──────────────────────────────────────

const BODY_14_1 = `<p>La solution Buildy et les services de l'équipe Buildy fournissent le <strong>système d'automatisation et de contrôle (BACS)</strong> au sens du décret n° 2023-259 du 7 avril 2023 (articles R175-1 à R175-6 du Code de la construction et de l'habitation). En niveau <strong>Premium</strong>, la solution couvre l'intégralité des exigences du décret et dépasse l'exigence réglementaire sur 8 alinéas sur 11.</p>

<p>La conformité BACS d'un bâtiment ne dépend toutefois pas que du BACS lui-même : elle suppose également que les <strong>systèmes techniques</strong> (chauffage, climatisation, ventilation, eau chaude sanitaire, éclairage, production d'électricité sur site) et les <strong>compteurs d'énergie</strong> soient eux-mêmes adéquats et communicants. Ces deux périmètres relèvent du propriétaire et de l'installateur des fluides ; <strong>l'audit BACS Buildy</strong> permet de les diagnostiquer et de produire un plan de mise en conformité chiffré.</p>

<p>Les sous-sections ci-dessous détaillent article par article comment, sur le périmètre BACS qui lui revient, la solution Buildy satisfait — et souvent dépasse — chaque exigence.</p>`;

const BODY_14_1_1 = `${cite('R175-1', null, 'Au sens de la présente section, on entend par : […] 5° Système d\'automatisation et de contrôle de bâtiment : tout système comprenant tous les produits, logiciels et services d\'ingénierie à même de soutenir le fonctionnement efficace sur les plans énergétique et économique, et sûr, des systèmes techniques de bâtiment au moyen de commandes automatiques et en facilitant la gestion manuelle de ces systèmes techniques de bâtiment ; 6° Zone fonctionnelle : toute zone dans laquelle les usages sont homogènes ; 7° Interopérable : la capacité que possède un produit ou un système à communiquer et interagir avec d\'autres produits ou systèmes dans le respect des exigences de sécurité.')}

<p><strong>Réponse Buildy.</strong> La solution Buildy fournit précisément ce système d'automatisation et de contrôle :</p>
<ul>
  <li><strong>Périmètre couvert</strong> : tous les systèmes techniques nommés au R175-1 §1 à §4 sont supervisables — chauffage, climatisation, ventilation, eau chaude sanitaire, éclairage intérieur, production d'électricité sur site (cf. chapitre 2 du présent document).</li>
  <li><strong>Découpage zonal</strong> : le bâtiment est découpé en zones fonctionnelles homogènes dès la section préliminaire « Zones fonctionnelles du bâtiment » de cette AF. Les tableaux de bord et l'historisation respectent ce découpage zonal (cf. ch. 6.1).</li>
  <li><strong>Architecture</strong> : Buildy fournit le système d'automatisation et de contrôle (BACS) au sens R175-1 §5. Les systèmes techniques eux-mêmes (chaudière, PAC, CTA, éclairage…) restent fournis par les installateurs des fluides ; Buildy les supervise et les pilote, la régulation reste autonome côté équipement terrain.</li>
  <li><strong>Interopérabilité</strong> : traitée en détail au chapitre 14.1.5 (R175-3 §3).</li>
</ul>

<p class="text-buildy-note"><em>Note de périmètre : la conformité globale d'un bâtiment au décret BACS suppose que les systèmes techniques et les compteurs d'énergie soient eux-mêmes adéquats et communicants. Ces aspects relèvent du propriétaire et de l'installateur ; l'audit BACS Buildy les diagnostique précisément.</em></p>`;

const BODY_14_1_2 = `${cite('R175-2', null, 'Sont munis d\'un système d\'automatisation et de contrôle […] les bâtiments dans lesquels sont exercées des activités tertiaires […] équipés d\'un système de chauffage ou d\'un système de climatisation, combiné ou non avec un système de ventilation, dont la puissance nominale utile est supérieure à 70 kW. […] Sauf si le propriétaire produit une étude établissant que l\'installation d\'un système d\'automatisation et de contrôle n\'est pas réalisable avec un temps de retour sur investissement inférieur à dix ans.')}

<p><strong>Réponse Buildy.</strong></p>
<ul>
  <li><strong>Solution applicable</strong> au champ d'application complet du décret (bâtiments tertiaires &gt; 70 kW depuis 2023, calendrier 2024 / 2030).</li>
  <li><strong>Calcul du temps de retour sur investissement (TRI 10 ans)</strong> : conformément à la lettre du texte, le TRI est de la responsabilité du <strong>propriétaire</strong>. Buildy ne réalise pas cette étude — elle relève du bureau d'études énergétiques mandaté par le propriétaire.</li>
  <li><strong>Échéance la plus proche</strong> à connaître : <em>1<sup>er</sup> janvier 2030</em> pour les bâtiments &gt; 70 kW existants, ou <em>renouvellement du système</em> si antérieur.</li>
</ul>`;

const BODY_14_1_3 = `${cite('R175-3', '§1', 'Les systèmes d\'automatisation et de contrôle des bâtiments mentionnés à l\'article R. 175-2 […] suivent, enregistrent et analysent en continu, par zone fonctionnelle et à un pas de temps horaire, les données de production et de consommation énergétique des systèmes techniques du bâtiment et ajustent les systèmes techniques en conséquence. Ces données sont conservées à l\'échelle mensuelle pendant cinq ans.')}

<p><strong>Réponse Buildy.</strong> Couverture <strong>renforcée</strong> par rapport au minimum réglementaire :</p>
<ul>
  <li><strong>Acquisition temps réel infra-horaire</strong> : polling cyclique configurable + notifications CoV (Change-of-Value) asynchrones côté équipement (cf. ch. 3.1). Le pas de temps va donc plus fin que l'horaire requis.</li>
  <li><strong>Historisation granulaire séparée</strong> : données brutes, horaires, journalières, mensuelles, chacune avec sa propre rétention (cf. ch. 3.2).</li>
  <li><strong>Conservation 5 ans des données mensuelles</strong> : disponible dès le contrat <em>Smart</em> (5 ans pile), <strong>étendue à 10 ans en Premium</strong>. Le contrat <em>Essentials</em> ne couvre pas cet alinéa (12 mois de rétention mensuelle seulement).</li>
  <li><strong>Découpage par zone fonctionnelle</strong> : les tableaux de bord (cf. ch. 6.1) et les historisations respectent le découpage zonal défini en début d'AF.</li>
  <li><strong>Ajustement des systèmes techniques</strong> : commandes manuelles, programmations horaires et alertes de dérive permettent l'ajustement en continu (cf. ch. 4 et 5).</li>
</ul>`;

const BODY_14_1_4 = `${cite('R175-3', '§2', 'Situent l\'efficacité énergétique du bâtiment par rapport à des valeurs de référence, correspondant aux données d\'études énergétiques ou caractéristiques de chacun des systèmes techniques ; ils détectent les pertes d\'efficacité des systèmes techniques et informent l\'exploitant du bâtiment des possibilités d\'amélioration de l\'efficacité énergétique.')}

<p><strong>Réponse Buildy.</strong> Couverture <strong>renforcée</strong> par un triptyque rare dans les BMS du marché :</p>
<ul>
  <li><strong>Seuils paramétrables compteur par compteur</strong> : l'exploitant entre la valeur de référence de son choix (donnée d'étude énergétique, valeur nominale fabricant, cible interne, performance contractuelle…). Le décret lui-même offre cette latitude par sa formulation « ou ».</li>
  <li><strong>Trois contextes par compteur</strong> : occupation / inoccupation / global. Les seuils diffèrent selon les périodes définies par les programmations horaires hebdomadaires (cf. ch. 6.3).</li>
  <li><strong>Comparaisons inter-périodes</strong> : tableaux de bord mois-à-mois et année-à-année avec mise en évidence des dérives (cf. ch. 6.2).</li>
  <li><strong>Normalisation par Degrés-Jours Unifiés (DJU/DHU)</strong> : annule l'effet climatique pour comparer un mois à l'autre. C'est la méthode standard de la profession (ADEME, audits NF EN 16247) ; rare dans les BMS classiques.</li>
  <li><strong>Information automatique de l'exploitant</strong> : tout franchissement de seuil génère une alarme qualifiée et notifiée (cf. ch. 5.1, 5.2 et 6.3) ; pas besoin d'aller la chercher.</li>
</ul>`;

const BODY_14_1_5 = `${cite('R175-3', '§3', 'Sont interopérables avec les différents systèmes techniques du bâtiment.')}

<p><strong>Réponse Buildy.</strong> Couverture <strong>très loin au-delà</strong> du strict minimum. La solution Buildy supporte simultanément <strong>9 protocoles ouverts standards</strong>, là où la plupart des BMS sont mono-fabricant ou fortement liés à un constructeur :</p>

<table class="protocols-table">
  <thead>
    <tr><th>Protocole</th><th>Usage typique</th></tr>
  </thead>
  <tbody>
    <tr><td><strong>BACnet</strong> (BACnet/IP, BACnet MS/TP)</td><td>CVC, automates terrain, régulateurs de chaufferie, CTA, rooftops</td></tr>
    <tr><td><strong>Modbus</strong> (Modbus TCP, Modbus RTU)</td><td>Compteurs, variateurs, automates, équipements industriels</td></tr>
    <tr><td><strong>KNX</strong> (KNX/IP, KNX TP)</td><td>Éclairage, occultation, thermostats, scénarios bâtiment</td></tr>
    <tr><td><strong>DALI</strong></td><td>Pilotage fin de l'éclairage intérieur</td></tr>
    <tr><td><strong>SNMP</strong></td><td>Équipements réseau et infrastructure IT</td></tr>
    <tr><td><strong>REST API</strong></td><td>Intégration avec les systèmes tiers (cf. ch. 8 Buildy Connect)</td></tr>
    <tr><td><strong>M-Bus</strong> (M-Bus IP, M-Bus filaire)</td><td>Comptage thermique et d'eau</td></tr>
    <tr><td><strong>LoRaWAN</strong></td><td>Capteurs sans fil (sondes QAI, T°, occupation)</td></tr>
    <tr><td><strong>MQTT</strong></td><td>IoT, capteurs et actionneurs distants</td></tr>
  </tbody>
</table>

<p>Cette ouverture protocolaire native garantit l'absence de <em>vendor lock-in</em> : le propriétaire reste libre de choisir et de remplacer ses équipements terrain indépendamment de la solution de supervision.</p>`;

const BODY_14_1_6 = `${cite('R175-3', '§4', 'Permettent un arrêt manuel et la gestion autonome d\'un ou plusieurs systèmes techniques de bâtiment.')}

<p><strong>Réponse Buildy.</strong> Couverture <strong>renforcée</strong> par des fonctionnalités étendues :</p>
<ul>
  <li><strong>Commandes manuelles</strong> depuis Hyperveez (web) et Gojee (mobile, Smart+) : marche/arrêt, modes, consignes, retours d'état confirmant l'exécution (cf. ch. 4.1).</li>
  <li><strong>Programmations horaires</strong> définies depuis Hyperveez et envoyées aux équipements terrain qui les <strong>exécutent en autonomie</strong> (cf. ch. 4.2). Conséquence importante : si le cloud Buildy ou la connectivité Internet du site est temporairement indisponible, les programmations horaires continuent de s'exécuter au niveau des équipements terrain — la gestion autonome est garantie.</li>
  <li><strong>Commandes virtuelles groupées</strong> (cf. ch. 4.3) : un équipement virtuel regroupe tout ou partie des équipements d'un même type ; une commande adressée au virtuel se propage à l'ensemble en un clic. Fonctionnalité rare dans les BMS du marché.</li>
  <li><strong>Régulation côté terrain préservée</strong> : Buildy ne réalise pas la régulation à la place des équipements (choix architectural sain — pas de dépendance cloud pour la fonction critique). La régulation reste autonome au niveau des thermostats, régulateurs de chaufferie et têtes thermostatiques.</li>
</ul>`;

const BODY_14_1_7 = `${cite('R175-3', null, 'Les données produites et archivées sont accessibles au propriétaire du système d\'automatisation et de contrôle, qui en a la propriété. Ce dernier les met à disposition du gestionnaire du bâtiment, à sa demande, et transmet à chacun des exploitants des différents systèmes techniques reliés les données qui les concernent.')}

<p><strong>Réponse Buildy.</strong> Trois niveaux d'accès et de transmission :</p>
<ul>
  <li><strong>Accès propriétaire et gestionnaire</strong> via l'application web <strong>Hyperveez</strong> (tous niveaux) et l'application mobile <strong>Gojee</strong> (Smart et Premium) : visualisation temps réel, historiques, exports CSV, rapports automatisés.</li>
  <li><strong>Transmission structurée et automatique aux exploitants des différents systèmes techniques</strong> via l'<strong>API Buildy Connect</strong> (cf. ch. 8) : connecteur API REST par système tiers autorisé, gestion fine des droits par périmètre, lecture seule ou lecture/écriture configurables. <em>Cette fonctionnalité est disponible uniquement en niveau <strong>Premium</strong></em> — c'est l'alinéa qui détermine le niveau de service à souscrire pour atteindre la conformité pleine et entière du décret.</li>
  <li><strong>Propriété et accessibilité des données</strong> garanties contractuellement au propriétaire (cf. ch. 13 Engagement contractuel).</li>
</ul>`;

const BODY_14_1_8 = `${cite('R175-4', null, 'Les systèmes d\'automatisation et de contrôle des bâtiments font l\'objet, en vue de garantir leur maintien en bon état de fonctionnement, de vérifications périodiques par un prestataire externe ou un personnel interne compétent. Ces vérifications sont encadrées par des consignes écrites données au gestionnaire du système d\'automatisation et de contrôle du bâtiment, qui doivent préciser la périodicité des interventions, les points à contrôler et prévoir la réparation rapide ou le remplacement des éléments défaillants.')}

<p><strong>Réponse Buildy.</strong> Couverture <strong>renforcée</strong> par une supervision proactive :</p>
<ul>
  <li><strong>Contrat de maintenance Smart ou Premium</strong> (cf. ch. 10.1) : mises à jour applicatives régulières, correctifs de sécurité, support tickets via Crisp et email <code>support@buildy.fr</code>.</li>
  <li><strong>Monitoring proactif des passerelles 24/7</strong> : la supervision cloud Buildy détecte automatiquement toute perte de communication, incident PM2 ou anomalie système, et déclenche une intervention sans attendre que l'utilisateur signale une panne. La plupart des solutions GTB classiques attendent au contraire qu'un utilisateur signale un dysfonctionnement avant d'intervenir.</li>
  <li><strong>Consignes écrites</strong> formalisées : la présente AF tient lieu de document de référence ; elle est complétée par les consignes spécifiques de l'offre <em>Sérénité</em> (option) lorsqu'elle est souscrite.</li>
  <li><strong>Historisation 5 ans</strong> des consignes appliquées et des interventions effectuées.</li>
  <li>Buildy intervient en <em>périmètre logiciel uniquement</em> : les interventions matérielles sur site (panne d'équipement, remplacement capteur, recâblage, mise en service complémentaire) sont réalisées par l'installateur des fluides ou un mainteneur tiers.</li>
</ul>`;

const BODY_14_1_9 = `${cite('R175-5', null, 'Le propriétaire du système d\'automatisation et de contrôle veille à ce que son exploitant soit formé à son fonctionnement, notamment en ce qui concerne les modalités de son paramétrage.')}

<p><strong>Réponse Buildy.</strong> La formation de l'exploitant est <strong>nativement incluse</strong> dans la solution Buildy, sous une forme moderne et continue plutôt qu'une session ponctuelle vite oubliée :</p>
<ul>
  <li><strong>Support utilisateur intégré</strong> : module de chat Crisp embarqué dans Hyperveez et Gojee (cf. ch. 9), accessible en deux clics depuis n'importe quel écran, support email <code>support@buildy.fr</code>. Disponible en Smart et Premium, en option payante en Essentials.</li>
  <li><strong>Gestion active des comptes utilisateurs par l'équipe Buildy</strong> : création des comptes, attribution des droits, accompagnement permanent des utilisateurs au fil de leurs questions concrètes — l'exploitant n'a pas à apprendre à administrer la solution lui-même.</li>
  <li><strong>Documentation utilisateur Notion</strong> publique et toujours à jour : prise en main des principales fonctions, FAQ, captures d'écran réelles. Accessible 24/7.</li>
  <li>Cette assistance continue garantit que l'exploitant maîtrise réellement le paramétrage de la solution dans la durée, là où une formation ponctuelle s'estompe rapidement.</li>
</ul>`;

const BODY_14_1_10 = `${cite('R175-5-1', null, 'À l\'initiative de leur propriétaire, les systèmes d\'automatisation et de contrôle des bâtiments mentionnés à l\'article R. 175-2 sont soumis à inspection périodique. Cette inspection comprend : 1° S\'il s\'agit de la première inspection du système, un examen de l\'analyse fonctionnelle du système ; 2° Une vérification du bon fonctionnement du système ; 3° Une évaluation du respect des exigences mentionnées à l\'article R. 175-3 […] ; 4° La fourniture des recommandations nécessaires […]. Dans un délai d\'un mois, la personne ayant effectué l\'inspection remet un rapport au propriétaire, qui le conserve pendant dix ans.')}

<p><strong>Réponse Buildy.</strong> Couverture <strong>renforcée</strong> par la fourniture native de l'AF :</p>
<ul>
  <li><strong>L'analyse fonctionnelle est livrée nativement par Buildy</strong> en fin de chantier : <em>le présent document est l'AF examinée lors de l'inspection</em> (cf. ch. 1.1). Beaucoup d'intégrateurs GTB classiques ne fournissent pas d'AF formelle ; chez Buildy elle fait partie du livrable standard.</li>
  <li><strong>Vérification du bon fonctionnement</strong> : facilitée par les tableaux de bord temps réel (cf. ch. 6), la console d'alarmes (cf. ch. 5) et l'historique des consignes appliquées (5 ans).</li>
  <li><strong>Évaluation du respect des exigences R175-3</strong> : la présente section 14.1 fournit l'analyse alinéa par alinéa, prête à être lue par l'inspecteur.</li>
  <li><strong>Journal horodaté de traçabilité interne</strong> (cf. ch. 7) : connexions, déconnexions, commandes émises, modifications de configuration. Conservé par Buildy sur la durée du contrat de service et mobilisable à la demande lors d'inspections.</li>
  <li>L'inspection officielle elle-même est réalisée par un <strong>tiers compétent</strong> mandaté par le propriétaire — Buildy fournit la matière nécessaire (AF + données + journal), pas l'inspection.</li>
</ul>`;

const BODY_14_1_11 = `${cite('R175-6', null, 'Sont assujettis à l\'obligation [d\'équiper le système de chauffage de dispositifs d\'autorégulation de la température, mentionnée à l\'article L. 175-2] le ou les propriétaires des émetteurs reliés au générateur installé ou remplacé.')}

<p><strong>Réponse Buildy.</strong> La régulation automatique de la température par pièce ou par zone est <strong>assurée par les équipements terrain</strong> (thermostats connectés, régulateurs de chaufferie, têtes thermostatiques radio, vannes motorisées). C'est un choix architectural sain : la régulation, fonction critique, ne dépend pas de la connectivité cloud.</p>

<p>Buildy <strong>supervise et pilote</strong> cette régulation :</p>
<ul>
  <li>Lecture des températures par zone fonctionnelle (cf. découpage zonal en début d'AF).</li>
  <li>Lecture et écriture des consignes de température, par zone et par contexte (occupation / inoccupation).</li>
  <li>Programmations horaires de consignes, exécutées en autonomie côté équipement (cf. ch. 4.2).</li>
  <li>Alertes en cas de dérive de température ou de défaut de régulation (cf. ch. 5).</li>
  <li>Templates équipements concernés : thermostat, régulateur de chaufferie, circuit de chauffage, têtes thermostatiques (cf. ch. 2.1).</li>
</ul>

<p>L'obligation R175-6 cible le <em>propriétaire des émetteurs reliés au générateur</em> ; la solution Buildy lui fournit la couche supervision et pilotage nécessaire à la mise en œuvre de cette régulation par zone.</p>`;

const BODY_14_1_12 = `<p class="r175-intro">Synthèse de la couverture du décret BACS par la solution Buildy — pièce de défense d'inspection R175-5-1 et matière commerciale.</p>

<div class="r175-stats">
  <div class="r175-stat r175-stat-renforce">
    <div class="r175-stat-value">8/11</div>
    <div class="r175-stat-label">Alinéas renforcés</div>
  </div>
  <div class="r175-stat r175-stat-couvert">
    <div class="r175-stat-value">3/11</div>
    <div class="r175-stat-label">Strictement couverts</div>
  </div>
  <div class="r175-stat r175-stat-level">
    <div class="r175-stat-value">P</div>
    <div class="r175-stat-label">Conformité pleine = Premium</div>
  </div>
</div>

<table class="r175-coverage-table">
  <thead>
    <tr>
      <th class="r175-th-article">Article</th>
      <th class="r175-th-exigence">Exigence</th>
      <th class="r175-th-buildy">Réponse Buildy</th>
      <th class="r175-th-status">Couverture</th>
      <th class="r175-th-level">Niveau</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td class="r175-td-article"><strong>R175-1</strong></td>
      <td>Définitions systèmes techniques et BACS</td>
      <td>Tous supervisables — découpage zonal natif</td>
      <td><span class="r175-badge r175-badge-couvert">Couvert</span></td>
      <td><span class="r175-level r175-level-esp">E/S/P</span></td>
    </tr>
    <tr>
      <td class="r175-td-article"><strong>R175-2</strong></td>
      <td>Champ &gt; 70 kW + clause TRI 10 ans</td>
      <td>Solution applicable. TRI = propriétaire</td>
      <td><span class="r175-badge r175-badge-couvert">Couvert</span></td>
      <td><span class="r175-level r175-level-esp">E/S/P</span></td>
    </tr>
    <tr>
      <td class="r175-td-article"><strong>R175-3 §1</strong></td>
      <td>Pas horaire + 5 ans mensuels</td>
      <td>Pas infra-horaire — rétention 5 ans (S) / 10 ans (P)</td>
      <td><span class="r175-badge r175-badge-renforce">Renforcé</span></td>
      <td><span class="r175-level r175-level-sp">S/P</span></td>
    </tr>
    <tr>
      <td class="r175-td-article"><strong>R175-3 §2</strong></td>
      <td>Efficacité vs valeurs réf. + détection pertes</td>
      <td>Seuils paramétrables × 3 contextes + DJU/DHU</td>
      <td><span class="r175-badge r175-badge-renforce">Renforcé</span></td>
      <td><span class="r175-level r175-level-sp">S/P</span></td>
    </tr>
    <tr>
      <td class="r175-td-article"><strong>R175-3 §3</strong></td>
      <td>Interopérabilité</td>
      <td>9 protocoles ouverts simultanément</td>
      <td><span class="r175-badge r175-badge-renforce">Renforcé</span></td>
      <td><span class="r175-level r175-level-esp">E/S/P</span></td>
    </tr>
    <tr>
      <td class="r175-td-article"><strong>R175-3 §4</strong></td>
      <td>Arrêt manuel + gestion autonome</td>
      <td>Commandes manuelles + programmations horaires + virtuelles</td>
      <td><span class="r175-badge r175-badge-renforce">Renforcé</span></td>
      <td><span class="r175-level r175-level-esp">E/S/P</span></td>
    </tr>
    <tr>
      <td class="r175-td-article"><strong>R175-3 fin</strong></td>
      <td>Transmission aux exploitants tiers</td>
      <td>API Buildy Connect — transmission structurée</td>
      <td><span class="r175-badge r175-badge-renforce">Renforcé</span></td>
      <td><span class="r175-level r175-level-p">P</span></td>
    </tr>
    <tr>
      <td class="r175-td-article"><strong>R175-4</strong></td>
      <td>Vérifications périodiques + consignes</td>
      <td>Contrat maintenance + monitoring proactif 24/7</td>
      <td><span class="r175-badge r175-badge-renforce">Renforcé</span></td>
      <td><span class="r175-level r175-level-sp">S/P</span></td>
    </tr>
    <tr>
      <td class="r175-td-article"><strong>R175-5</strong></td>
      <td>Formation de l'exploitant</td>
      <td>Support intégré + gestion active comptes par Buildy</td>
      <td><span class="r175-badge r175-badge-couvert">Couvert</span></td>
      <td><span class="r175-level r175-level-sp">S/P</span></td>
    </tr>
    <tr>
      <td class="r175-td-article"><strong>R175-5-1</strong></td>
      <td>Inspection périodique : AF + vérif + recos</td>
      <td>AF native + journal horodaté + données mobilisables</td>
      <td><span class="r175-badge r175-badge-renforce">Renforcé</span></td>
      <td><span class="r175-level r175-level-esp">E/S/P</span></td>
    </tr>
    <tr>
      <td class="r175-td-article"><strong>R175-6</strong></td>
      <td>Régulation auto température par zone</td>
      <td>Régulation terrain + supervision/pilotage par zone</td>
      <td><span class="r175-badge r175-badge-couvert">Couvert</span></td>
      <td><span class="r175-level r175-level-esp">E/S/P</span></td>
    </tr>
  </tbody>
</table>

<p class="r175-summary">Conformité pleine atteinte au niveau <strong>Premium</strong> (R175-3 alinéa final, transmission structurée). Smart couvre 9 alinéas sur 11. Essentials ne couvre pas R175-3 §1 (rétention insuffisante).</p>`;

// ─── 14.2 Cybersécurité (placeholders) ───────────────────────────────────

const PLACEHOLDER_14_2 = `<p><em class="text-gray-400">À rédiger — Introduction de la section : la solution Buildy a été conçue cloud-first avec une posture sécurité documentée à chaque couche, là où les solutions de GTB classiques sont historiquement orientées « réseau privé » sans modèle de menace cloud robuste.</em></p>`;

const PLACEHOLDER_14_2_1 = `<p><em class="text-gray-400">À rédiger — Authentification et contrôle d'accès. Matière première confirmée en code :</em></p>
<ul class="text-gray-400">
  <li><em>OIDC PocketID avec passkey (passwordless), grâce offline 7 jours après synchronisation</em></li>
  <li><em>JWT cookie httpOnly + secure + sameSite lax</em></li>
  <li><em>2FA TOTP obligatoire pour tous les utilisateurs Fleet Manager</em></li>
  <li><em>Recovery codes : 8 codes 128-bit entropy hachés bcrypt</em></li>
  <li><em>Rate limiting login : 5 tentatives / 15 min — OTP : 5 tentatives / 5 min persistent</em></li>
  <li><em>RBAC 3 rôles (admin, integrator, viewer) avec filtrage par tags : un utilisateur ne voit que les passerelles taguées correspondant à son périmètre</em></li>
  <li><em>Audit trail centralisé timestamp/utilisateur/passerelle, sources fleet-manager et buildy-tools, batch push BT→FM</em></li>
</ul>`;

const PLACEHOLDER_14_2_2 = `<p><em class="text-gray-400">À rédiger — Chiffrement et protection des données. Matière première confirmée en code :</em></p>
<ul class="text-gray-400">
  <li><em>SQLite chiffrée at-rest AES-256-GCM (clé 32 bytes, IV 12 bytes, tag d'authentification 16 bytes)</em></li>
  <li><em>Backups cloud restic chiffrés end-to-end AES-256 + déduplication par blocs</em></li>
  <li><em>Master secret HKDF-SHA256 : jamais affiché nulle part (pas même à l'admin) — uniquement statut, date de rotation, empreinte</em></li>
  <li><em>Password admin dérivé HKDF unique par passerelle : un site compromis n'expose pas les autres</em></li>
  <li><em>Repos restic isolés par passerelle (option --private-repos + htpasswd unique)</em></li>
  <li><em>Backup credentials chiffrés AES-256-GCM dans la DB Fleet Manager avant tout envoi</em></li>
</ul>`;

const PLACEHOLDER_14_2_3 = `<p><em class="text-gray-400">À rédiger — Architecture défensive et isolation réseau. Matière première confirmée en code :</em></p>
<ul class="text-gray-400">
  <li><em>VPN NetBird : les passerelles sont inaccessibles depuis Internet public, IP NetBird 100.64.0.0/10 dédiée</em></li>
  <li><em>TLS auto-signés 10 ans avec SAN multi-IP couvrant VPN + LAN</em></li>
  <li><em>Firewall iptables 28 règles : SSH/Buildy Tools restreints LAN+VPN, BACnet/Modbus/M-Bus/KNX avec source restriction</em></li>
  <li><em>Anti-replay sur les actions sensibles : nonce 16-128 chars unique 24h + timestamp ±5 min + HMAC-SHA256 timing-safe</em></li>
  <li><em>Fail2ban SSH : maxretry 3, findtime 600s, bantime 1800s</em></li>
  <li><em>SSH hardening : PermitRootLogin no, MaxAuthTries 3, LoginGraceTime 30s, UsePAM yes avec hook d'audit</em></li>
  <li><em>Surface d'attaque minimale : bootstrap one-shot NetBird-IP-only, pas de polling 4G client</em></li>
  <li><em>Sudoers whitelist explicite : pas de bash/sh/cat, seulement systemctl/reboot/cp ciblés</em></li>
</ul>`;

const PLACEHOLDER_14_2_4 = `<p><em class="text-gray-400">À rédiger — Hébergement souverain et conformité RGPD. Matière première confirmée en code :</em></p>
<ul class="text-gray-400">
  <li><em>VPS Hosteur Jelastic, hébergé en France (souveraineté juridique)</em></li>
  <li><em>Pas d'IP publique sur le Fleet Manager : accès SSH uniquement via NetBird (FQDN fleet-manager.buildy.wan)</em></li>
  <li><em>REST server restic colocalisé sur le même node, port 8000 HTTPS uniquement</em></li>
  <li><em>Données chiffrées en transit (TLS) et at-rest (AES-256-GCM)</em></li>
  <li><em>Pas de transfert hors-UE</em></li>
  <li><em>Logs PM2 + logrotate avec rétention configurée</em></li>
</ul>`;

// ─── 14.3 Cloud (placeholders) ───────────────────────────────────────────

const PLACEHOLDER_14_3 = `<p><em class="text-gray-400">À rédiger — Introduction : Buildy a fait le choix du cloud-natif. Aucun serveur GTB physique au siège du client : juste la Buildy Box sur site qui dialogue avec le cloud Buildy via NetBird. Cette architecture remplace le serveur GTB on-premise classique, pas l'automate terrain (la Buildy Box embarque Siemens Desigo Optic ou Tridium Niagara 4 — cf. section 14.4). Les sous-sections détaillent les bénéfices concrets vis-à-vis d'une GTB on-premise classique.</em></p>`;

const PLACEHOLDER_14_3_1 = `<p><em class="text-gray-400">À rédiger — Supervision multi-sites depuis un seul accès. Matière première confirmée en code :</em></p>
<ul class="text-gray-400">
  <li><em>Vue parc complet depuis le navigateur (Hyperveez, Fleet Manager) — pas de hardware site client</em></li>
  <li><em>Cartographie d'hypervision multi-sites (HeatmapView), vue NOC plein écran (KioskView)</em></li>
  <li><em>Tags multi-niveaux + filtrage rapide par site (URL ?site=...)</em></li>
  <li><em>Synchronisation bidirectionnelle des sites entre Fleet Manager et Buildy Docs (UUID partagé, last-write-wins)</em></li>
  <li><em>Cascade : ajouter une passerelle à un site propage automatiquement aux routeurs et SIM cards associés</em></li>
  <li><em>En GTB on-premise classique : un serveur par site OU serveur central complexe à scaler</em></li>
</ul>`;

const PLACEHOLDER_14_3_2 = `<p><em class="text-gray-400">À rédiger — Mises à jour centralisées sans intervention terrain. Matière première confirmée en code :</em></p>
<ul class="text-gray-400">
  <li><em>Campagnes OTA orchestrées depuis le cloud avec stratégies canary 1/10/100, all-at-once, batch manuel</em></li>
  <li><em>Wave-by-wave avec auto-rollback si plus de 20 % d'erreurs</em></li>
  <li><em>Heartbeat ferme automatiquement la campagne dès la version cible atteinte sur la flotte</em></li>
  <li><em>107 outils MCP côté Fleet Manager : ajout de fonctionnalités côté cloud sans toucher aux passerelles terrain</em></li>
  <li><em>En GTB on-premise classique : déploiement manuel par technicien sur chaque site (effort proportionnel au nombre de sites)</em></li>
</ul>`;

const PLACEHOLDER_14_3_3 = `<p><em class="text-gray-400">À rédiger — Mise en service automatisée des passerelles. Matière première confirmée en code :</em></p>
<ul class="text-gray-400">
  <li><em>Auto-provisioning 4 étapes idempotentes : init backup repo, bootstrap secrets, push credentials, push admin password</em></li>
  <li><em>Aucune intervention manuelle après boot de la Buildy Box sur site</em></li>
  <li><em>Circuit breaker persistant en DB (3 min → 10 min → 30 min → 2h) pour gérer les passerelles temporairement injoignables</em></li>
  <li><em>Master secret HKDF — chaque passerelle reçoit un password unique (compromission isolée)</em></li>
  <li><em>En GTB on-premise classique : intervention technicien obligatoire pour chaque mise en service, avec saisie manuelle des credentials sur site</em></li>
</ul>`;

const PLACEHOLDER_14_3_4 = `<p><em class="text-gray-400">À rédiger — Sauvegarde et restauration en quelques clics. Matière première confirmée en code :</em></p>
<ul class="text-gray-400">
  <li><em>Sauvegardes restic chiffrées end-to-end AES-256 + déduplication par blocs</em></li>
  <li><em>Repos isolés par passerelle, rétention automatique (10 derniers snapshots + prune)</em></li>
  <li><em>Restauration sur passerelle vierge en 3 clics : install Buildy Tools, push credentials backup, choix snapshot</em></li>
  <li><em>Le .env complet (avec tous les tokens) est inclus dans la sauvegarde — restauration totale</em></li>
  <li><em>En GTB on-premise classique : sauvegarde réseau local (perdue avec le serveur) ; restauration sur nouvelle machine = réinstallation complète</em></li>
</ul>`;

const PLACEHOLDER_14_3_5 = `<p><em class="text-gray-400">À rédiger — Surveillance proactive 24/7 sans surconsommation 4G. Matière première confirmée en code :</em></p>
<ul class="text-gray-400">
  <li><em>Heartbeat passerelle ~15 min (configurable), agrégation cloud Fleet Manager</em></li>
  <li><em>Détection automatique : disque &gt; 95 %, PM2 redémarré, backup en échec, version obsolète</em></li>
  <li><em>WebSocket broadcast UI sans rechargement de page</em></li>
  <li><em>Pas de polling 4G côté client : la donnée 4G coûteuse est préservée — seul le heartbeat passerelle remonte (~5 KB par cycle)</em></li>
  <li><em>En GTB on-premise classique : alertes locales sur le serveur du site (invisibles à distance) ou polling client coûteux</em></li>
</ul>`;

const PLACEHOLDER_14_3_6 = `<p><em class="text-gray-400">À rédiger — Modèle économique SaaS sans CAPEX serveur. Matière première confirmée en code :</em></p>
<ul class="text-gray-400">
  <li><em>Pas de serveur GTB physique au siège du client (le cloud Buildy est mutualisé sur VPS Jelastic)</em></li>
  <li><em>Pas de licence serveur perpétuelle ni de redondance/onduleur/climatisation à entretenir localement</em></li>
  <li><em>Évolution des fonctionnalités incluse dans l'abonnement (pas de versioning à racheter)</em></li>
  <li><em>Trois niveaux d'offre clairs (Essentials / Smart / Premium) — cf. ch. 1.4 et 13</em></li>
  <li><em>En GTB on-premise classique : licence perpétuelle + serveur physique + maintenance IT locale + intervention sur site pour chaque évolution</em></li>
</ul>`;

const PLACEHOLDER_14_3_7 = `<p><em class="text-gray-400">À rédiger — Accès mobile multi-sites avec Gojee. Matière première confirmée en code :</em></p>
<ul class="text-gray-400">
  <li><em>Application mobile native Buildy iOS et Android (Gojee), accessible depuis n'importe où sans VPN client à installer</em></li>
  <li><em>Supervision temps réel + notifications push d'alarmes</em></li>
  <li><em>Support intégré (chat Crisp) directement depuis l'application — Smart et Premium</em></li>
  <li><em>Accès par QR Code sécurisé sur site (panneau, équipement, salle) — Premium uniquement</em></li>
  <li><em>Déclarations manuelles d'anomalies par les utilisateurs du bâtiment — Premium uniquement</em></li>
  <li><em>Cf. chapitre 11 du présent document pour le détail des fonctionnalités Gojee</em></li>
  <li><em>En GTB on-premise classique : accès mobile nécessite un VPN client lourd, voire pas d'app mobile du tout</em></li>
</ul>`;

// ─── 14.4 Buildy Box ─────────────────────────────────────────────────────

const BODY_14_4 = `<p>La <strong>Buildy Box</strong> est le coffret GTB tout-compris vendu par Buildy. C'est <em>« le cerveau connecté du bâtiment, le coffret GTB prêt-à-raccorder »</em> selon les termes utilisés sur la page produit officielle. Elle est <em>« préconfigurée en atelier »</em> et arrive <em>« prête à l'emploi »</em> sur site.</p>

<p>Le coffret regroupe l'ensemble des composants nécessaires à la mise en place d'une GTB connectée : automate de pilotage, passerelle Buildy Edge pour la liaison cloud, bornier multi-bus pour les protocoles terrain, routeur VPN 4G et switch managé. Cette intégration en un produit unique simplifie radicalement le déploiement comparé à une intégration GTB classique où chaque composant est acheté et assemblé séparément.</p>

<p class="text-buildy-source"><em>Source : <a href="https://www.buildy.fr/projets-gtb-installateurs/">https://www.buildy.fr/projets-gtb-installateurs/</a></em></p>`;

const BODY_14_4_1 = `<p>La Buildy Box embarque, dans un coffret unique pré-assemblé en atelier :</p>

<ul>
  <li><strong>Un automate GTB</strong> — Siemens Desigo Optic ou Tridium Niagara 4, <em>« pour assurer un pilotage fiable et évolutif »</em>. Ces automates de référence du marché sont reconnus pour leur robustesse et leur pérennité.</li>
  <li><strong>La passerelle Buildy Edge</strong> — <em>« pour connecter facilement votre bâtiment à la plateforme Buildy Cloud »</em>. C'est elle qui porte la couche supervision Hyperveez/Gojee et établit la liaison sécurisée avec le cloud Buildy via le VPN NetBird.</li>
  <li><strong>Un bornier multi-bus</strong> — <em>« un bornier bien pensé qui simplifie la connexion des bus terrain : KNX, BACnet, Modbus RTU, DALI, M-Bus »</em>. La Buildy Box est ainsi prête à recevoir les protocoles standards du bâtiment sans accessoires supplémentaires.</li>
  <li><strong>Un routeur VPN 4G</strong> — pour la connectivité Internet du site, en autonomie ou en complément de la connectivité de l'exploitant.</li>
  <li><strong>Un switch managé</strong> — pour la distribution réseau aux équipements terrain.</li>
  <li><strong>Des passerelles complémentaires LoRa et Modbus</strong> — pour étendre la couverture protocolaire selon les besoins du site.</li>
</ul>

<p>Cette composition fait de la Buildy Box un produit autonome : tout ce qui est nécessaire au fonctionnement de la GTB connectée tient dans un seul coffret, livré et installé en une seule intervention.</p>`;

const BODY_14_4_2 = `<p>La Buildy Box est conçue pour minimiser le travail sur site de l'installateur. Selon les termes utilisés sur la page produit officielle :</p>

<blockquote class="buildy-claim">
<p><em>« L'installation du coffret GTB Buildy Box sur site est rapide et facile. Tout le reste se fait à distance. »</em></p>
</blockquote>

<p>Concrètement :</p>

<ul>
  <li><strong>Préconfiguration en atelier</strong> : la Buildy Box arrive avec son automate paramétré, la passerelle Buildy Edge déjà inscrite dans le parc Buildy, le routeur 4G provisionné, le switch configuré. Aucune saisie manuelle de credentials sur site.</li>
  <li><strong>Branchement physique</strong> sur site : alimentation, raccordement réseau aux équipements terrain via le bornier multi-bus, mise sous tension.</li>
  <li><strong>Tout le reste se fait à distance</strong> : déclaration des points, paramétrage de la supervision, ajustements fins, montée en charge progressive — tout cela se fait depuis le cloud Buildy par les équipes Buildy ou les intégrateurs partenaires, sans intervention complémentaire sur site.</li>
  <li><strong>Auto-provisioning</strong> : la passerelle Buildy Edge est automatiquement reconnue par le cloud Buildy dès sa connexion, sans action de l'installateur (cf. ch. 14.3.3 pour le détail technique).</li>
</ul>

<p>Cette simplicité de déploiement profite directement aux installateurs (gain de temps mesurable sur chaque pose) et aux propriétaires (pas de surcoût lié à des interventions techniques répétées sur site).</p>`;

const BODY_14_4_3 = `<p>La Buildy Box est conçue pour s'intégrer dans des bâtiments existants sans imposer de remplacement matériel global. Elle est <strong>compatible avec les systèmes existants</strong> via les standards ouverts du marché :</p>

<ul>
  <li><strong>BACnet</strong> — pour les automates et régulateurs CVC déjà en place</li>
  <li><strong>LoRaWAN</strong> — pour les capteurs sans fil existants ou ajoutés au fil de l'eau</li>
  <li><strong>Modbus</strong> (TCP et RTU) — pour les compteurs, variateurs et équipements industriels</li>
  <li><strong>API REST</strong> — pour les systèmes tiers via l'API Buildy Connect (cf. ch. 8)</li>
</ul>

<p>Combinée à la couverture protocolaire complète de la passerelle Buildy Edge (KNX, DALI, SNMP, M-Bus, MQTT en complément des standards ci-dessus), la Buildy Box <strong>n'impose pas de rip-and-replace</strong> : elle vient s'ajouter au parc d'équipements existants et les rend supervisables et pilotables depuis le cloud Buildy.</p>

<p>C'est un atout majeur pour les bâtiments tertiaires en rénovation soumis au décret BACS : la mise en conformité ne nécessite pas de remplacer les systèmes techniques en place, à condition qu'ils exposent des points sur l'un des protocoles supportés.</p>`;

// ─── Index slug → body ───────────────────────────────────────────────────

const BODIES_BY_SLUG = {
  '14': null, // pas de body — section parente narrative ; le seeder met null
  '14.1': BODY_14_1,
  '14.1.1': BODY_14_1_1,
  '14.1.2': BODY_14_1_2,
  '14.1.3': BODY_14_1_3,
  '14.1.4': BODY_14_1_4,
  '14.1.5': BODY_14_1_5,
  '14.1.6': BODY_14_1_6,
  '14.1.7': BODY_14_1_7,
  '14.1.8': BODY_14_1_8,
  '14.1.9': BODY_14_1_9,
  '14.1.10': BODY_14_1_10,
  '14.1.11': BODY_14_1_11,
  '14.1.12': BODY_14_1_12,
  '14.2': PLACEHOLDER_14_2,
  '14.2.1': PLACEHOLDER_14_2_1,
  '14.2.2': PLACEHOLDER_14_2_2,
  '14.2.3': PLACEHOLDER_14_2_3,
  '14.2.4': PLACEHOLDER_14_2_4,
  '14.3': PLACEHOLDER_14_3,
  '14.3.1': PLACEHOLDER_14_3_1,
  '14.3.2': PLACEHOLDER_14_3_2,
  '14.3.3': PLACEHOLDER_14_3_3,
  '14.3.4': PLACEHOLDER_14_3_4,
  '14.3.5': PLACEHOLDER_14_3_5,
  '14.3.6': PLACEHOLDER_14_3_6,
  '14.3.7': PLACEHOLDER_14_3_7,
  '14.4': BODY_14_4,
  '14.4.1': BODY_14_4_1,
  '14.4.2': BODY_14_4_2,
  '14.4.3': BODY_14_4_3,
};

module.exports = { BODIES_BY_SLUG };
