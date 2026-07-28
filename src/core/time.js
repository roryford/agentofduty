/**
 * @typedef {object} TimeState
 * @property {number} fixedDt     // fixed step h (1/120)
 * @property {number} fixedHz
 * @property {number} dt          // variable display dt (seconds)
 * @property {number} elapsed     // total simulated display time
 * @property {number} alpha       // render interpolation [0,1] between physics ticks
 * @property {number} frame       // display frame index
 * @property {number} fixedFrame  // fixed-step tick index
 * @property {number} accumulator // leftover time toward next fixed step
 */

/**
 * @param {number} fixedHz
 * @returns {TimeState}
 */
export function createTime(fixedHz = 120) {
  return {
    fixedDt: 1 / fixedHz,
    fixedHz,
    dt: 0,
    elapsed: 0,
    alpha: 0,
    frame: 0,
    fixedFrame: 0,
    accumulator: 0,
  };
}
