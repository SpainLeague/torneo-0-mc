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

  const damageOutcomes = damageDistribution(rolls);
  const distribution = [
    ...damageOutcomes.map(outcome => ({damage: outcome.damage, probability: outcome.probability * accuracy})),
    ...(accuracy < 1 ? [{damage: 0, probability: 1 - accuracy}] : [])
  ];
  if (itemEffects == null || typeof itemEffects !== 'object') throw new Error('Los efectos del objeto deben ser un objeto.');
  const leftovers = itemEffects.leftovers ? Math.max(1, Math.floor(maxHP / 16)) : 0;
  const sitrusHeal = itemEffects.sitrusBerry ? Math.floor(maxHP / 4) : 0;
  const triggerSitrus = (hp, available) => {
    if (available && sitrusHeal > 0 && hp > 0 && hp <= maxHP / 2) {
      return {hp: Math.min(maxHP, hp + sitrusHeal), available: false};
    }
    return {hp, available};
  };

  // Track HP and whether the one-use Sitrus Berry remains available.
  // Residual damage is applied between attacks; then berries, manual/ability
  // recovery and Leftovers are processed. No end-of-turn recovery follows a KO.
  const initialBerry = triggerSitrus(currentHP, Boolean(itemEffects.sitrusBerry));
  let states = new Map([[initialBerry.hp + ':' + initialBerry.available, {
    hp: initialBerry.hp, berryAvailable: initialBerry.available, probability: 1
  }]]);
  let koProbability = 0;
  for (let attack = 0; attack < attackCount; attack++) {
    const next = new Map();
    for (const state of states.values()) {
      for (const outcome of distribution) {
        let remaining = state.hp - outcome.damage;
        let berryAvailable = state.berryAvailable;
        const outcomeChance = state.probability * outcome.probability;
        if (remaining <= 0) {
          koProbability += outcomeChance;
          continue;
        }
        let berry = triggerSitrus(remaining, berryAvailable);
        remaining = berry.hp;
        berryAvailable = berry.available;
        if (attack < attackCount - 1) {
          remaining -= residualBetweenAttacks;
          if (remaining <= 0) {
            koProbability += outcomeChance;
            continue;
          }
          berry = triggerSitrus(remaining, berryAvailable);
          remaining = berry.hp;
          berryAvailable = berry.available;
          remaining = Math.min(maxHP, remaining + recoveryBetweenAttacks + leftovers);
        }
        const key = remaining + ':' + berryAvailable;
        const previous = next.get(key);
        if (previous) previous.probability += outcomeChance;
        else next.set(key, {hp: remaining, berryAvailable, probability: outcomeChance});
      }
    }
    states = next;
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
