import type {
  GamePhase, EnemyType, BulletType, PowerUpType, ExplosionSize, SFXEvent,
  Vec2, PlayerInput, WeaponState, PlayerSnap, EnemySnap, BossSnap,
  BulletSnap, PowerUpSnap, GameSnapshot
} from './types'

// ══════════════════════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════════════════════
export const W = 920, H = 690
const TOTAL_WAVES = 6

// ══════════════════════════════════════════════════════════
//  INTERNAL TYPES
// ══════════════════════════════════════════════════════════
interface GPlayer {
  id: string; name: string; colorIdx: number; isHost: boolean
  x: number; y: number; vx: number; vy: number
  health: number; maxHealth: number
  active: boolean; invincible: number; animTimer: number
  hitFlash: number
  weapons: WeaponState[]
  currentWeapon: number
  shieldActive: boolean; shieldTimer: number
  rapidFireActive: boolean; rapidFireTimer: number
  lives: number; score: number; bombsLeft: number
}

interface GBullet {
  id: number; x: number; y: number; vx: number; vy: number
  owner: 'player' | 'enemy'; ownerId?: string
  damage: number; active: boolean; type: BulletType
  trail: Vec2[]; life?: number; targetId?: number
}

interface GEnemy {
  id: number; x: number; y: number; vx: number; vy: number
  health: number; maxHealth: number; active: boolean; type: EnemyType
  shootTimer: number; shootInterval: number
  behaviorTimer: number; behaviorState: string
  targetX: number; targetY: number
  score: number; speed: number; animTimer: number; invincible: number
  entryY: number; patrolAmp: number; patrolFreq: number; patrolOffset: number
  cloaked: boolean; cloakAlpha: number; cloakTimer: number
  dodgeCooldown: number; spawnTimer: number; hitFlash: number
}

interface GBoss {
  id: number; x: number; y: number; vx: number; vy: number
  health: number; maxHealth: number; active: boolean; phase: number
  shootTimer: number; animTimer: number; behaviorTimer: number
  behaviorState: string; invincible: number; hitFlash: number
  chargeX: number; chargeY: number
}

interface GPowerUp {
  id: number; x: number; y: number; vy: number
  type: PowerUpType; active: boolean; animTimer: number
}

// ══════════════════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════════════════
const rnd  = (a: number, b: number) => a + Math.random() * (b - a)
const rndI = (a: number, b: number) => Math.floor(rnd(a, b + 1))
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const lerp  = (a: number, b: number, t: number) => a + (b - a) * t
const dist  = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay)

function makeWeapons(): WeaponState[] {
  return [
    { ammo: Infinity, maxAmmo: Infinity, cooldown: 0 },
    { ammo: 8,  maxAmmo: 12, cooldown: 0 },
    { ammo: 60, maxAmmo: 80, cooldown: 0 },
    { ammo: 20, maxAmmo: 25, cooldown: 0 },
  ]
}

// ══════════════════════════════════════════════════════════
//  ENGINE
// ══════════════════════════════════════════════════════════
export type EngineEvent =
  | { type: 'sfx';       sfx: SFXEvent }
  | { type: 'explosion'; x: number; y: number; size: ExplosionSize; color?: string }
  | { type: 'dmg';       x: number; y: number; val: number; isPlayer: boolean }

export class GameEngine {
  private players = new Map<string, GPlayer>()
  private inputs  = new Map<string, PlayerInput>()
  private enemies: GEnemy[] = []
  private boss: GBoss | null = null
  private pBullets: GBullet[] = []
  private eBullets: GBullet[] = []
  private powerUps: GPowerUp[] = []

  phase: GamePhase = 'lobby'
  frame = 0
  wave  = 1
  score = 0
  combo = 0; comboTimer = 0
  waveKilled = 0; waveTotal = 0
  waveComplete = false; waveTimer = 0
  bossActive = false; bossDefeated = false; bossWarning = 0
  private nextId = 1

  // Called by host after every tick to read & clear pending events
  private pendingEvents: EngineEvent[] = []
  flushEvents(): EngineEvent[] {
    const e = this.pendingEvents; this.pendingEvents = []; return e
  }

  private emit(e: EngineEvent) { this.pendingEvents.push(e) }

  // ─── Player management ────────────────────────────────────────────────────
  addPlayer(id: string, name: string, isHost: boolean): number {
    const colorIdx = this.players.size % 4
    const slot = this.players.size
    this.players.set(id, {
      id, name, colorIdx, isHost,
      x: W / 2 + (slot - Math.floor(slot / 2)) * 90 * (slot % 2 === 0 ? 1 : -1),
      y: H - 130,
      vx: 0, vy: 0, health: 100, maxHealth: 100,
      active: true, invincible: 120, animTimer: 0, hitFlash: 0,
      weapons: makeWeapons(), currentWeapon: 0,
      shieldActive: false, shieldTimer: 0,
      rapidFireActive: false, rapidFireTimer: 0,
      lives: 3, score: 0, bombsLeft: 1,
    })
    this.inputs.set(id, { left: false, right: false, up: false, down: false, fire: false, weapon: 0, bomb: false })
    return colorIdx
  }

