// Data adapter for the Torneo 0% MC pool.
// Keeps pool entries authoritative and treats reference-name differences as aliases only.
const TYPE_IDS = {
  Acero:'Steel', Agua:'Water', Bicho:'Bug', Dragon:'Dragon', Dragón:'Dragon',
  Electrico:'Electric', Eléctrico:'Electric', Fantasma:'Ghost', Fuego:'Fire',
  Hada:'Fairy', Hielo:'Ice', Lucha:'Fighting', Normal:'Normal', Planta:'Grass',
  Psiquico:'Psychic', Psíquico:'Psychic', Roca:'Rock', Siniestro:'Dark',
  Tierra:'Ground', Veneno:'Poison', Volador:'Flying'
};

const NON_DAMAGING_MOVE_IDS = new Set(['stuffcheeks']);

const MOVE_KEYS = {
  'Tauros de Paldea (Raza Combate)':'Tauros',
  'Tauros de Paldea (Raza Ardiente)':'Tauros',
  'Tauros de Paldea (Raza Acuática)':'Tauros',
  'Meowstic-F':'Meowstic',
  'Meowstic-M':'Meowstic (M)'
};

export function normalizeId(value) {
  return String(value ?? '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

export async function loadOptimizerData(basePath = './') {
  const [poolResponse, movesResponse, referenceResponse, spreadsResponse] = await Promise.all([
    fetch(basePath + 'pool-data.json'),
    fetch(basePath + 'move-data.json'),
    fetch(basePath + 'vendor/champions-reference/champions-data.json'),
    fetch(basePath + 'ev-spreads.json')
  ]);
  if (!poolResponse.ok || !movesResponse.ok || !referenceResponse.ok || !spreadsResponse.ok) {
    throw new Error('No se han podido cargar todos los archivos de datos del optimizador.');
  }
  const [pool, moveData, reference, evSpreads] = await Promise.all([
    poolResponse.json(), movesResponse.json(), referenceResponse.json(), spreadsResponse.json()
  ]);
  if (!Array.isArray(pool) || pool.length !== 223) {
    throw new Error('La pool no contiene las 223 entradas esperadas.');
  }
  return {pool, moveData, reference, evSpreads};
}

export function getPoolEntry(data, name) {
  return data.pool.find(entry => entry.name === name) ?? null;
}

export function getLegalMoveNames(data, poolName) {
  const key = MOVE_KEYS[poolName] ?? poolName;
  return data.moveData.pokemon?.[key] ?? [];
}

export function getReferenceSpeciesRecord(data, poolName) {
  const alias = data.reference.meta?.nameAliases?.[poolName];
  const sought = normalizeId(alias ?? poolName);
  const found = Object.entries(data.reference.species ?? {}).find(([, species]) =>
    normalizeId(species.name) === sought || normalizeId(species.display) === sought
  );
  return found ? {id: found[0], species: found[1]} : null;
}

export function getReferenceSpecies(data, poolName) {
  return getReferenceSpeciesRecord(data, poolName)?.species ?? null;
}

// Champions uses 66 Stat Points total, at most 32 in one stat, and fixed 31 IVs.
export function validateStatPoints(points) {
  if (!Array.isArray(points) || points.length !== 6) return false;
  return points.every(value => Number.isInteger(value) && value >= 0 && value <= 32)
    && points.reduce((sum, value) => sum + value, 0) <= 66;
}

export function calculateChampionStats(data, poolName, points = [0,0,0,0,0,0], natureId = 'hardy') {
  const entry = getPoolEntry(data, poolName);
  if (!entry) throw new Error('Pokémon no encontrado en la pool: ' + poolName);
  if (!validateStatPoints(points)) throw new Error('Reparto inválido: máximo 32 por estadística y 66 en total.');
  const nature = data.reference.natures?.[natureId] ?? null;
  const bases = [entry.hpBase, entry.atkBase, entry.defBase, entry.spaBase, entry.spdBase, entry.speBase];
  return bases.map((base, index) => {
    const sp = points[index] ?? 0;
    if (index === 0) return Number(base) === 1 ? 1 : Number(base) + 75 + sp;
    const stat = ['atk','def','spa','spd','spe'][index - 1];
    const multiplier = nature?.plus === stat ? 1.1 : nature?.minus === stat ? 0.9 : 1;
    return Math.floor((Number(base) + 20 + sp) * multiplier);
  });
}

export function getPoolTypes(entry) {
  return [TYPE_IDS[entry.type1] ?? entry.type1, TYPE_IDS[entry.type2] ?? entry.type2]
    .filter(Boolean);
}

export function auditPoolCoverage(data) {
  return data.pool.map(entry => {
    const legalMoves = getLegalMoveNames(data, entry.name);
    const record = getReferenceSpeciesRecord(data, entry.name);
    const movesWithoutDamageData = legalMoves.filter(move => {
      const moveId = normalizeId(move);
      return !NON_DAMAGING_MOVE_IDS.has(moveId) && !data.reference.moves?.[moveId];
    });
    return {
      poolName: entry.name,
      legalMoveCount: legalMoves.length,
      referenceResolved: !!record,
      referenceName: record?.species.display ?? null,
      referenceId: record?.id ?? null,
      movesWithoutDamageData
    };
  });
}

export function getRequiredMegaStone(data, poolName) {
  const record = getReferenceSpeciesRecord(data, poolName);
  if (record?.species?.megaStone) return record.species.megaStone;
  if (poolName === 'Mega Meowstic (F)') return 'meowsticite';
  return null;
}

export function getLegalItemsForPool(data, poolName) {
  const required = getRequiredMegaStone(data, poolName);
  if (required) {
    const item = data.reference.items?.[required];
    return item?.legal ? [{id: required, name: item.name}] : [];
  }
  return Object.entries(data.reference.items ?? {})
    .filter(([, item]) => item.legal)
    .map(([id, item]) => ({id, name: item.name}))
    .sort((a,b) => a.name.localeCompare(b.name, 'es'));
}

export function validatePoolItem(data, poolName, itemId) {
  const required = getRequiredMegaStone(data, poolName);
  const normalized = normalizeId(itemId);
  if (required) return normalized === normalizeId(required);
  if (!normalized) return true;
  return !!data.reference.items?.[normalized]?.legal;
}


export function getSpreadPresets(data, poolName) {
  const spreads = data.evSpreads?.pokemon?.[poolName]?.spreads;
  if (!Array.isArray(spreads)) return [];
  return spreads.filter(spread => Array.isArray(spread.points) && spread.points.length === 6 &&
    spread.points.every(value => Number.isInteger(value) && value >= 0 && value <= 32) &&
    spread.points.reduce((sum, value) => sum + value, 0) === 66 &&
    typeof spread.natureId === 'string' && Number.isFinite(spread.usagePercent));
}
