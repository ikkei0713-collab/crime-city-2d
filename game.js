'use strict';

// ============================================================
// CONSTANTS
// ============================================================
const TILE_SIZE = 40;
const WORLD_W = 2000;
const WORLD_H = 2000;
const COLS = Math.floor(WORLD_W / TILE_SIZE);
const ROWS = Math.floor(WORLD_H / TILE_SIZE);

const TILE_ROAD      = 0;
const TILE_SIDEWALK  = 1;
const TILE_BUILDING  = 2;
const TILE_LOT       = 3;

const TWO_PI = Math.PI * 2;
const DEG2RAD = Math.PI / 180;

// Colors
const COLOR_ROAD      = '#2a2a2a';
const COLOR_SIDEWALK  = '#4a4a4a';
const COLOR_BUILDING  = '#5a5a6a';
const COLOR_LOT       = '#3a3a3a';
const COLOR_ROAD_LINE = '#cccc44';

// ============================================================
// MATH UTILITIES
// ============================================================
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }
function dist(ax, ay, bx, by) { return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2); }
function normalizeAngle(a) {
  while (a > Math.PI) a -= TWO_PI;
  while (a < -Math.PI) a += TWO_PI;
  return a;
}
function randRange(a, b) { return a + Math.random() * (b - a); }
function randInt(a, b) { return Math.floor(randRange(a, b + 1)); }
function angleToVec(a) { return { x: Math.cos(a), y: Math.sin(a) }; }
function vecAngle(x, y) { return Math.atan2(y, x); }

// AABB overlap
function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// ============================================================
// WORLD
// ============================================================
class World {
  constructor() {
    this.tiles = new Uint8Array(COLS * ROWS);
    this.generate();
  }

  generate() {
    // Fill everything as buildings first
    this.tiles.fill(TILE_BUILDING);

    // Major horizontal roads every 7-10 tiles
    const hRoads = [];
    const vRoads = [];

    for (let r = 3; r < ROWS - 3; r += randInt(7, 11)) {
      hRoads.push(r);
      // Road is 2 tiles wide
      for (let c = 0; c < COLS; c++) {
        this.set(c, r, TILE_ROAD);
        this.set(c, r + 1, TILE_ROAD);
      }
    }
    for (let c = 3; c < COLS - 3; c += randInt(7, 11)) {
      vRoads.push(c);
      for (let r = 0; r < ROWS; r++) {
        this.set(c, r, TILE_ROAD);
        this.set(c + 1, r, TILE_ROAD);
      }
    }

    // Sidewalks border roads
    for (const r of hRoads) {
      for (let c = 0; c < COLS; c++) {
        if (this.get(c, r - 1) === TILE_BUILDING) this.set(c, r - 1, TILE_SIDEWALK);
        if (this.get(c, r + 2) === TILE_BUILDING) this.set(c, r + 2, TILE_SIDEWALK);
      }
    }
    for (const c of vRoads) {
      for (let r = 0; r < ROWS; r++) {
        if (this.get(c - 1, r) === TILE_BUILDING) this.set(c - 1, r, TILE_SIDEWALK);
        if (this.get(c + 2, r) === TILE_BUILDING) this.set(c + 2, r, TILE_SIDEWALK);
      }
    }

    // Some building blocks become empty lots
    for (let i = 0; i < COLS * ROWS; i++) {
      if (this.tiles[i] === TILE_BUILDING && Math.random() < 0.05) {
        this.tiles[i] = TILE_LOT;
      }
    }

    // Store road lists for AI
    this.hRoads = hRoads;
    this.vRoads = vRoads;

    // Build road center list for pathfinding
    this.roadCenters = [];
    for (const r of hRoads) {
      this.roadCenters.push({ axis: 'h', row: r, col: -1 });
    }
    for (const c of vRoads) {
      this.roadCenters.push({ axis: 'v', col: c, row: -1 });
    }
  }

  idx(c, r) { return r * COLS + c; }
  get(c, r) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return TILE_BUILDING;
    return this.tiles[this.idx(c, r)];
  }
  set(c, r, v) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return;
    this.tiles[this.idx(c, r)] = v;
  }

  tileAt(wx, wy) {
    const c = Math.floor(wx / TILE_SIZE);
    const r = Math.floor(wy / TILE_SIZE);
    return this.get(c, r);
  }

  isRoad(wx, wy) { return this.tileAt(wx, wy) === TILE_ROAD; }
  isWalkable(wx, wy) {
    const t = this.tileAt(wx, wy);
    return t === TILE_ROAD || t === TILE_SIDEWALK || t === TILE_LOT;
  }
  isSolid(wx, wy) { return this.tileAt(wx, wy) === TILE_BUILDING; }

  // Pick a random road position
  randomRoadPos() {
    let wx, wy;
    let tries = 0;
    do {
      wx = randRange(20, WORLD_W - 20);
      wy = randRange(20, WORLD_H - 20);
      tries++;
    } while (!this.isRoad(wx, wy) && tries < 200);
    return { x: wx, y: wy };
  }

  randomSidewalkPos() {
    let wx, wy;
    let tries = 0;
    do {
      wx = randRange(20, WORLD_W - 20);
      wy = randRange(20, WORLD_H - 20);
      tries++;
    } while (this.tileAt(wx, wy) !== TILE_SIDEWALK && tries < 200);
    return { x: wx, y: wy };
  }

  // Draw visible tiles
  draw(ctx, camera) {
    const startC = Math.max(0, Math.floor((camera.x - camera.vw / 2) / TILE_SIZE));
    const endC   = Math.min(COLS, Math.ceil((camera.x + camera.vw / 2) / TILE_SIZE) + 1);
    const startR = Math.max(0, Math.floor((camera.y - camera.vh / 2) / TILE_SIZE));
    const endR   = Math.min(ROWS, Math.ceil((camera.y + camera.vh / 2) / TILE_SIZE) + 1);

    for (let r = startR; r < endR; r++) {
      for (let c = startC; c < endC; c++) {
        const t = this.get(c, r);
        const wx = c * TILE_SIZE;
        const wy = r * TILE_SIZE;
        switch (t) {
          case TILE_ROAD:     ctx.fillStyle = COLOR_ROAD; break;
          case TILE_SIDEWALK: ctx.fillStyle = COLOR_SIDEWALK; break;
          case TILE_BUILDING: ctx.fillStyle = COLOR_BUILDING; break;
          case TILE_LOT:      ctx.fillStyle = COLOR_LOT; break;
        }
        ctx.fillRect(wx, wy, TILE_SIZE, TILE_SIZE);

        // Building detail
        if (t === TILE_BUILDING) {
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.fillRect(wx + 2, wy + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        }
      }
    }

    // Road center lines (dashes)
    ctx.strokeStyle = COLOR_ROAD_LINE;
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 12]);
    for (const r of this.hRoads) {
      const wy = (r + 1) * TILE_SIZE;
      if (wy < camera.y - camera.vh / 2 || wy > camera.y + camera.vh / 2) continue;
      ctx.beginPath();
      ctx.moveTo(startC * TILE_SIZE, wy);
      ctx.lineTo(endC * TILE_SIZE, wy);
      ctx.stroke();
    }
    for (const c of this.vRoads) {
      const wx = (c + 1) * TILE_SIZE;
      if (wx < camera.x - camera.vw / 2 || wx > camera.x + camera.vw / 2) continue;
      ctx.beginPath();
      ctx.moveTo(wx, startR * TILE_SIZE);
      ctx.lineTo(wx, endR * TILE_SIZE);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
}

// ============================================================
// ENTITY BASE
// ============================================================
class Entity {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.active = true;
  }
}

// ============================================================
// BULLET
// ============================================================
class Bullet extends Entity {
  constructor(x, y, angle, owner, damage) {
    super(x, y);
    this.angle = angle;
    this.speed = 500;
    this.owner = owner; // 'player' | 'police'
    this.damage = damage || 25;
    this.life = 1.2;
    this.vx = Math.cos(angle) * this.speed;
    this.vy = Math.sin(angle) * this.speed;
    this.radius = 3;
  }

  update(dt, world, game) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) { this.active = false; return; }
    if (world.isSolid(this.x, this.y)) { this.active = false; return; }

    // Hit vehicles
    for (const v of game.vehicles) {
      if (!v.active) continue;
      if (Math.abs(this.x - v.x) < v.width / 2 + 2 && Math.abs(this.y - v.y) < v.height / 2 + 2) {
        v.hp -= this.damage;
        if (v.hp <= 0) {
          game.explodeVehicle(v);
        }
        this.active = false;
        if (this.owner === 'player') {
          game.addScore(10);
          game.wanted.increase(0.2);
        }
        return;
      }
    }

    // Hit pedestrians
    for (const p of game.pedestrians) {
      if (!p.active || p.isDead) continue;
      if (dist(this.x, this.y, p.x, p.y) < p.radius + 2) {
        p.hp -= this.damage;
        if (p.hp <= 0) {
          p.isDead = true;
          if (this.owner === 'player') {
            game.wanted.increase(1);
            game.addScore(50);
            game.addCash(25);
          }
        }
        this.active = false;
        return;
      }
    }

    // Hit player
    if (this.owner === 'police') {
      const pl = game.player;
      if (dist(this.x, this.y, pl.x, pl.y) < 10) {
        if (pl.armor > 0) {
          pl.armor -= this.damage;
          if (pl.armor < 0) { pl.hp += pl.armor; pl.armor = 0; }
        } else {
          pl.hp -= this.damage;
        }
        if (pl.hp <= 0) game.playerDied();
        this.active = false;
        return;
      }
    }

    // Hit police
    if (this.owner === 'player') {
      for (const cop of game.police) {
        if (!cop.active) continue;
        if (dist(this.x, this.y, cop.x, cop.y) < 14) {
          cop.hp -= this.damage;
          if (cop.hp <= 0) {
            cop.active = false;
            game.addScore(100);
            game.addCash(50);
            game.wanted.increase(2);
          }
          this.active = false;
          return;
        }
      }
    }
  }

  draw(ctx) {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, TWO_PI);
    ctx.fillStyle = this.owner === 'player' ? '#ffff00' : '#ff4444';
    ctx.fill();
  }
}

