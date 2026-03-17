'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { DataConnection } from 'peerjs'
import { GameEngine, W, H } from '@/lib/GameEngine'
import type {
  GameSnapshot, PlayerInput, P2PMsg, SFXEvent, ExplosionSize,
  BulletType, EnemyType, PlayerSnap, EnemySnap, BossSnap,
  BulletSnap, PowerUpSnap, Vec2
} from '@/lib/types'

// ══════════════════════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════════════════════
const PLAYER_COLORS = ['#00d4ff', '#ff8c00', '#00ff88', '#ff44ff']
const PLAYER_WINGS  = ['#0088bb', '#bb5500', '#007744', '#bb00bb']
const EC: Record<string, { body: string; wing: string; acc: string }> = {
  fighter:     { body:'#ff4040', wing:'#cc1111', acc:'#ff9999' },
  bomber:      { body:'#ff8c00', wing:'#bb5500', acc:'#ffcc55' },
  gunship:     { body:'#cc44ff', wing:'#7700cc', acc:'#ff88ff' },
  stealth:     { body:'#223344', wing:'#112233', acc:'#44aaff' },
  ace:         { body:'#ffcc00', wing:'#bb8800', acc:'#ffee88' },
  interceptor: { body:'#00ff88', wing:'#007744', acc:'#88ffcc' },
  carrier:     { body:'#886644', wing:'#664422', acc:'#ffcc88' },
  drone:       { body:'#ff8888', wing:'#cc4444', acc:'#ffcccc' },
}
const BC = { body:'#880088', wing:'#440044', acc:'#ff00ff', glow:'#ff00ff' }
const TICK_RATE = 30
const BROADCAST_RATE = 20

// ══════════════════════════════════════════════════════════
//  CLIENT-SIDE EFFECTS
// ══════════════════════════════════════════════════════════
interface Particle { x:number;y:number;vx:number;vy:number;life:number;size:number;color:string;gravity:boolean }
interface LocalEx  { id:number;x:number;y:number;particles:Particle[];sw:number;maxSw:number;color:string }
interface Star     { x:number;y:number;speed:number;bright:number;size:number;twOff:number }
interface Cloud    { x:number;y:number;speed:number;w:number;h:number;opacity:number;col:string }
interface DmgNum   { id:number;x:number;y:number;val:number;life:number;vy:number;color:string }

// ══════════════════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════════════════
const rnd = (a:number,b:number) => a+Math.random()*(b-a)
const rndI = (a:number,b:number) => Math.floor(rnd(a,b+1))
const glw = (ctx:CanvasRenderingContext2D,c:string,b:number) => { ctx.shadowColor=c; ctx.shadowBlur=b }
const nog = (ctx:CanvasRenderingContext2D) => { ctx.shadowBlur=0; ctx.shadowColor='transparent' }

function makeStarLayer(count:number,sMin:number,sMax:number):Star[]{
  return Array.from({length:count},()=>({x:rnd(0,W),y:rnd(0,H),speed:rnd(sMin,sMax),bright:rnd(.4,1),size:rnd(.5,sMax*2.5),twOff:rnd(0,Math.PI*2)}))
}
function makeClouds():Cloud[]{
  const cols=['#1a3a5c','#2a4a6c','#0d2233','#1a2840']
  return Array.from({length:14},()=>({x:rnd(-100,W+100),y:rnd(0,H),speed:rnd(.15,.5),w:rnd(100,280),h:rnd(35,80),opacity:rnd(.04,.13),col:cols[rndI(0,3)]}))
}

// ══════════════════════════════════════════════════════════
//  AUDIO ENGINE
// ══════════════════════════════════════════════════════════
class AudioEngine {
  private ctx:AudioContext|null=null
  private sfxG:GainNode|null=null
  private musG:GainNode|null=null
  private mRun=false; private mInt:ReturnType<typeof setTimeout>|null=null; private beat=0

  init(){
    if(this.ctx) return
    try{
      this.ctx=new AudioContext()
      const master=this.ctx.createGain(); master.gain.value=1; master.connect(this.ctx.destination)
      this.sfxG=this.ctx.createGain(); this.sfxG.gain.value=0.32; this.sfxG.connect(master)
      this.musG=this.ctx.createGain(); this.musG.gain.value=0.16; this.musG.connect(master)
    }catch{}
  }
  resume(){this.ctx?.state==='suspended'&&this.ctx.resume()}

  private note(f:number,t:OscillatorType,dur:number,atk=.01,rel=.1,g:GainNode|null=this.sfxG,fe?:number,delay=0){
    if(!this.ctx||!g) return
    const T=this.ctx.currentTime+delay
    const o=this.ctx.createOscillator(); const env=this.ctx.createGain()
    o.type=t; o.frequency.setValueAtTime(f,T); if(fe)o.frequency.exponentialRampToValueAtTime(fe,T+dur)
    env.gain.setValueAtTime(0,T); env.gain.linearRampToValueAtTime(1,T+atk)
    env.gain.setValueAtTime(1,T+dur-rel); env.gain.exponentialRampToValueAtTime(.001,T+dur)
    o.connect(env); env.connect(g); o.start(T); o.stop(T+dur+.05)
  }
  private noise(dur:number,freq:number,q:number,gain=.3,delay=0){
    if(!this.ctx||!this.sfxG) return
    const T=this.ctx.currentTime+delay
    const buf=this.ctx.createBuffer(1,this.ctx.sampleRate*dur,this.ctx.sampleRate)
    const d=buf.getChannelData(0); for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1
    const src=this.ctx.createBufferSource(); src.buffer=buf
    const flt=this.ctx.createBiquadFilter(); flt.type='bandpass'; flt.frequency.value=freq; flt.Q.value=q
    const env=this.ctx.createGain(); env.gain.setValueAtTime(gain,T); env.gain.exponentialRampToValueAtTime(.001,T+dur)
    src.connect(flt); flt.connect(env); env.connect(this.sfxG); src.start(T); src.stop(T+dur)
  }

  play(s:SFXEvent){
    switch(s){
      case'shoot':         this.note(880,'sawtooth',.08,.001,.07,this.sfxG,220); this.note(440,'square',.06,.001,.05,this.sfxG,110); break
      case'enemyShoot':    this.note(220,'sawtooth',.1,.001,.08,this.sfxG,110); break
      case'exSmall':       this.noise(.25,800,.5,.5); this.note(120,'sawtooth',.2,.001,.18,this.sfxG,40); break
      case'exMedium':      this.noise(.45,400,.3,.8); this.note(80,'sawtooth',.35,.001,.3,this.sfxG,40); break
      case'exLarge':       this.noise(.7,200,.2,1); this.note(60,'sawtooth',.5,.001,.45,this.sfxG,30); break
      case'exBoss':        this.noise(1.2,100,.15,1); this.note(40,'sawtooth',.8,.001,.7,this.sfxG,25); break
      case'playerHit':     this.noise(.3,1200,1.5,.6); this.note(200,'sawtooth',.2,.001,.15,this.sfxG,60); break
      case'powerUp':       [523,659,784,1047].forEach((f,i)=>this.note(f,'sine',.12,.01,.08,this.sfxG,undefined,i*.06)); break
      case'shieldHit':     this.note(1200,'sine',.15,.001,.12,this.sfxG,800); break
      case'laserFire':     this.note(1800,'sawtooth',.12,.001,.1,this.sfxG,400); break
      case'missileLaunch': this.noise(.2,600,.8,.5); this.note(150,'sawtooth',.18,.01,.1,this.sfxG,200); break
      case'bomb':          this.noise(.8,150,.2,1); this.note(50,'sawtooth',.6,.001,.5,this.sfxG,35); break
      case'waveClear':     [523,659,784,1047,1319].forEach((f,i)=>this.note(f,'sine',.2,.01,.15,this.sfxG,undefined,i*.1)); break
      case'gameOver':      [440,330,220,110].forEach((f,i)=>this.note(f,'sawtooth',.4,.01,.35,this.sfxG,undefined,i*.25)); break
      case'victory':       [523,659,784,1047,784,880,1047,1319].forEach((f,i)=>this.note(f,'sine',.18,.01,.12,this.sfxG,undefined,i*.12)); break
      case'bossPhase':     this.note(110,'sawtooth',.5,.01,.4,this.sfxG,55); this.note(220,'square',.3,.01,.2,this.sfxG,110); break
    }
  }

  startMusic(){
    if(!this.ctx||this.mRun)return; this.mRun=true; this.beat=0; this.musicTick()
  }
  stopMusic(){ this.mRun=false; if(this.mInt)clearTimeout(this.mInt) }

