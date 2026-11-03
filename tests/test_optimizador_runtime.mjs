import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as smogonCalc from '@smogon/calc';
import {
  auditSmogonCoverage,
  auditSmogonItemCoverage,
  calculateSmogonDamage,
  createSmogonPokemon,
  getRelevantPcStatIndexes,
  getSmogonRuntime
} from '../optimizador-smogon.js';
import {getLegalItemsForPool, getLegalMoveNames, getStatPointBreakpoints, normalizeId, validatePoolItem} from '../optimizador-data.js';
import {koThresholds} from '../optimizador-ko.js';
import {evaluateDamageObjective} from '../optimizador-evaluator.js';

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


test('uses only the relevant offensive and defensive stats for physical, special and Psyshock damage', () => {
  const attackerZero = [0,0,0,0,0,0];
  const hpOnly = [32,0,0,0,0,0];
  const attackOnly = [0,32,0,0,0,0];
  const specialAttackOnly = [0,0,0,32,0,0];
  const defenseOnly = [0,0,32,0,0,0];
  const specialDefenseOnly = [0,0,0,0,32,0];

  const physicalBase = calculateSmogonDamage(data, {
    attacker:'Skarmory',defender:'Vaporeon',moveName:'Brave Bird',
    attackerPoints:attackerZero,defenderPoints:attackerZero
  });
  const physicalAttack = calculateSmogonDamage(data, {
    attacker:'Skarmory',defender:'Vaporeon',moveName:'Brave Bird',
    attackerPoints:attackOnly,defenderPoints:attackerZero
  });
  const physicalSpecialAttack = calculateSmogonDamage(data, {
    attacker:'Skarmory',defender:'Vaporeon',moveName:'Brave Bird',
    attackerPoints:specialAttackOnly,defenderPoints:attackerZero
  });
  assert.ok(physicalAttack.range[1] > physicalBase.range[1],
    'Physical damage must benefit from Attack investment');
  assert.deepEqual(physicalSpecialAttack.range,physicalBase.range,
    'Special Attack investment must not change physical damage');

  const specialBase = calculateSmogonDamage(data, {
    attacker:'Inteleon',defender:'Skarmory',moveName:'Hydro Pump',
    attackerPoints:attackerZero,defenderPoints:attackerZero
  });
  const specialAttack = calculateSmogonDamage(data, {
    attacker:'Inteleon',defender:'Skarmory',moveName:'Hydro Pump',
    attackerPoints:specialAttackOnly,defenderPoints:attackerZero
  });
  const specialPhysicalAttack = calculateSmogonDamage(data, {
    attacker:'Inteleon',defender:'Skarmory',moveName:'Hydro Pump',
    attackerPoints:attackOnly,defenderPoints:attackerZero
  });
  assert.ok(specialAttack.range[1] > specialBase.range[1],
    'Special damage must benefit from Special Attack investment');
  assert.deepEqual(specialPhysicalAttack.range,specialBase.range,
    'Attack investment must not change special damage');

  const physicalDefense = calculateSmogonDamage(data, {
    attacker:'Inteleon',defender:'Skarmory',moveName:'Hydro Pump',
    attackerPoints:attackerZero,defenderPoints:defenseOnly
  });
  const physicalSpDefense = calculateSmogonDamage(data, {
    attacker:'Inteleon',defender:'Skarmory',moveName:'Hydro Pump',
    attackerPoints:attackerZero,defenderPoints:specialDefenseOnly
  });
  assert.deepEqual(physicalDefense.range,specialBase.range,
    'Special attacks must not use the target physical Defense');
  assert.ok(physicalSpDefense.range[1] < specialBase.range[1],
    'Special attacks must be reduced by Special Defense investment');

  const psyshockBase = calculateSmogonDamage(data, {
    attacker:'Mega Starmie',defender:'Skarmory',moveName:'Psyshock',
    attackerPoints:attackerZero,defenderPoints:attackerZero
  });
  const psyshockDefense = calculateSmogonDamage(data, {
    attacker:'Mega Starmie',defender:'Skarmory',moveName:'Psyshock',
    attackerPoints:attackerZero,defenderPoints:defenseOnly
  });
  const psyshockSpDefense = calculateSmogonDamage(data, {
    attacker:'Mega Starmie',defender:'Skarmory',moveName:'Psyshock',
    attackerPoints:attackerZero,defenderPoints:specialDefenseOnly
  });
  assert.ok(psyshockDefense.range[1] < psyshockBase.range[1],
    'Psyshock is special but must use the target physical Defense');
  assert.deepEqual(psyshockSpDefense.range,psyshockBase.range,
    'Psyshock must not use the target Special Defense');

  const hpBase = calculateSmogonDamage(data, {
    attacker:'Inteleon',defender:'Skarmory',moveName:'Hydro Pump',
    attackerPoints:attackerZero,defenderPoints:attackerZero
  });
  const hpInvested = calculateSmogonDamage(data, {
    attacker:'Inteleon',defender:'Skarmory',moveName:'Hydro Pump',
    attackerPoints:attackerZero,defenderPoints:hpOnly
  });
  assert.ok(hpInvested.defenderStats.hp > hpBase.defenderStats.hp,
    'HP investment must increase the target HP used by offensive and defensive KO thresholds');
  assert.deepEqual(hpInvested.range,hpBase.range,
    'Defender HP investment must change the KO threshold, not the raw damage roll');

  const fixedDamage = Array(16).fill(60);
  assert.equal(koThresholds(fixedDamage,100).ohko,0,
    'A 60-damage hit must not KO a 100-HP target');
  assert.equal(koThresholds(fixedDamage,100,0,1,0,100).twoHko,1,
    'Two hits must KO a 100-HP target');
  assert.equal(koThresholds(fixedDamage,150,0,1,0,150).twoHko,0,
    'Two hits must not KO a 150-HP target');
});

