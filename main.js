const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs/promises');

// Windows 7 (NT 6.1): con ciertos drivers de video la aceleración por GPU da pantallas en blanco
if (process.platform === 'win32' && os.release().startsWith('6.1')) app.disableHardwareAcceleration();

// Protocolo propio "app://" para servir los archivos locales (necesario para pdf.js: cmaps, fuentes, worker)
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

let win = null;
let dirty = false;
let forceClose = false;
const send = (action) => win && win.webContents.send('menu', action);

async function readFile(p) {
  return { path: p, name: path.basename(p), data: await fs.readFile(p) };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: '#f3f4f6',
    title: 'Editor PDF',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL('app://local/src/index.html');

  win.on('close', (e) => {
    if (!dirty || forceClose) return;
    e.preventDefault();
    const r = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Guardar', 'No guardar', 'Cancelar'],
      defaultId: 0,
      cancelId: 2,
      message: 'Hay cambios sin guardar',
      detail: '¿Desea guardar el PDF antes de salir?',
    });
    if (r === 0) send('save-then-close');
    else if (r === 1) { forceClose = true; win.close(); }
  });

  // Abrir un PDF pasado por línea de comandos ("Abrir con…")
  win.webContents.on('did-finish-load', async () => {
    const args = process.argv.slice(app.isPackaged ? 1 : 2);
    const pdf = args.find((a) => /\.pdf$/i.test(a));
    if (pdf) {
      try { win.webContents.send('open-file', await readFile(pdf)); } catch (e) { /* ignorar */ }
    }
  });
}

function buildMenu() {
  const template = [
    {
      label: 'Archivo',
      submenu: [
        { label: 'Nuevo', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: 'Abrir…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { label: 'Guardar', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: 'Guardar como…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('saveas') },
        { type: 'separator' },
        { label: 'Insertar páginas desde PDF…', click: () => send('insertpdf') },
        { label: 'Imprimir…', accelerator: 'CmdOrCtrl+P', click: () => send('print') },
        { type: 'separator' },
        { role: 'quit', label: 'Salir' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { label: 'Acercar', accelerator: 'CmdOrCtrl+=', click: () => send('zoomin') },
        { label: 'Alejar', accelerator: 'CmdOrCtrl+-', click: () => send('zoomout') },
        { label: 'Tamaño real', accelerator: 'CmdOrCtrl+0', click: () => send('zoomreset') },
        { label: 'Ajustar al ancho', click: () => send('fit') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
        { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
      ],
    },
    {
      label: 'Ayuda',
      submenu: [
        { label: 'Atajos de teclado', accelerator: 'F1', click: () => send('help') },
        {
          label: 'Acerca de',
          click: () => dialog.showMessageBox(win, { type: 'info', message: 'Editor PDF', detail: 'Versión ' + app.getVersion() + '\nCompatible con Windows 7 o superior.' }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  protocol.registerFileProtocol('app', (request, callback) => {
    try {
      const rel = decodeURIComponent(new URL(request.url).pathname);
      const full = path.normalize(path.join(__dirname, rel));
      if (!full.startsWith(__dirname)) return callback({ error: -10 });
      callback({ path: full });
    } catch (e) { callback({ error: -2 }); }
  });

  ipcMain.handle('open-pdf', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    return r.canceled ? null : readFile(r.filePaths[0]);
  });
  const IMG = [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }];
  ipcMain.handle('open-image', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: IMG });
    return r.canceled ? null : readFile(r.filePaths[0]);
  });
  ipcMain.handle('open-images', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: IMG });
    return r.canceled ? null : Promise.all(r.filePaths.map(readFile));
  });
  ipcMain.handle('read-path', async (_e, p) => {
    if (typeof p !== 'string' || !/\.pdf$/i.test(p)) return null;
    return readFile(p);
  });
  ipcMain.handle('save-pdf', async (_e, { path: p, name, data }) => {
    if (!p) {
      const r = await dialog.showSaveDialog(win, { defaultPath: name || 'documento.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (r.canceled) return null;
      p = r.filePath;
      if (!/\.pdf$/i.test(p)) p += '.pdf';
    }
    await fs.writeFile(p, Buffer.from(data));
    return { path: p, name: path.basename(p) };
  });
  ipcMain.handle('save-file', async (_e, { name, label, ext, data }) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: label, extensions: [ext] }] });
    if (r.canceled) return null;
    let p = r.filePath;
    if (!p.toLowerCase().endsWith('.' + ext)) p += '.' + ext;
    await fs.writeFile(p, Buffer.from(data));
    return { path: p, name: path.basename(p) };
  });
  // Imprimir: se abre una copia temporal en el visor de PDF del sistema
  ipcMain.handle('print-pdf', async (_e, { name, data }) => {
    const file = path.join(os.tmpdir(), 'editor-pdf-' + Date.now() + '-' + String(name || 'documento.pdf').replace(/[^\w.\- ]/g, '_'));
    await fs.writeFile(file, Buffer.from(data));
    return shell.openPath(file); // '' si salió bien
  });
  ipcMain.on('set-dirty', (_e, v) => { dirty = !!v; });
  ipcMain.on('close-now', () => { forceClose = true; if (win) win.close(); });

  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
