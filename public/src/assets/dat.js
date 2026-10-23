// Reader for the Age of Empires: Rise of Rome "empires.dat" (version VER 3.7).
// The file itself is raw-deflate compressed; inflateRaw() unpacks it and
// parseEmpiresDat() walks the whole structure: player colours, sounds,
// graphics, terrains, random maps, effects (technology bundles), civs with
// their units, and researches. Field layout follows the openage converter.
//
// Nothing from the original game is shipped with this project; the parser
// only runs on files the player provides from their own installation.

export async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

class Reader {
  constructor(bytes) {
    this.b = bytes;
    this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.o = 0;
  }
  i8() { return this.v.getInt8(this.o++); }
  u8() { return this.v.getUint8(this.o++); }
  i16() { const x = this.v.getInt16(this.o, true); this.o += 2; return x; }
  u16() { const x = this.v.getUint16(this.o, true); this.o += 2; return x; }
  i32() { const x = this.v.getInt32(this.o, true); this.o += 4; return x; }
  u32() { const x = this.v.getUint32(this.o, true); this.o += 4; return x; }
  f32() { const x = this.v.getFloat32(this.o, true); this.o += 4; return x; }
  str(n) {
    let s = '';
    for (let i = 0; i < n; i++) { const c = this.b[this.o + i]; if (c === 0) break; s += String.fromCharCode(c); }
    this.o += n;
    return s;
  }
  skip(n) { this.o += n; }
  arr(n, fn) { const out = new Array(n); for (let i = 0; i < n; i++) out[i] = fn(); return out; }
}

function readGraphic(r) {
  const g = {};
  g.name = r.str(21);
  g.file = r.str(13);
  g.slp = r.i32();
  r.skip(2); // is_loaded, old_color_flag
  g.layer = r.i8();
  g.forcePlayerColor = r.i8();
  r.skip(2); // adapt_color, transparent_selection
  g.box = [r.i16(), r.i16(), r.i16(), r.i16()];
  const deltaCount = r.u16();
  g.sound = r.i16();
  const angleSounds = r.u8();
  g.frames = r.u16();
  g.angles = r.u16();
  g.speedAdjust = r.f32();
  g.frameRate = r.f32(); // seconds per frame
  g.replayDelay = r.f32();
  g.sequence = r.i8();
  g.id = r.i16();
  g.mirror = r.i8();
  g.deltas = r.arr(deltaCount, () => {
    const gid = r.i16(); r.skip(6);
    const dx = r.i16(), dy = r.i16(), angle = r.i16(); r.skip(2);
    return { gid, dx, dy, angle };
  });
  if (angleSounds) r.skip(g.angles * 12);
  return g;
}

function readTerrainAnim(r) {
  const a = { animated: r.i8(), frames: r.i16(), pauseFrames: r.i16(), interval: r.f32(), pause: r.f32() };
  r.skip(2 + 2 + 4 + 1 + 1); // frame, draw_frame, animate_last, frame_changed, drawn
  return a;
}

function readTerrain(r) {
  const t = { enabled: r.i8(), random: r.i8(), name: r.str(13), file: r.str(13), slp: r.i32() };
  r.skip(4);
  t.sound = r.i32();
  t.mapColor = [r.u8(), r.u8(), r.u8()];
  t.cliffColor = [r.u8(), r.u8()];
  t.passable = r.i8(); t.impassable = r.i8();
  t.anim = readTerrainAnim(r);
  t.elevation = r.arr(19, () => ({ frames: r.i16(), angles: r.i16(), shape: r.i16() }));
  t.replacement = r.i16();
  t.draw = [r.i16(), r.i16()];
  t.borders = r.arr(32, () => r.i16());
  const unitIds = r.arr(30, () => r.i16());
  const density = r.arr(30, () => r.i16());
  const placement = r.arr(30, () => r.i8());
  const used = r.i16();
  t.units = [];
  for (let i = 0; i < used && i < 30; i++) t.units.push({ unit: unitIds[i], density: density[i], placement: placement[i] });
  r.skip(2); // phantom
  return t;
}

