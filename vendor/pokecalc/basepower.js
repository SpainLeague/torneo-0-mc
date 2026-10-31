// Base power: first the moves whose power depends on battle state, then the
// chain of modifiers that scale whatever number came out of that.
//
// The modifier chain is grouped exactly the way the games group it. Several of
// these groups are mutually exclusive — a Technician boost and a Sharpness boost
// never both apply — so the grouping is load-bearing, not cosmetic.

import {chainMods, mod, pokeRound} from './util.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const countBoosts = (boosts, sign) =>
  Object.values(boosts ?? {}).filter((b) => (sign > 0 ? b > 0 : b < 0)).reduce((a, b) => a + b, 0);

/** Abilities that convert Normal moves to another type and boost them 1.2x. */
const ATE_ABILITIES = {aerilate: 'Flying', pixilate: 'Fairy', refrigerate: 'Ice', galvanize: 'Electric'};

/** The move's type after any ability, item or field effect rewrites it. */
export function moveType(move, attacker, field) {
  switch (move.id) {
    case 'weatherball': {
      const umbrella = attacker.item === 'utilityumbrella';
      if (!umbrella && (field.weather === 'sun' || field.weather === 'harshsunshine')) return 'Fire';
      if (!umbrella && (field.weather === 'rain' || field.weather === 'heavyrain')) return 'Water';
      if (field.weather === 'sand') return 'Rock';
      if (field.weather === 'snow' || field.weather === 'hail') return 'Ice';
      return 'Normal';
    }
    case 'terrainpulse':
      if (!attacker.grounded || !field.terrain) return 'Normal';
      return {electric: 'Electric', grassy: 'Grass', misty: 'Fairy', psychic: 'Psychic'}[field.terrain];
    case 'terablast':
      if (attacker.teraType) {
        return attacker.teraType === 'Stellar' ? move.type : attacker.teraType;
      }
      break; // not Terastallized: falls through to the -ate abilities below
    case 'judgment': case 'multiattack': case 'technoblast': case 'ragingbull':
    case 'revelationdance': case 'naturalgift': case 'naturepower':
      return attacker.overrideMoveType || move.type;
    default:
      break;
  }
  if (move.cat === 'Status') return move.type;
  if (NO_TYPE_CHANGE.has(move.id)) return move.type;
  if (ATE_ABILITIES[attacker.ability] && move.type === 'Normal') return ATE_ABILITIES[attacker.ability];
  if (attacker.ability === 'normalize') return 'Normal';
  if (attacker.ability === 'liquidvoice' && move.flags?.includes('sound')) return 'Water';
  return move.type;
}

/** True when an -ate ability actually changed this move's type. */
/** Moves whose type is already decided and which -ate abilities never touch. */
const NO_TYPE_CHANGE = new Set(['revelationdance', 'judgment', 'naturepower', 'technoblast',
  'multiattack', 'naturalgift', 'weatherball', 'terrainpulse', 'struggle']);

/** True when an -ate ability actually changed this move's type. */
export function ateBoosted(move, attacker) {
  if (NO_TYPE_CHANGE.has(move.id)) return false;
  if (move.id === 'terablast' && attacker.teraType) return false;
  return move.type === 'Normal' && move.cat !== 'Status' && !!ATE_ABILITIES[attacker.ability];
}

/**
 * Base power before modifiers.
 *
 * `state` carries the battle context these moves read: prior hits, allies
 * fainted, turn order, and so on.
 */
