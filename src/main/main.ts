import path from 'node:path';
import { app, BrowserWindow } from 'electron';

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: '#08111f',
    show: false,
    title: 'Glass Chess',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  void window.loadFile(path.join(__dirname, '../renderer/index.html'));

  return window;
}

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