function readBorder(r) {
  const b = { enabled: r.i8(), random: r.i8(), name: r.str(13), file: r.str(13), slp: r.i32() };
  r.skip(4);
  b.sound = r.i32();
  b.color = [r.u8(), r.u8(), r.u8()];
  b.anim = readTerrainAnim(r);
  b.frames = r.arr(19 * 12, () => ({ frames: r.i16(), angles: r.i16(), shape: r.i16() }));
  r.skip(2);
  b.underlay = r.i16();
  b.style = r.i16();
  return b;
}

function readMap(r) {
  const m = {};
  m.borders = [r.i32(), r.i32(), r.i32(), r.i32()];
  m.borderUsage = r.i32(); m.waterShape = r.i32(); m.baseTerrain = r.i32(); m.landCoverage = r.i32();
  r.skip(4);
  const nLands = r.u32(); r.skip(4);
  m.lands = r.arr(nLands, () => {
    const l = { id: r.i32(), terrain: r.i32(), spacing: r.i32(), baseSize: r.i32(), zone: r.i8(), placement: r.i8() };
    r.skip(2);
    l.baseX = r.i32(); l.baseY = r.i32(); l.proportion = r.i8(); l.byPlayer = r.i8();
    r.skip(2);
    l.startRadius = r.i32(); l.edgeFade = r.i32(); l.clumpiness = r.i32();
    return l;
  });
  const nTerr = r.u32(); r.skip(4);
  m.terrains = r.arr(nTerr, () => ({ proportion: r.i32(), terrain: r.i32(), clumps: r.i32(), edgeSpacing: r.i32(), zone: r.i32(), clumpiness: r.i32() }));
  const nUnits = r.u32(); r.skip(4);
  m.units = r.arr(nUnits, () => {
    const u = { unit: r.i32(), hostTerrain: r.i32(), groupPlacing: r.i8(), scale: r.i8() };
    r.skip(2);
    u.perGroup = r.i32(); u.fluctuation = r.i32(); u.groups = r.i32(); u.radius = r.i32();
    u.own = r.i32(); u.allPlayers = r.i32(); u.minDist = r.i32(); u.maxDist = r.i32();
    return u;
  });
  const nElev = r.u32(); r.skip(4);
  m.elevations = r.arr(nElev, () => ({ proportion: r.i32(), terrain: r.i32(), clumps: r.i32(), baseTerrain: r.i32(), baseElevation: r.i32(), spacing: r.i32() }));
  return m;
}

function readCommand(r) {
  const c = {};
  r.skip(2); c.id = r.i16(); r.skip(1);
  c.type = r.i16(); c.classId = r.i16(); c.unitId = r.i16(); c.terrainId = r.i16();
  c.resIn = r.i16(); c.resMul = r.i16(); c.resOut = r.i16(); r.skip(2);
  c.work1 = r.f32(); c.work2 = r.f32(); c.range = r.f32();
  r.skip(1 + 4 + 1 + 1 + 2 + 2 + 1 + 1 + 1);
  c.moveSprite = r.i16(); c.proceedSprite = r.i16(); c.workSprite = r.i16(); c.carrySprite = r.i16();
  c.gatherSound = r.i16(); c.depositSound = r.i16();
  return c;
}

