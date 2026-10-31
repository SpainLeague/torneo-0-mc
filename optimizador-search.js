// Exhaustive Champions Stat Point search primitives.
// A valid spread has six integer allocations, 0..32 each, with a total <= 66.
// The evaluator must return {score, details?, failures?}; higher score is better.
// This module deliberately does not invent damage estimates: connect a verified
// damage evaluator before using findBestSpreads for competitive recommendations.

export function* enumerateStatPointSpreads(maxTotal = 66) {
  if (!Number.isInteger(maxTotal) || maxTotal < 0 || maxTotal > 66) {
    throw new Error('El máximo total de PC debe estar entre 0 y 66.');
  }
  const points = [0, 0, 0, 0, 0, 0];
  function* visit(index, remaining) {
    if (index === 5) {
      for (let value = 0; value <= Math.min(32, remaining); value++) {
        points[index] = value;
        yield points.slice();
      }
      return;
    }
    for (let value = 0; value <= Math.min(32, remaining); value++) {
      points[index] = value;
      yield* visit(index + 1, remaining - value);
    }
  }
  yield* visit(0, maxTotal);
}

export function validateSpread(spread) {
  return Array.isArray(spread) && spread.length === 6 &&
    spread.every(value => Number.isInteger(value) && value >= 0 && value <= 32) &&
    spread.reduce((sum, value) => sum + value, 0) <= 66;
}

/**
 * Exhaustively evaluates every legal distribution up to maxTotal.
 * Each objective is expected to contribute equally; evaluator owns the
 * probability/threshold calculation and returns a normalized score in [0, 1].
 */
export function findBestSpreads({
  evaluate,
  maxTotal = 66,
  top = 3,
  shouldCancel = () => false,
  onProgress = () => {},
  progressEvery = 100000
}) {
  if (typeof evaluate !== 'function') throw new Error('Falta la función evaluadora.');
  if (!Number.isInteger(top) || top < 1) throw new Error('top debe ser un entero positivo.');
  const best = [];
  let evaluated = 0;
  for (const points of enumerateStatPointSpreads(maxTotal)) {
    if (shouldCancel()) return {cancelled: true, evaluated, results: best};
    const result = evaluate(points);
    if (!result || !Number.isFinite(result.score)) {
      throw new Error('El evaluador debe devolver un score numérico finito.');
    }
    if (result.score < 0 || result.score > 1) {
      throw new Error('El score debe estar normalizado entre 0 y 1.');
    }
    evaluated++;
    const candidate = {points, ...result};
    let position = best.findIndex(item => candidate.score > item.score);
    if (position < 0) position = best.length;
    best.splice(position, 0, candidate);
    if (best.length > top) best.pop();
    if (evaluated % progressEvery === 0) onProgress({evaluated, best: best.slice()});
  }
  onProgress({evaluated, best: best.slice(), complete: true});
  return {cancelled: false, evaluated, results: best};
}
