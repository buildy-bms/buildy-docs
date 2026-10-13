// Bulles des protocoles et des sigles (frontend/src/lib/acronym-tips.js) : chaque protocole connu a
// une explication en clair qui respecte les règles de rédaction ; un nom inconnu ne donne pas de
// bulle ; un sigle connu donne son nom complet.
import { describe, it, expect } from 'vitest';
import { protocolTip, abbreviationTip } from '../../frontend/src/lib/acronym-tips.js';
import { normalizeTip } from '../../frontend/src/lib/tooltip-content.js';
import { checkCopy } from '../../frontend/scripts/tooltip-lint.mjs';

const LABELS = [
  'Modbus TCP', 'Modbus RTU', 'BACnet/IP', 'BACnet MS/TP', 'BACnet IP', 'KNX/IP', 'KNX TP', 'KNX',
  'M-Bus IP', 'M-Bus filaire', 'MQTT', 'OPC-UA', 'LoRaWAN', 'DALI', 'OCPP', 'LonWorks', 'EnOcean', 'Zigbee', 'REST',
];

describe('acronym-tips : protocoles', () => {
  it('chaque protocole connu a une carte en clair', () => {
    for (const label of LABELS) {
      const tip = protocolTip(label);
      expect(tip, label).toBeTruthy();
      expect(tip.title).toBe(label);
      expect(checkCopy(tip.text, { label: false }), label).toEqual([]);
      expect(tip.text.length).toBeLessThanOrEqual(160);
      for (const r of tip.rows || []) expect(checkCopy(r.value, { label: false })).toEqual([]);
      expect(normalizeTip(tip)).toBeTruthy();
    }
  });
  it('la liaison est précisée quand le nom la donne', () => {
    expect(protocolTip('Modbus TCP').rows[0].value).toBe('réseau informatique');
    expect(protocolTip('Modbus RTU').rows[0].value).toBe('câble dédié (bus)');
    expect(protocolTip('M-Bus filaire').rows[0].value).toBe('câble dédié (bus)');
    expect(protocolTip('DALI').rows).toBeUndefined();
  });
  it('pas de bulle pour un nom inconnu ou vide', () => {
    expect(protocolTip('Autre')).toBeNull();
    expect(protocolTip('')).toBeNull();
    expect(protocolTip(null)).toBeNull();
  });
});

describe('acronym-tips : sigles', () => {
  it('nom complet des sigles connus, rien sinon', () => {
    expect(abbreviationTip('ECS')).toBe('Eau chaude sanitaire');
    expect(abbreviationTip('qai')).toBe('Qualité de l’air intérieur');
    expect(abbreviationTip(' TGBT ')).toBe('Tableau général basse tension');
    expect(abbreviationTip('AGBT')).toBe('Armoire générale basse tension');
    expect(abbreviationTip('Bureaux')).toBeNull();
    expect(abbreviationTip(null)).toBeNull();
    for (const s of ['ECS', 'QAI', 'PV', 'CTA', 'CVC', 'IRVE', 'TGBT', 'GTB', 'DRV', 'PAC', 'AGBT', 'RDC', 'SSI', 'VMC', 'GTC', 'UTA']) {
      expect(checkCopy(abbreviationTip(s), { label: true }), s).toEqual([]);
    }
  });
});
