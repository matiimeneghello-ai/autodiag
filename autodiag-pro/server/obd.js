/**
 * OBD-II / ELM327 Connection Manager
 * Soporta: WiFi TCP, Bluetooth Serial, USB Serial, Modo Simulación
 */

const net    = require('net');
const { EventEmitter } = require('events');

// PID definitions — parámetros OBD-II estándar
const PIDS = {
  '010C': { name: 'rpm',        label: 'RPM',              unit: 'rpm',  parse: d => ((parseInt(d[0],16)*256 + parseInt(d[1],16)) / 4) },
  '010D': { name: 'speed',      label: 'Velocidad',        unit: 'km/h', parse: d => parseInt(d[0],16) },
  '0105': { name: 'coolant',    label: 'Temp. Refrigerante', unit: '°C', parse: d => parseInt(d[0],16) - 40 },
  '010F': { name: 'intake_temp',label: 'Temp. Admisión',   unit: '°C',  parse: d => parseInt(d[0],16) - 40 },
  '0111': { name: 'throttle',   label: 'Posición Mariposa',unit: '%',   parse: d => Math.round(parseInt(d[0],16) * 100 / 255) },
  '010B': { name: 'map',        label: 'Presión MAP',      unit: 'kPa', parse: d => parseInt(d[0],16) },
  '0110': { name: 'maf',        label: 'Flujo MAF',        unit: 'g/s', parse: d => ((parseInt(d[0],16)*256 + parseInt(d[1],16)) / 100) },
  '0106': { name: 'fuel_trim_short', label: 'Fuel Trim Corto', unit: '%', parse: d => ((parseInt(d[0],16) - 128) * 100 / 128).toFixed(1) },
  '0107': { name: 'fuel_trim_long',  label: 'Fuel Trim Largo',  unit: '%', parse: d => ((parseInt(d[0],16) - 128) * 100 / 128).toFixed(1) },
  '0114': { name: 'o2_b1s1',   label: 'O2 Sensor B1S1',   unit: 'V',   parse: d => (parseInt(d[0],16) * 0.005).toFixed(3) },
  '0115': { name: 'o2_b1s2',   label: 'O2 Sensor B1S2',   unit: 'V',   parse: d => (parseInt(d[0],16) * 0.005).toFixed(3) },
  '0142': { name: 'voltage',    label: 'Voltaje Módulo',   unit: 'V',   parse: d => ((parseInt(d[0],16)*256 + parseInt(d[1],16)) / 1000).toFixed(2) },
  '0104': { name: 'engine_load',label: 'Carga Motor',      unit: '%',   parse: d => Math.round(parseInt(d[0],16) * 100 / 255) },
  '010E': { name: 'timing',     label: 'Avance Encendido', unit: '°',   parse: d => (parseInt(d[0],16) / 2 - 64).toFixed(1) },
};

// PIDs a consultar en el loop principal (orden optimizado)
const POLL_PIDS = ['010C','010D','0105','0111','010B','0110','0106','0107','0114','0142','0104','010E'];

class OBDManager extends EventEmitter {
  constructor() {
    super();
    this.client        = null;
    this.connected     = false;
    this.simMode       = false;
    this.simInterval   = null;
    this.pollInterval  = null;
    this.buffer        = '';
    this.currentPIDidx = 0;
    this.liveData      = {};
    this.dtcList       = [];
    this.vinCode       = null;
    this.protocol      = null;
    this.config        = {};
  }

  isConnected() { return this.connected || this.simMode; }
  getLiveData()  { return this.liveData; }
  getDTCs()      { return this.dtcList; }

  // ── Conectar al adaptador ELM327 ──────────────────────────
  async connect(config) {
    this.config = config;

    if (config.type === 'wifi') {
      return this._connectWifi(config.host, config.port);
    } else if (config.type === 'serial' || config.type === 'bluetooth') {
      return this._connectSerial(config.serialPath);
    }
    throw new Error('Tipo de conexión no soportado: ' + config.type);
  }

  _connectWifi(host, port) {
    return new Promise((resolve, reject) => {
      console.log(`Conectando a ELM327 WiFi en ${host}:${port}...`);
      this.client = new net.Socket();

      this.client.connect(port, host, async () => {
        console.log('✓ TCP conectado al ELM327');
        await this._initELM();
        this.connected = true;
        this._startPolling();
        resolve();
      });

      this.client.on('data', (data) => this._onData(data.toString()));
      this.client.on('error', (err) => {
        console.error('OBD TCP error:', err.message);
        this.emit('error', err);
        reject(err);
      });
      this.client.on('close', () => {
        this.connected = false;
        this.emit('disconnected');
        console.log('OBD desconectado — reintentando en 5s...');
        setTimeout(() => this.connect(this.config).catch(console.error), 5000);
      });

      setTimeout(() => reject(new Error('Timeout conectando al ELM327')), 10000);
    });
  }

