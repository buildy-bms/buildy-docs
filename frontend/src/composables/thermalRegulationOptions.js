// Suggestions de régulation par niveau (R175-6) — listes creatable :
// l'auditeur peut taper sa propre valeur si l'option n'est pas listée.
// Volontairement courtes : on documente les patterns les plus courants,
// la longue traîne passe par le champ libre. Partagé desktop/mobile.

export const PRODUCTION_REGULATION_OPTIONS = [
  { value: 'sonde_exterieure', label: 'Sonde extérieure (loi d\'eau)' },
  { value: 'sonde_depart',     label: 'Sonde de départ' },
  { value: 'courbe_chauffe',   label: 'Courbe de chauffe / loi d\'eau réglée' },
  { value: 'thermostat_fixe',  label: 'Thermostat de consigne fixe' },
  { value: 'cascade',          label: 'Cascade de producteurs' },
  { value: 'gtb_optimisation', label: 'Optimisation par GTB (glissante)' },
  { value: 'aucune',           label: 'Aucune régulation au niveau production' },
]

export const DISTRIBUTION_REGULATION_OPTIONS = [
  { value: 'pompe_dp_variable', label: 'Pompe à pression différentielle variable' },
  { value: 'pompe_vitesse_var', label: 'Pompe à vitesse variable' },
  { value: 'pompe_vitesse_fixe',label: 'Pompe à vitesse fixe' },
  { value: 'v3v_melange',       label: 'Vanne 3 voies mélangeuse' },
  { value: 'v2v_delestage',     label: 'Vanne 2 voies (délestage)' },
  { value: 'equilibrage_statique',  label: 'Équilibrage statique' },
  { value: 'equilibrage_dynamique', label: 'Équilibrage dynamique' },
  { value: 'aucune',            label: 'Aucune régulation au niveau distribution' },
]

export const EMISSION_REGULATION_OPTIONS = [
  { value: 'robinets_thermo',     label: 'Robinets thermostatiques' },
  { value: 'vannes_2v_par_zone',  label: 'Vannes 2 voies pilotées par zone' },
  { value: 'thermostat_ambiance', label: 'Thermostat d\'ambiance' },
  { value: 'sonde_ambiance',      label: 'Sonde d\'ambiance + actionneur' },
  { value: 'pcrt_par_piece',      label: 'Plancher chauffant régulé pièce par pièce' },
  { value: 'pilotage_drv',        label: 'Pilotage centralisé DRV' },
  { value: 'aucune',              label: 'Aucune régulation au niveau émission' },
]
