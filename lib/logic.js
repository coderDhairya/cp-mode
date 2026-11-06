// The "brain": turns your saved data into what the dashboard shows.

const DAY = 86400000;
const INTERVALS = [3, 10, 30]; // days: re-solve after 3, then 10, then 30 days

const REASONS = {
  no_idea: "Didn't see the idea",
  bug: 'Implementation bug',
  edge_case: 'Missed edge case',
  time: 'Time pressure',
  knowledge: 'Knowledge gap',
};

// Codeforces difficulty bands (lo is exclusive, hi is inclusive).
const CF_BANDS = [
  { label: '800 and below', lo: -1, hi: 800 },
  { label: '900 to 1000', lo: 800, hi: 1000 },
  { label: '1100 to 1200', lo: 1000, hi: 1200 },
  { label: '1300 to 1400', lo: 1200, hi: 1400 },
  { label: '1500 to 1700', lo: 1400, hi: 1700 },
  { label: '1800 and up', lo: 1700, hi: 99999 },
];

function slim(p) {
  return {
    key: p.key,
    platform: p.platform,
    name: p.name,
    label: p.label,
    url: p.url,
    rating: p.rating,
    tags: p.tags || [],
    attempts: p.attempts,
    wrong: p.wrong,
    lastAt: p.lastAt,
  };
}

function solvedCount(data, platform) {
  return Object.values(data.problems).filter((p) => p.platform === platform && p.solved).length;
}

function totalCfAc(data) {
  return solvedCount(data, 'cf') + solvedCount(data, 'ac');
}

// A rough guess of why a submission failed, from the verdict alone. You can always change it.
function suggestReason(verdict, passed) {
  switch (verdict) {
    case 'RUNTIME_ERROR':
      return 'bug';
    case 'TIME_LIMIT_EXCEEDED':
    case 'MEMORY_LIMIT_EXCEEDED':
      return 'no_idea'; // the approach itself was too slow or too heavy
    case 'WRONG_ANSWER':
      return passed != null && passed >= 3 ? 'edge_case' : 'bug';
    case 'CHALLENGED':
      return 'edge_case';
    default:
      return null;
  }
}

function goalProgress(data, now) {
  const g = data.goal;
  if (!g) return null;
  const done = Math.max(0, totalCfAc(data) - g.base);
  const remaining = Math.max(0, g.target - done);
  const daysLeft = Math.max(0, Math.ceil((g.deadline - now) / DAY));
  return {
    target: g.target,
    deadline: g.deadline,
    start: g.start,
    done,
    remaining,
    pct: Math.min(100, Math.round((done / g.target) * 100)),
    daysLeft,
    perDay: daysLeft > 0 ? Math.round((remaining / daysLeft) * 10) / 10 : remaining,
    reached: done >= g.target,
    expired: now > g.deadline && done < g.target,
  };
}