// ============================================================
// EXPLOSION
// ============================================================
class Explosion {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.life = 1.0;
    this.maxLife = 1.0;
    this.active = true;
    this.particles = [];
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * TWO_PI;
      const speed = randRange(40, 150);
      this.particles.push({
        x: x, y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: Math.random() * 0.8 + 0.2,
        maxLife: 1,
        radius: randRange(2, 6)
      });
    }
  }

  update(dt) {
    this.life -= dt;
    if (this.life <= 0) { this.active = false; return; }
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.95;
      p.vy *= 0.95;
      p.life -= dt;
    }
  }

  draw(ctx) {
    const t = this.life / this.maxLife;
    const r = (1 - t) * 60 + 10;
    // Main flash
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, TWO_PI);
    ctx.fillStyle = `rgba(255,${Math.floor(t * 200)},0,${t * 0.8})`;
    ctx.fill();

    for (const p of this.particles) {
      if (p.life <= 0) continue;
      const pt = p.life / p.maxLife;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * pt, 0, TWO_PI);
      ctx.fillStyle = `rgba(255,${Math.floor(pt * 180)},0,${pt})`;
      ctx.fill();
    }
  }
}

// ============================================================
// PICKUP
// ============================================================
class Pickup extends Entity {
  constructor(x, y, type) {
    super(x, y);
    this.type = type; // 'health'|'armor'|'cash'|'pistol'|'shotgun'|'uzi'
    this.radius = 12;
    this.bobT = Math.random() * TWO_PI;
    this.collected = false;
  }

  update(dt) {
    this.bobT += dt * 2;
  }

  draw(ctx) {
    const bob = Math.sin(this.bobT) * 3;
    ctx.save();
    ctx.translate(this.x, this.y + bob);

    const colors = {
      health: '#44ff44',
      armor: '#4444ff',
      cash: '#ffdd00',
      pistol: '#aaaaaa',
      shotgun: '#cc8833',
      uzi: '#cc3333'
    };
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, TWO_PI);
    ctx.fillStyle = colors[this.type] || '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#000';
    ctx.font = 'bold 9px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labels = { health: 'HP', armor: 'AR', cash: '$', pistol: 'P', shotgun: 'SG', uzi: 'UZ' };
    ctx.fillText(labels[this.type] || '?', 0, 0);
    ctx.restore();
  }
}

// ============================================================
// PEDESTRIAN
// ============================================================
class Pedestrian extends Entity {
  constructor(x, y) {
    super(x, y);
    this.radius = 7;
    this.hp = 50;
    this.isDead = false;
    this.deadTimer = 0;

    this.speed = randRange(30, 55);
    this.angle = Math.random() * TWO_PI;
    this.walkT = Math.random() * TWO_PI;

    this.state = 'walk'; // 'walk' | 'flee' | 'idle'
    this.idleTimer = 0;
    this.targetX = x;
    this.targetY = y;
    this.fleeFrom = null;
    this.fleeTimer = 0;

    // Visual
    this.color = `hsl(${randInt(0, 360)},60%,65%)`;
    this.shirtColor = `hsl(${randInt(0, 360)},70%,55%)`;
  }

  update(dt, world, player, vehicles) {
    if (this.isDead) {
      this.deadTimer += dt;
      if (this.deadTimer > 8) this.active = false;
      return;
    }

    this.walkT += dt * 5;

    // Check for nearby threats
    const dPlayer = dist(this.x, this.y, player.x, player.y);
    let flee = false;

    if (dPlayer < 120 && (player.inVehicle || player.shooting)) {
      flee = true;
      this.fleeFrom = { x: player.x, y: player.y };
      this.fleeTimer = 3;
      this.state = 'flee';
    }

    for (const v of vehicles) {
      if (!v.active) continue;
      if (dist(this.x, this.y, v.x, v.y) < 80 && v.speed > 30) {
        flee = true;
        this.fleeFrom = { x: v.x, y: v.y };
        this.fleeTimer = 2;
        this.state = 'flee';
        break;
      }
    }

    if (!flee && this.fleeTimer > 0) {
      this.fleeTimer -= dt;
      if (this.fleeTimer <= 0) {
        this.state = 'walk';
        this.fleeFrom = null;
      }
    }

    const spd = this.state === 'flee' ? this.speed * 2.2 : this.speed;

    if (this.state === 'flee' && this.fleeFrom) {
      const awayAngle = Math.atan2(this.y - this.fleeFrom.y, this.x - this.fleeFrom.x);
      this.angle = awayAngle;
    } else {
      // Random walk on sidewalks
      if (dist(this.x, this.y, this.targetX, this.targetY) < 20 || this.idleTimer > 0) {
        this.idleTimer -= dt;
        if (this.idleTimer <= 0) {
          const a = this.angle + randRange(-0.8, 0.8);
          const tx = this.x + Math.cos(a) * randRange(80, 200);
          const ty = this.y + Math.sin(a) * randRange(80, 200);
          if (world.isWalkable(tx, ty) && !world.isRoad(tx, ty)) {
            this.targetX = clamp(tx, 10, WORLD_W - 10);
            this.targetY = clamp(ty, 10, WORLD_H - 10);
          }
          this.idleTimer = randRange(0.5, 2);
        }
      }
      const tAngle = Math.atan2(this.targetY - this.y, this.targetX - this.x);
      this.angle = lerp(this.angle, tAngle, 0.1);
    }

    const nx = this.x + Math.cos(this.angle) * spd * dt;
    const ny = this.y + Math.sin(this.angle) * spd * dt;

    // Collision with world
    if (world.isWalkable(nx, this.y)) this.x = clamp(nx, 5, WORLD_W - 5);
    if (world.isWalkable(this.x, ny)) this.y = clamp(ny, 5, WORLD_H - 5);

    // Run over by fast vehicles
    for (const v of vehicles) {
      if (!v.active || v.driver) continue;
      if (Math.abs(this.x - v.x) < v.width / 2 + 4 && Math.abs(this.y - v.y) < v.height / 2 + 4) {
        if (v.speed > 40) {
          this.hp -= v.speed * 0.3 * dt;
          if (this.hp <= 0 && !this.isDead) {
            this.isDead = true;
          }
        }
      }
    }
  }

  draw(ctx) {
    if (this.isDead) {
      // Draw dead body
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.beginPath();
      ctx.ellipse(0, 0, this.radius + 2, this.radius - 2, 0, 0, TWO_PI);
      ctx.fillStyle = '#aa3333';
      ctx.fill();
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // Body
    ctx.fillStyle = this.shirtColor;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, TWO_PI);
    ctx.fill();

    // Head
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.radius * 0.3, 0, this.radius * 0.55, 0, TWO_PI);
    ctx.fill();

    ctx.restore();
  }
}

// ============================================================
// VEHICLE
// ============================================================
const VEHICLE_TYPES = [
  { name: 'sedan',  color: '#cc4444', width: 30, height: 18, maxSpeed: 220, accel: 180, handling: 3.2, brakeForce: 300 },
  { name: 'truck',  color: '#aa6633', width: 40, height: 22, maxSpeed: 160, accel: 120, handling: 2.5, brakeForce: 250 },
  { name: 'sports', color: '#4488ff', width: 28, height: 16, maxSpeed: 300, accel: 250, handling: 4.0, brakeForce: 350 },
  { name: 'police', color: '#2255ff', width: 30, height: 18, maxSpeed: 240, accel: 200, handling: 3.5, brakeForce: 320 },
  { name: 'swat',   color: '#334433', width: 40, height: 22, maxSpeed: 180, accel: 140, handling: 2.8, brakeForce: 270 },
];

class Vehicle extends Entity {
  constructor(x, y, typeIdx) {
    super(x, y);
    this.typeIdx = typeIdx !== undefined ? typeIdx : randInt(0, 2);
    const t = VEHICLE_TYPES[this.typeIdx];
    this.name     = t.name;
    this.color    = t.color;
    this.width    = t.width;
    this.height   = t.height;
    this.maxSpeed = t.maxSpeed;
    this.accel    = t.accel;
    this.handling = t.handling;
    this.brakeForce = t.brakeForce;

    this.angle   = Math.random() * TWO_PI;
    this.speed   = 0;
    this.vx      = 0;
    this.vy      = 0;
    this.steer   = 0; // -1 to 1
    this.driver  = null; // 'player' | AI ref
    this.hp      = 150;
    this.maxHp   = 150;
    this.smoke   = 0;
    this.isParked = false;
    this.isPolice = (this.name === 'police' || this.name === 'swat');

    // Traffic AI state
    this.aiState = 'idle'; // 'drive' | 'stop' | 'idle'
    this.aiTimer = 0;
    this.aiTarget = null;
    this.aiAngle  = this.angle;
    this.honkTimer = 0;
  }

  get halfW() { return this.width / 2; }
  get halfH() { return this.height / 2; }

  update(dt, world, input, game) {
    if (this.driver === 'player') {
      this._updatePlayerDriven(dt, input, world, game);
    } else if (this.driver && this.driver.isPolice) {
      this._updatePoliceDriven(dt, world, game);
    } else if (!this.isParked) {
      this._updateTraffic(dt, world, game);
    }

    // Apply friction
    if (!this.driver) {
      this.speed *= Math.pow(0.85, dt * 60);
      if (Math.abs(this.speed) < 0.5) this.speed = 0;
      this.vx = Math.cos(this.angle) * this.speed;
      this.vy = Math.sin(this.angle) * this.speed;
    }

    // Smoke when damaged
    this.smoke = Math.max(0, 1 - this.hp / this.maxHp);
  }

