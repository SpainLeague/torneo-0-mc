// The damage calculation itself.
//
//   base = ((2*Level/5 + 2) * BasePower * Attack / Defense) / 50 + 2
//
// then spread, weather and critical multipliers on the base, then for each of
// the sixteen random rolls: STAB, type effectiveness, burn, and a final
// modifier chain carrying screens, Life Orb, Multiscale, resist berries and the
// rest. Truncation happens at almost every step, which is why this is written
// out step by step rather than as one expression.

import {chainMods, pokeRound, toID} from './util.js';
import {computeStats, applyBoost} from './stats.js';
import {typeEffectiveness, stabModifier, effectiveTypes} from './types.js';
import {finalBasePower, moveType, ateBoosted} from './basepower.js';
import {calculateAttack, calculateDefense, defensiveStat} from './statmods.js';
import {finalSpeed, turnOrder} from './speed.js';

/** Berries that halve a super effective hit of their type. */
const RESIST_BERRIES = {
  chilanberry: 'Normal', occaberry: 'Fire', passhoberry: 'Water', wacanberry: 'Electric',
  rindoberry: 'Grass', yacheberry: 'Ice', chopleberry: 'Fighting', kebiaberry: 'Poison',
  shucaberry: 'Ground', cobaberry: 'Flying', payapaberry: 'Psychic', tangaberry: 'Bug',
  chartiberry: 'Rock', kasibberry: 'Ghost', habanberry: 'Dragon', colburberry: 'Dark',
  babiriberry: 'Steel', roseliberry: 'Fairy',
};

/**
 * Items that cannot be knocked off, so Knock Off gets no boost against them.
 * Mega Stones are identified from the dataset rather than by name — "-ite" also
 * matches Eviolite, which very much can be knocked off.
 */
const UNREMOVABLE = new Set([
  'redorb', 'blueorb', 'griseouscore', 'griseousorb', 'adamantcrystal', 'lustrousglobe',
  'rustedsword', 'rustedshield', 'cornerstonemask', 'hearthflamemask', 'wellspringmask',
  'boosterenergy',
]);

function isUnremovable(itemId, data) {
  if (!itemId) return false;
  if (UNREMOVABLE.has(itemId)) return true;
  return !!data.items[itemId]?.megaStone;
}

/** Species-locked items that double an offensive stat. */
function isDoublingItem(attacker, move) {
  const {item, name} = attacker;
  if (item === 'thickclub' && ['Cubone', 'Marowak', 'Marowak-Alola'].includes(name) && move.cat === 'Physical') return true;
  if (item === 'deepseatooth' && name === 'Clamperl' && move.cat === 'Special') return true;
  if (item === 'lightball' && name.includes('Pikachu')) return true;
  return false;
}

/**
 * Moves that hit more than one target take a 0.75x penalty in doubles.
 * This is the single most common reason a doubles calc differs from a singles one.
 */
export function isSpread(move, field) {
  return field.gameType !== 'singles' && ['allAdjacent', 'allAdjacentFoes'].includes(move.target);
}

/**
 * Moves that deal nothing at all unless a precondition holds. These fail loudly
 * in a real battle, so a calculator that quietly reports damage is misleading.
 */
function blockedReason(move, attacker, defender, field) {
  // An Air Balloon lifts its holder clear of Ground moves entirely.
  if (move.type === 'Ground' && move.id !== 'thousandarrows' && !field.gravity &&
      defender.item === 'airballoon') {
    return 'Air Balloon';
  }
  // Psychic Terrain shields grounded Pokémon from priority moves.
  if (move.pri > 0 && field.terrain === 'psychic' && defender.grounded) {
    return 'Psychic Terrain blocks priority moves';
  }
  switch (move.id) {
    case 'dreameater':
      if (defender.status !== 'slp' && defender.ability !== 'comatose') return 'target is not asleep';
      return null;
    case 'steelroller':
      return field.terrain ? null : 'no terrain is active';
    case 'poltergeist':
      return defender.item ? null : 'target has no item';
    case 'skydrop':
      if (defender.types.includes('Flying') || defender.weight >= 200 || field.gravity) {
        return 'target cannot be picked up';
      }
      return null;
    case 'synchronoise':
      return attacker.types.some((t) => defender.types.includes(t)) ? null : 'no shared type';
    default:
      return null;
  }
}

