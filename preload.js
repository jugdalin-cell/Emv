import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('cardReader', {
  // PC/SC Methods
  initPCSC: () => ipcRenderer.invoke('pcsc:init'),
  listReaders: () => ipcRenderer.invoke('pcsc:listReaders'),
  connectCard: (readerName) => ipcRenderer.invoke('pcsc:cardConnect', readerName),
  sendAPDU: (readerName, apduHex) => ipcRenderer.invoke('pcsc:sendAPDU', readerName, apduHex),
  disconnectCard: (readerName) => ipcRenderer.invoke('pcsc:cardDisconnect', readerName),
  getReaderStatus: (readerName) => ipcRenderer.invoke('pcsc:getReaderStatus', readerName),

  // Event Listeners
  onCardInserted: (callback) => ipcRenderer.on('card:inserted', (event, data) => callback(data)),
  onCardRemoved: (callback) => ipcRenderer.on('card:removed', (event, data) => callback(data)),
  onReaderError: (callback) => ipcRenderer.on('reader:error', (event, data) => callback(data)),
  onReaderDisconnected: (callback) => ipcRenderer.on('reader:disconnected', (event, data) => callback(data))
});
