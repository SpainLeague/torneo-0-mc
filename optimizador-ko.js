// Exact probability utilities for repeated damage rolls.
// This does not simulate battle turns: it convolves independent roll outcomes.
export function damageDistribution(rolls) {
  if (!Array.isArray(rolls) || rolls.length === 0) {
    throw new Error('Se necesita una distribución de daño válida.');
  }
  // Smogon returns 16 rolls for a single hit and one 16-roll array per hit
  // for fixed-count multihit moves. Convolve the latter to obtain exact sums.
  const hitRolls = Array.isArray(rolls[0]) ? rolls : [rolls];
  if (hitRolls.some(hit => !Array.isArray(hit) || hit.length !== 16 ||
    hit.some(value => !Number.isFinite(value) || value < 0))) {
    throw new Error('Cada golpe debe contener exactamente 16 rolls de daño válidos.');
  }
  let distribution = [{damage: 0, probability: 1}];
  for (const hit of hitRolls) {
    const counts = new Map();
    for (const damage of hit) counts.set(damage, (counts.get(damage) ?? 0) + 1);
    const outcomes = [...counts.entries()].map(([damage, count]) => ({
      damage, probability: count / 16
    }));
    const combined = new Map();
    for (const current of distribution) {
      for (const outcome of outcomes) {
        const total = current.damage + outcome.damage;
        combined.set(total, (combined.get(total) ?? 0) + current.probability * outcome.probability);
      }
    }
    distribution = [...combined.entries()].map(([damage, probability]) => ({damage, probability}));
  }
  return distribution;
}

export function repeatedKoProbability(
  rolls,
  currentHP,
  attackCount,
  residualBetweenAttacks = 0,
  accuracy = 1,
  recoveryBetweenAttacks = 0,
  maxHP = currentHP,
  itemEffects = {}
) {
  if (!Number.isFinite(currentHP) || currentHP <= 0) throw new Error('Los PS actuales deben ser positivos.');
  if (!Number.isInteger(attackCount) || attackCount < 1 || attackCount > 3) throw new Error('El número de ataques debe ser 1, 2 o 3.');
  if (!Number.isFinite(residualBetweenAttacks) || residualBetweenAttacks < 0) throw new Error('El daño residual debe ser un número no negativo.');
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 1) throw new Error('La precisión debe estar entre 0 y 1.');
  if (!Number.isFinite(recoveryBetweenAttacks) || recoveryBetweenAttacks < 0) throw new Error('La recuperación debe ser un número no negativo.');
  if (!Number.isFinite(maxHP) || maxHP < currentHP) throw new Error('Los PS máximos deben ser iguales o superiores a los PS actuales.');

  // Preserve individual hits for fixed-count multihit moves: Sitrus Berry can
  // activate between hits, while accuracy is rolled once for the whole move.
  const hitRolls = Array.isArray(rolls[0]) ? rolls : [rolls];
  const perHitDistributions = hitRolls.map(hit => damageDistribution(hit));
  if (itemEffects == null || typeof itemEffects !== 'object') throw new Error('Los efectos del objeto deben ser un objeto.');
  const leftovers = itemEffects.leftovers ? Math.max(1, Math.floor(maxHP / 16)) : 0;
  const sitrusHeal = itemEffects.sitrusBerry ? Math.max(1, Math.floor(maxHP / 4)) : 0;
  const triggerSitrus = (hp, available) => {
    if (available && sitrusHeal > 0 && hp > 0 && hp <= maxHP / 2) {
      return {hp: Math.min(maxHP, hp + sitrusHeal), available: false};
    }
    return {hp, available};
  };
  const addState = (map, hp, berryAvailable, probability) => {
    const key = hp + ':' + berryAvailable;
    const previous = map.get(key);
    if (previous) previous.probability += probability;
    else map.set(key, {hp, berryAvailable, probability});
  };

  // Track HP and the one-use berry. At each end-of-turn interval, residual
  // damage is applied before recovery and Leftovers. A KO prevents recovery.
  const initialBerry = triggerSitrus(currentHP, Boolean(itemEffects.sitrusBerry));
  let states = new Map();
  addState(states, initialBerry.hp, initialBerry.available, 1);
  let koProbability = 0;
  for (let attack = 0; attack < attackCount; attack++) {
    const postMove = new Map();
    for (const state of states.values()) {
      // A miss still consumes the move's accuracy check, but not any damage roll.
      if (accuracy < 1) {
        addState(postMove, state.hp, state.berryAvailable, state.probability * (1 - accuracy));
      }
      let hitStates = new Map();
      if (accuracy > 0) addState(hitStates, state.hp, state.berryAvailable, state.probability * accuracy);
      for (const hitDistribution of perHitDistributions) {
        const afterHit = new Map();
        for (const hitState of hitStates.values()) {
          for (const outcome of hitDistribution) {
            const outcomeChance = hitState.probability * outcome.probability;
            const remaining = hitState.hp - outcome.damage;
            if (remaining <= 0) {
              koProbability += outcomeChance;
              continue;
            }
            const berry = triggerSitrus(remaining, hitState.berryAvailable);
            addState(afterHit, berry.hp, berry.available, outcomeChance);
          }
        }
        hitStates = afterHit;
      }
      for (const survivor of hitStates.values()) {
        addState(postMove, survivor.hp, survivor.berryAvailable, survivor.probability);
      }
    }

    if (attack < attackCount - 1) {
      const next = new Map();
      for (const state of postMove.values()) {
        let remaining = state.hp - residualBetweenAttacks;
        if (remaining <= 0) {
          koProbability += state.probability;
          continue;
        }
        const berry = triggerSitrus(remaining, state.berryAvailable);
        remaining = Math.min(maxHP, berry.hp + recoveryBetweenAttacks + leftovers);
        addState(next, remaining, berry.available, state.probability);
      }
      states = next;
    } else {
      states = postMove;
    }
  }
  return Math.max(0, Math.min(1, koProbability));
}

export function koThresholds(rolls, currentHP, residualBetweenAttacks = 0, accuracy = 1, recoveryBetweenAttacks = 0, maxHP = currentHP, itemEffects = {}) {
  const probabilities = [1,2,3].map(attacks => ({
    attacks,
    probability: repeatedKoProbability(rolls, currentHP, attacks, residualBetweenAttacks, accuracy, recoveryBetweenAttacks, maxHP, itemEffects)
  }));
  return {
    ohko: probabilities[0].probability,
    twoHko: probabilities[1].probability,
    threeHko: probabilities[2].probability,
    probabilities
  };
}
