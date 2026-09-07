/**
 * Seeded PRNG (mulberry32). Math.random is banned in gameplay and visuals —
 * use ctx.rng (and .fork() for independent streams) instead.
 *
 * @typedef {object} Rng
 * @property {number} seed
 * @property {() => number} next          // [0, 1)
 * @property {(min?: number, max?: number) => number} float
 * @property {(min: number, max: number) => number} int  // inclusive
 * @property {() => boolean} bool
 * @property {() => Rng} fork
 * @property {<T>(arr: T[]) => T} pick
 */

/**
 * @param {number} seed
 * @returns {Rng}
 */
export function createRng(seed) {
  let s = seed >>> 0;

  function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** @type {Rng} */
  const rng = {
    get seed() {
      return seed;
    },
    next,
    float(min = 0, max = 1) {
      return min + next() * (max - min);
    },
    int(min, max) {
      // inclusive both ends
      return (min + Math.floor(next() * (max - min + 1))) | 0;
    },
    bool() {
      return next() < 0.5;
    },
    fork(name) {
      if (name !== undefined) {
        if (typeof name !== 'string' || !name.length) throw new Error('RNG stream name must be nonempty');
        let hash = seed ^ 0x811c9dc5;
        for (let i = 0; i < name.length; i++) hash = Math.imul(hash ^ name.charCodeAt(i), 0x01000193);
        return createRng(hash >>> 0);
      }
      // Derive a child seed from the parent stream so forks are deterministic.
      const child = (Math.imul(s ^ 0x9e3779b9, 0x85ebca6b) ^ ((next() * 0x100000000) >>> 0)) >>> 0;
      return createRng(child || 1);
    },
    pick(arr) {
      if (arr.length === 0) {
        throw new Error('rng.pick: empty array');
      }
      return arr[(next() * arr.length) | 0];
    },
  };

  return rng;
}
