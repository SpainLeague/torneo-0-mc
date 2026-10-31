// Bounded local search for Champions PC spreads.
// This is a heuristic optimizer, not an exhaustive scan of all legal allocations.
// It keeps the selected nature, ability, item and opponent configuration fixed.

export function isLegalPcSpread(points, {exactTotal = false} = {}) {
  return Array.isArray(points) && points.length === 6 &&
    points.every(value => Number.isInteger(value) && value >= 0 && value <= 32) &&
    points.reduce((sum, value) => sum + value, 0) <= 66 &&
    (!exactTotal || points.reduce((sum, value) => sum + value, 0) === 66);
}

function keyOf(points) {
  return points.join(',');
}

function comparePoints(a, b) {
  for (let i = 0; i < 6; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function neighbours(points) {
  const output = [];
  for (let from = 0; from < 6; from++) {
    if (points[from] === 0) continue;
    for (let to = 0; to < 6; to++) {
      if (from === to || points[to] === 32) continue;
      const next = points.slice();
      next[from]--;
      next[to]++;
      output.push(next);
    }
  }
  return output;
}

function insertTop(results, candidate, top) {
  const previous = results.findIndex(item => keyOf(item.points) === keyOf(candidate.points));
  if (previous >= 0) {
    if (results[previous].score >= candidate.score) return;
    results.splice(previous, 1);
  }
  let position = results.findIndex(item =>
    candidate.score > item.score ||
    (candidate.score === item.score && comparePoints(candidate.points, item.points) < 0)
  );
  if (position < 0) position = results.length;
  results.splice(position, 0, candidate);
  if (results.length > top) results.pop();
}

/**
 * Improve each supplied seed by repeatedly testing every one-point transfer
 * between stats. Evaluation is cached across seeds. A seed is retained as a
 * result even if no neighbor improves it.
 */
export async function findBestLocalSpreads({
  starts,
  evaluate,
  top = 3,
  maxIterations = 4,
  shouldCancel = () => false,
  onProgress = () => {},
  yieldControl = () => new Promise(resolve => setTimeout(resolve, 0))
}) {
  if (typeof evaluate !== 'function') throw new Error('Falta la función evaluadora.');
  if (!Array.isArray(starts) || !starts.length) throw new Error('Se necesita al menos un reparto inicial.');
  if (!Number.isInteger(top) || top < 1) throw new Error('top debe ser un entero positivo.');
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 20) {
    throw new Error('maxIterations debe estar entre 1 y 20.');
  }

  const uniqueStarts = [...new Map(starts.filter(points => isLegalPcSpread(points))
    .map(points => [keyOf(points), points.slice()])).values()];
  if (!uniqueStarts.length) throw new Error('No hay repartos iniciales válidos.');

  const cache = new Map();
  const best = [];
  let evaluated = 0;
  let completedSeeds = 0;

  const score = points => {
    const key = keyOf(points);
    if (cache.has(key)) return cache.get(key);
    const result = evaluate(points.slice());
    if (!result || !Number.isFinite(result.score) || result.score < 0 || result.score > 1) {
      throw new Error('El evaluador debe devolver un score finito entre 0 y 1.');
    }
    const candidate = {points: points.slice(), ...result};
    cache.set(key, candidate);
    evaluated++;
    insertTop(best, candidate, top);
    return candidate;
  };

  for (const seed of uniqueStarts) {
    if (shouldCancel()) return {cancelled: true, evaluated, results: best, completedSeeds};
    let current = score(seed);

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (shouldCancel()) return {cancelled: true, evaluated, results: best, completedSeeds};
      let nextBest = current;
      for (const next of neighbours(current.points)) {
        if (shouldCancel()) return {cancelled: true, evaluated, results: best, completedSeeds};
        const candidate = score(next);
        if (candidate.score > nextBest.score ||
          (candidate.score === nextBest.score && comparePoints(candidate.points, nextBest.points) < 0)) {
          nextBest = candidate;
        }
      }
      if (nextBest === current) break;
      current = nextBest;
    }

    completedSeeds++;
    onProgress({evaluated, completedSeeds, totalSeeds: uniqueStarts.length, results: best.slice()});
    await yieldControl();
  }

  return {cancelled: false, evaluated, results: best, completedSeeds};
}