function readUnit(r, type) {
  const u = { type };
  const nameLen = r.u16();
  u.id = r.i16();
  u.langName = r.u16(); r.skip(2);
  u.class = r.i16();
  u.standing = r.i16();
  u.dying = r.i16();
  u.undead = r.i16();
  u.deathMode = r.i8();
  u.hp = r.i16();
  u.los = r.f32();
  u.garrison = r.i8();
  u.radius = [r.f32(), r.f32(), r.f32()];
  u.trainSound = r.i16();
  u.deadUnit = r.i16();
  u.placementMode = r.i8(); u.canBeBuiltOn = r.i8();
  u.icon = r.i16();
  u.hidden = r.i8();
  r.skip(2);
  u.enabled = r.i8();
  r.skip(8); // placement terrains
  u.clearance = [r.f32(), r.f32()];
  u.elevationMode = r.i8(); u.fogVisibility = r.i8();
  u.terrainRestriction = r.i16();
  u.flyMode = r.i8();
  u.resourceCapacity = r.i16();
  u.resourceDecay = r.f32();
  u.blastDefense = r.i8(); r.skip(1);
  u.interaction = r.i8(); u.drawLevel = r.i8(); u.unitLevel = r.i8();
  r.skip(4); // attack reaction
  u.minimapColor = r.u8();
  r.skip(12); // help / hotkey dll ids
  r.skip(4); // recyclable, auto gather, doppelganger on death, gather drop
  r.skip(1); // selection effect
  r.skip(1); // editor selection colour
  u.selectionShape = [r.f32(), r.f32(), r.f32()];
  u.storage = r.arr(3, () => { const s = { type: r.i16(), amount: r.f32() }; r.skip(1); return s; });
  const dmgCount = r.i8();
  u.damageGraphics = r.arr(dmgCount, () => { const d = { gid: r.i16(), percent: r.i8() }; r.skip(2); return d; });
  u.selectionSound = r.i16();
  u.dyingSound = r.i16();
  r.skip(2); // old attack mode, convert terrain
  u.name = r.str(nameLen);
  r.skip(2); // id1
  if (type === 10 || type === 90) return u;
  u.speed = r.f32();
  if (type < 30) return u;
  u.walking = r.i16();
  u.running = r.i16();
  u.turnSpeed = r.f32();
  r.skip(1 + 2 + 1 + 4 + 1); // size class, trail unit/options/spacing, move algorithm
  if (type < 40) return u;
  r.skip(2); // default task
  u.searchRadius = r.f32();
  u.workRate = r.f32();
  u.dropSites = [r.i16(), r.i16()];
  u.taskGroup = r.i8();
  u.commandSound = r.i16();
  u.stopSound = r.i16();
  r.skip(1); // run pattern
  const nCmd = r.u16();
  u.commands = r.arr(nCmd, () => readCommand(r));
  if (type < 50) return u;
  u.defaultArmor = r.u8(); // used for attack classes missing from the armor list
  const nAtk = r.u16();
  u.attacks = r.arr(nAtk, () => ({ cls: r.i16(), amount: r.i16() }));
  const nArm = r.u16();
  u.armors = r.arr(nArm, () => ({ cls: r.i16(), amount: r.i16() }));
  u.boundary = r.i16();
  u.range = r.f32();
  u.blastRange = r.f32();
  u.reload = r.f32();
  u.projectile = r.i16();
  u.accuracy = r.i16();
  r.skip(1);
  u.frameDelay = r.i16();
  u.weaponOffset = [r.f32(), r.f32(), r.f32()];
  u.blastLevel = r.u8();
  u.minRange = r.f32();
  u.attackGraphic = r.i16();
  u.displayedArmor = r.i16(); u.displayedAttack = r.i16(); u.displayedRange = r.f32(); u.displayedReload = r.f32();
  if (type === 60) {
    u.projectileType = r.i8(); u.smartMode = r.i8(); u.dropAnimation = r.i8(); u.penetration = r.i8(); u.areaEffect = r.i8();
    u.arc = r.f32();
    return u;
  }
  if (type < 70) return u;
  u.cost = r.arr(3, () => ({ type: r.i16(), amount: r.i16(), enabled: r.i16() }));
  u.trainTime = r.i16();
  u.trainLocation = r.i16();
  u.button = r.i8();
  u.displayedPierce = r.i16();
  if (type < 80) return u;
  u.construction = r.i16();
  u.adjacentMode = r.i8();
  u.graphicsAngle = r.i16();
  u.disappearsWhenBuilt = r.i8();
  u.stackUnit = r.i16();
  u.foundationTerrain = r.i16();
  r.skip(2);
  u.research = r.i16();
  u.constructionSound = r.i16();
  return u;
}

