// Exact bounded enumeration for small PC optimization scenarios.
// Variable stats are enumerated while all other stats remain fixed to the seed.
export function enumerateLegalPcSpreads({
  start,
  variableStats,
  maxCandidates = 50000,
  shouldCancel = () => false
}) {
  if (!Array.isArray(start) || start.length !== 6 ||
      start.some(value => !Number.isInteger(value) || value < 0 || value > 32) ||
      start.reduce((sum, value) => sum + value, 0) > 66) {
    throw new Error('El reparto inicial debe respetar los límites de PC de Champions.');
  }
  if (!Array.isArray(variableStats) || !variableStats.length ||
      variableStats.some(index => !Number.isInteger(index) || index < 0 || index > 5)) {
    throw new Error('variableStats debe contener índices de estadísticas válidos.');
  }
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1) {
    throw new Error('maxCandidates debe ser un entero positivo.');
  }

  const stats = [...new Set(variableStats)].sort((a,b) => a-b);
  const fixed = start.slice();
  const variableTotal = stats.reduce((sum,index) => sum + fixed[index], 0);
  stats.forEach(index => { fixed[index] = 0; });
  const results = [];
  let truncated = false;
  let cancelled = false;

  function visit(position, remaining, points) {
    if (shouldCancel()) { cancelled = true; return; }
    if (results.length >= maxCandidates) { truncated = true; return; }
    if (position === stats.length - 1) {
      if (remaining < 0 || remaining > 32) return;
      const candidate = points.slice();
      candidate[stats[position]] = remaining;
      results.push(candidate);
      return;
    }
    const stat = stats[position];
    const laterCapacity = (stats.length - position - 1) * 32;
    const minimum = Math.max(0, remaining - laterCapacity);
    const maximum = Math.min(32, remaining);
    for (let value = minimum; value <= maximum; value++) {
      points[stat] = value;
      visit(position + 1, remaining - value, points);
      if (truncated || cancelled) return;
    }
  }

  visit(0, variableTotal, fixed.slice());
  return {results, evaluated: results.length, truncated, cancelled, variableStats: stats};
}

export function evaluateExhaustivePcSpreads(options) {
  const {evaluate, top = 1, ...enumerationOptions} = options ?? {};
  if (typeof evaluate !== 'function') throw new Error('Falta la función evaluadora.');
  if (!Number.isInteger(top) || top < 1) throw new Error('top debe ser un entero positivo.');
  const enumeration = enumerateLegalPcSpreads(enumerationOptions);
  const ranked = enumeration.results.map(points => {
    const result = evaluate(points.slice());
    if (!result || !Number.isFinite(result.score) || result.score < 0 || result.score > 1) {
      throw new Error('El evaluador debe devolver un score finito entre 0 y 1.');
    }
    return {points, ...result};
  }).sort((a,b) => b.score-a.score || a.points.join(',').localeCompare(b.points.join(',')));
  return {...enumeration, results: ranked.slice(0,top)};
}
