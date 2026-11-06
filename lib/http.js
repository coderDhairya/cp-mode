// Tiny helpers for talking to the platforms. Uses the fetch built into Node 18+.

const UA = 'cp-mode-local/1.0 (personal practice tracker)';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function request(url, opts = {}) {
  const retries = opts.retries ?? 2;
  const headers = Object.assign({ 'User-Agent': UA }, opts.headers || {});
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(opts.timeout || 60000),
      });
      const text = await res.text();
      if (!res.ok) {
        const err = new Error('HTTP ' + res.status + ' from ' + new URL(url).host);
        err.status = res.status;
        try {
          err.json = JSON.parse(text);
        } catch (e) {
          /* not json */
        }
        throw err;
      }
      return text;
    } catch (e) {
      lastErr = e;
      const permanent = e.status && e.status < 500 && e.status !== 429;
      if (permanent || i === retries) break;
      await sleep(1500 * (i + 1));
    }
  }
  if (lastErr && !lastErr.status) {
    const host = new URL(url).host;
    lastErr.message = lastErr.name === 'TimeoutError' ? host + ' took too long to answer' : 'Could not reach ' + host + ' (check your internet connection)';
  }
  throw lastErr;
}

async function getJson(url, opts) {
  const text = await request(url, Object.assign({ headers: { Accept: 'application/json' } }, opts));
  return JSON.parse(text);
}

async function getText(url, opts) {
  return request(url, opts);
}

module.exports = { sleep, getJson, getText };
