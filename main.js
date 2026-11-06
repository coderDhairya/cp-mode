const { app, BrowserWindow, Menu, session, shell } = require('electron');
const path = require('path');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
process.env.NO_OPEN = '1';
process.env.CP_DATA_DIR = process.env.CP_DATA_DIR || path.join(app.getPath('userData'), 'data');
require('./server.js');
const port = process.env.PORT || require('./config.json').port || 3000;

function createWindow() {
  const w = new BrowserWindow({
    width: 1440, height: 920, minWidth: 980, minHeight: 640,
    backgroundColor: '#02070d', title: 'CP // MODE',
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 12 },
  });
  const load = (n) => w.loadURL('http://localhost:' + port).catch(() => { if (n > 0) setTimeout(() => load(n - 1), 400); });
  load(25);
  w.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'media'));
  // No "Window" menu on purpose: that frees Cmd+M for the hold-to-talk shortcut.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'CP MODE', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }] },
  ]));
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