function buildState(data, config) {
  const now = Date.now();
  const probs = Object.values(data.problems);
  const cf = probs.filter((p) => p.platform === 'cf');
  const ac = probs.filter((p) => p.platform === 'ac');

  // ---- solved counts and categories ----
  const cfSolved = cf.filter((p) => p.solved);
  const cfBands = CF_BANDS.map((b) => ({
    label: b.label,
    count: cfSolved.filter((p) => p.rating != null && p.rating > b.lo && p.rating <= b.hi).length,
  }));
  const unrated = cfSolved.filter((p) => p.rating == null).length;
  if (unrated) cfBands.push({ label: 'Unrated', count: unrated });

  // topics: a problem with several tags counts once in each topic
  const topicMap = {};
  for (const p of cf) {
    for (const t of p.tags || []) {
      if (t.charAt(0) === '*') continue; // Codeforces meta tags such as "*special"
      const o = (topicMap[t] = topicMap[t] || { tag: t, solved: 0, stuck: 0 });
      if (p.solved) o.solved++;
      else o.stuck++;
    }
  }
  const topics = Object.values(topicMap)
    .filter((o) => o.solved > 0 || o.stuck > 0)
    .sort((a, b) => b.solved - a.solved || b.stuck - a.stuck || a.tag.localeCompare(b.tag));

  const acSolved = ac.filter((p) => p.solved);
  const abc = acSolved.filter((p) => p.family === 'abc');
  const acBands = [
    { label: 'ABC A', count: abc.filter((p) => p.slot === 'A').length },
    { label: 'ABC B', count: abc.filter((p) => p.slot === 'B').length },
    { label: 'ABC C', count: abc.filter((p) => p.slot === 'C').length },
    { label: 'ABC D', count: abc.filter((p) => p.slot === 'D').length },
    { label: 'ABC E and up', count: abc.filter((p) => p.slot === 'E+').length },
    { label: 'ARC / AGC / other', count: acSolved.filter((p) => p.family !== 'abc').length },
  ];

  const cc = data.cc || null;
  const ccKnown = !!(cc && cc.solved != null);
  const total = cfSolved.length + acSolved.length + (ccKnown ? cc.solved : 0);

  const ratings = {
    cf: { rating: data.cfRating, max: data.cfMaxRating },
    ac: data.ratings && data.ratings.ac ? data.ratings.ac : null,
    cc: cc ? { rating: cc.rating, max: cc.max, stars: cc.stars } : null,
  };

  // ---- why you fail (tags from the last 30 days) ----
  const reasonCounts = {};
  for (const r of Object.keys(REASONS)) reasonCounts[r] = 0;
  let tagged30 = 0;
  for (const t of Object.values(data.tags)) {
    if (now - t.at <= 30 * DAY && reasonCounts[t.reason] != null) {
      reasonCounts[t.reason]++;
      tagged30++;
    }
  }
  const failures = Object.keys(REASONS)
    .map((r) => ({ reason: r, label: REASONS[r], count: reasonCounts[r] }))
    .sort((a, b) => b.count - a.count);

  // ---- post-mortem inbox: problems you tried and never solved, not yet tagged ----
  const windowMs = (config.postMortemDays || 60) * DAY;
  const untagged = probs.filter((p) => !p.solved && p.attempts > 0 && !data.tags[p.key]);
  const recent = []; // failures are logged manually, never pulled in automatically
  const inbox = recent.slice(0, 8).map((p) =>
    Object.assign(slim(p), { suggest: suggestReason(p.lastVerdict, p.lastPassed), lastVerdict: p.lastVerdict, lastPassed: p.lastPassed })
  );

  // ---- re-solve queue ----
  const queue = Object.entries(data.resolves)
    .filter(([, r]) => !r.done)
    .map(([key, r]) => {
      const p = data.problems[key];
      if (!p) return null;
      return Object.assign(slim(p), {
        stage: r.stage,
        stageLabel: 'D' + INTERVALS[Math.min(r.stage, 2)],
        due: r.due,
        reason: data.tags[key] ? data.tags[key].reason : null,
        reasonLabel: data.tags[key] ? REASONS[data.tags[key].reason] : null,
      });
    })
    .filter(Boolean)
    .sort((a, b) => a.due - b.due);

  // ---- weak tags (Codeforces) ----
  const weakTags = Object.values(topicMap)
    .filter((s) => s.solved + s.stuck >= 3 && s.stuck >= 2)
    .map((s) => ({ tag: s.tag, total: s.solved + s.stuck, failed: s.stuck }))
    .sort((a, b) => b.failed / b.total - a.failed / a.total || b.failed - a.failed)
    .slice(0, 3);

  // ---- what to do right now ----
  let rightNow;
  const due = queue.find((q) => q.due <= now);
  if (due) rightNow = { type: 'resolve', item: due };
  else if (inbox.length) rightNow = { type: 'postmortem', item: inbox[0] };
  else if (probs.length) rightNow = { type: 'practice' };
  else rightNow = { type: 'sync' };

  return {
    now,
    handles: { cf: config.codeforces, ac: config.atcoder, cc: config.codechef },
    lastSync: data.lastSync,
    syncReport: data.syncReport,
    ratings,
    solved: {
      cf: { total: cfSolved.length, bands: cfBands, week: cfSolved.filter((p) => now - p.solvedAt <= 7 * DAY).length },
      ac: { total: acSolved.length, bands: acBands, week: acSolved.filter((p) => now - p.solvedAt <= 7 * DAY).length },
      cc: { total: ccKnown ? cc.solved : null, known: ccKnown },
      total,
    },
    topics,
    failures,
    tags: Object.fromEntries(Object.entries(data.tags).map(([k, v]) => [k, v.reason])),
    taggedLast30: tagged30,
    inbox,
    inboxTotal: recent.length,
    olderUntagged: 0,
    queue,
    dueCount: queue.filter((q) => q.due <= now).length,
    weakTags,
    rightNow,
    goal: goalProgress(data, now),
    reasons: REASONS,
  };
}

