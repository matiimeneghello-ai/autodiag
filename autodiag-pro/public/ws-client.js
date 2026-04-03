/**
 * WebSocket Client — AutoDiag Pro
 * Conecta el frontend al servidor Node.js en tiempo real
 */
class AutoDiagWS {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.listeners = {};
  }
  connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}`;
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.connected = true;
      this._emit('ws_connected', {});
      console.log('✓ WebSocket conectado');
    };
    this.ws.onmessage = (e) => {
      try { const m = JSON.parse(e.data); this._emit(m.type, m.payload); }
      catch(err) {}
    };
    this.ws.onclose = () => {
      this.connected = false;
      console.log('WS desconectado - reintentando en 3s');
      setTimeout(() => this.connect(), 3000);
    };
  }
  send(action, payload = {}) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ action, payload }));
  }
  on(event, cb) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }
  _emit(event, data) { (this.listeners[event] || []).forEach(cb => cb(data)); }
  readDTCs()    { this.send('read_dtcs'); }
  clearDTCs()   { this.send('clear_dtcs'); }
  startRecording(vehicleId) { this.send('start_recording', { vehicleId }); }
  stopRecording() { this.send('stop_recording'); }
}
window.ws = new AutoDiagWS();
document.addEventListener('DOMContentLoaded', () => {
  window.ws.connect();
  window.ws.on('connected', (data) => {
    if (typeof showNotif === 'function') {
      showNotif(data.sim_mode ? '⚡ Modo simulación activo' : '✓ OBD-II conectado');
    }
    if (data.live_data) updateLiveFromWS(data.live_data);
  });
  window.ws.on('live_data', updateLiveFromWS);
  window.ws.on('dtcs', (data) => {
    const el = document.querySelector('.m-red .m-val');
    if (el) el.textContent = data.codes?.length || 0;
  });
  window.ws.on('obd_disconnected', () => {
    if (typeof showNotif === 'function') showNotif('⚠ OBD-II desconectado');
  });
});
function updateLiveFromWS(data) {
  const updates = { 'lv-rpm': data.rpm?.value, 'lv-o2': data.o2_b1s1?.value, 'tempVal': data.coolant?.value ? data.coolant.value + '°' : null };
  Object.entries(updates).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el && val !== null && val !== undefined) el.textContent = val;
  });
}
