import {normalizeId} from './optimizador-data.js';

export function calculateEffectiveSpeed(baseSpeed, {
  ability = '',
  itemId = '',
  weather = '',
  terrain = '',
  tailwind = false
} = {}) {
  if (!Number.isInteger(baseSpeed) || baseSpeed < 1) {
    throw new Error('La Velocidad base debe ser un entero positivo.');
  }
  let speed = baseSpeed;
  const abilityId = normalizeId(ability);
  const weatherId = normalizeId(weather);
  const terrainId = normalizeId(terrain);

  if (normalizeId(itemId) === 'choicescarf') speed = Math.floor(speed * 1.5);
  const weatherAbility =
    (abilityId === 'swiftswim' && ['rain','heavyrain'].includes(weatherId)) ||
    (abilityId === 'chlorophyll' && ['sun','harshsunshine'].includes(weatherId)) ||
    (abilityId === 'sandrush' && weatherId === 'sand') ||
    (abilityId === 'slushrush' && ['snow','hail'].includes(weatherId));
  if (weatherAbility || (abilityId === 'surgesurfer' && terrainId === 'electric')) {
    speed *= 2;
  }
  if (tailwind) speed *= 2;
  return speed;
}

export function evaluateSpeedBenchmark(ownSpeed, foeSpeed, {
  relation = 'faster',
  margin = 0
} = {}) {
  if (!Number.isInteger(ownSpeed) || ownSpeed < 1 ||
      !Number.isInteger(foeSpeed) || foeSpeed < 1) {
    throw new Error('Las Velocidades comparadas deben ser enteros positivos.');
  }
  if (!Number.isInteger(margin) || margin < 0) {
    throw new Error('El margen de Velocidad debe ser un entero no negativo.');
  }
  if (!['faster','slower'].includes(relation)) {
    throw new Error('La relación de Velocidad debe ser faster o slower.');
  }
  const passed = relation === 'faster'
    ? ownSpeed > foeSpeed + margin
    : ownSpeed < foeSpeed - margin;
  return {passed, ownSpeed, foeSpeed, margin, relation, delta:ownSpeed-foeSpeed};
}
