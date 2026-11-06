// Codeforces: public API, no key needed.  https://codeforces.com/apiHelp

const { getJson, sleep } = require('./http');

const BASE = process.env.CF_API_BASE || 'https://codeforces.com/api';

async function call(method, params) {
  const qs = new URLSearchParams(params).toString();
  try {
    const r = await getJson(BASE + '/' + method + '?' + qs);
    if (r.status !== 'OK') throw new Error('Codeforces: ' + (r.comment || 'API error'));
    return r.result;
  } catch (e) {
    if (e.json && e.json.comment) throw new Error('Codeforces: ' + e.json.comment);
    throw e;
  }
}

function problemUrl(contestId, index) {
  if (contestId >= 100000) return 'https://codeforces.com/gym/' + contestId + '/problem/' + index;
  return 'https://codeforces.com/problemset/problem/' + contestId + '/' + index;
}

// Counts one submission into `data.problems`. Returns the problem record, or null if it is ignored.
function applySubmission(data, s) {
  const p = s.problem;
  if (!p || p.contestId == null) return null;
  if (!s.verdict || s.verdict === 'COMPILATION_ERROR' || s.verdict === 'TESTING' || s.verdict === 'SKIPPED') return null;
  const key = 'cf:' + p.contestId + p.index;
  let rec = data.problems[key];
  if (!rec) {
    rec = data.problems[key] = {
      key,
      platform: 'cf',
      name: p.name,
      url: problemUrl(p.contestId, p.index),
      rating: p.rating ?? null,
      tags: p.tags || [],
      label: p.contestId + p.index,
      solved: false,
      solvedAt: null,
      attempts: 0,
      wrong: 0,
      lastAt: 0,
      lastVerdict: null,
      lastPassed: null,
    };
  }
  rec.attempts++;
  const t = s.creationTimeSeconds * 1000;
  if (t >= rec.lastAt) {
    rec.lastAt = t;
    rec.lastVerdict = s.verdict;
    rec.lastPassed = s.passedTestCount ?? null;
  }
  if (s.verdict === 'OK') {
    rec.solved = true;
    if (!rec.solvedAt || t < rec.solvedAt) rec.solvedAt = t;
  } else {
    rec.wrong++;
  }
  return rec;
}

// Pulls your rating and every submission, and rebuilds the Codeforces part of `data`.
async function sync(handle, data) {
  const info = (await call('user.info', { handles: handle }))[0];
  data.cfRating = info.rating ?? null;
  data.cfMaxRating = info.maxRating ?? null;

  await sleep(2100); // Codeforces allows about 1 request per 2 seconds
  const subs = await call('user.status', { handle });

  for (const k of Object.keys(data.problems)) {
    if (k.startsWith('cf:')) delete data.problems[k];
  }

  let maxId = 0;
  for (const s of subs) {
    applySubmission(data, s);
    if (s.verdict && s.verdict !== 'TESTING' && s.id > maxId) maxId = s.id;
  }
  data.cfMaxSubId = maxId;
  return { submissions: subs.length, solved: Object.values(data.problems).filter((p) => p.platform === 'cf' && p.solved).length };
}

// ---- live watch (used while a CP mode session is running) ----

// Step 1 (slow, network): the last few submissions.
function fetchRecent(handle, count) {
  return call('user.status', { handle, from: 1, count: count || 20 });
}

// Step 2 (instant): count the ones we have not seen yet. Returns one event per counted submission.
function applyRecent(data, subs) {
  const events = [];
  const fresh = subs.filter((s) => s.id > (data.cfMaxSubId || 0)).sort((a, b) => a.id - b.id);
  for (const s of fresh) {
    if (!s.verdict || s.verdict === 'TESTING') break; // still being judged, catch it on the next check
    const rec = applySubmission(data, s);
    data.cfMaxSubId = s.id;
    if (!rec) continue;
    events.push({
      sub: s.id,
      key: rec.key,
      name: rec.name,
      label: rec.label,
      url: rec.url,
      rating: rec.rating,
      verdict: s.verdict,
      passed: s.passedTestCount ?? null,
      at: s.creationTimeSeconds * 1000,
    });
  }
  return events;
}

async function contests() {
  const list = await call('contest.list', { gym: 'false' });
  return list
    .filter((c) => c.phase === 'BEFORE')
    .map((c) => ({
      platform: 'cf',
      id: String(c.id),
      name: c.name,
      start: c.startTimeSeconds * 1000,
      end: (c.startTimeSeconds + c.durationSeconds) * 1000,
      url: 'https://codeforces.com/contests/' + c.id,
    }));
}

// All rated problems on Codeforces, used by the recommender.
async function problemset() {
  const r = await call('problemset.problems', {});
  const stats = {};
  for (const s of r.problemStatistics) stats[s.contestId + ':' + s.index] = s.solvedCount;
  return r.problems
    .filter((p) => p.rating)
    .map((p) => ({
      contestId: p.contestId,
      index: p.index,
      name: p.name,
      rating: p.rating,
      tags: p.tags || [],
      solvedCount: stats[p.contestId + ':' + p.index] || 0,
    }));
}

module.exports = { sync, fetchRecent, applyRecent, applySubmission, contests, problemset, problemUrl };