/** Whether the attacker's ability ignores the defender's ability entirely. */
function ignoresAbility(attacker, move) {
  return ['moldbreaker', 'turboblaze', 'teravolt', 'myceliummight'].includes(attacker.ability) ||
         ['moongeistbeam', 'sunsteelstrike', 'photongeyser', 'lightthatburnsthesky'].includes(move.id);
}

/**
 * Build the side object the pipeline reads from a user-supplied set.
 */
export function buildSide(set, data) {
  const species = data.species[set.species];
  if (!species) throw new Error(`Unknown species: ${set.species}`);
  const {raw, boosted} = computeStats(set, species.stats, data.natures);
  const maxHP = raw.hp;
  const currentHP = set.currentHP ?? Math.floor((maxHP * (set.hpPercent ?? 100)) / 100);
  return {
    id: set.species,
    name: species.name,
    display: species.display,
    types: species.types,
    teraType: set.teraType || null,
    weight: set.weight ?? species.weight,
    ability: toID(set.ability ?? species.abilities[0]),
    // Klutz switches the holder's item off; it is still held (so Knock Off and
    // Acrobatics see it) but grants nothing.
    item: toID(set.ability ?? species.abilities[0]) === 'klutz' ? null
      : (set.item ? toID(set.item) : null),
    heldItem: set.item ? toID(set.item) : null,
    status: set.status ?? null,
    boosts: {atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...(set.boosts ?? {})},
    rawStats: raw,
    stats: boosted,
    maxHP,
    currentHP: Math.max(0, Math.min(maxHP, currentHP)),
    speed: boosted.spe,
    gender: set.gender ?? species.gender ?? 'M',
    boostedStat: set.boostedStat ?? null,
    grounded: isGrounded(set, species),
    itemUnremovable: isUnremovable(set.item ? toID(set.item) : null, data),
    level: set.level ?? 50,
    nfe: !!species.nfe,
  };
}

function isGrounded(set, species) {
  if (set.grounded !== undefined) return set.grounded;
  const item = toID(set.item ?? '');
  if (item === 'ironball') return true;
  // Tera Stellar leaves the type line — and so the grounding — untouched.
  const types = set.teraType && set.teraType !== 'Stellar' ? [set.teraType] : species.types;
  if (types.includes('Flying')) return false;
  if (toID(set.ability ?? species.abilities[0]) === 'levitate') return false;
  if (item === 'airballoon') return false;
  return true;
}

/**
 * Run the calculation.
 *
 * Returns the sixteen possible damage rolls plus everything the UI needs to
 * explain them.
 */
