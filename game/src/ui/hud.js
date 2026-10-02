// Heads-up display: speedo, gear, fuel, clock, place name, notifications and
// the control hints. Deliberately quiet -- it should not fight the world.

import { fmtClock, fmtDistance, clamp01 } from '../core/util.js';

const CSS = `
#hud { position: fixed; inset: 0; pointer-events: none; z-index: 20;
  font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, Arial, sans-serif;
  color: #f4efe4; text-shadow: 0 1px 4px rgba(0,0,0,.65); user-select: none; }
#hud .panel { position: absolute; background: rgba(16,15,13,.46); backdrop-filter: blur(9px);
  border: 1px solid rgba(255,255,255,.10); border-radius: 14px; }

/* speedo */
#speedo { right: 18px; bottom: 18px; width: 164px; padding: 12px 14px 10px; text-align: right; }
#speedo .v { font-size: 48px; font-weight: 800; line-height: .92; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
#speedo .u { font-size: 11px; letter-spacing: .22em; color: #bcae94; margin-top: 2px; }
#speedo .row { display: flex; justify-content: space-between; align-items: center; margin-top: 9px;
  font-size: 11px; color: #cdbfa3; letter-spacing: .08em; }
#rpmbar { height: 4px; background: rgba(255,255,255,.14); border-radius: 3px; overflow: hidden; margin-top: 8px; }
#rpmbar > i { display: block; height: 100%; width: 0; background: linear-gradient(90deg,#8ec07c,#e2b33c 70%,#e05a3c); transition: width .05s linear; }
#fuelbar { height: 4px; background: rgba(255,255,255,.14); border-radius: 3px; overflow: hidden; margin-top: 5px; }
#fuelbar > i { display: block; height: 100%; width: 50%; background: linear-gradient(90deg,#e0603c,#e2b33c 45%,#8ec07c); }

/* top left info */
#place { left: 18px; top: 16px; padding: 10px 14px; max-width: 42vw; }
#place .n { font-size: 15px; font-weight: 700; letter-spacing: .03em; }
#place .s { font-size: 11px; color: #bcae94; letter-spacing: .13em; text-transform: uppercase; margin-top: 2px; }

/* top right status */
#status { right: 18px; top: 16px; padding: 9px 13px; text-align: right; font-size: 12px; letter-spacing: .06em; }
#status .t { font-size: 17px; font-weight: 700; }
#status .w { color: #bcae94; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; }

/* minimap */
#minimap { right: 18px; top: 86px; width: 168px; height: 168px; border-radius: 50%; overflow: hidden; padding: 0; }
#minimap canvas { width: 100%; height: 100%; display: block; }

/* notifications */
#notes { left: 50%; transform: translateX(-50%); bottom: 96px; display: flex; flex-direction: column;
  align-items: center; gap: 7px; position: absolute; }
.note { background: rgba(16,15,13,.66); border: 1px solid rgba(255,255,255,.12); border-radius: 999px;
  padding: 8px 18px; font-size: 13px; letter-spacing: .04em; animation: pop .3s ease;
  backdrop-filter: blur(8px); }
.note.good { border-color: rgba(142,192,124,.5); }
.note.warn { border-color: rgba(226,179,60,.55); }
@keyframes pop { from { opacity: 0; transform: translateY(8px) scale(.96);} to {opacity:1; transform:none;} }

/* hints */
#hints { left: 18px; bottom: 18px; padding: 10px 14px; font-size: 11.5px; color: #cabb9e; line-height: 1.85; letter-spacing: .04em; }
#hints b { color: #f0e6d2; background: rgba(255,255,255,.1); border-radius: 4px; padding: 1px 6px; font-weight: 700;
  font-family: ui-monospace, monospace; font-size: 10.5px; }
#hints.collapsed .more { display: none; }

/* interact prompt */
#prompt { left: 50%; transform: translateX(-50%); bottom: 150px; padding: 10px 20px; font-size: 14px;
  display: none; }
#prompt b { background: #e2b33c; color: #241c08; border-radius: 5px; padding: 1px 7px; font-family: ui-monospace, monospace; }

/* debug */
#dbg { left: 18px; top: 78px; padding: 8px 12px; font-family: ui-monospace, monospace; font-size: 11px;
  color: #9fd3b0; line-height: 1.55; display: none; white-space: pre; }

/* photo mode */
#photobar { left: 50%; transform: translateX(-50%); bottom: 24px; padding: 10px 18px; display: none;
  font-size: 12px; letter-spacing: .08em; pointer-events: auto; }
#photobar button { pointer-events: auto; margin-left: 10px; background: #e2b33c; color: #241c08; border: 0;
  border-radius: 7px; padding: 7px 14px; font-weight: 700; cursor: pointer; }

@media (max-width: 760px) {
  #hints { display: none; }
  #minimap { width: 118px; height: 118px; top: 74px; right: 12px; }
  #speedo { width: 132px; right: 12px; bottom: 112px; }
  #speedo .v { font-size: 36px; }
  #place { max-width: 50vw; left: 12px; top: 12px; padding: 7px 11px; }
  #place .n { font-size: 13px; }
  #status { right: 12px; top: 12px; padding: 6px 10px; }
}
`;