  _updatePlayerDriven(dt, input, world, game) {
    const gas      = input.gas;
    const brake    = input.brake;
    const steerDir = input.steer;
    const handbrake = input.handbrake;

    const FRICTION    = handbrake ? 0.92 : 0.98;
    const MAX_STEER   = this.handling;

    // Acceleration / braking
    if (gas > 0) {
      this.speed = Math.min(this.speed + this.accel * gas * dt, this.maxSpeed);
    } else if (brake > 0) {
      if (this.speed > 5) {
        this.speed -= this.brakeForce * brake * dt;
      } else {
        this.speed = Math.max(this.speed - this.accel * 0.6 * brake * dt, -this.maxSpeed * 0.4);
      }
    } else {
      this.speed *= Math.pow(FRICTION, dt * 60);
    }

    if (handbrake) {
      this.speed *= Math.pow(0.88, dt * 60);
    }

    if (Math.abs(this.speed) < 0.5) this.speed = 0;

    // Steering (speed-dependent)
    if (Math.abs(this.speed) > 5) {
      const steerFactor = clamp(Math.abs(this.speed) / 80, 0.1, 1.0);
      const steerRate = MAX_STEER * steerFactor * (handbrake ? 1.6 : 1.0);
      const dir = this.speed >= 0 ? 1 : -1;
      this.angle += steerDir * steerRate * dir * dt;
    }

    // Velocity
    this.vx = Math.cos(this.angle) * this.speed;
    this.vy = Math.sin(this.angle) * this.speed;

    this._moveWithCollision(dt, world, game);

    // Update player position
    game.player.x = this.x;
    game.player.y = this.y;
  }

  _updatePoliceDriven(dt, world, game) {
    const target = game.player;
    const targetAngle = Math.atan2(target.y - this.y, target.x - this.x);
    const angleDiff = normalizeAngle(targetAngle - this.angle);

    // Steer toward player
    this.angle += clamp(angleDiff, -3 * dt, 3 * dt);
    this.speed = Math.min(this.speed + this.accel * dt, this.maxSpeed * 0.85);

    this.vx = Math.cos(this.angle) * this.speed;
    this.vy = Math.sin(this.angle) * this.speed;
    this._moveWithCollision(dt, world, game);

    // Shoot if close and no obstacle
    this.driver.shootTimer = (this.driver.shootTimer || 0) + dt;
    if (this.driver.shootTimer > 1.5 && dist(this.x, this.y, target.x, target.y) < 300) {
      this.driver.shootTimer = 0;
      const a = targetAngle + randRange(-0.3, 0.3);
      game.bullets.push(new Bullet(this.x, this.y, a, 'police', 20));
    }
  }

  _updateTraffic(dt, world, game) {
    this.aiTimer -= dt;

    if (this.aiState === 'idle') {
      if (this.aiTimer <= 0) {
        this.aiState = 'drive';
        this.aiTimer = randRange(3, 8);
        const p = world.randomRoadPos();
        this.aiTarget = p;
      }
      return;
    }

    if (this.aiState === 'stop') {
      if (this.aiTimer <= 0) {
        this.aiState = 'drive';
        this.aiTimer = randRange(2, 5);
      }
      this.speed *= Math.pow(0.85, dt * 60);
      this.vx = Math.cos(this.angle) * this.speed;
      this.vy = Math.sin(this.angle) * this.speed;
      this._moveWithCollision(dt, world, game);
      return;
    }

    // Driving
    if (!this.aiTarget || dist(this.x, this.y, this.aiTarget.x, this.aiTarget.y) < 40) {
      this.aiTarget = world.randomRoadPos();
      this.aiTimer = randRange(3, 8);
    }

    const targetAngle = Math.atan2(this.aiTarget.y - this.y, this.aiTarget.x - this.x);
    const angleDiff = normalizeAngle(targetAngle - this.angle);
    this.angle += clamp(angleDiff, -2.5 * dt, 2.5 * dt);

    // Check for road — stop if off road
    if (!world.isRoad(this.x + Math.cos(this.angle) * 20, this.y + Math.sin(this.angle) * 20)) {
      this.aiState = 'stop';
      this.aiTimer = 1.5;
      return;
    }

    this.speed = Math.min(this.speed + this.accel * 0.5 * dt, this.maxSpeed * 0.6);
    this.vx = Math.cos(this.angle) * this.speed;
    this.vy = Math.sin(this.angle) * this.speed;
    this._moveWithCollision(dt, world, game);
  }

  _moveWithCollision(dt, world, game) {
    const nx = this.x + this.vx * dt;
    const ny = this.y + this.vy * dt;

    const hw = this.halfW + 2;
    const hh = this.halfH + 2;

    // Check corners
    const corners = [
      { x: nx - hw, y: ny - hh },
      { x: nx + hw, y: ny - hh },
      { x: nx - hw, y: ny + hh },
      { x: nx + hw, y: ny + hh },
    ];

    let canX = true, canY = true;
    for (const c of corners) {
      if (world.isSolid(c.x, this.y)) canX = false;
      if (world.isSolid(this.x, c.y)) canY = false;
    }

    // Also check with current y for x movement
    const cxCorners = [
      { x: nx - hw, y: this.y - hh },
      { x: nx + hw, y: this.y - hh },
      { x: nx - hw, y: this.y + hh },
      { x: nx + hw, y: this.y + hh },
    ];
    for (const c of cxCorners) {
      if (world.isSolid(c.x, c.y)) canX = false;
    }
    const cyCorners = [
      { x: this.x - hw, y: ny - hh },
      { x: this.x + hw, y: ny - hh },
      { x: this.x - hw, y: ny + hh },
      { x: this.x + hw, y: ny + hh },
    ];
    for (const c of cyCorners) {
      if (world.isSolid(c.x, c.y)) canY = false;
    }

    if (canX) this.x = clamp(nx, hw, WORLD_W - hw);
    else { this.speed *= -0.3; this.vx *= -0.3; this._damage(Math.abs(this.speed) * 0.1); }

    if (canY) this.y = clamp(ny, hh, WORLD_H - hh);
    else { this.speed *= -0.3; this.vy *= -0.3; this._damage(Math.abs(this.speed) * 0.1); }

    // Vehicle-vehicle collision
    for (const v of game.vehicles) {
      if (v === this || !v.active) continue;
      const dx = this.x - v.x;
      const dy = this.y - v.y;
      const minDist = (this.halfW + v.halfW + 2);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < minDist && d > 0.1) {
        const push = (minDist - d) / d;
        const impactSpeed = Math.abs(this.speed) + Math.abs(v.speed);
        const dmg = impactSpeed * 0.05;
        if (dmg > 2) {
          this._damage(dmg);
          v._damage(dmg);
          if (this.driver === 'player') {
            game.player.hp -= dmg * 0.3;
            if (game.player.hp <= 0) game.playerDied();
          }
        }
        if (!v.isParked) {
          v.x -= dx * push * 0.5;
          v.y -= dy * push * 0.5;
        }
        this.x += dx * push * 0.5;
        this.y += dy * push * 0.5;
      }
    }
  }

  _damage(amt) {
    if (amt < 1) return;
    this.hp -= amt;
  }

  draw(ctx, isPlayerVehicle) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    const hw = this.halfW;
    const hh = this.halfH;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(-hw + 3, -hh + 3, this.width, this.height);

    // Body
    let bodyColor = this.color;
    if (this.hp < this.maxHp * 0.3) bodyColor = '#555';
    else if (this.hp < this.maxHp * 0.6) bodyColor = '#888';
    ctx.fillStyle = bodyColor;
    ctx.fillRect(-hw, -hh, this.width, this.height);

    // Windshield
    ctx.fillStyle = 'rgba(150,220,255,0.6)';
    ctx.fillRect(hw * 0.1, -hh * 0.7, hw * 0.6, hh * 1.4);

    // Headlights
    ctx.fillStyle = '#ffffcc';
    ctx.fillRect(hw - 3, -hh * 0.6, 3, hh * 0.5);
    ctx.fillRect(hw - 3, hh * 0.1, 3, hh * 0.5);

    // Rear lights
    ctx.fillStyle = '#ff3333';
    ctx.fillRect(-hw, -hh * 0.6, 3, hh * 0.5);
    ctx.fillRect(-hw, hh * 0.1, 3, hh * 0.5);

    // Direction arrow
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.moveTo(hw + 4, 0);
    ctx.lineTo(hw - 3, -4);
    ctx.lineTo(hw - 3, 4);
    ctx.closePath();
    ctx.fill();

    // Police light bar
    if (this.isPolice) {
      const t = Date.now() / 200;
      ctx.fillStyle = Math.sin(t) > 0 ? '#ff3333' : '#3333ff';
      ctx.fillRect(-4, -hh - 4, 8, 4);
    }

    // Smoke
    if (this.smoke > 0.3) {
      for (let i = 0; i < 3; i++) {
        const sx = randRange(-5, 5);
        const sy = randRange(-5, 5);
        ctx.beginPath();
        ctx.arc(sx, sy, randRange(2, 6) * this.smoke, 0, TWO_PI);
        ctx.fillStyle = `rgba(100,100,100,${this.smoke * 0.5})`;
        ctx.fill();
      }
    }

    // HP bar (on damaged vehicles)
    if (this.hp < this.maxHp) {
      const bw = this.width;
      const bh = 3;
      const by = -hh - 8;
      ctx.fillStyle = '#333';
      ctx.fillRect(-hw, by, bw, bh);
      ctx.fillStyle = this.hp / this.maxHp > 0.5 ? '#44ff44' : '#ff4444';
      ctx.fillRect(-hw, by, bw * (this.hp / this.maxHp), bh);
    }

    if (isPlayerVehicle) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-hw - 2, -hh - 2, this.width + 4, this.height + 4);
    }

    ctx.restore();
  }
}