test('identifies only PC stats that can affect each Champions damage objective', () => {
  assert.deepEqual(getRelevantPcStatIndexes('Brave Bird','offensive'),[1]);
  assert.deepEqual(getRelevantPcStatIndexes('Hydro Pump','offensive'),[3]);
  assert.deepEqual(getRelevantPcStatIndexes('Psyshock','offensive'),[3]);
  assert.deepEqual(getRelevantPcStatIndexes('Psyshock','defensive'),[0,2]);
  assert.deepEqual(getRelevantPcStatIndexes('Hydro Pump','defensive'),[0,4]);
  assert.deepEqual(getRelevantPcStatIndexes('Brave Bird','defensive'),[0,2]);
  assert.deepEqual(getRelevantPcStatIndexes('Body Press','offensive'),[2]);
  assert.deepEqual(getRelevantPcStatIndexes('Foul Play','offensive'),[]);
  assert.deepEqual(getRelevantPcStatIndexes('Foul Play','defensive'),[0,1,2]);
  assert.deepEqual(getRelevantPcStatIndexes('Final Gambit','offensive'),[0]);
  assert.deepEqual(getRelevantPcStatIndexes('Electro Ball','defensive'),[0,4,5]);
  assert.deepEqual(getRelevantPcStatIndexes('Payback','defensive'),[0,2,5]);
  assert.deepEqual(getRelevantPcStatIndexes('Electro Ball','offensive'),[3,5]);
  assert.deepEqual(getRelevantPcStatIndexes('Gyro Ball','offensive'),[1,5]);
  assert.deepEqual(getRelevantPcStatIndexes('Eruption','offensive'),[3]);
  assert.deepEqual(getRelevantPcStatIndexes('Flail','offensive'),[1]);
  assert.deepEqual(getRelevantPcStatIndexes('Reversal','offensive'),[1]);
  assert.deepEqual(getRelevantPcStatIndexes('Endeavor','offensive'),[0]);
  assert.deepEqual(getRelevantPcStatIndexes('Final Gambit','offensive'),[0]);
  assert.deepEqual(getRelevantPcStatIndexes('Endeavor','defensive'),[0]);
  assert.deepEqual(getRelevantPcStatIndexes('Final Gambit','defensive'),[0]);
  assert.deepEqual(getRelevantPcStatIndexes('Seismic Toss','offensive'),[]);
  assert.deepEqual(getRelevantPcStatIndexes('Seismic Toss','defensive'),[0]);
  assert.deepEqual(getRelevantPcStatIndexes('Night Shade','offensive'),[]);
  assert.deepEqual(getRelevantPcStatIndexes('Super Fang','offensive'),[]);
  assert.deepEqual(getRelevantPcStatIndexes('Super Fang','defensive'),[0]);
  assert.deepEqual(getRelevantPcStatIndexes('Fissure','offensive'),[]);
  assert.deepEqual(getRelevantPcStatIndexes('Fissure','defensive'),[]);
  assert.deepEqual(getRelevantPcStatIndexes('Horn Drill','defensive'),[]);
  assert.deepEqual(getRelevantPcStatIndexes('Sheer Cold','defensive'),[]);
  assert.deepEqual(getRelevantPcStatIndexes('Counter','offensive'),[]);
  assert.deepEqual(getRelevantPcStatIndexes('Mirror Coat','offensive'),[]);
  assert.deepEqual(getRelevantPcStatIndexes('Metal Burst','offensive'),[]);
  assert.deepEqual(getRelevantPcStatIndexes('Shell Side Arm','offensive'),[1,3]);
  assert.deepEqual(getRelevantPcStatIndexes('Shell Side Arm','defensive'),[0,2,4]);
});

