/**
 * Input surface for ctx.input. Phase 0: preallocated state only.
 * Gameplay systems write/read this; no Math.random, no per-frame alloc.
 */

export function createInput() {
  /** @type {Record<string, boolean>} */
  const keys = Object.create(null);
  /** @type {Record<number, boolean>} */
  const buttons = Object.create(null);

  const mouse = {
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
    wheel: 0,
    locked: false,
  };

  // Preallocated look deltas consumed by player (Phase 1+).
  const look = { dx: 0, dy: 0 };

  // Movement axes in [-1, 1], set by player input mapping later.
  const move = { x: 0, y: 0 };

  return {
    keys,
    buttons,
    mouse,
    look,
    move,
    /** True when pointer is locked / game has focus for FPS control. */
    active: false,

    /** Reset per-frame ephemeral deltas. Called by engine after update. */
    endFrame() {
      mouse.dx = 0;
      mouse.dy = 0;
      mouse.wheel = 0;
      look.dx = 0;
      look.dy = 0;
    },

    reset() {
      for (const k of Object.keys(keys)) delete keys[k];
      for (const b of Object.keys(buttons)) delete buttons[Number(b)];
      mouse.x = 0;
      mouse.y = 0;
      mouse.dx = 0;
      mouse.dy = 0;
      mouse.wheel = 0;
      mouse.locked = false;
      look.dx = 0;
      look.dy = 0;
      move.x = 0;
      move.y = 0;
      this.active = false;
    },
  };
}