  removePlayer(id: string) {
    this.players.delete(id)
    this.inputs.delete(id)
  }

  updateInput(id: string, input: PlayerInput) {
    this.inputs.set(id, { ...input })
  }

  getPlayerCount() { return this.players.size }

  // ─── Lifecycle ────────────────────────────────────────────────────────────
  startGame() {
    this.resetState()
    this.phase = 'playing'
    this.spawnWave(1)
    this.emit({ type: 'sfx', sfx: 'waveClear' })
  }

  resetToLobby() {
    this.phase = 'lobby'
    this.enemies = []; this.boss = null
    this.pBullets = []; this.eBullets = []; this.powerUps = []
  }

  private resetState() {
    this.frame = 0; this.wave = 1; this.score = 0; this.combo = 0; this.comboTimer = 0
    this.waveKilled = 0; this.waveTotal = 0; this.waveComplete = false; this.waveTimer = 0
    this.bossActive = false; this.bossDefeated = false; this.bossWarning = 0
    this.nextId = 1
    this.enemies = []; this.boss = null; this.pBullets = []; this.eBullets = []; this.powerUps = []
    const ids = [...this.players.keys()]
    ids.forEach((id, i) => {
      const p = this.players.get(id)!
      const slot = i - Math.floor(ids.length / 2)
      p.x = W / 2 + slot * 100; p.y = H - 130; p.vx = 0; p.vy = 0
      p.health = 100; p.maxHealth = 100; p.active = true; p.invincible = 120; p.hitFlash = 0
      p.weapons = makeWeapons(); p.currentWeapon = 0
      p.shieldActive = false; p.shieldTimer = 0; p.rapidFireActive = false; p.rapidFireTimer = 0
      p.lives = 3; p.score = 0; p.bombsLeft = 1
    })
  }

  // ─── Wave spawning ────────────────────────────────────────────────────────
  private spawnWave(wave: number) {
    this.enemies = []; this.eBullets = []
    this.waveKilled = 0; this.waveComplete = false; this.bossActive = false

    if (wave > TOTAL_WAVES) { this.phase = 'victory'; this.emit({ type: 'sfx', sfx: 'victory' }); return }

    if (wave === TOTAL_WAVES) {
      this.spawnBoss(); this.bossActive = true; this.bossWarning = 240
      for (let i = 0; i < 6; i++) this.spawnEnemy('fighter', i, 6)
      this.waveTotal = 7; return
    }

    type WCfg = Partial<Record<EnemyType, number>>
    const cfgs: WCfg[] = [
      { fighter: 6 },
      { fighter: 5, bomber: 3 },
      { fighter: 4, gunship: 2, stealth: 2 },
      { fighter: 3, bomber: 2, gunship: 2, ace: 2, interceptor: 2 },
      { fighter: 4, stealth: 2, ace: 2, carrier: 1, interceptor: 2, drone: 4 },
    ]
    const cfg = cfgs[Math.min(wave - 1, cfgs.length - 1)]
    let idx = 0
    const total = (Object.values(cfg) as number[]).reduce((a, b) => a + b, 0)
    ;(Object.entries(cfg) as [EnemyType, number][]).forEach(([type, count]) => {
      for (let i = 0; i < count; i++) this.spawnEnemy(type, idx++, total)
    })
    this.waveTotal = total
  }

  private spawnEnemy(type: EnemyType, idx: number, total: number) {
    const cols = Math.min(total, 7)
    const col = idx % cols, row = Math.floor(idx / cols)
    const sx = W / 2 - ((cols - 1) * 95) / 2 + col * 95 + rnd(-8, 8)
    const sy = -90 - row * 90 - rnd(0, 25)
    const entryY = 55 + row * 75 + rnd(0, 25)
    const S: Record<EnemyType, { hp: number; speed: number; interval: number; score: number }> = {
      fighter:     { hp: 35,  speed: 2.2, interval: 90,  score: 100 },
      bomber:      { hp: 100, speed: 1.3, interval: 120, score: 220 },
      gunship:     { hp: 60,  speed: 1.7, interval: 65,  score: 320 },
      stealth:     { hp: 40,  speed: 2.5, interval: 80,  score: 450 },
      ace:         { hp: 55,  speed: 3.0, interval: 100, score: 500 },
      interceptor: { hp: 45,  speed: 3.5, interval: 75,  score: 380 },
      carrier:     { hp: 180, speed: 0.8, interval: 999, score: 800 },
      drone:       { hp: 18,  speed: 2.8, interval: 60,  score: 80  },
    }
    const s = S[type]
    this.enemies.push({
      id: this.nextId++, x: sx, y: sy, vx: 0, vy: s.speed,
      health: s.hp, maxHealth: s.hp, active: true, type,
      shootTimer: rndI(20, 60), shootInterval: s.interval + rnd(-15, 15),
      behaviorTimer: 0, behaviorState: 'enter',
      targetX: sx, targetY: entryY,
      score: s.score, speed: s.speed, animTimer: rnd(0, 100), invincible: 0,
      entryY, patrolAmp: rnd(30, 90), patrolFreq: rnd(0.008, 0.022), patrolOffset: rnd(0, Math.PI * 2),
      cloaked: type === 'stealth', cloakAlpha: type === 'stealth' ? 0.15 : 1,
      cloakTimer: rndI(200, 360), dodgeCooldown: 0, spawnTimer: 0, hitFlash: 0,
    })
  }

