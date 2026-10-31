import test from 'node:test';
import assert from 'node:assert/strict';
import {damageDistribution, repeatedKoProbability, koThresholds} from '../optimizador-ko.js';

test('single-hit distribution preserves all 16 equally likely rolls', () => {
  const rolls=Array.from({length:16},(_,i)=>i+1);
  const distribution=damageDistribution(rolls);
  assert.equal(distribution.length,16);
  assert.ok(Math.abs(distribution.reduce((sum,x)=>sum+x.probability,0)-1)<1e-12);
});

test('duplicate rolls are combined with exact probability', () => {
  const distribution=damageDistribution([10,10,10,20,20,20,20,20,20,20,20,20,20,20,20,20]);
  assert.equal(distribution.length,2);
  assert.ok(Math.abs(distribution.find(x=>x.damage===10).probability-3/16)<1e-12);
  assert.ok(Math.abs(distribution.find(x=>x.damage===20).probability-13/16)<1e-12);
});

test('multi-hit distribution convolves each hit independently', () => {
  const distribution=damageDistribution([[10,10,...Array(14).fill(20)],[5,5,...Array(14).fill(10)]]);
  assert.ok(Math.abs(distribution.reduce((sum,x)=>sum+x.probability,0)-1)<1e-12);
  assert.equal(distribution.find(x=>x.damage===15)?.probability,4/256);
});

test('repeated attacks compute exact OHKO, 2HKO and 3HKO probabilities', () => {
  const rolls=Array(8).fill(40).concat(Array(8).fill(60));
  const result=koThresholds(rolls,100);
  assert.equal(result.ohko,0);
  assert.equal(result.twoHko,0.75);
  assert.equal(result.threeHko,1);
});

test('residual damage is applied only between repeated attacks', () => {
  const rolls=Array(16).fill(40);
  assert.equal(repeatedKoProbability(rolls,100,2,19),0);
  assert.equal(repeatedKoProbability(rolls,100,2,20),1);
});

test('rejects invalid HP, attack counts and rolls', () => {
  assert.throws(()=>repeatedKoProbability([10],0,1),/PS actuales/);
  assert.throws(()=>repeatedKoProbability([10],100,4),/1, 2 o 3/);
  assert.throws(()=>damageDistribution([]),/distribución/);
});


test('repeated attacks include the probability of missing each attack', () => {
  const rolls=Array(16).fill(60);
  assert.equal(repeatedKoProbability(rolls,60,1,0,0.5),0.5);
  assert.equal(repeatedKoProbability(rolls,100,2,0,0.5),0.25);
});

test('accuracy outside the valid range is rejected', () => {
  assert.throws(()=>repeatedKoProbability(Array(16).fill(10),100,1,0,1.1),/precisión/);
});


test('current HP percentage changes the KO threshold', () => {
  const rolls=Array(16).fill(40);
  assert.equal(repeatedKoProbability(rolls,80,2),1);
  assert.equal(repeatedKoProbability(rolls,100,2),0);
});

test('recovery is applied between attacks and capped at maximum HP', () => {
  const rolls=Array(16).fill(50);
  assert.equal(repeatedKoProbability(rolls,100,2,0,1,0,100),1);
  assert.equal(repeatedKoProbability(rolls,100,2,0,1,1,100),0);
  assert.equal(repeatedKoProbability(rolls,80,2,0,1,30,100),0);
});

test('residual damage is applied before recovery between attacks', () => {
  const rolls=Array(16).fill(40);
  assert.equal(repeatedKoProbability(rolls,100,2,10,1,5,100),0);
  assert.equal(repeatedKoProbability(rolls,100,2,15,1,5,100),1);
});
