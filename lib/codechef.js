// CodeChef: contests come from CodeChef's own contest list. The solved count and rating
// are read from your public profile page. CodeChef has no official API for this, so
// this part is "best effort" and may need a fix if CodeChef changes its page.

const { getJson, getText } = require('./http');

const BASE = process.env.CC_API_BASE || 'https://www.codechef.com';
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function contests() {
  const url = BASE + '/api/list/contests/all?sort_by=START&sorting_order=asc&offset=0&mode=all';
  const r = await getJson(url, { retries: 1, headers: { 'User-Agent': BROWSER_UA } });
  const now = Date.now();
  const list = [].concat(r.present_contests || [], r.future_contests || []);
  return list
    .map((c) => {
      const start = Date.parse(c.contest_start_date_iso || c.contest_start_date);
      const end = Date.parse(c.contest_end_date_iso || c.contest_end_date);
      return {
        platform: 'cc',
        id: c.contest_code,
        name: c.contest_name,
        start,
        end,
        url: BASE + '/' + c.contest_code,
      };
    })
    .filter((c) => !isNaN(c.start) && !isNaN(c.end) && c.end > now);
}

function toText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

function firstInt(re, src) {
  const m = src.match(re);
  return m ? parseInt(m[1], 10) : null;
}

// Reads solved count, rating, highest rating and stars out of the profile page.
function parseProfile(html) {
  const text = toText(html);
  let solved = firstInt(/Total Problems Solved\s*:?\s*(\d+)/i, text);
  if (solved == null) solved = firstInt(/Problems Solved\s*:?\s*(\d+)/i, text);
  if (solved == null) solved = firstInt(/"(?:total_?problems_?solved|totalProblemsSolved)"\s*:\s*(\d+)/i, html);

  let rating = firstInt(/class="rating-number"[^>]*>\s*(\d{3,4})/i, html);
  if (rating == null) rating = firstInt(/"currentRating"\s*:\s*"?(\d{3,4})/i, html);

  const max = firstInt(/Highest Rating\s*:?\s*(\d{3,4})/i, text);
  const star = html.match(/(\d)\s*(?:★|&#9733;|&starf;)/) || text.match(/(\d)\s*★/);
  return { solved, rating, max, stars: star ? parseInt(star[1], 10) : null };
}

// Fetches the profile and stores the numbers in data.cc. Throws if nothing could be read.
async function profile(handle, data) {
  const html = await getText(BASE + '/users/' + encodeURIComponent(handle), {
    retries: 1,
    headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
  });
  const p = parseProfile(html);
  if (p.solved == null && p.rating == null) {
    throw new Error(
      'Could not read your CodeChef profile page (CodeChef may have changed its layout or blocked the request)'
    );
  }
  const prev = data.cc || {};
  data.cc = {
    solved: p.solved != null ? p.solved : prev.solved ?? null,
    rating: p.rating != null ? p.rating : prev.rating ?? null,
    max: p.max != null ? p.max : prev.max ?? null,
    stars: p.stars != null ? p.stars : prev.stars ?? null,
    at: Date.now(),
  };
  return { solved: data.cc.solved, rating: data.cc.rating };
}

module.exports = { contests, profile, parseProfile };