function readCiv(r) {
  const c = { playerType: r.i8(), name: r.str(20) };
  const nRes = r.u16();
  c.techTree = r.i16();
  c.resources = r.arr(nRes, () => r.f32());
  c.iconSet = r.i8();
  const nUnits = r.u16();
  const offsets = r.arr(nUnits, () => r.i32());
  c.units = new Array(nUnits).fill(null);
  for (let i = 0; i < nUnits; i++) {
    if (!offsets[i]) continue;
    const type = r.i8();
    c.units[i] = readUnit(r, type);
  }
  return c;
}

function readTech(r) {
  const t = {};
  t.requires = r.arr(4, () => r.i16());
  t.cost = r.arr(3, () => { const c = { type: r.i16(), amount: r.i16(), enabled: r.i8() }; return c; });
  t.requiredCount = r.i16();
  t.location = r.i16();
  t.langName = r.u16(); t.langDesc = r.u16();
  t.time = r.i16();
  t.effect = r.i16();
  t.techType = r.i16();
  t.icon = r.i16();
  t.button = r.i8();
  r.skip(12);
  const nameLen = r.u16();
  t.name = r.str(nameLen);
  return t;
}

export function parseEmpiresDat(bytes) {
  const r = new Reader(bytes);
  const dat = {};
  dat.version = r.str(8);
  if (!dat.version.startsWith('VER 3.')) throw new Error('empires.dat: unsupported version ' + JSON.stringify(dat.version));
  const nRestr = r.u16(), nTerrain = r.u16();
  dat.terrainCount = nTerrain;
  r.skip(4 * nRestr);
  dat.restrictions = r.arr(nRestr, () => r.arr(nTerrain, () => r.f32()));
  const nColors = r.u16();
  dat.playerColors = r.arr(nColors, () => {
    const c = { name: r.str(30), id: r.i16(), resource: r.i16(), minimap: r.u8(), type: r.u8() };
    return c;
  });
  const nSounds = r.u16();
  dat.sounds = new Map();
  for (let i = 0; i < nSounds; i++) {
    const s = { id: r.i16(), delay: r.i16() };
    const n = r.u16(); r.skip(4);
    s.items = r.arr(n, () => ({ file: r.str(13), resource: r.i32(), probability: r.i16() }));
    dat.sounds.set(s.id, s);
  }
  const nGfx = r.u16();
  const ptrs = r.arr(nGfx, () => r.u32());
  dat.graphics = new Array(nGfx).fill(null);
  for (let i = 0; i < nGfx; i++) if (ptrs[i]) { const g = readGraphic(r); dat.graphics[i] = g; }
  // terrain block
  r.skip(24);
  dat.tileSizes = r.arr(19, () => ({ w: r.i16(), h: r.i16(), dz: r.i16() }));
  r.skip(2);
  dat.terrains = r.arr(32, () => readTerrain(r));
  dat.borders = r.arr(16, () => readBorder(r));
  r.skip(4);
  dat.terrainCountAdditional = r.u16();
  dat.bordersUsed = r.u16();
  dat.maxTerrain = r.i16();
  dat.tile = { w: r.i16(), h: r.i16(), halfH: r.i16(), halfW: r.i16(), elev: r.i16() };
  r.skip(12 + 12 + 2 + 2 + 20);
  // random maps
  const nMaps = r.u32(); r.skip(4);
  const mapIds = r.arr(nMaps, () => { const id = r.i32(); r.skip(68); return id; });
  dat.maps = mapIds.map((id) => ({ id, ...readMap(r) }));
  // effect bundles
  const nEffects = r.u32();
  dat.effects = r.arr(nEffects, () => {
    const name = r.str(31);
    const n = r.u16();
    return { name, effects: r.arr(n, () => ({ type: r.i8(), a: r.i16(), b: r.i16(), c: r.i16(), d: r.f32() })) };
  });
  const nCivs = r.u16();
  dat.civs = r.arr(nCivs, () => readCiv(r));
  const nTech = r.u16();
  dat.techs = r.arr(nTech, () => readTech(r));
  dat.end = r.o;
  dat.size = bytes.length;
  return dat;
}
