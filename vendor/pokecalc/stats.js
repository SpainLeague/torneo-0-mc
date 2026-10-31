// Stat calculation and stat-stage handling.

export const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

/** Numerator/denominator of each stat stage from -6 to +6. */
const BOOST_TABLE = [
  [2, 8], [2, 7], [2, 6], [2, 5], [2, 4], [2, 3],
  [2, 2],
  [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2],
];

/**
 * Champions replaces EVs with Stat Points: 0-32 per stat, 66 across the whole
 * Pokémon, and IVs are gone entirely (every Pokémon is treated as having 31).
 *
 * One SP is exactly eight EVs, which makes Champions' published formulas fall
 * out of the mainline one at Level 50 with 31 IVs:
 *
 *   HP    = Base + 75 + SP
 *   Other = ⌊(Base + 20 + SP) × Nature⌋
 *
 * Expressing SP as EVs keeps the damage engine — and its verification against
 * @smogon/calc — working unchanged.
 */
export const SP_PER_STAT = 32;
export const SP_TOTAL = 66;
export const EVS_PER_SP = 8;
export const CHAMPIONS_IV = 31;

export const spToEVs = (sp) =>
  Object.fromEntries(STATS.map((s) => [s, (sp?.[s] ?? 0) * EVS_PER_SP]));

/** Total Stat Points spent, against the 66 the game allows. */
export const spSpent = (sp) => STATS.reduce((n, s) => n + (sp?.[s] ?? 0), 0);

/**
 * Compute a final stat.
 *
 * Champions auto-levels every Pokémon to 50 in battle, but the level is a
 * parameter so the engine stays usable for other contexts.
 */
export function calcStat(stat, base, iv = 31, ev = 0, level = 50, natureMod = 1) {
  if (base === 1) return 1; // Shedinja
  const common = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100);
  if (stat === 'hp') return common + level + 10;
  return Math.floor((common + 5) * natureMod);
}

/** The 1.1 / 1.0 / 0.9 multiplier a nature applies to a given stat. */
export function natureMultiplier(nature, stat) {
  if (!nature) return 1;
  if (nature.plus === stat && nature.minus !== stat) return 1.1;
  if (nature.minus === stat && nature.plus !== stat) return 0.9;
  return 1;
}

/** Apply a stat stage (-6..+6) to an already-computed stat. */
export function applyBoost(stat, stage) {
  const clamped = Math.max(-6, Math.min(6, stage | 0));
  const [num, den] = BOOST_TABLE[clamped + 6];
  return Math.floor((stat * num) / den);
}

/**
 * Build the full stat line for a set.
 *
 * `boosted` holds the values after stat stages; `raw` holds them before, which is
 * what abilities like Unaware and a critical hit need to fall back to.
 */
export function computeStats(set, speciesStats, natures) {
  const nature = natures[set.nature] ?? null;
  // A set may carry Champions Stat Points or raw EVs; SP wins when both exist.
  const evs = set.sp ? spToEVs(set.sp) : (set.evs ?? {});
  const raw = {};
  const boosted = {};
  STATS.forEach((stat, i) => {
    raw[stat] = calcStat(
      stat,
      speciesStats[i],
      set.ivs?.[stat] ?? CHAMPIONS_IV,
      evs[stat] ?? 0,
      set.level ?? 50,
      natureMultiplier(nature, stat),
    );
    boosted[stat] = stat === 'hp' ? raw[stat] : applyBoost(raw[stat], set.boosts?.[stat] ?? 0);
  });
  return {raw, boosted};
}
