import test from 'node:test';
import assert from 'node:assert/strict';
import {findBestLocalSpreads, isLegalPcSpread} from '../optimizador-heuristic.js';

test('validates the Champions PC limits', () => {
  assert.equal(isLegalPcSpread([32, 0, 32, 0, 2, 0]), true);
  assert.equal(isLegalPcSpread([33, 0, 31, 0, 2, 0]), false);
  assert.equal(isLegalPcSpread([32, 0, 32, 0, 3, 0]), false);
  assert.equal(isLegalPcSpread([32, 0, 32, 0, 2], {}), false);
  assert.equal(isLegalPcSpread([32, 0, 32, 0, 2, 0], {exactTotal: true}), true);
  assert.equal(isLegalPcSpread([10, 0, 10, 0, 0, 0], {exactTotal: true}), false);
});

test('local search improves a seed and returns unique top results', async () => {
  const result = await findBestLocalSpreads({
    starts: [[32, 0, 32, 0, 2, 0], [32, 0, 32, 0, 2, 0]],
    top: 3,
    maxIterations: 4,
    yieldControl: async () => {},
    evaluate: points => ({score: points[5] / 32, details: {speedPc: points[5]}})
  });
  assert.equal(result.cancelled, false);
  assert.ok(result.evaluated > 1);
  assert.equal(result.results.length, 3);
  assert.equal(result.results[0].points[5], 32);
  assert.equal(new Set(result.results.map(x => x.points.join(','))).size, result.results.length);
});

test('rejects invalid evaluator scores', async () => {
  await assert.rejects(() => findBestLocalSpreads({
    starts: [[32, 0, 32, 0, 2, 0]],
    yieldControl: async () => {},
    evaluate: () => ({score: 1.5})
  }), /entre 0 y 1/);
});

test('supports cooperative cancellation', async () => {
  const result = await findBestLocalSpreads({
    starts: [[32, 0, 32, 0, 2, 0]],
    shouldCancel: () => true,
    yieldControl: async () => {},
    evaluate: () => ({score: 0.5})
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.evaluated, 0);
});