export class Hud {
  constructor(root) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'hud';
    el.innerHTML = `
      <div id="speedo" class="panel">
        <div class="v" id="spd">0</div>
        <div class="u">KM / H</div>
        <div id="rpmbar"><i></i></div>
        <div class="row"><span id="gear">N</span><span id="fuelTxt">—</span></div>
        <div id="fuelbar"><i></i></div>
      </div>
      <div id="place" class="panel">
        <div class="n" id="placeName">Darsi</div>
        <div class="s" id="placeSub">Prakasam · Andhra Pradesh</div>
      </div>
      <div id="status" class="panel">
        <div class="t" id="clock">8:30 AM</div>
        <div class="w" id="weather">Clear</div>
      </div>
      <div id="minimap" class="panel"><canvas id="mmcanvas" width="336" height="336"></canvas></div>
      <div id="notes"></div>
      <div id="prompt" class="panel"></div>
      <div id="dbg" class="panel"></div>
      <div id="hints" class="panel">
        <b>W</b> throttle &nbsp; <b>S</b> brake &nbsp; <b>A</b>/<b>D</b> steer &nbsp; <b>SPACE</b> hard brake<br>
        <span class="more"><b>R</b> reset &nbsp; <b>C</b> camera &nbsp; <b>M</b> map &nbsp; <b>E</b> interact &nbsp; <b>P</b> photo &nbsp; <b>H</b> horn<br>
        <b>N</b> time &nbsp; <b>G</b> weather &nbsp; <b>L</b> lights &nbsp; <b>F3</b> debug</span>
      </div>
      <div id="photobar" class="panel">PHOTO MODE — <b>A/D</b> orbit · <b>W/S</b> pitch · <b>Q/E</b> zoom
        <button id="shotbtn">SAVE SHOT</button><button id="exitphoto">EXIT</button></div>
    `;
    root.appendChild(el);
    this.el = el;
    this.spd = el.querySelector('#spd');
    this.gear = el.querySelector('#gear');
    this.rpm = el.querySelector('#rpmbar > i');
    this.fuel = el.querySelector('#fuelbar > i');
    this.fuelTxt = el.querySelector('#fuelTxt');
    this.clock = el.querySelector('#clock');
    this.weather = el.querySelector('#weather');
    this.placeName = el.querySelector('#placeName');
    this.placeSub = el.querySelector('#placeSub');
    this.notes = el.querySelector('#notes');
    this.prompt = el.querySelector('#prompt');
    this.dbg = el.querySelector('#dbg');
    this.photobar = el.querySelector('#photobar');
    this.mm = el.querySelector('#mmcanvas');
    this.mmctx = this.mm.getContext('2d');
    this._notes = [];
    this.debugOn = false;
  }

  notify(text, kind = '') {
    const n = document.createElement('div');
    n.className = `note ${kind}`;
    n.textContent = text;
    this.notes.appendChild(n);
    setTimeout(() => {
      n.style.transition = 'opacity .4s, transform .4s';
      n.style.opacity = '0';
      n.style.transform = 'translateY(-6px)';
      setTimeout(() => n.remove(), 420);
    }, 2800);
    while (this.notes.children.length > 4) this.notes.firstChild.remove();
  }

  setPrompt(text) {
    if (!text) {
      this.prompt.style.display = 'none';
      return;
    }
    this.prompt.style.display = 'block';
    this.prompt.innerHTML = text;
  }

  setPhoto(on) {
    this.photobar.style.display = on ? 'block' : 'none';
    this.el.querySelector('#speedo').style.opacity = on ? '0' : '1';
    this.el.querySelector('#place').style.opacity = on ? '0' : '1';
    this.el.querySelector('#status').style.opacity = on ? '0' : '1';
    this.el.querySelector('#minimap').style.opacity = on ? '0' : '1';
    const h = this.el.querySelector('#hints');
    if (h) h.style.opacity = on ? '0' : '1';
  }

  toggleDebug() {
    this.debugOn = !this.debugOn;
    this.dbg.style.display = this.debugOn ? 'block' : 'none';
  }

  update(state) {
    this.spd.textContent = Math.round(Math.abs(state.speedKmh));
    this.gear.textContent = state.gear === 0 ? 'N' : `GEAR ${state.gear}`;
    this.rpm.style.width = `${clamp01(state.rpm / state.redline) * 100}%`;
    this.fuel.style.width = `${clamp01(state.fuel / state.fuelCap) * 100}%`;
    this.fuelTxt.textContent = `${state.fuel.toFixed(1)} L`;
    this.clock.textContent = fmtClock(state.hour);
    this.weather.textContent = `${state.weather} · ${state.phase}`;
    if (state.placeName !== this._lastPlace) {
      this._lastPlace = state.placeName;
      this.placeName.textContent = state.placeName;
      this.placeSub.textContent = state.placeSub;
    }
    if (this.debugOn) this.dbg.textContent = state.debug;
  }
}
