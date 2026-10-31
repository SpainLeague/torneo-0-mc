import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateEffectiveSpeed, evaluateSpeedBenchmark} from '../optimizador-speed.js';

test('applies Choice Scarf and Tailwind multipliers',()=>{
 assert.equal(calculateEffectiveSpeed(100,{itemId:'choicescarf',tailwind:true}),300);
});

test('applies weather and terrain speed abilities only under their conditions',()=>{
 assert.equal(calculateEffectiveSpeed(100,{ability:'Swift Swim',weather:'Rain'}),200);
 assert.equal(calculateEffectiveSpeed(100,{ability:'Swift Swim',weather:'Sun'}),100);
 assert.equal(calculateEffectiveSpeed(100,{ability:'Chlorophyll',weather:'Harsh Sunshine'}),200);
 assert.equal(calculateEffectiveSpeed(100,{ability:'Sand Rush',weather:'Sand'}),200);
 assert.equal(calculateEffectiveSpeed(100,{ability:'Slush Rush',weather:'Snow'}),200);
 assert.equal(calculateEffectiveSpeed(100,{ability:'Surge Surfer',terrain:'Electric'}),200);
});

test('checks strict faster and slower speed thresholds with a margin',()=>{
 assert.equal(evaluateSpeedBenchmark(120,100,{relation:'faster',margin:19}).passed,true);
 assert.equal(evaluateSpeedBenchmark(120,100,{relation:'faster',margin:20}).passed,false);
 assert.equal(evaluateSpeedBenchmark(80,100,{relation:'slower',margin:19}).passed,true);
 assert.equal(evaluateSpeedBenchmark(80,100,{relation:'slower',margin:20}).passed,false);
});

test('rejects invalid speeds, margins and relations',()=>{
 assert.throws(()=>calculateEffectiveSpeed(0),/entero positivo/);
 assert.throws(()=>evaluateSpeedBenchmark(100,100,{margin:-1}),/margen/);
 assert.throws(()=>evaluateSpeedBenchmark(100,100,{relation:'same'}),/relación/);
});
