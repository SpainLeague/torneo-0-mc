import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as smogonCalc from '@smogon/calc';
import {
  auditSmogonCoverage,
  calculateSmogonDamage,
  createSmogonPokemon,
  getSmogonRuntime
} from '../optimizador-smogon.js';
import {getLegalMoveNames, normalizeId} from '../optimizador-data.js';

globalThis.calc = smogonCalc;
const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const data = {
  pool: read('../pool-data.json'),
  moveData: read('../move-data.json'),
  reference: read('../vendor/champions-reference/champions-data.json'),
  evSpreads: read('../ev-spreads.json')
};

test('loads the actual Smogon Champions generation 0 runtime', () => {
  const {gen} = getSmogonRuntime();
  assert.equal(gen.num, 0);
});

test('audits all pool forms and validates stats plus every declared ability on resolved forms', () => {
  const {gen} = getSmogonRuntime();
  const audit = auditSmogonCoverage(data);
  const unresolved = audit.filter(row => !row.speciesName);
  const resolved = audit.filter(row => row.speciesName);
  const unsupportedMoves = audit.flatMap(row => row.missingMoves.map(move => row.poolName + ': ' + move));
  const unsupportedAbilities = audit.flatMap(row => row.unsupportedAbilities.map(ability => row.poolName + ': ' + ability.name));
  console.log('Champions runtime coverage:', resolved.length + '/' + audit.length,
    'forms resolved; unresolved:', unresolved.map(row => row.poolName).join(', ') || 'none');
  console.log('Unsupported move data:', unsupportedMoves.length, unsupportedMoves.join(', ') || 'none');
  console.log('Unsupported abilities:', unsupportedAbilities.length, unsupportedAbilities.join(', ') || 'none');
  const failures = [];
  const unsupported = [];
  for (const row of resolved) {
    const entry = data.pool.find(item => item.name === row.poolName);
    const abilities = String(entry.abilities || '').split('/').map(value => value.trim()).filter(Boolean);
    try {
      if (!abilities.length) {
        createSmogonPokemon(data, row.poolName, {points:[0,0,0,0,0,0], natureId:'hardy'});
      } else {
        for (const ability of abilities) {
          createSmogonPokemon(data, row.poolName, {
            points:[0,0,0,0,0,0], natureId:'hardy', ability
          });
        }
      }
    } catch (error) {
      if (row.poolName === 'Greninja' && /Battle Bond/.test(error.message)) unsupported.push(row.poolName + ': Battle Bond');
      else failures.push(row.poolName + ': ' + error.message);
    }
  }
  assert.deepEqual(unsupportedMoves, [], 'Every legal pool move must exist in the Champions damage dex');
  assert.deepEqual(unsupportedAbilities, ['Greninja: Battle Bond'], 'Only Battle Bond is currently unsupported by the pinned calculator');
  assert.deepEqual(failures, [], 'Resolved Champions forms must match the engine stats and supported ability slots');
  assert.deepEqual(unsupported, ['Greninja: Battle Bond'], 'Only the known unsupported Battle Bond ability may remain unavailable');
  assert.equal(resolved.length, data.pool.length, 'Every pool form must resolve in the Champions engine');
});

test('calculates real Champions damage with weather, terrain, screens and critical hits', () => {
  const {gen} = getSmogonRuntime();
  const resolved = auditSmogonCoverage(data).filter(row => row.speciesName);
  let chosen;
  for (const row of resolved) {
    const moveName = getLegalMoveNames(data, row.poolName).find(name => {
      const move = gen.moves.get(normalizeId(name));
      return move && move.category !== 'Status' && !Array.isArray(move.multihit);
    });
    if (moveName) { chosen = {attacker:row.poolName, moveName}; break; }
  }
  assert.ok(chosen, 'A legal damaging move should be available in the pool');
  const defender = resolved.find(row => row.poolName !== chosen.attacker)?.poolName;
  assert.ok(defender, 'A second resolved form should be available as defender');
  const result = calculateSmogonDamage(data, {
    ...chosen, defender,
    field:{
      gameType:'Doubles', weather:'Rain', terrain:'Electric',
      attackerSide:{isHelpingHand:true},
      defenderSide:{isReflect:true,isLightScreen:true,isAuroraVeil:true}
    },
    isCrit:true
  });
  assert.ok(Array.isArray(result.rolls) && result.rolls.length === 16);
  assert.ok(Number.isFinite(result.accuracy) && result.accuracy >= 0 && result.accuracy <= 1);
  assert.ok(Array.isArray(result.range) && result.range.length === 2);
});

