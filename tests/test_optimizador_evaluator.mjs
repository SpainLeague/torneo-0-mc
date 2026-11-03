import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateDamageObjective,meanObjectiveScore,aggregateObjectiveScores} from '../optimizador-evaluator.js';

const damage = (hp=100,accuracy=1) => ({
  rolls:Array(16).fill(60),
  range:[60,60],
  accuracy,
  defenderStats:{hp}
});

test('offensive objectives use the selected OHKO, 2HKO and 3HKO probability', () => {
  const scenario=damage(100);
  assert.equal(evaluateDamageObjective({damage:scenario,attackCount:1,minimum:0.9}).success,0);
  assert.equal(evaluateDamageObjective({damage:scenario,attackCount:2,minimum:0.9}).success,1);
  assert.equal(evaluateDamageObjective({damage:scenario,attackCount:3,minimum:0.9}).success,1);
});

test('defensive objectives score the probability of surviving the configured attacks', () => {
  const scenario=damage(100);
  assert.equal(evaluateDamageObjective({damage:scenario,attackCount:1,offensive:false}).success,1);
  assert.equal(evaluateDamageObjective({damage:scenario,attackCount:2,offensive:false}).success,0);
});

test('the target HP is recalculated from the current HP percentage', () => {
  const scenario=damage(100);
  const full=evaluateDamageObjective({damage:scenario,attackCount:2,hpPercent:100});
  const chipped=evaluateDamageObjective({damage:scenario,attackCount:2,hpPercent:60});
  assert.equal(full.currentHP,100);
  assert.equal(chipped.currentHP,60);
  assert.equal(chipped.success,1);
  assert.equal(full.success,1);
});

test('accuracy is included in repeated-hit KO probability', () => {
  const result=evaluateDamageObjective({
    damage:damage(100,0.5),attackCount:2,minimum:0.5
  });
  assert.equal(result.success,0.25);
  assert.equal(result.score,0.5);
  assert.equal(result.passed,false);
});

test('recovery between attacks can prevent a multi-hit KO', () => {
  const scenario=damage(100);
  const noRecovery=evaluateDamageObjective({damage:scenario,attackCount:2});
  const withRecovery=evaluateDamageObjective({damage:scenario,attackCount:2,recovery:50});
  assert.equal(noRecovery.success,1);
  assert.equal(withRecovery.success,0);
});

test('objective scores are threshold-normalized and equally weighted', () => {
  const first=evaluateDamageObjective({damage:damage(100),attackCount:2,minimum:0.5});
  const second=evaluateDamageObjective({damage:damage(150),attackCount:2,minimum:0.9});
  assert.equal(first.score,1);
  assert.equal(second.score,0);
  assert.equal(meanObjectiveScore([first,second]),0.5);
});

test('rejects invalid objective inputs and scores', () => {
  assert.throws(()=>evaluateDamageObjective({damage:damage(),attackCount:4}),/1, 2 o 3/);
  assert.throws(()=>evaluateDamageObjective({damage:damage(),hpPercent:0}),/PS actuales/);
  assert.throws(()=>meanObjectiveScore([]),/al menos un objetivo/);
  assert.throws(()=>meanObjectiveScore([{score:1.1}]),/entre 0 y 1/);
});


test('balanced aggregation penalizes a neglected objective without changing equal objective weights', () => {
  const objectives=[{score:1},{score:1},{score:0}];
  assert.equal(aggregateObjectiveScores(objectives,{mode:'mean'}),2/3);
  assert.equal(aggregateObjectiveScores(objectives,{mode:'balanced'}), (2/3)*0.7);
  assert.equal(aggregateObjectiveScores([{score:0.6}],{mode:'balanced'}),0.6);
});

test('balanced aggregation validates mode and balance factor', () => {
  assert.throws(()=>aggregateObjectiveScores([{score:1}],{mode:'weighted'}),/modo/);
  assert.throws(()=>aggregateObjectiveScores([{score:1}],{balance:1.1}),/equilibrio/);
});


test('the selected defender item is applied to multi-attack KO probability', () => {
  const scenario=damage(100);
  const berryDamage={...scenario,rolls:Array(16).fill(60),range:[60,60]};
  const withoutBerry=evaluateDamageObjective({damage:berryDamage,attackCount:2});
  const withBerry=evaluateDamageObjective({damage:berryDamage,attackCount:2,defenderItem:'Sitrus Berry'});
  assert.equal(withoutBerry.success,1);
  assert.equal(withBerry.success,0);
  assert.equal(withBerry.itemEffects.sitrusBerry,true);
  const withLeftovers=evaluateDamageObjective({damage:{...scenario,rolls:Array(16).fill(50),range:[50,50]},attackCount:2,defenderItem:'Leftovers'});
  assert.equal(withLeftovers.success,0);
  assert.equal(withLeftovers.itemEffects.leftovers,true);
});
