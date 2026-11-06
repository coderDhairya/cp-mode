// CP Mode: four pages (Dashboard, Practice, Review, Contests). Talks to server.js on this computer.
(function () {
  'use strict';

  var PLAT = { cf: 'Codeforces', ac: 'AtCoder', cc: 'CodeChef' };
  var PAGES = ['dashboard', 'practice', 'review', 'contests'];
  var PAGE_TITLE = { dashboard: 'Dashboard', practice: 'Practice', review: 'Review', contests: 'Contests' };
  var SESSION_KEY = 'cp_mode_session_v2';
  var SESSION_MIN = 45;
  var SKIP = []; // problems you finished or skipped this run, never shown again
  var VERDICT = {
    OK: 'Accepted',
    WRONG_ANSWER: 'Wrong answer',
    TIME_LIMIT_EXCEEDED: 'Time limit',
    RUNTIME_ERROR: 'Runtime error',
    MEMORY_LIMIT_EXCEEDED: 'Memory limit',
    CHALLENGED: 'Hacked',
    IDLENESS_LIMIT_EXCEEDED: 'Idle limit',
    PRESENTATION_ERROR: 'Presentation',
    REJECTED: 'Rejected',
  };

  var S = {
    s: null,
    contests: null,
    rec: null,
    syncing: false,
    fatal: null,
    loadError: null,
    mode: 'topic',
    watching: false,
    watchErr: null,
    lastCheck: null,
    gt: '20',
    gd: defaultDeadline(),
  };

  window.CP_STATE = function () { return { s: S.s, c: S.contests }; };
  // ---------- small helpers ----------
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function api(path, method, body) {
    return fetch(path, {
      method: method || 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r
        .json()
        .catch(function () {
          return {};
        })
        .then(function (j) {
          if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
          return j;
        });
    });
  }

  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function defaultDeadline() {
    var d = new Date(Date.now() + 30 * 86400000);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function fmtClock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var d = Math.floor(s / 86400);
    var h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    if (d > 0) return d + 'd ' + pad(h) + 'h ' + pad(m) + 'm';
    return pad(h) + ':' + pad(m) + ':' + pad(sec);
  }

  function fmtRel(ms) {
    var m = Math.floor(ms / 60000);
    if (m < 1) return 'in under a minute';
    if (m < 60) return 'in ' + m + 'm';
    var h = Math.floor(m / 60);
    if (h < 24) return 'in ' + h + 'h ' + (m % 60) + 'm';
    var d = Math.floor(h / 24);
    return 'in ' + d + 'd ' + (h % 24) + 'h';
  }

  function fmtWhen(ms) {
    return new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }

  function fmtDay(ms) {
    return new Date(ms).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function fmtDur(a, b) {
    var m = Math.round((b - a) / 60000);
    var h = Math.floor(m / 60);
    return h ? h + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '') : m + 'm';
  }

  function fmtAgo(ms) {
    var m = Math.floor((Date.now() - ms) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' h ago';
    return Math.floor(h / 24) + ' d ago';
  }

  function verdictLabel(v) {
    return VERDICT[v] || String(v || '').replace(/_/g, ' ').toLowerCase();
  }

  function getSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    } catch (e) {
      return null;
    }
  }
  function setSession(v) {
    try {
      if (v) localStorage.setItem(SESSION_KEY, JSON.stringify(v));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  function currentPage() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    return PAGES.indexOf(h) >= 0 ? h : 'dashboard';
  }

  // ---------- calendar file (.ics) ----------
  function icsText(t) {
    return String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }
  function icsTime(ms) {
    return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }
  function buildIcs(c) {
    var alarms = [
      ['-P1D', '1 day'],
      ['-PT1H', '1 hour'],
      ['-PT10M', '10 minutes'],
    ]
      .map(function (a) {
        return ['BEGIN:VALARM', 'TRIGGER:' + a[0], 'ACTION:DISPLAY', 'DESCRIPTION:' + icsText(c.name + ' starts in ' + a[1]), 'END:VALARM'].join('\r\n');
      })
      .join('\r\n');
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//CP MODE//EN',
      'BEGIN:VEVENT',
      'UID:' + c.platform + '-' + c.id + '@cp-mode',
      'DTSTAMP:' + icsTime(Date.now()),
      'DTSTART:' + icsTime(c.start),
      'DTEND:' + icsTime(c.end),
      'SUMMARY:' + icsText(PLAT[c.platform] + ': ' + c.name),
      'URL:' + c.url,
      alarms,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
  }
  function downloadIcs(c) {
    var blob = new Blob([buildIcs(c)], { type: 'text/calendar' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (c.platform + '-' + c.id).replace(/[^a-z0-9_-]/gi, '_') + '.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  // ---------- shared pieces ----------
  function pgHead(eyebrow, title, hl, sub) {
    return '<div class="pghead"><div class="eyebrow">' + eyebrow + '</div><h1>' + title + ' <span class="hl">' + hl + '</span></h1><p>' + sub + '</p></div>';
  }

  function statusBar() {
    var s = S.s;
    return (
      '<div class="statusbar"><span class="mono"><span class="dot' + (s.lastSync ? '' : ' warn') + '"></span><span id="synced" data-at="' + (s.lastSync || 0) + '">' +
      (s.lastSync ? 'Synced ' + esc(fmtAgo(s.lastSync)) : 'Not synced yet') + '</span></span>' +
      '<button class="btn small" data-action="sync"' + (S.syncing ? ' disabled' : '') + '>' + (S.syncing ? 'Syncing… (about a minute)' : 'Sync now') + '</button></div>'
    );
  }

  function banners() {
    var out = [];
    if (S.fatal) out.push(S.fatal);
    if (S.loadError) out.push(S.loadError);
    var r = S.s && S.s.syncReport;
    if (r) {
      if (r.cf && r.cf.error) out.push('Codeforces sync failed: ' + r.cf.error);
      if (r.ac && r.ac.error) out.push('AtCoder sync failed: ' + r.ac.error);
      if (r.ac && r.ac.ratingError) out.push('AtCoder rating could not be loaded: ' + r.ac.ratingError);
    }
    return out
      .map(function (m) {
        return '<div class="banner">' + esc(m) + '</div>';
      })
      .join('');
  }

  function chipsHtml(key, suggest, sub) {
    var rs = S.s.reasons;
    return (
      '<div class="chips">' +
      Object.keys(rs)
        .map(function (r) {
          return (
            '<button class="chip' + '' + '" data-action="' + (sub ? 'evtag' : 'tag') + '" data-key="' + esc(key) + '" data-reason="' + r + '"' +
            (sub ? ' data-sub="' + esc(sub) + '"' : '') + '>' + esc(rs[r]) + '</button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function barRow(label, count, max, cls, note, top) {
    var w = max > 0 ? Math.max(count > 0 ? 3 : 0, Math.round((count / max) * 100)) : 0;
    return (
      '<div class="bar"><div class="bname' + (top ? ' top' : '') + '" title="' + esc(label) + '">' + esc(label) + '</div><div class="track"><div class="fill ' + (cls || '') + '" style="width:' + w + '%"></div></div>' +
      '<div class="bnum">' + count + '</div><div class="bnote">' + (note || '') + '</div></div>'
    );
  }

  function nextContest() {
    var c = S.contests && S.contests.contests;
    return c && c.length ? c[0] : null;
  }

  function errorLines() {
    var e = (S.contests && S.contests.errors) || {};
    return Object.keys(e)
      .filter(function (k) {
        return e[k];
      })
      .map(function (k) {
        return '<p class="empty" style="color:var(--amber)">' + PLAT[k] + ' contests could not be loaded (' + esc(e[k]) + ').</p>';
      })
      .join('');
  }

  // ======================= PAGE 1: DASHBOARD =======================
  function seg(w, color) {
    return '<div style="width:' + w + '%;background:' + color + '"></div>';
  }

  function totalCard() {
    var s = S.s;
    var cf = s.solved.cf.total;
    var ac = s.solved.ac.total;
    var cc = s.solved.cc.known ? s.solved.cc.total : 0;
    var tot = s.solved.total;
    var base = tot || 1;
    function pct(n) {
      return Math.round((n / base) * 1000) / 10;
    }
    function row(name, color, n) {
      return '<div class="lg"><span class="sw" style="background:' + color + '"></span><span>' + name + '</span><span class="mono">' + n + ' · ' + Math.round(pct(n)) + '%</span></div>';
    }
    var week = s.solved.cf.week + s.solved.ac.week;
    var ccNote = s.solved.cc.known
      ? 'The weekly change counts Codeforces and AtCoder only.'
      : 'CodeChef is not counted yet because its profile could not be read.';
    return (
      '<section class="card total"><div class="tleft"><div class="label">Total problems solved</div><div class="bignum">' + tot + '</div>' +
      '<div class="muted">across Codeforces, AtCoder and CodeChef</div><div><span class="ptag">+' + week + ' this week</span></div></div>' +
      '<div class="tright"><div class="split" role="img" aria-label="Share of solved problems by platform">' + seg(pct(cf), 'var(--cyan)') + seg(pct(ac), 'var(--amber)') + seg(pct(cc), 'var(--coral)') + '</div>' +
      '<div class="legend">' + row('Codeforces', 'var(--cyan)', cf) + row('AtCoder', 'var(--amber)', ac) + row('CodeChef', 'var(--coral)', cc) + '</div>' +
      '<p class="empty">' + ccNote + '</p></div></section>'
    );
  }

  function platformCard(o) {
    return (
      '<article class="card pc' + (o.hot ? ' hot' : '') + '"><div class="pc-hd"><div class="pc-name ' + o.cls + '">' + o.name + '</div><div class="pc-lines mono">' + o.lines.map(esc).join('<br>') + '</div></div>' +
      '<div class="pc-body"><div class="pc-num ' + o.cls + '">' + (o.solved == null ? '-' : o.solved) + '</div><div class="muted">problems solved</div>' +
      '<div class="pc-tags">' + o.tags.map(function (t) { return '<span class="ptag">' + esc(t) + '</span>'; }).join('') + '</div>' +
      (o.note ? '<p class="empty">' + o.note + '</p>' : '') +
      '<div class="pc-foot"><a class="arrow" href="' + esc(o.url) + '" target="_blank" rel="noopener">Visit Profile →</a></div></div></article>'
    );
  }

  function ratingLines(r, stars) {
    if (!r || r.rating == null) return ['rating: unrated', 'max rating: -'];
    return ['rating: ' + r.rating + (stars ? ' (' + stars + '★)' : ''), 'max rating: ' + (r.max != null ? r.max : '-')];
  }

  function cfCard() {
    var s = S.s;
    return platformCard({
      name: 'Codeforces', cls: 'c-cf', hot: true, lines: ratingLines(s.ratings.cf), solved: s.solved.cf.total,
      tags: [s.handles.cf, '+' + s.solved.cf.week + ' this week'], url: 'https://codeforces.com/profile/' + encodeURIComponent(s.handles.cf),
    });
  }

  function acCard() {
    var s = S.s;
    var r = s.ratings.ac;
    var note = r && r.rating == null ? 'No rated AtCoder contest yet.' : '';
    return platformCard({
      name: 'AtCoder', cls: 'c-ac', lines: ratingLines(r), solved: s.solved.ac.total, note: note,
      tags: [s.handles.ac, '+' + s.solved.ac.week + ' this week'], url: 'https://atcoder.jp/users/' + encodeURIComponent(s.handles.ac),
    });
  }

  function ccCard() {
    var s = S.s;
    var cc = s.ratings.cc;
    var err = s.syncReport && s.syncReport.cc && s.syncReport.cc.error;
    var note = '';
    if (!s.solved.cc.known) note = err ? 'Could not load this profile: ' + esc(err) + '.' : 'Press Sync now to load your CodeChef profile.';
    else note = 'Read from your public profile page. CodeChef gives no per-problem data, so there are no categories here.';
    return platformCard({
      name: 'CodeChef', cls: 'c-cc', lines: ratingLines(cc, cc && cc.stars), solved: s.solved.cc.total, note: note,
      tags: [s.handles.cc], url: 'https://www.codechef.com/users/' + encodeURIComponent(s.handles.cc),
    });
  }

  function cfCategories() {
    var s = S.s;
    var topic = S.mode === 'topic';
    var head =
      '<div class="panel-head"><div class="label">Codeforces · by ' + (topic ? 'topic' : 'difficulty') + '</div>' +
      '<div class="seg" role="group" aria-label="Group problems by">' +
      '<button class="segb' + (topic ? ' on' : '') + '" data-action="mode" data-mode="topic" aria-pressed="' + topic + '">Topic</button>' +
      '<button class="segb' + (!topic ? ' on' : '') + '" data-action="mode" data-mode="difficulty" aria-pressed="' + !topic + '">Difficulty</button></div></div>';
    var body;
    if (!s.solved.cf.total && !s.topics.length) {
      body = '<p class="empty">Nothing here yet. Sync to load your Codeforces history.</p>';
    } else if (topic) {
      var list = s.topics.slice(0, 10);
      var max = Math.max.apply(null, list.map(function (t) { return t.solved; }).concat([0]));
      body =
        '<div class="bars">' +
        list.map(function (t) { return barRow(t.tag, t.solved, max, '', t.stuck ? '+' + t.stuck + ' stuck' : ''); }).join('') + '</div>' +
        '<p class="empty">Tags come from Codeforces. A problem with several tags counts in each. The amber note is how many you tried but never solved.' +
        (s.topics.length > 10 ? ' Showing the top 10 of ' + s.topics.length + ' topics.' : '') + '</p>';
    } else {
      var bands = s.solved.cf.bands;
      var m2 = Math.max.apply(null, bands.map(function (b) { return b.count; }).concat([0]));
      body = '<div class="bars">' + bands.map(function (b) { return barRow(b.label, b.count, m2, '', ''); }).join('') + '</div>' +
        '<p class="empty">Difficulty is the Codeforces problem rating.</p>';
    }
    return '<section class="card">' + head + body + '</section>';
  }

  function acCategories() {
    var s = S.s;
    var bands = s.solved.ac.bands;
    var max = Math.max.apply(null, bands.map(function (b) { return b.count; }).concat([0]));
    return (
      '<section class="card"><div class="panel-head"><div class="label">AtCoder · by contest and slot</div></div>' +
      '<div class="bars">' + bands.map(function (b) { return barRow(b.label, b.count, max, 'amber', ''); }).join('') + '</div>' +
      '<p class="empty">AtCoder does not publish topic tags, so problems are grouped by contest type and by slot (A is the easiest problem of a contest).</p></section>'
    );
  }

  function pageDashboard() {
    return statusBar() + banners() + '<div class="dash2">' + totalCard() + cfCategories() + '</div>';
  }

  // ======================= PAGE 2: PRACTICE =======================
  function rightNowCard() {
    var s = S.s;
    var rn = s.rightNow;
    var sess = getSession();

    if (rn.type === 'sync') {
      return (
        '<section class="card hot hero"><div class="label">Right now</div><h2>Pull in your history</h2>' +
        '<p class="desc">Nothing to show yet. Sync once and this card will tell you what to do next: a re-solve, a post-mortem, or a fresh problem at your level.</p>' +
        '<div class="btnrow"><button class="btn primary" data-action="sync"' + (S.syncing ? ' disabled' : '') + '>' + (S.syncing ? 'Syncing…' : 'Sync now') + '</button></div></section>'
      );
    }

    var item = null;
    var title = '';
    var desc = '';
    var chip = '';
    var extra = '';
    var key = '';

    if (rn.type === 'resolve') {
      item = rn.item;
      key = item.key;
      title = 'Re-solve from scratch';
      chip = '<div class="tag-amber">DUE</div>';
      desc = esc(item.name) + ' (' + esc(item.label) + '), ' + (item.rating ? 'rated ' + item.rating : 'unrated') + '. ' + esc(item.stageLabel) + ' review.' +
        (item.reasonLabel ? ' You tagged the cause as: ' + esc(item.reasonLabel.toLowerCase()) + '.' : '') + ' No editorial, no peeking.';
      extra =
        '<div class="qlabel">After your attempt' + (item.platform === 'cf' ? ' (an accepted Codeforces submission counts by itself)' : '') + '</div><div class="btnrow">' +
        '<button class="btn small" data-action="resolve" data-key="' + esc(key) + '" data-result="solved">I solved it</button>' +
        '<button class="btn small" data-action="resolve" data-key="' + esc(key) + '" data-result="failed">Failed again</button>' +
        '<button class="btn small" data-action="resolve" data-key="' + esc(key) + '" data-result="dismiss">Drop it</button></div>';
    } else if (rn.type === 'postmortem') {
      item = rn.item;
      key = item.key;
      title = 'Tag your last failure';
      chip = '<div class="tag-amber">TO DO</div>';
      desc = esc(item.name) + ' (' + esc(item.label) + '), ' + (item.rating ? 'rated ' + item.rating : 'unrated') + '. You made ' + item.attempts + ' attempt' + (item.attempts > 1 ? 's' : '') +
        ' and never solved it. Why did it fail? Be honest, the pattern is the whole point.';
      var inFeed = sess && (sess.events || []).some(function (e) {
        return e.key === key && e.verdict !== 'OK';
      });
      extra = inFeed
        ? '<div class="qlabel">This failure is in your live session below. Tag it there.</div>'
        : '<div class="qlabel">Pick the main reason. The highlighted one is my guess from the last verdict.</div>' + chipsHtml(key, item.suggest);
    } else {
      var r = S.rec && S.rec.items && S.rec.items[0];
      title = 'Solve one new problem';
      if (r) {
        item = { name: r.name, label: r.label, rating: r.rating, url: r.url, tags: r.tags, platform: 'cf' };
        key = 'cf:' + r.label;
        desc = esc(r.name) + ' (' + esc(r.label) + '), rated ' + r.rating + '. ' + esc(r.why) + '. Picked for your level.';
      } else if (S.rec && S.rec.error) {
        desc = esc(S.rec.error);
      } else {
        desc = 'Finding a problem at your level…';
      }
    }

    var running = !!sess;
    var timer = running ? fmtClock(Math.max(0, sess.start + SESSION_MIN * 60000 - Date.now())) : pad(SESSION_MIN) + ':00';
    var tags = item && item.tags && item.tags.length ? item.tags.slice(0, 2).join(', ') : item ? PLAT[item.platform || 'cf'] : '-';

    var buttons = '';
    if (item && item.url) {
      if (rn.type === 'postmortem') {
        buttons = '<a class="btn primary" href="' + esc(item.url) + '" target="_blank" rel="noopener">Open problem</a>';
      } else if (running && sess.key === key) {
        buttons = '<a class="btn primary" href="' + esc(item.url) + '" target="_blank" rel="noopener">Open problem</a><button class="btn" data-action="endsession">End session</button>';
      } else {
        buttons = '<button class="btn primary" data-action="enter" data-key="' + esc(key) + '" data-url="' + esc(item.url) + '">Enter CP Mode</button>' + (rn.type === 'practice' ? '<button class="btn" data-action="newrec">Another problem</button>' : '');
      }
    }

    if (running && sess.done && rn.type === 'practice') {
      title = 'Solved!';
      desc = 'Accepted. Ready for the next one?';
      buttons = '<button class="btn primary" data-action="nextprob">Next problem</button><button class="btn" data-action="endsession">End session</button>';
    }
    return (
      '<section class="card hot hero"><div class="panel-head"><div class="label">Right now</div>' + chip + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:10px"><h2>' + title + '</h2><p class="desc">' + desc + '</p></div>' +
      (item
        ? '<div class="tiles"><div class="tile"><div class="label">Session timer</div><div class="big" id="timer"' + (running ? ' data-start="' + sess.start + '"' : '') + ' style="color:var(--cyan)">' + timer + '</div></div>' +
          '<div class="tile"><div class="label">Rating</div><div class="big">' + (item.rating || 'n/a') + '</div></div>' +
          '<div class="tile"><div class="label">Tags</div><div class="mono" style="font-size:14px;line-height:1.5;padding-top:6px">' + esc(tags) + '</div></div></div>'
        : '') +
      (buttons ? '<div class="btnrow">' + buttons + '</div>' : '') + extra + '</section>'
    );
  }

  function eventRow(ev) {
    var ok = ev.verdict === 'OK';
    var test = !ok && ev.passed != null ? ' · failed on test ' + (ev.passed + 1) : '';
    var sess = getSession();
    var mins = sess ? Math.max(0, Math.round((ev.at - sess.start) / 60000)) : null;
    var tail = '';
    if (ok) {
      tail = '<p class="empty">' + (mins != null ? 'Accepted ' + mins + ' min into the session. ' : '') + (ev.resolved ? 'This counts as a successful re-solve.' : '') + '</p>';
    } else if ((S.s.tags && S.s.tags[ev.key]) || (ev.tagged && typeof ev.tagged === 'string')) {
      var tr = (S.s.tags && S.s.tags[ev.key]) || ev.tagged;
      tail = '<p class="empty">Tagged: ' + esc(S.s.reasons[tr] || tr) + '</p>';
    } else if (ev.superseded) {
      tail = '<p class="empty">You solved it afterwards, so no tag is needed.</p>';
    } else if (ev.solved) {
      tail = '<p class="empty">You had already solved this one before.</p>';
    } else if (ev.tagged) {
      tail = '<p class="empty">Already tagged earlier.</p>';
    } else {
      tail = '<div class="qlabel">Why did it fail? The highlighted reason is my guess from the verdict.</div>' + chipsHtml(ev.key, ev.suggest, ev.sub);
    }
    return (
      '<div class="item"><div class="item-top"><div class="badge ' + (ok ? 'ok' : 'bad') + '">' + esc(verdictLabel(ev.verdict)) + '</div>' +
      '<div class="item-main"><a href="' + esc(ev.url) + '" target="_blank" rel="noopener">' + esc(ev.name) + '</a><div class="meta">' + esc(ev.label) + (ev.rating ? ' · rated ' + ev.rating : '') + esc(test) + '</div></div>' +
      '<div class="item-end">' + esc(fmtAgo(ev.at)) + '</div></div>' + tail + '</div>'
    );
  }

  function liveCard() {
    var sess = getSession();
    if (!sess) return '';
    var evs = (sess.events || []).slice().reverse().slice(0, 8);
    var watchable = sess.key.indexOf('ac:') !== 0;
    var status;
    if (!watchable) {
      status = 'This is an AtCoder problem. Live watching works for Codeforces only. After you submit, press Sync now.';
    } else if (S.watchErr) {
      status = 'Could not check Codeforces: ' + esc(S.watchErr);
    } else {
      status = 'Watching your Codeforces submissions every 30 seconds. ' + (S.lastCheck ? 'Last check <span id="lastcheck" data-at="' + S.lastCheck + '">' + esc(fmtAgo(S.lastCheck)) + '</span>.' : 'First check in a moment.');
    }
    return (
      '<section class="card"><div class="panel-head"><div class="label">Live session</div>' +
      (watchable ? '<button class="btn small" data-action="check"' + (S.watching ? ' disabled' : '') + '>' + (S.watching ? 'Checking…' : 'Check now') + '</button>' : '') + '</div>' +
      '<p class="empty">' + status + '</p>' +
      (evs.length
        ? '<div class="list">' + evs.map(eventRow).join('') + '</div>'
        : watchable ? '<p class="empty">Submit on Codeforces as usual. Your verdicts will show up here, and a failed one asks you why.</p>' : '') +
      '</section>'
    );
  }

  function goalCard() {
    var g = S.s.goal;
    var head = '<div class="label">Goal</div>';
    if (!g) {
      return (
        '<section class="card">' + head + '<h3 style="font-size:22px;font-weight:700">Set a target</h3>' +
        '<p class="empty">Solve a number of problems on Codeforces and AtCoder by a date. Only problems solved from today count.</p>' +
        '<div class="btnrow" style="align-items:flex-end"><div class="field"><label for="goalTarget">Problems</label><input id="goalTarget" type="number" min="1" max="2000" value="' + esc(S.gt) + '"></div>' +
        '<div class="field"><label for="goalDate">Deadline</label><input id="goalDate" type="date" value="' + esc(S.gd) + '"></div></div>' +
        '<div class="btnrow"><button class="btn primary" data-action="goal-set">Set goal</button></div></section>'
      );
    }
    var status;
    if (g.reached) status = 'Goal reached. Nice work.';
    else if (g.expired) status = 'The deadline passed with ' + g.remaining + ' to go.';
    else status = g.daysLeft + ' day' + (g.daysLeft === 1 ? '' : 's') + ' left. About ' + g.perDay + ' per day to finish on time.';
    return (
      '<section class="card">' + head + '<div style="display:flex;align-items:baseline;gap:10px"><div class="goalnum">' + g.done + '</div><div class="muted">of ' + g.target + ' problems by ' + esc(fmtDay(g.deadline)) + '</div></div>' +
      '<div class="goalbar" role="progressbar" aria-valuenow="' + g.pct + '" aria-valuemin="0" aria-valuemax="100"><div style="width:' + g.pct + '%"></div></div>' +
      '<p class="empty">' + esc(status) + '</p><div class="btnrow"><button class="btn small" data-action="goal-clear">' + (g.reached || g.expired ? 'Set a new goal' : 'Clear goal') + '</button></div></section>'
    );
  }

  function recPanel() {
    var body;
    var sub = '';
    if (!S.rec) {
      body = '<p class="empty">Picking problems…</p>';
    } else if (S.rec.error) {
      body = '<p class="empty" style="color:var(--amber)">' + esc(S.rec.error) + '</p>';
    } else if (!S.rec.items.length) {
      body = '<p class="empty">No problems found in this range.</p>';
    } else {
      sub = '<span class="ptag">rated ' + S.rec.target.lo + ' to ' + S.rec.target.hi + '</span>';
      body =
        '<div class="list cols">' +
        S.rec.items
          .map(function (r) {
            return (
              '<div class="item"><div class="item-top"><div class="badge">' + r.rating + '</div><div class="item-main"><a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.name) + '</a>' +
              '<div class="meta">' + esc(r.why) + (r.tags.length ? ' · ' + esc(r.tags.slice(0, 2).join(', ')) : '') + '</div></div></div></div>'
            );
          })
          .join('') +
        '</div>';
    }
    return '<section class="card"><div class="panel-head"><div class="label">Recommended · Codeforces</div>' + sub + '</div>' + body + '</section>';
  }

  function pagePractice() {
    return (
      pgHead('02 — PRACTICE', 'Train in', 'CP Mode', 'One task at a time. Submit on the contest site and the app picks up the verdict.') +
      statusBar() + banners() +
      '<div class="grid21"><div class="stack">' + rightNowCard() + liveCard() + '</div><div class="stack">' + goalCard() + '</div></div>' +
      recPanel()
    );
  }

  // ======================= PAGE 3: REVIEW =======================
  function failuresPanel() {
    var s = S.s;
    var max = s.failures.length ? s.failures[0].count : 0;
    var body;
    if (!s.taggedLast30) {
      body = '<p class="empty">No tags yet. Tag a failed problem and your pattern will show up here. This chart is the most valuable thing in the app.</p>';
    } else {
      var bars = s.failures
        .map(function (f, i) {
          var isTop = i === 0 && f.count > (s.failures[1] ? s.failures[1].count : 0);
          return barRow(f.label, f.count, max, isTop ? 'amber' : '', '', isTop);
        })
        .join('');
      var byKey = {};
      s.failures.forEach(function (f) {
        byKey[f.reason] = f.count;
      });
      var insight =
        byKey.bug > byKey.no_idea
          ? 'Implementation bugs beat "didn\'t see the idea" ' + byKey.bug + ' to ' + byKey.no_idea + '. Practice writing clean code, not just learning new topics.'
          : 'Most common cause: ' + s.failures[0].label.toLowerCase() + ' (' + s.failures[0].count + ' of ' + s.taggedLast30 + ').';
      body = '<div class="bars">' + bars + '</div><div class="note">' + esc(insight) + '</div>';
    }
    var weak = s.weakTags.length ? '<p class="empty">Weakest Codeforces topics: ' + s.weakTags.map(function (t) { return esc(t.tag); }).join(', ') + '.</p>' : '';
    return '<section class="card"><div class="panel-head"><div class="label">Why you fail · last 30 days</div><span class="ptag">' + s.taggedLast30 + ' tagged</span></div>' + body + weak + '</section>';
  }

  function inboxPanel() {
    var rs = S.s.reasons;
    return '<section class="card"><div class="panel-head"><div class="label">Log a failure</div></div>' +
      '<p class="empty">Nothing is pulled in automatically. You decide what to log.</p>' +
      '<div class="flform"><input id="flName" type="text" placeholder="Problem name or link" autocomplete="off">' +
      '<input id="flRating" type="number" placeholder="Rating (optional)">' +
      '<select id="flReason">' + Object.keys(rs).map(function (r) { return '<option value="' + r + '">' + esc(rs[r]) + '</option>'; }).join('') + '</select>' +
      '<button class="btn primary" data-action="fl-save">Save and schedule re-solve</button></div></section>';
  }

  function queuePanel() {
    var s = S.s;
    var now = Date.now();
    var body;
    if (!s.queue.length) {
      body = '<p class="empty">Empty. When you tag a failed problem it comes back after 3, 10 and 30 days so you re-solve it from scratch.</p>';
    } else {
      body =
        '<div class="list cols">' +
        s.queue
          .map(function (q) {
            var due = q.due <= now;
            return (
              '<div class="item' + (due ? ' due' : '') + '"><div class="item-top"><div class="badge">' + esc(q.stageLabel) + '</div>' +
              '<div class="item-main"><a href="' + esc(q.url) + '" target="_blank" rel="noopener">' + esc(q.name) + '</a><div class="meta">' + (q.rating ? 'rated ' + q.rating : 'unrated') + ' · ' + esc(PLAT[q.platform]) +
              (q.reasonLabel ? ' · ' + esc(q.reasonLabel) : '') + '</div></div>' +
              '<div class="item-end">' + (due ? 'DUE NOW' : esc(fmtDay(q.due))) + '</div></div>' +
              (due
                ? '<div class="btnrow"><button class="btn small" data-action="resolve" data-key="' + esc(q.key) + '" data-result="solved">Solved it</button><button class="btn small" data-action="resolve" data-key="' + esc(q.key) + '" data-result="failed">Failed again</button><button class="btn small" data-action="resolve" data-key="' + esc(q.key) + '" data-result="dismiss">Drop it</button></div>'
                : '') + '</div>'
            );
          })
          .join('') +
        '</div>';
    }
    return '<section class="card"><div class="panel-head"><div class="label">Re-solve queue</div><span class="ptag">' + s.queue.length + ' scheduled · ' + s.dueCount + ' due</span></div>' + body + '</section>';
  }

  function pageReview() {
    return (
      pgHead('03 — REVIEW', 'Why You', 'Fail', 'Tag every failure. Failed problems come back after 3, 10 and 30 days to be solved from scratch.') +
      statusBar() + banners() +
      '<div class="grid2">' + failuresPanel() + inboxPanel() + '</div>' + queuePanel()
    );
  }

  // ======================= PAGE 4: CONTESTS =======================
  function nextContestCard() {
    var c = nextContest();
    var head = '<div class="label">Next contest</div>';
    if (!S.contests) return '<section class="card">' + head + '<p class="empty">Loading contests…</p></section>';
    if (!c) return '<section class="card">' + head + '<p class="empty">No upcoming contests could be loaded.</p>' + errorLines() + '</section>';
    var live = c.start <= Date.now();
    return (
      '<section class="card hot">' + head +
      '<div style="display:flex;flex-direction:column;gap:10px;align-items:flex-start"><span class="plat ' + c.platform + '">' + esc(PLAT[c.platform].toUpperCase()) + '</span>' +
      '<h2 style="font-size:clamp(24px,3.4vw,34px);font-weight:700;line-height:1.2">' + esc(c.name) + '</h2>' +
      '<div class="mono muted" style="font-size:13px">' + esc(fmtWhen(c.start)) + ' · ' + esc(fmtDur(c.start, c.end)) + '</div></div>' +
      '<div class="big-count" id="countdown" data-start="' + c.start + '" data-end="' + c.end + '">' + (live ? 'LIVE' : fmtClock(c.start - Date.now())) + '</div>' +
      '<div class="btnrow"><a class="btn amber" href="' + esc(c.url) + '" target="_blank" rel="noopener">Register / Open</a><button class="btn" data-action="ics" data-idx="0">Add to calendar</button></div>' +
      '<p class="empty">The calendar file adds alerts 1 day, 1 hour and 10 minutes before the start. Registration is done on the contest site.</p></section>'
    );
  }

  function contestsPanel() {
    var body;
    if (!S.contests) {
      body = '<p class="empty">Loading contests…</p>';
    } else if (!S.contests.contests.length) {
      body = '<p class="empty">No upcoming contests loaded.</p>' + errorLines();
    } else {
      body =
        '<div class="list">' +
        S.contests.contests
          .slice(0, 12)
          .map(function (c, i) {
            var live = c.start <= Date.now();
            return (
              '<div class="crow"><div class="cmain"><span class="plat ' + c.platform + '">' + esc(PLAT[c.platform].toUpperCase()) + '</span><div class="cname">' + esc(c.name) + '</div>' +
              '<div class="cwhen">' + esc(fmtWhen(c.start)) + ' · ' + esc(fmtDur(c.start, c.end)) + ' · <span data-rel-start="' + c.start + '" data-rel-end="' + c.end + '">' + (live ? 'live now' : esc(fmtRel(c.start - Date.now()))) + '</span></div></div>' +
              '<div class="cacts"><button class="btn small" data-action="ics" data-idx="' + i + '">Add to calendar</button><a class="btn small" href="' + esc(c.url) + '" target="_blank" rel="noopener">Open</a></div></div>'
            );
          })
          .join('') +
        '</div>' + errorLines();
    }
    return '<section class="card"><div class="panel-head"><div class="label">All upcoming · Codeforces, AtCoder, CodeChef</div><button class="btn small" data-action="refresh-contests">Refresh</button></div>' + body + '</section>';
  }

  function pageContests() {
    return pgHead('04 — CONTESTS', 'Upcoming', 'Contests', 'Codeforces, AtCoder and CodeChef in your local time.') + nextContestCard() + contestsPanel();
  }

  // ======================= the whole page =======================
  function navHtml(page) {
    var s = S.s;
    var badge = s ? s.dueCount + s.inboxTotal : 0;
    return PAGES.map(function (p) {
      var on = p === page;
      return (
        '<a href="#/' + p + '" class="navitem' + (on ? ' on' : '') + '"' + (on ? ' aria-current="page"' : '') + '>' + PAGE_TITLE[p] +
        (p === 'review' && badge ? '<span class="nbadge" aria-label="' + badge + ' items need attention">' + badge + '</span>' : '') + '</a>'
      );
    }).join('');
  }

  function render() {
    var page = currentPage();
    document.getElementById('nav').innerHTML = navHtml(page);
    document.title = 'CP Mode · ' + PAGE_TITLE[page];
    var app = document.getElementById('app');
    if (!S.s) {
      app.innerHTML = banners() || '<p class="muted">Loading…</p>';
      return;
    }
    var html = page === 'practice' ? pagePractice() : page === 'review' ? pageReview() : page === 'contests' ? pageContests() : pageDashboard();
    app.innerHTML = html;
    tick();
  }

  // ---------- once-per-second updates (no full redraw) ----------
  function tick() {
    var now = Date.now();
    var cd = document.getElementById('countdown');
    if (cd) {
      var st = +cd.getAttribute('data-start');
      var en = +cd.getAttribute('data-end');
      cd.textContent = now >= en ? 'ENDED' : now >= st ? 'LIVE' : fmtClock(st - now);
    }
    var timer = document.getElementById('timer');
    if (timer && timer.getAttribute('data-start')) {
      var left = +timer.getAttribute('data-start') + SESSION_MIN * 60000 - now;
      timer.textContent = left > 0 ? fmtClock(left) : 'TIME UP';
      timer.style.color = left > 0 ? 'var(--cyan)' : 'var(--amber)';
    }
    var synced = document.getElementById('synced');
    if (synced && +synced.getAttribute('data-at')) synced.textContent = 'Synced ' + fmtAgo(+synced.getAttribute('data-at'));
    var lc = document.getElementById('lastcheck');
    if (lc) lc.textContent = fmtAgo(+lc.getAttribute('data-at'));
    var rels = document.querySelectorAll('[data-rel-start]');
    for (var i = 0; i < rels.length; i++) {
      var a = +rels[i].getAttribute('data-rel-start');
      var b = +rels[i].getAttribute('data-rel-end');
      rels[i].textContent = now >= b ? 'ended' : now >= a ? 'live now' : fmtRel(a - now);
    }
  }

  // ---------- loading data ----------
  function loadState() {
    return api('/api/state')
      .then(function (j) {
        S.s = j;
        S.loadError = null;
        render();
      })
      .catch(function (e) {
        S.loadError = 'Could not load your data: ' + e.message;
        render();
      });
  }
  function loadContests(force) {
    return api('/api/contests' + (force ? '?force=1' : ''))
      .then(function (j) {
        S.contests = j;
        render();
      })
      .catch(function (e) {
        S.contests = { contests: [], errors: { cf: e.message, ac: null, cc: null } };
        render();
      });
  }
  function loadRec() {
    return api('/api/recommend')
      .then(function (j) {
        if (j.items) j.items = j.items.filter(function (i) { return SKIP.indexOf('cf:' + i.label) < 0; });
        S.rec = j;
        render();
      })
      .catch(function (e) {
        S.rec = { error: e.message, items: [] };
        render();
      });
  }
  function doSync() {
    if (S.syncing) return Promise.resolve();
    S.syncing = true;
    S.fatal = null;
    render();
    return api('/api/sync', 'POST')
      .catch(function (e) {
        S.fatal = 'Sync failed: ' + e.message;
      })
      .then(function () {
        S.syncing = false;
        return loadState();
      })
      .then(function () {
        return loadRec();
      });
  }

  // ---------- live watch: checks Codeforces while a CP Mode session is running ----------
  function pollWatch() {
    var sess = getSession();
    if (!sess || S.watching || sess.key.indexOf('ac:') === 0) return Promise.resolve();
    if (Date.now() - sess.start > 4 * 3600000) {
      setSession(null);
      render();
      return Promise.resolve();
    }
    S.watching = true;
    render();
    return api('/api/watch', 'POST', {})
      .then(function (j) {
        S.watchErr = j.error || null;
        if (!j.error && !j.busy) S.lastCheck = Date.now();
        var cur = getSession();
        var evs = (j.events || []).filter(function (ev) {
          return cur && ev.at >= cur.start - 5000;
        });
        if (cur && evs.length) {
          var all = (cur.events || []).concat(evs);
          evs.forEach(function (ev) {
            if (ev.verdict === 'OK') {
              all.forEach(function (o) {
                if (o.key === ev.key && o.verdict !== 'OK' && o.sub !== ev.sub) o.superseded = true;
              });
            }
          });
          if (evs.some(function (ev) { return ev.verdict === 'OK' && ev.key === cur.key; })) cur.done = true;
          cur.events = all.slice(-30);
          setSession(cur);
        }
        return j.events && j.events.length ? loadState() : null;
      })
      .catch(function (e) {
        S.watchErr = e.message;
      })
      .then(function () {
        S.watching = false;
        render();
      });
  }

  // ---------- clicks ----------
  function tagThen(key, reason, sub) {
    return api('/api/tag', 'POST', { key: key, reason: reason })
      .then(function () {
        if (sub) {
          var cur = getSession();
          if (cur && cur.events) {
            cur.events.forEach(function (ev) {
              if (String(ev.sub) === String(sub)) ev.tagged = reason;
            });
            setSession(cur);
          }
        }
        return loadState();
      })
      .catch(function (e) {
        S.fatal = 'Could not save: ' + e.message;
        render();
      });
  }

  document.addEventListener('input', function (ev) {
    if (ev.target.id === 'goalTarget') S.gt = ev.target.value;
    if (ev.target.id === 'goalDate') S.gd = ev.target.value;
  });

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-action]');
    if (!el) return;
    var act = el.getAttribute('data-action');
    var key = el.getAttribute('data-key');

    if (act === 'sync') return void doSync();
    if (act === 'refresh-contests') return void loadContests(true);
    if (act === 'check') return void pollWatch();
    if (act === 'mode') {
      S.mode = el.getAttribute('data-mode');
      return void render();
    }
    if (act === 'ics') {
      var c = S.contests && S.contests.contests[+el.getAttribute('data-idx')];
      if (c) downloadIcs(c);
      return;
    }
    if (act === 'enter') {
      setSession({ key: key, start: Date.now(), events: [] });
      S.watchErr = null;
      S.lastCheck = null;
      window.open(el.getAttribute('data-url'), '_blank', 'noopener');
      return void render();
    }
    if (act === 'endsession' || act === 'nextprob') {
      var cs = getSession();
      if (cs) SKIP.push(cs.key);
      setSession(null);
      S.rec = null;
      render();
      return void loadRec();
    }
    if (act === 'newrec') {
      if (S.rec && S.rec.items && S.rec.items.length) SKIP.push('cf:' + S.rec.items.shift().label);
      if (!S.rec || !S.rec.items || !S.rec.items.length) { S.rec = null; render(); return void loadRec(); }
      return void render();
    }
    if (act === 'fl-save') {
      var nm = document.getElementById('flName');
      return void api('/api/failure', 'POST', { name: nm.value, rating: document.getElementById('flRating').value, reason: document.getElementById('flReason').value })
        .then(loadState)
        .catch(function (e) { S.fatal = e.message; render(); });
    }
    if (act === 'tag') return void tagThen(key, el.getAttribute('data-reason'), null);
    if (act === 'evtag') return void tagThen(key, el.getAttribute('data-reason'), el.getAttribute('data-sub'));
    if (act === 'resolve') {
      return void api('/api/resolve', 'POST', { key: key, result: el.getAttribute('data-result') })
        .then(loadState)
        .catch(function (e) {
          S.fatal = 'Could not save: ' + e.message;
          render();
        });
    }
    if (act === 'goal-set') {
      var t = document.getElementById('goalTarget');
      var d = document.getElementById('goalDate');
      return void api('/api/goal', 'POST', { target: t ? t.value : S.gt, deadline: d ? d.value : S.gd })
        .then(function () {
          S.fatal = null;
          return loadState();
        })
        .catch(function (e) {
          S.fatal = e.message;
          render();
        });
    }
    if (act === 'goal-clear') {
      return void api('/api/goal', 'POST', { clear: true })
        .then(function () {
          S.fatal = null;
          return loadState();
        })
        .catch(function (e) {
          S.fatal = e.message;
          render();
        });
    }
  });

  window.addEventListener('hashchange', function () {
    render();
    window.scrollTo(0, 0);
  });

  // ---------- start ----------
  render();
  loadState().then(function () {
    loadContests();
    loadRec();
    if (S.s && (!S.s.lastSync || Date.now() - S.s.lastSync > 3 * 3600000)) doSync();
  });
  setInterval(tick, 1000);
  setInterval(pollWatch, 30000);
  setInterval(function () {
    loadContests();
  }, 15 * 60000);
})();
