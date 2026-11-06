// AtCoder: submissions come from the free AtCoder Problems API (kenkoooo.com),
// upcoming contests come from atcoder.jp itself (with kenkoooo as a backup).

const { getJson, getText, sleep } = require('./http');

const API = process.env.AC_API_BASE || 'https://kenkoooo.com/atcoder';
const SITE = process.env.AC_SITE_BASE || 'https://atcoder.jp';

// AtCoder Problems shows very easy problems with a "clipped" difficulty.
function clipDifficulty(d) {
  if (d == null) return null;
  if (d >= 400) return Math.round(d);
  return Math.round(400 / Math.exp((400 - d) / 400));
}

function slotOf(index) {
  const c = String(index || '').trim().toUpperCase().charAt(0);
  const map = { 1: 'A', 2: 'B', 3: 'C', 4: 'D' };
  const letter = map[c] || c;
  if ('ABCD'.includes(letter) && letter) return letter;
  return 'E+';
}

async function fetchSubmissions(user) {
  const seen = new Set();
  const all = [];
  let from = 0;
  for (let page = 0; page < 200; page++) {
    const url = API + '/atcoder-api/v3/user/submissions?user=' + encodeURIComponent(user) + '&from_second=' + from;
    const arr = await getJson(url);
    let fresh = 0;
    let maxT = from;
    for (const s of arr) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        all.push(s);
        fresh++;
      }
      if (s.epoch_second > maxT) maxT = s.epoch_second;
    }
    if (arr.length < 500 || fresh === 0) break;
    from = maxT;
    await sleep(1100); // be polite to the free API
  }
  return all;
}

async function sync(user, data) {
  const subs = await fetchSubmissions(user);
  await sleep(1100);
  let names = {};
  let models = {};
  try {
    const merged = await getJson(API + '/resources/merged-problems.json', { timeout: 120000 });
    for (const m of merged) names[m.id] = m;
  } catch (e) {
    /* names are optional */
  }
  await sleep(1100);
  try {
    models = await getJson(API + '/resources/problem-models.json', { timeout: 120000 });
  } catch (e) {
    /* difficulty is optional */
  }

  for (const k of Object.keys(data.problems)) {
    if (k.startsWith('ac:')) delete data.problems[k];
  }

  for (const s of subs) {
    if (!['AC', 'WA', 'TLE', 'MLE', 'RE', 'OLE', 'QLE', 'IE'].includes(s.result)) continue;
    const id = s.problem_id;
    const key = 'ac:' + id;
    const meta = names[id] || {};
    let rec = data.problems[key];
    if (!rec) {
      const index = meta.problem_index || id.split('_').pop();
      const contest = s.contest_id || meta.contest_id || id.split('_')[0];
      rec = data.problems[key] = {
        key,
        platform: 'ac',
        name: meta.title || meta.name || id,
        url: SITE + '/contests/' + contest + '/tasks/' + id,
        rating: clipDifficulty(models[id] && models[id].difficulty),
        tags: [],
        label: id,
        contest,
        family: (String(contest).match(/^(abc|arc|agc)/) || [null, 'other'])[1],
        slot: slotOf(index),
        solved: false,
        solvedAt: null,
        attempts: 0,
        wrong: 0,
        lastAt: 0,
      };
    }
    rec.attempts++;
    const t = s.epoch_second * 1000;
    if (t > rec.lastAt) rec.lastAt = t;
    if (s.result === 'AC') {
      rec.solved = true;
      if (!rec.solvedAt || t < rec.solvedAt) rec.solvedAt = t;
    } else {
      rec.wrong++;
    }
  }
  let ratingError = null;
  try {
    data.ratings = Object.assign({}, data.ratings, { ac: await rating(user) });
  } catch (e) {
    ratingError = e.message; // the solved count still works, only the rating is missing
  }
  return {
    submissions: subs.length,
    solved: Object.values(data.problems).filter((p) => p.platform === 'ac' && p.solved).length,
    ratingError,
  };
}

// Your AtCoder rating comes from the public contest history on atcoder.jp.
async function rating(user) {
  const arr = await getJson(SITE + '/users/' + encodeURIComponent(user) + '/history/json');
  const rated = arr
    .filter((e) => e.IsRated)
    .sort((a, b) => Date.parse(a.EndTime) - Date.parse(b.EndTime));
  if (!rated.length) return { rating: null, max: null, contests: 0 };
  return {
    rating: rated[rated.length - 1].NewRating,
    max: Math.max.apply(null, rated.map((e) => e.NewRating)),
    contests: rated.length,
  };
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// Reads the "Upcoming Contests" table on atcoder.jp/contests.
function parseUpcomingHtml(html) {
  const marker = html.indexOf('id="contest-table-upcoming"');
  if (marker < 0) return [];
  const section = html.slice(marker, html.indexOf('</table>', marker));
  const rows = section.match(/<tr[\s\S]*?<\/tr>/g) || [];
  const out = [];
  for (const row of rows) {
    const time = row.match(/<time[^>]*>([^<]+)<\/time>/);
    const link = row.match(/<a href="\/contests\/([^"]+)">([\s\S]*?)<\/a>/);
    const dur = row.match(/>\s*(\d{1,3}):(\d{2})\s*<\/td>/);
    if (!time || !link) continue;
    const iso = time[1].trim().replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    const start = Date.parse(iso);
    if (isNaN(start)) continue;
    const mins = dur ? parseInt(dur[1], 10) * 60 + parseInt(dur[2], 10) : 100;
    out.push({
      platform: 'ac',
      id: link[1],
      name: decodeEntities(link[2].replace(/<[^>]+>/g, '').trim()),
      start,
      end: start + mins * 60000,
      url: SITE + '/contests/' + link[1],
    });
  }
  return out;
}

async function contests() {
  try {
    const html = await getText(SITE + '/contests?lang=en', { retries: 1 });
    const list = parseUpcomingHtml(html);
    if (list.length) return list;
  } catch (e) {
    /* fall through to the backup source */
  }
  const arr = await getJson(API + '/resources/contests.json', { timeout: 120000 });
  const now = Date.now();
  return arr
    .filter((c) => (c.start_epoch_second + c.duration_second) * 1000 > now)
    .map((c) => ({
      platform: 'ac',
      id: c.id,
      name: c.title,
      start: c.start_epoch_second * 1000,
      end: (c.start_epoch_second + c.duration_second) * 1000,
      url: SITE + '/contests/' + c.id,
    }));
}

module.exports = { sync, contests, rating, parseUpcomingHtml, clipDifficulty, slotOf };