test('requires a legal explicit hit count for variable multihit moves', () => {
  const {gen} = getSmogonRuntime();
  let scenario;
  for (const row of auditSmogonCoverage(data).filter(row => row.speciesName)) {
    const moveName = getLegalMoveNames(data, row.poolName).find(name =>
      Array.isArray(gen.moves.get(normalizeId(name))?.multihit)
    );
    if (moveName) { scenario = {attacker:row.poolName, moveName}; break; }
  }
  if (!scenario) return;
  const defender = auditSmogonCoverage(data).find(row => row.speciesName && row.poolName !== scenario.attacker).poolName;
  assert.throws(() => calculateSmogonDamage(data,{...scenario,defender}), /requiere seleccionar un número de golpes/);
  const move = gen.moves.get(normalizeId(scenario.moveName));
  const hits = move.multihit[0];
  const result = calculateSmogonDamage(data,{...scenario,defender,hits});
  assert.ok(Array.isArray(result.rolls) && Array.isArray(result.rolls[0]));
});


test('weather boosts Water damage in Rain', () => {
  const clear = calculateSmogonDamage(data,{
    attacker:'Inteleon',defender:'Skarmory',moveName:'Hydro Pump',
    field:{gameType:'Doubles'}
  });
  const rain = calculateSmogonDamage(data,{
    attacker:'Inteleon',defender:'Skarmory',moveName:'Hydro Pump',
    field:{gameType:'Doubles',weather:'Rain'}
  });
  assert.ok(rain.range[0] > clear.range[0], 'Rain should increase Water-type damage');
});

test('Electric Terrain boosts a grounded Electric attacker', () => {
  const clear = calculateSmogonDamage(data,{
    attacker:'Bellibolt',defender:'Vaporeon',moveName:'Thunderbolt',
    field:{gameType:'Doubles'}
  });
  const terrain = calculateSmogonDamage(data,{
    attacker:'Bellibolt',defender:'Vaporeon',moveName:'Thunderbolt',
    field:{gameType:'Doubles',terrain:'Electric'}
  });
  assert.ok(terrain.range[0] > clear.range[0], 'Electric Terrain should boost the grounded Electric attacker');
});

test('Reflect reduces physical damage and critical hits change the damage rolls', () => {
  const base = calculateSmogonDamage(data,{
    attacker:'Skarmory',defender:'Vaporeon',moveName:'Brave Bird',
    field:{gameType:'Doubles'}
  });
  const reflect = calculateSmogonDamage(data,{
    attacker:'Skarmory',defender:'Vaporeon',moveName:'Brave Bird',
    field:{gameType:'Doubles',defenderSide:{isReflect:true}}
  });
  const critical = calculateSmogonDamage(data,{
    attacker:'Skarmory',defender:'Vaporeon',moveName:'Brave Bird',
    field:{gameType:'Doubles'},isCrit:true
  });
  assert.ok(reflect.range[1] < base.range[1], 'Reflect should reduce physical damage');
  assert.ok(critical.range[0] > base.range[0], 'A critical hit should increase damage');
});

test('spread moves receive the doubles area modifier', () => {
  const singles = calculateSmogonDamage(data,{
    attacker:'Skarmory',defender:'Vaporeon',moveName:'Rock Slide',
    field:{gameType:'Singles'}
  });
  const doubles = calculateSmogonDamage(data,{
    attacker:'Skarmory',defender:'Vaporeon',moveName:'Rock Slide',
    field:{gameType:'Doubles'}
  });
  assert.ok(doubles.range[1] < singles.range[1], 'Spread damage should be reduced in doubles');
});


test('allows an explicit effective accuracy override for ability and item effects', () => {
  const normal = calculateSmogonDamage(data,{
    attacker:'Inteleon',defender:'Skarmory',moveName:'Hydro Pump'
  });
  const adjusted = calculateSmogonDamage(data,{
    attacker:'Inteleon',defender:'Skarmory',moveName:'Hydro Pump',accuracyOverride:1
  });
  assert.ok(normal.accuracy < 1);
  assert.equal(adjusted.accuracy,1);
  assert.throws(()=>calculateSmogonDamage(data,{
    attacker:'Inteleon',defender:'Skarmory',moveName:'Hydro Pump',accuracyOverride:1.1
  }),/precisión efectiva/);
});
