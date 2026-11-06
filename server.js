// CP MODE: a small local web app. Run with:  node server.js
// Everything stays on your computer. Open http://localhost:3000

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const store = require('./lib/store');
const logic = require('./lib/logic');
const cf = require('./lib/codeforces');
const ac = require('./lib/atcoder');
const cc = require('./lib/codechef');
const { sleep } = require('./lib/http');

if (typeof fetch !== 'function') {
  console.error('This app needs Node.js 18 or newer. You have ' + process.version + '. Install the latest LTS from https://nodejs.org');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
// Handles and API keys are entered in the app's setup form and saved on your own computer
// (settings.json in the data folder), never in the project, so they are safe to leave out of GitHub.
const SETTINGS_FILE = path.join(store.DATA_DIR, 'settings.json');
const SETTING_KEYS = ['codeforces', 'atcoder', 'codechef', 'geminiKey', 'geminiModel'];
function loadSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    const out = {};
    SETTING_KEYS.forEach((k) => { if (typeof s[k] === 'string') out[k] = s[k]; });
    return out;
  } catch (e) {
    return {};
  }
}
Object.assign(config, loadSettings());
const GEMINI_DEFAULT = 'gemini-3.8-flash';
// Gemini 3.x models "think" before answering and thinking counts toward the output limit, so keep it low for short replies.
const gcfg = (model, max) => { const g = { maxOutputTokens: max }; if (/^gemini-3/.test(model)) g.thinkingConfig = { thinkingLevel: 'low' }; return g; };
if (config.geminiModel === 'gemini-2.5-flash') delete config.geminiModel; // Google closed this model to new users
const PORT = parseInt(process.env.PORT || config.port || 3000, 10);
const PUBLIC = path.join(__dirname, 'public');
const PROBLEMSET_FILE = path.join(store.DATA_DIR, 'problemset.json');

// ---------- contests (cached 15 minutes per platform) ----------
const contestCache = {
  cf: { at: 0, list: [], error: null },
  ac: { at: 0, list: [], error: null },
  cc: { at: 0, list: [], error: null },
};

async function refreshContests(force) {
  const now = Date.now();
  const jobs = [
    ['cf', cf.contests],
    ['ac', ac.contests],
    ['cc', cc.contests],
  ].map(async ([k, fn]) => {
    const c = contestCache[k];
    if (!force && now - c.at < 15 * 60000) return;
    try {
      c.list = await fn();
      c.error = null;
      c.at = now;
    } catch (e) {
      c.error = e.message;
      c.at = now - 10 * 60000; // try again in ~5 minutes
    }
  });
  await Promise.all(jobs);
}

async function getContests(force) {
  await refreshContests(force);
  const now = Date.now();
  const all = [].concat(contestCache.cf.list, contestCache.ac.list, contestCache.cc.list).filter((c) => c.end > now);
  all.sort((a, b) => a.start - b.start);
  return {
    now,
    contests: all.slice(0, 15),
    errors: { cf: contestCache.cf.error, ac: contestCache.ac.error, cc: contestCache.cc.error },
  };
}

// ---------- problem list for the recommender (cached 7 days) ----------
function readProblemset() {
  try {
    return JSON.parse(fs.readFileSync(PROBLEMSET_FILE, 'utf8'));
  } catch (e) {
    return null;
  }
}

async function getProblemset() {
  const cached = readProblemset();
  if (cached && Date.now() - cached.fetchedAt < 7 * 86400000) return cached.items;
  try {
    const items = await cf.problemset();
    fs.mkdirSync(store.DATA_DIR, { recursive: true });
    fs.writeFileSync(PROBLEMSET_FILE, JSON.stringify({ fetchedAt: Date.now(), items }));
    return items;
  } catch (e) {
    if (cached) return cached.items;
    throw e;
  }
}

// ---------- sync ----------
let syncing = false;

const isSynced = (k) => k.startsWith('cf:') || k.startsWith('ac:');

// A sync takes about a minute. We work on a copy and merge at the end, so anything
// you tagged while it was running is not lost.
async function runSync() {
  const work = store.load();
  const report = {};
  try {
    report.cf = config.codeforces ? await cf.sync(config.codeforces, work) : { skipped: true };
  } catch (e) {
    report.cf = { error: e.message };
  }
  try {
    report.ac = config.atcoder ? await ac.sync(config.atcoder, work) : { skipped: true };
  } catch (e) {
    report.ac = { error: e.message };
  }
  try {
    report.cc = config.codechef ? await cc.profile(config.codechef, work) : { skipped: true };
  } catch (e) {
    report.cc = { error: e.message };
  }

  const fresh = store.load();
  for (const k of Object.keys(fresh.problems)) if (isSynced(k)) delete fresh.problems[k];
  for (const [k, v] of Object.entries(work.problems)) if (isSynced(k)) fresh.problems[k] = v;
  fresh.cfRating = work.cfRating;
  fresh.cfMaxRating = work.cfMaxRating;
  fresh.cfMaxSubId = work.cfMaxSubId;
  fresh.ratings = work.ratings;
  fresh.cc = work.cc;
  fresh.lastSync = Date.now();
  fresh.syncReport = report;
  store.save(fresh);

  // refresh the recommender's problem list in the background (best effort)
  sleep(2100)
    .then(() => getProblemset())
    .catch(() => {});
  return report;
}

