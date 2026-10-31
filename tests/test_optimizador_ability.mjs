import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAbility} from '../optimizador-smogon.js';

const abilityNames = new Set(['firstability','secondability','torrent','sharpness','surgesurfer']);
const gen = {abilities:{get:id=>abilityNames.has(id)?{name:id==='secondability'?'Second Ability':id==='firstability'?'First Ability':id==='torrent'?'Torrent':id==='sharpness'?'Sharpness':'Surge Surfer'}:undefined}};
const poolEntry={name:'Testmon',abilities:'First Ability / Second Ability'};
const species={abilities:{0:'First Ability'}};
const reference={abilities:['First Ability','Second Ability']};

test('selects the requested secondary ability even if Gen 0 species data lists only one default ability',()=>{
 assert.equal(resolveAbility(poolEntry,species,reference,'Second Ability',gen),'Second Ability');
});

test('defaults to the first Champions ability',()=>{
 assert.equal(resolveAbility(poolEntry,species,reference,undefined,gen),'First Ability');
});

test('rejects an ability that is not legal for the pool entry',()=>{
 assert.throws(()=>resolveAbility(poolEntry,species,reference,'Hidden Ability',gen),/identificar la habilidad/);
});

test('rejects an ability absent from the calculator ability dex',()=>{
 const noSecond = {abilities:{get:id=>id==='firstability'?{name:'First Ability'}:undefined}};
 assert.throws(()=>resolveAbility(poolEntry,species,reference,'Second Ability',noSecond),/no está disponible/);
});

test('maps localized abilities for forms without a reference record',()=>{
 const localized={name:'Samurott Hisui',abilities:'Torrente / Cortante'};
 assert.equal(resolveAbility(localized,{},null,'Cortante',gen),'Sharpness');
});
