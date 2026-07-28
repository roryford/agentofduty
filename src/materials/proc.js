/**
 * Seeded procedural texture builders. No Math.random — pass an rng with next().
 * Outputs CanvasTexture-ready ImageData / raw RGBA buffers.
 */

/**
 * @param {number} seed
 */
export function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Value noise hash */
function hash2(x, y, seed) {
  let n = Math.imul(x + seed * 374761393, 1103515245) ^ Math.imul(y, 134775813);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n >>> 0) % 10000) / 10000;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise2(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  const u = a + (b - a) * fx;
  const v = c + (d - c) * fx;
  return u + (v - u) * fy;
}

/** Fractal Brownian motion */
export function fbm2(x, y, seed, octaves = 4) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(x * freq, y * freq, seed + i * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * Build RGBA Uint8ClampedArray size*size*4.
 * @param {number} size
 * @param {(u: number, v: number, i: number, j: number) => [number, number, number, number?]} sample
 *   channels in 0–1
 */
export function bakeMap(size, sample) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size;
      const v = j / size;
      const [r, g, b, a = 1] = sample(u, v, i, j);
      const o = (j * size + i) * 4;
      data[o] = clamp255(r * 255);
      data[o + 1] = clamp255(g * 255);
      data[o + 2] = clamp255(b * 255);
      data[o + 3] = clamp255(a * 255);
    }
  }
  return data;
}

function clamp255(x) {
  return x < 0 ? 0 : x > 255 ? 255 : x | 0;
}

/**
 * Derive a tangent-space normal map from a height function (0–1).
 */
