// Fixed-point arithmetic primitives used throughout the damage pipeline.
//
// The games do essentially all damage math in 16.12 fixed point: a modifier of
// 1.5x is stored as 6144 (1.5 * 4096), modifiers are chained by multiplying and
// re-rounding against 4096, and the result is applied with a "round half down"
// rule rather than JavaScript's round-half-up. Getting these two details wrong is
// the usual source of off-by-one damage rolls, so they live in one place.

/** The 1.0x modifier in 16.12 fixed point. */
export const NEUTRAL = 4096;

/** Round half *down* — the rounding rule the games use after every modifier. */
export function pokeRound(n) {
  return n % 1 > 0.5 ? Math.ceil(n) : Math.floor(n);
}

/** Simulate the games' 32-bit unsigned overflow on intermediate products. */
export function toU32(n) {
  return n >>> 0 === n ? n : n % 4294967296;
}

/**
 * Chain several modifiers together the way the games do.
 *
 * Each modifier is folded in one at a time and re-rounded against 4096, so
 * chaining is *not* the same as multiplying the floats and rounding once.
 */
export function chainMods(mods, min = 1, max = 594137) {
  let modifier = NEUTRAL;
  for (const mod of mods) {
    if (mod === NEUTRAL) continue;
    modifier = (modifier * mod + 2048) >> 12;
  }
  return Math.max(min, Math.min(max, modifier));
}

/** Apply a 16.12 modifier to a value, rounding half down. */
export function applyMod(value, mod) {
  return pokeRound((value * mod) / NEUTRAL);
}

/** Convert a float multiplier (1.3) into a 16.12 modifier (5325). */
export const mod = (x) => Math.round(x * NEUTRAL);

/** Normalise a name into the id form used as a dataset key. */
export function toID(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}