export function calculate(attackerSet, defenderSet, moveInput, fieldInput, data) {
  const field = {
    gameType: 'doubles',
    weather: null,
    terrain: null,
    gravity: false,
    ...fieldInput,
  };
  // Meteor Beam and Electro Shot raise Sp. Atk on the charging turn, so the hit
  // that lands is always calculated with the boost already applied.
  let effectiveAttackerSet = attackerSet;
  const chargeMove = toID(moveInput.id ?? moveInput.name ?? moveInput);
  if (chargeMove === 'meteorbeam' || chargeMove === 'electroshot') {
    const ability = toID(attackerSet.ability ?? data.species[attackerSet.species]?.abilities[0]);
    const delta = ability === 'simple' ? 2 : ability === 'contrary' ? -1 : 1;
    const boosts = {...(attackerSet.boosts ?? {})};
    boosts.spa = Math.max(-6, Math.min(6, (boosts.spa ?? 0) + delta));
    effectiveAttackerSet = {...attackerSet, boosts};
  }
  const attacker = buildSide(effectiveAttackerSet, data);
  const defender = buildSide(defenderSet, data);

  // Cloud Nine and Air Lock suppress the weather while either Pokémon is out;
  // Teraform Zero clears the terrain too.
  for (const side of [attacker, defender]) {
    if (side.ability === 'cloudnine' || side.ability === 'airlock') field.weather = null;
    if (side.ability === 'teraformzero') { field.weather = null; field.terrain = null; }
  }

  attacker.speed = finalSpeed(attacker, field, {
    tailwind: field.attackerTailwind,
    unburdenActive: attackerSet.unburdenActive,
    slowStartActive: attackerSet.slowStartActive,
  }).value;
  defender.speed = finalSpeed(defender, field, {
    tailwind: field.defenderTailwind,
    unburdenActive: defenderSet.unburdenActive,
    slowStartActive: defenderSet.slowStartActive,
  }).value;
  const attackerFaster = turnOrder(attacker.speed, defender.speed, field);

  // Forecast retypes Castform to match the weather.
  for (const side of [attacker, defender]) {
    if (side.ability === 'forecast' && side.name === 'Castform') {
      side.types = {sun: ['Fire'], harshsunshine: ['Fire'], rain: ['Water'], heavyrain: ['Water'],
                    snow: ['Ice'], hail: ['Ice']}[field.weather] ?? ['Normal'];
    }
  }

  const moveId = toID(moveInput.id ?? moveInput.name ?? moveInput);
  const baseMove = data.moves[moveId];
  if (!baseMove) throw new Error(`Unknown move: ${moveId}`);

  const abilityIgnored = ignoresAbility(attacker, {id: moveId});
  const move = {
    ...baseMove,
    id: moveId,
    type: moveType({...baseMove, id: moveId}, attacker, field),
  };

  // These moves attack with whichever of the user's offensive stats is higher,
  // and take their category from that choice.
  const picksBetterStat = ['photongeyser', 'lightthatburnsthesky'].includes(moveId) ||
    (moveId === 'terablast' && attacker.teraType) ||
    (moveId === 'terastarstorm' && attacker.teraType && attacker.name === 'Terapagos-Stellar');
  if (picksBetterStat) {
    move.cat = attacker.stats.atk > attacker.stats.spa ? 'Physical' : 'Special';
  }

  const opts = moveInput.options ?? {};
  // Shell Armor and Battle Armor make the target immune to critical hits, so a
  // crit box ticked against them simply does not happen.
  const critBlocked = !abilityIgnored &&
    ['shellarmor', 'battlearmor'].includes(toID(defenderSet.ability ?? data.species[defenderSet.species]?.abilities[0]));
  // Merciless always crits a poisoned target.
  const merciless = attacker.ability === 'merciless' && ['psn', 'tox'].includes(defender.status);
  const isCritical = !!(opts.crit || move.willCrit || merciless) && !critBlocked;
  const defenderTypes = effectiveTypes(defender);

  // Shared context every stage of the pipeline reads.
  const state = {
    abilityIgnored,
    abilityName: (id) => data.abilities[toID(id)]?.name ?? id ?? '',
    itemName: (id) => data.items[toID(id)]?.name ?? id ?? '',
    defenderTypes,
    defenderNFE: defender.nfe,
    hasSecondaryEffect: opts.hasSecondaryEffect ?? !!baseMove.secondary,
    ateBoosted: ateBoosted(baseMove, attacker),
    doublingItem: isDoublingItem(attacker, move),
    slowStartActive: opts.slowStartActive ?? true,
    flashFireActive: opts.flashFireActive ?? false,
    stakeoutActive: opts.stakeoutActive ?? false,
    allyFlowerGift: opts.allyFlowerGift ?? false,
    allySteelySpirit: opts.allySteelySpirit ?? false,
    defenderFlowerGift: opts.defenderFlowerGift ?? false,
    tabletsOfRuin: opts.tabletsOfRuin ?? false,
    vesselOfRuin: opts.vesselOfRuin ?? false,
    swordOfRuin: opts.swordOfRuin ?? false,
    beadsOfRuin: opts.beadsOfRuin ?? false,
    helpingHand: opts.helpingHand ?? false,
    battery: opts.battery ?? false,
    powerSpot: opts.powerSpot ?? false,
    auraActive: opts.auraActive ?? null,
    alliesFainted: opts.alliesFainted ?? 0,
    // Unless told otherwise, assume the faster Pokémon moves first — this is what
    // Payback, Bolt Beak, Avalanche and Analytic all key off.
    // Unless told otherwise, assume the faster Pokémon moves first — this is what
    // Payback, Bolt Beak, Fishious Rend and Analytic all key off. A speed tie is
    // a coin flip in game; treat it as moving second, the cautious reading.
    movesFirst: opts.movesFirst ?? attackerFaster === true,
    movesSecond: opts.movesSecond ?? attackerFaster !== true,
    targetAlreadyDamaged: opts.targetAlreadyDamaged ?? false,
    wasHitThisTurn: opts.wasHitThisTurn ?? false,
    allyUsedRound: opts.allyUsedRound ?? false,
    allyFaintedLastTurn: opts.allyFaintedLastTurn ?? false,
    timesHit: opts.timesHit ?? 0,
    consecutive: opts.consecutive ?? 0,
    signatureItemBoost: opts.signatureItemBoost ?? false,
    stellarFirstUse: opts.stellarFirstUse ?? false,
    hits: opts.hits ?? 1,
    superEffective: false, // filled in below for Collision Course
  };

  // Type effectiveness first: two moves need to know it before power is fixed.
  const {effectiveness, notes: typeNotes} = typeEffectiveness(move, attacker, defender, field, {
    typeChart: data.typeChart,
    abilityIgnored,
    abilityName: state.abilityName,
  });
  state.superEffective = effectiveness > 1;

  const blocked = blockedReason(move, attacker, defender, field);
  if (blocked) typeNotes.push(`${move.name} does nothing: ${blocked}`);

  if (effectiveness === 0 || move.cat === 'Status' || blocked) {
    return {
      damage: [0],
      effectiveness,
      notes: typeNotes,
      move,
      attacker,
      defender,
      field,
      immune: effectiveness === 0 || !!blocked,
      description: describe({attacker, defender, move, damage: [0], effectiveness, field, state, data, percent: [0, 0]}),
    };
  }

  const power = finalBasePower(move, attacker, defender, field, state);
  const attack = calculateAttack(move, attacker, defender, field, state, isCritical);
  const defense = calculateDefense(move, attacker, defender, field, state, isCritical);

  // --- base damage ---------------------------------------------------------
  const level = attacker.level;
  let baseDamage = Math.floor(
    Math.floor((Math.floor((2 * level) / 5 + 2) * power.value * attack.value) / defense.value) / 50 + 2,
  );

  const spread = isSpread(move, field);
  if (spread) baseDamage = pokeRound((baseDamage * 3072) / 4096);

  // Weather is applied to the base, before the random roll.
  const umbrella = defender.item === 'utilityumbrella';
  if (field.weather === 'sun' && move.id === 'hydrosteam' && attacker.item !== 'utilityumbrella') {
    baseDamage = pokeRound((baseDamage * 6144) / 4096);
  } else if (!umbrella) {
    const strongSun = field.weather === 'sun' || field.weather === 'harshsunshine';
    const strongRain = field.weather === 'rain' || field.weather === 'heavyrain';
    if ((strongSun && move.type === 'Fire') || (strongRain && move.type === 'Water')) {
      baseDamage = pokeRound((baseDamage * 6144) / 4096);
    } else if ((field.weather === 'sun' && move.type === 'Water') || (field.weather === 'rain' && move.type === 'Fire')) {
      baseDamage = pokeRound((baseDamage * 2048) / 4096);
    }
  }

  if (isCritical) baseDamage = Math.floor(baseDamage * 1.5);

  // --- per-roll modifiers ---------------------------------------------------
  const stab = stabModifier(move, attacker, state.stellarFirstUse);
  const stabMod = Math.round(stab.mod * 4096);
  const applyBurn = attacker.status === 'brn' && move.cat === 'Physical' &&
    attacker.ability !== 'guts' && move.id !== 'facade';

  const {mods: finalMods, notes: finalNotes} =
    finalModifiers(move, attacker, defender, field, state, isCritical, effectiveness, data);
  const finalMod = chainMods(finalMods);

  const damage = [];
  for (let i = 0; i < 16; i++) {
    let amount = Math.floor((baseDamage * (85 + i)) / 100);
    if (stabMod !== 4096) amount = (amount * stabMod) / 4096;
    amount = Math.floor(pokeRound(amount) * effectiveness);
    if (applyBurn) amount = Math.floor(amount / 2);
    if (opts.protect) amount = pokeRound((amount * 1024) / 4096);
    damage.push(pokeRound(Math.max(1, (amount * finalMod) / 4096)));
  }

  // Multi-hit moves simply repeat; the games recompute per hit but for the
  // fixed states this calculator models the per-hit result is identical.
  const hits = opts.hits ?? defaultHits(move);
  const totals = hits > 1 ? damage.map((d) => d * hits) : damage;

  const percent = [
    (totals[0] / defender.maxHP) * 100,
    (totals[totals.length - 1] / defender.maxHP) * 100,
  ];

  const notes = [
    ...typeNotes,
    ...power.notes,
    ...attack.notes,
    ...defense.notes,
    ...(stab.note ? [stab.note] : []),
    ...(spread ? ['spread move (0.75x in doubles)'] : []),
    ...(applyBurn ? ['burn halves physical damage'] : []),
    ...(isCritical ? [merciless ? 'Merciless guarantees a critical hit' : 'critical hit'] : []),
    ...(critBlocked && (opts.crit || move.willCrit) ? ['critical hit prevented by the target\'s armor'] : []),
    ...finalNotes,
  ];

  const result = {
    damage: totals,
    perHit: damage,
    hits,
    percent,
    effectiveness,
    basePower: power,
    attack,
    defense,
    stab,
    isCritical,
    spread,
    move,
    attacker,
    defender,
    field,
    notes,
    immune: false,
  };
  result.ko = koChance(result);
  result.description = describe({...result, state, data});
  return result;
}