export function bakeNormalFromHeight(size, heightFn, strength = 2.5) {
  const data = new Uint8ClampedArray(size * size * 4);
  const inv = 1 / size;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i * inv;
      const v = j * inv;
      const hL = heightFn(u - inv, v);
      const hR = heightFn(u + inv, v);
      const hD = heightFn(u, v - inv);
      const hU = heightFn(u, v + inv);
      let nx = (hL - hR) * strength;
      let ny = (hD - hU) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const o = (j * size + i) * 4;
      data[o] = clamp255((nx * 0.5 + 0.5) * 255);
      data[o + 1] = clamp255((ny * 0.5 + 0.5) * 255);
      data[o + 2] = clamp255((nz * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  return data;
}

/** Wet asphalt: dark, streaky, subtle grit + oil sheen variation in roughness. */
export function genAsphalt(size, seed) {
  const height = (u, v) => {
    const n = fbm2(u * 8, v * 8, seed, 5);
    const grit = fbm2(u * 40, v * 40, seed + 7, 2);
    const cracks = Math.abs(fbm2(u * 3, v * 12, seed + 3, 3) - 0.5) * 2;
    return n * 0.55 + grit * 0.25 + cracks * 0.2;
  };

  const albedo = bakeMap(size, (u, v) => {
    const h = height(u, v);
    // Night wet asphalt that still catches practicals (0.08–0.28)
    const base = 0.09 + h * 0.14;
    const oil = fbm2(u * 2.5, v * 2.5, seed + 11, 3);
    const cool = oil > 0.62 ? 0.04 : 0;
    const r = base * 0.9 + cool * 0.2;
    const g = base * 0.95 + cool * 0.35;
    const b = base + cool * 0.5;
    const wear = Math.pow(fbm2(u * 6, v * 6, seed + 19, 3), 3) * 0.12;
    // Aggregate chips (light flecks)
    const chip = fbm2(u * 50, v * 50, seed + 31, 1);
    const fleck = chip > 0.82 ? 0.08 : 0;
    return [r + wear + fleck, g + wear * 0.95 + fleck * 0.9, b + wear * 0.85 + fleck * 0.7, 1];
  });

  const rough = bakeMap(size, (u, v) => {
    const h = height(u, v);
    // Wet: glossy puddles + medium wet field
    const puddle = fbm2(u * 1.8, v * 1.8, seed + 23, 3);
    let ro = 0.42 - h * 0.14;
    if (puddle > 0.55) ro = 0.08 + (1 - puddle) * 0.12;
    ro = Math.min(0.6, Math.max(0.06, ro));
    return [ro, ro, ro, 1];
  });

  const normal = bakeNormalFromHeight(size, height, 4.0);
  return { albedo, rough, normal, height };
}

/** Vertical concrete façades — isotropic variation (no harsh horizontal banding). */
export function genConcrete(size, seed) {
  const height = (u, v) => {
    const large = fbm2(u * 2.2, v * 2.2, seed, 4);
    const pores = fbm2(u * 22, v * 22, seed + 5, 3);
    // Soft panel grid, not stripes
    const panel = Math.max(
      0,
      0.04 - Math.min(Math.abs(((u * 3) % 1) - 0.5), Math.abs(((v * 2.5) % 1) - 0.5)) * 0.5,
    );
    return large * 0.6 + pores * 0.32 + panel;
  };

  const albedo = bakeMap(size, (u, v) => {
    const h = height(u, v);
    // Mid façade concrete 0.32–0.58, cool gray
    let g = 0.34 + h * 0.2;
    // Local grime blotches (2D, not vertical runs only)
    const grime = fbm2(u * 3.5, v * 3.5, seed + 9, 4);
    if (grime > 0.62) g *= 0.82;
    if (grime < 0.28) g = Math.min(0.62, g + 0.06); // light patches
    // Dirt near "ground" of UV
    g *= 0.92 + v * 0.08;
    // Sharp panel lines
    const su = Math.abs(((u * 3) % 1) - 0.5);
    const sv = Math.abs(((v * 2.5) % 1) - 0.5);
    if (su < 0.012 || sv < 0.012) g *= 0.72;
    // Speckles
    const sp = fbm2(u * 40, v * 40, seed + 17, 1);
    if (sp > 0.78) g += 0.04;
    return [g * 1.02, g * 1.0, g * 0.96, 1];
  });

  const rough = bakeMap(size, (u, v) => {
    const h = height(u, v);
    let ro = 0.78 - h * 0.12;
    const wet = fbm2(u * 2, v * 5, seed + 13, 3);
    if (wet > 0.68) ro = 0.38; // rain streaks
    return [ro, ro, ro, 1];
  });

  const normal = bakeNormalFromHeight(size, height, 2.8);
  return { albedo, rough, normal };
}

/** Painted metal / street furniture. Metalness 1. */
export function genMetal(size, seed) {
  const height = (u, v) => {
    const brush = fbm2(u * 20, v * 2, seed, 3);
    const dents = fbm2(u * 6, v * 6, seed + 4, 3);
    return brush * 0.4 + dents * 0.6;
  };

  const albedo = bakeMap(size, (u, v) => {
    const h = height(u, v);
    // Industrial metal that still reads under night practicals (0.12–0.35)
    let base = 0.14 + h * 0.12;
    const chip = fbm2(u * 14, v * 14, seed + 8, 2);
    if (chip > 0.78) {
      return [0.62, 0.63, 0.66, 1]; // bare steel
    }
    // Cool gray paint with slight green
    return [base * 0.95, base * 1.0, base * 1.05, 1];
  });

  const rough = bakeMap(size, (u, v) => {
    const chip = fbm2(u * 14, v * 14, seed + 8, 2);
    let ro = 0.45;
    if (chip > 0.78) ro = 0.25;
    const scuff = fbm2(u * 9, v * 9, seed + 2, 2);
    ro += scuff * 0.2;
    return [ro, ro, ro, 1];
  });

  const normal = bakeNormalFromHeight(size, height, 1.8);
  return { albedo, rough, normal, metalness: 1 };
}

/** Flesh / enemy body. */
export function genFlesh(size, seed) {
  const height = (u, v) => fbm2(u * 5, v * 5, seed, 4) * 0.7 + fbm2(u * 18, v * 18, seed + 3, 2) * 0.3;

  const albedo = bakeMap(size, (u, v) => {
    const h = height(u, v);
    // Desaturated hostile red-brown 0.15–0.35
    const r = 0.28 + h * 0.12;
    const g = 0.08 + h * 0.05;
    const b = 0.07 + h * 0.04;
    return [r, g, b, 1];
  });

  const rough = bakeMap(size, (u, v) => {
    const h = height(u, v);
    const ro = 0.55 + h * 0.2;
    return [ro, ro, ro, 1];
  });

  const normal = bakeNormalFromHeight(size, height, 1.6);
  return { albedo, rough, normal };
}

/** Plaster interior trim. */
export function genPlaster(size, seed) {
  const height = (u, v) => fbm2(u * 4, v * 4, seed, 3) * 0.8 + fbm2(u * 30, v * 30, seed + 1, 2) * 0.2;

  const albedo = bakeMap(size, (u, v) => {
    const h = height(u, v);
    let g = 0.12 + h * 0.08;
    const stain = fbm2(u * 2, v * 3, seed + 6, 3);
    if (stain > 0.6) g *= 0.7;
    return [g * 1.05, g, g * 0.92, 1];
  });

  const rough = bakeMap(size, (u, v) => {
    const ro = 0.8 - fbm2(u * 5, v * 5, seed, 2) * 0.15;
    return [ro, ro, ro, 1];
  });

  const normal = bakeNormalFromHeight(size, height, 1.2);
  return { albedo, rough, normal };
}