  private musicTick(){
    if(!this.mRun||!this.ctx||!this.musG)return
    const bpm=145,bd=60/bpm,T=this.ctx.currentTime
    const bass=[55,55,110,55,82,55,110,55][this.beat%8]
    const bo=this.ctx.createOscillator(); const be=this.ctx.createGain()
    bo.type='sawtooth'; bo.frequency.value=bass; be.gain.setValueAtTime(.9,T); be.gain.exponentialRampToValueAtTime(.001,T+bd*.85)
    bo.connect(be); be.connect(this.musG); bo.start(T); bo.stop(T+bd)
    const mel=[[0,-1,523,-1,659,-1,523,440],[784,-1,659,-1,523,-1,440,-1],[0,523,-1,659,784,-1,659,523],[880,-1,784,-1,659,523,-1,440]]
    const mn=mel[Math.floor(this.beat/8)%4][this.beat%8]
    if(mn>0){const mo=this.ctx.createOscillator();const me=this.ctx.createGain();mo.type='square';mo.frequency.value=mn;me.gain.setValueAtTime(0,T);me.gain.linearRampToValueAtTime(.4,T+.01);me.gain.exponentialRampToValueAtTime(.001,T+bd*.7);mo.connect(me);me.connect(this.musG);mo.start(T);mo.stop(T+bd)}
    if(this.beat%4===0){const kb=this.ctx.createBuffer(1,this.ctx.sampleRate*.15,this.ctx.sampleRate);const kd=kb.getChannelData(0);for(let i=0;i<kd.length;i++)kd[i]=(Math.random()*2-1)*Math.exp(-i/(this.ctx.sampleRate*.04));const ks=this.ctx.createBufferSource();ks.buffer=kb;const ko=this.ctx.createOscillator();const ke=this.ctx.createGain();ko.frequency.setValueAtTime(150,T);ko.frequency.exponentialRampToValueAtTime(40,T+.08);ke.gain.setValueAtTime(1,T);ke.gain.exponentialRampToValueAtTime(.001,T+.15);ko.connect(ke);ke.connect(this.musG);const kng=this.ctx.createGain();kng.gain.value=.5;ks.connect(kng);kng.connect(this.musG);ko.start(T);ko.stop(T+.15);ks.start(T);ks.stop(T+.15)}
    if(this.beat%4===2){const sb=this.ctx.createBuffer(1,this.ctx.sampleRate*.12,this.ctx.sampleRate);const sd=sb.getChannelData(0);for(let i=0;i<sd.length;i++)sd[i]=(Math.random()*2-1)*Math.exp(-i/(this.ctx.sampleRate*.06));const ss=this.ctx.createBufferSource();ss.buffer=sb;const sf=this.ctx.createBiquadFilter();sf.type='bandpass';sf.frequency.value=3000;sf.Q.value=.5;const sng=this.ctx.createGain();sng.gain.value=.7;ss.connect(sf);sf.connect(sng);sng.connect(this.musG);ss.start(T);ss.stop(T+.12)}
    {const hb=this.ctx.createBuffer(1,this.ctx.sampleRate*.04,this.ctx.sampleRate);const hd=hb.getChannelData(0);for(let i=0;i<hd.length;i++)hd[i]=(Math.random()*2-1)*Math.exp(-i/(this.ctx.sampleRate*.02));const hs=this.ctx.createBufferSource();hs.buffer=hb;const hf=this.ctx.createBiquadFilter();hf.type='highpass';hf.frequency.value=8000;const hng=this.ctx.createGain();hng.gain.value=.2;hs.connect(hf);hf.connect(hng);hng.connect(this.musG);hs.start(T);hs.stop(T+.04)}
    this.beat++; this.mInt=setTimeout(()=>this.musicTick(),bd*1000-5)
  }
}

const audioEngine = new AudioEngine()

// ══════════════════════════════════════════════════════════
//  DRAWING
// ══════════════════════════════════════════════════════════
function drawBg(ctx:CanvasRenderingContext2D,frame:number,stars:Star[][],clouds:Cloud[],scrollY:number){
  const sky=ctx.createLinearGradient(0,0,0,H); sky.addColorStop(0,'#010508'); sky.addColorStop(.5,'#040b18'); sky.addColorStop(1,'#081224')
  ctx.fillStyle=sky; ctx.fillRect(0,0,W,H)
  stars.forEach((layer,li)=>{
    layer.forEach(s=>{
      const tw=.5+.5*Math.sin(frame*.05+s.twOff); ctx.globalAlpha=s.bright*tw*(.3+li*.3)
      if(li===2)glw(ctx,'#aaccff',4); ctx.fillStyle=li===2?'#e8f0ff':'#aabfdd'
      ctx.beginPath();ctx.arc(s.x,s.y,s.size,0,Math.PI*2);ctx.fill()
    }); nog(ctx)
  }); ctx.globalAlpha=1
  clouds.forEach(c=>{
    ctx.globalAlpha=c.opacity
    const cg=ctx.createRadialGradient(c.x,c.y,0,c.x,c.y,c.w/2); cg.addColorStop(0,c.col); cg.addColorStop(1,'transparent')
    ctx.fillStyle=cg; ctx.beginPath(); ctx.ellipse(c.x,c.y,c.w/2,c.h/2,0,0,Math.PI*2); ctx.fill()
  }); ctx.globalAlpha=1
  const gs=90,off=(scrollY*1.8)%gs
  ctx.strokeStyle='rgba(0,180,80,.04)'; ctx.lineWidth=.5
  for(let y=-gs+off;y<H+gs;y+=gs){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}
  for(let x=0;x<W+gs;x+=gs){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}
}

function drawPlayer(ctx:CanvasRenderingContext2D,p:PlayerSnap,frame:number,isMe:boolean){
  ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.vx*.05)
  if(!p.active){ctx.globalAlpha=.15}
  if(p.invincible>0&&Math.floor(p.invincible/5)%2===0&&p.active){ctx.restore();return}
  const body=PLAYER_COLORS[p.colorIdx], wing=PLAYER_WINGS[p.colorIdx]
  const eLen=22+10*Math.abs(Math.sin(frame*.22))
  glw(ctx,'#ff8800',18)
  const exG=ctx.createLinearGradient(0,18,0,18+eLen); exG.addColorStop(0,'#ffff88'); exG.addColorStop(.5,'#ff8800'); exG.addColorStop(1,'rgba(255,80,0,0)')
  ctx.fillStyle=exG; ctx.beginPath(); ctx.moveTo(-7,18); ctx.lineTo(7,18); ctx.lineTo(3,18+eLen); ctx.lineTo(-3,18+eLen); ctx.closePath(); ctx.fill(); nog(ctx)
  if(p.shieldActive){
    ctx.globalAlpha=.25+.15*Math.sin(frame*.12); glw(ctx,'#00ffff',28)
    const sg=ctx.createRadialGradient(0,0,20,0,0,52); sg.addColorStop(0,'rgba(0,255,255,.04)'); sg.addColorStop(1,'rgba(0,255,255,.4)')
    ctx.fillStyle=sg; ctx.beginPath(); ctx.arc(0,0,52,0,Math.PI*2); ctx.fill()
    ctx.strokeStyle='#88ffff'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(0,0,52,0,Math.PI*2); ctx.stroke()
    ctx.globalAlpha=1; nog(ctx)
  }
  glw(ctx,body,12); ctx.fillStyle=wing
  ctx.beginPath(); ctx.moveTo(-8,-2); ctx.lineTo(-36,10); ctx.lineTo(-32,18); ctx.lineTo(-6,8); ctx.closePath(); ctx.fill()
  ctx.beginPath(); ctx.moveTo(8,-2); ctx.lineTo(36,10); ctx.lineTo(32,18); ctx.lineTo(6,8); ctx.closePath(); ctx.fill()
  ctx.beginPath(); ctx.moveTo(-6,10); ctx.lineTo(-16,22); ctx.lineTo(-6,19); ctx.closePath(); ctx.fill()
  ctx.beginPath(); ctx.moveTo(6,10); ctx.lineTo(16,22); ctx.lineTo(6,19); ctx.closePath(); ctx.fill()
  const fG=ctx.createLinearGradient(-8,-38,8,-38); fG.addColorStop(0,wing); fG.addColorStop(.5,body); fG.addColorStop(1,wing)
  ctx.fillStyle=fG; ctx.beginPath(); ctx.moveTo(0,-38); ctx.bezierCurveTo(-4,-28,-8,-16,-8,-4); ctx.lineTo(-5,10); ctx.lineTo(-4,19); ctx.lineTo(4,19); ctx.lineTo(5,10); ctx.bezierCurveTo(8,-4,8,-16,4,-28); ctx.closePath(); ctx.fill()
  glw(ctx,'#00ffff',22)
  const cpG=ctx.createRadialGradient(-2,-18,1,0,-14,8); cpG.addColorStop(0,'#eeffff'); cpG.addColorStop(.5,body); cpG.addColorStop(1,'#004466')
  ctx.fillStyle=cpG; ctx.beginPath(); ctx.ellipse(0,-14,5.5,11,0,0,Math.PI*2); ctx.fill()
  nog(ctx)
  // Name + YOU indicator
  ctx.fillStyle=isMe?body:'rgba(255,255,255,0.7)'; ctx.font=`${isMe?'bold ':''} 10px "Share Tech Mono"`; ctx.textAlign='center'
  ctx.fillText(p.name+(isMe?' ◀':''),0,-52)
  if(p.hitFlash>0){ctx.globalAlpha=p.hitFlash/10;ctx.fillStyle='#ff4444';ctx.beginPath();ctx.moveTo(0,-38);ctx.lineTo(-36,10);ctx.lineTo(36,10);ctx.closePath();ctx.fill();ctx.globalAlpha=1}
  nog(ctx); ctx.restore()
}