function defaultHits(move) {
  if (!move.multihit) return 1;
  // A range like [2,5] averages 3.2 hits with Skill Link excluded; the caller can
  // override, but the honest default for a range is its low end.
  return Array.isArray(move.multihit) ? move.multihit[0] : move.multihit;
}

function finalModifiers(move, attacker, defender, field, state, isCritical, effectiveness, data) {
  const mods = [];
  const notes = [];
  const add = (m, note) => { mods.push(m); if (note) notes.push(note); };
  const doubles = field.gameType !== 'singles';
  const screenMod = doubles ? 2732 : 2048;

  // Infiltrator attacks straight through screens; Brick Break and its relatives
  // shatter them before the hit lands.
  const screenBreaker = ['brickbreak', 'psychicfangs', 'ragingbull'].includes(move.id);
  const screensApply = attacker.ability !== 'infiltrator' && !screenBreaker;

  // Screens. Aurora Veil covers both categories and does not stack.
  if (!screensApply) {
    if (field.auroraVeil || field.reflect || field.lightScreen) {
      notes.push(screenBreaker ? `${move.name} breaks screens` : 'Infiltrator ignores screens');
    }
  } else if (field.auroraVeil && !isCritical) {
    add(screenMod, 'Aurora Veil');
  } else if (field.reflect && move.cat === 'Physical' && !isCritical) {
    add(screenMod, 'Reflect');
  } else if (field.lightScreen && move.cat === 'Special' && !isCritical) {
    add(screenMod, 'Light Screen');
  }

  if (attacker.ability === 'neuroforce' && effectiveness > 1) add(5120, 'Neuroforce');
  else if (attacker.ability === 'sniper' && isCritical) add(6144, 'Sniper');
  else if (attacker.ability === 'tintedlens' && effectiveness < 1) add(8192, 'Tinted Lens');

  if (!state.abilityIgnored) {
    if (['multiscale', 'shadowshield'].includes(defender.ability) && defender.currentHP === defender.maxHP) {
      add(2048, state.abilityName(defender.ability));
    }
    if (defender.ability === 'fluffy' && move.flags?.includes('contact') && attacker.ability !== 'longreach') {
      add(2048, 'Fluffy');
    } else if ((defender.ability === 'punkrock' && move.flags?.includes('sound')) ||
               (defender.ability === 'icescales' && move.cat === 'Special')) {
      add(2048, state.abilityName(defender.ability));
    }
    if (['solidrock', 'filter', 'prismarmor'].includes(defender.ability) && effectiveness > 1) {
      add(3072, state.abilityName(defender.ability));
    }
    if (defender.ability === 'fluffy' && move.type === 'Fire') add(8192, 'Fluffy (Fire)');
  }

  if (field.friendGuard) add(3072, 'Friend Guard');

  if (attacker.item === 'expertbelt' && effectiveness > 1) add(4915, 'Expert Belt');
  else if (attacker.item === 'lifeorb') add(5324, 'Life Orb');

  // Resist berries halve a super effective hit (or any Normal hit, for Chilan).
  const berryType = RESIST_BERRIES[defender.item];
  if (berryType && berryType === move.type && (effectiveness > 1 || move.type === 'Normal') &&
      !['unnerve', 'asonespectrier', 'asoneglastrier'].includes(attacker.ability)) {
    add(defender.ability === 'ripen' ? 1024 : 2048, data.items[defender.item]?.name ?? 'resist berry');
  }

  return {mods, notes};
}

