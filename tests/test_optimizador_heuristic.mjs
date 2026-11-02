import test from 'node:test';
import assert from 'node:assert/strict';
import {findBestLocalSpreads, isLegalPcSpread} from '../optimizador-heuristic.js';
import {findBestSpreads} from '../optimizador-search.js';

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
    evaluate: points => ({score: Math.min(1, points[5] / 4), details: {speedPc: points[5]}})
  });
  assert.equal(result.cancelled, false);
  assert.ok(result.evaluated > 1);
  assert.equal(result.results.length, 3);
  assert.ok(result.results[0].points[5] >= 4);
  assert.equal(result.results[0].score, 1);
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


test('beam search crosses a neutral-score plateau to reach a two-step optimum', async () => {
  const result = await findBestLocalSpreads({
    starts: [[11, 11, 11, 11, 11, 11]],
    top: 3,
    maxIterations: 2,
    transferSteps: [1,1],
    beamWidth: 32,
    yieldControl: async () => {},
    evaluate: points => ({
      score: points.join(',') === '10,12,10,11,11,12' ? 1 : 0
    })
  });
  assert.equal(result.cancelled, false);
  assert.ok(result.results.some(candidate => candidate.points.join(',') === '10,12,10,11,11,12'));
  assert.equal(result.beamWidth, 32);
});

test('rejects an excessive beam width', async () => {
  await assert.rejects(() => findBestLocalSpreads({
    starts: [[32, 0, 32, 0, 2, 0]],
    beamWidth: 33,
    yieldControl: async () => {},
    evaluate: () => ({score: 0.5})
  }), /beamWidth/);
});


test('moves PC only into stats used by the configured objectives', async () => {
  const start = [32,0,32,0,2,0];
  const result = await findBestLocalSpreads({
    starts:[start],activeStats:[3],top:1,maxIterations:4,beamWidth:8,
    yieldControl:async()=>{},
    evaluate:points=>({score:points[3]/32})
  });
  assert.ok(result.results[0].points[3] > start[3], 'The active Special Attack stat should receive PC');
  for (const index of [1,2,4,5]) {
    assert.equal(result.results[0].points[index],start[index],
      'An irrelevant stat must not receive PC');
  }
  assert.ok(result.results[0].points[0] < start[0], 'Unused HP can be reassigned to the active objective');
});

test('coarse-to-fine transfers can move a large PC allocation and then refine it', async () => {
  const result = await findBestLocalSpreads({
    starts: [[32, 0, 32, 0, 2, 0]],
    activeStats: [5],
    top: 3,
    maxIterations: 8,
    transferSteps: [8, 8, 8, 8, 4, 4, 2, 1],
    beamWidth: 8,
    yieldControl: async () => {},
    evaluate: points => ({
      score: Math.min(1, points[5] / 15),
      details: {speedPc: points[5]}
    })
  });
  assert.equal(result.cancelled, false);
  assert.ok(result.results[0].points[5] >= 15);
  assert.equal(result.results[0].score, 1);
});

test('rejects invalid transfer step schedules', async () => {
  await assert.rejects(() => findBestLocalSpreads({
    starts: [[32, 0, 32, 0, 2, 0]],
    transferSteps: [4, 0, 1],
    yieldControl: async () => {},
    evaluate: () => ({score: 0.5})
  }), /transferSteps/);
});

test('runs the complete eight-pass PC transfer schedule', async () => {
  const observed=[];
  const result=await findBestLocalSpreads({
    starts:[[32,0,32,0,2,0]],
    activeStats:[5],
    top:1,
    maxIterations:8,
    transferSteps:[8,8,8,8,4,4,2,1],
    beamWidth:8,
    yieldControl:async()=>{},
    onProgress:progress=>{if(progress.completedSeeds>0)observed.push(progress.transferStep)},
    evaluate:points=>({score:Math.min(1,points[5]/32)})
  });
  assert.deepEqual(result.transferSteps,[8,8,8,8,4,4,2,1]);
  assert.deepEqual(observed,[8,8,8,8,4,4,2,1]);
  assert.equal(result.completedSeeds,8);
  assert.equal(result.results[0].points[5],32);
});


