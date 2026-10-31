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

export function repeatedKoProbability(rolls, currentHP, attackCount, residualBetweenAttacks = 0) {
  if (!Number.isFinite(currentHP) || currentHP <= 0) throw new Error('Los PS actuales deben ser positivos.');
  if (!Number.isInteger(attackCount) || attackCount < 1 || attackCount > 3) throw new Error('El número de ataques debe ser 1, 2 o 3.');
  if (!Number.isFinite(residualBetweenAttacks) || residualBetweenAttacks < 0) throw new Error('El daño residual debe ser un número no negativo.');
  const distribution = damageDistribution(rolls);
  // DP maps accumulated damage to its exact probability. A capped residual is
  // applied between attacks; this models the requested repeated-hit threshold,
  // not choices, switching, or a turn-by-turn battle.
  let states = new Map([[0, 1]]);
  for (let attack = 0; attack < attackCount; attack++) {
    const next = new Map();
    for (const [total, chance] of states) {
      for (const outcome of distribution) {
        const updated = total + outcome.damage + (attack > 0 ? residualBetweenAttacks : 0);
        const key = Math.min(currentHP, updated);
        next.set(key, (next.get(key) ?? 0) + chance * outcome.probability);
      }
    }
    states = next;
  }
  return states.get(currentHP) ?? 0;
}

export function koThresholds(rolls, currentHP, residualBetweenAttacks = 0) {
  const probabilities = [1,2,3].map(attacks => ({
    attacks,
    probability: repeatedKoProbability(rolls, currentHP, attacks, residualBetweenAttacks)
  }));
  return {
    ohko: probabilities[0].probability,
    twoHko: probabilities[1].probability,
    threeHko: probabilities[2].probability,
    probabilities
  };
}
