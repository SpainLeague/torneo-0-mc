// Exhaustive Champions Stat Point search primitives.
// A legal spread has six integer allocations, 0..32 each, using exactly 66 PC by default.
// The evaluator must return {score, details?, failures?}; higher score is better.
// This module deliberately does not invent damage estimates: connect a verified
// damage evaluator before using findBestSpreads for competitive recommendations.

export function* enumerateStatPointSpreads(maxTotal = 66, {exactTotal = true} = {}) {
  if (!Number.isInteger(maxTotal) || maxTotal < 0 || maxTotal > 66) {
    throw new Error('El máximo total de PC debe estar entre 0 y 66.');
  }
  const points = [0, 0, 0, 0, 0, 0];
  function* visit(index, remaining) {
    if (index === 5) {
      if (exactTotal) {
        if (remaining <= 32) {
          points[index] = remaining;
          yield points.slice();
        }
      } else {
        for (let value = 0; value <= Math.min(32, remaining); value++) {
          points[index] = value;
          yield points.slice();
        }
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
 * Exhaustively evaluates distributions using exactly maxTotal PC by default.
 * Set exactTotal:false to include lower totals. Each objective is expected to
 * contribute equally; evaluator returns a normalized score in [0, 1].
 */
export function findBestSpreads({
  evaluate,
  maxTotal = 66,
  top = 3,
  exactTotal = true,
  shouldCancel = () => false,
  onProgress = () => {},
  progressEvery = 100000
}) {
  if (typeof evaluate !== 'function') throw new Error('Falta la función evaluadora.');
  if (!Number.isInteger(top) || top < 1) throw new Error('top debe ser un entero positivo.');
  if (!Number.isInteger(progressEvery) || progressEvery < 1) throw new Error('progressEvery debe ser un entero positivo.');
  const best = [];
  let evaluated = 0;
  for (const points of enumerateStatPointSpreads(maxTotal, {exactTotal})) {
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


// Exact combinatorial count, useful to estimate the cost before starting a search.
export function countStatPointSpreads(total = 66, exactTotal = true) {
  if (!Number.isInteger(total) || total < 0 || total > 66) {
    throw new Error('El total de PC debe estar entre 0 y 66.');
  }
  const ways = Array(total + 1).fill(0);
  ways[0] = 1;
  for (let stat = 0; stat < 6; stat++) {
    const next = Array(total + 1).fill(0);
    for (let sum = 0; sum <= total; sum++) {
      if (!ways[sum]) continue;
      for (let value = 0; value <= Math.min(32, total - sum); value++) {
        next[sum + value] += ways[sum];
      }
    }
    for (let i = 0; i <= total; i++) ways[i] = next[i];
  }
  return exactTotal ? ways[total] : ways.reduce((sum, value) => sum + value, 0);
}
