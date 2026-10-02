// Mobile control layer: large touch targets, thumb-friendly placement,
// multi-touch safe. Shown automatically on touch devices, toggleable.

const CSS = `
#touch { position: fixed; inset: 0; z-index: 30; pointer-events: none; display: none;
  font-family: ui-sans-serif, system-ui, Roboto, sans-serif; user-select: none; -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent; touch-action: none; }
#touch.on { display: block; }
#touch .btn { position: absolute; pointer-events: auto; display: flex; align-items: center;
  justify-content: center; border-radius: 50%; background: rgba(22,20,17,.42);
  border: 2px solid rgba(255,255,255,.22); color: #f2ebdc; font-weight: 800; letter-spacing: .06em;
  backdrop-filter: blur(6px); transition: background .08s, transform .08s; }
#touch .btn.act { background: rgba(226,179,60,.78); color: #241c08; transform: scale(.95);
  border-color: rgba(255,255,255,.5); }
#touch .sq { border-radius: 18px; }

#tThrottle { right: 20px; bottom: 132px; width: 104px; height: 104px; font-size: 13px; }
#tBrake { right: 140px; bottom: 56px; width: 86px; height: 86px; font-size: 13px; }
#tHard { right: 20px; bottom: 32px; width: 86px; height: 86px; font-size: 12px;
  background: rgba(150,40,30,.44); }
#tLeft { left: 20px; bottom: 44px; width: 100px; height: 100px; font-size: 30px; }
#tRight { left: 136px; bottom: 44px; width: 100px; height: 100px; font-size: 30px; }

#tTop { position: absolute; right: 14px; bottom: 250px; display: flex; flex-direction: column; gap: 9px;
  pointer-events: none; }
#tTop .btn { position: relative; width: 56px; height: 56px; font-size: 11px; right: auto; bottom: auto; }
#tLeftCol { position: absolute; left: 14px; bottom: 164px; display: flex; flex-direction: column; gap: 9px; }
#tLeftCol .btn { position: relative; width: 56px; height: 56px; font-size: 11px; }

@media (min-width: 900px) and (pointer: fine) { #touch.auto { display: none; } }
`;

export class TouchControls {
  constructor(root, input, handlers) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'touch';
    el.innerHTML = `
      <div class="btn" id="tThrottle">GAS</div>
      <div class="btn" id="tBrake">BRAKE</div>
      <div class="btn" id="tHard">STOP</div>
      <div class="btn" id="tLeft">◀</div>
      <div class="btn" id="tRight">▶</div>
      <div id="tTop">
        <div class="btn" id="tCam">CAM</div>
        <div class="btn" id="tHorn">HORN</div>
      </div>
      <div id="tLeftCol">
        <div class="btn" id="tMap">MAP</div>
        <div class="btn" id="tReset">RESET</div>
        <div class="btn" id="tPhoto">PHOTO</div>
      </div>`;
    root.appendChild(el);
    this.el = el;
    this.input = input;

    const hold = (id, on, off) => {
      const b = el.querySelector(id);
      const down = (e) => {
        e.preventDefault();
        b.classList.add('act');
        on();
      };
      const up = (e) => {
        e.preventDefault();
        b.classList.remove('act');
        off();
      };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    };
    const tap = (id, fn) => {
      const b = el.querySelector(id);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.classList.add('act');
        fn();
        setTimeout(() => b.classList.remove('act'), 130);
      });
    };

    const t = input.touch;
    hold('#tThrottle', () => { t.throttle = 1; }, () => { t.throttle = 0; });
    hold('#tBrake', () => { t.brake = 1; }, () => { t.brake = 0; });
    hold('#tHard', () => { t.hardBrake = 1; }, () => { t.hardBrake = 0; });
    hold('#tLeft', () => { t.steerLeft = 1; }, () => { t.steerLeft = 0; });
    hold('#tRight', () => { t.steerRight = 1; }, () => { t.steerRight = 0; });
    tap('#tCam', handlers.camera);
    tap('#tHorn', handlers.horn);
    tap('#tMap', handlers.map);
    tap('#tReset', handlers.reset);
    tap('#tPhoto', handlers.photo);
  }

  setVisible(on) {
    this.el.classList.toggle('on', !!on);
  }
}
