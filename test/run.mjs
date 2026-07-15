// Headless test harness for the cslam sim. Evals the real <script> from
// index.html inside jsdom, so the code under test is the shipped code —
// no extracted copies to keep in sync.
//
// Usage: cd test && npm install && node run.mjs
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { TextEncoder } from 'util';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scriptMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('could not find module script in index.html');
// The mcap import is CDN-only; strip it and provide stubs on window instead.
const code = scriptMatch[1].replace(/^\s*import\s.*@mcap\/core.*$/m, '');
const htmlNoScript = html.replace(/<script type="module">[\s\S]*?<\/script>/, '');

let failures = 0;
function check(cond, label) {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}`);
  }
}

function makeSim(seed) {
  const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only' });
  const win = dom.window;
  let rafCb = null;
  win.requestAnimationFrame = (fn) => { rafCb = fn; };
  win.CSLAM_SEED = seed;
  win.TextEncoder = TextEncoder;
  win.URL.createObjectURL = () => 'blob:fake';
  win.URL.revokeObjectURL = () => {};
  const ctxStub = new Proxy({}, {
    get: (t, p) => (p in t ? t[p] : () => {}),
    set: (t, p, v) => { t[p] = v; return true; },
  });
  win.HTMLCanvasElement.prototype.getContext = () => ctxStub;
  win.HTMLAnchorElement.prototype.click = () => {}; // suppress jsdom navigation on download links
  const written = [];
  win.McapWriter = class {
    async start() {}
    async registerChannel() { return ++written.nextChannel || (written.nextChannel = 1); }
    async addMessage(m) { written.push(m); }
    async end() {}
  };
  win.TempBuffer = class { get() { return new Uint8Array(8); } };
  win.eval(code);
  const canvas = win.document.getElementById('csCanvas');
  canvas.getBoundingClientRect = () => ({
    left: 0, top: 0, width: canvas.width, height: canvas.height,
    right: canvas.width, bottom: canvas.height, x: 0, y: 0,
  });
  let ts = 0;
  function tick(n) {
    for (let i = 0; i < n; i++) {
      const cb = rafCb;
      rafCb = null;
      ts += 100;
      cb(ts);
    }
  }
  function configure({ env, drones, speed }) {
    if (env !== undefined) win.document.getElementById('csEnv').value = String(env);
    if (drones !== undefined) win.document.getElementById('csNumDrones').value = String(drones);
    if (speed !== undefined) win.document.getElementById('csSpeed').value = String(speed);
    win.eval('reset()');
  }
  function runUntil(pred, maxTicks) {
    let used = 0;
    while (used < maxTicks) {
      tick(50);
      used += 50;
      if (pred()) break;
    }
    return used;
  }
  return { win, tick, configure, runUntil, written };
}

// --- 1. Coverage matrix: 3 environments x 2/4/8 drones -----------------------
// Every config must finish mapping (auto-switch to navigate) with >=95% team
// coverage and bounded residual drift, under noisy sensing + odometry drift.
console.log('coverage matrix (3 envs x drones 2/4/8)');
const SEED_BASE = Number(process.env.SEED_BASE || 1000); // override to re-roll all noise
const MAX_TICKS = 30000; // 0.2 sim-sec per tick at speed 2
let navSim = null; // keep a finished two-rooms sim for the click test
for (let env = 0; env < 3; env++) {
  for (const n of [2, 4, 8]) {
    const sim = makeSim(SEED_BASE + env * 10 + n);
    sim.configure({ env, drones: n, speed: 2 });
    const envName = sim.win.eval('ENVIRONMENTS[parseInt(envSelect.value,10)].name');
    const used = sim.runUntil(() => sim.win.eval('phase') === 'navigate', MAX_TICKS);
    const cov = sim.win.eval('teamCoveragePct()');
    const drifts = sim.win.eval('drones.map(function(d){return Math.hypot(d.x-d.tx,d.y-d.ty)/CELL;})');
    const maxDrift = Math.max(...drifts);
    check(sim.win.eval('phase') === 'navigate', `${envName} n=${n}: reached navigate (${used} ticks)`);
    check(cov >= 95, `${envName} n=${n}: team coverage ${cov}% >= 95%`);
    check(maxDrift < 3, `${envName} n=${n}: max residual drift ${maxDrift.toFixed(2)} cells < 3`);
    if (env === 0 && n === 2) navSim = sim;
  }
}

// --- 2. Click-to-navigate on the merged map ----------------------------------
console.log('click-to-navigate');
{
  const { win, tick } = navSim;
  const CELL = win.eval('CELL');
  const merged = win.eval('liveMerged()');
  // candidate free cells, far corners first; with honest map error some
  // believed-free cells are legitimately unreachable, so try a few
  const candidates = [];
  for (let r = merged.length - 2; r >= 1; r--) {
    for (let c = merged[0].length - 2; c >= 1; c--) {
      if (merged[r][c] === 0) candidates.push({ r, c });
    }
  }
  check(candidates.length > 0, 'found free goal cells in the merged map');
  const canvas = win.document.getElementById('csCanvas');
  let goal = null;
  let routed = 0;
  for (const cand of candidates.filter((_, i) => i % 7 === 0).slice(0, 6)) {
    canvas.dispatchEvent(new win.MouseEvent('click', {
      clientX: cand.c * CELL + CELL / 2,
      clientY: cand.r * CELL + CELL / 2,
      bubbles: true,
    }));
    routed = win.eval('drones.filter(function(d){return d.state==="navigating";}).length');
    if (routed >= 1) { goal = cand; break; }
  }
  check(routed >= 1, `a clickable goal routed drones (${routed} of ${win.eval('drones.length')})`);
  if (goal) {
    tick(4000);
    const arrived = win.eval(
      `drones.filter(function(d){return d.state==="idle"&&Math.hypot(d.x-(${goal.c}*CELL+CELL/2),d.y-(${goal.r}*CELL+CELL/2))<CELL*1.5;}).length`
    );
    check(arrived >= 1 && arrived === routed, `every routed drone arrived at the goal (${arrived}/${routed})`);
  }
}

// --- 3. DOM lifecycle ---------------------------------------------------------
console.log('dom lifecycle');
{
  const sim = makeSim(42);
  const { win, tick } = sim;
  const doc = win.document;
  tick(300);
  check(win.eval('drones.length') === 2, 'default mission runs with 2 drones');

  doc.getElementById('csNumDrones').value = '5';
  doc.getElementById('csNumDrones').dispatchEvent(new win.Event('change', { bubbles: true }));
  tick(100);
  check(win.eval('drones.length') === 5, 'live drone-count change resets to 5 drones');
  check(win.eval('phase') === 'mapping', 'drone-count change restarts mapping');

  doc.getElementById('csEnv').value = '2';
  doc.getElementById('csEnv').dispatchEvent(new win.Event('change', { bubbles: true }));
  tick(100);
  check(win.eval('COLS') === 24 && win.eval('ROWS') === 18, 'environment switch rebuilds the four-rooms grid');
  check(doc.getElementById('csCanvas').width === 24 * 20, 'canvas resized to the new environment');

  doc.getElementById('csPause').click();
  const covBefore = win.eval('teamCoveragePct()');
  tick(50);
  check(win.eval('teamCoveragePct()') === covBefore, 'pause freezes the simulation');
  doc.getElementById('csPause').click();

  doc.getElementById('csReset').click();
  tick(50);
  check(win.eval('phase') === 'mapping' && win.eval('simTimeNs') > 0, 'reset restarts the mission');
}

// --- 4. MCAP record button flow ------------------------------------------------
console.log('mcap recording');
{
  const sim = makeSim(7);
  const { win, tick, written } = sim;
  const doc = win.document;
  tick(50);
  doc.getElementById('csRecord').click();
  await new Promise((r) => setTimeout(r, 20)); // let async startRecording settle
  check(win.eval('recording') === true, 'record button starts recording');
  check(doc.getElementById('csRecBadge').style.display !== 'none', 'recording badge shown');
  tick(200);
  doc.getElementById('csRecord').click();
  await new Promise((r) => setTimeout(r, 20));
  check(win.eval('recording') === false, 'record button stops recording');
  check(doc.getElementById('csRecBadge').style.display === 'none', 'recording badge hidden after stop');
  check(written.length > 0, `messages were written while recording (${written.length})`);
  const poseMsg = written.find((m) => m.data && m.data.length);
  check(poseMsg !== undefined, 'written messages carry payload bytes');
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