test('shared optimizer objective scoring consumes real Champions damage rolls', () => {
  const scenario=calculateSmogonDamage(data,{
    attacker:'Inteleon',defender:'Skarmory',moveName:'Hydro Pump',
    attackerPoints:[0,0,0,0,0,0],defenderPoints:[0,0,0,0,0,0],
    field:{gameType:'Doubles'}
  });
  const offensive=evaluateDamageObjective({
    damage:scenario,attackCount:1,hpPercent:100,minimum:0.5,offensive:true
  });
  const defensive=evaluateDamageObjective({
    damage:scenario,attackCount:1,hpPercent:100,minimum:0.5,offensive:false
  });
  assert.equal(offensive.success,offensive.koProbability);
  assert.equal(defensive.success,1-defensive.koProbability);
  assert.equal(offensive.currentHP,scenario.defenderStats.hp);
  assert.equal(defensive.maxHP,scenario.defenderStats.hp);
  assert.ok(offensive.score>=0 && offensive.score<=1);
  assert.ok(defensive.score>=0 && defensive.score<=1);
});

test('competitive matchup matrix validates physical, special and Psyshock investment against Champions damage rolls', () => {
  const scenarios=[
    {attacker:'Mega Starmie',defender:'Vaporeon',moveName:'Psyshock',attackStat:3,defenseStat:2},
    {attacker:'Inteleon',defender:'Mega Skarmory',moveName:'Hydro Pump',attackStat:3,defenseStat:4},
    {attacker:'Skarmory',defender:'Mega Meganium',moveName:'Brave Bird',attackStat:1,defenseStat:2},
    {attacker:'Mega Meganium',defender:'Vaporeon',moveName:'Grassy Glide',attackStat:1,defenseStat:2}
  ];
  for(const scenario of scenarios){
    const zero=[0,0,0,0,0,0];
    const attackerPoints=zero.slice();
    attackerPoints[scenario.attackStat]=16;
    const defenderPoints=zero.slice();
    defenderPoints[scenario.defenseStat]=16;
    const base=calculateSmogonDamage(data,{
      ...scenario,attackerPoints:zero,defenderPoints:zero,
      field:{gameType:'Doubles'}
    });
    const boostedAttack=calculateSmogonDamage(data,{
      ...scenario,attackerPoints,defenderPoints:zero,
      field:{gameType:'Doubles'}
    });
    const boostedDefense=calculateSmogonDamage(data,{
      ...scenario,attackerPoints:zero,defenderPoints,
      field:{gameType:'Doubles'}
    });
    assert.ok(base.rolls.length>0,scenario.attacker+' '+scenario.moveName+' should produce Champions damage rolls');
    assert.ok(boostedAttack.range[1]>base.range[1],
      scenario.attacker+' should benefit from the relevant offensive PC stat');
    assert.ok(boostedDefense.range[1]<base.range[1],
      scenario.defender+' should benefit from the relevant defensive PC stat');
    const objective=evaluateDamageObjective({
      damage:base,attackCount:2,hpPercent:100,offensive:true,minimum:0.5
    });
    assert.ok(objective.success>=0&&objective.success<=1);
    assert.equal(objective.maxHP,base.defenderStats.hp);
  }
});


test('Mega Aggron Adamant breakpoint agrees with the real Smogon Champions runtime', () => {
  const breakpoints = getStatPointBreakpoints(data, 'Mega Aggron', 'adamant', 1);
  const atNine = createSmogonPokemon(data, 'Mega Aggron', {
    points:[0,9,0,0,0,0], natureId:'adamant'
  });
  const atTen = createSmogonPokemon(data, 'Mega Aggron', {
    points:[0,10,0,0,0,0], natureId:'adamant'
  });
  assert.equal(atNine.rawStats.atk,185);
  assert.equal(atTen.rawStats.atk,187);
  assert.deepEqual(breakpoints.find(entry=>entry.points===10),
    {points:10,value:187,previousValue:185,gain:2});
});