function tag(data, key, reason) {
  const p = data.problems[key];
  if (!p) throw new Error('Unknown problem');
  if (!REASONS[reason]) throw new Error('Unknown reason');
  const now = Date.now();
  data.tags[key] = { reason, at: now };
  if (!p.solved && !data.resolves[key]) {
    data.resolves[key] = { key, stage: 0, due: now + INTERVALS[0] * DAY, done: false, history: [] };
  }
}

function logFailure(data, b) {
  const name = String(b.name || '').trim().slice(0, 140);
  if (!name) throw new Error('Type the problem name or link');
  const isUrl = /^https?:\/\//.test(name);
  const key = 'manual:' + Date.now();
  const r = parseInt(b.rating, 10);
  data.problems[key] = { key, platform: b.platform === 'ac' ? 'ac' : b.platform === 'cc' ? 'cc' : 'cf', name: isUrl ? name.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60) : name, label: 'logged by you', url: isUrl ? name : '#', rating: r > 0 ? r : null, tags: [], attempts: 1, wrong: 1, solved: false, lastAt: Date.now(), manual: true };
  tag(data, key, b.reason);
}

function resolveResult(data, key, result) {
  const r = data.resolves[key];
  if (!r) throw new Error('Not in the re-solve queue');
  const now = Date.now();
  r.history.push({ at: now, result });
  if (result === 'solved') {
    r.stage++;
    if (r.stage >= INTERVALS.length) r.done = true;
    else r.due = now + INTERVALS[r.stage] * DAY;
  } else if (result === 'failed') {
    r.stage = 0;
    r.due = now + INTERVALS[0] * DAY;
  } else if (result === 'dismiss') {
    r.done = true;
  } else {
    throw new Error('Unknown result');
  }
}

function setGoal(data, target, dateStr) {
  const t = parseInt(target, 10);
  if (!(t >= 1 && t <= 2000)) throw new Error('The target must be a number from 1 to 2000');
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('Pick a deadline date');
  const deadline = new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59).getTime();
  if (!(deadline > Date.now())) throw new Error('The deadline must be in the future');
  data.goal = { target: t, deadline, start: Date.now(), base: totalCfAc(data) };
}

function clearGoal(data) {
  data.goal = null;
}

function round100(n) {
  return Math.round(n / 100) * 100;
}

function targetRange(data) {
  const cf = Object.values(data.problems).filter((p) => p.platform === 'cf' && p.solved && p.rating);
  let base;
  if (data.cfRating) {
    base = Math.floor(data.cfRating / 100) * 100;
  } else if (cf.length >= 5) {
    const recent = cf.sort((a, b) => b.solvedAt - a.solvedAt).slice(0, 30).map((p) => p.rating).sort((a, b) => a - b);
    base = round100(recent[Math.floor(recent.length * 0.75)]);
  } else {
    base = 800;
  }
  const lo = Math.min(3400, Math.max(800, base + 100));
  const hi = Math.min(3500, lo + 100);
  return { base, lo, hi };
}

function buildWeak(data) {
  const stats = {};
  for (const p of Object.values(data.problems)) {
    if (p.platform !== 'cf') continue;
    for (const t of p.tags || []) {
      const s = (stats[t] = stats[t] || { total: 0, failed: 0 });
      s.total++;
      if (!p.solved) s.failed++;
    }
  }
  return Object.entries(stats)
    .filter(([, s]) => s.total >= 3 && s.failed >= 2)
    .sort((a, b) => b[1].failed / b[1].total - a[1].failed / a[1].total)
    .slice(0, 3)
    .map(([t]) => t);
}

function recommend(problemset, data) {
  const { base, lo, hi } = targetRange(data);
  const weak = buildWeak(data);
  const seen = new Set(Object.keys(data.problems));
  const pool = problemset.filter(
    (p) => p.rating >= lo && p.rating <= hi && p.solvedCount >= 1500 && !seen.has('cf:' + p.contestId + p.index)
  );
  const scored = pool
    .map((p) => {
      const hit = p.tags.filter((t) => weak.includes(t));
      return { p, hit, score: hit.length * 3 + Math.random() * 2 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  return {
    target: { base, lo, hi },
    weakTags: weak,
    items: scored.map(({ p, hit }) => ({
      name: p.name,
      label: p.contestId + p.index,
      rating: p.rating,
      tags: p.tags,
      url: 'https://codeforces.com/problemset/problem/' + p.contestId + '/' + p.index,
      why: hit.length ? 'Weak tag: ' + hit[0] : 'New problem at your level',
    })),
  };
}

module.exports = { buildState, tag, logFailure, resolveResult, setGoal, clearGoal, recommend, suggestReason, REASONS, INTERVALS };