  private spawnBoss() {
    const hp = 1200 + this.players.size * 200
    this.boss = {
      id: this.nextId++, x: W / 2, y: -150, vx: 0, vy: 1.2,
      health: hp, maxHealth: hp, active: true, phase: 1,
      shootTimer: 0, animTimer: 0, behaviorTimer: 0,
      behaviorState: 'enter', invincible: 0, hitFlash: 0,
      chargeX: W / 2, chargeY: 160,
    }
  }

  // ─── Main tick (called 30x/s by host) ────────────────────────────────────
  tick() {
    if (this.phase !== 'playing') return
    this.frame++
    if (this.comboTimer > 0) { this.comboTimer--; if (!this.comboTimer) this.combo = 0 }
    if (this.bossWarning > 0) this.bossWarning--
    this.tickPlayers()
    this.tickEnemies()
    this.tickBoss()
    this.tickBullets()
    this.tickPowerUps()
    this.checkCollisions()
    this.checkWaveStatus()
  }

  private nearest(x: number, y: number): GPlayer | null {
    let best: GPlayer | null = null, bd = Infinity
    this.players.forEach(p => { if (!p.active) return; const d = dist(x, y, p.x, p.y); if (d < bd) { bd = d; best = p } })
    return best
  }

  // ─── Players ──────────────────────────────────────────────────────────────
  private tickPlayers() {
    const WCDL = [10, 40, 4, 22]
    this.players.forEach((p, id) => {
      if (!p.active) return
      p.animTimer++
      if (p.hitFlash > 0) p.hitFlash--
      if (p.invincible > 0) p.invincible--
      if (p.shieldActive) { p.shieldTimer--; if (!p.shieldTimer) p.shieldActive = false }
      if (p.rapidFireActive) { p.rapidFireTimer--; if (!p.rapidFireTimer) p.rapidFireActive = false }
      p.weapons.forEach(w => { if (w.cooldown > 0) w.cooldown-- })

      const inp = this.inputs.get(id) ?? { left: false, right: false, up: false, down: false, fire: false, weapon: 0, bomb: false }
      if (inp.weapon !== p.currentWeapon) p.currentWeapon = inp.weapon

      const sp = 5.5
      let ax = 0, ay = 0
      if (inp.left)  ax -= sp
      if (inp.right) ax += sp
      if (inp.up)    ay -= sp
      if (inp.down)  ay += sp
      if (inp.fire)  this.fireWeapon(p)

      if (inp.bomb && p.bombsLeft > 0) {
        p.bombsLeft--; inp.bomb = false
        this.emit({ type: 'sfx', sfx: 'bomb' })
        this.enemies.forEach(e => { if (!e.active) return; this.emitEx(e.x, e.y, 'medium'); e.health = 0; e.active = false; this.score += e.score; this.waveKilled++ })
        this.eBullets.forEach(b => { b.active = false })
        if (this.boss) { this.boss.health -= 250; this.emitEx(this.boss.x, this.boss.y, 'large') }
      }

      p.vx = lerp(p.vx, ax, 0.28); p.vy = lerp(p.vy, ay, 0.28)
      p.x = clamp(p.x + p.vx, 28, W - 28); p.y = clamp(p.y + p.vy, 80, H - 40)
    })
  }

