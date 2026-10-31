import {koThresholds} from './optimizador-ko.js';
import {calculate as calculateReferenceDamage} from './vendor/pokecalc/damage.js';
import {getPoolEntry, getLegalMoveNames, getReferenceSpeciesRecord, validateStatPoints, normalizeId, getPoolTypes} from './optimizador-data.js';

const STAT_KEYS = ['hp','atk','def','spa','spd','spe'];

function toSPObject(points) {
  return Object.fromEntries(STAT_KEYS.map((stat, index) => [stat, Number(points[index] ?? 0)]));
}

function engineDataForPool(data, entries) {
  const speciesTable = {...data.reference.species};
  for (const {entry, record} of entries) {
    const species = {...record.species};
    species.name = entry.name;
    species.display = entry.name;
    species.stats = [entry.hpBase,entry.atkBase,entry.defBase,entry.spaBase,entry.spdBase,entry.speBase].map(Number);
    species.types = getPoolTypes(entry);
    speciesTable[record.id] = species;
  }
  return {...data.reference, species: speciesTable};
}

function makeSet(data, poolName, config = {}) {
  const entry = getPoolEntry(data, poolName);
  if (!entry) throw new Error('El Pokémon no pertenece a la pool: ' + poolName);
  const record = getReferenceSpeciesRecord(data, poolName);
  if (!record) throw new Error('La forma "' + poolName + '" todavía no tiene una ficha de combate inequívoca en la referencia.');
  const points = config.points ?? [0,0,0,0,0,0];
  if (!validateStatPoints(points)) throw new Error('PC inválidos: máximo 32 por estadística y 66 en total.');
  const species = record.species;
  const item = config.item ? normalizeId(config.item) : null;
  if (species.kind === 'mega' && species.megaStone) {
    const stone = normalizeId(species.megaStone);
    if (item !== stone) throw new Error('La forma Mega requiere su megapiedra: ' + species.megaStone + '.');
  }
  return {
    species: record.id,
    level: 50,
    sp: toSPObject(points),
    nature: config.nature ?? 'hardy',
    ability: config.ability ?? species.abilities?.[0],
    item,
    status: config.status ?? null,
    currentHP: config.currentHP,
    hpPercent: config.hpPercent,
    boosts: config.boosts ?? {},
    gender: species.gender
  };
}

/**
 * Runs one real engine calculation for two entries from the tournament pool.
 * Move legality is checked against move-data.json before invoking the engine.
 * The 20 forms without a matching reference record are deliberately blocked.
 */
export function calculatePoolDamage(data, attackerConfig, defenderConfig, moveName, field = {}) {
  const attackerEntry = getPoolEntry(data, attackerConfig.poolName);
  if (!attackerEntry) throw new Error('Atacante fuera de la pool.');
  const legalMoves = getLegalMoveNames(data, attackerConfig.poolName);
  const requestedId = normalizeId(moveName);
  const legalName = legalMoves.find(name => normalizeId(name) === requestedId);
  if (!legalName) throw new Error('Movimiento no permitido para ' + attackerConfig.poolName + ': ' + moveName);
  const moveId = normalizeId(legalName);
  if (!data.reference.moves?.[moveId]) throw new Error('El motor no contiene datos de daño para el movimiento: ' + legalName);
  const attacker = makeSet(data, attackerConfig.poolName, attackerConfig);
  const defender = makeSet(data, defenderConfig.poolName, defenderConfig);
  const engineData = engineDataForPool(data, [\n    {entry: attackerEntry, record: getReferenceSpeciesRecord(data, attackerConfig.poolName)},\n    {entry: getPoolEntry(data, defenderConfig.poolName), record: getReferenceSpeciesRecord(data, defenderConfig.poolName)}\n  ]);
  return calculateReferenceDamage(attacker, defender, {id: moveId, name: legalName}, field, engineData);
}

export function getPoolCombatReadiness(data) {
  return data.pool.map(entry => {
    const record = getReferenceSpeciesRecord(data, entry.name);
    return {
      poolName: entry.name,
      referenceResolved: !!record,
      referenceId: record?.id ?? null,
      legalMoveCount: getLegalMoveNames(data, entry.name).length,
      engineReady: !!record && getLegalMoveNames(data, entry.name).some(move => !!data.reference.moves?.[normalizeId(move)])
    };
  });
}

/** Damage and exact repeated-attack KO odds from the same 16 engine rolls. */
export function calculatePoolDamageWithKo(data, attackerConfig, defenderConfig, moveName, field = {}, residualBetweenAttacks = 0) {
  const result = calculatePoolDamage(data, attackerConfig, defenderConfig, moveName, field);
  const ko = koThresholds(result.damage, result.defender.currentHP, residualBetweenAttacks);
  return {...result, repeatedKo: ko};
}
