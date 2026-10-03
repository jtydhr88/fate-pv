#!/usr/bin/env node
// Offline renderer (Node ≥ 22.18 runs this TypeScript directly). Drives the app in headless Chrome
// (?export=1) and either
//   stills:  pnpm render stills --t 1.5,23,40.2 [--only id1,id2] [--out dir]
//   sheet:   pnpm render sheet --from 20 --to 35 [--n 12] [--cols 4] [--only ids] [--out file.png]   (or --times a,b,c | --cuts)
//   perf:    pnpm render perf --from 20 --to 25 [--only ids] [--samples 1] [--shutter 0.5]   (avg ms per frame incl. GPU sync and the export's pixel readback)
//   video:   pnpm render video [--from 0] [--to <end>] [--fps 60] [--crf 16] [--x264 aq-mode=3] [--samples 1] [--shutter 0.5] [--out ../out/fate.mp4] [--noaudio]
//            --samples N averages N sub-frames per frame over shutter×(1/fps): motion blur + temporal AA;
//            --samples auto picks the count per frame (4, 12, 36, 108 or 324, see Engine.render)
//   segments: pnpm render segments [--only id1,id2] [--force] [--out ../out/fate.mp4] (+ the video options)
//            renders each timeline entry to its own cached clip (out/segments/<id>.mp4, no audio) and re-renders
//            only the entries whose sources or render options changed (a fingerprint per entry: its scene
//            files, the shared kit and engine, the data, the options), then joins them losslessly and muxes the audio
//   gpu:     pnpm render gpu   (prints the WebGL renderer headless Chrome got)
//   --scale N (all modes): render at N× the 1920x1080 layout (--scale 2 = true 3840x2160); stills are then saved
//            full-res from the pixel buffer, videos are encoded at the physical size.
// Uses the Vite dev server at --url (default http://localhost:5173); starts a private one if unreachable.
import { chromium, type Page } from 'playwright-core';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, openSync, closeSync, unlinkSync, renameSync } from 'node:fs';
import { hostname } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { WebSocketServer } from 'ws';

const argv = process.argv.slice(2);
const mode = argv[0] ?? 'stills';
const opt = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const LANG = opt('lang', 'zh')!;
const flag = (k: string) => argv.includes(`--${k}`);
const APP = path.resolve(import.meta.dirname, '..');
const ROOT = path.resolve(APP, '..');
const SCALE = Math.max(1, Math.round(+opt('scale', '1')!));
const OW = 1920 * SCALE, OH = 1080 * SCALE; // output size
// --samples N (fixed) or --samples auto [--min-samples 4] [--max-samples 324] [--tol 3] (adaptive, see Engine.render)
// --preview: a quick look (one sample per frame, no motion blur; 960x540; fast encode; its own clip folder)
const PREVIEW = flag('preview');
const SAMPLES = PREVIEW && !opt('samples') ? 1 : opt('samples', '1') === 'auto'
  ? { min: +opt('min-samples', '4')!, max: +opt('max-samples', '324')!, tol: +opt('tol', '3')! }
  : +opt('samples', '1')!;
const hist = (h: Record<string, number>) => Object.entries(h).sort((a, b) => +a[0] - +b[0]).map(([k, v]) => `${k}:${v}`).join(' ');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function reachable(url: string) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
}

