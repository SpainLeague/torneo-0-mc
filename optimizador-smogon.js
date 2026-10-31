// Thin browser adapter for the official @smogon/calc Champions mechanics.
// Runtime: @smogon/calc 0.12.0, loaded from its pinned browser bundles.
// Champions is generation 0 in Smogon's calculator; its EV-shaped field stores PC directly.
import {
  getLegalMoveNames,
  getPoolEntry,
  getReferenceSpeciesRecord,
  normalizeId,
  calculateChampionStats
} from './optimizador-data.js';

const SMOGON_SPECIES = {
  'Samurott Hisui':'Samurott-Hisui',
  'Raichu Alola':'Raichu-Alola',
  'Rotom Frost':'Rotom-Frost',
  'Rotom Mow':'Rotom-Mow',
  'Rotom Fan':'Rotom-Fan',
  'Rotom Heat':'Rotom-Heat',
  'Avalugg Hisui':'Avalugg-Hisui',
  'Tauros de Paldea (Raza Combate)':'Tauros-Paldea-Combat',
  'Tauros de Paldea (Raza Ardiente)':'Tauros-Paldea-Blaze',
  'Tauros de Paldea (Raza Acuática)':'Tauros-Paldea-Aqua',
  'Zoroark Hisui':'Zoroark-Hisui',
  'Meowstic-F':'Meowstic-F',
  'Mega Meowstic (F)':'Meowstic-F-Mega',
  'Meowstic-M':'Meowstic',
  'Goodra Hisui':'Goodra-Hisui',
  'Persian Alola':'Persian-Alola',
  'Decidueye Hisui':'Decidueye-Hisui',
  'Slowking Galar':'Slowking-Galar',
  'Slowbro Galar':'Slowbro-Galar',
  'Stunfisk Galar':'Stunfisk-Galar'
};

const STAT_KEYS = ['hp','atk','def','spa','spd','spe'];

export function getSmogonRuntime() {
  const api = globalThis.calc;
  if (!api?.Generations || !api?.Pokemon || !api?.Move || !api?.Field || !api?.calculate) {
    throw new Error('No se ha cargado @smogon/calc. Comprueba la conexión con UNPKG y el orden de los scripts.');
  }
  return {api, gen: api.Generations.get(0)};
}

export function resolveSmogonSpecies(data, poolName, gen) {
  const reference = getReferenceSpeciesRecord(data, poolName);
  const name = SMOGON_SPECIES[poolName] ?? reference?.species?.name;
  if (!name) throw new Error('Sin alias de especie Champions para «' + poolName + '».');
  const species = gen.species.get(normalizeId(name));
  if (!species) throw new Error('La especie «' + name + '» no existe en el dex Champions de Smogon.');
  return {name: species.name, species, reference: reference?.species ?? null};
}

const ABILITY_ALIASES = {
  'Torrente':'Torrent',
  'Cortante':'Sharpness',
  'Cola Surf':'Surge Surfer',
  'Levitación':'Levitate',
  'Mandíbula Fuerte':'Strong Jaw',
  'Robustez':'Sturdy',
  'Gélido':'Ice Body',
  'Intimidación':'Intimidate',
  'Irascible':'Anger Point',
  'Rumia':'Cud Chew',
  'Ilusión':'Illusion',
  'Vista Lince':'Keen Eye',
  'Allanamiento':'Infiltrator',
  'Tenacidad':'Competitive',
  'Bromista':'Prankster'
};

export function resolveAbility(poolEntry, species, referenceSpecies, selectedAbility, gen) {
  const poolAbilities = String(poolEntry.abilities ?? '').split('/').map(x => x.trim()).filter(Boolean);
  const selectedIndex = selectedAbility ? poolAbilities.indexOf(selectedAbility) : 0;
  if (selectedAbility && selectedIndex < 0) {
    throw new Error('No se ha podido identificar la habilidad seleccionada de «' + poolEntry.name + '».');
  }
  const poolAbility = poolAbilities[selectedIndex];
  const referenceAbilities = referenceSpecies?.abilities;
  const requested = (Array.isArray(referenceAbilities) ? referenceAbilities[selectedIndex] : null)
    ?? ABILITY_ALIASES[poolAbility]
    ?? poolAbility;
  if (!requested) return undefined;
  const supported = gen?.abilities?.get(normalizeId(requested));
  if (!supported) {
    throw new Error('La habilidad «' + requested + '» no está disponible en el dex Champions del motor.');
  }
  return supported.name ?? requested;
}

function resolveItem(data, gen, itemId) {
  if (!itemId) return undefined;
  const id = normalizeId(itemId);
  const item = data.reference.items?.[id];
  const name = item?.name ?? gen.items.get(id)?.name;
  if (!name || !gen.items.get(normalizeId(name))) {
    throw new Error('El objeto «' + itemId + '» no está disponible en el catálogo Champions del motor.');
  }
  return name;
}

