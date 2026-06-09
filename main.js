import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pcsclite from 'pcsclite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow;
let pcsc = null;
let readers = [];
let readerStates = {};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile('index.html');

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (pcsc) {
      pcsc.close();
    }
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Initialize PC/SC
function initPCSC() {
  return new Promise((resolve, reject) => {
    try {
      pcsc = pcsclite();

      pcsc.on('reader_init', (reader) => {
        console.log('Reader detected:', reader.name);
        readers.push(reader.name);

        reader.on('status', (status) => {
          const changes = reader.state ^ status.state;
          
          if (changes & reader.SCARD_STATE_PRESENT) {
            if (status.state & reader.SCARD_STATE_PRESENT) {
              console.log('Card inserted:', reader.name);
              mainWindow?.webContents.send('card:inserted', { reader: reader.name });
            } else {
              console.log('Card removed:', reader.name);
              mainWindow?.webContents.send('card:removed', { reader: reader.name });
            }
          }

          reader.state = status.state;
        });

        reader.on('error', (err) => {
          console.error('Reader error:', err);
          mainWindow?.webContents.send('reader:error', { reader: reader.name, error: err.message });
        });

        reader.on('end', () => {
          console.log('Reader removed:', reader.name);
          readers = readers.filter(r => r !== reader.name);
          mainWindow?.webContents.send('reader:disconnected', { reader: reader.name });
        });

        readerStates[reader.name] = reader;
      });

      pcsc.on('reader_end', (reader) => {
        console.log('Reader disconnected:', reader.name);
        delete readerStates[reader.name];
      });

      pcsc.on('error', (err) => {
        console.error('PC/SC error:', err.message);
        reject(err);
      });

      // Give it a moment to initialize
      setTimeout(() => resolve(true), 500);
    } catch (err) {
      console.error('Failed to initialize PC/SC:', err.message);
      reject(err);
    }
  });
}

// IPC Handlers
ipcMain.handle('pcsc:init', async () => {
  try {
    await initPCSC();
    return { success: true, readers };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('pcsc:listReaders', async () => {
  return { readers: Object.keys(readerStates) };
});

ipcMain.handle('pcsc:cardConnect', async (event, readerName) => {
  try {
    const reader = readerStates[readerName];
    if (!reader) {
      throw new Error('Reader not found');
    }

    return new Promise((resolve, reject) => {
      reader.connect({ share_mode: reader.SCARD_SHARE_SHARED }, (err, protocol) => {
        if (err) {
          reject(new Error('Failed to connect: ' + err.message));
        } else {
          resolve({ 
            success: true, 
            protocol,
            reader: readerName,
            atr: reader.atr ? reader.atr.toString('hex').toUpperCase() : 'N/A'
          });
        }
      });
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('pcsc:sendAPDU', async (event, readerName, apduHex) => {
  try {
    const reader = readerStates[readerName];
    if (!reader) {
      throw new Error('Reader not found');
    }

    if (!reader.connected) {
      throw new Error('Card not connected');
    }

    const apduBuffer = Buffer.from(apduHex, 'hex');

    return new Promise((resolve, reject) => {
      reader.transmit(apduBuffer, 258, (err, data) => {
        if (err) {
          reject(new Error('APDU transmission failed: ' + err.message));
        } else {
          resolve({
            success: true,
            response: data.toString('hex').toUpperCase(),
            sw: data.slice(-2).toString('hex').toUpperCase()
          });
        }
      });
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('pcsc:cardDisconnect', async (event, readerName) => {
  try {
    const reader = readerStates[readerName];
    if (!reader) {
      throw new Error('Reader not found');
    }

    return new Promise((resolve, reject) => {
      reader.disconnect(reader.SCARD_LEAVE_CARD, (err) => {
        if (err) {
          reject(new Error('Disconnect failed: ' + err.message));
        } else {
          resolve({ success: true });
        }
      });
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('pcsc:getReaderStatus', async (event, readerName) => {
  try {
    const reader = readerStates[readerName];
    if (!reader) {
      return { success: false, error: 'Reader not found' };
    }

    return new Promise((resolve) => {
      reader.checkStatus((err, status) => {
        if (err) {
          resolve({ success: false, error: err.message });
        } else {
          resolve({
            success: true,
            status: {
              name: readerName,
              cardPresent: !!(status.state & reader.SCARD_STATE_PRESENT),
              eventCounter: status.eventCounter,
              atr: status.atr ? status.atr.toString('hex').toUpperCase() : null
            }
          });
        }
      });
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
});