async function ensureServer(): Promise<{ url: string; stop: () => void }> {
  const url = opt('url', 'http://localhost:5173')!;
  if (await reachable(url)) return { url, stop: () => {} };
  const port = 5300 + Math.floor(Math.random() * 500);
  // no live reload: a file saved mid-render must not reload the page
  const proc = spawn(process.execPath, [path.join(APP, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'], {
    cwd: APP, stdio: 'ignore', env: { ...process.env, FATE_NO_HMR: '1' },
  });
  const u = `http://localhost:${port}`;
  for (let i = 0; i < 100 && !(await reachable(u)); i++) await sleep(100);
  return { url: u, stop: () => proc.kill() };
}

async function openPage(url: string) {
  // --chrome <path> (or FATE_CHROME): a Chromium build instead of the installed Google Chrome, e.g. Playwright's
  // on a Linux box without Chrome (the DGX Spark: aarch64, where Google ships no Chrome)
  const exe = opt('chrome') ?? process.env.FATE_CHROME;
  const browser = await chromium.launch({
    ...(exe ? { executablePath: exe } : { channel: 'chrome' }),
    headless: !flag('headed'),
    // ANGLE backend per platform: Metal on macOS, D3D11 on Windows; on headless Linux the GPU is reached
    // through EGL (OpenGL ES on the NVIDIA driver; ANGLE's Vulkan path fails to create a device there)
    args: [
      ...(process.platform === 'darwin' ? ['--use-angle=metal'] : process.platform === 'win32' ? ['--use-angle=d3d11'] : ['--use-angle=gl-egl', '--ozone-platform=headless', '--enable-gpu', '--no-sandbox']),
      '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const logs: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  const only = opt('only');
  // --query k=v&k2=v2: extra page parameters (e.g. style=pbr); --lang zh|en: the opening's and title's language
  await page.goto(`${url}/?export=1&lang=${LANG}${only ? `&only=${only}` : ''}${SCALE !== 1 ? `&scale=${SCALE}` : ''}${opt('query') ? `&${opt('query')}` : ''}`);
  await page.waitForFunction(() => (window as any).__fate?.ready || (window as any).__fate?.error, null, { timeout: 120000 });
  const err = await page.evaluate(() => (window as any).__fate.error);
  if (err) throw new Error(`app failed to boot:\n${err}\n${logs.join('\n')}`);
  const size: [number, number] = await page.evaluate(() => [(window as any).__fate.width ?? 1920, (window as any).__fate.height ?? 1080]);
  if (size[0] !== OW || size[1] !== OH) throw new Error(`app renders ${size[0]}x${size[1]}, expected ${OW}x${OH} (--scale ${SCALE})`);
  const sceneErrors: string[] = await page.evaluate(() => (window as any).__fate.errors);
  if (sceneErrors.length) console.error('SCENE ERRORS:\n' + sceneErrors.join('\n'));
  return { browser, page, logs };
}

async function stills(page: Page, times: number[], outDir: string) {
  mkdirSync(outDir, { recursive: true });
  const files: string[] = [];
  for (const t of times) {
    const k: number = await page.evaluate(([t, s, sh]) => (window as any).__fate.still(t, s, sh), [t, SAMPLES, +opt('shutter', '0.5')!] as const);
    const f = path.join(outDir, `f_${t.toFixed(2).padStart(7, '0')}.png`);
    if (typeof SAMPLES !== 'number') console.log(`t=${t}: ${k} sub-frames`);
    // at scale > 1 the canvas is shown downscaled on the page: save the full-res pixel buffer instead
    if (SCALE !== 1) writeFileSync(f, Buffer.from(await page.evaluate(() => (window as any).__fate.png()), 'base64'));
    else await page.screenshot({ path: f, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
    files.push(f);
  }
  return files;
}

async function sheet(page: Page, times: number[], cols: number, out: string) {
  const dataUrl: string = await page.evaluate(async ({ times, cols }) => {
    const P = (window as any).__fate;
    const cw = 480, ch = 270, pad = 4, lab = 18;
    const rows = Math.ceil(times.length / cols);
    const cv = document.createElement('canvas');
    cv.width = cols * (cw + pad) + pad; cv.height = rows * (ch + lab + pad) + pad;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#222'; c.fillRect(0, 0, cv.width, cv.height);
    const src = document.getElementById('c') as HTMLCanvasElement;
    times.forEach((t: number, i: number) => {
      P.still(t);
      const x = pad + (i % cols) * (cw + pad), y = pad + Math.floor(i / cols) * (ch + lab + pad);
      c.drawImage(src, x, y + lab, cw, ch);
      c.fillStyle = '#ddd'; c.font = '13px monospace'; c.fillText(`${t.toFixed(2)}s`, x + 2, y + 13);
    });
    return cv.toDataURL('image/png');
  }, { times, cols });
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
}

async function video(page: Page, from: number, to: number, fps: number, out: string, noAudio = flag('noaudio')) {
  mkdirSync(path.dirname(out), { recursive: true });
  const crf = opt('crf', '16')!;
  const audio = path.join(ROOT, 'audio/fate.wav');
  const args = ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${OW}x${OH}`, '-r', String(fps), '-i', 'pipe:0'];
  if (!noAudio) args.push('-ss', String(from), '-t', String(to - from), '-i', audio);
  // Frames are sRGB (toSRGB in the final pass): convert with the BT.709 matrix and tag the stream,
  // otherwise ffmpeg converts with BT.601 while players and YouTube decode untagged HD as BT.709.
  args.push('-vf', `vflip,scale=${PREVIEW ? '960:540:' : ''}out_color_matrix=bt709,setparams=color_primaries=bt709:color_trc=bt709`, '-c:v', 'libx264', '-preset', PREVIEW ? 'veryfast' : opt('preset', 'slow')!, '-crf', PREVIEW ? '24' : crf, '-pix_fmt', 'yuv420p', '-tune', 'grain', '-x264-params', opt('x264', 'aq-mode=3')!);
  if (!noAudio) args.push('-c:a', 'aac', '-b:a', '320k', '-shortest');
  args.push('-movflags', '+faststart', out);
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = new Promise<void>((res, rej) => ff.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited with ${code}`)))));
  let frames = 0;
  const total = Math.round(to * fps) - Math.round(from * fps);
  const t0 = performance.now();
  const wss = new WebSocketServer({ port: 0, maxPayload: Math.max(64 * 1024 * 1024, OW * OH * 4 + 1024) });
  await new Promise<void>((r) => wss.once('listening', () => r()));
  const port = (wss.address() as { port: number }).port;
  // frames are piped strictly in order; each is acknowledged once ffmpeg's stdin has taken it
  let chain = Promise.resolve();
  wss.on('connection', (ws) => {
    ws.on('message', (msg: Buffer, isBinary: boolean) => {
      if (!isBinary) return;
      chain = chain.then(async () => {
        if (!ff.stdin!.write(msg)) await new Promise<void>((r) => ff.stdin!.once('drain', () => r()));
        frames++;
        ws.send(String(frames)); // ack: the page keeps at most a few frames ahead of ffmpeg (bounded memory at 4K)
        if (frames % 60 === 0 || frames === total) {
          const el = (performance.now() - t0) / 1000;
          process.stdout.write(`\r${frames}/${total} frames  ${(frames / el).toFixed(1)} fps  eta ${((total - frames) / (frames / el)).toFixed(0)}s   `);
        }
      });
    });
  });
  const used: Record<string, number> = await page.evaluate((o) => (window as any).__fate.stream(o), { from, to, fps, ws: `ws://localhost:${port}`, samples: SAMPLES, shutter: +opt('shutter', '0.5')!, inflight: 4 });
  while (frames < total) await sleep(20);
  await chain;
  ff.stdin!.end();
  await ffDone;
  wss.close();
  console.log(`\nwrote ${out} (${frames} frames in ${((performance.now() - t0) / 1000).toFixed(1)}s)`);
  console.log(`sub-frames per frame (count:frames): ${hist(used)}`);
}

/** All files under a directory (recursive). */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
}

