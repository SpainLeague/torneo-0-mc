import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateAutomaticTurnEffects} from '../optimizador-residual.js';

test('applies Champions burn, poison and escalating poison damage', () => {
  assert.equal(calculateAutomaticTurnEffects({maxHP:160,status:'burn'}).residualDamage,10);
  assert.equal(calculateAutomaticTurnEffects({maxHP:160,status:'poison'}).residualDamage,20);
  assert.equal(calculateAutomaticTurnEffects({maxHP:160,status:'badly-poisoned',toxicStage:3}).residualDamage,30);
});

test('applies sandstorm chip only to vulnerable types and abilities', () => {
  assert.equal(calculateAutomaticTurnEffects({maxHP:160,weather:'Sand',types:['Normal']}).residualDamage,10);
  assert.equal(calculateAutomaticTurnEffects({maxHP:160,weather:'Sand',types:['Rock']}).residualDamage,0);
  assert.equal(calculateAutomaticTurnEffects({maxHP:160,weather:'Sand',ability:'Sand Veil'}).residualDamage,0);
  assert.equal(calculateAutomaticTurnEffects({maxHP:160,weather:'Sand',ability:'Overcoat'}).residualDamage,0);
  assert.equal(calculateAutomaticTurnEffects({maxHP:160,weather:'Sand',ability:'Sand Rush'}).residualDamage,10);
});

test('applies Grassy Terrain recovery only while grounded', () => {
  assert.equal(calculateAutomaticTurnEffects({maxHP:160,terrain:'Grassy',grounded:true}).recovery,10);
  assert.equal(calculateAutomaticTurnEffects({maxHP:160,terrain:'Grassy',grounded:false}).recovery,0);
});

test('applies Champions weather recovery and damage abilities', () => {
  assert.equal(calculateAutomaticTurnEffects({maxHP:160,weather:'Rain',ability:'Rain Dish'}).recovery,10);
  assert.equal(calculateAutomaticTurnEffects({maxHP:160,weather:'Rain',ability:'Dry Skin'}).recovery,20);
  assert.equal(calculateAutomaticTurnEffects({maxHP:160,weather:'Harsh Sunshine',ability:'Solar Power'}).residualDamage,20);
  assert.equal(calculateAutomaticTurnEffects({maxHP:160,weather:'Harsh Sunshine',ability:'Dry Skin'}).residualDamage,20);
  assert.equal(calculateAutomaticTurnEffects({maxHP:160,weather:'Snow',ability:'Ice Body'}).recovery,10);
});

test('respects status immunities and Magic Guard without suppressing healing', () => {
  assert.equal(calculateAutomaticTurnEffects({maxHP:160,status:'burn',types:['Fire']}).residualDamage,0);
  assert.equal(calculateAutomaticTurnEffects({maxHP:160,status:'poison',ability:'Immunity'}).residualDamage,0);
  const result=calculateAutomaticTurnEffects({maxHP:160,status:'burn',weather:'Sand',terrain:'Grassy',ability:'Magic Guard'});
  assert.equal(result.residualDamage,0);
  assert.equal(result.recovery,10);
});

test('rejects invalid maximum HP and toxic stage', () => {
  assert.throws(()=>calculateAutomaticTurnEffects({maxHP:0}));
  assert.throws(()=>calculateAutomaticTurnEffects({maxHP:100,status:'badly-poisoned',toxicStage:16}));
});