function drawEnemy(ctx:CanvasRenderingContext2D,e:EnemySnap,frame:number){
  ctx.save(); ctx.translate(e.x,e.y); ctx.rotate(Math.PI)
  const tilt=-e.vx*.04; ctx.rotate(tilt)
  const pal=EC[e.type]??EC.fighter; ctx.globalAlpha=e.cloakAlpha
  const sc=e.type==='bomber'?1.5:e.type==='carrier'?2.0:e.type==='gunship'?1.25:e.type==='drone'?.7:1
  ctx.scale(sc,sc)
  const eLen=14+6*Math.abs(Math.sin(frame*.25+e.id))
  glw(ctx,pal.body,7); ctx.fillStyle=pal.body; ctx.globalAlpha*=.7
  ctx.beginPath();ctx.moveTo(-4,20);ctx.lineTo(4,20);ctx.lineTo(2,20+eLen);ctx.lineTo(-2,20+eLen);ctx.closePath();ctx.fill()
  ctx.globalAlpha=e.cloakAlpha
  ctx.fillStyle=pal.wing
  if(e.type==='stealth'){ctx.beginPath();ctx.moveTo(0,-30);ctx.lineTo(-32,20);ctx.lineTo(0,10);ctx.lineTo(32,20);ctx.closePath();ctx.fill()}
  else if(e.type==='bomber'||e.type==='carrier'){
    ctx.beginPath();ctx.moveTo(-12,-8);ctx.lineTo(-50,18);ctx.lineTo(-44,28);ctx.lineTo(-10,14);ctx.closePath();ctx.fill()
    ctx.beginPath();ctx.moveTo(12,-8);ctx.lineTo(50,18);ctx.lineTo(44,28);ctx.lineTo(10,14);ctx.closePath();ctx.fill()
  } else if(e.type==='gunship'){
    ctx.beginPath();ctx.moveTo(-8,-5);ctx.lineTo(-38,14);ctx.lineTo(-32,24);ctx.lineTo(-6,10);ctx.closePath();ctx.fill()
    ctx.beginPath();ctx.moveTo(8,-5);ctx.lineTo(38,14);ctx.lineTo(32,24);ctx.lineTo(6,10);ctx.closePath();ctx.fill()
    glw(ctx,pal.acc,10);ctx.fillStyle=pal.acc;ctx.fillRect(-36,10,12,7);ctx.fillRect(24,10,12,7)
  } else if(e.type==='drone'){
    ctx.beginPath();ctx.moveTo(-4,-8);ctx.lineTo(-14,8);ctx.lineTo(0,5);ctx.lineTo(14,8);ctx.lineTo(4,-8);ctx.closePath();ctx.fill()
  } else {
    ctx.beginPath();ctx.moveTo(-6,-5);ctx.lineTo(-26,12);ctx.lineTo(-22,20);ctx.lineTo(-4,8);ctx.closePath();ctx.fill()
    ctx.beginPath();ctx.moveTo(6,-5);ctx.lineTo(26,12);ctx.lineTo(22,20);ctx.lineTo(4,8);ctx.closePath();ctx.fill()
  }
  if(e.type!=='stealth'&&e.type!=='drone'){
    ctx.fillStyle=pal.wing
    ctx.beginPath();ctx.moveTo(-4,8);ctx.lineTo(-11,20);ctx.lineTo(-4,16);ctx.closePath();ctx.fill()
    ctx.beginPath();ctx.moveTo(4,8);ctx.lineTo(11,20);ctx.lineTo(4,16);ctx.closePath();ctx.fill()
  }
  const fG=ctx.createLinearGradient(-6,-30,6,-30);fG.addColorStop(0,pal.wing);fG.addColorStop(.5,pal.body);fG.addColorStop(1,pal.wing)
  ctx.fillStyle=fG;ctx.beginPath();ctx.moveTo(0,-30);ctx.lineTo(-6,-12);ctx.lineTo(-5,8);ctx.lineTo(-3,20);ctx.lineTo(3,20);ctx.lineTo(5,8);ctx.lineTo(6,-12);ctx.closePath();ctx.fill()
  glw(ctx,pal.acc,14);ctx.fillStyle=pal.acc;ctx.beginPath();ctx.ellipse(0,-12,4,8,0,0,Math.PI*2);ctx.fill()
  if(e.hitFlash>0){ctx.globalAlpha=(e.hitFlash/6)*e.cloakAlpha;ctx.fillStyle='#ffffff';ctx.scale(1/sc,1/sc);ctx.fillRect(-30*sc,-35*sc,60*sc,60*sc);ctx.scale(sc,sc);ctx.globalAlpha=e.cloakAlpha}
  nog(ctx);ctx.scale(1/sc,1/sc);ctx.rotate(-Math.PI);ctx.rotate(-tilt)
  ctx.globalAlpha=e.cloakAlpha
  const bw=28,bh=3,hr=e.health/e.maxHealth
  ctx.fillStyle='rgba(0,0,0,.7)';ctx.fillRect(-bw/2,-46,bw,bh)
  const hc=hr>.5?'#00ff41':hr>.25?'#ffaa00':'#ff3030'
  glw(ctx,hc,4);ctx.fillStyle=hc;ctx.fillRect(-bw/2,-46,bw*hr,bh);nog(ctx)
  ctx.globalAlpha=1;ctx.restore()
}