/**
 * Fingerprint of everything that can change an entry's frames: its own scene module and helpers
 * (scenes/<file>.ts, scenes/<file>-*.ts), the shared kit (scenes/_*.ts), the engine, the timeline,
 * the data and audio analysis, and the render options.
 */
type TlEntry = { id: string; file: string; start: number; end: number; localized: boolean; params?: unknown; post?: unknown };

/** The music data a clip can see: score.json and audio.json cut to its window (with a margin for look-ahead
 *  and look-back), so adding or changing music elsewhere in the film leaves the clip's fingerprint alone. */
let DATA: { score: any; audio: any } | null = null;
function dataSlice(a: number, b: number): string {
  DATA ??= { score: JSON.parse(readFileSync(path.join(ROOT, 'data/score.json'), 'utf8')), audio: JSON.parse(readFileSync(path.join(ROOT, 'data/audio.json'), 'utf8')) };
  const { score: S, audio: A } = DATA;
  const over = (t0: number, t1: number) => t1 >= a && t0 <= b;
  const inT = (t: number) => t >= a && t <= b;
  const segs = S.segments.filter((x: any) => over(x.start, x.end));
  const ids = new Set(segs.map((x: any) => x.id));
  const last = b >= S.duration - 1e-6;
  const score = {
    segs, parts: S.parts.map((p: any, i: number) => [i, p]).filter(([, p]: any) => ids.has(p.segment)),
    notes: S.notes.filter((n: any) => over(n.t, n.t + n.d)),
    bars: S.bars.filter((x: any) => over(x.t, x.end)), fermatas: S.fermatas.filter((x: any) => over(x.t, x.end)),
    sections: S.sections.filter((x: any) => over(x.start, x.end)), motifs: S.motifs.filter((x: any) => over(x.t[0], x.end)),
    beats: S.beats.filter(inT), downbeats: S.downbeats.filter(inT), duration: last ? S.duration : null,
  };
  const fa = Math.max(0, Math.floor(a * A.fps)), fb = Math.ceil(b * A.fps) + 1;
  const audio: Record<string, unknown> = { fps: A.fps, bpm: A.bpm, duration: last ? A.duration : null };
  for (const [k, v] of Object.entries(A)) {
    if (k === 'beats' || k === 'downbeats') audio[k] = (v as number[]).filter(inT);
    else if (k === 'sections') audio[k] = (v as any[]).filter((x) => over(x.start, x.end));
    else if (k === 'onsets') audio[k] = Object.fromEntries(Object.entries(v as Record<string, number[][]>).map(([kk, l]) => [kk, l.filter((e) => inT(e[0]!))]));
    else if (Array.isArray(v)) audio[k] = v.slice(fa, fb);
  }
  return JSON.stringify({ score, audio });
}

