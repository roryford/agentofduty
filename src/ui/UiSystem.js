import './hud.css';
import { Vector3 } from 'three';

/** HUD observes resolved combat events; menu actions go through session lifecycle. */
export class UiSystem {
  static id = 'ui';
  static deps = ['player', 'weapons', 'mission'];
  constructor() {
    this._unsubs = [];
    this.hit = 0;
    this.hurt = 0;
    this.kill = 0;
    this.direction = 0;
    this._waypoint = new Vector3();
  }
  async init(ctx) {
    const root = document.createElement('div');
    root.id = 'hud';
    root.innerHTML = `
      <div class="aod-vignette"></div><div class="damage-wash"></div>
      <header class="mission-strip"><span class="signal-dot"></span><span>OPERATION / NIGHTFALL</span><span class="mission-location"></span></header>
      <div class="objective-panel"><small>CURRENT OBJECTIVE</small><strong class="objective-text"></strong><span class="objective-distance"></span></div>
      <div class="rally-marker"><i>◇</i><span>RALLY</span></div><div class="aim-cross"><i></i><i></i><i></i><i></i></div><div class="hit-marker">×</div><div class="damage-bearing">▴</div>
      <div class="kill-confirm"><span>HOSTILE DOWN</span><b>+100</b></div>
      <footer class="combat-hud"><div class="health-panel"><small>VITALS</small><strong class="health-value"></strong><div class="health-track"><i></i></div></div>
      <span class="control-hint">WASD MOVE · SHIFT SPRINT · C CROUCH · SPACE JUMP / VAULT · E AIM</span>
      <div class="ammo-panel"><small>AR-01 / 5.56</small><strong><span class="ammo-value"></span><em class="reserve-value"></em></strong><span class="weapon-status"></span></div></footer>
      <section class="session-menu" aria-label="Mission menu"><div class="menu-card"><div class="eyebrow">AGENT OF DUTY <span>01 / NIGHT OPERATIONS</span></div>
      <h1>NIGHTFALL<span>CHECKPOINT ASSAULT</span></h1><p class="menu-description">Push through the checkpoint. Clear the side route. Secure extraction.</p>
      <div class="mission-brief"><span>01 <b>BREACH</b></span><span>02 <b>FLANK</b></span><span>03 <b>EXTRACT</b></span></div>
      <div class="mode-controls"><label>MODE<select name="mode" aria-label="MODE"><option value="mission">Mission / hostiles</option><option value="practice">Explore / no enemies</option></select></label><label class="practice-area" hidden>STARTING AREA<select name="encounter" aria-label="STARTING AREA"></select></label><p class="mode-note">Changing mode or area restarts the session.</p></div>
      <button class="reset-position secondary" type="button" hidden>RESET POSITION</button>
      <button class="deploy-button" type="button">DEPLOY <span>→</span></button><button class="retry-button secondary" type="button">RESTART MISSION</button>
      <p class="menu-message" role="status"></p>
      <details class="settings"><summary>CONTROLS & SETTINGS</summary><div class="settings-grid">
      <label>LOOK SENSITIVITY<input name="sensitivity" type="range" min="0.0005" max="0.006" step="0.0001"></label>
      <label>AIM SENSITIVITY<input name="adsSensitivity" type="range" min="0.2" max="1" step="0.05"></label>
      <label>FIELD OF VIEW<input name="fov" type="range" min="65" max="100" step="1"></label>
      <label>MASTER VOLUME<input name="volume" type="range" min="0" max="1" step="0.05"></label>
      <label class="check-setting"><input name="invertY" type="checkbox"> INVERT LOOK</label><label class="check-setting"><input name="reducedMotion" type="checkbox"> REDUCE CAMERA MOTION</label>
      </div><p>Mouse to look · LMB fire · RMB or E aim · R reload · Escape pause</p></details>
      <div class="menu-footer">SINGLE PLAYER <span>ONE RIFLE. ONE WAY OUT.</span></div></div></section>
      <section class="death-screen"><small>OPERATOR DOWN</small><h2>KIA</h2><p class="death-countdown"></p><span>RESTORING CHECKPOINT</span></section>`;
    document.body.append(root);
    this.root = root;
    const q = (selector) => root.querySelector(selector);
    this.nodes = Object.fromEntries(['rally-marker','mission-location','objective-text','objective-distance','health-value','ammo-value','reserve-value','weapon-status','session-menu','menu-description','menu-message','death-countdown','death-screen','deploy-button','retry-button','kill-confirm','hit-marker','damage-wash','damage-bearing','aim-cross','combat-hud','objective-panel','mission-brief'].map(n => [n, q('.'+n)]));
    this.healthBar = q('.health-track i');
    this.modeSelect = q('[name=mode]');
    this.areaSelect = q('[name=encounter]');
    this.areaLabel = q('.practice-area');
    this.resetButton = q('.reset-position');
    const mission = ctx.get('mission');
    mission.encounters.forEach((encounter, index) => {
      const option = document.createElement('option'); option.value = String(index); option.textContent = encounter.name; this.areaSelect.append(option);
    });
    const configure = () => mission.configure(this.modeSelect.value, Number(this.areaSelect.value));
    this.modeSelect.addEventListener('change', configure);
    this.areaSelect.addEventListener('change', configure);
    this.resetButton.addEventListener('click', () => mission.resetPosition());
    this.heading = q('h1');
    this.nodes['deploy-button'].addEventListener('click', async () => {
      if (ctx.session.state === 'complete') ctx.session.retry(true);
      try {
        if (!ctx.canvas.requestPointerLock) throw new Error('Pointer lock is unavailable in this browser. Open in Chrome.');
        await ctx.canvas.requestPointerLock();
      } catch (error) { ctx.session.message = `Could not start: ${error.message}. Click deploy to retry.`; }
    });
    this.nodes['retry-button'].addEventListener('click', () => ctx.session.retry(true));
    for (const input of root.querySelectorAll('.settings input')) {
      const key = input.name;
      if (input.type === 'checkbox') input.checked = ctx.session.settings[key];
      else input.value = ctx.session.settings[key];
      input.addEventListener('input', () => {
        ctx.session.settings[key] = input.type === 'checkbox' ? input.checked : Number(input.value);
      });
    }
    this._unsubs.push(
      ctx.events.on('combat:hit', p => {
        if (p?.from === 'player' && p.target !== 'player') { this.hit = 0.16; if (p.killed) this.kill = 1.1; }
      }),
      ctx.events.on('damage:taken', p => {
        if (p?.target !== 'player') return;
        this.hurt = 0.6;
        const enemy = ctx.peek('ai')?.getEnemy(p.from);
        const player = ctx.get('player');
        if (enemy) this.direction = Math.atan2(enemy.position.x - player.position.x, -(enemy.position.z - player.position.z)) + player.yaw;
      }),
      ctx.events.on('session:reset', () => { this.hit = this.hurt = this.kill = 0; }),
      ctx.events.on('session:state', p => {
        if (p.state === 'complete' && document.pointerLockElement) document.exitPointerLock();
      }),
    );
  }
  update(dt, ctx) {
    const s = ctx.session, p = ctx.get('player'), w = ctx.get('weapons').current, mission = ctx.get('mission');
    const n = this.nodes, menu = s.state === 'ready' || s.state === 'paused' || s.state === 'complete';
    this.root.dataset.state = s.state;
    n['session-menu'].hidden = !menu;
    n['death-screen'].hidden = s.state !== 'dead';
    n['combat-hud'].hidden = menu || s.state === 'dead';
    n['objective-panel'].hidden = menu;
    const aiming = ctx.get('weapons')._adsBlend >= 0.98 && ctx.get('weapons').reticleVisible && !ctx.get('weapons')._reloading;
    n['aim-cross'].hidden = !s.playing || aiming;
    this.modeSelect.value = s.mode;
    this.areaSelect.value = String(mission.practiceEncounter);
    this.areaLabel.hidden = !mission.practice;
    this.resetButton.hidden = !mission.practice;
    n['retry-button'].textContent = mission.practice ? 'RESTART PRACTICE' : 'RESTART MISSION';
    n['health-value'].textContent = `${Math.ceil(p.health)}`;
    this.healthBar.style.transform = `scaleX(${Math.max(0,p.health)/100})`;
    n['health-value'].classList.toggle('critical', p.health < 30);
    n['ammo-value'].textContent = String(w.ammo).padStart(2,'0');
    n['reserve-value'].textContent = mission.practice ? '/ ∞' : `/ ${w.reserve}`;
    const weapon = ctx.get('weapons');
    n['weapon-status'].textContent = weapon._reloading ? 'RELOADING' : w.ammo === 0 ? 'EMPTY · R RELOAD' : p.sprinting ? 'SPRINTING' : p.ads ? 'AIMING' : 'AUTO';
    n['mission-location'].textContent = `${String(mission.index+1).padStart(2,'0')} / ${mission.current.name.toUpperCase()}`;
    n['objective-text'].textContent = mission.objective;
    const exit = mission.current.exit;
    this._waypoint.set(exit.x, 1.8, exit.z).project(ctx.camera);
    const marker = n['rally-marker'];
    marker.hidden = mission.practice || !s.playing || mission.alive > 0;
    const behind = this._waypoint.z > 1;
    const side = behind ? -Math.sign(this._waypoint.x || 1) : this._waypoint.x;
    marker.style.left = `${50 + Math.max(-.86, Math.min(.86, side)) * 50}%`;
    marker.style.top = `${50 - Math.max(-.62, Math.min(.62, behind ? 0 : this._waypoint.y)) * 50}%`;
    marker.classList.toggle('offscreen', behind || Math.abs(this._waypoint.x) > .86);
    n['objective-distance'].hidden = mission.practice;
    n['objective-distance'].textContent = `${Math.ceil(Math.hypot(p.position.x-exit.x,p.position.z-exit.z))} m TO RALLY POINT`;
    n['menu-message'].textContent = s.message;
    n['retry-button'].hidden = s.state === 'ready';
    n['mission-brief'].hidden = mission.practice || s.state !== 'ready';
    if (menu) {
      const complete = s.state === 'complete';
      this.heading.innerHTML = mission.practice ? 'EXPLORE<span>NO ENEMIES · UNLIMITED RESERVE</span>' : complete ? 'MISSION COMPLETE<span>EXTRACTION SECURED</span>' : s.state === 'paused' ? 'ON HOLD<span>MISSION PAUSED</span>' : 'NIGHTFALL<span>CHECKPOINT ASSAULT</span>';
      n['deploy-button'].textContent = complete ? 'PLAY AGAIN →' : s.state === 'paused' ? 'RESUME →' : 'DEPLOY →';
      n['menu-description'].textContent = mission.practice ? 'Test movement, aim and reload freely. Choose a starting area or reset your position below.' : complete
        ? `${Math.floor(s.elapsed/60)}:${String(Math.floor(s.elapsed%60)).padStart(2,'0')} elapsed · ${mission.kills} hostiles down · ${mission.shots ? Math.round(mission.hits/mission.shots*100) : 0}% accuracy · ${s.retries} retries`
        : s.state === 'paused' ? 'Take a breath. The operation will resume when you are ready.' : 'Push through the checkpoint. Clear the side route. Secure extraction.';
    }
    n['death-countdown'].textContent = `Returning in ${s.deathRemaining.toFixed(1)} seconds`;
    this.hit = Math.max(0,this.hit-dt); this.hurt = Math.max(0,this.hurt-dt); this.kill = Math.max(0,this.kill-dt);
    n['hit-marker'].style.opacity = this.hit > 0 ? '1' : '0';
    n['kill-confirm'].style.opacity = String(Math.min(1,this.kill*3));
    n['damage-wash'].style.opacity = String(this.hurt);
    n['damage-bearing'].style.opacity = String(Math.min(1,this.hurt*3));
    n['damage-bearing'].style.transform = `translate(-50%,-50%) rotate(${this.direction}rad) translateY(-95px)`;
  }
  dispose() { this._unsubs.forEach(unsub => unsub()); this.root?.remove(); }
}