// ============================================================
// POLICE OFFICER (on foot)
// ============================================================
class PoliceOfficer extends Entity {
  constructor(x, y, game) {
    super(x, y);
    this.radius = 9;
    this.hp = 60;
    this.maxHp = 60;
    this.speed = 90;
    this.angle = 0;
    this.shootTimer = 0;
    this.isPolice = true;
    this.game = game;
    this.state = 'chase'; // 'chase' | 'shoot' | 'dead'
  }

  update(dt, world, game) {
    if (this.hp <= 0) { this.active = false; return; }

    const px = game.player.x;
    const py = game.player.y;
    const d = dist(this.x, this.y, px, py);
    const targetAngle = Math.atan2(py - this.y, px - this.x);

    if (d > 250) {
      // Chase
      this.angle = lerp(this.angle, targetAngle, 0.1);
      const nx = this.x + Math.cos(this.angle) * this.speed * dt;
      const ny = this.y + Math.sin(this.angle) * this.speed * dt;
      if (world.isWalkable(nx, this.y)) this.x = nx;
      if (world.isWalkable(this.x, ny)) this.y = ny;
    } else {
      // Shoot range
      this.angle = targetAngle;
      this.shootTimer += dt;
      if (this.shootTimer > 1.2) {
        this.shootTimer = 0;
        const a = targetAngle + randRange(-0.25, 0.25);
        game.bullets.push(new Bullet(this.x, this.y, a, 'police', 20));
      }
    }

    this.x = clamp(this.x, 5, WORLD_W - 5);
    this.y = clamp(this.y, 5, WORLD_H - 5);
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // Body (blue uniform)
    ctx.fillStyle = '#2255dd';
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, TWO_PI);
    ctx.fill();

    // Head
    ctx.fillStyle = '#ffccaa';
    ctx.beginPath();
    ctx.arc(this.radius * 0.35, 0, this.radius * 0.55, 0, TWO_PI);
    ctx.fill();

    // Cap
    ctx.fillStyle = '#003388';
    ctx.beginPath();
    ctx.arc(this.radius * 0.35, 0, this.radius * 0.35, -Math.PI, 0);
    ctx.fill();

    // Gun direction
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.radius * 0.35, 0);
    ctx.lineTo(this.radius * 1.5, 0);
    ctx.stroke();

    ctx.restore();

    // HP bar
    if (this.hp < this.maxHp) {
      ctx.fillStyle = '#333';
      ctx.fillRect(this.x - 10, this.y - 16, 20, 3);
      ctx.fillStyle = '#44ff44';
      ctx.fillRect(this.x - 10, this.y - 16, 20 * (this.hp / this.maxHp), 3);
    }
  }
}

// ============================================================
// PLAYER
// ============================================================
class Player extends Entity {
  constructor(x, y) {
    super(x, y);
    this.hp     = 100;
    this.maxHp  = 100;
    this.armor  = 0;
    this.maxArmor = 100;
    this.cash   = 500;
    this.score  = 0;

    this.speed  = 120;
    this.angle  = 0;
    this.radius = 10;

    this.inVehicle = null;  // Vehicle reference or null
    this.shooting  = false;
    this.shootTimer = 0;
    this.shootCooldown = 0.25;

    this.weapon = 'pistol';
    this.weapons = { pistol: 999, shotgun: 0, uzi: 0 };
    this.ammo    = this.weapons;

    this.color = '#ff6644';
    this.walkT  = 0;
  }

  update(dt, input, world, game) {
    if (this.inVehicle) {
      // Position updated by vehicle
      this.angle = this.inVehicle.angle;
      this.shooting = false;
    } else {
      this._updateOnFoot(dt, input, world, game);
    }

    this.shootTimer = Math.max(0, this.shootTimer - dt);

    // Clamp
    this.x = clamp(this.x, 5, WORLD_W - 5);
    this.y = clamp(this.y, 5, WORLD_H - 5);
  }

  _updateOnFoot(dt, input, world, game) {
    const moveX = input.moveX;
    const moveY = input.moveY;
    this.shooting = input.shoot;

    if (Math.abs(moveX) > 0.1 || Math.abs(moveY) > 0.1) {
      this.angle = Math.atan2(moveY, moveX);
      this.walkT += dt * 8;

      const nx = this.x + moveX * this.speed * dt;
      const ny = this.y + moveY * this.speed * dt;

      if (!world.isSolid(nx, this.y) && !this._collidesWithVehicles(nx, this.y, game)) {
        this.x = nx;
      }
      if (!world.isSolid(this.x, ny) && !this._collidesWithVehicles(this.x, ny, game)) {
        this.y = ny;
      }
    }

    // Shoot
    if (input.shoot && this.shootTimer <= 0 && this.ammo[this.weapon] > 0) {
      this.shootTimer = this.shootCooldown;
      const spreadAngles = this.weapon === 'shotgun' ? [-0.2, -0.1, 0, 0.1, 0.2] : [0];
      for (const spread of spreadAngles) {
        const a = this.angle + spread + randRange(-0.05, 0.05);
        game.bullets.push(new Bullet(
          this.x + Math.cos(this.angle) * 15,
          this.y + Math.sin(this.angle) * 15,
          a, 'player',
          this.weapon === 'shotgun' ? 15 : this.weapon === 'uzi' ? 12 : 25
        ));
      }
      if (this.weapon !== 'pistol') this.ammo[this.weapon]--;
      game.wanted.increase(0.1);
    }

    // Switch weapon
    if (input.nextWeapon) {
      const available = Object.keys(this.weapons).filter(w => this.weapons[w] > 0 || w === 'pistol');
      const idx = available.indexOf(this.weapon);
      this.weapon = available[(idx + 1) % available.length];
    }
  }

  _collidesWithVehicles(nx, ny, game) {
    for (const v of game.vehicles) {
      if (!v.active) continue;
      if (Math.abs(nx - v.x) < v.halfW + this.radius && Math.abs(ny - v.y) < v.halfH + this.radius) {
        return true;
      }
    }
    return false;
  }

  tryEnterVehicle(game) {
    if (this.inVehicle) {
      // Exit vehicle
      const v = this.inVehicle;
      v.driver = null;
      this.inVehicle = null;
      // Eject to side
      this.x = v.x + Math.cos(v.angle + Math.PI / 2) * (v.halfH + this.radius + 5);
      this.y = v.y + Math.sin(v.angle + Math.PI / 2) * (v.halfH + this.radius + 5);
    } else {
      // Find nearest vehicle
      let nearest = null;
      let nearestDist = 60;
      for (const v of game.vehicles) {
        if (!v.active) continue;
        if (v.driver && v.driver !== 'player') continue; // Occupied by AI
        const d = dist(this.x, this.y, v.x, v.y);
        if (d < nearestDist) {
          nearest = v;
          nearestDist = d;
        }
      }
      if (nearest) {
        nearest.driver = 'player';
        this.inVehicle = nearest;
        this.x = nearest.x;
        this.y = nearest.y;
      }
    }
  }

  draw(ctx) {
    if (this.inVehicle) return; // Vehicle draws player indicator

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // Shadow
    ctx.beginPath();
    ctx.ellipse(2, 2, this.radius, this.radius * 0.7, 0, 0, TWO_PI);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();

    // Body
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, TWO_PI);
    ctx.fillStyle = this.color;
    ctx.fill();
    ctx.strokeStyle = '#cc3322';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Head / direction indicator
    ctx.beginPath();
    ctx.arc(this.radius * 0.4, 0, this.radius * 0.55, 0, TWO_PI);
    ctx.fillStyle = '#ffccaa';
    ctx.fill();

    // Gun direction if shooting
    if (this.weapons[this.weapon] > 0 || this.weapon === 'pistol') {
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.radius * 0.4, 0);
      ctx.lineTo(this.radius * 1.8, 0);
      ctx.stroke();
    }

    // Walk legs (animated rectangles)
    const legOffset = Math.sin(this.walkT) * 3;
    ctx.fillStyle = '#333';
    ctx.fillRect(-4, -this.radius - legOffset - 2, 3, 5);
    ctx.fillRect(2, -this.radius + legOffset - 2, 3, 5);

    ctx.restore();
  }
}

// ============================================================
// WANTED SYSTEM
// ============================================================
class WantedSystem {
  constructor() {
    this.level = 0;       // 0-6
    this.points = 0;      // accumulate to rise level
    this.cooldown = 0;    // when > 0, stars not dropping
    this.dropTimer = 0;   // time since last crime; stars drop after threshold
    this.dropThreshold = 12; // seconds without crime in police sight to drop
    this.inSight = false; // police can see player
    this.flashTimer = 0;
  }

  increase(amount) {
    this.points += amount;
    this.cooldown = 8;
    this.dropTimer = 0;

    const thresholds = [0, 1, 3, 8, 18, 35, 60];
    let newLevel = 0;
    for (let i = 1; i < thresholds.length; i++) {
      if (this.points >= thresholds[i]) newLevel = i;
    }
    if (newLevel > this.level) this.level = Math.min(6, newLevel);
  }

  update(dt, player, police, game) {
    this.flashTimer += dt * 4;

    // Check if police have line of sight on player
    this.inSight = false;
    for (const cop of police) {
      if (!cop.active) continue;
      if (dist(cop.x || cop.vehicle?.x || 0, cop.y || cop.vehicle?.y || 0, player.x, player.y) < 300) {
        this.inSight = true;
        break;
      }
    }

    if (this.level > 0) {
      if (!this.inSight) {
        this.dropTimer += dt;
        if (this.dropTimer > this.dropThreshold) {
          this.dropTimer = 0;
          this.points = Math.max(0, this.points - 5);
          const thresholds = [0, 1, 3, 8, 18, 35, 60];
          let newLevel = 0;
          for (let i = 1; i < thresholds.length; i++) {
            if (this.points >= thresholds[i]) newLevel = i;
          }
          this.level = newLevel;
          game.showMessage('Wanted level dropped!');
        }
      } else {
        this.dropTimer = 0;
      }
    }

    if (this.cooldown > 0) this.cooldown -= dt;
  }