/** What a clip depends on: its scene code (and what it imports), the engine, its timeline entry and the music data
 *  in its window. Margin: scenes look a little ahead and back (note pre-rolls, ringing tails). */
function fingerprint(e: TlEntry, from: number, to: number, opts: string) {
  const src = path.join(APP, 'src');
  // the scene and the scene files it imports (transitively: its helpers, the shared kits it actually uses);
  // the engine counts whole (every plate runs through it)
  const deps = new Set<string>();
  const follow = (f: string) => {
    if (deps.has(f) || !existsSync(f)) return;
    deps.add(f);
    for (const m of readFileSync(f, 'utf8').matchAll(/from '(\.\/[^']+)'/g)) follow(path.join(path.dirname(f), m[1]!) + '.ts');
  };
  follow(path.join(src, 'scenes', `${e.file}.ts`));
  const files = [
    ...deps, ...walk(path.join(src, 'engine')), path.join(src, 'main.ts'),
    // a scene's own data (e.g. data/opening.json for the opening)
    ...[path.join(ROOT, `data/${e.file}.json`)].filter((f) => existsSync(f)),
  ].sort();
  const h = createHash('sha1');
  // portable: '/'-separated relative paths and LF text, so a Windows checkout and a Linux copy agree
  for (const f of files) h.update(path.relative(ROOT, f).split(path.sep).join('/')).update(readFileSync(f, 'utf8').split('\r\n').join('\n'));
  h.update(JSON.stringify({ id: e.id, file: e.file, params: e.params ?? null, post: e.post ?? null, from, to, lang: e.localized ? LANG : null }));
  h.update(dataSlice(from - 4, to + 4));
  return h.update(opts).digest('hex').slice(0, 16);
}