test('jumps to the next exact stat breakpoint even when it differs from the scheduled transfer', async () => {
  const result = await findBestLocalSpreads({
    starts: [[1,9,0,0,0,0]],
    activeStats: [1],
    statBreakpoints: [[], [{points:1,value:176},{points:2,value:177},{points:4,value:179},{points:6,value:181},{points:8,value:183},{points:10,value:187}]],
    top: 1,
    maxIterations: 1,
    transferSteps: [8],
    beamWidth: 8,
    yieldControl: async () => {},
    evaluate: points => ({score: points[1] === 10 ? 1 : 0})
  });
  assert.ok(result.results.some(candidate => candidate.points.join(',') === '0,10,0,0,0,0'),
    'The search should transfer exactly one PC to reach the breakpoint at 10');
});


test('returns diverse top spreads when enough distinct candidates were explored', async () => {
  const result = await findBestLocalSpreads({
    starts:[[16,0,0,0,0,0]],
    activeStats:[1],
    top:3,
    maxIterations:4,
    transferSteps:[1],
    beamWidth:8,
    diversityDistance:4,
    yieldControl:async()=>{},
    evaluate:points=>({score:points[1]/32})
  });
  assert.equal(result.results.length,3);
  for(let i=0;i<result.results.length;i++) {
    for(let j=i+1;j<result.results.length;j++) {
      const distance=result.results[i].points.reduce((sum,value,index)=>
        sum+Math.abs(value-result.results[j].points[index]),0);
      assert.ok(distance>=4);
    }
  }
});

test('rejects an invalid diversity distance', async () => {
  await assert.rejects(()=>findBestLocalSpreads({
    starts:[[0,0,0,0,0,0]],evaluate:()=>({score:1}),diversityDistance:-1
  }),/diversityDistance/);
});


test('reclaims PC that does not increase the source stat and reaches a destination breakpoint', async () => {
  const result = await findBestLocalSpreads({
    starts: [[0,0,0,1,0,0]],
    activeStats: [0],
    statBreakpoints: [
      [{points:1,value:146,previousValue:145,gain:1}],
      [],[],[{points:2,value:74,previousValue:73,gain:1}],[],[]
    ],
    top: 1,
    maxIterations: 1,
    transferSteps: [8],
    beamWidth: 8,
    yieldControl: async () => {},
    evaluate: points => ({score: points[0] === 1 && points[3] === 0 ? 1 : 0})
  });
  assert.ok(result.results.some(candidate => candidate.points.join(',') === '1,0,0,0,0,0'),
    'One ineffective PC in the source stat should be moved to the exact HP breakpoint');
});

test('keeps gradual one-PC improvements available during coarse passes without requiring breakpoints', async () => {
  const seenSpeedPoints = new Set();
  const result = await findBestLocalSpreads({
    starts: [[0,0,32,0,0,0]],
    activeStats: [5],
    top: 3,
    maxIterations: 3,
    transferSteps: [8,8,8],
    beamWidth: 32,
    yieldControl: async () => {},
    evaluate: points => {
      seenSpeedPoints.add(points[5]);
      return {score: points[5] === 3 ? 1 : points[5] / 100};
    }
  });

  assert.ok(seenSpeedPoints.has(1),
    'A one-PC gradual move should be evaluated even in an eight-PC pass');
  assert.ok(result.results.some(candidate => candidate.points[5] === 3),
    'The search should be able to build a gradual three-PC improvement without stat breakpoints');
  assert.equal(result.results[0].score, 1);
});

test('matches exhaustive optimum on a small smooth allocation landscape', async () => {
  const evaluate = points => ({
    score: 1 - Math.abs(points[0] - 3) / 6
  });
  const exhaustive = findBestSpreads({
    evaluate,
    maxTotal: 6,
    exactTotal: true,
    top: 1
  });
  const heuristic = await findBestLocalSpreads({
    starts: [[6,0,0,0,0,0]],
    activeStats: [0,1],
    top: 1,
    maxIterations: 6,
    transferSteps: [1],
    beamWidth: 32,
    diversityDistance: 0,
    yieldControl: async () => {},
    evaluate
  });

  assert.equal(heuristic.cancelled, false);
  assert.equal(heuristic.results[0].score, exhaustive.results[0].score);
  assert.deepEqual(heuristic.results[0].points, exhaustive.results[0].points);
});
