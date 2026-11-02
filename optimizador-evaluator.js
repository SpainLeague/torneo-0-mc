// Shared scoring for manual scenario checks and the PC optimizer.
// Damage rolls and stats always come from the pinned Pokémon Champions calculator.
import {koThresholds} from './optimizador-ko.js';

export function evaluateDamageObjective({
  damage,
  attackCount = 1,
  hpPercent = 100,
  residual = 0,
  recovery = 0,
  offensive = true,
  minimum = 1
}) {
  if (!damage || !Array.isArray(damage.rolls) ||
      !damage.defenderStats || !Number.isFinite(damage.defenderStats.hp) ||
      damage.defenderStats.hp <= 0) {
    throw new Error('El escenario de daño no contiene rolls y PS máximos válidos.');
  }
  if (!Number.isInteger(attackCount) || attackCount < 1 || attackCount > 3) {
    throw new Error('El número de ataques debe ser 1, 2 o 3.');
  }
  if (!Number.isFinite(hpPercent) || hpPercent <= 0 || hpPercent > 100) {
    throw new Error('Los PS actuales deben estar entre 0 y 100%.');
  }
  if (!Number.isFinite(residual) || residual < 0 ||
      !Number.isFinite(recovery) || recovery < 0) {
    throw new Error('El daño residual y la recuperación deben ser números no negativos.');
  }
  if (typeof offensive !== 'boolean') {
    throw new Error('El objetivo debe indicar si es ofensivo o defensivo.');
  }
  if (!Number.isFinite(minimum) || minimum <= 0 || minimum > 1) {
    throw new Error('La probabilidad mínima debe estar entre 0 y 1.');
  }

  const maxHP = damage.defenderStats.hp;
  const currentHP = Math.max(1, Math.ceil(maxHP * hpPercent / 100));
  const probabilities = koThresholds(
    damage.rolls,
    currentHP,
    residual,
    damage.accuracy,
    recovery,
    maxHP
  );
  const koProbability = probabilities.probabilities[attackCount - 1].probability;
  const success = offensive ? koProbability : 1 - koProbability;

  return {
    currentHP,
    maxHP,
    koProbability,
    success,
    minimum,
    score: Math.min(1, success / minimum),
    passed: success >= minimum,
    range: Array.isArray(damage.range) ? damage.range.slice() : null,
    residual,
    recovery,
    accuracy: damage.accuracy * 100,
    attackCount
  };
}

export function aggregateObjectiveScores(objectives, {
  mode = 'balanced',
  balance = 0.3
} = {}) {
  if (!Array.isArray(objectives) || objectives.length === 0) {
    throw new Error('Se necesita al menos un objetivo para calcular la puntuación.');
  }
  if (!['mean', 'balanced'].includes(mode)) {
    throw new Error('El modo debe ser mean o balanced.');
  }
  if (!Number.isFinite(balance) || balance < 0 || balance > 1) {
    throw new Error('El factor de equilibrio debe estar entre 0 y 1.');
  }
  let total = 0;
  let minimum = 1;
  for (const objective of objectives) {
    if (!objective || !Number.isFinite(objective.score) ||
        objective.score < 0 || objective.score > 1) {
      throw new Error('Cada objetivo debe aportar una puntuación entre 0 y 1.');
    }
    total += objective.score;
    minimum = Math.min(minimum, objective.score);
  }
  const mean = total / objectives.length;
  // Mean preserves equal importance for every objective; the minimum term
  // discourages spreads that neglect one matchup/requirement.
  return mode === 'mean' || objectives.length === 1
    ? mean
    : mean * (1 - balance) + minimum * balance;
}

export function meanObjectiveScore(objectives) {
  return aggregateObjectiveScores(objectives, {mode:'mean'});
}