async function segments(page: Page) {
  const fps = +opt('fps', '60')!;
  const tl: TlEntry[] = await page.evaluate(() => (window as any).__fate.timeline);
  const dur: number = await page.evaluate(() => (window as any).__fate.duration);
  // --segdir: where the clips live; point two machines at one shared folder (e.g. the NAS) and both work the queue
  const dir = path.resolve(opt('segdir', path.join(ROOT, PREVIEW ? 'out/preview-segments' : 'out/segments'))!);
  mkdirSync(dir, { recursive: true });
  const only = opt('only')?.split(',');
  // everything that changes the pixels or the stream (the concat needs identical encoder settings)
  const opts = JSON.stringify({ fps, SAMPLES, shutter: opt('shutter', '0.5'), crf: opt('crf', '16'), preset: opt('preset', 'slow'), x264: opt('x264', 'aq-mode=3'), SCALE, PREVIEW });
  const list: string[] = [];
  // --order reverse: work the queue from the end (a second machine starts there and the two meet in the middle)
  const order = [...tl.keys()];
  if (opt('order') === 'reverse') order.reverse();
  const plan: { i: number; clip: string; fp: string; from: number; to: number }[] = [];
  for (let i = 0; i < tl.length; i++) {
    const e = tl[i]!;
    // frame-exact windows: entry i owns frames [round(start*fps), round(next start*fps))
    const from = Math.round(e.start * fps) / fps, to = Math.round((i + 1 < tl.length ? tl[i + 1]!.start : dur) * fps) / fps;
    const clip = path.join(dir, `${String(i).padStart(2, '0')}-${e.id}${e.localized ? `.${LANG}` : ''}.mp4`);
    const fp = fingerprint(e, from, to, opts);
    list.push(`file '${clip.split(path.sep).join('/')}'`);
    plan.push({ i, clip, fp, from, to });
  }
  const isFresh = (c: { clip: string; fp: string }) => existsSync(c.clip) && existsSync(c.clip + '.fp') && readFileSync(c.clip + '.fp', 'utf8') === c.fp;
  // --restamp: the sources are known not to have changed since the clips were rendered (e.g. the fingerprint
  // recipe itself changed): mark every existing clip fresh without rendering
  // (only finished clips: they have a stamp and no live claim; a clip another machine is still writing is left alone)
  if (flag('restamp')) { for (const c of plan) if (existsSync(c.clip) && existsSync(c.clip + '.fp') && !existsSync(c.clip + '.claim')) writeFileSync(c.clip + '.fp', c.fp); console.log('restamped'); return; }
  for (const i of order) {
    const c = plan[i]!, e = tl[i]!;
    if (isFresh(c) && !flag('force') && !(only && only.includes(e.id))) { console.log(`[${e.id}] cached (${c.fp})`); continue; }
    // (the page only loaded the --only entries: never render the others here, it would come out black)
    if (only && !only.includes(e.id)) { console.log(`[${e.id}] not in --only: skipped`); continue; }
    // claim the entry (an exclusive create): another machine working the same folder skips it; claims older than
    // 3 h are taken to be from a dead worker
    const claim = c.clip + '.claim';
    try {
      if (existsSync(claim) && Date.now() - statSync(claim).mtimeMs > 3 * 3600e3) unlinkSync(claim);
      const fd = openSync(claim, 'wx'); writeFileSync(fd, `${hostname()} ${process.pid} ${new Date().toISOString()}`); closeSync(fd);
    } catch { console.log(`[${e.id}] claimed by ${readFileSync(claim, 'utf8')}: skipped`); continue; }
    try {
      // the plan was made at start: another machine may have finished this entry since (its claim already gone)
      if (isFresh(c) && !flag('force') && !(only && only.includes(e.id))) { console.log(`[${e.id}] finished elsewhere: skipped`); continue; }
      console.log(`[${e.id}] rendering ${c.from.toFixed(3)}–${c.to.toFixed(3)} s on ${hostname()}`);
      // write beside the clip and swap it in when done: a clip on disk is always whole (a join may be reading it)
      const part = c.clip.replace(/\.mp4$/, '.part.mp4');
      await video(page, c.from, c.to, fps, part, true);
      // keep the clip this one replaces (every version stays: we go back and pick): history/<name>.<its fp>.mp4
      // (a clip open in a player on Windows can't be moved: retry a few times, then leave the new one as .part
      // and say so; the next run picks the entry up again)
      const busyRename = async (from: string, to: string) => {
        for (let k = 0; ; k++) {
          try { renameSync(from, to); return true; } catch (err: any) {
            if (err?.code !== 'EBUSY' && err?.code !== 'EPERM') throw err;
            if (k >= 10) return false;
            await sleep(1500);
          }
        }
      };
      let swapped = true;
      if (existsSync(c.clip)) {
        const old = existsSync(c.clip + '.fp') ? readFileSync(c.clip + '.fp', 'utf8') : `unstamped-${statSync(c.clip).mtimeMs | 0}`;
        mkdirSync(path.join(dir, 'history'), { recursive: true });
        swapped = await busyRename(c.clip, path.join(dir, 'history', `${path.basename(c.clip, '.mp4')}.${old}.mp4`));
      }
      if (swapped && (swapped = await busyRename(part, c.clip))) {
        writeFileSync(c.clip + '.fp', c.fp);
      } else {
        console.log(`[${e.id}] ${path.basename(c.clip)} is open in another program (locked): the new clip stays at ${path.basename(part)}`);
      }
    } finally { unlinkSync(claim); }
  }
  if (flag('no-join')) { console.log('rendered my share (--no-join): not joining'); return; }
  // wait for the clips other machines are rendering, then join
  const busy = (c: { clip: string; fp: string }) => !isFresh(c) || existsSync(c.clip + '.claim');
  for (let n = 0; plan.some(busy); n++) {
    if (n === 0) console.log(`waiting for: ${plan.filter(busy).map((c) => tl[c.i]!.id).join(', ')}`);
    await sleep(15000);
  }
  // join without re-encoding, then add the whole audio track once (no codec priming gaps at the seams)
  const listFile = path.join(dir, 'list.txt');
  writeFileSync(listFile, list.join('\n') + '\n');
  const out = path.resolve(opt('out', path.join(ROOT, 'out/fate.mp4'))!);
  // with an opening (the film starts before 0), its track goes in front of the music's
  // the opening's track before the music's (the film starts before 0), the epilogue's (silence) after it
  const tracks = [
    ...(tl[0]!.start < 0 ? ['audio/opening.wav'] : []), 'audio/fate.wav',
    ...(tl.some((e) => e.id === 'epilogue') ? ['audio/epilogue.wav'] : []),
  ];
  const audioIn = tracks.flatMap((f) => ['-i', path.join(ROOT, f)]);
  const audioMap = tracks.length > 1
    ? ['-filter_complex', `${tracks.map((_, i) => `[${i + 1}:a]`).join('')}concat=n=${tracks.length}:v=0:a=1[a]`, '-map', '0:v', '-map', '[a]']
    : ['-map', '0:v', '-map', '1:a'];
  await new Promise<void>((res, rej) => {
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, ...audioIn,
      ...audioMap, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-shortest', '-movflags', '+faststart', out], { stdio: 'inherit' });
    ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg concat exited with ${c}`))));
  });
  console.log(`wrote ${out}`);
}

const { url, stop } = await ensureServer();
const { browser, page, logs } = await openPage(url);
try {
  if (mode === 'gpu') {
    console.log(await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2')!;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    }));
  } else if (mode === 'stills') {
    const times = (opt('t') ?? '0').split(',').map(Number);
    const files = await stills(page, times, opt('out', path.join(ROOT, 'out/stills'))!);
    console.log(files.join('\n'));
  } else if (mode === 'sheet') {
    const from = +opt('from', '0')!, to = +opt('to', '10')!, n = +opt('n', '12')!;
    let times = Array.from({ length: n }, (_, i) => from + ((to - from) * i) / Math.max(1, n - 1));
    if (opt('times')) times = opt('times')!.split(',').map(Number);
    if (flag('cuts')) {
      // 4 frames around every timeline boundary: 2 frames before, 2 after
      const tl: { id: string; start: number }[] = await page.evaluate(() => (window as any).__fate.timeline);
      times = tl.slice(1).flatMap((e) => [e.start - 0.1, e.start - 1 / 60, e.start + 1 / 60, e.start + 0.1]);
    }
    const out = opt('out', path.join(ROOT, `out/sheets/sheet_${from}-${to}.png`))!;
    await sheet(page, times, +opt('cols', '4')!, out);
    console.log(out);
  } else if (mode === 'perf') {
    const from = +opt('from', '0')!, to = +opt('to', '5')!;
    const r = await page.evaluate(async ({ from, to, samples, shutter }) => {
      const P = (window as any).__fate;
      const ms: number[] = [];
      const buf = new Uint8Array(P.width * P.height * 4);
      P.still(from);
      const used: Record<number, number> = {};
      for (let t = from; t < to; t += 1 / 60) {
        const a = performance.now();
        const k = P.engine.render(t, 1 / 60, false, samples, shutter);
        used[k] = (used[k] ?? 0) + 1;
        await P.engine.readPixelsAsync(buf);
        ms.push(performance.now() - a);
      }
      ms.sort((a, b) => a - b);
      return { n: ms.length, avg: ms.reduce((a, b) => a + b, 0) / ms.length, p50: ms[ms.length >> 1], p95: ms[Math.floor(ms.length * 0.95)], max: ms[ms.length - 1], used };
    }, { from, to, samples: SAMPLES, shutter: +opt('shutter', '0.5')! });
    console.log(`frames ${r.n}  avg ${r.avg.toFixed(1)}ms  p50 ${r.p50.toFixed(1)}  p95 ${r.p95.toFixed(1)}  max ${r.max.toFixed(1)}  sub-frames ${hist(r.used)}`);
  } else if (mode === 'segments') {
    await segments(page);
  } else if (mode === 'video') {
    const dur: number = await page.evaluate(() => (window as any).__fate.duration);
    await video(page, +opt('from', '0')!, +opt('to', String(dur))!, +opt('fps', '60')!, path.resolve(opt('out', path.join(ROOT, 'out/fate.mp4'))!));
  }
  if (logs.length) console.error('BROWSER LOG:\n' + logs.slice(0, 40).join('\n'));
} finally {
  await browser.close();
  stop();
}
