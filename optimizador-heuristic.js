// Bounded beam search for Champions PC spreads.
// This is not an exhaustive scan of every legal allocation.
// It explores several promising neighboring spreads using coarse-to-fine
// PC transfers (8, 4, 2, 1), avoiding a one-point-only search bottleneck.

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

function neighbours(points, activeStats, transferStep, statBreakpoints) {
  const output = new Map();
  for (const to of activeStats) {
    // Jump exactly to the next real stat increase. Nature rounding means that
    // the useful PC delta is not constant.
    const nextBreakpoint = (statBreakpoints[to] ?? []).find(entry =>
      Number.isInteger(entry.points) && entry.points > points[to]
    );
    const targetDelta = nextBreakpoint ? nextBreakpoint.points - points[to] : null;

    for (let from = 0; from < 6; from++) {
      if (from === to || points[from] < 1) continue;

      // Keep one-PC moves available in every pass, including coarse passes.
      // A useful gradual improvement (for example, Speed) must not depend on
      // crossing a stat breakpoint or waiting for the final fine-grained pass.
      const amounts = new Set([1, transferStep]);
      if (targetDelta) amounts.add(targetDelta);

      // PC above the last breakpoint has no effect on the source stat. Allow
      // the search to reclaim those points without sacrificing an actual stat
      // increase, and combine them with a destination breakpoint when possible.
      const sourceBreakpoints = statBreakpoints[from];
      const previousBreakpoint = Array.isArray(sourceBreakpoints)
        ? sourceBreakpoints.reduce((latest, entry) =>
          Number.isInteger(entry.points) && entry.points <= points[from] &&
          (!latest || entry.points > latest.points) ? entry : latest, null)
        : null;
      const freeSourcePc = Array.isArray(sourceBreakpoints)
        ? points[from] - (previousBreakpoint?.points ?? 0)
        : 0;
      if (freeSourcePc > 0) {
        amounts.add(freeSourcePc);
        if (targetDelta) amounts.add(Math.min(freeSourcePc, targetDelta));
      }

      for (const amount of amounts) {
        if (!Number.isInteger(amount) || amount < 1 || amount > 32 ||
            amount > points[from] || points[to] + amount > 32) continue;
        const next = points.slice();
        next[from] -= amount;
        next[to] += amount;
        output.set(keyOf(next), next);
      }
    }
  }
  return [...output.values()];
}

function compareCandidates(a, b) {
  return b.score - a.score || comparePoints(a.points, b.points);
}

function selectDiverseCandidates(candidates, top, minimumDistance) {
  const ranked = candidates.slice().sort(compareCandidates);
  const selected = [];
  const distance = (a,b) => a.reduce((sum,value,index) => sum + Math.abs(value-b[index]), 0);
  for (const candidate of ranked) {
    if (selected.every(existing => distance(existing.points,candidate.points) >= minimumDistance)) {
      selected.push(candidate);
      if (selected.length === top) return selected;
    }
  }
  // If the explored neighborhood is too small, return the remaining best
  // distinct candidates rather than silently returning fewer than available.
  for (const candidate of ranked) {
    if (!selected.some(existing => keyOf(existing.points) === keyOf(candidate.points))) {
      selected.push(candidate);
      if (selected.length === top) break;
    }
  }
  return selected;
}

function insertTop(results, candidate, top) {
  const previous = results.findIndex(item => keyOf(item.points) === keyOf(candidate.points));
  if (previous >= 0) {
    if (results[previous].score >= candidate.score) return;
    results.splice(previous, 1);
  }
  let position = results.findIndex(item => compareCandidates(candidate, item) < 0);
  if (position < 0) position = results.length;
  results.splice(position, 0, candidate);
  if (results.length > top) results.pop();
}

/**
 * Search a bounded beam of promising legal spreads. All seeds and candidates
 * share one evaluation cache. Beam width controls exploration breadth; it does
 * not imply a global optimum guarantee.
 */
