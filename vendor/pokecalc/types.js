// Type effectiveness, including the Terastal override and the abilities, items
// and field effects that rewrite the chart.

// Codes used by the shipped type chart, matching Showdown's `damageTaken`.
const NORMAL = 0, WEAK = 1, RESIST = 2, IMMUNE = 3;
const FACTOR = {[NORMAL]: 1, [WEAK]: 2, [RESIST]: 0.5, [IMMUNE]: 0};

/** Effectiveness of one attacking type against one defending type. */
export function typeFactor(typeChart, attackType, defenseType) {
  const row = typeChart[defenseType];
  if (!row) return 1;
  return FACTOR[row[attackType] ?? NORMAL];
}

/**
 * The Pokémon's types in battle.
 *
 * Terastallizing replaces the type line entirely — a Tera Water Rillaboom is
 * mono-Water for the purpose of taking hits, losing its Grass weaknesses. Tera
 * Stellar is the exception: it changes what the Pokémon's own moves do, not what
 * it is, so a Stellar Klefki still takes double from Fire.
 */
export function effectiveTypes(pokemon) {
  if (pokemon.teraType && pokemon.teraType !== 'Stellar') return [pokemon.teraType];
  return pokemon.types;
}

/**
 * Full type effectiveness of a move against a defender.
 *
 * Returns the multiplier plus the reasons anything unusual happened, so the UI
 * can explain a 0x or a surprising 4x rather than just printing a number.
 */
export function typeEffectiveness(move, attacker, defender, field, ctx) {
  const {typeChart} = ctx;
  const notes = [];
  const moveType = move.type;
  let defTypes = effectiveTypes(defender);

  // Abilities that grant an outright immunity to a whole type.
  const absorbing = {
    levitate: 'Ground',
    voltabsorb: 'Electric',
    motordrive: 'Electric',
    lightningrod: 'Electric',
    flashfire: 'Fire',
    wellbakedbody: 'Fire',
    waterabsorb: 'Water',
    stormdrain: 'Water',
    dryskin: 'Water',
    sapsipper: 'Grass',
    eartheater: 'Ground',
    windrider: 'Flying',
  };
  const absorbed = absorbing[defender.ability];
  if (absorbed && absorbed === moveType && !ctx.abilityIgnored) {
    // Levitate is the one that grounding effects can switch off.
    const grounded = defender.item === 'ironball' || field.gravity || defender.groundedBySmackDown;
    if (!(defender.ability === 'levitate' && grounded)) {
      // Wind Rider only absorbs wind moves, not every Flying attack.
      if (defender.ability !== 'windrider' || move.flags?.includes('wind')) {
        notes.push(`${ctx.abilityName(defender.ability)} absorbs ${moveType}`);
        return {effectiveness: 0, notes};
      }
    }
  }

  let effectiveness = 1;
  for (const defType of defTypes) {
    let factor = typeFactor(typeChart, moveType, defType);

    // Ghost's immunity to Normal and Fighting is pierced by Scrappy/Mind's Eye.
    if (factor === 0 && defType === 'Ghost' && ['Normal', 'Fighting'].includes(moveType)
        && (attacker.ability === 'scrappy' || attacker.ability === 'mindseye' || defender.foresight)) {
      factor = 1;
      notes.push('Ghost immunity pierced');
    }
    // Flying's Ground immunity is pierced by Gravity, Iron Ball and Thousand Arrows.
    if (factor === 0 && defType === 'Flying' && moveType === 'Ground'
        && (field.gravity || defender.item === 'ironball' || move.id === 'thousandarrows')) {
      factor = 1;
      notes.push('Flying grounded');
    }
    // Ring Target removes the holder's type-based immunities.
    if (factor === 0 && defender.item === 'ringtarget') {
      factor = 1;
      notes.push('Ring Target removes immunity');
    }
    // Delta Stream caps Flying's weaknesses at neutral.
    if (factor === 2 && defType === 'Flying' && field.weather === 'strongwinds') {
      factor = 1;
      notes.push('Delta Stream weakens the hit');
    }
    effectiveness *= factor;
  }

  // Freeze-Dry is super effective on Water regardless of the chart.
  if (move.id === 'freezedry' && defTypes.includes('Water')) {
    effectiveness = effectiveness * 2 / typeFactor(typeChart, 'Ice', 'Water');
    notes.push('Freeze-Dry hits Water super effectively');
  }
  // Flying Press counts as Fighting + Flying.
  if (move.id === 'flyingpress') {
    let flying = 1;
    for (const defType of defTypes) flying *= typeFactor(typeChart, 'Flying', defType);
    effectiveness *= flying;
  }
  // Tar Shot doubles the target's Fire weakness.
  if (defender.tarShot && moveType === 'Fire') {
    effectiveness *= 2;
    notes.push('Tar Shot');
  }

  if (effectiveness > 0) {
    // Abilities that ignore immunities the defender would otherwise have are
    // handled above; these two invert or ignore resistances instead.
    if (defender.ability === 'wonderguard' && effectiveness <= 1 && !ctx.abilityIgnored) {
      notes.push('Wonder Guard blocks non-super-effective hits');
      return {effectiveness: 0, notes};
    }
  }

  return {effectiveness, notes};
}

/**
 * Same-type attack bonus.
 *
 * Built additively in 16.12 fixed point, which is how the games do it and why
 * the Adaptability + Terastal cases land on 2.25x rather than anything simpler.
 * `types` is the original type line; Terastallizing replaces the *current* types
 * but STAB still remembers what the Pokémon started as.
 */
export function stabModifier(move, attacker, stellarFirstUse = false) {
  const currentTypes = effectiveTypes(attacker);
  const hasOriginal = attacker.types.includes(move.type);
  const tera = attacker.teraType;
  const notes = [];

  let stab = 4096;
  if (hasOriginal) {
    stab += 2048;
    notes.push('STAB');
  } else if (['protean', 'libero'].includes(attacker.ability) && !tera) {
    stab += 2048;
    notes.push('Protean STAB');
  }
  if (tera && tera === move.type && tera !== 'Stellar') {
    stab += 2048;
    notes.push(`Tera ${tera} STAB`);
  }
  if (attacker.ability === 'adaptability' && currentTypes.includes(move.type)) {
    // Adaptability gives less on top of a Tera that matched an original type.
    stab += tera && attacker.types.includes(tera) ? 1024 : 2048;
    notes.push('Adaptability');
  }

  // Stellar boosts each type once: 2x on a type the Pokémon already had, 1.2x
  // on anything else. It replaces rather than stacks with the ordinary bonus.
  if (tera === 'Stellar' && (stellarFirstUse || attacker.name === 'Terapagos-Stellar')) {
    if (attacker.types.includes(move.type)) {
      stab += 2048;
      notes.push('Stellar STAB');
    } else {
      stab = 4915;
      notes.push('Stellar boost');
    }
  }

  return {mod: stab / 4096, raw: stab, note: notes.join(' + ') || null};
}
