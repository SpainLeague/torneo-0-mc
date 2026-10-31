// Offensive and defensive stat pipelines.
//
// Each side computes a raw stat, applies stat stages (with the exceptions a
// critical hit and Unaware carve out), applies the two hard-coded 1.5x steps
// that sit outside the modifier chain, and only then folds in its chain.

import {chainMods, pokeRound} from './util.js';
import {applyBoost} from './stats.js';

/** The stat Protosynthesis / Quark Drive picks: the highest after boosts. */
export function quarkBoostedStat(pokemon) {
  let best = 'atk';
  for (const stat of ['def', 'spa', 'spd', 'spe']) {
    if (applyBoost(pokemon.rawStats[stat], pokemon.boosts[stat] ?? 0) >
        applyBoost(pokemon.rawStats[best], pokemon.boosts[best] ?? 0)) {
      best = stat;
    }
  }
  return best;
}

/** Whether Protosynthesis / Quark Drive is currently switched on. */
export function quarkActive(pokemon, field) {
  if (pokemon.ability === 'protosynthesis') {
    return field.weather === 'sun' || field.weather === 'harshsunshine' || pokemon.item === 'boosterenergy';
  }
  if (pokemon.ability === 'quarkdrive') {
    return field.terrain === 'electric' || pokemon.item === 'boosterenergy';
  }
  return false;
}

/** Which stat the move attacks with, and whose it is. */
export function offensiveStat(move) {
  if (move.id === 'bodypress') return 'def';
  return move.cat === 'Special' ? 'spa' : 'atk';
}

/** Which of the defender's stats takes the hit. */
export function defensiveStat(move) {
  // Psyshock and friends are Special moves that hit physical Defense.
  const hitsPhysical = move.defStat === 'def' || move.cat === 'Physical';
  return {stat: hitsPhysical ? 'def' : 'spd', hitsPhysical};
}

export function calculateAttack(move, attacker, defender, field, state, isCritical) {
  const notes = [];
  // Foul Play attacks with the *target's* Attack stat.
  const source = move.id === 'foulplay' ? defender : attacker;
  const stat = offensiveStat(move);
  const boost = source.boosts[stat] ?? 0;

  let attack;
  if (boost === 0 || (isCritical && boost < 0)) {
    // A critical hit ignores the attacker's negative stat stages.
    attack = source.rawStats[stat];
    if (isCritical && boost < 0) notes.push('crit ignores the Attack drop');
  } else if (defender.ability === 'unaware' && !state.abilityIgnored) {
    attack = source.rawStats[stat];
    notes.push('Unaware ignores the boost');
  } else {
    attack = applyBoost(source.rawStats[stat], boost);
  }

  // Hustle sits outside the modifier chain.
  if (attacker.ability === 'hustle' && move.cat === 'Physical') {
    attack = pokeRound((attack * 3) / 2);
    notes.push('Hustle');
  }

  const mods = attackMods(move, attacker, defender, field, state, notes);
  return {
    value: Math.max(1, pokeRound((attack * chainMods(mods, 410, 131072)) / 4096)),
    stat,
    source: source === defender ? 'defender' : 'attacker',
    notes,
  };
}

function attackMods(move, attacker, defender, field, state, notes) {
  const mods = [];
  const add = (m, note) => { mods.push(m); if (note) notes.push(note); };
  const name = state.abilityName;
  const sun = field.weather === 'sun' || field.weather === 'harshsunshine';

  // One 1.5x/2x/0.5x attacker ability at most, in this priority order.
  if ((attacker.ability === 'slowstart' && state.slowStartActive && move.cat === 'Physical') ||
      (attacker.ability === 'defeatist' && attacker.currentHP <= attacker.maxHP / 2)) {
    add(2048, name(attacker.ability));
  } else if (attacker.ability === 'solarpower' && sun && move.cat === 'Special') {
    add(6144, 'Solar Power');
  } else if (attacker.ability === 'gorillatactics' && move.cat === 'Physical') {
    add(6144, 'Gorilla Tactics');
  } else if ((attacker.ability === 'guts' && attacker.status && attacker.status !== 'none' && move.cat === 'Physical') ||
             (attacker.currentHP <= attacker.maxHP / 3 &&
               ((attacker.ability === 'overgrow' && move.type === 'Grass') ||
                (attacker.ability === 'blaze' && move.type === 'Fire') ||
                (attacker.ability === 'torrent' && move.type === 'Water') ||
                (attacker.ability === 'swarm' && move.type === 'Bug')))) {
    add(6144, name(attacker.ability));
  } else if (attacker.ability === 'flashfire' && state.flashFireActive && move.type === 'Fire') {
    add(6144, 'Flash Fire');
  } else if ((attacker.ability === 'steelworker' && move.type === 'Steel') ||
             (attacker.ability === 'dragonsmaw' && move.type === 'Dragon') ||
             (attacker.ability === 'rockypayload' && move.type === 'Rock')) {
    add(6144, name(attacker.ability));
  } else if (attacker.ability === 'transistor' && move.type === 'Electric') {
    add(5325, 'Transistor');
  } else if (attacker.ability === 'stakeout' && state.stakeoutActive) {
    add(8192, 'Stakeout');
  } else if ((attacker.ability === 'waterbubble' && move.type === 'Water') ||
             (['hugepower', 'purepower'].includes(attacker.ability) && move.cat === 'Physical')) {
    add(8192, name(attacker.ability));
  }

  if (state.allyFlowerGift && sun && move.cat === 'Physical') add(6144, 'Flower Gift (ally)');
  if (state.allySteelySpirit && move.type === 'Steel') add(6144, 'Steely Spirit (ally)');

  // Defensive abilities that halve incoming power by cutting Attack.
  if (!state.abilityIgnored) {
    if ((defender.ability === 'thickfat' && ['Fire', 'Ice'].includes(move.type)) ||
        (defender.ability === 'waterbubble' && move.type === 'Fire') ||
        (defender.ability === 'purifyingsalt' && move.type === 'Ghost')) {
      add(2048, name(defender.ability));
    }
    if (defender.ability === 'heatproof' && move.type === 'Fire') add(2048, 'Heatproof');
  }

  // Treasures of Ruin lower the corresponding offensive stat of everyone else.
  const tablets = (defender.ability === 'tabletsofruin' || state.tabletsOfRuin) && attacker.ability !== 'tabletsofruin';
  const vessel = (defender.ability === 'vesselofruin' || state.vesselOfRuin) && attacker.ability !== 'vesselofruin';
  if ((tablets && move.cat === 'Physical') || (vessel && move.cat === 'Special')) {
    add(3072, move.cat === 'Physical' ? 'Tablets of Ruin' : 'Vessel of Ruin');
  }

  if (quarkActive(attacker, field)) {
    const boosted = attacker.boostedStat && attacker.boostedStat !== 'auto'
      ? attacker.boostedStat : quarkBoostedStat(attacker);
    if ((move.cat === 'Physical' && boosted === 'atk') || (move.cat === 'Special' && boosted === 'spa')) {
      add(5325, name(attacker.ability));
    }
  }

  if ((attacker.ability === 'hadronengine' && move.cat === 'Special' && field.terrain === 'electric') ||
      (attacker.ability === 'orichalcumpulse' && move.cat === 'Physical' && sun && attacker.item !== 'utilityumbrella')) {
    add(5461, name(attacker.ability));
  }

  // Items: the species-locked doublers beat the Choice items.
  if (state.doublingItem) {
    add(8192, state.itemName(attacker.item));
  } else if ((attacker.item === 'choiceband' && move.cat === 'Physical') ||
             (attacker.item === 'choicespecs' && move.cat === 'Special')) {
    add(6144, state.itemName(attacker.item));
  }

  return mods;
}

