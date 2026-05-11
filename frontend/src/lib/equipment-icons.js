// Registre curé des icônes FontAwesome Pro Solid utilisées par la
// bibliothèque d'équipements et le tree des AFs. Évite d'importer les ~3000
// icônes via `import * as` (qui défait le tree-shaking et gonflait le
// bundle main de ~1 Mo).
//
// Couvre :
//   - les icon_value seedées dans backend-node/src/seeds/equipment-templates
//   - les icônes des system_categories_db (Chauffage, Clim, Vent, ECS, etc.)
//   - quelques fallbacks utiles (cube, gauge, etc.)
//
// Le picker de bibliothèque (FaIconPicker, EquipmentTemplateEditor) garde
// son import dynamique de la lib complète : ce fichier ne couvre que le
// rendu en lecture, pas la sélection admin.

import { library } from '@fortawesome/fontawesome-svg-core'
import {
  // Equipment templates (cf. seeds/equipment-templates/*.js icon_value)
  faArrowRightArrowLeft, faBlinds, faBlindsRaised, faBolt, faBuilding,
  faChargingStation, faCircleHalfStroke, faCube, faDoorOpen, faDroplet,
  faFan, faFire, faFireFlameSimple, faIndustry, faLeaf, faLightbulb,
  faMicrochip, faPlug, faPowerOff, faSnowflake, faSolarPanel,
  faTemperatureArrowDown, faTemperatureArrowUp, faTemperatureHalf,
  faThermometer, faToggleOn, faWind,
  // System categories (cf. lib/seeder.js seedSystemCategoriesOnBoot)
  faFaucetDrip, faGauge, faTowerCell, faWindowMaximize,
  // PDF / shared
  faSparkles, faCircleCheck, faBan, faEye, faEyeSlash, faTrashCan,
  // Compteurs / pills
  faFaucet,
  // Options de selects audit (ENERGY/ROLE/ZONE_NATURES/COMM_OPTIONS cf. lib/audit-options.js)
  faFireFlameCurved, faPipe, faTree, faCircleQuestion, faRoute, faSliders,
  faBriefcase, faPeopleGroup, faUserTie, faTableCellsLarge, faHandshake,
  faShop, faChalkboardUser, faScrewdriverWrench, faCouch, faMugHot, faUsers,
  faArrowsLeftRight, faBoxesStacked, faWarehouse, faBoltLightning, faGears,
  faServer, faTreeCity, faNetworkWired, faCloud, faPlugCircleXmark,
} from '@fortawesome/pro-solid-svg-icons'

const ICONS = [
  faArrowRightArrowLeft, faBlinds, faBlindsRaised, faBolt, faBuilding,
  faChargingStation, faCircleHalfStroke, faCube, faDoorOpen, faDroplet,
  faFan, faFire, faFireFlameSimple, faIndustry, faLeaf, faLightbulb,
  faMicrochip, faPlug, faPowerOff, faSnowflake, faSolarPanel,
  faTemperatureArrowDown, faTemperatureArrowUp, faTemperatureHalf,
  faThermometer, faToggleOn, faWind,
  faFaucetDrip, faGauge, faTowerCell, faWindowMaximize,
  faSparkles, faCircleCheck, faBan, faEye, faEyeSlash, faTrashCan,
  faFaucet,
  faFireFlameCurved, faPipe, faTree, faCircleQuestion, faRoute, faSliders,
  faBriefcase, faPeopleGroup, faUserTie, faTableCellsLarge, faHandshake,
  faShop, faChalkboardUser, faScrewdriverWrench, faCouch, faMugHot, faUsers,
  faArrowsLeftRight, faBoxesStacked, faWarehouse, faBoltLightning, faGears,
  faServer, faTreeCity, faNetworkWired, faCloud, faPlugCircleXmark,
]

library.add(...ICONS)

export const KNOWN_ICON_NAMES = new Set(ICONS.map((i) => i.iconName))
export const FALLBACK_ICON_NAME = 'cube'

// Resolution d'un icon_value (ex. 'fa-fire' ou 'fire') -> nom FA valide.
// Renvoie 'cube' si l'icone n'est pas dans le registre cure.
export function resolveFaIconName(iconValue) {
  const name = (iconValue || '').replace(/^fa-/, '')
  return KNOWN_ICON_NAMES.has(name) ? name : FALLBACK_ICON_NAME
}
