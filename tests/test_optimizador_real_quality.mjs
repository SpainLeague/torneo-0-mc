import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import * as smogonCalc from '@smogon/calc';
import {findBestLocalSpreads} from '../optimizador-heuristic.js';
import {evaluateExhaustivePcSpreads} from '../optimizador-exhaustive.js';
import {calculateSmogonDamage} from '../optimizador-smogon.js';
import {getStatPointBreakpoints} from '../optimizador-data.js';
import {evaluateDamageObjective, aggregateObjectiveScores} from '../optimizador-evaluator.js';

globalThis.calc = smogonCalc;
const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const data = {
  pool: read('../pool-data.json'),
  moveData: read('../move-data.json'),
  reference: read('../vendor/champions-reference/champions-data.json'),
  evSpreads: read('../ev-spreads.json')
};

function evaluate(points) {
  const offensiveDamage = calculateSmogonDamage(data, {
    attacker: 'Mega Aggron', defender: 'Mega Meganium', moveName: 'Iron Head',
    attackerPoints: points, attackerNatureId: 'adamant',
    attackerItemId: 'aggronite',
    field: {gameType: 'Doubles'}
  });
  const defensiveDamage = calculateSmogonDamage(data, {
    attacker: 'Inteleon', defender: 'Mega Aggron', moveName: 'Hydro Pump',
    defenderPoints: points, defenderNatureId: 'adamant',
    defenderItemId: 'aggronite',
    field: {gameType: 'Doubles'}
  });
  const offense = evaluateDamageObjective({
    damage: offensiveDamage, attackCount: 1, hpPercent: 100,
    offensive: true, minimum: 0.5
  });
  const defense = evaluateDamageObjective({
    damage: defensiveDamage, attackCount: 2, hpPercent: 100,
    offensive: false, minimum: 0.5
  });
  return {
    score: aggregateObjectiveScores([offense, defense], {mode: 'balanced', balance: 0.3}),
    details: {offense, defense}
  };
}

test('real Champions optimizer quality: Mega Aggron offense plus special bulk', async () => {
  // 24 PC across HP, Attack and Special Defense: 325 legal allocations.
  // Every candidate is evaluated by the pinned Smogon Champions damage engine.
  const start = [8, 8, 0, 0, 8, 0];
  const options = {
    start,
    variableStats: [0, 1, 4],
    maxCandidates: 1000,
    top: 3,
    evaluate
  };

  const exactStart = performance.now();
  const exact = evaluateExhaustivePcSpreads(options);
  const exactMs = performance.now() - exactStart;

  const heuristicStart = performance.now();
  const heuristic = await findBestLocalSpreads({
    starts: [start],
    activeStats: [0, 1, 4],
    top: 3,
    maxIterations: 8,
    transferSteps: [8, 8, 8, 8, 4, 4, 2, 1],
    statBreakpoints: Array.from({length: 6}, (_, index) => [0, 1, 4].includes(index)
      ? getStatPointBreakpoints(data, 'Mega Aggron', 'adamant', index) : []),
    diversityDistance: 0,
    yieldControl: async () => {},
    evaluate
  });
  const heuristicMs = performance.now() - heuristicStart;

  assert.equal(exact.truncated, false, 'Exhaustive reference must cover the full reduced space');
  assert.equal(exact.evaluated, 325);
  assert.equal(heuristic.cancelled, false);
  assert.ok(heuristic.results.length > 0);
  assert.equal(heuristic.results.every(result =>
    result.points.reduce((sum, value) => sum + value, 0) === 24 &&
    result.points.every(value => Number.isInteger(value) && value >= 0 && value <= 32)
  ), true, 'Heuristic results must remain legal and conserve the PC budget');
  assert.ok(heuristic.results[0].score <= exact.results[0].score + 1e-12,
    'Heuristic score cannot exceed the exhaustive optimum');

  const gap = exact.results[0].score - heuristic.results[0].score;
  console.log(JSON.stringify({
    scenario: 'Mega Aggron Iron Head vs Mega Meganium + Hydro Pump bulk vs Inteleon',
    exactCandidates: exact.evaluated,
    heuristicCandidates: heuristic.evaluated,
    exactMs: Number(exactMs.toFixed(2)),
    heuristicMs: Number(heuristicMs.toFixed(2)),
    exactScore: Number(exact.results[0].score.toFixed(6)),
    heuristicScore: Number(heuristic.results[0].score.toFixed(6)),
    scoreGap: Number(gap.toFixed(6)),
    exactSpreads: exact.results.map(result => result.points),
    heuristicSpreads: heuristic.results.map(result => result.points)
  }));
});


