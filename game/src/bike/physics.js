// Single-track motorcycle model.
//
// Design brief: believable, *forgiving*, and never a car.
//   * real gearbox + torque curve, engine braking, clutch slip off idle
//   * steering geometry -> yaw rate (v * tan(delta) / wheelbase)
//   * lean follows the cornering equilibrium tan(phi) = v^2 / (g R) with
//     spring/damper dynamics, so counter-steer transitions read correctly
//   * below walking pace the bike pivots directly (you can turn around in a lane)
//   * independent front/rear suspension driven by the terrain + road roughness
//   * grip budget shared between braking and cornering, surface dependent
//   * it does NOT tip over from normal riding; a lowside needs a real mistake
//
// Units are SI.  State is in three-space (x east, y up, z = -north).

import { clamp, clamp01, lerp, smoothstep, wrapAngle, damp } from '../core/util.js';

const G = 9.81;

export const BIKE_SPECS = {
  // "Sahaja 125" -- an original design in the Indian 125cc commuter idiom.
  sahaja125: {
    id: 'sahaja125',
    name: 'Sahaja 125',
    className: '125cc commuter',
    mass: 118, // kerb, kg
    riderMass: 68,
    wheelbase: 1.285,
    trail: 0.085,
    comHeight: 0.56,
    frontWeightBias: 0.46,
    wheelRadiusF: 0.3175, // 18" rim + tyre
    wheelRadiusR: 0.3175,
    maxSteer: 0.62, // rad at the bars (lock)
    maxLean: 0.74, // rad, ~42 deg
    peakTorque: 10.8, // Nm @ 6500
    peakTorqueRpm: 6500,
    redline: 9200,
    idleRpm: 1350,
    gears: [0, 3.0, 1.9, 1.4, 1.1], // 4-speed, index 0 = neutral
    primary: 3.4,
    finalDrive: 3.1,
    brakeFront: 980, // N of braking force at full lever
    brakeRear: 620,
    dragArea: 0.62, // Cd*A
    rollResist: 0.016,
    suspension: {
      frontTravel: 0.12,
      rearTravel: 0.095,
      frontK: 16500,
      rearK: 22000,
      frontC: 1500,
      rearC: 1900,
    },
    fuelCapacity: 11,
    kmPerLitre: 56,
  },
};

const SURFACE_GRIP = {
  asphalt: 1.0,
  concrete: 0.96,
  gravel: 0.72,
  dirt: 0.64,
  grass: 0.5,
  offroad: 0.55,
};

export class BikePhysics {
  constructor(spec, world) {
    this.spec = spec;
    this.world = world;
    this.reset(0, 0, 0);
  }

  reset(x, z, heading) {
    const s = this.spec;
    this.pos = { x, y: this.world ? this.world.heightAt(x, z) : 0, z };
    this.heading = heading;
    this.speed = 0; // m/s along heading
    this.lateral = 0; // m/s sideways (slip)
    this.vy = 0;
    this.lean = 0;
    this.leanRate = 0;
    this.steer = 0;
    this.yawRate = 0;
    this.pitch = 0;
    this.roll = 0;
    this.gear = 1;
    this.rpm = s.idleRpm;
    this.clutch = 0;
    this.throttle = 0;
    this.brakeInput = 0;
    this.airborne = false;
    this.airTime = 0;
    this.susF = 0.045;
    this.susR = 0.04;
    this.susFv = 0;
    this.susRv = 0;
    this.wheelSpinF = 0;
    this.wheelSpinR = 0;
    this.fuel = s.fuelCapacity * 0.62;
    this.odometer = 0;
    this.engineOn = true;
    this.crashed = false;
    this.crashTimer = 0;
    this.gripLoss = 0;
    this.slideTime = 0;
    this.lastShift = 0;
    this.time = 0;
    this.surface = 'asphalt';
    this.surfaceGrip = 1;
    this.roughness = 0;
    this.bumpImpulse = 0;
    this.slopeAlong = 0;
    this.slopeAcross = 0;
    this.engineLoad = 0;
    this.lastBumpSound = 0;
    this.bumpEvent = 0;
  }

