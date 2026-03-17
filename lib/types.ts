// ─── Shared game types ────────────────────────────────────────────────────────

export type GamePhase = 'lobby' | 'playing' | 'gameover' | 'victory'
export type EnemyType = 'fighter' | 'bomber' | 'gunship' | 'stealth' | 'ace' | 'interceptor' | 'carrier' | 'drone'
export type BulletType = 'normal' | 'spread' | 'missile' | 'laser' | 'plasma' | 'homing' | 'drone_shot'
export type PowerUpType = 'health' | 'shield' | 'rapidfire' | 'bomb' | 'laser_ammo' | 'plasma_ammo' | 'missile_pack'
export type ExplosionSize = 'tiny' | 'small' | 'medium' | 'large' | 'boss'
export type SFXEvent = 'shoot' | 'enemyShoot' | 'exSmall' | 'exMedium' | 'exLarge' | 'exBoss' | 'playerHit' | 'powerUp' | 'shieldHit' | 'laserFire' | 'missileLaunch' | 'bomb' | 'waveClear' | 'gameOver' | 'victory' | 'bossPhase'

export interface Vec2 { x: number; y: number }

export interface PlayerInput {
  left: boolean; right: boolean; up: boolean; down: boolean
  fire: boolean; weapon: number; bomb: boolean
}

export interface WeaponState { ammo: number; maxAmmo: number; cooldown: number }

export interface PlayerSnap {
  id: string; name: string; colorIdx: number; isHost: boolean
  x: number; y: number; vx: number; vy: number
  health: number; maxHealth: number; active: boolean
  invincible: number; hitFlash: number
  currentWeapon: number; weapons: WeaponState[]
  shieldActive: boolean; shieldTimer: number
  rapidFireActive: boolean; lives: number; score: number; bombsLeft: number
}

export interface EnemySnap {
  id: number; x: number; y: number; vx: number; vy: number
  type: EnemyType; health: number; maxHealth: number
  cloakAlpha: number; hitFlash: number; behaviorState: string; animTimer: number
}

export interface BossSnap {
  x: number; y: number; vx: number; vy: number
  health: number; maxHealth: number; phase: number
  animTimer: number; hitFlash: number; behaviorState: string
}

export interface BulletSnap {
  id: number; x: number; y: number; vx: number; vy: number
  type: BulletType; owner: 'player' | 'enemy'
  trail: Vec2[]
}

export interface PowerUpSnap {
  id: number; x: number; y: number; type: PowerUpType; animTimer: number
}

export interface GameSnapshot {
  frame: number; phase: GamePhase; wave: number
  waveKilled: number; waveTotal: number
  waveComplete: boolean; waveTimer: number
  bossWarning: number; bossActive: boolean
  players: PlayerSnap[]; enemies: EnemySnap[]; boss: BossSnap | null
  pBullets: BulletSnap[]; eBullets: BulletSnap[]
  powerUps: PowerUpSnap[]
  score: number; combo: number; comboTimer: number
}

// ─── P2P message protocol ─────────────────────────────────────────────────────
export type P2PMsg =
  | { t: 'join';    name: string }
  | { t: 'joined';  id: string; name: string; colorIdx: number; players: { id: string; name: string; colorIdx: number }[] }
  | { t: 'player-joined'; id: string; name: string; colorIdx: number }
  | { t: 'player-left';   id: string }
  | { t: 'start' }
  | { t: 'restart' }
  | { t: 'input';   id: string; input: PlayerInput }
  | { t: 'state';   snap: GameSnapshot }
  | { t: 'sfx';     sfx: SFXEvent }
  | { t: 'explosion'; x: number; y: number; size: ExplosionSize; color?: string }
  | { t: 'dmg';     x: number; y: number; val: number; isPlayer: boolean }
  | { t: 'ping' }
  | { t: 'pong' }