export function rawBasePower(move, attacker, defender, field, state) {
  const bp = move.bp;
  switch (move.id) {
    // --- Weight based -------------------------------------------------------
    case 'lowkick': case 'grassknot': {
      const w = defender.weight;
      return w >= 200 ? 120 : w >= 100 ? 100 : w >= 50 ? 80 : w >= 25 ? 60 : w >= 10 ? 40 : 20;
    }
    case 'heavyslam': case 'heatcrash': {
      const r = attacker.weight / Math.max(0.1, defender.weight);
      return r >= 5 ? 120 : r >= 4 ? 100 : r >= 3 ? 80 : r >= 2 ? 60 : 40;
    }
    // --- Speed based --------------------------------------------------------
    case 'gyroball':
      return clamp(Math.floor((25 * defender.speed) / Math.max(1, attacker.speed)) + 1, 1, 150);
    case 'electroball': {
      const r = attacker.speed / Math.max(1, defender.speed);
      return r >= 4 ? 150 : r >= 3 ? 120 : r >= 2 ? 80 : r > 1 ? 60 : 40;
    }
    // --- HP based -----------------------------------------------------------
    case 'eruption': case 'waterspout': case 'dragonenergy':
      return Math.max(1, Math.floor((150 * attacker.currentHP) / attacker.maxHP));
    case 'flail': case 'reversal': {
      const p = Math.floor((48 * attacker.currentHP) / attacker.maxHP);
      return p <= 1 ? 200 : p <= 4 ? 150 : p <= 9 ? 100 : p <= 16 ? 80 : p <= 32 ? 40 : 20;
    }
    case 'crushgrip': case 'wringout':
      return Math.max(1, Math.floor((120 * defender.currentHP) / defender.maxHP));
    case 'hardpress':
      return Math.max(1, Math.floor((100 * defender.currentHP) / defender.maxHP));
    // --- Status of the target ----------------------------------------------
    case 'hex': case 'infernalparade':
      return defender.status && defender.status !== 'none' ? bp * 2 : bp;
    case 'barbbarrage':
      return ['psn', 'tox'].includes(defender.status) ? bp * 2 : bp;
    case 'smellingsalts':
      return defender.status === 'par' ? bp * 2 : bp;
    case 'wakeupslap':
      return defender.status === 'slp' ? bp * 2 : bp;
    // --- Attacker's own state ----------------------------------------------
    case 'acrobatics':
      return attacker.heldItem ? bp : bp * 2;
    case 'ragefist':
      return clamp(bp * (1 + (state.timesHit ?? 0)), 1, 350);
    case 'lastrespects':
      return clamp(bp * (1 + (state.alliesFainted ?? 0)), 1, 5050);
    case 'storedpower': case 'powertrip':
      return bp + 20 * countBoosts(attacker.boosts, 1);
    case 'punishment':
      return clamp(60 + 20 * countBoosts(defender.boosts, 1), 60, 200);
    // --- Turn order / prior damage -----------------------------------------
    case 'payback':
      return state.movesSecond ? bp * 2 : bp;
    case 'avalanche': case 'revenge':
      // These need the user to have taken damage from the target this turn,
      // which moving second does not by itself imply.
      return state.wasHitThisTurn ? bp * 2 : bp;
    case 'assurance':
      return state.targetAlreadyDamaged ? bp * 2 : bp;
    case 'boltbeak': case 'fishiousrend':
      return state.movesFirst ? bp * 2 : bp;
    case 'round':
      return state.allyUsedRound ? bp * 2 : bp;
    case 'retaliate':
      return state.allyFaintedLastTurn ? bp * 2 : bp;
    // --- Field --------------------------------------------------------------
    case 'risingvoltage':
      return field.terrain === 'electric' && defender.grounded ? bp * 2 : bp;
    case 'terrainpulse':
      return field.terrain && attacker.grounded ? bp * 2 : bp;
    case 'weatherball': {
      if (!field.weather || field.weather === 'strongwinds') return bp;
      const sunOrRain = ['sun', 'harshsunshine', 'rain', 'heavyrain'].includes(field.weather);
      return sunOrRain && attacker.item === 'utilityumbrella' ? bp : bp * 2;
    }
    // --- Misc ---------------------------------------------------------------
    case 'terablast':
      return attacker.teraType === 'Stellar' ? 100 : bp;
    case 'furycutter':
      return clamp(bp * 2 ** (state.consecutive ?? 0), bp, 160);
    case 'echoedvoice':
      return clamp(bp * (1 + (state.consecutive ?? 0)), bp, 200);
    case 'beatup':
      return state.beatUpPower ?? bp;
    case 'present':
      return state.presentPower ?? 40;
    case 'magnitude':
      return state.magnitudePower ?? 70;
    default:
      return bp;
  }
}

/** Whether Knock Off's boost applies — some items cannot be knocked off. */
function knockOffBoosts(defender) {
  if (!defender.heldItem) return false;
  return !defender.itemUnremovable;
}

/**
 * The modifier chain applied to base power, in game order.
 *
 * Groups written as if/else-if here are mutually exclusive in the games too.
 */