  private fireWeapon(p: GPlayer) {
    const w = p.weapons[p.currentWeapon]
    if (w.cooldown > 0 || (w.ammo !== Infinity && w.ammo <= 0)) return
    const WCDL = [p.rapidFireActive ? 5 : 10, 40, p.rapidFireActive ? 3 : 4, 22]
    w.cooldown = WCDL[p.currentWeapon]
    if (w.ammo !== Infinity) w.ammo--

    switch (p.currentWeapon) {
      case 0:
        this.emit({ type: 'sfx', sfx: 'shoot' })
        this.pBullets.push(this.mkB(p.x - 12, p.y - 22, 0, -16, 'player', 14, 'normal', p.id))
        this.pBullets.push(this.mkB(p.x + 12, p.y - 22, 0, -16, 'player', 14, 'normal', p.id))
        if (p.rapidFireActive) this.pBullets.push(this.mkB(p.x, p.y - 30, 0, -16, 'player', 12, 'normal', p.id))
        break
      case 1: {
        this.emit({ type: 'sfx', sfx: 'missileLaunch' })
        let tid = -1, bd = Infinity
        this.enemies.forEach(e => { if (!e.active) return; const d = dist(p.x, p.y, e.x, e.y); if (d < bd) { bd = d; tid = e.id } })
        if (this.boss?.active && dist(p.x, p.y, this.boss.x, this.boss.y) < bd) tid = this.boss.id
        const m1 = this.mkB(p.x - 18, p.y - 10, -1, -10, 'player', 45, 'homing', p.id); m1.targetId = tid; m1.life = 180
        const m2 = this.mkB(p.x + 18, p.y - 10,  1, -10, 'player', 45, 'homing', p.id); m2.targetId = tid; m2.life = 180
        this.pBullets.push(m1, m2)
        break
      }
      case 2:
        this.emit({ type: 'sfx', sfx: 'laserFire' })
        this.pBullets.push(this.mkB(p.x - 6, p.y - 20, 0, -22, 'player', 8, 'laser', p.id))
        this.pBullets.push(this.mkB(p.x + 6, p.y - 20, 0, -22, 'player', 8, 'laser', p.id))
        break
      case 3: {
        this.emit({ type: 'sfx', sfx: 'laserFire' })
        const plasmas = [
          this.mkB(p.x - 20, p.y, -3, -12, 'player', 35, 'plasma', p.id),
          this.mkB(p.x,       p.y - 10, 0, -14, 'player', 35, 'plasma', p.id),
          this.mkB(p.x + 20, p.y,  3, -12, 'player', 35, 'plasma', p.id),
        ]
        plasmas.forEach(b => { b.life = 90 }); this.pBullets.push(...plasmas)
        break
      }
    }
  }

  private mkB(x: number, y: number, vx: number, vy: number, owner: 'player' | 'enemy', damage: number, type: BulletType, ownerId?: string): GBullet {
    return { id: this.nextId++, x, y, vx, vy, owner, ownerId, damage, active: true, type, trail: [] }
  }