test('real Champions optimizer quality: Body Press plus physical bulk', async () => {
  // Body Press uses Defense offensively; Close Combat tests HP + Defense.
  // The search also has Attack available as a competing stat for Iron Head,
  // making this a useful check that it does not blindly chase every breakpoint.
  const start = [8, 8, 8, 0, 0, 0];
  const evaluatePhysical = points => {
    const bodyPressDamage = calculateSmogonDamage(data, {
      attacker: 'Mega Aggron', defender: 'Inteleon', moveName: 'Body Press',
      attackerPoints: points, attackerNatureId: 'impish',
      attackerItemId: 'aggronite', field: {gameType: 'Doubles'}
    });
    const physicalBulkDamage = calculateSmogonDamage(data, {
      attacker: 'Mega Heracross', defender: 'Mega Aggron', moveName: 'Close Combat',
      attackerItemId: 'heracronite', defenderPoints: points, defenderNatureId: 'impish',
      defenderItemId: 'aggronite', field: {gameType: 'Doubles'}
    });
    const bodyPress = evaluateDamageObjective({
      damage: bodyPressDamage, attackCount: 1, hpPercent: 100,
      offensive: true, minimum: 0.5
    });
    const bulk = evaluateDamageObjective({
      damage: physicalBulkDamage, attackCount: 2, hpPercent: 100,
      offensive: false, minimum: 0.5
    });
    return {
      score: aggregateObjectiveScores([bodyPress, bulk], {mode: 'balanced', balance: 0.3}),
      details: {bodyPress, bulk}
    };
  };
  const options = {
    start, variableStats: [0, 1, 2], maxCandidates: 1000, top: 3,
    evaluate: evaluatePhysical
  };
  const exactStart = performance.now();
  const exact = evaluateExhaustivePcSpreads(options);
  const exactMs = performance.now() - exactStart;
  const heuristicStart = performance.now();
  const heuristic = await findBestLocalSpreads({
    starts: [start], activeStats: [0, 1, 2], top: 3,
    maxIterations: 8, transferSteps: [8, 8, 8, 8, 4, 4, 2, 1],
    statBreakpoints: Array.from({length: 6}, (_, index) => [0, 1, 2].includes(index)
      ? getStatPointBreakpoints(data, 'Mega Aggron', 'impish', index) : []),
    diversityDistance: 0,
    yieldControl: async () => {}, evaluate: evaluatePhysical
  });
  const heuristicMs = performance.now() - heuristicStart;

  assert.equal(exact.truncated, false);
  assert.equal(exact.evaluated, 325);
  assert.ok(heuristic.results.length > 0);
  assert.equal(heuristic.results.every(result =>
    result.points.reduce((sum, value) => sum + value, 0) === 24 &&
    result.points.every(value => Number.isInteger(value) && value >= 0 && value <= 32)
  ), true);
  const gap = exact.results[0].score - heuristic.results[0].score;
  assert.ok(gap >= -1e-12);
  console.log(JSON.stringify({
    scenario: 'Mega Aggron Body Press vs Inteleon + Close Combat bulk vs Mega Heracross',
    exactCandidates: exact.evaluated, heuristicCandidates: heuristic.evaluated,
    exactMs: Number(exactMs.toFixed(2)), heuristicMs: Number(heuristicMs.toFixed(2)),
    exactScore: Number(exact.results[0].score.toFixed(6)),
    heuristicScore: Number(heuristic.results[0].score.toFixed(6)),
    scoreGap: Number(gap.toFixed(6)),
    exactSpreads: exact.results.map(result => result.points),
    heuristicSpreads: heuristic.results.map(result => result.points)
  }));
});
