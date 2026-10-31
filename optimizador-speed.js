import {normalizeId} from './optimizador-data.js';

export function calculateEffectiveSpeed(baseSpeed, {
  ability = '',
  itemId = '',
  weather = '',
  terrain = '',
  tailwind = false,
  speedStage = 0,
  paralyzed = false
} = {}) {
  if (!Number.isInteger(baseSpeed) || baseSpeed < 1) {
    throw new Error('La Velocidad base debe ser un entero positivo.');
  }
  if (!Number.isInteger(speedStage) || speedStage < -6 || speedStage > 6) throw new Error('La etapa de Velocidad debe estar entre -6 y +6.');
  let speed = speedStage >= 0
    ? Math.floor(baseSpeed * (2 + speedStage) / 2)
    : Math.floor(baseSpeed * 2 / (2 - speedStage));
  const abilityKey = normalizeId(ability);
  const abilityId = ({
    nadorapido:'swiftswim',
    clorofila:'chlorophyll',
    impetusarena:'sandrush',
    quitanieves:'slushrush',
    colasurf:'surgesurfer',
    piesrapidos:'quickfeet'
  })[abilityKey] ?? abilityKey;
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
  if (paralyzed) speed = abilityId === 'quickfeet' ? Math.floor(speed * 1.5) : Math.floor(speed / 2);
  return Math.max(1,speed);
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