/** Chance the move knocks the target out, over the sixteen equally likely rolls. */
function koChance(result) {
  const {damage, defender} = result;
  const hp = defender.currentHP;
  const kos = damage.filter((d) => d >= hp).length;
  if (kos === 16) return {hits: 1, chance: 1, text: 'guaranteed OHKO'};
  if (kos > 0) return {hits: 1, chance: kos / 16, text: `${((kos / 16) * 100).toFixed(1)}% chance to OHKO`};
  // How many hits at the *worst* roll, and at the best, to see the range.
  const min = damage[0];
  const max = damage[damage.length - 1];
  const worst = min > 0 ? Math.ceil(hp / min) : Infinity;
  const best = max > 0 ? Math.ceil(hp / max) : Infinity;
  const text = worst === best ? `guaranteed ${worst}HKO` : `${best}-${worst}HKO`;
  return {hits: worst, chance: 0, text};
}

/** A one-line summary in the shape competitive players already read. */
function describe(result) {
  const {attacker, defender, move, damage, effectiveness, field, data} = result;
  const parts = [];
  const evs = [];
  const stat = move.cat === 'Special' ? 'spa' : 'atk';
  if (attacker.boosts[stat]) evs.push(`${attacker.boosts[stat] > 0 ? '+' : ''}${attacker.boosts[stat]}`);
  parts.push([...evs, attacker.display ?? attacker.name].join(' '));
  if (attacker.item) parts.push(data?.items?.[attacker.item]?.name ?? attacker.item);
  if (attacker.teraType) parts.push(`Tera ${attacker.teraType}`);

  const head = `${parts.join(' ')} ${move.name} vs. ${defender.teraType ? `Tera ${defender.teraType} ` : ''}${defender.display ?? defender.name}`;
  const tail = damage[0] === 0
    ? ': 0 damage — immune'
    : `: ${damage[0]}-${damage[damage.length - 1]} (${result.percent[0].toFixed(1)} - ${result.percent[1].toFixed(1)}%)`;
  const eff = effectiveness > 1 ? ` [${effectiveness}x]` : effectiveness < 1 && effectiveness > 0 ? ` [${effectiveness}x]` : '';
  const koText = result.ko ? ` -- ${result.ko.text}` : '';
  const fieldBits = [
    field.weather, field.terrain && `${field.terrain} terrain`,
    field.reflect && 'Reflect', field.lightScreen && 'Light Screen', field.auroraVeil && 'Aurora Veil',
  ].filter(Boolean);
  const fieldText = fieldBits.length ? ` in ${fieldBits.join(', ')}` : '';
  return head + fieldText + tail + eff + koText;
}