  // ─── Enemies ──────────────────────────────────────────────────────────────
  private tickEnemies() {
    this.enemies.forEach(e => {
      if (!e.active) return
      e.animTimer += 0.1; e.behaviorTimer++
      if (e.invincible > 0) e.invincible--
      if (e.hitFlash > 0) e.hitFlash--
      e.shootTimer--

      if (e.type === 'stealth') {
        e.cloakTimer--
        if (e.cloakTimer <= 0) { e.cloaked = !e.cloaked; e.cloakTimer = e.cloaked ? rndI(180, 300) : rndI(80, 140) }
        e.cloakAlpha = lerp(e.cloakAlpha, e.cloaked ? 0.12 : 1, 0.06)
      }

      if (e.type === 'carrier' && e.behaviorState !== 'enter') {
        e.spawnTimer++
        if (e.spawnTimer >= 200 && this.enemies.filter(x => x.type === 'drone').length < 8) {
          e.spawnTimer = 0
          this.spawnEnemy('drone', 0, 1)
          const nd = this.enemies[this.enemies.length - 1]
          nd.x = e.x + rnd(-40, 40); nd.y = e.y + 30; nd.entryY = e.y + 40
          nd.behaviorState = 'patrol'; this.waveTotal++
        }
      }

      if (e.type === 'ace' && e.dodgeCooldown <= 0) {
        const threat = this.pBullets.find(b => b.active && dist(b.x, b.y, e.x, e.y) < 80 && b.vy < 0)
        if (threat) { e.vx += threat.x < e.x ? 3.5 : -3.5; e.dodgeCooldown = 45 }
      }
      if (e.dodgeCooldown > 0) e.dodgeCooldown--

      const target = this.nearest(e.x, e.y)

      if (e.behaviorState === 'enter') {
        e.vy = lerp(e.vy, e.speed, 0.05); e.vx = lerp(e.vx, 0, 0.05)
        if (e.y >= e.entryY) { e.behaviorState = 'patrol'; e.behaviorTimer = 0 }
      } else if (e.behaviorState === 'patrol') {
        if ((e.type === 'interceptor' || e.type === 'drone') && target) {
          const chase = e.type === 'drone' ? 0.025 : 0.04
          e.vx = lerp(e.vx, (target.x - e.x) * chase * 1.5, 0.12)
          e.vy = lerp(e.vy, ((e.type === 'drone' ? target.y : Math.max(60, target.y - 200)) - e.y) * chase, 0.1)
        } else {
          const tx = W / 2 + Math.sin(this.frame * e.patrolFreq + e.patrolOffset) * e.patrolAmp
          const ty = e.entryY + Math.cos(this.frame * e.patrolFreq * 0.6 + e.patrolOffset) * 18
          e.vx = lerp(e.vx, (tx - e.x) * 0.045, 0.1); e.vy = lerp(e.vy, (ty - e.y) * 0.045, 0.1)
        }
        if (e.type === 'fighter' && target && e.behaviorTimer > 180 && Math.random() < 0.004) {
          e.behaviorState = 'attack'; e.behaviorTimer = 0
          e.targetX = target.x + rnd(-50, 50); e.targetY = target.y
        }
      } else if (e.behaviorState === 'attack') {
        e.vx = lerp(e.vx, (e.targetX - e.x) * 0.09, 0.15)
        e.vy = lerp(e.vy, (e.targetY - e.y) * 0.09, 0.15)
        if (e.y > H || e.behaviorTimer > 100) { e.y = e.entryY - 5; e.behaviorState = 'patrol'; e.behaviorTimer = 0 }
      }

      e.x += e.vx; e.y += e.vy; e.x = clamp(e.x, 20, W - 20)

      if (e.shootTimer <= 0 && e.behaviorState !== 'enter' && target) {
        if (e.type !== 'stealth' || !e.cloaked) {
          this.fireEnemy(e, target); e.shootTimer = e.shootInterval
          this.emit({ type: 'sfx', sfx: 'enemyShoot' })
        }
      }

      if (e.health <= 0) {
        const sz: ExplosionSize = e.type === 'bomber' || e.type === 'carrier' ? 'large' : e.type === 'drone' ? 'tiny' : 'medium'
        this.emitEx(e.x, e.y, sz)
        this.emit({ type: 'sfx', sfx: sz === 'large' ? 'exLarge' : sz === 'tiny' ? 'exSmall' : 'exMedium' })
        this.maybeSpawnPU(e.x, e.y)
        this.combo++; this.comboTimer = 90
        this.score += e.score * Math.max(1, Math.floor(this.combo / 3))
        this.waveKilled++; e.active = false
      }
    })
    this.enemies = this.enemies.filter(e => e.active)
  }

  private fireEnemy(e: GEnemy, t: GPlayer) {
    const dx = t.x - e.x, dy = t.y - e.y, len = Math.hypot(dx, dy) || 1, s = 5.5
    switch (e.type) {
      case 'gunship':
        for (let a = -20; a <= 20; a += 10) {
          const r = a * Math.PI / 180
          this.eBullets.push(this.mkB(e.x, e.y + 20, dx/len*s*Math.cos(r) - dy/len*s*Math.sin(r), dy/len*s*Math.cos(r) + dx/len*s*Math.sin(r), 'enemy', 9, 'spread'))
        }
        break
      case 'bomber':
        this.eBullets.push(this.mkB(e.x-22, e.y+22, -0.8, s*.9, 'enemy', 22, 'missile'))
        this.eBullets.push(this.mkB(e.x+22, e.y+22,  0.8, s*.9, 'enemy', 22, 'missile'))
        break
      case 'stealth':
        this.eBullets.push(this.mkB(e.x, e.y+18, dx/len*(s+1), dy/len*(s+1), 'enemy', 18, 'laser'))
        break
      case 'ace':
        for (let a = -8; a <= 8; a += 8)
          this.eBullets.push(this.mkB(e.x, e.y+16, dx/len*s*Math.cos(a*Math.PI/180), dy/len*s, 'enemy', 14, 'normal'))
        break
      case 'interceptor': {
        const h = this.mkB(e.x, e.y+18, dx/len*4, dy/len*4, 'enemy', 20, 'homing'); h.targetId = 0; h.life = 240
        this.eBullets.push(h)
        break
      }
      case 'drone':
        this.eBullets.push(this.mkB(e.x, e.y+12, dx/len*s, dy/len*s, 'enemy', 8, 'drone_shot'))
        break
      default:
        this.eBullets.push(this.mkB(e.x, e.y+18, dx/len*s, dy/len*s, 'enemy', 13, 'normal'))
    }
  }