  clear() {
    this.level = 0;
    this.points = 0;
    this.cooldown = 0;
    this.dropTimer = 0;
  }
}

// ============================================================
// MISSION SYSTEM
// ============================================================
class MissionSystem {
  constructor(world) {
    this.world = world;
    this.missions = [];
    this.currentMission = null;
    this.missionComplete = false;
    this.missionFailed = false;
    this.missionTimer = 0;
    this.message = '';
    this.messageTimer = 0;

    this.phoneBooths = [];
    this.completedCount = 0;
    this._generatePhoneBooths();
    this._createMissions();
  }

  _generatePhoneBooths() {
    const count = 8;
    for (let i = 0; i < count; i++) {
      const pos = this.world.randomSidewalkPos();
      this.phoneBooths.push({ x: pos.x, y: pos.y, active: true, missionIdx: i % this.missions.length });
    }
  }

  _createMissions() {
    this.missions = [
      {
        id: 0,
        name: 'Car Delivery',
        description: 'Steal a car and deliver it to the garage',
        type: 'deliver',
        reward: 500,
        timeLimit: 120,
      },
      {
        id: 1,
        name: 'Hit Job',
        description: 'Eliminate the target marked in red',
        type: 'eliminate',
        reward: 800,
        timeLimit: 90,
      },
      {
        id: 2,
        name: 'Speed Run',
        description: 'Reach the destination before time runs out!',
        type: 'reach',
        reward: 400,
        timeLimit: 60,
      },
      {
        id: 3,
        name: 'Big Score',
        description: 'Collect all cash bags around the area',
        type: 'collect',
        reward: 1200,
        timeLimit: 150,
      },
      {
        id: 4,
        name: 'Getaway',
        description: 'Lose the cops and reach safety',
        type: 'escape',
        reward: 1000,
        timeLimit: 90,
      },
    ];
  }

  startMission(idx, game) {
    const def = this.missions[idx % this.missions.length];
    const world = this.world;

    this.currentMission = {
      def,
      timeLeft: def.timeLimit,
      target: null,
      targetPos: null,
      collectibles: [],
    };

    game.showMessage(`MISSION: ${def.name} - ${def.description}`, 4);

    const dest = world.randomRoadPos();
    this.currentMission.targetPos = dest;

    if (def.type === 'eliminate') {
      // Spawn target NPC
      const tPos = world.randomSidewalkPos();
      const target = new Pedestrian(tPos.x, tPos.y);
      target.isTarget = true;
      target.color = '#ff4444';
      target.shirtColor = '#ff2222';
      target.hp = 100;
      game.pedestrians.push(target);
      this.currentMission.target = target;
    }

    if (def.type === 'collect') {
      for (let i = 0; i < 5; i++) {
        const pos = world.randomRoadPos();
        const pk = new Pickup(pos.x, pos.y, 'cash');
        pk.isMissionPickup = true;
        game.pickups.push(pk);
        this.currentMission.collectibles.push(pk);
      }
    }
  }

  update(dt, game) {
    this.messageTimer = Math.max(0, this.messageTimer - dt);

    if (!this.currentMission) return;

    const m = this.currentMission;
    m.timeLeft -= dt;

    if (m.timeLeft <= 0) {
      this._failMission(game);
      return;
    }

    const def = m.def;
    const player = game.player;

    // Check completion
    if (def.type === 'deliver') {
      if (player.inVehicle && m.targetPos) {
        const d = dist(player.x, player.y, m.targetPos.x, m.targetPos.y);
        if (d < 50) this._completeMission(game);
      }
    }

    if (def.type === 'reach') {
      if (m.targetPos) {
        const d = dist(player.x, player.y, m.targetPos.x, m.targetPos.y);
        if (d < 50) this._completeMission(game);
      }
    }

    if (def.type === 'eliminate') {
      if (m.target && (m.target.isDead || !m.target.active)) {
        this._completeMission(game);
      }
    }

    if (def.type === 'collect') {
      const allCollected = m.collectibles.every(c => c.collected || !c.active);
      if (allCollected) this._completeMission(game);
    }

    if (def.type === 'escape') {
      if (game.wanted.level === 0) this._completeMission(game);
    }
  }

  _completeMission(game) {
    const m = this.currentMission;
    game.addCash(m.def.reward);
    game.addScore(m.def.reward);
    game.showMessage(`MISSION COMPLETE! +$${m.def.reward}`, 4);
    this.completedCount++;
    this.currentMission = null;

    // Re-activate phone booth
    for (const pb of this.phoneBooths) {
      pb.active = true;
    }
  }

  _failMission(game) {
    game.showMessage('MISSION FAILED! Time ran out.', 3);
    this.currentMission = null;
    for (const pb of this.phoneBooths) {
      pb.active = true;
    }
  }

  drawPhoneBooths(ctx) {
    for (const pb of this.phoneBooths) {
      if (!pb.active) continue;
      ctx.fillStyle = '#00cccc';
      ctx.fillRect(pb.x - 8, pb.y - 12, 16, 24);
      ctx.fillStyle = '#000';
      ctx.font = 'bold 10px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('P', pb.x, pb.y);

      // Glow
      ctx.strokeStyle = 'rgba(0,255,255,0.4)';
      ctx.lineWidth = 2;
      ctx.strokeRect(pb.x - 10, pb.y - 14, 20, 28);
    }
  }

  drawMissionMarkers(ctx) {
    if (!this.currentMission) return;
    const m = this.currentMission;

    // Draw destination marker
    if (m.targetPos && (m.def.type === 'deliver' || m.def.type === 'reach')) {
      this._drawMarker(ctx, m.targetPos.x, m.targetPos.y, '#ffff00', 'GO');
    }

    if (m.def.type === 'escape') {
      // No fixed marker, just survive
    }
  }

  _drawMarker(ctx, wx, wy, color, label) {
    const t = Date.now() / 400;
    const r = 18 + Math.sin(t) * 4;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(wx, wy, r, 0, TWO_PI);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, wx, wy);
  }

  drawHUDArrow(ctx, player, sw, sh) {
    if (!this.currentMission) return;
    const m = this.currentMission;
    let tx, ty;

    if (m.targetPos && (m.def.type === 'deliver' || m.def.type === 'reach')) {
      tx = m.targetPos.x;
      ty = m.targetPos.y;
    } else if (m.def.type === 'eliminate' && m.target && !m.target.isDead) {
      tx = m.target.x;
      ty = m.target.y;
    } else {
      return;
    }

    // Direction from player to target
    const angle = Math.atan2(ty - player.y, tx - player.x);
    const margin = 40;
    const cx = sw / 2;
    const cy = sh / 2;

    ctx.save();
    ctx.translate(cx + Math.cos(angle) * (Math.min(sw, sh) / 2 - margin),
                  cy + Math.sin(angle) * (Math.min(sw, sh) / 2 - margin));
    ctx.rotate(angle);
    ctx.fillStyle = '#ffff00';
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-6, -8);
    ctx.lineTo(-6, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// ============================================================
// TRAFFIC SYSTEM
// ============================================================
class TrafficSystem {
  constructor(world) {
    this.world = world;
    this.maxCars = 25;
  }

  spawnCars(game) {
    const traffic = game.vehicles.filter(v => !v.isParked && v.driver === null);
    const needed = this.maxCars - traffic.length;
    for (let i = 0; i < needed; i++) {
      const pos = this.world.randomRoadPos();
      const v = new Vehicle(pos.x, pos.y, randInt(0, 2));
      v.aiState = 'drive';
      v.aiTarget = this.world.randomRoadPos();
      game.vehicles.push(v);
    }
  }
}

// ============================================================
// INPUT MANAGER
// ============================================================
class InputManager {
  constructor(canvas) {
    this.canvas = canvas;
    // Movement
    this.moveX = 0;
    this.moveY = 0;
    // Vehicle
    this.gas = 0;
    this.brake = 0;
    this.steer = 0;
    this.handbrake = false;
    // Actions
    this.shoot = false;
    this.enterVehicle = false;
    this.enterVehiclePressed = false;
    this.nextWeapon = false;
    this.nextWeaponPressed = false;

    // Keyboard state
    this.keys = {};

    // Touch state
    this.joystick = { active: false, startX: 0, startY: 0, dx: 0, dy: 0, id: null };
    this.actionTouches = {};

    // Button rects (will be set by HUD)
    this.btnEnter = null;
    this.btnShoot = null;
    this.btnHandbrake = null;

    this._setupKeyboard();
    this._setupTouch();
  }

  _setupKeyboard() {
    window.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (e.code === 'KeyE') this.enterVehiclePressed = true;
      if (e.code === 'Tab') { this.nextWeaponPressed = true; e.preventDefault(); }
      e.preventDefault();
    });
    window.addEventListener('keyup', e => {
      this.keys[e.code] = false;
    });
  }

  _setupTouch() {
    const c = this.canvas;
    c.addEventListener('touchstart', e => { e.preventDefault(); this._handleTouchStart(e); }, { passive: false });
    c.addEventListener('touchmove',  e => { e.preventDefault(); this._handleTouchMove(e); },  { passive: false });
    c.addEventListener('touchend',   e => { e.preventDefault(); this._handleTouchEnd(e); },   { passive: false });
    c.addEventListener('touchcancel',e => { e.preventDefault(); this._handleTouchEnd(e); },   { passive: false });
  }

  _handleTouchStart(e) {
    for (const t of e.changedTouches) {
      const x = t.clientX;
      const y = t.clientY;
      const sw = window.innerWidth;
      const sh = window.innerHeight;

      // Left half = joystick
      if (x < sw / 2) {
        if (!this.joystick.active) {
          this.joystick = { active: true, startX: x, startY: y, dx: 0, dy: 0, id: t.identifier };
        }
      } else {
        // Right half = action buttons
        this._processActionTouch(t, x, y, sh, 'start');
      }
    }
  }

  _handleTouchMove(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this.joystick.id) {
        const dx = t.clientX - this.joystick.startX;
        const dy = t.clientY - this.joystick.startY;
        const max = 50;
        this.joystick.dx = clamp(dx / max, -1, 1);
        this.joystick.dy = clamp(dy / max, -1, 1);
      } else {
        const x = t.clientX;
        const y = t.clientY;
        const sw = window.innerWidth;
        const sh = window.innerHeight;
        if (x >= sw / 2) {
          this._processActionTouch(t, x, y, sh, 'move');
        }
      }
    }
  }

  _handleTouchEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this.joystick.id) {
        this.joystick = { active: false, startX: 0, startY: 0, dx: 0, dy: 0, id: null };
      } else {
        delete this.actionTouches[t.identifier];
      }
    }
  }

  _processActionTouch(t, x, y, sh, phase) {
    if (!this.btnEnter) return;

    const inBtn = (btn, px, py) => {
      return px >= btn.x && px <= btn.x + btn.w && py >= btn.y && py <= btn.y + btn.h;
    };

    if (phase === 'start') {
      if (this.btnEnter && inBtn(this.btnEnter, x, y)) {
        this.actionTouches[t.identifier] = 'enter';
        this.enterVehiclePressed = true;
      } else if (this.btnShoot && inBtn(this.btnShoot, x, y)) {
        this.actionTouches[t.identifier] = 'shoot';
      } else if (this.btnHandbrake && inBtn(this.btnHandbrake, x, y)) {
        this.actionTouches[t.identifier] = 'handbrake';
      }
    }

    if (phase === 'move') {
      // Re-check
    }
  }

  update(inVehicle) {
    // Reset per-frame presses
    this.enterVehicle = this.enterVehiclePressed;
    this.enterVehiclePressed = false;
    this.nextWeapon = this.nextWeaponPressed;
    this.nextWeaponPressed = false;

    // Keyboard movement
    let kx = 0, ky = 0;
    if (this.keys['KeyA'] || this.keys['ArrowLeft'])  kx -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) kx += 1;
    if (this.keys['KeyW'] || this.keys['ArrowUp'])    ky -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown'])  ky += 1;

    // Normalize keyboard
    if (kx !== 0 && ky !== 0) { kx *= 0.707; ky *= 0.707; }

    // Combine with joystick
    const jx = this.joystick.active ? this.joystick.dx : 0;
    const jy = this.joystick.active ? this.joystick.dy : 0;
    const rx = kx || jx;
    const ry = ky || jy;

    const touchShoot = Object.values(this.actionTouches).includes('shoot');
    const touchHandbrake = Object.values(this.actionTouches).includes('handbrake');

    const shootKey = this.keys['Space'] || this.keys['KeyJ'];

    if (inVehicle) {
      // In vehicle: forward/back = gas/brake, left/right = steer
      this.gas    = Math.max(0, -ry);
      this.brake  = Math.max(0, ry);
      this.steer  = rx;
      this.handbrake = this.keys['ShiftLeft'] || this.keys['ShiftRight'] || touchHandbrake;
      this.shoot  = shootKey || touchShoot;
      this.moveX  = 0;
      this.moveY  = 0;
    } else {
      this.moveX  = rx;
      this.moveY  = ry;
      this.shoot  = shootKey || touchShoot;
      this.gas    = 0;
      this.brake  = 0;
      this.steer  = 0;
      this.handbrake = false;
    }

    if (this.keys['KeyE']) this.enterVehicle = true;
  }
}

