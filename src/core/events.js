/**
 * Minimal typed event bus. Cross-subsystem coupling goes through ctx.events only.
 * Canonical event registry lives in the project contract; adding a new event
 * requires a registry row in the same commit.
 */

/** @typedef {(payload: any) => void} EventHandler */

export function createEvents() {
  /** @type {Map<string, EventHandler[]>} */
  const listeners = new Map();
  /** Reused empty list to avoid per-emit allocation when no listeners. */
  const EMPTY = Object.freeze([]);

  return {
    /**
     * @param {string} type
     * @param {EventHandler} handler
     * @returns {() => void} unsubscribe
     */
    on(type, handler) {
      let list = listeners.get(type);
      if (!list) {
        list = [];
        listeners.set(type, list);
      }
      list.push(handler);
      return () => {
        const i = list.indexOf(handler);
        if (i >= 0) list.splice(i, 1);
      };
    },

    /**
     * @param {string} type
     * @param {EventHandler} handler
     */
    off(type, handler) {
      const list = listeners.get(type);
      if (!list) return;
      const i = list.indexOf(handler);
      if (i >= 0) list.splice(i, 1);
    },

    /**
     * @param {string} type
     * @param {any} [payload]
     */
    emit(type, payload) {
      const list = listeners.get(type);
      if (!list || list.length === 0) return;
      // Snapshot length so handlers can unsubscribe mid-emit safely.
      const n = list.length;
      for (let i = 0; i < n; i++) {
        const h = list[i];
        if (h) h(payload);
      }
    },

    /**
     * @param {string} type
     * @returns {readonly EventHandler[]}
     */
    listeners(type) {
      return listeners.get(type) ?? EMPTY;
    },

    clear() {
      listeners.clear();
    },
  };
}
