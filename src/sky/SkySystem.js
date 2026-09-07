import * as THREE from 'three';

/**
 * Night sky + bright practical street lighting.
 *
 * FIXED point-light count (incl. ballast @ intensity 0) — never toggle visibility.
 *
 * Public: setLightIntensity, getLight, lightCount, nightColor
 */

/** Must stay constant for the whole session (shader permutation). */
export const LIGHT_SLOTS = 12;

export class SkySystem {
  static id = 'sky';
  static deps = [];

  constructor() {
    this._points = [];
    this._keyDir = null;
    this._fillDir = null;
    this._amb = null;
    this._hemi = null;
    this._props = [];
    this._geoms = [];
    this._mats = [];
    this.lightCount = LIGHT_SLOTS;
    this.nightColor = 0x090e16;
    this._root = null;
  }

  async init(ctx) {
    const scene = ctx.scene;
    const rng = ctx.rng.fork();

    this._root = new THREE.Group();
    this._root.name = 'sky';
    scene.add(this._root);

    scene.background = new THREE.Color(this.nightColor);
    scene.fog = new THREE.FogExp2(this.nightColor, 0.0078);
    ctx.renderer.setClearColor(this.nightColor, 1);

    this._amb = new THREE.AmbientLight(0x584939, 0.48);
    this._root.add(this._amb);

    this._hemi = new THREE.HemisphereLight(0x6f86aa, 0x1d1712, 0.82);
    this._root.add(this._hemi);

    // Moon key (cool rim)
    this._keyDir = new THREE.DirectionalLight(0x9fb8dc, 0.92);
    this._keyDir.position.set(-28, 42, 24);
    this._root.add(this._keyDir);

    // Warm fill from opposite sky
    this._fillDir = new THREE.DirectionalLight(0xf2b57d, 0.22);
    this._fillDir.position.set(25, 12, -15);
    this._root.add(this._fillDir);

    // Ten authored practicals support checkpoint, courtyard and extraction.
    // The final two slots remain parked ballast so shader permutations are fixed.
    const practicals = [
      { x: -8.3, y: 5.2, z: 47, color: 0xf4b36f, intensity: 34, distance: 24, decay: 2 },
      { x: 8.3, y: 5.2, z: 31, color: 0x82a9d8, intensity: 28, distance: 22, decay: 2 },
      { x: 7.2, y: 4.4, z: 18, color: 0xf0a45e, intensity: 32, distance: 20, decay: 2 },
      { x: -13, y: 4.5, z: 12, color: 0xf0a05c, intensity: 38, distance: 22, decay: 2 },
      { x: -25, y: 4.2, z: -5, color: 0xe79354, intensity: 36, distance: 21, decay: 2 },
      { x: -8.2, y: 5.1, z: -15, color: 0x789ed0, intensity: 26, distance: 21, decay: 2 },
      { x: 8.2, y: 5.2, z: -29, color: 0x7eabd9, intensity: 28, distance: 22, decay: 2 },
      { x: -8.2, y: 5.2, z: -43, color: 0xe9a260, intensity: 32, distance: 23, decay: 2 },
      { x: -4.2, y: 4.0, z: -53, color: 0x78b6dc, intensity: 38, distance: 19, decay: 2 },
      { x: 4.2, y: 4.0, z: -53, color: 0xf1b36f, intensity: 31, distance: 18, decay: 2 },
    ];
    // Fill remaining slots as ballast
    while (practicals.length < LIGHT_SLOTS) {
      practicals.push({
        x: 0,
        y: 3,
        z: 0,
        color: 0xffffff,
        intensity: 0,
        distance: 1,
        decay: 2,
      });
    }

    for (let i = 0; i < LIGHT_SLOTS; i++) {
      const p = practicals[i];
      const light = new THREE.PointLight(p.color, p.intensity, p.distance, p.decay);
      light.position.set(p.x, p.y, p.z);
      light.castShadow = false;
      light.visible = true;
      light.userData.slot = i;
      this._root.add(light);
      this._points.push(light);
    }

    // Lamp fixtures at each live practical
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a30,
      metalness: 1,
      roughness: 0.35,
      emissive: 0xffa040,
      emissiveIntensity: 0.6,
    });
    this._mats.push(lampMat);

    const poleGeom = new THREE.CylinderGeometry(0.08, 0.1, 5.0, 8);
    const headGeom = new THREE.CylinderGeometry(0.28, 0.35, 0.22, 10);
    const bulbGeom = new THREE.SphereGeometry(0.18, 10, 10);
    this._geoms.push(poleGeom, headGeom, bulbGeom);

    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xffe0a8,
      emissive: 0xffcc66,
      emissiveIntensity: 4.5,
      roughness: 0.5,
      metalness: 0,
    });
    this._mats.push(bulbMat);

    for (let i = 0; i < this._points.length; i++) {
      const p = this._points[i];
      if (p.intensity <= 0) continue;
      const jig = (rng.float() - 0.5) * 0.3;
      const group = new THREE.Group();
      group.position.set(p.position.x + jig, 0, p.position.z);

      const pole = new THREE.Mesh(poleGeom, lampMat);
      pole.position.y = 2.5;
      group.add(pole);

      const head = new THREE.Mesh(headGeom, lampMat);
      head.position.y = 5.15;
      group.add(head);

      const bulb = new THREE.Mesh(bulbGeom, bulbMat);
      bulb.position.y = 5.0;
      group.add(bulb);

      this._root.add(group);
      this._props.push(group);
    }

    // World owns facade windows now — sky only handles sky + practicals.
    scene.environment = null;
  }

  setLightIntensity(index, intensity) {
    if (index < 0 || index >= this._points.length) return;
    this._points[index].intensity = intensity;
  }

  getLight(index) {
    return this._points[index] || null;
  }

  dispose() {
    if (this._root) this._root.parent?.remove(this._root);
    for (const g of this._geoms) g.dispose();
    for (const m of this._mats) m.dispose();
    this._points.length = 0;
    this._props.length = 0;
  }
}