  // ─── Boss ────────────────────────────────────────────────────────────────
  private tickBoss() {
    const b = this.boss; if (!b?.active) return
    b.animTimer++; b.behaviorTimer++
    if (b.invincible > 0) b.invincible--
    if (b.hitFlash > 0) b.hitFlash--

    const hpR = b.health / b.maxHealth
    const prev = b.phase
    b.phase = hpR > 0.66 ? 1 : hpR > 0.33 ? 2 : 3
    if (b.phase > prev) this.emit({ type: 'sfx', sfx: 'bossPhase' })

    if (b.behaviorState === 'enter') {
      b.vy = lerp(b.vy, 0, 0.02); if (b.y >= 140) { b.behaviorState = 'patrol'; b.vy = 0 }
    } else if (b.behaviorState === 'patrol') {
      const sp = b.phase === 3 ? 2.8 : b.phase === 2 ? 2.0 : 1.3
      b.vx = lerp(b.vx, (W/2 + Math.sin(this.frame*0.009)*260 - b.x)*0.035*sp, 0.07)
      b.vy = lerp(b.vy, (130 + Math.cos(this.frame*0.006)*45 - b.y)*0.035*sp, 0.07)
      const tgt = this.nearest(b.x, b.y)
      if (b.phase === 3 && b.behaviorTimer > 180 && Math.random() < 0.008 && tgt) {
        b.behaviorState = 'charge'; b.behaviorTimer = 0; b.chargeX = tgt.x; b.chargeY = tgt.y - 80
      }
    } else if (b.behaviorState === 'charge') {
      b.vx = lerp(b.vx, (b.chargeX - b.x)*0.12, 0.2); b.vy = lerp(b.vy, (b.chargeY - b.y)*0.12, 0.2)
      if (b.behaviorTimer > 80) { b.behaviorState = 'patrol'; b.behaviorTimer = 0 }
    }

    b.x += b.vx; b.y += b.vy; b.x = clamp(b.x, 110, W - 110); b.y = clamp(b.y, 60, 270)

    const interval = b.phase === 3 ? 28 : b.phase === 2 ? 45 : 75
    if (++b.shootTimer >= interval) { this.fireBoss(b); b.shootTimer = 0 }

    if (b.health <= 0) {
      this.emitEx(b.x, b.y, 'boss')
      this.emit({ type: 'sfx', sfx: 'exBoss' }); this.emit({ type: 'sfx', sfx: 'victory' })
      this.score += 6000; b.active = false; this.boss = null; this.bossDefeated = true; this.waveKilled++
    }
  }

  private fireBoss(b: GBoss) {
    const tgt = this.nearest(b.x, b.y); if (!tgt) return
    const dx = tgt.x - b.x, dy = tgt.y - b.y, len = Math.hypot(dx, dy)||1, s = 5
    if (b.phase === 1) {
      this.eBullets.push(this.mkB(b.x, b.y+70, dx/len*s, dy/len*s, 'enemy', 15, 'missile'))
      ;[-80,80].forEach(ox => this.eBullets.push(this.mkB(b.x+ox, b.y+40, ox*0.02, s*.8, 'enemy', 12, 'normal')))
    } else if (b.phase === 2) {
      for (let i = 0; i < 6; i++) {
        const a = (i/6)*Math.PI*2 + b.animTimer*0.07
        this.eBullets.push(this.mkB(b.x, b.y+60, Math.cos(a)*s, Math.sin(a)*s+1.5, 'enemy', 14, 'spread'))
      }
      const h = this.mkB(b.x, b.y+60, dx/len*4, dy/len*4, 'enemy', 20, 'homing'); h.targetId=0; h.life=200
      this.eBullets.push(h)
    } else {
      for (let i = 0; i < 8; i++) {
        const a = (i/8)*Math.PI*2 + b.animTimer*0.1
        this.eBullets.push(this.mkB(b.x, b.y+60, Math.cos(a)*(s+1), Math.sin(a)*(s+1)+2, 'enemy', 12, 'spread'))
      }
      ;[-100,-50,50,100].forEach(ox => this.eBullets.push(this.mkB(b.x+ox, b.y+55, ox*0.01, s, 'enemy', 10, 'laser')))
      const h = this.mkB(b.x, b.y+60, dx/len*5, dy/len*5, 'enemy', 25, 'homing'); h.targetId=0; h.life=200
      this.eBullets.push(h)
    }
  }