function drawBoss(ctx:CanvasRenderingContext2D,b:BossSnap,frame:number){
  ctx.save();ctx.translate(b.x,b.y)
  const pulse=.85+.15*Math.sin(b.animTimer*.07)
  ;[-65,0,65].forEach((ex,i)=>{
    const el=30+15*Math.abs(Math.sin(frame*.2+i)); const eg=ctx.createLinearGradient(ex,65,ex,65+el)
    eg.addColorStop(0,BC.glow);eg.addColorStop(1,'transparent');ctx.fillStyle=eg
    ctx.beginPath();ctx.moveTo(ex-6,65);ctx.lineTo(ex+6,65);ctx.lineTo(ex+3,65+el);ctx.lineTo(ex-3,65+el);ctx.closePath();ctx.fill()
  })
  glw(ctx,BC.glow,35*pulse); ctx.fillStyle=BC.wing
  ctx.beginPath();ctx.moveTo(-22,-15);ctx.lineTo(-110,35);ctx.lineTo(-95,65);ctx.lineTo(-55,45);ctx.lineTo(-18,22);ctx.closePath();ctx.fill()
  ctx.beginPath();ctx.moveTo(22,-15);ctx.lineTo(110,35);ctx.lineTo(95,65);ctx.lineTo(55,45);ctx.lineTo(18,22);ctx.closePath();ctx.fill()
  ctx.fillStyle=BC.body
  ctx.beginPath();ctx.moveTo(-16,-18);ctx.lineTo(-60,22);ctx.lineTo(-50,48);ctx.lineTo(-14,28);ctx.closePath();ctx.fill()
  ctx.beginPath();ctx.moveTo(16,-18);ctx.lineTo(60,22);ctx.lineTo(50,48);ctx.lineTo(14,28);ctx.closePath();ctx.fill()
  if(b.phase>=2){glw(ctx,'#ff4400',14);ctx.fillStyle='#ff4400';[-38,38].forEach(ox=>{ctx.beginPath();ctx.ellipse(ox,10,11,7,0,0,Math.PI*2);ctx.fill()})}
  if(b.phase>=3){glw(ctx,'#ff0000',20);ctx.fillStyle='#ff2200';[-62,-30,30,62].forEach(ox=>{ctx.beginPath();ctx.ellipse(ox,15,9,6,0,0,Math.PI*2);ctx.fill()})}
  glw(ctx,BC.glow,22*pulse)
  const bfG=ctx.createLinearGradient(-28,-90,28,-90);bfG.addColorStop(0,BC.wing);bfG.addColorStop(.5,BC.body);bfG.addColorStop(1,BC.wing)
  ctx.fillStyle=bfG;ctx.beginPath();ctx.moveTo(0,-95);ctx.bezierCurveTo(-20,-70,-25,-40,-22,-5);ctx.lineTo(-16,30);ctx.lineTo(-10,75);ctx.lineTo(10,75);ctx.lineTo(16,30);ctx.bezierCurveTo(22,-5,25,-40,20,-70);ctx.closePath();ctx.fill()
  ;[-80,-40,0,40,80].forEach((px,i)=>{const p2=.5+.5*Math.sin(frame*.15+i*1.2);glw(ctx,BC.glow,8*p2);ctx.fillStyle=BC.glow;ctx.beginPath();ctx.arc(px,78,5,0,Math.PI*2);ctx.fill()})
  glw(ctx,'#ff88ff',28);const cpG=ctx.createRadialGradient(-3,-50,2,0,-40,15);cpG.addColorStop(0,'#ffccff');cpG.addColorStop(.4,BC.acc);cpG.addColorStop(1,'#440044');ctx.fillStyle=cpG;ctx.beginPath();ctx.ellipse(0,-42,11,20,0,0,Math.PI*2);ctx.fill()
  if(b.hitFlash>0){ctx.globalAlpha=b.hitFlash/5;ctx.fillStyle='#ffffff';ctx.beginPath();ctx.ellipse(0,0,130,110,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1}
  nog(ctx)
  const bw=220,bh=14,hr=b.health/b.maxHealth
  ctx.fillStyle='rgba(0,0,0,.85)';ctx.fillRect(-bw/2,-128,bw,bh)
  const hc=hr>.66?'#00ff41':hr>.33?'#ffaa00':'#ff2200'
  glw(ctx,hc,10);ctx.fillStyle=hc;ctx.fillRect(-bw/2,-128,bw*hr,bh);nog(ctx)
  ;[1,2,3].forEach((ph,i)=>{ctx.fillStyle=b.phase>=ph?BC.acc:'#333';ctx.beginPath();ctx.arc(-bw/2+bw*(i+.5)/3,-118,4,0,Math.PI*2);ctx.fill()})
  ctx.fillStyle='#ff88ff';ctx.font='12px "Share Tech Mono"';ctx.textAlign='center'
  ctx.fillText(`OVERLORD — PHASE ${b.phase}`,0,-132)
  ctx.restore()
}

function drawBullet(ctx:CanvasRenderingContext2D,b:BulletSnap,isPlayer:boolean){
  const CM:Record<BulletType,string>={normal:isPlayer?'#00ffff':'#ff5555',spread:isPlayer?'#88ffff':'#ff8888',missile:isPlayer?'#ffaa00':'#ff6600',laser:isPlayer?'#ff44ff':'#ff44ff',plasma:'#44ffff',homing:isPlayer?'#ff6600':'#ff6644',drone_shot:'#ff9966'}
  const color=CM[b.type]??'#fff'
  b.trail.forEach((t,i)=>{ctx.globalAlpha=(1-i/b.trail.length)*.45;ctx.fillStyle=color;ctx.beginPath();ctx.arc(t.x,t.y,2*(1-i/b.trail.length),0,Math.PI*2);ctx.fill()}); ctx.globalAlpha=1
  glw(ctx,color,b.type==='plasma'?20:10); ctx.fillStyle=color
  if(b.type==='laser'){const a=Math.atan2(b.vy,b.vx);ctx.save();ctx.translate(b.x,b.y);ctx.rotate(a);ctx.fillRect(-12,-2.5,24,5);ctx.fillStyle='#fff';ctx.fillRect(-6,-1,12,2);ctx.restore()}
  else if(b.type==='plasma'){const pg=ctx.createRadialGradient(b.x,b.y,0,b.x,b.y,12);pg.addColorStop(0,'#fff');pg.addColorStop(.4,color);pg.addColorStop(1,'transparent');ctx.fillStyle=pg;ctx.beginPath();ctx.arc(b.x,b.y,12,0,Math.PI*2);ctx.fill()}
  else if(b.type==='homing'||b.type==='missile'){const a=Math.atan2(b.vy,b.vx);ctx.save();ctx.translate(b.x,b.y);ctx.rotate(a);ctx.fillRect(-8,-2,16,4);ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(8,0,2.5,0,Math.PI*2);ctx.fill();ctx.restore()}
  else{ctx.beginPath();ctx.arc(b.x,b.y,3.5,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(b.x,b.y,1.5,0,Math.PI*2);ctx.fill()}
  nog(ctx)
}

function drawLocalExplosions(ctx:CanvasRenderingContext2D,exs:LocalEx[]){
  exs.forEach(ex=>{
    const swR=ex.sw/ex.maxSw
    if(swR<1){ctx.globalAlpha=(1-swR)*.65;glw(ctx,ex.color,18*(1-swR));ctx.strokeStyle=ex.color;ctx.lineWidth=3*(1-swR);ctx.beginPath();ctx.arc(ex.x,ex.y,ex.sw,0,Math.PI*2);ctx.stroke();nog(ctx);ctx.globalAlpha=1}
    ex.particles.forEach(p=>{if(p.life<=0)return;ctx.globalAlpha=p.life*.85;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.size*Math.max(p.life,.1),0,Math.PI*2);ctx.fill()});ctx.globalAlpha=1
  })
}

function drawPowerUp(ctx:CanvasRenderingContext2D,pu:PowerUpSnap,frame:number){
  const cfg:{[k:string]:{icon:string;color:string}}={health:{icon:'+',color:'#ff4488'},shield:{icon:'◈',color:'#00ffff'},rapidfire:{icon:'»',color:'#ffff00'},bomb:{icon:'✦',color:'#ff8800'},laser_ammo:{icon:'⦿',color:'#ff44ff'},plasma_ammo:{icon:'◉',color:'#44ffff'},missile_pack:{icon:'▲',color:'#ff6600'}}
  const{icon,color}=cfg[pu.type]??{icon:'?',color:'#fff'}
  const bob=Math.sin(frame*.08+pu.animTimer*.02)*4,rot=frame*.03+pu.id*.5
  ctx.save();ctx.translate(pu.x,pu.y+bob);ctx.save();ctx.rotate(rot)
  glw(ctx,color,16);ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath()
  for(let i=0;i<6;i++){const a=(i/6)*Math.PI*2-Math.PI/2;if(i===0)ctx.moveTo(Math.cos(a)*18,Math.sin(a)*18);else ctx.lineTo(Math.cos(a)*18,Math.sin(a)*18)}
  ctx.closePath();ctx.stroke();nog(ctx);ctx.restore()
  glw(ctx,color,8);ctx.fillStyle=color;ctx.font='bold 15px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(icon,0,1);nog(ctx);ctx.restore()
}

function drawDamageNums(ctx:CanvasRenderingContext2D,nums:DmgNum[]){
  nums.forEach(d=>{ctx.globalAlpha=d.life;ctx.font=`bold ${d.val>=40?18:14}px "Share Tech Mono"`;ctx.textAlign='center';glw(ctx,d.color,8);ctx.fillStyle=d.color;ctx.fillText(d.val>=40?`!${d.val}!`:String(d.val),d.x,d.y);nog(ctx)});ctx.globalAlpha=1
}

function drawHUD(ctx:CanvasRenderingContext2D,snap:GameSnapshot,myId:string|null){
  const me=snap.players.find(p=>p.id===myId)
  if(me){
    const hpR=me.health/me.maxHealth,hpC=hpR>.5?'#00ff41':hpR>.25?'#ffaa00':'#ff3030'
    ctx.fillStyle='rgba(0,0,0,.65)';ctx.fillRect(16,H-32,180,16)
    glw(ctx,hpC,8);ctx.fillStyle=hpC;ctx.fillRect(16,H-32,180*hpR,16);nog(ctx)
    ctx.fillStyle='#fff';ctx.font='11px "Share Tech Mono"';ctx.textAlign='left'
    ctx.fillText(`HP ${Math.max(0,me.health)}/${me.maxHealth}`,20,H-20)
    for(let i=0;i<me.lives;i++){glw(ctx,PLAYER_COLORS[me.colorIdx],6);ctx.fillStyle=PLAYER_COLORS[me.colorIdx];ctx.font='bold 14px "Share Tech Mono"';ctx.fillText('▲',16+i*22,H-42);nog(ctx)}
    const wN=['CANNON','MISSILE','LASER','PLASMA'],wC=['#00ffff','#ffaa00','#ff44ff','#44ffff']
    me.weapons.forEach((w,i)=>{
      const active=i===me.currentWeapon,wx=16+i*52,wy=H-82
      ctx.fillStyle=active?'rgba(0,100,60,.7)':'rgba(0,0,0,.5)';ctx.fillRect(wx,wy,48,26)
      if(active){glw(ctx,wC[i],10);ctx.strokeStyle=wC[i];ctx.lineWidth=1.5;ctx.strokeRect(wx,wy,48,26);nog(ctx)}
      ctx.fillStyle=active?wC[i]:'#446655';ctx.font='9px "Share Tech Mono"';ctx.textAlign='center'
      ctx.fillText(`[${i+1}]`,wx+24,wy+10);ctx.fillText(wN[i],wx+24,wy+22)
      if(w.ammo!==Infinity){const ar=w.ammo/w.maxAmmo;ctx.fillStyle='rgba(0,0,0,.5)';ctx.fillRect(wx,wy+26,48,3);ctx.fillStyle=wC[i];ctx.fillRect(wx,wy+26,48*ar,3)}
    })
    // Bombs
    ctx.textAlign='left';ctx.font='10px "Share Tech Mono"'
    for(let i=0;i<me.bombsLeft;i++){glw(ctx,'#ff8800',8);ctx.fillStyle='#ff8800';ctx.fillText('✦',16+i*20,H-92);nog(ctx)}
    if(me.bombsLeft>0){ctx.fillStyle='#886633';ctx.fillText('[B]OMB',16+me.bombsLeft*20,H-92)}
  }
  // All players
  snap.players.forEach((p,i)=>{
    const col=PLAYER_COLORS[p.colorIdx]
    ctx.fillStyle='rgba(0,0,0,.6)';ctx.fillRect(14,14+i*26,165,22)
    glw(ctx,col,4);ctx.fillStyle=col;ctx.font=`${p.id===myId?'bold ':''} 10px "Share Tech Mono"`;ctx.textAlign='left'
    ctx.fillText(`${p.name}${p.id===myId?' ★':''}`,17,14+i*26+14);nog(ctx)
    ctx.fillStyle='rgba(0,0,0,.5)';ctx.fillRect(90,14+i*26+4,80,8)
    const hpR=Math.max(0,p.health)/p.maxHealth,hpC=hpR>.5?'#00ff41':hpR>.25?'#ffaa00':'#ff3030'
    ctx.fillStyle=hpC;ctx.fillRect(90,14+i*26+4,80*hpR,8)
    for(let l=0;l<p.lives;l++){ctx.fillStyle=col;ctx.font='10px "Share Tech Mono"';ctx.fillText('▲',175+l*10,14+i*26+14)}
  })
  // Score
  ctx.textAlign='center';glw(ctx,'#88ff88',6);ctx.fillStyle='#88ff88';ctx.font='bold 14px "Share Tech Mono"'
  ctx.fillText(`SCORE: ${snap.score.toString().padStart(8,'0')}`,W/2,20);nog(ctx)
  if(snap.combo>=3){ctx.globalAlpha=Math.min(1,snap.comboTimer/30);glw(ctx,'#ffff00',15);ctx.fillStyle='#ffff00';ctx.font=`bold ${14+Math.min(snap.combo,8)}px "Share Tech Mono"`;ctx.fillText(`✦ ${snap.combo}x COMBO!`,W/2,40);nog(ctx);ctx.globalAlpha=1}
  // Wave
  ctx.textAlign='right'
  if(snap.bossActive||snap.boss){const a=.7+.3*Math.abs(Math.sin(snap.frame*.12));ctx.globalAlpha=a;glw(ctx,'#ff00ff',15);ctx.fillStyle='#ff88ff';ctx.font='bold 14px "Share Tech Mono"';ctx.fillText('⚡ OVERLORD',W-18,20);nog(ctx);ctx.globalAlpha=1}
  else{ctx.fillStyle='#00ff41';ctx.font='13px "Share Tech Mono"';ctx.fillText(`WAVE ${snap.wave}/6`,W-18,20);const kr=snap.waveKilled/Math.max(1,snap.waveTotal);ctx.fillStyle='rgba(0,0,0,.5)';ctx.fillRect(W-130,H-32,114,12);ctx.fillStyle='#005522';ctx.fillRect(W-130,H-32,114*kr,12);ctx.fillStyle='#00ff41';ctx.font='10px "Share Tech Mono"';ctx.fillText(`${snap.waveKilled}/${snap.waveTotal} KILLS`,W-18,H-36)}
  if(snap.waveComplete&&snap.wave<6){const a=Math.min(1,(170-snap.waveTimer)/170*3);ctx.globalAlpha=a;ctx.fillStyle='rgba(0,0,0,.6)';ctx.fillRect(W/2-160,H/2-36,320,72);glw(ctx,'#00ff41',22);ctx.fillStyle='#00ff41';ctx.font='bold 26px "Orbitron"';ctx.textAlign='center';ctx.fillText(`WAVE ${snap.wave} CLEAR`,W/2,H/2-8);nog(ctx);ctx.fillStyle='#88ff88';ctx.font='14px "Share Tech Mono"';ctx.fillText(`INCOMING: WAVE ${snap.wave+1}`,W/2,H/2+18);ctx.globalAlpha=1}
  if(snap.bossWarning>0){const a=Math.min(1,snap.bossWarning/60)*(Math.sin(snap.frame*.25)>0?1:.5);ctx.globalAlpha=a;glw(ctx,'#ff00ff',20);ctx.fillStyle='#ff00ff';ctx.font='bold 28px "Orbitron"';ctx.textAlign='center';ctx.fillText('⚠ OVERLORD INCOMING ⚠',W/2,H/2-20);nog(ctx);ctx.globalAlpha=1}
}

function drawRadar(ctx:CanvasRenderingContext2D,snap:GameSnapshot,frame:number,myId:string|null){
  const rx=W-85,ry=H-85,r=58
  ctx.save();ctx.translate(rx,ry);ctx.globalAlpha=.88
  ctx.fillStyle='rgba(0,4,12,.85)';ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fill()
  ctx.strokeStyle='#005522';ctx.lineWidth=1
  ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.stroke()
  ctx.beginPath();ctx.arc(0,0,r*.5,0,Math.PI*2);ctx.stroke()
  ctx.beginPath();ctx.moveTo(-r,0);ctx.lineTo(r,0);ctx.moveTo(0,-r);ctx.lineTo(0,r);ctx.stroke()
  ctx.globalAlpha=1
  const sw=(frame*.03)%(Math.PI*2)
  ctx.strokeStyle='rgba(0,255,65,.5)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(Math.cos(sw)*r,Math.sin(sw)*r);ctx.stroke()
  const sc=r/(Math.max(W,H)/2)
  snap.enemies.forEach(e=>{const ex=(e.x-W/2)*sc,ey=(e.y-H/2)*sc;if(Math.hypot(ex,ey)>r)return;ctx.globalAlpha=e.cloakAlpha;ctx.fillStyle=(EC[e.type]??EC.fighter).body;ctx.beginPath();ctx.arc(ex,ey,2.5,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1})
  if(snap.boss){glw(ctx,'#ff00ff',10);ctx.fillStyle='#ff00ff';ctx.beginPath();ctx.arc((snap.boss.x-W/2)*sc,(snap.boss.y-H/2)*sc,5.5,0,Math.PI*2);ctx.fill();nog(ctx)}
  snap.players.forEach(p=>{if(!p.active)return;const col=PLAYER_COLORS[p.colorIdx];glw(ctx,col,p.id===myId?12:6);ctx.fillStyle=col;ctx.beginPath();ctx.arc((p.x-W/2)*sc,(p.y-H/2)*sc,p.id===myId?4:2.5,0,Math.PI*2);ctx.fill();nog(ctx)})
  ctx.fillStyle='#005522';ctx.font='9px "Share Tech Mono"';ctx.textAlign='center';ctx.fillText('RADAR',0,r+12)
  ctx.restore()
}

function drawVignette(ctx:CanvasRenderingContext2D,flash:number){
  const g=ctx.createRadialGradient(W/2,H/2,H*.3,W/2,H/2,H)
  g.addColorStop(0,'transparent'); g.addColorStop(.6,flash>.2?`rgba(${Math.floor(flash*200)},0,0,${flash*.3})`:'transparent'); g.addColorStop(1,`rgba(0,0,0,${.5+flash*.5})`)
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H)
}

function spawnLocalExplosion(exs:LocalEx[],nextId:{v:number},x:number,y:number,size:string,col?:string){
  const countMap:{[k:string]:number}={tiny:14,small:24,medium:55,large:85,boss:190}
  const swMap:{[k:string]:number}={tiny:45,small:95,medium:175,large:285,boss:530}
  const palettes:{[k:string]:string[]}={tiny:['#ff6600','#ffaa00','#fff'],small:['#ff5500','#ffaa00','#ff2200','#fff'],medium:['#ff4400','#ff8800','#ffcc00','#ff0000','#fff'],large:['#ff3300','#ff7700','#ffcc00','#ff0000','#fff','#ffff00'],boss:['#ff00ff','#ff4400','#ffaa00','#ff0088','#fff','#aa00ff','#ffff00']}
  const count=countMap[size]??24; const palette=col?[col,'#fff',col]:(palettes[size]??palettes.medium)
  const particles:Particle[]=Array.from({length:count},(_,i)=>{
    const angle=(i/count)*Math.PI*2+rnd(0,.5),speed=rnd(.5,size==='boss'?14:9)
    return{x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,life:rnd(.7,1),size:rnd(1.5,size==='boss'?7:4),color:palette[rndI(0,palette.length-1)],gravity:Math.random()>.4}
  })
  exs.push({id:nextId.v++,x,y,particles,sw:0,maxSw:swMap[size]??95,color:palette[0]})
}

// ══════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════
type UIPhase = 'landing'|'naming'|'hosting'|'joining'|'lobby'|'playing'|'gameover'|'victory'

interface PeerPlayer { id:string; name:string; colorIdx:number }

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef    = useRef<number>(0)
  const frameRef  = useRef(0)
  const scrollRef = useRef(0)

  // Visual state
  const starsRef  = useRef<Star[][]>([makeStarLayer(80,.08,.15),makeStarLayer(60,.2,.4),makeStarLayer(30,.5,1)])
  const cloudsRef = useRef<Cloud[]>(makeClouds())
  const exsRef    = useRef<LocalEx[]>([])
  const dmgRef    = useRef<DmgNum[]>([])
  const nextIdRef = useRef({v:1})
  const vigRef    = useRef(0)
  const shakeRef  = useRef(0)
  const shakeVRef = useRef({x:0,y:0})

  // Game state
  const snapRef   = useRef<GameSnapshot|null>(null)
  const myIdRef   = useRef<string|null>(null)
  const inputRef  = useRef<PlayerInput>({left:false,right:false,up:false,down:false,fire:false,weapon:0,bomb:false})
  const prevInpRef= useRef<PlayerInput>({left:false,right:false,up:false,down:false,fire:false,weapon:0,bomb:false})

  // P2P
  const peerRef   = useRef<import('peerjs').Peer|null>(null)
  const connsRef  = useRef<Map<string,DataConnection>>(new Map()) // host: peer->conn; guest: host conn
  const engineRef = useRef<GameEngine|null>(null)
  const isHostRef = useRef(false)
  const tickRef   = useRef<ReturnType<typeof setInterval>|null>(null)
  const bcastRef  = useRef<ReturnType<typeof setInterval>|null>(null)

  // React UI state
  const [dim,setDim]    = useState({w:W,h:H})
  const [uiPhase,setUI] = useState<UIPhase>('landing')
  const [name,setName]  = useState('')
  const [nameInput,setNameInput] = useState('')
  const [roomCode,setRoomCode]   = useState('')
  const [joinInput,setJoinInput] = useState('')
  const [lobbyPlayers,setLobbyPlayers] = useState<PeerPlayer[]>([])
  const [error,setError]   = useState('')
  const [audioOn,setAudioOn] = useState(false)
  const [muteMusic,setMuteMusic] = useState(false)
  const [muteSfx,setMuteSfx]   = useState(false)
  const [ping,setPing] = useState<number|null>(null)

  // Resize
  useEffect(()=>{
    const resize=()=>{const s=Math.min(window.innerWidth/W,window.innerHeight/H);setDim({w:W*s,h:H*s})}
    resize(); window.addEventListener('resize',resize); return()=>window.removeEventListener('resize',resize)
  },[])

  // ── AUDIO helpers ────────────────────────────────────────────────────────
  const startAudio = useCallback(()=>{
    if(audioOn)return; setAudioOn(true); audioEngine.init(); audioEngine.resume()
    if(!muteMusic) audioEngine.startMusic()
  },[audioOn,muteMusic])

  const playSFX = useCallback((s:SFXEvent)=>{ if(!muteSfx&&audioOn) audioEngine.play(s) },[muteSfx,audioOn])

  // ── P2P send helpers ─────────────────────────────────────────────────────
  const broadcast = useCallback((msg:P2PMsg)=>{
    const data=JSON.stringify(msg)
    connsRef.current.forEach(c=>{try{c.send(data)}catch{}})
  },[])

  const sendToHost = useCallback((msg:P2PMsg)=>{
    const data=JSON.stringify(msg)
    connsRef.current.forEach(c=>{try{c.send(data)}catch{}})
  },[])

  // ── HOST: process engine events ──────────────────────────────────────────
  const processEngineEvents = useCallback(()=>{
    const eng=engineRef.current; if(!eng)return
    const evs=eng.flushEvents()
    evs.forEach(ev=>{
      if(ev.type==='sfx'){playSFX(ev.sfx);broadcast({t:'sfx',sfx:ev.sfx})}
      if(ev.type==='explosion'){
        spawnLocalExplosion(exsRef.current,nextIdRef.current,ev.x,ev.y,ev.size,ev.color)
        shakeRef.current=Math.max(shakeRef.current,ev.size==='boss'?22:ev.size==='large'?13:ev.size==='medium'?7:3)
        vigRef.current=Math.max(vigRef.current,ev.size==='boss'?.9:ev.size==='large'?.4:ev.size==='medium'?.2:0)
        broadcast({t:'explosion',x:ev.x,y:ev.y,size:ev.size as ExplosionSize,color:ev.color})
      }
      if(ev.type==='dmg'){
        const color=ev.isPlayer?'#ff4444':ev.val>=40?'#ffff00':ev.val>=20?'#ffaa00':'#fff'
        dmgRef.current.push({id:nextIdRef.current.v++,x:ev.x+rnd(-12,12),y:ev.y,val:ev.val,life:1,vy:-1.5,color})
        broadcast({t:'dmg',x:ev.x,y:ev.y,val:ev.val,isPlayer:ev.isPlayer})
      }
    })
    if(eng.phase!==snapRef.current?.phase){
      if(eng.phase==='gameover'||eng.phase==='victory') setUI(eng.phase)
    }
  },[broadcast,playSFX])

  // ── HOST SETUP ───────────────────────────────────────────────────────────
  const hostGame = useCallback(async(playerName:string)=>{
    const{Peer}=await import('peerjs')
    const code=(Math.random().toString(36).slice(2,8)).toUpperCase()
    const peer=new Peer(`warjets-${code}`,{debug:0})
    peerRef.current=peer; isHostRef.current=true

    await new Promise<void>(res=>peer.on('open',(_id:string)=>res()))

    const eng=new GameEngine()
    engineRef.current=eng
    const myColorIdx=eng.addPlayer(peer.id,playerName,true)
    myIdRef.current=peer.id
    setRoomCode(code)
    setLobbyPlayers([{id:peer.id,name:playerName,colorIdx:myColorIdx}])
    setUI('lobby')

    peer.on('connection',(conn)=>{
      conn.on('open',()=>{
        connsRef.current.set(conn.peer,conn)
        conn.on('data',(raw)=>{
          const msg=JSON.parse(raw as string) as P2PMsg
          if(msg.t==='join'){
            const colorIdx=eng.addPlayer(conn.peer,msg.name,false)
            // Tell this newcomer about all existing players
            const allPlayers=Array.from(connsRef.current.keys())
              .filter(id=>id!==conn.peer)
              .map(id=>{const p=eng.getPlayerCount();return{id,name:msg.name,colorIdx}})
            conn.send(JSON.stringify({t:'joined',id:conn.peer,name:msg.name,colorIdx,players:lobbyPlayers.map(p=>({id:p.id,name:p.name,colorIdx:p.colorIdx}))} as P2PMsg))
            // Tell everyone else
            broadcast({t:'player-joined',id:conn.peer,name:msg.name,colorIdx})
            setLobbyPlayers(prev=>[...prev,{id:conn.peer,name:msg.name,colorIdx}])
          }
          if(msg.t==='input') eng.updateInput(conn.peer,msg.input)
          if(msg.t==='ping')  conn.send(JSON.stringify({t:'pong'} as P2PMsg))
        })
        conn.on('close',()=>{
          connsRef.current.delete(conn.peer)
          eng.removePlayer(conn.peer)
          broadcast({t:'player-left',id:conn.peer})
          setLobbyPlayers(prev=>prev.filter(p=>p.id!==conn.peer))
        })
      })
    })
  },[broadcast,lobbyPlayers])

  // ── GUEST SETUP ──────────────────────────────────────────────────────────
  const joinGame = useCallback(async(playerName:string,code:string)=>{
    const{Peer}=await import('peerjs')
    const peer=new Peer({debug:0})
    peerRef.current=peer; isHostRef.current=false

    await new Promise<void>((res,rej)=>{ peer.on('open',(_id:string)=>res()); peer.on('error',(_e:unknown)=>rej(_e)) })

    myIdRef.current=peer.id
    const hostId=`warjets-${code.toUpperCase()}`
    const conn=peer.connect(hostId,{reliable:true,serialization:'json'})
    connsRef.current.set(hostId,conn)

    conn.on('error',()=>setError('Could not connect to room. Check the code.'))
    conn.on('close',()=>setError('Host disconnected.'))

    await new Promise<void>((res,rej)=>{ conn.on('open',res); setTimeout(()=>rej(new Error('timeout')),8000) })

    conn.send(JSON.stringify({t:'join',name:playerName} as P2PMsg))

    // Ping loop
    const pingStart:{v:number}={v:0}
    setInterval(()=>{ pingStart.v=Date.now(); try{conn.send(JSON.stringify({t:'ping'}))}catch{} },3000)

    conn.on('data',(raw)=>{
      const msg=JSON.parse(raw as string) as P2PMsg
      if(msg.t==='joined'){
        setLobbyPlayers([...msg.players,{id:msg.id,name:msg.name,colorIdx:msg.colorIdx}])
        setUI('lobby')
      }
      if(msg.t==='player-joined') setLobbyPlayers(prev=>[...prev,{id:msg.id,name:msg.name,colorIdx:msg.colorIdx}])
      if(msg.t==='player-left')   setLobbyPlayers(prev=>prev.filter(p=>p.id!==msg.id))
      if(msg.t==='start')         setUI('playing')
      if(msg.t==='state')         snapRef.current=msg.snap
      if(msg.t==='sfx')           playSFX(msg.sfx)
      if(msg.t==='pong')          setPing(Date.now()-pingStart.v)
      if(msg.t==='restart')       { snapRef.current=null; setUI('lobby') }
      if(msg.t==='explosion'){
        spawnLocalExplosion(exsRef.current,nextIdRef.current,msg.x,msg.y,msg.size,msg.color)
        shakeRef.current=Math.max(shakeRef.current,msg.size==='boss'?22:msg.size==='large'?13:msg.size==='medium'?7:3)
        vigRef.current=Math.max(vigRef.current,msg.size==='boss'?.9:msg.size==='large'?.4:msg.size==='medium'?.2:0)
      }
      if(msg.t==='dmg'){
        const color=msg.isPlayer?'#ff4444':msg.val>=40?'#ffff00':msg.val>=20?'#ffaa00':'#fff'
        dmgRef.current.push({id:nextIdRef.current.v++,x:msg.x+rnd(-12,12),y:msg.y,val:msg.val,life:1,vy:-1.5,color})
      }
    })
  },[playSFX])

  // ── HOST: start game ──────────────────────────────────────────────────────
  const startGame = useCallback(()=>{
    const eng=engineRef.current; if(!eng||!isHostRef.current)return
    eng.startGame()
    broadcast({t:'start'})
    setUI('playing')

    if(tickRef.current) clearInterval(tickRef.current)
    if(bcastRef.current) clearInterval(bcastRef.current)

    tickRef.current=setInterval(()=>{
      if(!eng)return
      if((eng.phase as string)!=='playing')return
      // Apply host's own input
      eng.updateInput(peerRef.current!.id,{...inputRef.current})
      eng.tick()
      processEngineEvents()
      // Update react phase on changes
      const newPhase:string=eng.phase
      if(newPhase==='gameover'){setUI('gameover');if(tickRef.current)clearInterval(tickRef.current)}
      if(newPhase==='victory') {setUI('victory'); if(tickRef.current)clearInterval(tickRef.current)}
    },1000/TICK_RATE)

    bcastRef.current=setInterval(()=>{
      if(!eng)return
      const snap=eng.snapshot()
      snapRef.current=snap
      broadcast({t:'state',snap})
    },1000/BROADCAST_RATE)
  },[broadcast,processEngineEvents])

  // ── HOST: restart ─────────────────────────────────────────────────────────
  const restartGame = useCallback(()=>{
    const eng=engineRef.current; if(!eng||!isHostRef.current)return
    if(tickRef.current)clearInterval(tickRef.current)
    if(bcastRef.current)clearInterval(bcastRef.current)
    eng.resetToLobby()
    broadcast({t:'restart'})
    setUI('lobby')
  },[broadcast])

  // ── INPUT ─────────────────────────────────────────────────────────────────
  useEffect(()=>{
    const send=()=>{
      if(isHostRef.current) return // host applies input directly in tick
      const inp={...inputRef.current}
      if(JSON.stringify(inp)!==JSON.stringify(prevInpRef.current)){
        sendToHost({t:'input',id:myIdRef.current??'',input:inp})
        prevInpRef.current={...inp}
      }
    }
    const kd=(e:KeyboardEvent)=>{
      startAudio()
      const i=inputRef.current
      if(e.key==='ArrowLeft'||e.key==='a'||e.key==='A') i.left=true
      if(e.key==='ArrowRight'||e.key==='d'||e.key==='D') i.right=true
      if(e.key==='ArrowUp'||e.key==='w'||e.key==='W') i.up=true
      if(e.key==='ArrowDown'||e.key==='s'||e.key==='S') i.down=true
      if(e.key===' ') i.fire=true
      if(e.key==='b'||e.key==='B'){i.bomb=true}
      if(e.key==='1') i.weapon=0
      if(e.key==='2') i.weapon=1
      if(e.key==='3') i.weapon=2
      if(e.key==='4') i.weapon=3
      if([' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))e.preventDefault()
      send()
    }
    const ku=(e:KeyboardEvent)=>{
      const i=inputRef.current
      if(e.key==='ArrowLeft'||e.key==='a'||e.key==='A') i.left=false
      if(e.key==='ArrowRight'||e.key==='d'||e.key==='D') i.right=false
      if(e.key==='ArrowUp'||e.key==='w'||e.key==='W') i.up=false
      if(e.key==='ArrowDown'||e.key==='s'||e.key==='S') i.down=false
      if(e.key===' ') i.fire=false
      if(e.key==='b'||e.key==='B') i.bomb=false
      send()
    }
    window.addEventListener('keydown',kd); window.addEventListener('keyup',ku)
    return()=>{window.removeEventListener('keydown',kd);window.removeEventListener('keyup',ku)}
  },[startAudio,sendToHost])

  // ── RENDER LOOP ───────────────────────────────────────────────────────────
  const loop=useCallback(()=>{
    const canvas=canvasRef.current; if(!canvas){rafRef.current=requestAnimationFrame(loop);return}
    const ctx=canvas.getContext('2d'); if(!ctx){rafRef.current=requestAnimationFrame(loop);return}
    frameRef.current++; scrollRef.current+=.45
    const frame=frameRef.current

    // Update stars/clouds
    starsRef.current.forEach((layer,li)=>layer.forEach(s=>{s.y+=s.speed*(li+1)*.7;if(s.y>H){s.y=0;s.x=rnd(0,W)}}))
    cloudsRef.current.forEach(c=>{c.y+=c.speed;if(c.y>H+100){c.y=-100;c.x=rnd(-80,W+80)}})
    // Update particles
    exsRef.current.forEach(ex=>{ex.sw=Math.min(ex.sw+10,ex.maxSw);let any=false;ex.particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vx*=.93;p.vy*=.93;if(p.gravity)p.vy+=.12;p.life-=.022;if(p.life>0)any=true});if(!any&&ex.sw>=ex.maxSw)ex.sw=ex.maxSw+1})
    exsRef.current=exsRef.current.filter(ex=>ex.particles.some(p=>p.life>0)||ex.sw<ex.maxSw)
    dmgRef.current.forEach(d=>{d.y+=d.vy;d.vy*=.96;d.life-=.025});dmgRef.current=dmgRef.current.filter(d=>d.life>0)
    if(shakeRef.current>.5){shakeRef.current*=.82;shakeVRef.current={x:rnd(-shakeRef.current,shakeRef.current),y:rnd(-shakeRef.current,shakeRef.current)}}else{shakeRef.current=0;shakeVRef.current={x:0,y:0}}
    if(vigRef.current>0)vigRef.current*=.92

    const snap=snapRef.current
    ctx.save()
    if(shakeRef.current>1)ctx.translate(shakeVRef.current.x,shakeVRef.current.y)
    drawBg(ctx,frame,starsRef.current,cloudsRef.current,scrollRef.current)
    drawLocalExplosions(ctx,exsRef.current)
    if(snap&&(snap.phase==='playing'||snap.phase==='gameover'||snap.phase==='victory')){
      snap.powerUps.forEach(pu=>drawPowerUp(ctx,pu,frame))
      snap.pBullets.forEach(b=>drawBullet(ctx,b,true))
      snap.eBullets.forEach(b=>drawBullet(ctx,b,false))
      snap.enemies.forEach(e=>drawEnemy(ctx,e,frame))
      if(snap.boss)drawBoss(ctx,snap.boss,frame)
      snap.players.forEach(p=>drawPlayer(ctx,p,frame,p.id===myIdRef.current))
      drawDamageNums(ctx,dmgRef.current)
      drawHUD(ctx,snap,myIdRef.current)
      drawRadar(ctx,snap,frame,myIdRef.current)
    }
    drawVignette(ctx,vigRef.current)
    ctx.restore()
    rafRef.current=requestAnimationFrame(loop)
  },[])

  useEffect(()=>{rafRef.current=requestAnimationFrame(loop);return()=>cancelAnimationFrame(rafRef.current)},[loop])

  // Touch helper
  const touch=(k:keyof PlayerInput,v:boolean|number)=>{
    const inp=inputRef.current as unknown as Record<keyof PlayerInput,boolean|number>
    inp[k]=v
    if(!isHostRef.current) sendToHost({t:'input',id:myIdRef.current??'',input:{...inputRef.current}})
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  const mono={fontFamily:'"Share Tech Mono", monospace'}
  const orb={fontFamily:'"Orbitron", sans-serif'}
  const overlay=(children:React.ReactNode)=>(
    <div style={{position:'absolute',inset:0,background:'rgba(3,6,18,.92)',display:'flex',alignItems:'center',justifyContent:'center'}}>
      {children}
    </div>
  )

  const submitName=(n:string)=>{setName(n)}

  return(
    <div className="w-screen h-screen overflow-hidden bg-[#050a14] flex items-center justify-center" onClick={startAudio}>
      <div style={{position:'relative',width:dim.w,height:dim.h}}>
        <canvas ref={canvasRef} width={W} height={H} style={{width:dim.w,height:dim.h,display:'block',cursor:'crosshair'}}/>

        {/* ── LANDING ── */}
        {uiPhase==='landing'&&overlay(
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:24,padding:40,border:'1px solid rgba(0,255,65,.25)'}}>
            <div style={{...orb,color:'#00d4ff',fontSize:52,fontWeight:900,letterSpacing:'0.1em',textShadow:'0 0 40px #00d4ff'}}>WAR JETS</div>
            <div style={{...mono,color:'#00ff41',fontSize:12,letterSpacing:'0.3em'}}>P2P MULTIPLAYER — WORKS ON GITHUB PAGES</div>
            <div style={{display:'flex',gap:16,marginTop:8}}>
              <button onClick={()=>setUI('naming')}
                style={{...orb,background:'#00ff41',color:'#050a14',fontWeight:700,fontSize:14,padding:'14px 32px',border:'none',cursor:'pointer',letterSpacing:'0.1em'}}>
                HOST GAME
              </button>
              <button onClick={()=>setUI('joining')}
                style={{...orb,background:'transparent',color:'#00d4ff',fontSize:14,padding:'14px 32px',border:'2px solid #00d4ff',cursor:'pointer',letterSpacing:'0.1em'}}>
                JOIN GAME
              </button>
            </div>
            <div style={{...mono,color:'#223344',fontSize:11,textAlign:'center',marginTop:8,maxWidth:340}}>
              No server required. Host runs the game in their browser.<br/>
              Share the 6-character room code with friends.
            </div>
          </div>
        )}

        {/* ── NAMING ── */}
        {uiPhase==='naming'&&overlay(
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:20,padding:40,border:'1px solid rgba(0,255,65,.2)'}}>
            <div style={{...orb,color:'#00d4ff',fontSize:28,fontWeight:700}}>HOST A GAME</div>
            <label style={{...mono,color:'#00ff41',fontSize:12,letterSpacing:'0.2em'}}>YOUR PILOT NAME</label>
            <input autoFocus maxLength={16} value={nameInput} onChange={e=>setNameInput(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter'&&nameInput.trim()){submitName(nameInput.trim());hostGame(nameInput.trim())}}}
              style={{...mono,background:'#0a1628',border:'1px solid #00ff41',color:'#00ff41',padding:'10px 20px',fontSize:18,textAlign:'center',letterSpacing:'0.2em',outline:'none',width:220}}
              placeholder="PILOT"/>
            <button onClick={()=>{if(nameInput.trim()){submitName(nameInput.trim());hostGame(nameInput.trim())}}}
              style={{...orb,background:'#00ff41',color:'#050a14',fontWeight:700,fontSize:14,padding:'12px 40px',border:'none',cursor:'pointer',letterSpacing:'0.1em'}}>
              CREATE ROOM
            </button>
            <button onClick={()=>setUI('landing')} style={{...mono,color:'#446655',background:'none',border:'none',cursor:'pointer',fontSize:12}}>← back</button>
          </div>
        )}

        {/* ── JOINING ── */}
        {uiPhase==='joining'&&overlay(
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:20,padding:40,border:'1px solid rgba(0,212,255,.2)'}}>
            <div style={{...orb,color:'#00d4ff',fontSize:28,fontWeight:700}}>JOIN A GAME</div>
            <label style={{...mono,color:'#00ff41',fontSize:12,letterSpacing:'0.2em'}}>YOUR PILOT NAME</label>
            <input autoFocus maxLength={16} value={nameInput} onChange={e=>setNameInput(e.target.value)}
              style={{...mono,background:'#0a1628',border:'1px solid #00ff41',color:'#00ff41',padding:'10px 20px',fontSize:18,textAlign:'center',letterSpacing:'0.2em',outline:'none',width:220}}
              placeholder="PILOT"/>
            <label style={{...mono,color:'#00d4ff',fontSize:12,letterSpacing:'0.2em',marginTop:8}}>ROOM CODE</label>
            <input maxLength={6} value={joinInput} onChange={e=>setJoinInput(e.target.value.toUpperCase())}
              onKeyDown={e=>{if(e.key==='Enter'&&nameInput.trim()&&joinInput.trim()){submitName(nameInput.trim());joinGame(nameInput.trim(),joinInput.trim())}}}
              style={{...mono,background:'#0a1628',border:'1px solid #00d4ff',color:'#00d4ff',padding:'10px 20px',fontSize:24,textAlign:'center',letterSpacing:'0.4em',outline:'none',width:220}}
              placeholder="ABC123"/>
            {error&&<div style={{...mono,color:'#ff4444',fontSize:12}}>{error}</div>}
            <button onClick={()=>{if(nameInput.trim()&&joinInput.trim()){submitName(nameInput.trim());joinGame(nameInput.trim(),joinInput.trim())}}}
              style={{...orb,background:'#00d4ff',color:'#050a14',fontWeight:700,fontSize:14,padding:'12px 40px',border:'none',cursor:'pointer',letterSpacing:'0.1em'}}>
              CONNECT
            </button>
            <button onClick={()=>{setUI('landing');setError('')}} style={{...mono,color:'#446655',background:'none',border:'none',cursor:'pointer',fontSize:12}}>← back</button>
          </div>
        )}

        {/* ── LOBBY ── */}
        {uiPhase==='lobby'&&overlay(
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:16,padding:40,border:'1px solid rgba(0,255,65,.2)',minWidth:380}}>
            <div style={{...orb,color:'#00d4ff',fontSize:26,fontWeight:700}}>WAR JETS</div>
            {isHostRef.current&&(
              <div style={{textAlign:'center'}}>
                <div style={{...mono,color:'#446655',fontSize:11,letterSpacing:'0.2em'}}>ROOM CODE — SHARE THIS</div>
                <div style={{...orb,color:'#ffff00',fontSize:40,fontWeight:900,letterSpacing:'0.4em',textShadow:'0 0 20px #ffff00'}}>{roomCode}</div>
                <div style={{...mono,color:'#446655',fontSize:10}}>Others go to the same URL and click JOIN GAME</div>
              </div>
            )}
            {!isHostRef.current&&<div style={{...mono,color:'#00ff41',fontSize:13,letterSpacing:'0.2em',animation:'pulse 1s infinite'}}>WAITING FOR HOST TO START...</div>}
            <div style={{width:'100%',display:'flex',flexDirection:'column',gap:6,marginTop:8}}>
              {lobbyPlayers.map((p,i)=>(
                <div key={p.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 14px',border:'1px solid rgba(255,255,255,.05)'}}>
                  <div style={{width:10,height:10,borderRadius:'50%',background:PLAYER_COLORS[p.colorIdx],boxShadow:`0 0 8px ${PLAYER_COLORS[p.colorIdx]}`}}/>
                  <span style={{...mono,color:PLAYER_COLORS[p.colorIdx],fontSize:13,flex:1}}>{p.name} {p.id===myIdRef.current?'(YOU)':''} {isHostRef.current&&p.id===myIdRef.current?'★ HOST':''}</span>
                  <span style={{...mono,color:'#446655',fontSize:11}}>P{i+1}</span>
                </div>
              ))}
              {Array.from({length:Math.max(0,4-lobbyPlayers.length)},(_,i)=>(
                <div key={`e${i}`} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 14px',border:'1px solid rgba(255,255,255,.04)',opacity:.3}}>
                  <div style={{width:10,height:10,borderRadius:'50%',border:'1px solid #446655'}}/>
                  <span style={{...mono,color:'#446655',fontSize:13}}>WAITING...</span>
                </div>
              ))}
            </div>
            {isHostRef.current&&(
              <button onClick={startGame}
                style={{...orb,background:'#00ff41',color:'#050a14',fontWeight:700,fontSize:15,padding:'14px 48px',border:'none',cursor:'pointer',letterSpacing:'0.1em',marginTop:8}}>
                START MISSION [{lobbyPlayers.length} PILOT{lobbyPlayers.length!==1?'S':''}]
              </button>
            )}
            <div style={{...mono,color:'#223344',fontSize:10,textAlign:'center',marginTop:4}}>WASD·SPACE·1-4·B=BOMB</div>
            {ping!==null&&!isHostRef.current&&<div style={{...mono,color:'#446655',fontSize:10}}>ping: {ping}ms</div>}
          </div>
        )}

        {/* ── GAME OVER ── */}
        {uiPhase==='gameover'&&overlay(
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:16,padding:40}}>
            <div style={{...orb,color:'#ff3300',fontSize:44,fontWeight:900,textShadow:'0 0 30px #ff2200'}}>MISSION FAILED</div>
            {snapRef.current&&<>
              <div style={{...mono,color:'#00ff41',fontSize:18}}>SCORE: {snapRef.current.score.toString().padStart(8,'0')}</div>
              <div style={{display:'flex',flexDirection:'column',gap:4,alignItems:'center'}}>
                {snapRef.current.players.map(p=>(
                  <div key={p.id} style={{...mono,color:PLAYER_COLORS[p.colorIdx],fontSize:13}}>{p.name}: {p.score}</div>
                ))}
              </div>
            </>}
            {isHostRef.current&&<button onClick={restartGame} style={{...orb,background:'#ff3300',color:'#fff',fontWeight:700,fontSize:14,padding:'12px 36px',border:'none',cursor:'pointer',marginTop:16,letterSpacing:'0.1em'}}>RETRY MISSION</button>}
            {!isHostRef.current&&<div style={{...mono,color:'#446655',fontSize:12}}>Waiting for host to restart...</div>}
          </div>
        )}

        {/* ── VICTORY ── */}
        {uiPhase==='victory'&&overlay(
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:16,padding:40}}>
            <div style={{...orb,color:'#00ff41',fontSize:40,fontWeight:900,textShadow:'0 0 30px #00ff41'}}>MISSION COMPLETE</div>
            {snapRef.current&&<>
              <div style={{...mono,color:'#ffff00',fontSize:20}}>FINAL: {snapRef.current.score.toString().padStart(8,'0')}</div>
              <div style={{display:'flex',flexDirection:'column',gap:4,alignItems:'center'}}>
                {snapRef.current.players.map(p=>(
                  <div key={p.id} style={{...mono,color:PLAYER_COLORS[p.colorIdx],fontSize:13}}>{p.name}: {p.score}</div>
                ))}
              </div>
            </>}
            {isHostRef.current&&<button onClick={restartGame} style={{...orb,background:'#00ff41',color:'#050a14',fontWeight:700,fontSize:14,padding:'12px 36px',border:'none',cursor:'pointer',marginTop:16,letterSpacing:'0.1em'}}>PLAY AGAIN</button>}
            {!isHostRef.current&&<div style={{...mono,color:'#446655',fontSize:12}}>Waiting for host to restart...</div>}
          </div>
        )}

        {/* Audio controls */}
        <div style={{position:'absolute',top:8,right:8,display:'flex',gap:6,opacity:.45,transition:'opacity .2s'}}
          onMouseEnter={e=>(e.currentTarget as HTMLElement).style.opacity='1'}
          onMouseLeave={e=>(e.currentTarget as HTMLElement).style.opacity='.45'}>
          {[{l:muteMusic?'🔇':'🎵',a:()=>{const n=!muteMusic;setMuteMusic(n);if(n)audioEngine.stopMusic();else{startAudio();audioEngine.startMusic()}}},
            {l:muteSfx?'🔕':'🔊',a:()=>setMuteSfx(m=>!m)}].map((b,i)=>(
            <button key={i} onClick={b.a} style={{background:'rgba(0,0,0,.7)',border:'1px solid #224',borderRadius:6,padding:'3px 7px',fontSize:15,cursor:'pointer',color:'#fff'}}>{b.l}</button>
          ))}
        </div>

        {/* Touch d-pad */}
        {(uiPhase==='playing')&&<>
          <div style={{position:'absolute',bottom:20,left:16,display:'grid',gridTemplateColumns:'repeat(3, 46px)',gridTemplateRows:'repeat(3, 46px)',gap:3,opacity:.65}}>
            {[null,{l:'▲',k:'up'as keyof PlayerInput},null,{l:'◄',k:'left'as keyof PlayerInput},null,{l:'►',k:'right'as keyof PlayerInput},null,{l:'▼',k:'down'as keyof PlayerInput},null].map((b,i)=>
              !b?<div key={i}/>:(
                <button key={i} onTouchStart={()=>touch(b.k,true)} onTouchEnd={()=>touch(b.k,false)} onMouseDown={()=>touch(b.k,true)} onMouseUp={()=>touch(b.k,false)}
                  style={{width:46,height:46,background:'rgba(0,255,65,.12)',border:'1px solid #00ff41',borderRadius:8,color:'#00ff41',fontSize:17,cursor:'pointer',touchAction:'none',userSelect:'none',fontFamily:'monospace'}}>
                  {b.l}
                </button>
              )
            )}
          </div>
          <div style={{position:'absolute',bottom:20,right:16,display:'flex',flexDirection:'column',gap:8,opacity:.7}}>
            <button onTouchStart={()=>touch('fire',true)} onTouchEnd={()=>touch('fire',false)} onMouseDown={()=>touch('fire',true)} onMouseUp={()=>touch('fire',false)}
              style={{width:76,height:76,background:'rgba(0,212,255,.2)',border:'2px solid #00d4ff',borderRadius:'50%',color:'#00d4ff',fontSize:12,fontFamily:'monospace',cursor:'pointer',touchAction:'none',userSelect:'none'}}>
              FIRE
            </button>
            <button onClick={()=>{const n=(inputRef.current.weapon+1)%4;touch('weapon',n)}}
              style={{width:76,height:40,background:'rgba(255,255,0,.12)',border:'1px solid #ffff00',borderRadius:8,color:'#ffff00',fontSize:11,fontFamily:'monospace',cursor:'pointer',userSelect:'none'}}>
              WEAPON
            </button>
            <button onClick={()=>{touch('bomb',true);setTimeout(()=>touch('bomb',false),150)}}
              style={{width:76,height:36,background:'rgba(255,136,0,.15)',border:'1px solid #ff8800',borderRadius:8,color:'#ff8800',fontSize:11,fontFamily:'monospace',cursor:'pointer',userSelect:'none'}}>
              BOMB
            </button>
          </div>
        </>}
      </div>
    </div>
  )
}