export function basePowerMods(move, attacker, defender, field, state, power) {
  const mods = [];
  const notes = [];
  const add = (m, note) => { mods.push(m); if (note) notes.push(note); };
  const flag = (f) => !!move.flags?.includes(f);
  const grounded = attacker.grounded;

  // --- Group 1: move-specific power doublers (mutually exclusive) -----------
  if ((move.id === 'facade' && ['brn', 'par', 'psn', 'tox'].includes(attacker.status)) ||
      (move.id === 'brine' && defender.currentHP * 2 <= defender.maxHP) ||
      (move.id === 'venoshock' && ['psn', 'tox'].includes(defender.status)) ||
      (move.id === 'lashout' && countBoosts(attacker.boosts, -1) < 0)) {
    add(8192, move.name);
  } else if (move.id === 'expandingforce' && grounded && field.terrain === 'psychic') {
    add(6144, 'Expanding Force in Psychic Terrain');
  } else if ((move.id === 'knockoff' && knockOffBoosts(defender)) ||
             (move.id === 'mistyexplosion' && grounded && field.terrain === 'misty') ||
             (move.id === 'gravapple' && field.gravity)) {
    add(6144, move.name);
  } else if ((move.id === 'solarbeam' || move.id === 'solarblade') &&
             ['rain', 'heavyrain', 'sand', 'snow', 'hail'].includes(field.weather)) {
    add(2048, 'Solar Beam weakened by weather');
  } else if ((move.id === 'collisioncourse' || move.id === 'electrodrift') && state.superEffective) {
    add(5461, `${move.name} on a super effective hit`);
  }

  // --- Group 2: side conditions --------------------------------------------
  if (state.helpingHand) add(6144, 'Helping Hand');

  // --- Group 3: terrain -----------------------------------------------------
  if (grounded) {
    if ((field.terrain === 'electric' && move.type === 'Electric') ||
        (field.terrain === 'grassy' && move.type === 'Grass') ||
        (field.terrain === 'psychic' && move.type === 'Psychic')) {
      add(5325, `${field.terrain} terrain`);
    }
  }
  if (defender.grounded) {
    if ((field.terrain === 'misty' && move.type === 'Dragon') ||
        (field.terrain === 'grassy' && ['bulldoze', 'earthquake'].includes(move.id))) {
      add(2048, `${field.terrain} terrain weakens it`);
    }
  }

  // --- Group 4: flat 1.5x attacker abilities --------------------------------
  if ((attacker.ability === 'technician' && power <= 60) ||
      (attacker.ability === 'flareboost' && attacker.status === 'brn' && move.cat === 'Special') ||
      (attacker.ability === 'toxicboost' && ['psn', 'tox'].includes(attacker.status) && move.cat === 'Physical') ||
      (attacker.ability === 'megalauncher' && flag('pulse')) ||
      (attacker.ability === 'strongjaw' && flag('bite')) ||
      (attacker.ability === 'steelyspirit' && move.type === 'Steel') ||
      (attacker.ability === 'sharpness' && flag('slicing'))) {
    add(6144, state.abilityName(attacker.ability));
  }

  // --- Group 5: Dark Aura / Fairy Aura -------------------------------------
  const aura = move.type === 'Dark' ? 'darkaura' : move.type === 'Fairy' ? 'fairyaura' : null;
  if (aura && (attacker.ability === aura || defender.ability === aura || state.auraActive === aura)) {
    const broken = attacker.ability === 'aurabreak' || defender.ability === 'aurabreak';
    add(broken ? 3072 : 5448, broken ? 'Aura Break' : state.abilityName(aura));
  }

  // --- Group 6: flat 1.3x attacker abilities --------------------------------
  if ((attacker.ability === 'sheerforce' && state.hasSecondaryEffect) ||
      (attacker.ability === 'sandforce' && field.weather === 'sand' && ['Rock', 'Ground', 'Steel'].includes(move.type)) ||
      (attacker.ability === 'analytic' && state.movesSecond) ||
      (attacker.ability === 'toughclaws' && flag('contact')) ||
      (attacker.ability === 'punkrock' && flag('sound'))) {
    add(5325, state.abilityName(attacker.ability));
  }

  // --- Group 7: ally abilities ---------------------------------------------
  if (state.battery && move.cat === 'Special') add(5325, 'Battery');
  if (state.powerSpot) add(5325, 'Power Spot');

  // --- Group 8: Rivalry -----------------------------------------------------
  if (attacker.ability === 'rivalry' && attacker.gender !== 'N' && defender.gender !== 'N' && attacker.gender && defender.gender) {
    if (attacker.gender === defender.gender) add(5120, 'Rivalry');
    else add(3072, 'Rivalry');
  }

  // --- Group 9: type-changing and recoil abilities --------------------------
  if (state.ateBoosted) add(4915, '-ate ability');
  if ((attacker.ability === 'reckless' && (move.recoil || ['highjumpkick', 'jumpkick'].includes(move.id))) ||
      (attacker.ability === 'ironfist' && flag('punch'))) {
    add(4915, state.abilityName(attacker.ability));
  }

  // --- Group 10: defender ability ------------------------------------------
  if (defender.ability === 'dryskin' && move.type === 'Fire' && !state.abilityIgnored) {
    add(5120, 'Dry Skin');
  }

  // --- Group 11: Supreme Overlord -------------------------------------------
  if (attacker.ability === 'supremeoverlord' && state.alliesFainted) {
    const powMod = [4096, 4506, 4915, 5325, 5734, 6144];
    add(powMod[Math.min(5, state.alliesFainted)], 'Supreme Overlord');
  }

  // --- Group 12: items (mutually exclusive) ---------------------------------
  const item = attacker.item;
  if (item && state.itemName(item) === `${move.type} Gem`) {
    add(5325, `${move.type} Gem`);
  } else if (state.signatureItemBoost || TYPE_BOOST_ITEMS[item] === move.type) {
    add(4915, state.itemName(item));
  } else if ((item === 'muscleband' && move.cat === 'Physical') ||
             (item === 'wiseglasses' && move.cat === 'Special')) {
    add(4505, state.itemName(item));
  } else if (item === 'punchingglove' && flag('punch')) {
    add(4506, 'Punching Glove');
  }

  return {mods, notes};
}