  async _connectSerial(serialPath) {
    const { SerialPort } = require('serialport');
    const { ReadlineParser } = require('@serialport/parser-readline');

    this.serialPort = new SerialPort({ path: serialPath, baudRate: 38400 });
    const parser = this.serialPort.pipe(new ReadlineParser({ delimiter: '\r' }));

    parser.on('data', (line) => this._onLine(line.trim()));
    this.serialPort.on('error', (err) => this.emit('error', err));

    await this._initELM();
    this.connected = true;
    this._startPolling();
  }

  // ── Inicializar chip ELM327 ───────────────────────────────
  async _initELM() {
    await this._send('ATZ');       // Reset
    await this._delay(1000);
    await this._send('ATE0');      // Echo off
    await this._send('ATL0');      // Linefeed off
    await this._send('ATS0');      // Spaces off
    await this._send('ATH0');      // Headers off
    await this._send('ATSP0');     // Auto protocol detection
    await this._send('ATAT1');     // Adaptive timing
    this.protocol = await this._send('ATDP'); // Get protocol name
    console.log('ELM327 protocolo:', this.protocol);

    // Leer VIN
    try {
      const vinRaw = await this._send('0902');
      this.vinCode = this._parseVIN(vinRaw);
      this.emit('vin', this.vinCode);
    } catch(e) {
      console.log('VIN no disponible');
    }
  }

  // ── Enviar comando y esperar respuesta ────────────────────
  _send(cmd) {
    return new Promise((resolve) => {
      if (!this.client && !this.serialPort) { resolve(''); return; }
      let response = '';
      const timeout = setTimeout(() => resolve(response), 2000);
      const onData = (data) => {
        response += data;
        if (response.includes('>')) {
          clearTimeout(timeout);
          this.removeListener('_raw', onData);
          resolve(response.replace(/>/g,'').trim());
        }
      };
      this.on('_raw', onData);
      const cmd2send = cmd + '\r';
      if (this.client) this.client.write(cmd2send);
      if (this.serialPort) this.serialPort.write(cmd2send);
    });
  }

  _onData(data) {
    this.buffer += data;
    this.emit('_raw', data);
    const lines = this.buffer.split(/[\r\n]+/);
    this.buffer = lines.pop();
    lines.forEach(l => { if(l.trim()) this._onLine(l.trim()); });
  }

  _onLine(line) {
    if (!line || line === '>' || line.startsWith('AT')) return;
    // Procesar respuesta de PID activo
    this._parsePIDResponse(line);
  }

  // ── Polling de PIDs en tiempo real ────────────────────────
  _startPolling() {
    this.pollInterval = setInterval(async () => {
      if (!this.connected) return;
      const pid = POLL_PIDS[this.currentPIDidx % POLL_PIDS.length];
      this.currentPIDidx++;
      try {
        const raw = await this._send(pid);
        const parsed = this._parsePID(pid, raw);
        if (parsed !== null) {
          const def = PIDS[pid];
          this.liveData[def.name] = {
            value: parsed,
            unit: def.unit,
            label: def.label,
            ts: Date.now()
          };
          this.emit('liveData', { [def.name]: this.liveData[def.name] });
        }
      } catch(e) { /* skip */ }
    }, 100); // Polling cada 100ms — ajustable
  }

  _parsePID(pid, raw) {
    if (!raw || raw.includes('NO DATA') || raw.includes('ERROR')) return null;
    const def = PIDS[pid];
    if (!def) return null;
    try {
      const bytes = raw.replace(/\s/g,'').match(/.{2}/g);
      if (!bytes) return null;
      // Saltar los 2 primeros bytes (mode+pid echo) si están presentes
      const dataBytes = bytes.length > 2 ? bytes.slice(2) : bytes;
      return def.parse(dataBytes);
    } catch(e) { return null; }
  }

  _parsePIDResponse(line) { /* handled by _send promise */ }

  // ── Leer códigos DTC ─────────────────────────────────────
  async readDTCs() {
    const raw = await this._send('03'); // Mode 03 = read DTCs
    const dtcs = this._parseDTCResponse(raw);
    this.dtcList = dtcs;
    this.emit('dtcs', dtcs);
    return dtcs;
  }

