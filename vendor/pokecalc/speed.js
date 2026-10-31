// Final in-battle Speed.
//
// This matters for damage in two ways: Gyro Ball and Electro Ball read it
// directly, and Payback, Bolt Beak, Fishious Rend and Analytic key off who moves
// first. It is also the number VGC players want to see next to a calc anyway.

import {chainMods, pokeRound} from './util.js';
import {applyBoost} from './stats.js';
import {quarkActive, quarkBoostedStat} from './statmods.js';

/** EV-training items that halve Speed while held. */
const SPEED_DROP_ITEMS = new Set(['ironball', 'machobrace', 'poweranklet', 'powerband',
  'powerbelt', 'powerbracer', 'powerlens', 'powerweight']);

export function finalSpeed(pokemon, field, side = {}) {
  let speed = applyBoost(pokemon.rawStats.spe, pokemon.boosts.spe ?? 0);
  const mods = [];
  const notes = [];
  const add = (m, note) => { mods.push(m); notes.push(note); };
  const weather = field.weather ?? '';

  if (side.tailwind) add(8192, 'Tailwind');

  const unburden = pokemon.ability === 'unburden' && side.unburdenActive;
  if (unburden ||
      (pokemon.ability === 'chlorophyll' && (weather === 'sun' || weather === 'harshsunshine')) ||
      (pokemon.ability === 'sandrush' && weather === 'sand') ||
      (pokemon.ability === 'swiftswim' && (weather === 'rain' || weather === 'heavyrain')) ||
      (pokemon.ability === 'slushrush' && (weather === 'snow' || weather === 'hail')) ||
      (pokemon.ability === 'surgesurfer' && field.terrain === 'electric')) {
    add(8192, 'Speed ability');
  } else if (pokemon.ability === 'quickfeet' && pokemon.status) {
    add(6144, 'Quick Feet');
  } else if (pokemon.ability === 'slowstart' && side.slowStartActive) {
    add(2048, 'Slow Start');
  } else if (quarkActive(pokemon, field) &&
             (pokemon.boostedStat && pokemon.boostedStat !== 'auto'
               ? pokemon.boostedStat : quarkBoostedStat(pokemon)) === 'spe') {
    add(6144, 'Protosynthesis/Quark Drive');
  }

  if (!unburden) {
    if (pokemon.item === 'choicescarf') add(6144, 'Choice Scarf');
    else if (SPEED_DROP_ITEMS.has(pokemon.item)) add(2048, 'Speed-lowering item');
    else if (pokemon.item === 'quickpowder' && pokemon.name === 'Ditto') add(8192, 'Quick Powder');
  }

  speed = pokeRound((speed * chainMods(mods, 410, 131172)) / 4096);

  // Paralysis halves Speed last, and Quick Feet is immune to that cut.
  if (pokemon.status === 'par' && pokemon.ability !== 'quickfeet') {
    speed = Math.floor((speed * 50) / 100);
    notes.push('paralysis');
  }

  return {value: Math.max(0, Math.min(10000, speed)), notes};
}

/**
 * Who acts first, given equal move priority.
 *
 * Trick Room inverts the comparison; genuine ties are decided by a coin flip in
 * game, which this reports as `null` rather than pretending to know.
 */
export function turnOrder(attackerSpeed, defenderSpeed, field = {}) {
  if (attackerSpeed === defenderSpeed) return null;
  const faster = attackerSpeed > defenderSpeed;
  return field.trickRoom ? !faster : faster;
}
