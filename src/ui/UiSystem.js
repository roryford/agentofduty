/**
 * HUD: crosshair, ammo, HP, damage vignette, kill confirm, hit marker.
 */

export class UiSystem {
  static id = 'ui';
  static deps = ['player', 'weapons'];

  constructor() {
    this._root = null;
    this._cross = null;
    this._ammo = null;
    this._hp = null;
    this._prompt = null;
    this._hit = null;
    this._dmg = null;
    this._kill = null;
    this._death = null;
    this._hitMarker = null;
    this._unsubs = [];
    this._hitFlash = 0;
    this._killFlash = 0;
    this._dmgFlash = 0;
    this._markerFlash = 0;
    this._lockstep = false;
    this._lastHp = 100;
  }

  async init(ctx) {
    this._lockstep =
      new URLSearchParams(window.location.search).get('lockstep') === '1' ||
      window.__LOCKSTEP__ === true;

    const root = document.createElement('div');
    root.id = 'hud';
    root.style.cssText =
      'position:fixed;inset:0;pointer-events:none;font:600 14px/1.2 ui-sans-serif,system-ui,sans-serif;color:#e8eaef;user-select:none;z-index:10';

    const dmg = document.createElement('div');
    dmg.style.cssText =
      'position:absolute;inset:0;background:radial-gradient(circle at center,transparent 40%,#ff101030 100%);opacity:0';
    this._dmg = dmg;

    const hit = document.createElement('div');
    hit.style.cssText =
      'position:absolute;inset:0;background:radial-gradient(circle at center,transparent 55%,#ff202014 100%);opacity:0';
    this._hit = hit;

    const cross = document.createElement('div');
    cross.style.cssText =
      'position:absolute;left:50%;top:50%;width:16px;height:16px;margin:-8px 0 0 -8px;opacity:0.92;transition:transform 40ms linear';
    cross.innerHTML = `
      <div style="position:absolute;left:7px;top:0;width:2px;height:5px;background:#e8eaef;box-shadow:0 0 0 1px #0008"></div>
      <div style="position:absolute;left:7px;bottom:0;width:2px;height:5px;background:#e8eaef;box-shadow:0 0 0 1px #0008"></div>
      <div style="position:absolute;top:7px;left:0;width:5px;height:2px;background:#e8eaef;box-shadow:0 0 0 1px #0008"></div>
      <div style="position:absolute;top:7px;right:0;width:5px;height:2px;background:#e8eaef;box-shadow:0 0 0 1px #0008"></div>
    `;
    this._cross = cross;

    const marker = document.createElement('div');
    marker.style.cssText =
      'position:absolute;left:50%;top:50%;width:20px;height:20px;margin:-10px 0 0 -10px;opacity:0;border:2px solid #fff;transform:rotate(45deg);box-shadow:0 0 6px #f44';
    this._hitMarker = marker;

    const ammo = document.createElement('div');
    ammo.style.cssText =
      'position:absolute;right:28px;bottom:28px;font-size:24px;letter-spacing:0.06em;text-shadow:0 1px 3px #000;font-variant-numeric:tabular-nums';
    this._ammo = ammo;

    const hp = document.createElement('div');
    hp.style.cssText =
      'position:absolute;left:28px;bottom:28px;font-size:22px;text-shadow:0 1px 3px #000;font-variant-numeric:tabular-nums';
    this._hp = hp;

    const prompt = document.createElement('div');
    prompt.style.cssText =
      'position:absolute;left:50%;top:58%;transform:translateX(-50%);padding:10px 16px;background:#000a;border:1px solid #ffffff22;border-radius:4px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase';
    prompt.textContent = 'Click to play  ·  WASD  ·  Mouse  ·  LMB fire  ·  R reload';
    this._prompt = prompt;

    const kill = document.createElement('div');
    kill.style.cssText =
      'position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);font-size:11px;letter-spacing:0.28em;text-transform:uppercase;opacity:0;color:#ffb4b4;text-shadow:0 0 14px #f00a';
    kill.textContent = 'eliminated';
    this._kill = kill;

    const death = document.createElement('div');
    death.style.cssText = [
      'position:absolute',
      'inset:0',
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'justify-content:center',
      'background:radial-gradient(circle at center,#40080888 0%,#000c 70%)',
      'opacity:0',
      'transition:opacity 200ms linear',
      'pointer-events:none',
    ].join(';');
    death.innerHTML =
      '<div style="font-size:28px;letter-spacing:0.35em;color:#ff6666;text-shadow:0 0 20px #f00">KIA</div>' +
      '<div style="margin-top:12px;font-size:12px;letter-spacing:0.15em;color:#ccc;opacity:0.85" id="hud-respawn">respawning…</div>';
    this._death = death;
    this._respawnLabel = death.querySelector('#hud-respawn');

    root.append(dmg, hit, cross, marker, ammo, hp, prompt, kill, death);
    document.body.appendChild(root);
    this._root = root;

    if (this._lockstep) prompt.style.display = 'none';

    this._unsubs.push(
      ctx.events.on('damage:dealt', (p) => {
        if (p && p.target && p.target !== 'player') {
          this._hitFlash = 0.1;
          this._markerFlash = 0.12;
        }
      }),
      ctx.events.on('actor:death', (p) => {
        if (p && p.actor && p.actor !== 'player') this._killFlash = 1.4;
      }),
      ctx.events.on('damage:taken', (p) => {
        if (p && typeof p.health === 'number' && p.health < this._lastHp) {
          this._dmgFlash = 0.35;
        }
      }),
    );
  }

