/**
 * Canonical surface tags. Physics stamps these on every collider;
 * fx / audio / decals branch on them later.
 */
export const SURFACES = Object.freeze({
  concrete: 'concrete',
  metal: 'metal',
  wood: 'wood',
  dirt: 'dirt',
  sand: 'sand',
  glass: 'glass',
  water: 'water',
  foliage: 'foliage',
  fabric: 'fabric',
  flesh: 'flesh',
  rubber: 'rubber',
  plaster: 'plaster',
});

export const SURFACE_LIST = Object.freeze(Object.values(SURFACES));
