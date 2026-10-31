import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAbility} from '../optimizador-smogon.js';

const poolEntry={name:'Testmon',abilities:'First Ability / Second Ability'};
const species={abilities:{0:'First Ability',1:'Second Ability'}};
const reference={abilities:['First Ability','Second Ability']};

test('selects the requested secondary ability instead of always using the first',()=>{
 assert.equal(resolveAbility(poolEntry,species,reference,'Second Ability'),'Second Ability');
});

test('defaults to the first Champions ability',()=>{
 assert.equal(resolveAbility(poolEntry,species,reference,undefined),'First Ability');
});

test('rejects an ability that is not legal for the pool entry',()=>{
 assert.throws(()=>resolveAbility(poolEntry,species,reference,'Hidden Ability'),/identificar la habilidad/);
});

test('rejects a reference ability absent from the Champions calculator dex',()=>{
 assert.throws(()=>resolveAbility(poolEntry,{abilities:{0:'First Ability'}},reference,'Second Ability'),/no está disponible/);
});