  get totalMass() {
    return this.spec.mass + this.spec.riderMass;
  }

  get speedKmh() {
    return this.speed * 3.6;
  }

  gearRatio(g) {
    return this.spec.gears[g] || 0;
  }

  /** Engine torque (Nm) at rpm, 0..1 throttle. */
  torqueAt(rpm, throttle) {
    const s = this.spec;
    const r = clamp(rpm, 600, s.redline + 400);
    const x = r / s.peakTorqueRpm;
    // Smooth single-peak curve typical of a small air-cooled single.
    let t = s.peakTorque * (1.06 - 0.52 * (x - 1) * (x - 1) - 0.1 * Math.max(0, x - 1.25) ** 2);
    if (r > s.redline) t *= clamp01(1 - (r - s.redline) / 700);
    t = Math.max(0, t);
    const pumping = -s.peakTorque * 0.22 * clamp01((r - 1200) / 4000);
    return t * throttle + pumping * (1 - throttle);
  }

  wheelRpmToEngine(speed) {
    const s = this.spec;
    const g = this.gearRatio(this.gear);
    if (g <= 0) return s.idleRpm;
    const wheelRadS = speed / s.wheelRadiusR;
    return Math.max(s.idleRpm * 0.6, (wheelRadS * g * s.primary * s.finalDrive * 60) / (2 * Math.PI));
  }

  autoShift(dt) {
    const s = this.spec;
    this.lastShift += dt;
    if (this.lastShift < 0.42) return;
    const up = s.redline * 0.80;
    const down = s.redline * 0.33;
    if (this.gear === 0 && this.throttle > 0.05) {
      this.gear = 1;
      this.lastShift = 0;
      return;
    }
    if (this.rpm > up && this.gear < s.gears.length - 1 && this.throttle > 0.25) {
      this.gear++;
      this.lastShift = 0;
      this.clutch = 0.45;
    } else if (this.rpm < down && this.gear > 1) {
      this.gear--;
      this.lastShift = 0;
      this.clutch = 0.3;
    }
  }

