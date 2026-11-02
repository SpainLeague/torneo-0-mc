import test from 'node:test';
import assert from 'node:assert/strict';
import {enumerateLegalPcSpreads, evaluateExhaustivePcSpreads} from '../optimizador-exhaustive.js';
import {findBestLocalSpreads} from '../optimizador-heuristic.js';

test('enumerates every legal allocation across selected stats and preserves other stats', () => {
  const result = enumerateLegalPcSpreads({
    start:[20,10,8,0,0,0],
    variableStats:[0,1],
    maxCandidates:100
  });
  assert.equal(result.truncated,false);
  assert.equal(result.evaluated,31);
  assert.ok(result.results.every(points =>
    points[0]+points[1]===30 && points[2]===8 &&
    points.slice(3).every(value=>value===0) &&
    points.every(value=>value>=0&&value<=32)
  ));
});

test('reports a capped enumeration instead of silently claiming completeness', () => {
  const result = enumerateLegalPcSpreads({
    start:[20,10,8,0,0,0],
    variableStats:[0,1],
    maxCandidates:5
  });
  assert.equal(result.evaluated,5);
  assert.equal(result.truncated,true);
});

test('can be cancelled cooperatively', () => {
  const result = enumerateLegalPcSpreads({
    start:[20,10,8,0,0,0],
    variableStats:[0,1],
    shouldCancel:()=>true
  });
  assert.equal(result.cancelled,true);
  assert.equal(result.evaluated,0);
});

test('ranks a complete small search and returns the exact best candidate', () => {
  const result = evaluateExhaustivePcSpreads({
    start:[9,9,0,0,0,0],
    variableStats:[0,1],
    top:2,
    maxCandidates:100,
    evaluate:points=>({score:points[1]===10?1:points[1]/32})
  });
  assert.equal(result.truncated,false);
  assert.deepEqual(result.results[0].points,[8,10,0,0,0,0]);
  assert.equal(result.results[0].score,1);
});


test('compares the heuristic result against the exact optimum in a reduced scenario', async () => {
  const start = [9,9,0,0,0,0];
  const evaluate = points => ({score:points[1]===10?1:points[1]/32});
  const exact = evaluateExhaustivePcSpreads({
    start, variableStats:[0,1], maxCandidates:100, evaluate
  });
  const heuristic = await findBestLocalSpreads({
    starts:[start], activeStats:[1],
    statBreakpoints:[[],[{points:10,value:187}],[],[],[],[]],
    maxIterations:1, transferSteps:[8], beamWidth:8, top:1,
    yieldControl:async()=>{}, evaluate
  });
  assert.equal(exact.truncated,false);
  assert.ok(heuristic.results[0].score <= exact.results[0].score);
  assert.equal(heuristic.results[0].score,exact.results[0].score);
});
