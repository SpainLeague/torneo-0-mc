import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {findBestLocalSpreads} from '../optimizador-heuristic.js';
import {evaluateExhaustivePcSpreads} from '../optimizador-exhaustive.js';
import {aggregateObjectiveScores} from '../optimizador-evaluator.js';

// Reduced, exact-reference landscapes isolate search quality from the
// Champions damage engine. Each case conserves the same 16 PC across Atk/SpA.
const scenarios = [
  {
    name: 'two simultaneous gradual objectives',
    evaluate: points => aggregateObjectiveScores([
      {score: Math.min(1, points[0] / 6)},
      {score: Math.min(1, points[1] / 10)}
    ], {mode: 'mean'})
  },
  {
    name: 'two simultaneous threshold objectives',
    evaluate: points => aggregateObjectiveScores([
      {score: points[0] >= 5 ? 1 : 0},
      {score: points[1] >= 11 ? 1 : 0}
    ], {mode: 'mean'})
  },
  {
    name: 'one exact breakpoint with otherwise unused PC',
    evaluate: points => points[1] === 10 ? 1 : 0.25 + points[1] / 100
  }
];

for (const scenario of scenarios) {
  test(`heuristic quality benchmark: ${scenario.name}`, async () => {
    const start = [16, 0, 0, 0, 0, 0];
    const exactStart = performance.now();
    const exact = evaluateExhaustivePcSpreads({
      start,
      variableStats: [0, 1],
      maxCandidates: 100,
      top: 1,
      evaluate: points => ({score: scenario.evaluate(points)})
    });
    const exactMs = performance.now() - exactStart;

    const heuristicStart = performance.now();
    const heuristic = await findBestLocalSpreads({
      starts: [start],
      activeStats: [0, 1],
      top: 1,
      maxIterations: 16,
      transferSteps: [1],
      beamWidth: 32,
      diversityDistance: 0,
      yieldControl: async () => {},
      evaluate: points => ({score: scenario.evaluate(points)})
    });
    const heuristicMs = performance.now() - heuristicStart;

    assert.equal(exact.truncated, false, 'Reference enumeration must be complete');
    assert.equal(heuristic.cancelled, false);
    assert.equal(heuristic.results[0].score, exact.results[0].score,
      'Heuristic must match the exhaustive optimum in this bounded landscape');
    assert.equal(heuristic.results[0].points[0] + heuristic.results[0].points[1], 16,
      'The search must preserve the configured PC budget');

    console.log(JSON.stringify({
      scenario: scenario.name,
      exactCandidates: exact.evaluated,
      heuristicCandidates: heuristic.evaluated,
      exactMs: Number(exactMs.toFixed(3)),
      heuristicMs: Number(heuristicMs.toFixed(3)),
      score: heuristic.results[0].score,
      spread: heuristic.results[0].points.slice(0, 2)
    }));
  });
}