export function createSmogonPokemon(data, poolName, {
  points = [0,0,0,0,0,0],
  natureId = 'hardy',
  ability,
  itemId = ''
} = {}) {
  const {api, gen} = getSmogonRuntime();
  const entry = getPoolEntry(data, poolName);
  if (!entry) throw new Error('Pokémon no encontrado en la pool: ' + poolName);
  const resolved = resolveSmogonSpecies(data, poolName, gen);
  const nature = data.reference.natures?.[natureId]?.name;
  if (!nature || !gen.natures.get(normalizeId(nature))) {
    throw new Error('Naturaleza no disponible en el motor Champions: ' + natureId);
  }
  const abilityName = resolveAbility(entry, resolved.species, resolved.reference, ability, gen);
  if (!gen.abilities.get(normalizeId(abilityName))) {
    throw new Error('Habilidad no disponible en el motor Champions: ' + abilityName);
  }
  const itemName = resolveItem(data, gen, itemId);
  const evs = Object.fromEntries(STAT_KEYS.map((key, index) => [key, points[index] ?? 0]));
  const pokemon = new api.Pokemon(gen, resolved.name, {
    level: 50,
    nature,
    ability: abilityName,
    item: itemName,
    evs
  });

  // Guard against silent disagreement between the project's stat preview and Smogon's
  // Champions generation-0 stat-point implementation.
  const expected = calculateChampionStats(data, poolName, points, natureId);
  const actual = STAT_KEYS.map(key => pokemon.rawStats[key]);
  if (expected.some((value, index) => value !== actual[index])) {
    throw new Error('Diferencia de estadísticas entre los datos de la pool y Smogon para «' + poolName +
      '»: pool [' + expected.join(',') + '], Smogon [' + actual.join(',') + '].');
  }
  return pokemon;
}

export function calculateSmogonDamage(data, {
  attacker,
  defender,
  moveName,
  attackerPoints = [0,0,0,0,0,0],
  defenderPoints = [0,0,0,0,0,0],
  attackerNatureId = 'hardy',
  defenderNatureId = 'hardy',
  attackerAbility,
  defenderAbility,
  attackerItemId = '',
  defenderItemId = '',
  field = {},
  isCrit = false,
  accuracyOverride,
  hits
}) {
  const {api, gen} = getSmogonRuntime();
  if (accuracyOverride != null && (!Number.isFinite(accuracyOverride) || accuracyOverride < 0 || accuracyOverride > 1)) {
    throw new Error('La precisión efectiva debe estar entre 0 y 1.');
  }
  const legalMoves = getLegalMoveNames(data, attacker);
  if (!legalMoves.some(name => normalizeId(name) === normalizeId(moveName))) {
    throw new Error('El movimiento «' + moveName + '» no está en el movepool legal de «' + attacker + '».');
  }
  const moveData = gen.moves.get(normalizeId(moveName));
  if (!moveData) throw new Error('Smogon no tiene datos Champions para el movimiento «' + moveName + '».');
  if (moveData.category === 'Status') {
    throw new Error('«' + moveName + '» es un movimiento de estado y no tiene cálculo de daño.');
  }
  if (Array.isArray(moveData.multihit)) {
    const [minimumHits, maximumHits] = moveData.multihit;
    if (!Number.isInteger(hits) || hits < minimumHits || hits > maximumHits) {
      throw new Error('«' + moveName + '» requiere seleccionar un número de golpes entre ' + minimumHits + ' y ' + maximumHits + '.');
    }
  }

  const attackingPokemon = createSmogonPokemon(data, attacker, {
    points: attackerPoints, natureId: attackerNatureId, ability: attackerAbility, itemId: attackerItemId
  });
  const defendingPokemon = createSmogonPokemon(data, defender, {
    points: defenderPoints, natureId: defenderNatureId, ability: defenderAbility, itemId: defenderItemId
  });
  const move = new api.Move(gen, moveName, {
    ability: attackingPokemon.ability,
    item: attackingPokemon.item,
    ...(Number.isInteger(hits) ? {hits} : {}),
    isCrit: !!isCrit
  });
  const battleField = new api.Field({gameType: 'Doubles', ...field});
  const result = api.calculate(gen, attackingPokemon, defendingPokemon, move, battleField);
  const rolls = typeof result.damage === 'number'
    ? Array(16).fill(result.damage)
    : Array.isArray(result.damage) && result.damage.every(Number.isFinite)
      ? result.damage.slice()
      : Array.isArray(result.damage) && result.damage.length > 0 &&
        result.damage.every(hitRolls => Array.isArray(hitRolls) && hitRolls.length === 16 && hitRolls.every(Number.isFinite))
        ? result.damage.map(hitRolls => hitRolls.slice())
        : null;
  if (!rolls) {
    throw new Error('El motor devolvió un formato de daño no compatible con el evaluador.');
  }
  return {
    rolls,
    range: result.range(),
    accuracy: accuracyOverride == null
      ? (moveData.accuracy === true || moveData.accuracy == null ? 1 : moveData.accuracy / 100)
      : accuracyOverride,
    description: result.fullDesc(),
    attackerStats: {...attackingPokemon.rawStats},
    defenderStats: {...defendingPokemon.rawStats}
  };
}

export function auditSmogonCoverage(data) {
  const {gen} = getSmogonRuntime();
  return data.pool.map(entry => {
    let speciesName = null;
    let resolved = null;
    let speciesError = null;
    try {
      resolved = resolveSmogonSpecies(data, entry.name, gen);
      speciesName = resolved.name;
    } catch (error) { speciesError = error.message; }
    const legalMoves = getLegalMoveNames(data, entry.name);
    const missingMoves = legalMoves.filter(move => !gen.moves.get(normalizeId(move)));
    const poolAbilities = String(entry.abilities ?? '').split('/').map(value => value.trim()).filter(Boolean);
    const unsupportedAbilities = [];
    let abilityCount = 0;
    if (resolved) {
      for (const ability of poolAbilities) {
        try {
          resolveAbility(entry, resolved.species, resolved.reference, ability, gen);
          abilityCount++;
        } catch (error) {
          unsupportedAbilities.push({name:ability, reason:error.message});
        }
      }
    }
    return {
      poolName: entry.name,
      speciesName,
      speciesError,
      abilityCount,
      unsupportedAbilities,
      legalMoveCount: legalMoves.length,
      missingMoves
    };
  });
}