  // ─── Bullets ─────────────────────────────────────────────────────────────
  private tickBullets() {
    const move = (b: GBullet) => {
      b.trail.unshift({ x: b.x, y: b.y }); if (b.trail.length > 10) b.trail.pop()
      if (b.type === 'homing') {
        let tx = 0, ty = 0
        if (b.owner === 'player') {
          const te = this.enemies.find(e => e.id === b.targetId) || (this.boss?.active && this.boss.id === b.targetId ? this.boss : null) || this.enemies[0] || (this.boss?.active ? this.boss : null)
          if (te) { tx = te.x; ty = te.y } else { tx = b.x + b.vx*10; ty = b.y + b.vy*10 }
        } else {
          const np = this.nearest(b.x, b.y); if (np) { tx = np.x; ty = np.y } else { ty = H+100 }
        }
        const ddx = tx-b.x, ddy = ty-b.y, ll = Math.hypot(ddx,ddy)||1
        const turn = b.owner === 'player' ? 0.18 : 0.07
        b.vx = lerp(b.vx, ddx/ll*(b.owner==='player'?12:5), turn)
        b.vy = lerp(b.vy, ddy/ll*(b.owner==='player'?12:5), turn)
        if (b.life !== undefined) b.life--; if ((b.life??1) <= 0) b.active = false
      }
      if (b.type === 'plasma') { b.vx *= 0.98; if (b.life !== undefined) b.life--; if ((b.life??1) <= 0) b.active = false }
      b.x += b.vx; b.y += b.vy
      if (b.y < -40 || b.y > H+40 || b.x < -40 || b.x > W+40) b.active = false
    }
    this.pBullets.forEach(move); this.eBullets.forEach(move)
    this.pBullets = this.pBullets.filter(b => b.active)
    this.eBullets = this.eBullets.filter(b => b.active)
  }

  private tickPowerUps() {
    this.powerUps.forEach(p => { p.y += p.vy; p.animTimer++; if (p.y > H+20) p.active = false })
    this.powerUps = this.powerUps.filter(p => p.active)
  }

  // ─── Collisions ───────────────────────────────────────────────────────────
  private checkCollisions() {
    this.pBullets.forEach(b => {
      if (!b.active) return
      const r = b.type==='plasma'?18 : b.type==='laser'?8 : 14
      this.enemies.forEach(e => {
        if (!e.active || e.behaviorState==='enter') return
        if (e.cloaked && Math.random() < 0.6) return
        if (dist(b.x,b.y,e.x,e.y) < r+14) {
          e.health -= b.damage; e.hitFlash = 6
          this.emit({ type: 'dmg', x: e.x, y: e.y-20, val: b.damage, isPlayer: false })
          if (b.type !== 'laser') b.active = false
          if (!e.invincible) e.invincible = 3
        }
      })
      if (this.boss?.active && dist(b.x,b.y,this.boss.x,this.boss.y) < (b.type==='plasma'?22:18)+75) {
        this.boss.health -= b.damage; this.boss.hitFlash = 4
        this.emit({ type: 'dmg', x: this.boss.x+rnd(-30,30), y: this.boss.y-40, val: b.damage, isPlayer: false })
        if (b.type !== 'laser') b.active = false
        if (!this.boss.invincible) this.boss.invincible = 2
      }
    })

    this.eBullets.forEach(b => {
      if (!b.active) return
      this.players.forEach(p => {
        if (!p.active || p.invincible > 0) return
        if (dist(b.x,b.y,p.x,p.y) < 20) {
          b.active = false
          if (p.shieldActive) {
            this.emit({ type: 'sfx', sfx: 'shieldHit' }); this.emitEx(b.x,b.y,'tiny','#00ffff')
          } else {
            p.health -= b.damage; p.hitFlash = 10; p.invincible = 55
            this.emit({ type: 'sfx', sfx: 'playerHit' }); this.emitEx(b.x,b.y,'small')
            this.emit({ type: 'dmg', x: p.x, y: p.y-30, val: b.damage, isPlayer: true })
            if (p.health <= 0) this.killPlayer(p)
          }
        }
      })
    })

    this.enemies.forEach(e => {
      if (!e.active || e.type==='carrier') return
      this.players.forEach(p => {
        if (!p.active || p.invincible > 0) return
        if (dist(p.x,p.y,e.x,e.y) < 32) {
          this.emitEx(e.x,e.y,'medium'); e.active=false; this.waveKilled++; this.score+=e.score/2
          if (!p.shieldActive) { p.health -= 28; p.invincible = 100 }
          if (p.health <= 0) this.killPlayer(p)
        }
      })
    })

    this.powerUps.forEach(pu => {
      if (!pu.active) return
      this.players.forEach(p => {
        if (!p.active || dist(pu.x,pu.y,p.x,p.y) > 32) return
        pu.active = false; this.emit({ type: 'sfx', sfx: 'powerUp' })
        switch (pu.type) {
          case 'health':       p.health = Math.min(p.health+35, p.maxHealth); break
          case 'shield':       p.shieldActive=true; p.shieldTimer=400; break
          case 'rapidfire':    p.rapidFireActive=true; p.rapidFireTimer=480; break
          case 'bomb':         p.bombsLeft = Math.min(p.bombsLeft+1,3); break
          case 'laser_ammo':   p.weapons[2].ammo = Math.min(p.weapons[2].ammo+40, p.weapons[2].maxAmmo); break
          case 'plasma_ammo':  p.weapons[3].ammo = Math.min(p.weapons[3].ammo+12, p.weapons[3].maxAmmo); break
          case 'missile_pack': p.weapons[1].ammo = Math.min(p.weapons[1].ammo+6,  p.weapons[1].maxAmmo); break
        }
      })
    })
    this.powerUps = this.powerUps.filter(p => p.active)
  }

