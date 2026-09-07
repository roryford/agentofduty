/**
 * Authored tactical anchors for the Kestrel District mission.
 *
 * Coordinates use the engine convention: ground is y=0 and the player advances
 * from south (+Z) toward north (-Z). These exports are deliberately data-only so
 * mission, AI and verification code can inspect them without constructing Three.
 */

export const WORLD_SIZE = 120;
export const NAV_CELL_SIZE = 2;

/** Continuous lot-edge barrier shared by world construction and traversal tests. */
export const WORLD_BOUNDARY = Object.freeze({
  thickness: 0.8,
  height: 3.6,
  baseHeight: 1.05,
  postSpacing: 4,
});

export const WORLD_ENCOUNTERS = Object.freeze([
  Object.freeze({
    id: 'south-checkpoint',
    name: 'South Checkpoint',
    objective: 'Breach the Kestrel checkpoint',
    spawn: Object.freeze({ x: 0, y: 0, z: 48, yaw: 0 }),
    enemySpawns: Object.freeze([
      Object.freeze({ x: -4, z: 31, role: 'holder' }),
      Object.freeze({ x: 4, z: 24, role: 'advancer' }),
      Object.freeze({ x: -6, z: 18, role: 'flanker' }),
    ]),
    exit: Object.freeze({ x: -5, z: 13, radius: 4.5 }),
  }),
  Object.freeze({
    id: 'lantern-court',
    name: 'Lantern Court',
    objective: 'Clear the courtyard and reach the north passage',
    spawn: Object.freeze({ x: -5, y: 0, z: 13, yaw: Math.PI * 0.5 }),
    enemySpawns: Object.freeze([
      Object.freeze({ x: -16, z: 8, role: 'holder' }),
      Object.freeze({ x: -25, z: 1, role: 'flanker' }),
      Object.freeze({ x: -18, z: -9, role: 'advancer' }),
      Object.freeze({ x: -7, z: -7, role: 'holder' }),
    ]),
    exit: Object.freeze({ x: -5, z: -15, radius: 4.5 }),
  }),
  Object.freeze({
    id: 'north-extraction',
    name: 'North Extraction',
    objective: 'Secure and hold the extraction beacon',
    spawn: Object.freeze({ x: -2, y: 0, z: -19, yaw: 0 }),
    enemySpawns: Object.freeze([
      Object.freeze({ x: 5, z: -31, role: 'holder' }),
      Object.freeze({ x: -5, z: -36, role: 'advancer' }),
      Object.freeze({ x: 6, z: -44, role: 'flanker' }),
      Object.freeze({ x: -4, z: -49, role: 'holder' }),
    ]),
    exit: Object.freeze({ x: 0, z: -52, radius: 5.5 }),
  }),
]);

/** Cover anchors are standing positions beside cover, never prop centres. */
export const WORLD_COVER_POINTS = Object.freeze([
  Object.freeze({ id: 'south-car-left', x: -3, z: 39, height: 1.35 }),
  Object.freeze({ id: 'south-barrier-right', x: 3, z: 34, height: 1.0 }),
  Object.freeze({ id: 'checkpoint-booth', x: 6, z: 27, height: 1.45 }),
  Object.freeze({ id: 'checkpoint-divider', x: -2, z: 24, height: 1.0 }),
  Object.freeze({ id: 'alley-dumpster', x: -9, z: 15, height: 1.25 }),
  Object.freeze({ id: 'court-crates-south', x: -16, z: 11, height: 1.1 }),
  Object.freeze({ id: 'court-van', x: -23, z: 6, height: 1.45 }),
  Object.freeze({ id: 'court-planter', x: -14, z: 1, height: 0.9 }),
  Object.freeze({ id: 'court-dumpster', x: -26, z: -6, height: 1.25 }),
  Object.freeze({ id: 'court-crates-north', x: -17, z: -12, height: 1.1 }),
  Object.freeze({ id: 'north-passage', x: -7, z: -16, height: 1.0 }),
  Object.freeze({ id: 'north-car-right', x: 3, z: -25, height: 1.35 }),
  Object.freeze({ id: 'north-barrier-left', x: -3, z: -31, height: 1.0 }),
  Object.freeze({ id: 'north-kiosk', x: 6, z: -37, height: 1.45 }),
  Object.freeze({ id: 'extract-barrier', x: -3, z: -44, height: 1.0 }),
  Object.freeze({ id: 'extract-crates', x: 4, z: -48, height: 1.15 }),
]);

/**
 * Broad authored navigation mask. Static colliders refine this during world init.
 * The two 6m passages make the road and west courtyard a connected loop.
 */
export function isInPlayableRegion(x, z) {
  const mainStreet = Math.abs(x) <= 9.6 && z >= -58 && z <= 58;
  const courtyard = x >= -29 && x <= -8 && z >= -16 && z <= 16;
  const southPassage = x >= -29 && x <= 9.6 && z >= 10 && z <= 16;
  const northPassage = x >= -29 && x <= 9.6 && z >= -16 && z <= -10;
  return mainStreet || courtyard || southPassage || northPassage;
}

/** Private visual/collider placement paired with the public cover anchors. */
export const COVER_PROPS = Object.freeze([
  { id: 'south-car-left', type: 'car', x: -5.4, z: 39, yaw: 0 },
  { id: 'south-barrier-right', type: 'barrier', x: 5.2, z: 34, yaw: 0.08 },
  { id: 'checkpoint-booth', type: 'booth', x: 8.2, z: 27, yaw: 0 },
  { id: 'checkpoint-divider', type: 'barrier', x: -4.2, z: 24, yaw: -0.08 },
  { id: 'alley-dumpster', type: 'dumpster', x: -11.2, z: 15, yaw: Math.PI * 0.5 },
  { id: 'court-crates-south', type: 'crates', x: -18.2, z: 11, yaw: 0.1 },
  { id: 'court-van', type: 'car', x: -25, z: 3.4, yaw: Math.PI * 0.5 },
  { id: 'court-planter', type: 'planter', x: -14, z: -1.2, yaw: 0 },
  { id: 'court-dumpster', type: 'dumpster', x: -27.2, z: -8.2, yaw: 0 },
  { id: 'court-crates-north', type: 'crates', x: -19.2, z: -12, yaw: -0.1 },
  { id: 'north-passage', type: 'barrier', x: -9.2, z: -16, yaw: 0 },
  { id: 'north-car-right', type: 'car', x: 5.4, z: -25, yaw: 0 },
  { id: 'north-barrier-left', type: 'barrier', x: -5.2, z: -31, yaw: -0.08 },
  { id: 'north-kiosk', type: 'booth', x: 8.2, z: -37, yaw: 0 },
  { id: 'extract-barrier', type: 'barrier', x: -5.2, z: -44, yaw: 0.08 },
  { id: 'extract-crates', type: 'crates', x: 6.2, z: -48, yaw: 0 },
]);