/**
 * Terastallizing puts a floor of 60 under a single-hit, non-priority move that
 * matches the Tera type. It applies after the modifier chain, so a 40 BP move
 * boosted to 52 still lands on 60 rather than on 60-times-the-modifiers.
 */
function teraFloor(move, attacker, state, power) {
  if (!attacker.teraType || power >= 60) return null;
  const matches = move.type === attacker.teraType ||
    (attacker.teraType === 'Stellar' && state.stellarFirstUse);
  if (!matches) return null;
  if ((state.hits ?? 1) !== 1) return null;
  if (move.pri > 0 || !move.bp) return null;
  if (['dragonenergy', 'eruption', 'waterspout'].includes(move.id)) return null;
  return 60;
}

/** Fold the raw base power and its modifier chain together. */
export function finalBasePower(move, attacker, defender, field, state) {
  const raw = rawBasePower(move, attacker, defender, field, state);
  const {mods, notes} = basePowerMods(move, attacker, defender, field, state, raw);
  let value = Math.max(1, pokeRound((raw * chainMods(mods, 41, 2097152)) / 4096));
  const floored = teraFloor(move, attacker, state, value);
  if (floored) {
    value = floored;
    notes.push('Terastal raises this move to 60 BP');
  }
  return {value, raw, notes};
}

/**
 * Items that give a flat 1.2x to one type: the classic held items, the plates,
 * and the Arceus/Silvally memories, which all behave identically.
 */
const TYPE_BOOST_ITEMS = {
  silkscarf: 'Normal', charcoal: 'Fire', mysticwater: 'Water', magnet: 'Electric',
  miracleseed: 'Grass', nevermeltice: 'Ice', blackbelt: 'Fighting', poisonbarb: 'Poison',
  softsand: 'Ground', sharpbeak: 'Flying', twistedspoon: 'Psychic', silverpowder: 'Bug',
  hardstone: 'Rock', spelltag: 'Ghost', dragonfang: 'Dragon', blackglasses: 'Dark',
  metalcoat: 'Steel', fairyfeather: 'Fairy', oddincense: 'Psychic', rockincense: 'Rock',
  roseincense: 'Grass', seaincense: 'Water', waveincense: 'Water',
  flameplate: 'Fire', splashplate: 'Water', zapplate: 'Electric', meadowplate: 'Grass',
  icicleplate: 'Ice', fistplate: 'Fighting', toxicplate: 'Poison', earthplate: 'Ground',
  skyplate: 'Flying', mindplate: 'Psychic', insectplate: 'Bug', stoneplate: 'Rock',
  spookyplate: 'Ghost', dracoplate: 'Dragon', dreadplate: 'Dark', ironplate: 'Steel',
  pixieplate: 'Fairy',
  firememory: 'Fire', watermemory: 'Water', electricmemory: 'Electric',
  grassmemory: 'Grass', icememory: 'Ice', fightingmemory: 'Fighting',
  poisonmemory: 'Poison', groundmemory: 'Ground', flyingmemory: 'Flying',
  psychicmemory: 'Psychic', bugmemory: 'Bug', rockmemory: 'Rock',
  ghostmemory: 'Ghost', dragonmemory: 'Dragon', darkmemory: 'Dark',
  steelmemory: 'Steel', fairymemory: 'Fairy',
};

export {mod, TYPE_BOOST_ITEMS};
