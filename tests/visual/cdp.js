// Minimal Chrome DevTools Protocol driver (no dependencies; needs Node 22+ for global WebSocket and zlib.crc32).
// Chrome path: CHROME_PATH env var, else the macOS default install.
const { spawn } = require('child_process'); const fs = require('fs'); const os = require('os'); const path = require('path'); const zlib = require('zlib');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let proc, port = 9340 + Math.floor(Math.random() * 200);
async function launch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-chrome-'));
  proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return; } catch (_) {} await new Promise(r => setTimeout(r, 250)); }
  throw new Error('chrome did not start');
}
function close() { try { proc.kill('SIGKILL'); } catch (_) {} }
class Page {
  static async open() {
    const r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }); const t = await r.json();
    const p = new Page(); p.id = t.id; p.ws = new WebSocket(t.webSocketDebuggerUrl); p.seq = 0; p.pending = new Map(); p.handlers = {}; p.log = []; p.requests = [];
    await new Promise((res, rej) => { p.ws.onopen = res; p.ws.onerror = rej; });
    p.ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && p.pending.has(d.id)) { const { res, rej } = p.pending.get(d.id); p.pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); } else if (d.method) { (p.handlers[d.method] || []).forEach(h => h(d.params)); } };
    await p.send('Page.enable'); await p.send('Runtime.enable'); await p.send('Network.enable'); await p.send('Log.enable');
    p.on('Runtime.consoleAPICalled', e => p.log.push(`[console.${e.type}] ` + e.args.map(a => a.value ?? a.description ?? '').join(' ')));
    p.on('Runtime.exceptionThrown', e => p.log.push('[EXCEPTION] ' + (e.exceptionDetails.exception?.description || e.exceptionDetails.text)));
    p.on('Log.entryAdded', e => p.log.push(`[log.${e.entry.level}] ${e.entry.text} ${e.entry.url || ''}`));
    p.on('Network.requestWillBeSent', e => p.requests.push({ id: e.requestId, url: e.request.url, type: e.type, t: Date.now() }));
    p.on('Network.responseReceived', e => { const r = p.requests.find(x => x.id === e.requestId); if (r) { r.status = e.response.status; r.mime = e.response.mimeType; } });
    p.on('Network.loadingFailed', e => { const r = p.requests.find(x => x.id === e.requestId); if (r) r.failed = e.errorText; p.log.push('[netfail] ' + e.errorText + ' ' + e.requestId); });
    return p;
  }
  send(method, params = {}) { const id = ++this.seq; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); }
  async viewport(w, h = 800, mobile = true) { await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile, screenWidth: w, screenHeight: h }); if (mobile) await this.send('Emulation.setTouchEmulationEnabled', { enabled: true }); }
  async init(script) { await this.send('Page.addScriptToEvaluateOnNewDocument', { source: script }); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
  async goto(url, settleMs = 2500) { await this.send('Page.navigate', { url }); await new Promise(r => setTimeout(r, 300)); for (let i = 0; i < 80; i++) { const s = await this.eval('document.readyState').catch(() => ''); if (s === 'complete') break; await new Promise(r => setTimeout(r, 250)); } await new Promise(r => setTimeout(r, settleMs)); }
  async shot(file, full = true) { const args = { format: 'png' }; if (full) { const m = await this.send('Page.getLayoutMetrics'); const w = Math.ceil(m.cssContentSize.width), h = Math.min(Math.ceil(m.cssContentSize.height), 6000); args.captureBeyondViewport = true; args.clip = { x: 0, y: 0, width: w, height: h, scale: 1 }; } const r = await this.send('Page.captureScreenshot', args); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); return file; }
  async intercept(patterns, handler) { await this.send('Fetch.enable', { patterns: patterns.map(p => ({ urlPattern: p })) }); this.on('Fetch.requestPaused', async e => { try { const r = handler(e.request); if (r === 'continue') await this.send('Fetch.continueRequest', { requestId: e.requestId }); else await this.send('Fetch.fulfillRequest', { requestId: e.requestId, responseCode: r.status, responseHeaders: Object.entries(r.headers || {}).map(([name, value]) => ({ name, value })), body: Buffer.from(r.body).toString('base64') }); } catch (err) { this.log.push('[intercept-err] ' + err.message); } }); }
  async close() { try { await fetch(`http://127.0.0.1:${port}/json/close/${this.id}`); } catch (_) {} try { this.ws.close(); } catch (_) {} }
}
// deterministic coloured PNG (so each product image is visually distinguishable)
function png(w, h, seedStr) {
  let s = 0; for (const c of seedStr) s = (s * 31 + c.charCodeAt(0)) >>> 0; const R = 60 + (s % 160), G = 60 + ((s >> 8) % 160), B = 60 + ((s >> 16) % 160);
  const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 4 + 1) + 1 + x * 4; const ring = (Math.abs(x - w / 2) + Math.abs(y - h / 2)) % 40 < 6; raw[o] = ring ? 255 : R; raw[o + 1] = ring ? 255 : G; raw[o + 2] = ring ? 255 : B; raw[o + 3] = 255; } }
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
module.exports = { launch, close, Page, png };