export async function findBestLocalSpreads({
  starts,
  evaluate,
  top = 3,
  maxIterations = 4,
  beamWidth = 8,
  shouldCancel = () => false,
  onProgress = () => {},
  yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)),
  activeStats = [0, 1, 2, 3, 4, 5],
  transferSteps = [8, 4, 2, 1],
  statBreakpoints = [],
  diversityDistance = 4
}) {
  if (typeof evaluate !== 'function') throw new Error('Falta la función evaluadora.');
  if (!Array.isArray(starts) || !starts.length) throw new Error('Se necesita al menos un reparto inicial.');
  if (!Number.isInteger(top) || top < 1) throw new Error('top debe ser un entero positivo.');
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 20) {
    throw new Error('maxIterations debe estar entre 1 y 20.');
  }
  if (!Array.isArray(activeStats) || activeStats.some(stat => !Number.isInteger(stat) || stat < 0 || stat > 5)) {
    throw new Error('activeStats debe contener índices de estadísticas entre 0 y 5.');
  }
  activeStats = [...new Set(activeStats)];
  if (!Array.isArray(transferSteps) || !transferSteps.length ||
      transferSteps.some(step => !Number.isInteger(step) || step < 1 || step > 32)) {
    throw new Error('transferSteps debe contener enteros entre 1 y 32.');
  }
  transferSteps = transferSteps.slice(0, 20);
  if (!Array.isArray(statBreakpoints) || statBreakpoints.length > 6 ||
      statBreakpoints.some(list => list !== undefined && (!Array.isArray(list) ||
        list.some(entry => !entry || !Number.isInteger(entry.points) || entry.points < 1 || entry.points > 32)))) {
    throw new Error('statBreakpoints debe contener umbrales de PC válidos por estadística.');
  }
  const appliedTransferSteps = Array.from({length: maxIterations}, (_, index) =>
    transferSteps[Math.min(index, transferSteps.length - 1)]
  );
  const lastScheduledStepIndex = Math.min(maxIterations, transferSteps.length) - 1;
  if (!Number.isInteger(diversityDistance) || diversityDistance < 0 || diversityDistance > 192) {
    throw new Error('diversityDistance debe estar entre 0 y 192.');
  }
  if (!Number.isInteger(beamWidth) || beamWidth < 1 || beamWidth > 32) {
    throw new Error('beamWidth debe estar entre 1 y 32.');
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

  let beam = [];
  for (const seed of uniqueStarts) {
    if (shouldCancel()) return {cancelled: true, evaluated, results: best, completedSeeds, transferSteps: appliedTransferSteps};
    beam.push(score(seed));
    completedSeeds++;
  }
  beam = [...new Map(beam.map(candidate => [keyOf(candidate.points), candidate])).values()]
    .sort(compareCandidates).slice(0, beamWidth);
  onProgress({evaluated, completedSeeds: 0, totalSeeds: maxIterations, results: best.slice(), beamWidth,
    transferStep: appliedTransferSteps[0]});

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (shouldCancel()) return {cancelled: true, evaluated, results: best, completedSeeds: iteration,
      transferSteps: appliedTransferSteps};
    const transferStep = appliedTransferSteps[iteration];
    const candidates = new Map(beam.map(candidate => [keyOf(candidate.points), candidate]));
    for (const current of beam) {
      for (const next of neighbours(current.points, activeStats, transferStep, statBreakpoints)) {
        if (shouldCancel()) return {cancelled: true, evaluated, results: best, completedSeeds: iteration, transferSteps: appliedTransferSteps};
        const candidate = score(next);
        candidates.set(keyOf(candidate.points), candidate);
      }
    }
    const nextBeam = [...candidates.values()].sort(compareCandidates).slice(0, beamWidth);
    const unchanged = nextBeam.every((candidate, index) =>
      keyOf(candidate.points) === keyOf(beam[index]?.points));
    beam = nextBeam;
    completedSeeds = iteration + 1;
    onProgress({evaluated, completedSeeds, totalSeeds: maxIterations, results: best.slice(), beamWidth, transferStep});
    await yieldControl();
    // Do not stop on a plateau before trying the smaller transfer steps.
    if (unchanged && iteration >= lastScheduledStepIndex) break;
  }

  const diverseResults = selectDiverseCandidates([...cache.values()], top, diversityDistance);
  return {cancelled: false, evaluated, results: diverseResults, completedSeeds, beamWidth,
    transferSteps: appliedTransferSteps};
}
