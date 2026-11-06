# CP // MODE

A desktop dashboard for competitive programmers: solved counts across Codeforces, AtCoder and CodeChef, failure post-mortems you log yourself, spaced re-solving (3, 10, 30 days), problem recommendations, contest review, and a voice coach.

## Run it
1. Install Node.js 18+ from nodejs.org.
2. `npm install`
3. `npm start` (desktop app) or `npm run web` and open http://localhost:3000

On first launch a setup form asks for your Codeforces handle (required), AtCoder and CodeChef handles (optional), and an optional Gemini API key. Use **Test Gemini** to check the key. If the test says the model is not available, change the model name in the form to the one Google's message suggests. Reopen the form any time with **⚙ SETUP**.

If `npm start` says Electron failed to install, run `node node_modules/electron/install.js` once, then `npm start`.

## Voice coach
Hold Cmd+M (or Ctrl+M) and speak, release to send. The panel opens on its own; close it with the ✕ or Esc. A daily briefing plays on your first visit each day. The desktop app needs a Gemini key for voice and microphone permission. Without a key, typed questions get simple built-in answers.

## Privacy
Your handles, key and history are saved only on your computer (the app's data folder). Nothing is committed to this repo.

## Build a Mac app
`npm run dist` creates `CP MODE.app` in `dist/`.