  private killPlayer(p: GPlayer) {
    this.emitEx(p.x, p.y, 'large'); p.lives--
    if (p.lives <= 0) {
      p.active = false; p.health = 0
      if (![...this.players.values()].some(pl => pl.active || pl.lives > 0)) {
        this.phase = 'gameover'; this.emit({ type: 'sfx', sfx: 'gameOver' })
      }
    } else {
      p.health = 100; p.x = W/2 + rnd(-80,80); p.y = H-130; p.vx=0; p.vy=0; p.invincible=200
    }
  }

  private checkWaveStatus() {
    if (this.waveComplete) {
      if (--this.waveTimer <= 0) { this.wave++; this.pBullets=[]; this.eBullets=[]; this.spawnWave(this.wave) }
      return
    }
    if (this.enemies.length === 0 && !this.boss?.active && this.waveKilled >= Math.max(1, this.waveTotal-1)) {
      if (this.wave >= TOTAL_WAVES && this.bossDefeated) { this.phase='victory'; return }
      if (this.wave < TOTAL_WAVES) { this.waveComplete=true; this.waveTimer=170; this.emit({ type:'sfx', sfx:'waveClear' }) }
    }
  }

  private maybeSpawnPU(x: number, y: number) {
    if (Math.random() > 0.28) return
    const types: PowerUpType[] = ['health','shield','rapidfire','bomb','laser_ammo','plasma_ammo','missile_pack']
    const weights = [0.30,0.18,0.18,0.09,0.10,0.08,0.07]
    let r = Math.random(), type: PowerUpType = 'health'
    for (let i = 0; i < weights.length; i++) { if (r < weights[i]) { type = types[i]; break } r -= weights[i] }
    this.powerUps.push({ id: this.nextId++, x, y, vy: 1.4, type, active: true, animTimer: rnd(0,100) })
  }

  private emitEx(x: number, y: number, size: ExplosionSize, color?: string) {
    this.emit({ type: 'explosion', x, y, size, color })
  }

  // ─── Snapshot serialization ───────────────────────────────────────────────
  snapshot(): GameSnapshot {
    return {
      frame: this.frame, phase: this.phase, wave: this.wave,
      waveKilled: this.waveKilled, waveTotal: this.waveTotal,
      waveComplete: this.waveComplete, waveTimer: this.waveTimer,
      bossWarning: this.bossWarning, bossActive: this.bossActive,
      score: this.score, combo: this.combo, comboTimer: this.comboTimer,
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, colorIdx: p.colorIdx, isHost: p.isHost,
        x: p.x, y: p.y, vx: p.vx, vy: p.vy,
        health: p.health, maxHealth: p.maxHealth, active: p.active,
        invincible: p.invincible, hitFlash: p.hitFlash,
        currentWeapon: p.currentWeapon,
        weapons: p.weapons.map((w:WeaponState) => ({ ammo: w.ammo, maxAmmo: w.maxAmmo, cooldown: w.cooldown })),
        shieldActive: p.shieldActive, shieldTimer: p.shieldTimer,
        rapidFireActive: p.rapidFireActive, lives: p.lives, score: p.score, bombsLeft: p.bombsLeft,
      })),
      enemies: this.enemies.map(e => ({
        id: e.id, x: e.x, y: e.y, vx: e.vx, vy: e.vy, type: e.type,
        health: e.health, maxHealth: e.maxHealth, cloakAlpha: e.cloakAlpha,
        hitFlash: e.hitFlash, behaviorState: e.behaviorState, animTimer: e.animTimer,
      })),
      boss: this.boss?.active ? {
        x: this.boss.x, y: this.boss.y, vx: this.boss.vx, vy: this.boss.vy,
        health: this.boss.health, maxHealth: this.boss.maxHealth, phase: this.boss.phase,
        animTimer: this.boss.animTimer, hitFlash: this.boss.hitFlash, behaviorState: this.boss.behaviorState,
      } : null,
      pBullets: this.pBullets.map(b => ({ id:b.id,x:b.x,y:b.y,vx:b.vx,vy:b.vy,type:b.type,owner:b.owner,trail:b.trail.slice(0,6) })),
      eBullets: this.eBullets.map(b => ({ id:b.id,x:b.x,y:b.y,vx:b.vx,vy:b.vy,type:b.type,owner:b.owner,trail:b.trail.slice(0,6) })),
      powerUps: this.powerUps.map(p => ({ id:p.id,x:p.x,y:p.y,type:p.type,animTimer:p.animTimer })),
    }
  }
}
