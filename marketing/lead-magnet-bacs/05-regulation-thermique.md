# Chapitre 5 — Régulation thermique par zone

<!-- ⚠️ Note de production interne — À SUPPRIMER avant mise en page.
Posture cabinet de conseil. Source : table bacs_audit_thermal_regulation
+ REGULATION_LABEL + GENERATOR_LABEL + 3 niveaux production/distrib/émission. -->

---

## Page 1 — Quand le R175-6 s'applique

Le R175-6 impose une **régulation thermique automatique par pièce ou par zone**. Cette obligation a une applicabilité particulière : elle ne concerne pas tous les bâtiments soumis au décret BACS, mais uniquement ceux dont le permis de construire **ou** les travaux générateurs significatifs sont postérieurs au 21 juillet 2021.

C'est l'une des subtilités du décret. Un bâtiment ancien soumis au R175 par sa puissance peut très bien ne pas être concerné par le R175-6 — son installation thermique antérieure est protégée par la date d'antériorité. Un bâtiment qui a remplacé sa chaudière en 2023 voit en revanche le R175-6 s'imposer à lui, même si le bâtiment lui-même est plus ancien.

L'auditeur consigne donc deux dates au début de cette étape : la date du permis de construire (déjà tracée à l'étape 1) et **la date des derniers travaux générateurs significatifs** — remplacement de chaudière, installation d'une PAC, raccordement à un réseau de chaleur, dépose d'une cuve à fioul. C'est cette seconde date qui déclenche, ou non, l'applicabilité du R175-6.

---

## Page 2 — Les trois niveaux de régulation à examiner

Sur les zones où le R175-6 s'applique, l'auditeur examine la régulation à trois niveaux d'équipement, indépendamment :

- **Production** — comment la chaleur (ou le froid) est-elle générée et modulée ? Régulation TOR sur thermostat d'ambiance, régulation à loi d'eau, asservissement sur sonde extérieure, etc.
- **Distribution** — comment l'énergie est-elle acheminée vers les zones ? Vannes trois voies, pompes à débit variable, régulation par zone hydraulique.
- **Émission** — comment l'énergie est-elle restituée dans la pièce ? Robinets thermostatiques sur radiateurs, régulation terminale par sonde locale, ventilo-convecteurs avec sonde de reprise.

Ces trois niveaux sont distincts. Une installation peut être conforme à la production (chaudière à condensation moderne, bien régulée) tout en étant non conforme à l'émission (radiateurs sans robinet thermostatique, donc impossibles à moduler par pièce). Le rapport doit qualifier chacun des trois niveaux.

Pour chaque niveau, l'auditeur identifie également **l'équipement contrôleur** — la régulation est-elle assurée par un thermostat d'ambiance dédié, par un automate intégré à la GTB, par un relais simple ? Cette identification permet de chiffrer les actions correctives à l'étape 9 (changer un thermostat coûte une centaine d'euros ; reconfigurer un automate de GTB est un autre ordre de grandeur).

---

## Page 3 — Les exemptions et cas particuliers

Le R175-6 prévoit explicitement plusieurs exemptions qu'il faut savoir reconnaître pour ne pas générer d'actions inutiles :

- **Générateurs à biomasse** (poêles à granulés, inserts, chaudières bois). Exemption explicite du décret. L'auditeur consigne l'exemption pour traçabilité, mais ne génère aucune action.
- **Locaux non chauffés ou non climatisés**. Pas de régulation à examiner — l'auditeur consigne l'absence du système.
- **Locaux à régulation manuelle assumée** (certains ateliers, locaux techniques avec personnel qualifié). À documenter explicitement avec justification, pas à laisser implicite.
- **Bâtiments en travaux ou en transition** (changement de générateur prévu dans les douze mois). L'auditeur trace l'état actuel et signale la transition à venir, qui pourra rendre certaines actions caduques.

> **Position des sondes** — L'auditeur vérifie systématiquement la position physique des sondes de température. Une sonde mal placée (au-dessus d'un radiateur, en plein soleil, à moins d'un mètre du sol contre une cloison froide) fausse toute la régulation, même si le matériel est récent. C'est un constat fréquent, qui n'apparaît dans aucun document mais qui change la nature de l'action à mener (recalibrer ou repositionner, plutôt que remplacer).

---

## Page 4 — Pièges classiques

- **Confondre conformité du matériel et conformité de la régulation effective**. Une vanne thermostatique installée mais bloquée à l'ouverture maximale par les occupants (pour éviter les courants d'air) ne régule plus rien. L'observation terrain prime sur le déclaratif.
- **Sous-estimer les générateurs hybrides**. Une PAC en relève d'une chaudière gaz, ou inversement, demande une analyse au cas par cas. La régulation peut être conforme sur l'un et pas sur l'autre.
- **Oublier la régulation de la climatisation**. Le R175-6 vise *toute* régulation thermique, pas uniquement le chauffage. Une climatisation centralisée sans modulation par zone est non conforme au même titre qu'un chauffage central sans robinet thermostatique.
- **Considérer l'exemption bois comme automatique**. L'exemption ne s'applique qu'au générateur à biomasse, pas à toute l'installation. Un bâtiment chauffé par chaudière bois plus PAC d'appoint conserve les obligations sur la PAC.

---

## Page 5 — Ce que produit cette étape

À l'issue de l'étape 5, le dossier d'audit comporte :

- L'identification des zones où le R175-6 est applicable, avec date d'applicabilité justifiée.
- Pour chaque zone applicable, l'examen des trois niveaux (production, distribution, émission), avec identification de l'équipement contrôleur.
- La consignation des exemptions (biomasse notamment) avec leur justification.
- Les observations terrain critiques (position des sondes, présence et état des robinets thermostatiques, modulations de zone).
- La liste préliminaire des actions correctives R175-6, classées par sévérité.

Cette analyse alimente l'étape 9 (plan d'action) et précise les actions des étapes 3 et 4 (équipements, comptages) lorsqu'elles touchent à la chaîne thermique.

---

*[Pied de page] Chapitre 5 / 11 — Régulation thermique*