test('HP PC affects absolute-HP moves but not full-health ratio-based Eruption', () => {
  const zero = [0,0,0,0,0,0];
  const hp = [32,0,0,0,0,0];
  const spa = [0,0,0,32,0,0];
  const eruption = calculateSmogonDamage(data,{
    attacker:'Typhlosion',defender:'Mega Skarmory',moveName:'Eruption',
    attackerPoints:zero
  });
  const eruptionHp = calculateSmogonDamage(data,{
    attacker:'Typhlosion',defender:'Mega Skarmory',moveName:'Eruption',
    attackerPoints:hp
  });
  const eruptionSpa = calculateSmogonDamage(data,{
    attacker:'Typhlosion',defender:'Mega Skarmory',moveName:'Eruption',
    attackerPoints:spa
  });
  assert.deepEqual(eruptionHp.range,eruption.range,
    'At full attacker HP, Eruption power is a ratio and HP PC does not change it');
  assert.ok(eruptionSpa.range[1] > eruption.range[1],
    'Eruption still uses Special Attack');

  const finalGambit = calculateSmogonDamage(data,{
    attacker:"Sirfetch'd",defender:'Mega Skarmory',moveName:'Final Gambit',
    attackerPoints:zero
  });
  const finalGambitHp = calculateSmogonDamage(data,{
    attacker:"Sirfetch'd",defender:'Mega Skarmory',moveName:'Final Gambit',
    attackerPoints:hp
  });
  assert.ok(finalGambitHp.range[0] > finalGambit.range[0],
    'Final Gambit damage increases with the attacker absolute HP');
});

test('Champions damage runtime applies Life Orb modifier', () => {
  const hydroPump = calculateSmogonDamage(data,{
    attacker:'Inteleon',defender:'Skarmory',moveName:'Hydro Pump',
    field:{gameType:'Doubles'}
  });
  const lifeOrb = calculateSmogonDamage(data,{
    attacker:'Inteleon',defender:'Skarmory',moveName:'Hydro Pump',
    attackerItemId:'lifeorb',field:{gameType:'Doubles'}
  });
  assert.ok(lifeOrb.range[0] > hydroPump.range[0],
    'Life Orb should increase special damage');
});


test('all Mega forms in the pool have a Champions-supported required Mega Stone', () => {
  const audit=auditSmogonItemCoverage(data);
  assert.ok(audit.megaStoneCount>0,'The pool should contain Mega forms');
  assert.deepEqual(audit.missingMegaStones,[],
    'Every required Mega Stone should resolve in the Champions calculator');
});

test('legal item audit separates supported and unsupported Champions items', () => {
  const audit=auditSmogonItemCoverage(data);
  assert.equal(audit.supportedCount+audit.unsupported.length,audit.legalCount);
  assert.ok(audit.supportedCount>0,'At least some legal items should be supported');
  assert.ok(audit.unsupported.every(item=>item.id&&item.name));
});


test('regular Pokemon item choices exclude every Mega Stone', () => {
  const items=getLegalItemsForPool(data,'Inteleon');
  assert.ok(items.some(item=>item.id==='lifeorb'));
  assert.ok(items.every(item=>!data.reference.items[item.id]?.megaStone));
  assert.equal(validatePoolItem(data,'Inteleon','aggronite'),false);
  assert.equal(validatePoolItem(data,'Inteleon','lifeorb'),true);
});

test('Mega Pokemon can select only their own required Mega Stone', () => {
  const items=getLegalItemsForPool(data,'Mega Aggron');
  assert.deepEqual(items,[{id:'aggronite',name:'Aggronite'}]);
  assert.equal(validatePoolItem(data,'Mega Aggron','aggronite'),true);
  assert.equal(validatePoolItem(data,'Mega Aggron','abomasite'),false);
});


test('Mega Barbaracle resolves its required Barbaracite through the engine item ID', () => {
  assert.equal(data.reference.items.barbaracite.name,'Barbaracleite',
    'The reference display name intentionally differs from the pool item ID');
  assert.doesNotThrow(() => createSmogonPokemon(data,'Mega Barbaracle',{
    points:[0,0,0,0,0,0],natureId:'hardy',itemId:'barbaracite'
  }));
});

test('every item exposed by the Champions support audit can be resolved by the damage runtime', () => {
  const audit=auditSmogonItemCoverage(data);
  for(const item of audit.supported){
    assert.doesNotThrow(()=>createSmogonPokemon(data,'Inteleon',{itemId:item.id}),
      'Supported item should resolve: '+item.id);
  }
});