// ---------- live watch (while a CP mode session is running) ----------
async function runWatch() {
  if (syncing) return { events: [], busy: true };
  if (!store.load().lastSync) return { events: [], error: 'Press Sync now first, so the app knows your history.' };

  let subs;
  try {
    subs = await cf.fetchRecent(config.codeforces, 20);
  } catch (e) {
    return { events: [], error: e.message };
  }

  // from here to store.save() there is no waiting, so nothing can slip in between
  const data = store.load();
  const before = data.cfMaxSubId;
  const events = cf.applyRecent(data, subs);
  const now = Date.now();
  for (const ev of events) {
    const rec = data.problems[ev.key];
    ev.solved = !!rec.solved;
    ev.tagged = !!data.tags[ev.key];
    ev.suggest = ev.verdict === 'OK' ? null : logic.suggestReason(ev.verdict, ev.passed);
    const q = data.resolves[ev.key];
    if (ev.verdict === 'OK' && q && !q.done && q.due <= now) {
      logic.resolveResult(data, ev.key, 'solved'); // an accepted re-solve counts automatically
      ev.resolved = true;
    }
  }
  if (events.length || data.cfMaxSubId !== before) store.save(data);
  return { events };
}

// ---------- http plumbing ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp4': 'video/mp4',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 6e6) {
        reject(new Error('Body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) {
        reject(new Error('Bad JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && p === '/api/state') {
      return sendJson(res, 200, logic.buildState(store.load(), config));
    }
    if (req.method === 'GET' && p === '/api/contests') {
      return sendJson(res, 200, await getContests(url.searchParams.get('force') === '1'));
    }
    if (req.method === 'GET' && p === '/api/recommend') {
      try {
        const ps = await getProblemset();
        return sendJson(res, 200, logic.recommend(ps, store.load()));
      } catch (e) {
        return sendJson(res, 200, { error: 'Could not load the Codeforces problem list: ' + e.message, items: [] });
      }
    }
    if (req.method === 'POST' && p === '/api/sync') {
      if (syncing) return sendJson(res, 409, { error: 'A sync is already running' });
      syncing = true;
      try {
        return sendJson(res, 200, { report: await runSync() });
      } finally {
        syncing = false;
      }
    }
    if (req.method === 'POST' && p === '/api/watch') {
      return sendJson(res, 200, await runWatch());
    }
    if (req.method === 'POST' && p === '/api/tag') {
      const b = await readBody(req);
      const data = store.load();
      logic.tag(data, b.key, b.reason);
      store.save(data);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'GET' && p === '/api/setup') {
      return sendJson(res, 200, {
        configured: !!config.codeforces, codeforces: config.codeforces || '', atcoder: config.atcoder || '', codechef: config.codechef || '',
        hasGemini: !!(config.geminiKey || process.env.GEMINI_API_KEY), geminiModel: config.geminiModel || GEMINI_DEFAULT,
      });
    }
    if (req.method === 'POST' && p === '/api/setup') {
      const b = await readBody(req);
      const next = {};
      for (const k of ['codeforces', 'atcoder', 'codechef']) {
        if (typeof b[k] !== 'string') continue;
        const v = b[k].trim();
        if (!/^[A-Za-z0-9_.\-]{0,40}$/.test(v)) return sendJson(res, 400, { error: 'That ' + k + ' handle has odd characters. Use only letters, numbers, _ . -' });
        next[k] = v;
      }
      if (!(next.codeforces !== undefined ? next.codeforces : config.codeforces)) return sendJson(res, 400, { error: 'Your Codeforces handle is required.' });
      const changed = next.codeforces && next.codeforces !== config.codeforces;
      if (changed) {
        try {
          const r = await fetch('https://codeforces.com/api/user.info?handles=' + encodeURIComponent(next.codeforces), { signal: AbortSignal.timeout(7000) });
          const j = await r.json();
          if (j.status === 'FAILED') return sendJson(res, 400, { error: 'Codeforces says the handle "' + next.codeforces + '" does not exist.' });
        } catch (e) { /* offline or rate limited: skip the check, do not block setup */ }
      }
      if (typeof b.geminiKey === 'string' && b.geminiKey.trim()) next.geminiKey = b.geminiKey.trim();
      if (typeof b.geminiModel === 'string' && /^[A-Za-z0-9._-]{1,60}$/.test(b.geminiModel.trim())) next.geminiModel = b.geminiModel.trim();
      const saved = loadSettings();
      Object.assign(saved, next);
      if (b.clearGemini) delete saved.geminiKey;
      fs.mkdirSync(store.DATA_DIR, { recursive: true });
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(saved, null, 2), { mode: 0o600 });
      Object.assign(config, next);
      if (b.clearGemini) delete config.geminiKey;
      if (changed) { const d = store.load(); d.lastSync = null; d.cfMaxSubId = 0; store.save(d); }
      return sendJson(res, 200, { ok: true, needsSync: !!changed || !store.load().lastSync });
    }
    if (req.method === 'POST' && p === '/api/gemini-test') {
      const b = await readBody(req);
      const key = (typeof b.key === 'string' && b.key.trim()) || config.geminiKey || process.env.GEMINI_API_KEY;
      const model = (typeof b.model === 'string' && /^[A-Za-z0-9._-]{1,60}$/.test(b.model.trim()) && b.model.trim()) || config.geminiModel || GEMINI_DEFAULT;
      if (!key) return sendJson(res, 200, { ok: false, error: 'Paste a Gemini key first.' });
      try {
        const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
          method: 'POST', signal: AbortSignal.timeout(20000),
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with the single word OK.' }] }], generationConfig: gcfg(model, 2048) }),
        });
        const j = await r.json();
        if (j.error) return sendJson(res, 200, { ok: false, model, error: String(j.error.message || 'Gemini rejected the request').replace(key, '***') });
        const t = (((j.candidates || [{}])[0].content || {}).parts || [{}])[0].text || '';
        return sendJson(res, 200, { ok: true, model, reply: t.trim().slice(0, 40) });
      } catch (e) {
        return sendJson(res, 200, { ok: false, model, error: 'Could not reach Gemini. Check your internet connection.' });
      }
    }
    if (req.method === 'POST' && p === '/api/failure') {
      const b = await readBody(req);
      const data = store.load();
      logic.logFailure(data, b);
      store.save(data);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/voice') {
      const b = await readBody(req);
      const gkey = config.geminiKey || process.env.GEMINI_API_KEY;
      if (!gkey) return sendJson(res, 200, { error: 'Voice in the desktop app needs a Gemini key. Add it in SETUP. You can still type.' });
      try {
        const sys = 'You are the voice coach inside a personal competitive programming dashboard. Use only this JSON context: ' + JSON.stringify(b.context || {}) + '. The user spoke the attached audio. Reply with exactly what they said on the first line, then a new line, then your answer in at most 3 short spoken-style sentences.';
        const model = config.geminiModel || GEMINI_DEFAULT;
        const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': gkey },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: sys }, { inline_data: { mime_type: 'audio/wav', data: b.audio } }] }], generationConfig: gcfg(model, 2048) }),
        });
        const j = await r.json();
        if (j.error) return sendJson(res, 200, { error: 'Gemini: ' + j.error.message });
        const t = ((j.candidates || [{}])[0].content || { parts: [{}] }).parts[0].text || '';
        const i = t.indexOf('\n');
        return sendJson(res, 200, i > 0 ? { heard: t.slice(0, i).trim(), reply: t.slice(i).trim() } : { reply: t.trim() });
      } catch (e) {
        return sendJson(res, 200, { error: 'Could not reach Gemini.' });
      }
    }
    if (req.method === 'POST' && p === '/api/chat') {
      const b = await readBody(req);
      const gkey = config.geminiKey || process.env.GEMINI_API_KEY;
      const key = config.anthropicKey || process.env.ANTHROPIC_API_KEY;
      if (!key && !gkey) return sendJson(res, 200, { reply: null });
      const sys = 'You are the voice coach inside a personal competitive programming dashboard. Answer in at most 3 short spoken-style sentences using only this JSON context. If something is not in it, say so. Context: ' + JSON.stringify(b.context || {});
      const q = String(b.question || '').slice(0, 500);
      try {
        if (gkey) {
          const model = config.geminiModel || GEMINI_DEFAULT;
          const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': gkey },
            body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ text: q }] }], generationConfig: gcfg(model, 2048) }),
          });
          const j = await r.json();
          if (j.error) console.error('Gemini error:', j.error.message);
          const t = (((j.candidates || [{}])[0].content || {}).parts || [{}])[0].text;
          return sendJson(res, 200, { reply: t || null });
        }
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 300, system: sys, messages: [{ role: 'user', content: q }] }),
        });
        const j = await r.json();
        return sendJson(res, 200, { reply: (j.content && j.content[0] && j.content[0].text) || null });
      } catch (e) {
        return sendJson(res, 200, { reply: null });
      }
    }
    if (req.method === 'POST' && p === '/api/resolve') {
      const b = await readBody(req);
      const data = store.load();
      logic.resolveResult(data, b.key, b.result);
      store.save(data);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/goal') {
      const b = await readBody(req);
      const data = store.load();
      if (b.clear) logic.clearGoal(data);
      else logic.setGoal(data, b.target, b.deadline);
      store.save(data);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'GET') return serveStatic(req, res, p);
    res.writeHead(405);
    res.end('Method not allowed');
  } catch (e) {
    sendJson(res, 400, { error: e.message });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('Port ' + PORT + ' is already in use. Is CP MODE already running in another Terminal window? Close that one, or change "port" in config.json.');
  } else {
    console.error(e);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const addr = 'http://localhost:' + PORT;
  console.log('\n  CP MODE is running at ' + addr);
  console.log('  Leave this window open while you use it. Press Control+C to stop.\n');
  if (process.platform === 'darwin' && !process.env.NO_OPEN) exec('open ' + addr);
});