  update(dt, ctx) {
    const player = ctx.get('player');
    const weapons = ctx.get('weapons');
    const w = weapons.current;

    this._lastHp = player.health;
    this._ammo.textContent = `${w.ammo}  /  ${w.reserve}`;
    const hpCol = player.health < 30 ? '#ff6666' : player.health < 60 ? '#ffcc66' : '#e8eaef';
    this._hp.style.color = hpCol;
    this._hp.textContent = `HP  ${Math.ceil(Math.max(0, player.health))}`;

    // Death overlay + respawn countdown
    if (!player.alive) {
      this._death.style.opacity = '1';
      this._cross.style.opacity = '0';
      if (this._respawnLabel) {
        const t = Math.max(0, player.respawnIn);
        this._respawnLabel.textContent = `respawning in ${t.toFixed(1)}s`;
      }
    } else {
      this._death.style.opacity = '0';
      this._cross.style.opacity = '0.92';
    }

    const locked = ctx.input.mouse.locked || this._lockstep;
    if (this._prompt) {
      this._prompt.style.display = locked || !player.alive ? 'none' : 'block';
    }

    if (this._hitFlash > 0) {
      this._hitFlash -= dt;
      this._hit.style.opacity = this._hitFlash > 0 ? '1' : '0';
    }
    if (this._dmgFlash > 0) {
      this._dmgFlash -= dt;
      this._dmg.style.opacity = String(Math.min(1, this._dmgFlash * 3));
    } else {
      this._dmg.style.opacity = '0';
    }
    if (this._killFlash > 0) {
      this._killFlash -= dt;
      this._kill.style.opacity = String(Math.min(1, this._killFlash));
    } else {
      this._kill.style.opacity = '0';
    }
    if (this._markerFlash > 0) {
      this._markerFlash -= dt;
      this._hitMarker.style.opacity = String(Math.min(1, this._markerFlash * 8));
    } else {
      this._hitMarker.style.opacity = '0';
    }

    const kick = weapons.firing ? 1.35 : 1 + weapons.recoilPitch * 8;
    this._cross.style.transform = `scale(${kick})`;
  }

  dispose() {
    for (const u of this._unsubs) u();
    this._unsubs.length = 0;
    if (this._root) {
      this._root.remove();
      this._root = null;
    }
  }
}
