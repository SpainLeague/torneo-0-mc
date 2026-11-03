const DAMAGE_DIVISORS = {
  burn: 16,
  poison: 8,
  badlyPoisonedBase: 16,
  sandstorm: 16,
  solarPower: 8,
  drySkinSun: 8
};

const HEAL_DIVISORS = {
  grassyTerrain: 16,
  rainDish: 16,
  drySkinRain: 8,
  iceBodySnow: 16
};

const normalize = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const floorFraction = (hp, divisor) => Math.max(1, Math.floor(hp / divisor));

export function calculateAutomaticTurnEffects({
  maxHP,
  status = 'none',
  toxicStage = 1,
  weather = '',
  terrain = '',
  types = [],
  ability = '',
  grounded = true
}) {
  if (!Number.isInteger(maxHP) || maxHP < 1) throw new Error('Los PS máximos deben ser un entero positivo.');
  if (!Number.isInteger(toxicStage) || toxicStage < 1 || toxicStage > 15) {
    throw new Error('El contador de intoxicación debe estar entre 1 y 15.');
  }

  const typeSet = new Set(types.map(normalize));
  const abilityId = normalize(ability);
  const isType = (...names) => names.some(name => typeSet.has(normalize(name)));
  const hasAbility = (...names) => names.some(name => abilityId === normalize(name));
  const magicGuard = hasAbility('Magic Guard', 'Muro Mágico');
  const damageParts = [];
  const healingParts = [];

  if (status === 'burn' && !isType('Fire', 'Fuego')) damageParts.push(floorFraction(maxHP, DAMAGE_DIVISORS.burn));
  if (status === 'poison' && !isType('Poison', 'Veneno', 'Steel', 'Acero')) damageParts.push(floorFraction(maxHP, DAMAGE_DIVISORS.poison));
  if (status === 'badly-poisoned' && !isType('Poison', 'Veneno', 'Steel', 'Acero')) {
    damageParts.push(floorFraction(maxHP, DAMAGE_DIVISORS.badlyPoisonedBase / toxicStage));
  }

  if (weather === 'Sand' && !isType('Rock', 'Roca', 'Ground', 'Tierra', 'Steel', 'Acero') &&
      !hasAbility('Overcoat', 'Funda', 'Sand Force', 'Poder Arena', 'Sand Rush', ' ímpetu Arena', 'Sand Veil', 'Velo Arena')) {
    damageParts.push(floorFraction(maxHP, DAMAGE_DIVISORS.sandstorm));
  }
  if (weather === 'Sun' || weather === 'Harsh Sunshine') {
    if (hasAbility('Solar Power', 'Poder Solar')) damageParts.push(floorFraction(maxHP, DAMAGE_DIVISORS.solarPower));
    if (hasAbility('Dry Skin', 'Piel Seca') && !isType('Fire', 'Fuego')) {
      damageParts.push(floorFraction(maxHP, DAMAGE_DIVISORS.drySkinSun));
    }
  }
  if (weather === 'Rain') {
    if (hasAbility('Rain Dish', 'Cura Lluvia')) healingParts.push(floorFraction(maxHP, HEAL_DIVISORS.rainDish));
    if (hasAbility('Dry Skin', 'Piel Seca')) healingParts.push(floorFraction(maxHP, HEAL_DIVISORS.drySkinRain));
  }
  if (weather === 'Snow' && hasAbility('Ice Body', 'Gélido')) {
    healingParts.push(floorFraction(maxHP, HEAL_DIVISORS.iceBodySnow));
  }
  if (terrain === 'Grassy' && grounded) {
    healingParts.push(floorFraction(maxHP, HEAL_DIVISORS.grassyTerrain));
  }

  return {
    residualDamage: magicGuard ? 0 : damageParts.reduce((sum, value) => sum + value, 0),
    recovery: healingParts.reduce((sum, value) => sum + value, 0),
    damageParts: magicGuard ? [] : damageParts,
    healingParts,
    notes: [
      ...(status !== 'none' ? [status] : []),
      ...(weather === 'Sand' ? ['sandstorm'] : []),
      ...(weather === 'Sun' || weather === 'Harsh Sunshine' ? ['sun'] : []),
      ...(weather === 'Rain' ? ['rain'] : []),
      ...(weather === 'Snow' ? ['snow'] : []),
      ...(terrain === 'Grassy' && grounded ? ['grassy-terrain'] : [])
    ]
  };
}