// ============================================================
// CAMERA
// ============================================================
class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1.0;
    this.targetZoom = 1.0;
    this.vw = 800;
    this.vh = 600;
  }

  follow(target, speed, dt) {
    const tx = target.x;
    const ty = target.y;
    this.x = lerp(this.x, tx, Math.min(1, 6 * dt));
    this.y = lerp(this.y, ty, Math.min(1, 6 * dt));
    this.zoom = lerp(this.zoom, this.targetZoom, 3 * dt);
  }

  setSpeedZoom(spd) {
    // Zoom out at high speed
    const factor = clamp(1 - spd / 400, 0.6, 1.0);
    this.targetZoom = factor;
  }

  applyTransform(ctx, sw, sh) {
    this.vw = sw / this.zoom;
    this.vh = sh / this.zoom;
    ctx.save();
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x + this.vw / 2, -this.y + this.vh / 2);
  }

  restore(ctx) {
    ctx.restore();
  }

  worldToScreen(wx, wy, sw, sh) {
    return {
      x: (wx - this.x) * this.zoom + sw / 2,
      y: (wy - this.y) * this.zoom + sh / 2
    };
  }
}

// ============================================================
// RESPRAY WORKSHOP
// ============================================================
class ResprayShop {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.width = 80;
    this.height = 60;
    this.active = true;
    this.cooldown = 0;
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
  }

  draw(ctx) {
    ctx.fillStyle = '#663399';
    ctx.fillRect(this.x - this.width / 2, this.y - this.height / 2, this.width, this.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('RESPRAY', this.x, this.y);
    ctx.fillText('SHOP', this.x, this.y + 12);

    // Glow when active
    if (this.cooldown <= 0) {
      const t = Date.now() / 500;
      ctx.strokeStyle = `rgba(150,50,255,${0.4 + Math.sin(t) * 0.3})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(this.x - this.width / 2 - 3, this.y - this.height / 2 - 3, this.width + 6, this.height + 6);
    }
  }
}

// ============================================================
// HOSPITAL
// ============================================================
class Hospital {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.width = 80;
    this.height = 80;
  }

  draw(ctx) {
    ctx.fillStyle = '#ccccff';
    ctx.fillRect(this.x - this.width / 2, this.y - this.height / 2, this.width, this.height);
    ctx.fillStyle = '#ff0000';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+', this.x, this.y);
    ctx.fillStyle = '#000033';
    ctx.font = 'bold 9px Arial';
    ctx.fillText('HOSPITAL', this.x, this.y + 22);
  }
}

// ============================================================
// HUD
// ============================================================
class HUD {
  constructor() {
    this.message = '';
    this.messageTimer = 0;
    this.deathMessage = '';
    this.deathTimer = 0;
  }

  showMessage(text, duration) {
    this.message = text;
    this.messageTimer = duration || 3;
  }

  showDeath(text) {
    this.deathMessage = text;
    this.deathTimer = 3;
  }

  update(dt) {
    if (this.messageTimer > 0) this.messageTimer -= dt;
    if (this.deathTimer > 0) this.deathTimer -= dt;
  }

  draw(ctx, game, sw, sh, input) {
    const player = game.player;
    const wanted = game.wanted;
    const missions = game.missions;

    // Bars background
    const barH = 14;
    const barW = 160;
    const padX = 14;
    const padY = sh - 60;

    // HP bar
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(padX - 2, padY - 2, barW + 4, barH + 4);
    ctx.fillStyle = '#aa2222';
    ctx.fillRect(padX, padY, barW, barH);
    ctx.fillStyle = '#44ff44';
    ctx.fillRect(padX, padY, barW * (player.hp / player.maxHp), barH);
    ctx.fillStyle = '#fff';
    ctx.font = '10px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`HP ${Math.max(0, Math.ceil(player.hp))}`, padX + 4, padY + barH - 2);

    // Armor bar
    if (player.armor > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(padX - 2, padY + barH + 4, barW + 4, barH + 4);
      ctx.fillStyle = '#224488';
      ctx.fillRect(padX, padY + barH + 6, barW, barH);
      ctx.fillStyle = '#4488ff';
      ctx.fillRect(padX, padY + barH + 6, barW * (player.armor / player.maxArmor), barH);
      ctx.fillStyle = '#fff';
      ctx.fillText(`AR ${Math.ceil(player.armor)}`, padX + 4, padY + barH * 2 + 6);
    }

    // Cash & Score (top left)
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, 220, 56);
    ctx.fillStyle = '#ffdd00';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`$${player.cash.toLocaleString()}`, 10, 22);
    ctx.fillStyle = '#aaffaa';
    ctx.font = '13px monospace';
    ctx.fillText(`SCORE: ${player.score.toLocaleString()}`, 10, 42);

    // Weapon info (top left continued)
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px monospace';
    const weaponLabel = player.weapon.toUpperCase();
    const ammoStr = player.weapon === 'pistol' ? '∞' : String(player.ammo[player.weapon]);
    ctx.fillText(`${weaponLabel} [${ammoStr}]`, 10, 58);

    // Wanted stars (top right)
    const starSize = 18;
    const starPad = 4;
    const starsW = 6 * (starSize + starPad);
    const sx = sw - starsW - 10;
    const sy = 10;

    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(sx - 5, sy - 5, starsW + 10, starSize + 14);

    for (let i = 0; i < 6; i++) {
      const starX = sx + i * (starSize + starPad);
      const filled = i < wanted.level;
      const flashing = filled && wanted.level > 0 && Math.sin(wanted.flashTimer) > 0;

      this._drawStar(ctx, starX + starSize / 2, sy + starSize / 2, starSize / 2 - 1,
        filled ? (flashing ? '#ffff00' : '#ffaa00') : '#444444');
    }

    // Wanted level text
    if (wanted.level > 0) {
      const labels = ['', 'WANTED', 'WANTED', 'SWAT', 'SWAT', 'NFBI', 'MILITARY'];
      ctx.fillStyle = '#ff4444';
      ctx.font = 'bold 10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(labels[wanted.level], sx + starsW / 2, sy + starSize + 12);
    }

    // Mission info (top center)
    if (missions.currentMission) {
      const m = missions.currentMission;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(sw / 2 - 160, 4, 320, 40);
      ctx.fillStyle = '#ffff44';
      ctx.font = 'bold 13px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(m.def.name, sw / 2, 18);
      ctx.fillStyle = '#ffffff';
      ctx.font = '11px Arial';
      const timeStr = `TIME: ${Math.ceil(m.timeLeft)}s`;
      ctx.fillText(timeStr, sw / 2, 34);
    }

    // Mission arrow
    missions.drawHUDArrow(ctx, player, sw, sh);

    // Main message
    if (this.messageTimer > 0) {
      const alpha = Math.min(1, this.messageTimer);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      const tw = ctx.measureText(this.message).width + 30;
      ctx.fillRect(sw / 2 - tw / 2, sh / 2 - 40, tw, 30);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(this.message, sw / 2, sh / 2 - 20);
      ctx.restore();
    }

    // Death message
    if (this.deathTimer > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.deathTimer / 1.5);
      ctx.fillStyle = 'rgba(180,0,0,0.5)';
      ctx.fillRect(0, 0, sw, sh);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 30px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('WASTED', sw / 2, sh / 2);
      ctx.font = '16px Arial';
      ctx.fillText(this.deathMessage || 'Respawning at hospital...', sw / 2, sh / 2 + 36);
      ctx.restore();
    }

    // Virtual joystick
    if (game.input.joystick.active) {
      const j = game.input.joystick;
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(j.startX, j.startY, 40, 0, TWO_PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(j.startX + j.dx * 40, j.startY + j.dy * 40, 18, 0, TWO_PI);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();
    }

    // Action buttons
    this._drawActionButtons(ctx, sw, sh, input);

    // Mini map
    this._drawMinimap(ctx, game, sw, sh);
  }

  _drawStar(ctx, cx, cy, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i * 4 * Math.PI) / 5 - Math.PI / 2;
      const ar = ((i * 4 + 2) * Math.PI) / 5 - Math.PI / 2;
      if (i === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.lineTo(cx + Math.cos(ar) * r * 0.45, cy + Math.sin(ar) * r * 0.45);
    }
    ctx.closePath();
    ctx.fill();
  }

  _drawActionButtons(ctx, sw, sh, input) {
    const btns = [
      { key: 'enter',     label: 'E\nENTER',   x: sw - 160, y: sh - 130, w: 60, h: 40, color: '#3388ff' },
      { key: 'shoot',     label: '●\nSHOOT',   x: sw - 90,  y: sh - 170, w: 60, h: 50, color: '#ff4444' },
      { key: 'handbrake', label: '▲\nHAND',    x: sw - 90,  y: sh - 110, w: 60, h: 40, color: '#ff8833' },
    ];

    // Store button rects in input manager
    if (input.btnEnter === null || true) {
      input.btnEnter     = { x: btns[0].x, y: btns[0].y, w: btns[0].w, h: btns[0].h };
      input.btnShoot     = { x: btns[1].x, y: btns[1].y, w: btns[1].w, h: btns[1].h };
      input.btnHandbrake = { x: btns[2].x, y: btns[2].y, w: btns[2].w, h: btns[2].h };
    }

    for (const btn of btns) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      this._roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 8);
      ctx.fill();

      ctx.strokeStyle = btn.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      this._roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 8);
      ctx.stroke();

      ctx.fillStyle = btn.color;
      ctx.font = 'bold 11px Arial';
      ctx.textAlign = 'center';
      const lines = btn.label.split('\n');
      lines.forEach((line, li) => {
        ctx.fillText(line, btn.x + btn.w / 2, btn.y + 14 + li * 14);
      });
    }
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
  }

  _drawMinimap(ctx, game, sw, sh) {
    const mmW = 120;
    const mmH = 120;
    const mmX = sw - mmW - 10;
    const mmY = sh - mmH - 10;
    const scale = mmW / WORLD_W;

    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(mmX - 2, mmY - 2, mmW + 4, mmH + 4);

    // Draw roads (simplified)
    ctx.fillStyle = '#333';
    ctx.fillRect(mmX, mmY, mmW, mmH);

    const world = game.world;
    // Draw road tiles (sampled)
    for (let c = 0; c < COLS; c += 2) {
      for (let r = 0; r < ROWS; r += 2) {
        const t = world.get(c, r);
        if (t === TILE_ROAD) {
          ctx.fillStyle = '#555';
          ctx.fillRect(mmX + c * TILE_SIZE * scale, mmY + r * TILE_SIZE * scale, 3, 3);
        }
      }
    }

    // Police
    for (const cop of game.police) {
      if (!cop.active) continue;
      ctx.fillStyle = '#4444ff';
      ctx.fillRect(mmX + cop.x * scale - 1, mmY + cop.y * scale - 1, 3, 3);
    }

    // Vehicles
    for (const v of game.vehicles) {
      if (!v.active) continue;
      ctx.fillStyle = v.isPolice ? '#3344ff' : '#888';
      ctx.fillRect(mmX + v.x * scale - 1, mmY + v.y * scale - 1, 3, 3);
    }

    // Player
    const px = mmX + game.player.x * scale;
    const py = mmY + game.player.y * scale;
    ctx.fillStyle = '#ff4444';
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, TWO_PI);
    ctx.fill();

    // Mission marker
    if (game.missions.currentMission && game.missions.currentMission.targetPos) {
      const tp = game.missions.currentMission.targetPos;
      ctx.fillStyle = '#ffff00';
      ctx.beginPath();
      ctx.arc(mmX + tp.x * scale, mmY + tp.y * scale, 3, 0, TWO_PI);
      ctx.fill();
    }

    // Border
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 1;
    ctx.strokeRect(mmX, mmY, mmW, mmH);
  }
}

// ============================================================
// GAME
// ============================================================
class Game {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');

    this.dpr = window.devicePixelRatio || 1;
    this.sw = 0; // screen width in CSS pixels
    this.sh = 0;

    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Core systems
    this.world = new World();
    this.input = new InputManager(this.canvas);
    this.camera = new Camera();
    this.hud = new HUD();
    this.wanted = new WantedSystem();
    this.missions = new MissionSystem(this.world);
    this.traffic = new TrafficSystem(this.world);

    // Entities
    this.player = null;
    this.vehicles = [];
    this.pedestrians = [];
    this.bullets = [];
    this.explosions = [];
    this.pickups = [];
    this.police = [];
    this.resprayShops = [];
    this.hospitals = [];

    // Timers
    this.policeSpawnTimer = 0;
    this.trafficSpawnTimer = 0;
    this.pickupSpawnTimer = 0;

    // Game state
    this.running = true;
    this.score = 0;
    this.frameCount = 0;

    this._init();

    // Fix up phone booth mission indices after missions are created
    for (let i = 0; i < this.missions.phoneBooths.length; i++) {
      this.missions.phoneBooths[i].missionIdx = i % this.missions.missions.length;
    }

    // Start loop
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.FIXED_DT = 1 / 60;
    requestAnimationFrame(t => this.loop(t));
  }

  resize() {
    this.sw = window.innerWidth;
    this.sh = window.innerHeight;
    this.canvas.width  = this.sw * this.dpr;
    this.canvas.height = this.sh * this.dpr;
    this.canvas.style.width  = this.sw + 'px';
    this.canvas.style.height = this.sh + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  _init() {
    // Spawn player on a road tile
    const startPos = this.world.randomRoadPos();
    this.player = new Player(startPos.x, startPos.y);

    // Spawn parked cars
    this._spawnParkedCars(80);

    // Spawn traffic
    this.traffic.spawnCars(this);

    // Spawn pedestrians
    for (let i = 0; i < 60; i++) {
      const pos = this.world.randomSidewalkPos();
      this.pedestrians.push(new Pedestrian(pos.x, pos.y));
    }

    // Pickups scattered around
    this._spawnPickups(30);

    // Respray shops
    for (let i = 0; i < 4; i++) {
      const pos = this.world.randomRoadPos();
      this.resprayShops.push(new ResprayShop(pos.x, pos.y));
    }

    // Hospitals
    for (let i = 0; i < 2; i++) {
      const pos = this.world.randomRoadPos();
      this.hospitals.push(new Hospital(pos.x, pos.y));
    }

    // Init camera
    this.camera.x = this.player.x;
    this.camera.y = this.player.y;

    this.showMessage('CRIME CITY - Find a phone booth to start a mission!', 5);
  }

  _spawnParkedCars(count) {
    for (let i = 0; i < count; i++) {
      const pos = this.world.randomRoadPos();
      const v = new Vehicle(pos.x, pos.y, randInt(0, 2));
      v.isParked = true;
      v.speed = 0;
      v.driver = null;
      // Snap angle to road direction
      const hOnRoad = this.world.isRoad(pos.x + 20, pos.y) && this.world.isRoad(pos.x - 20, pos.y);
      v.angle = hOnRoad ? 0 : Math.PI / 2;
      this.vehicles.push(v);
    }
  }

  _spawnPickups(count) {
    const types = ['health', 'armor', 'cash', 'pistol', 'shotgun', 'uzi'];
    const weights = [4, 3, 5, 2, 1, 1];
    const totalW = weights.reduce((a, b) => a + b, 0);

    for (let i = 0; i < count; i++) {
      const pos = this.world.randomSidewalkPos();
      let rand = Math.random() * totalW;
      let type = types[0];
      for (let j = 0; j < types.length; j++) {
        rand -= weights[j];
        if (rand <= 0) { type = types[j]; break; }
      }
      this.pickups.push(new Pickup(pos.x, pos.y, type));
    }
  }

  _spawnPolice() {
    const stars = this.wanted.level;
    if (stars === 0) return;

    // Determine police type based on star level
    let typeIdx = 3; // police car
    if (stars >= 3) typeIdx = 3;
    if (stars >= 5) typeIdx = 4; // swat/military

    // Spawn near player but off screen
    const angle = Math.random() * TWO_PI;
    const dist2 = 400 + Math.random() * 200;
    const sx = clamp(this.player.x + Math.cos(angle) * dist2, 50, WORLD_W - 50);
    const sy = clamp(this.player.y + Math.sin(angle) * dist2, 50, WORLD_H - 50);

    if (!this.world.isRoad(sx, sy)) return;

    if (stars <= 2) {
      // Foot police
      const cop = new PoliceOfficer(sx, sy, this);
      this.police.push(cop);
    } else {
      // Police vehicle
      const pv = new Vehicle(sx, sy, typeIdx);
      pv.driver = { isPolice: true, shootTimer: 0 };
      pv.isPolice = true;
      this.vehicles.push(pv);
      this.police.push(pv);
    }
  }

  showMessage(text, dur) {
    this.hud.showMessage(text, dur || 3);
  }

  addScore(amount) {
    this.player.score += amount;
  }

  addCash(amount) {
    this.player.cash += amount;
  }

  playerDied() {
    if (this.player.hp > 0) return; // Already handled

    // Lose some cash
    const cashLoss = Math.floor(this.player.cash * 0.2);
    this.player.cash = Math.max(0, this.player.cash - cashLoss);

    // Exit vehicle
    if (this.player.inVehicle) {
      this.player.inVehicle.driver = null;
      this.player.inVehicle = null;
    }

    // Respawn at hospital
    const h = this.hospitals[0];
    this.player.x = h ? h.x + 20 : WORLD_W / 2;
    this.player.y = h ? h.y + 20 : WORLD_H / 2;
    this.player.hp = 100;
    this.player.armor = 0;

    // Clear wanted
    this.wanted.clear();

    // Clear police
    for (const cop of this.police) cop.active = false;
    this.police = [];

    this.hud.showDeath(`Lost $${cashLoss}`);
  }

  explodeVehicle(v) {
    if (!v.active) return;
    this.explosions.push(new Explosion(v.x, v.y));
    v.active = false;

    // Remove from police list
    this.police = this.police.filter(p => p !== v);

    // Damage nearby entities
    for (const other of this.vehicles) {
      if (!other.active || other === v) continue;
      const d = dist(other.x, other.y, v.x, v.y);
      if (d < 100) {
        other.hp -= (100 - d);
        if (other.hp <= 0) {
          setTimeout(() => this.explodeVehicle(other), 200);
        }
      }
    }

    // Player damage
    const pd = dist(this.player.x, this.player.y, v.x, v.y);
    if (pd < 80) {
      const dmg = (80 - pd) * 1.5;
      this.player.hp -= dmg;
      if (this.player.hp <= 0) this.playerDied();
    }
  }

  loop(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    this.update(dt);
    this.draw();

    requestAnimationFrame(t => this.loop(t));
  }

  update(dt) {
    if (!this.running) return;
    this.frameCount++;

    // Update input
    this.input.update(!!this.player.inVehicle);

    // Player
    this.player.update(dt, this.input, this.world, this);

    // Camera
    const speed = this.player.inVehicle ? this.player.inVehicle.speed : 0;
    this.camera.setSpeedZoom(speed);
    this.camera.follow(this.player, speed, dt);

    // Vehicles
    for (const v of this.vehicles) {
      if (!v.active) continue;
      v.update(dt, this.world, this.input, this);
    }
    this.vehicles = this.vehicles.filter(v => v.active);

    // Pedestrians
    for (const p of this.pedestrians) {
      if (!p.active) continue;
      p.update(dt, this.world, this.player, this.vehicles);
    }
    this.pedestrians = this.pedestrians.filter(p => p.active);

    // Bullets
    for (const b of this.bullets) {
      if (!b.active) continue;
      b.update(dt, this.world, this);
    }
    this.bullets = this.bullets.filter(b => b.active);

    // Explosions
    for (const ex of this.explosions) {
      ex.update(dt);
    }
    this.explosions = this.explosions.filter(ex => ex.active);

    // Pickups
    for (const pk of this.pickups) {
      if (!pk.active || pk.collected) continue;
      pk.update(dt);
      const d = dist(this.player.x, this.player.y, pk.x, pk.y);
      if (d < pk.radius + 12) {
        this._collectPickup(pk);
      }
    }
    this.pickups = this.pickups.filter(p => p.active && !p.collected);

    // Police foot officers
    for (const cop of this.police) {
      if (!cop.active) continue;
      if (cop instanceof PoliceOfficer) {
        cop.update(dt, this.world, this);
      }
    }
    this.police = this.police.filter(p => p.active);

    // Wanted system
    this.wanted.update(dt, this.player, this.police, this);

    // Police spawning
    this.policeSpawnTimer -= dt;
    if (this.policeSpawnTimer <= 0 && this.wanted.level > 0) {
      const maxCops = this.wanted.level * 2;
      if (this.police.length < maxCops) {
        this._spawnPolice();
      }
      this.policeSpawnTimer = Math.max(2, 8 - this.wanted.level);
    }

    // Traffic replenish
    this.trafficSpawnTimer -= dt;
    if (this.trafficSpawnTimer <= 0) {
      this.traffic.spawnCars(this);
      this.trafficSpawnTimer = 5;
    }

    // Pickup replenish
    this.pickupSpawnTimer -= dt;
    if (this.pickupSpawnTimer <= 0) {
      if (this.pickups.length < 20) {
        this._spawnPickups(5);
      }
      this.pickupSpawnTimer = 15;
    }

    // Pedestrian replenish
    if (this.frameCount % 180 === 0) {
      if (this.pedestrians.length < 40) {
        const pos = this.world.randomSidewalkPos();
        this.pedestrians.push(new Pedestrian(pos.x, pos.y));
      }
    }

    // Phone booth interactions
    for (const pb of this.missions.phoneBooths) {
      if (!pb.active) continue;
      if (dist(this.player.x, this.player.y, pb.x, pb.y) < 25 && !this.missions.currentMission) {
        pb.active = false;
        this.missions.startMission(pb.missionIdx, this);
      }
    }

    // Respray shop
    for (const shop of this.resprayShops) {
      shop.update(dt);
      if (shop.cooldown <= 0) {
        const d = dist(this.player.x, this.player.y, shop.x, shop.y);
        if (d < 50) {
          if (this.wanted.level > 0) {
            this.wanted.clear();
            this.showMessage('Respray complete! Wanted level cleared.', 3);
            shop.cooldown = 30;
            this.addCash(-200);
          }
        }
      }
    }

    // Missions
    this.missions.update(dt, this);

    // HUD
    this.hud.update(dt);

    // Culling distant entities
    if (this.frameCount % 300 === 0) {
      const maxDist = 1200;
      this.pedestrians = this.pedestrians.filter(p =>
        dist(p.x, p.y, this.player.x, this.player.y) < maxDist
      );
      this.vehicles = this.vehicles.filter(v => {
        if (v.driver === 'player' || v.isParked) return true;
        return dist(v.x, v.y, this.player.x, this.player.y) < maxDist;
      });
    }
  }

  _collectPickup(pk) {
    pk.collected = true;
    pk.active = false;
    switch (pk.type) {
      case 'health':
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 50);
        this.showMessage('Health +50', 1.5);
        break;
      case 'armor':
        this.player.armor = Math.min(this.player.maxArmor, this.player.armor + 50);
        this.showMessage('Armor +50', 1.5);
        break;
      case 'cash':
        const cash = pk.isMissionPickup ? 200 : randInt(50, 200);
        this.addCash(cash);
        this.addScore(cash);
        this.showMessage(`+$${cash}`, 1.2);
        break;
      case 'pistol':
        this.showMessage('Pistol ammo +50', 1.5);
        // Pistol is infinite
        break;
      case 'shotgun':
        this.player.weapons.shotgun += 20;
        this.player.ammo.shotgun += 20;
        if (this.player.weapon === 'pistol') this.player.weapon = 'shotgun';
        this.showMessage('Shotgun +20 ammo', 1.5);
        break;
      case 'uzi':
        this.player.weapons.uzi += 50;
        this.player.ammo.uzi += 50;
        if (this.player.weapon === 'pistol') this.player.weapon = 'uzi';
        this.showMessage('Uzi +50 ammo', 1.5);
        break;
    }
  }

  draw() {
    const ctx = this.ctx;
    const sw = this.sw;
    const sh = this.sh;

    ctx.clearRect(0, 0, sw, sh);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, sw, sh);

    // Apply camera transform
    this.camera.applyTransform(ctx, sw, sh);

    // World
    this.world.draw(ctx, this.camera);

    // Respray shops
    for (const shop of this.resprayShops) shop.draw(ctx);

    // Hospitals
    for (const h of this.hospitals) h.draw(ctx);

    // Phone booths
    this.missions.drawPhoneBooths(ctx);

    // Mission markers
    this.missions.drawMissionMarkers(ctx);

    // Pickups
    for (const pk of this.pickups) {
      if (!pk.active) continue;
      pk.draw(ctx);
    }

    // Pedestrians
    for (const p of this.pedestrians) {
      if (!p.active) continue;
      p.draw(ctx);
    }

    // Vehicles
    for (const v of this.vehicles) {
      if (!v.active) continue;
      v.draw(ctx, v.driver === 'player');
    }

    // Police foot officers
    for (const cop of this.police) {
      if (!cop.active) continue;
      if (cop instanceof PoliceOfficer) cop.draw(ctx);
    }

    // Player
    this.player.draw(ctx);

    // Bullets
    for (const b of this.bullets) {
      if (!b.active) continue;
      b.draw(ctx);
    }

    // Explosions
    for (const ex of this.explosions) {
      if (!ex.active) continue;
      ex.draw(ctx);
    }

    // Restore camera
    this.camera.restore(ctx);

    // HUD (screen space)
    this.hud.draw(ctx, this, sw, sh, this.input);
  }
}

// ============================================================
// BOOT
// ============================================================
window.addEventListener('load', () => {
  const game = new Game();
  window._game = game; // Debug access
});