export function calculateDefense(move, attacker, defender, field, state, isCritical) {
  const notes = [];
  const {stat, hitsPhysical} = defensiveStat(move);
  const boost = defender.boosts[stat] ?? 0;

  let defense;
  if (boost === 0 || (isCritical && boost > 0) || move.ignoreDef) {
    // A critical hit ignores the defender's positive stat stages.
    defense = defender.rawStats[stat];
    if (isCritical && boost > 0) notes.push('crit ignores the Defense boost');
    if (move.ignoreDef && boost > 0) notes.push(`${move.name} ignores stat changes`);
  } else if (attacker.ability === 'unaware') {
    defense = defender.rawStats[stat];
    notes.push('Unaware ignores the boost');
  } else {
    defense = applyBoost(defender.rawStats[stat], boost);
  }

  // Sand and Snow give a hard 1.5x to the relevant defence, outside the chain.
  if (field.weather === 'sand' && state.defenderTypes.includes('Rock') && !hitsPhysical) {
    defense = pokeRound((defense * 3) / 2);
    notes.push('Sandstorm Sp. Def boost');
  }
  if (field.weather === 'snow' && state.defenderTypes.includes('Ice') && hitsPhysical) {
    defense = pokeRound((defense * 3) / 2);
    notes.push('Snow Defense boost');
  }

  const mods = defenseMods(move, attacker, defender, field, state, hitsPhysical, notes);
  return {
    value: Math.max(1, pokeRound((defense * chainMods(mods, 410, 131072)) / 4096)),
    stat,
    hitsPhysical,
    notes,
  };
}

function defenseMods(move, attacker, defender, field, state, hitsPhysical, notes) {
  const mods = [];
  const add = (m, note) => { mods.push(m); if (note) notes.push(note); };
  const name = state.abilityName;
  const sun = field.weather === 'sun' || field.weather === 'harshsunshine';

  if (!state.abilityIgnored) {
    if (defender.ability === 'marvelscale' && defender.status && defender.status !== 'none' && hitsPhysical) {
      add(6144, 'Marvel Scale');
    } else if (state.defenderFlowerGift && sun && !hitsPhysical) {
      add(6144, 'Flower Gift');
    } else if (defender.ability === 'grasspelt' && field.terrain === 'grassy' && hitsPhysical) {
      add(6144, 'Grass Pelt');
    } else if (defender.ability === 'furcoat' && hitsPhysical) {
      add(8192, 'Fur Coat');
    }
  }

  const sword = (attacker.ability === 'swordofruin' || state.swordOfRuin) && defender.ability !== 'swordofruin';
  const beads = (attacker.ability === 'beadsofruin' || state.beadsOfRuin) && defender.ability !== 'beadsofruin';
  if ((sword && hitsPhysical) || (beads && !hitsPhysical)) {
    add(3072, hitsPhysical ? 'Sword of Ruin' : 'Beads of Ruin');
  }

  if (quarkActive(defender, field)) {
    const boosted = defender.boostedStat && defender.boostedStat !== 'auto'
      ? defender.boostedStat : quarkBoostedStat(defender);
    if ((hitsPhysical && boosted === 'def') || (!hitsPhysical && boosted === 'spd')) {
      add(5324, name(defender.ability));
    }
  }

  if ((defender.item === 'eviolite' && state.defenderNFE) ||
      (!hitsPhysical && defender.item === 'assaultvest')) {
    add(6144, state.itemName(defender.item));
  }

  return mods;
}