  _parseDTCResponse(raw) {
    if (!raw || raw.includes('NO DATA')) return [];
    const dtcs = [];
    const clean = raw.replace(/\s/g,'');
    const bytes = clean.match(/.{2}/g) || [];
    // Saltar primer byte (43 = mode 03 response)
    for (let i = 1; i < bytes.length - 1; i += 2) {
      const b1 = parseInt(bytes[i], 16);
      const b2 = parseInt(bytes[i+1], 16);
      if (b1 === 0 && b2 === 0) continue;
      const type = ['P','C','B','U'][(b1 >> 6) & 0x03];
      const dtc = type
        + (((b1 >> 4) & 0x03)).toString()
        + (b1 & 0x0F).toString(16).toUpperCase()
        + bytes[i+1].toUpperCase();
      dtcs.push(dtc);
    }
    return dtcs;
  }

  // ── Limpiar DTCs ─────────────────────────────────────────
  async clearDTCs() {
    await this._send('04'); // Mode 04 = clear DTCs
    this.dtcList = [];
    this.emit('dtcsCleared');
    return true;
  }

  // ── Leer Freeze Frame ────────────────────────────────────
  async readFreezeFrame(dtcIndex = 0) {
    const ff = {};
    for (const pid of ['020C','020D','0205','0206','0207','0210']) {
      const raw = await this._send(pid + ' ' + dtcIndex.toString().padStart(2,'0'));
      const pidKey = '01' + pid.slice(2);
      const val = this._parsePID(pidKey, raw);
      if (val !== null) {
        const def = PIDS[pidKey];
        if (def) ff[def.name] = { value: val, unit: def.unit, label: def.label };
      }
    }
    return ff;
  }

  // ── VIN Parser ───────────────────────────────────────────
  _parseVIN(raw) {
    try {
      const clean = raw.replace(/\s/g,'').replace(/490201/g,'').replace(/490202/g,'');
      let vin = '';
      const bytes = clean.match(/.{2}/g) || [];
      for (const b of bytes) {
        const code = parseInt(b, 16);
        if (code > 31 && code < 127) vin += String.fromCharCode(code);
      }
      return vin.length >= 17 ? vin.slice(0,17) : null;
    } catch(e) { return null; }
  }

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── MODO SIMULACIÓN ─────────────────────────────────────
  // Cuando no hay adaptador físico — genera datos realistas
  startSimulation() {
    this.simMode = true;
    console.log('⚡ Modo simulación activo — generando datos OBD-II realistas');

    // Estado base simulado
    let rpm      = 750;
    let speed    = 0;
    let coolant  = 87;
    let throttle = 15;
    let load     = 22;
    let ftShort  = 16.4;
    let ftLong   = 22.1;
    let o2       = 0.89;
    let maf      = 1.8;

    // DTCs simulados (los del Toyota Corolla demo)
    this.dtcList = ['P0171','P0420','P0441'];
    this.emit('dtcs', this.dtcList);

    this.simInterval = setInterval(() => {
      // Fluctuar valores de forma realista
      rpm      = Math.round(750 + (Math.random()-0.5)*80);
      o2       = parseFloat((0.1 + Math.random()*0.85).toFixed(3));
      ftShort  = parseFloat((14 + (Math.random()-0.5)*6).toFixed(1));
      maf      = parseFloat((1.6 + (Math.random()-0.5)*0.4).toFixed(2));
      coolant  = Math.round(85 + (Math.random()-0.5)*4);

      this.liveData = {
        rpm:          { value: rpm,      unit:'rpm',  label:'RPM' },
        speed:        { value: speed,    unit:'km/h', label:'Velocidad' },
        coolant:      { value: coolant,  unit:'°C',   label:'Temp. Refrigerante' },
        intake_temp:  { value: 24,       unit:'°C',   label:'Temp. Admisión' },
        throttle:     { value: throttle, unit:'%',    label:'Posición Mariposa' },
        map:          { value: 45,       unit:'kPa',  label:'Presión MAP' },
        maf:          { value: maf,      unit:'g/s',  label:'Flujo MAF' },
        fuel_trim_short: { value: ftShort, unit:'%',  label:'Fuel Trim Corto' },
        fuel_trim_long:  { value: ftLong,  unit:'%',  label:'Fuel Trim Largo' },
        o2_b1s1:      { value: o2,       unit:'V',    label:'O2 Sensor B1S1' },
        voltage:      { value: 12.6,     unit:'V',    label:'Voltaje' },
        engine_load:  { value: load,     unit:'%',    label:'Carga Motor' },
        timing:       { value: 14.2,     unit:'°',    label:'Avance Encendido' },
      };
      this.emit('liveData', this.liveData);
    }, 300);
  }

  stopSimulation() {
    if (this.simInterval) clearInterval(this.simInterval);
    this.simMode = false;
  }

  disconnect() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    if (this.simInterval)  clearInterval(this.simInterval);
    if (this.client) this.client.destroy();
    if (this.serialPort) this.serialPort.close();
    this.connected = false;
    this.simMode   = false;
  }
}

module.exports = new OBDManager();
