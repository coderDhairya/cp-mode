# CP // MODE

A desktop dashboard for competitive programmers. It tracks your solved problems across Codeforces, AtCoder and CodeChef, lets you log your own failure post-mortems, schedules spaced re-solving (3, 10 and 30 days), recommends problems at your level, and reviews contests.

Built with Electron (desktop window) and a small local Node.js server. Developed and tested on macOS.

## Requirements
- Node.js 18 or newer (https://nodejs.org)

## Run it as a desktop app (Electron)
```
npm install
npm start
```
Electron opens CP // MODE in its own window, not in a browser. The Electron version is pinned to 45.2.3 in `package.json`.

### If `npm start` says "Electron failed to install correctly"
Newer versions of npm can skip Electron's download step. Run it by hand once, then start again:
```
node node_modules/electron/install.js
npm start
```
If that still fails, reinstall Electron:
```
rm -rf node_modules/electron
npm install
node node_modules/electron/install.js
npm start
```
Check the download worked with `ls node_modules/electron/dist` (it should list `Electron.app` on a Mac).

## Run it in a browser instead
```
npm run web
```
Then open http://localhost:3000.

## First launch
A setup form asks for your Codeforces handle (required) and your AtCoder and CodeChef handles (optional). Reopen it any time with the **⚙ SETUP** button at the bottom-left.

## Build a Mac app
```
npm run dist
```
This creates `CP MODE.app` in `dist/`. It is not signed by Apple, so the first time you open it, right-click it and choose Open.

## Project layout
- `main.js` starts the Electron window and the local server
- `server.js` the local server and API
- `lib/` Codeforces, AtCoder and CodeChef fetching, and the app's logic
- `public/` the interface (HTML, CSS, JavaScript and the intro video)

## Privacy
Your handles and history are saved only on your computer, in the app's data folder. Nothing is uploaded anywhere except normal requests to the Codeforces, AtCoder and CodeChef websites. Nothing personal is committed to this repo.