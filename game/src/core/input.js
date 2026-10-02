// Single source of truth for player input.
//
// Every gameplay system reads the same named actions, so there are no hidden
// key dependencies and desktop / touch / gamepad all behave identically.
//
//   throttle  0..1      W  / Up    / right touch pad / gamepad RT
//   brake     0..1      S  / Down  / left touch pad  / gamepad LT
//   steer    -1..1      A/D, Left/Right / tilt or steering pad / stick
//   hardBrake bool      Space
//   reset     edge      R
//   camera    edge      C
//   interact  edge      E
//   map       edge      M
//   photo     edge      P
//   horn      bool      H
//   lights    edge      L

import { clamp, isTouchDevice, moveToward } from './util.js';

const KEY_ACTIONS = {
  KeyW: 'throttleKey',
  ArrowUp: 'throttleKey',
  KeyS: 'brakeKey',
  ArrowDown: 'brakeKey',
  KeyA: 'leftKey',
  ArrowLeft: 'leftKey',
  KeyD: 'rightKey',
  ArrowRight: 'rightKey',
  Space: 'hardBrakeKey',
  KeyH: 'hornKey',
  ShiftLeft: 'boostKey',
  ShiftRight: 'boostKey',
};

const EDGE_KEYS = {
  KeyR: 'reset',
  KeyC: 'camera',
  KeyE: 'interact',
  KeyM: 'map',
  KeyP: 'photo',
  KeyL: 'lights',
  KeyN: 'timeSkip',
  KeyG: 'gearToggle',
  F3: 'debug',
  Escape: 'pause',
  Backquote: 'debug',
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.edges = new Set();
    this.consumed = new Set();

    this.throttle = 0;
    this.brake = 0;
    this.steer = 0;
    this.hardBrake = false;
    this.horn = false;
    this.lookX = 0;
    this.lookY = 0;
    this.enabled = true;

    // touch state, driven by ui/TouchControls
    this.touch = { throttle: 0, brake: 0, steer: 0, hardBrake: false, active: false };
    this.isTouch = isTouchDevice();

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = this._onBlur.bind(this);
    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }

  _onKeyDown(e) {
    if (e.repeat) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (KEY_ACTIONS[e.code] || EDGE_KEYS[e.code]) {
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    }
    this.keys.add(e.code);
    const edge = EDGE_KEYS[e.code];
    if (edge) this.edges.add(edge);
  }

  _onKeyUp(e) {
    this.keys.delete(e.code);
  }

  _onBlur() {
    this.keys.clear();
  }

  /** Edge-triggered action; returns true once per press. */
  pressed(name) {
    if (this.edges.has(name) && !this.consumed.has(name)) {
      this.consumed.add(name);
      return true;
    }
    return false;
  }

  pressVirtual(name) {
    this.edges.add(name);
  }

  held(code) {
    return this.keys.has(code);
  }

  update(dt) {
    const kThrottle = this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0;
    const kBrake = this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0;
    const kLeft = this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0;
    const kRight = this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0;

    const gp = this._gamepad();

    const rawThrottle = Math.max(kThrottle, this.touch.throttle, gp.throttle);
    const rawBrake = Math.max(kBrake, this.touch.brake, gp.brake);
    let rawSteer = kRight - kLeft;
    if (Math.abs(this.touch.steer) > Math.abs(rawSteer)) rawSteer = this.touch.steer;
    if (Math.abs(gp.steer) > Math.abs(rawSteer)) rawSteer = gp.steer;

    if (!this.enabled) {
      this.throttle = 0;
      this.brake = 0;
      this.steer = 0;
      this.hardBrake = false;
      this.horn = false;
      return;
    }

    // Smooth the digital inputs so keyboard riding is not an on/off switch.
    this.throttle = moveToward(this.throttle, rawThrottle, dt * (rawThrottle > this.throttle ? 3.4 : 6.5));
    this.brake = moveToward(this.brake, rawBrake, dt * (rawBrake > this.brake ? 6.0 : 9.0));
    const steerRate = dt * (Math.abs(rawSteer) > 0.01 ? 4.2 : 9.0);
    this.steer = moveToward(this.steer, rawSteer, steerRate);
    this.hardBrake = this.keys.has('Space') || this.touch.hardBrake || gp.hardBrake;
    this.horn = this.keys.has('KeyH') || this.touch.horn === true;
  }

  _gamepad() {
    const out = { throttle: 0, brake: 0, steer: 0, hardBrake: false };
    if (!navigator.getGamepads) return out;
    const pads = navigator.getGamepads();
    for (const p of pads) {
      if (!p) continue;
      out.throttle = Math.max(out.throttle, p.buttons[7]?.value || 0);
      out.brake = Math.max(out.brake, p.buttons[6]?.value || 0);
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.12) out.steer = ax;
      if (p.buttons[0]?.pressed) out.hardBrake = true;
      if (p.buttons[1]?.pressed) this.edges.add('camera');
      break;
    }
    return out;
  }

  /** Called at the very end of a frame. */
  endFrame() {
    this.edges.clear();
    this.consumed.clear();
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
  }
}