  /**
   * @param {object} input  { throttle, brake, steer, hardBrake }
   * @param {object} surf   { grip, roughness, bump, name } sampled by the caller
   */
  step(dt, input, surf) {
    dt = Math.min(dt, 1 / 50);
    this.time += dt;
    const s = this.spec;
    const m = this.totalMass;

    this.surface = surf.name;
    this.surfaceGrip = surf.grip;
    this.roughness = surf.roughness;

    // ------------------------------------------------ crash recovery
    if (this.crashed) {
      this.crashTimer -= dt;
      this.speed = damp(this.speed, 0, 4.5, dt);
      this.lean = damp(this.lean, Math.sign(this.lean || 1) * 1.35, 7, dt);
      this._integratePosition(dt);
      this._suspension(dt, surf);
      if (this.crashTimer <= 0) {
        this.crashed = false;
        this.lean = 0;
        this.leanRate = 0;
        this.gripLoss = 0;
        this.gear = 1;
      }
      return;
    }

    const throttleIn = this.engineOn && this.fuel > 0 ? clamp01(input.throttle) : 0;
    this.throttle = throttleIn;
    const brakeIn = clamp01(Math.max(input.brake, input.hardBrake ? 1 : 0));
    this.brakeInput = brakeIn;

    // ------------------------------------------------ gearbox / engine
    this.autoShift(dt);
    const targetRpm = this.wheelRpmToEngine(Math.abs(this.speed));
    const clutchEngage = clamp01((Math.abs(this.speed) - 0.4) / 2.2);
    this.clutch = Math.max(0, this.clutch - dt * 2.4);
    const engaged = clutchEngage * (1 - this.clutch);
    this.rpm = lerp(this.rpm, Math.max(s.idleRpm, targetRpm), 1 - Math.exp(-(6 + 14 * engaged) * dt));
    if (engaged < 0.4) {
      // free-revving when the clutch is slipping / at a standstill
      const free = lerp(s.idleRpm, s.redline * 0.72, throttleIn);
      this.rpm = lerp(this.rpm, Math.max(this.rpm, free), 1 - Math.exp(-7 * dt));
    }
    this.rpm = clamp(this.rpm, s.idleRpm * 0.5, s.redline + 350);

    const gr = this.gearRatio(this.gear) * s.primary * s.finalDrive;
    const engTorque = this.torqueAt(this.rpm, throttleIn);
    let driveForce = (engTorque * gr * 0.88 * engaged) / s.wheelRadiusR;
    // launch assist: a real rider slips the clutch, so give usable torque from rest
    if (Math.abs(this.speed) < 2.5 && throttleIn > 0.02) {
      driveForce = Math.max(driveForce, throttleIn * 480);
    }
    this.engineLoad = clamp01(Math.abs(driveForce) / 900);

    // ------------------------------------------------ resistances
    const v = this.speed;
    const av = Math.abs(v);
    const drag = 0.5 * 1.2 * s.dragArea * v * av;
    const rr = s.rollResist * m * G * Math.sign(v) * (1 + (1 - surf.grip) * 2.2) * clamp01(av / 0.6);
    const gradeForce = m * G * this.slopeAlong;

    // ------------------------------------------------ brakes
    const frontBias = input.hardBrake ? 0.58 : 0.66;
    let brakeForce = brakeIn * (s.brakeFront * frontBias + s.brakeRear * (1 - frontBias));
    brakeForce *= 0.55 + 0.45 * surf.grip;
    if (av < 0.35) brakeForce *= av / 0.35;

    // reverse / rollback handling: brake holds the bike on a slope
    let accel = (driveForce - drag - rr - gradeForce) / m;
    if (av > 0.05 || Math.abs(accel) > 0.01) {
      accel -= (brakeForce / m) * Math.sign(v || -gradeForce || 1);
    }
    if (brakeIn > 0.5 && av < 0.5 && throttleIn < 0.05) {
      this.speed = damp(this.speed, 0, 12, dt);
    }

    this.speed += accel * dt;
    if (throttleIn < 0.02 && brakeIn > 0.2 && Math.abs(this.speed) < 0.12) this.speed = 0;
    this.speed = clamp(this.speed, -3.5, 62);

    // tiny walking-pace reverse by holding brake+nothing on a downslope is fine,
    // but never let the bike roll backwards under power
    if (this.speed < 0 && throttleIn > 0.05) this.speed = Math.max(this.speed, -0.2);

    // ------------------------------------------------ steering & lean
    const sp = Math.abs(this.speed);
    // Speed-sensitive steering authority: full lock when parking, tight at speed.
    const lockScale = lerp(1.0, 0.16, smoothstep(clamp01((sp - 1.5) / 20)));
    const targetSteer = input.steer * s.maxSteer * lockScale;
    const steerRate = lerp(5.2, 2.6, clamp01(sp / 25));
    this.steer = damp(this.steer, targetSteer, steerRate, dt);

    // Equilibrium lean for the current cornering radius.
    const effWheelbase = s.wheelbase;
    let yawFromSteer = 0;
    let targetLean = 0;
    if (sp > 0.25) {
      const R = effWheelbase / Math.max(1e-3, Math.abs(Math.tan(this.steer)));
      const latA = (sp * sp) / R;
      const maxLat = surf.grip * G * 1.05;
      const latClamped = Math.min(latA, maxLat);
      targetLean = Math.atan(latClamped / G) * Math.sign(this.steer);
      targetLean = clamp(targetLean, -s.maxLean, s.maxLean);
      yawFromSteer = (sp * Math.tan(this.steer)) / effWheelbase;
      // the bike cannot turn harder than grip allows
      const yawLimit = (maxLat / Math.max(sp, 0.5)) * 1.02;
      yawFromSteer = clamp(yawFromSteer, -yawLimit, yawLimit);
      this.gripLoss = clamp01((latA - maxLat) / (maxLat + 1e-3));
    } else {
      // parking speed: pivot directly, no lean
      yawFromSteer = -this.steer * (0.9 + sp * 1.4) * (this.speed >= 0 ? 1 : -1) * 0.55;
      if (sp < 0.04) yawFromSteer = 0;
      targetLean = 0;
      this.gripLoss = 0;
    }

    // Lean dynamics (spring-damper around the equilibrium). Adds the brief
    // counter-steer "fall into the corner" without making it twitchy.
    const leanStiff = lerp(26, 16, clamp01(sp / 26));
    const leanDamp = lerp(8.5, 6.0, clamp01(sp / 26));
    const leanAcc = (targetLean - this.lean) * leanStiff - this.leanRate * leanDamp;
    this.leanRate += leanAcc * dt;
    this.leanRate = clamp(this.leanRate, -7, 7);
    this.lean += this.leanRate * dt;
    this.lean = clamp(this.lean, -s.maxLean * 1.2, s.maxLean * 1.2);

    // Cross-slope pushes the bike downhill slightly -- you feel camber.
    this.lean += this.slopeAcross * 0.25 * dt * clamp01(sp / 3);

    this.yawRate = damp(this.yawRate, yawFromSteer * (this.speed >= 0 ? 1 : -1), 14, dt);
    this.heading = wrapAngle(this.heading + this.yawRate * dt);

    // Lateral slide when grip is exceeded (slides, does not instantly fall).
    const slipTarget = this.gripLoss > 0.02 ? this.gripLoss * sp * 0.55 * Math.sign(this.steer) : 0;
    this.lateral = damp(this.lateral, slipTarget, 5, dt);

    // A sliding tyre scrubs energy. This is what actually saves a rider who
    // asks for more corner than the road has: the bike runs wide and slows
    // until it is back inside the grip budget, instead of simply falling over.
    if (this.gripLoss > 0.02 && sp > 1) {
      const scrub = this.gripLoss * G * 0.34 * surf.grip;
      this.speed -= Math.sign(this.speed) * Math.min(scrub * dt, sp * 0.5);
    }

    // Lowside only on a genuine, *sustained* mistake, and only at speed.
    // A momentary slide is something a rider catches; it is not a crash. The
    // slide has to keep going for a quarter of a second before you lose it.
    // You lose it when you are already at full lean AND still asking for more
    // grip than exists -- not from a single twitch of the bars.
    const atFullLean = Math.abs(this.lean) > s.maxLean * 0.92;
    if (this.gripLoss > 0.85 && sp > 9 && atFullLean) {
      this.slideTime += dt;
    } else {
      this.slideTime = Math.max(0, this.slideTime - dt * 2.2);
    }
    if (this.slideTime > 0.5 && !this.crashed) {
      this.crashed = true;
      this.crashTimer = 1.6;
      this.slideTime = 0;
    }

    this._integratePosition(dt);
    this._suspension(dt, surf);

    // ------------------------------------------------ consumables
    const litresPerMetre = 1 / (s.kmPerLitre * 1000);
    const burn = litresPerMetre * sp * dt * (0.55 + 0.9 * this.engineLoad) + (this.engineOn ? 2.2e-6 : 0);
    this.fuel = Math.max(0, this.fuel - burn);
    this.odometer += sp * dt;
    if (this.fuel <= 0) this.engineOn = true; // engine stays "on" but makes no power
  }

