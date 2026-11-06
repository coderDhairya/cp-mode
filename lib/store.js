// Everything you do is saved in one file: data/data.json (on your own computer).

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.CP_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'data.json');

function empty() {
  return {
    problems: {}, // key -> problem you have attempted (platform, name, rating, solved, ...)
    tags: {}, // key -> { reason, at }   (your post-mortem tag)
    resolves: {}, // key -> { stage, due, done, history }   (re-solve schedule)
    ratings: {}, // ratings.ac = { rating, max, contests }
    cc: null, // CodeChef profile numbers: { solved, rating, max, stars, at }
    goal: null, // { target, deadline, start, base }
    cfRating: null,
    cfMaxRating: null,
    cfMaxSubId: 0, // newest Codeforces submission the app has already counted
    lastSync: null,
    syncReport: null,
  };
}

function load() {
  try {
    return Object.assign(empty(), JSON.parse(fs.readFileSync(FILE, 'utf8')));
  } catch (e) {
    return empty();
  }
}

function save(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, FILE);
}

module.exports = { load, save, DATA_DIR };