  _integratePosition(dt) {
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const rx = Math.cos(this.heading);
    const rz = -Math.sin(this.heading);
    this.pos.x += (fx * this.speed + rx * this.lateral) * dt;
    this.pos.z += (fz * this.speed + rz * this.lateral) * dt;
    const half = this.world.half - 12;
    this.pos.x = clamp(this.pos.x, -half, half);
    this.pos.z = clamp(this.pos.z, -half, half);
  }

  /** Contact points, suspension travel and the slopes the engine feels. */
  _suspension(dt, surf) {
    const s = this.spec;
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const halfWB = s.wheelbase * 0.5;

    const fxp = this.pos.x + fx * halfWB;
    const fzp = this.pos.z + fz * halfWB;
    const rxp = this.pos.x - fx * halfWB;
    const rzp = this.pos.z - fz * halfWB;

    const hF = this.world.heightAt(fxp, fzp) + surf.frontOffset;
    const hR = this.world.heightAt(rxp, rzp) + surf.rearOffset;

    // Ride height target follows the mean contact height.
    const groundY = (hF + hR) * 0.5;
    const targetY = groundY + s.wheelRadiusR;

    // vertical spring for the chassis (keeps wheels planted over bumps)
    const dy = targetY - this.pos.y;
    this.vy += (dy * 420 - this.vy * 34) * dt;
    this.vy = clamp(this.vy, -14, 14);
    this.pos.y += this.vy * dt;
    if (Math.abs(dy) > 1.6) {
      this.pos.y = targetY;
      this.vy = 0;
    }

    // suspension travel from the difference between wheel ground and chassis
    const restF = s.suspension.frontTravel * 0.38;
    const restR = s.suspension.rearTravel * 0.42;
    const brakeDive = this.brakeInput * 0.035;
    const accelSquat = clamp01(this.engineLoad) * 0.028;
    const compF = clamp(restF + brakeDive - accelSquat * 0.4 + (hF - groundY) * 0.85, 0, s.suspension.frontTravel);
    const compR = clamp(restR + accelSquat - brakeDive * 0.3 + (hR - groundY) * 0.85, 0, s.suspension.rearTravel);
    this.susFv += ((compF - this.susF) * 320 - this.susFv * 26) * dt;
    this.susRv += ((compR - this.susR) * 380 - this.susRv * 28) * dt;
    this.susF = clamp(this.susF + this.susFv * dt, 0, s.suspension.frontTravel);
    this.susR = clamp(this.susR + this.susRv * dt, 0, s.suspension.rearTravel);

    // pitch from the contact plane plus suspension attitude
    const alongSlope = (hF - hR) / s.wheelbase;
    this.slopeAlong = alongSlope;
    this.pitch = damp(this.pitch, -Math.atan(alongSlope) + (this.susF - this.susR) * 0.9, 12, dt);

    // cross slope
    const sideX = Math.cos(this.heading);
    const sideZ = -Math.sin(this.heading);
    const hL = this.world.heightAt(this.pos.x - sideX * 0.42, this.pos.z - sideZ * 0.42);
    const hRt = this.world.heightAt(this.pos.x + sideX * 0.42, this.pos.z + sideZ * 0.42);
    this.slopeAcross = (hRt - hL) / 0.84;
    this.roll = damp(this.roll, -Math.atan(this.slopeAcross), 10, dt);

    // bump detection for audio + haptics
    const jolt = Math.abs(this.susFv) + Math.abs(this.susRv);
    this.bumpEvent = 0;
    if (jolt > 1.1 && this.time - this.lastBumpSound > 0.11) {
      this.lastBumpSound = this.time;
      this.bumpEvent = clamp01((jolt - 1.1) / 3.2);
    }

    this.wheelSpinF += (this.speed / s.wheelRadiusF) * dt;
    this.wheelSpinR += (this.speed / s.wheelRadiusR) * dt;
  }
}

export function surfaceGripFor(name) {
  return SURFACE_GRIP[name] ?? 0.8;
}
