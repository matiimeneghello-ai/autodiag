/**
 * AutoDiag Pro — Agente J2534 v3.0
 * - Detecta VNCI Nano (RKW_VNCI_PT32.dll) y otras interfaces J2534
 * - Lee datos REALES del auto via ELM327 serial
 * - Detecta desconexión física de la interfaz
 * - Mercedes-Benz GLK300 2012 compatible
 */
'use strict';

const WebSocket  = require('ws');
const readline   = require('readline');
const fs         = require('fs');
const path       = require('path');
const { execSync } = require('child_process');

const VERSION     = '3.0.0';
const SERVER_URL  = 'wss://autodiag-production.up.railway.app';
const CONFIG_FILE = path.join(__dirname, 'config.json');

let config = { serverUrl: SERVER_URL, authToken: null, dllPath: null };
let ws            = null;
let connected     = false;
let liveTimer     = null;
let scanTimer     = null;
let healthTimer   = null;
let tick          = 0;
let useSimulation = true;
let obdReady      = false;
let serialPort    = null;
let lastResponse  = Date.now();

// ── KNOWN J2534 DLL PATHS ─────────────────────────────────────
const KNOWN_DLLS = [
  { name: 'Rockway VNCI Nano J2534', paths: [
    'C:\\Program Files (x86)\\Rockway\\VNCI Nano Driver\\RKW_VNCI_PT32.dll',
    'C:\\Program Files (x86)\\Rockway\\VNCI Nano Driver\\VNCI.dll',
    'C:\\Program Files\\Rockway\\VNCI Nano Driver\\RKW_VNCI_PT32.dll',
    'C:\\Windows\\SysWOW64\\RKW_VNCI_PT32.dll',
    'C:\\Windows\\System32\\RKW_VNCI_PT32.dll',
  ]},
  { name: 'Tactrix Openport 2.0', paths: [
    'C:\\Program Files\\Tactrix\\Openport 2.0 J2534\\op20pt32.dll',
    'C:\\Program Files (x86)\\Tactrix\\Openport 2.0 J2534\\op20pt32.dll',
  ]},
  { name: 'OBDLINK', paths: [
    'C:\\Program Files\\ScanTool.net\\OBDLink\\J2534_x64.dll',
    'C:\\Program Files (x86)\\ScanTool.net\\OBDLink\\J2534.dll',
  ]},
  { name: 'Drew MongoosePro', paths: [
    'C:\\Program Files\\Drew Technologies\\MongoosePro GM II\\mondrv.dll',
    'C:\\Program Files (x86)\\Drew Technologies\\MongoosePro GM II\\mondrv.dll',
  ]},
  { name: 'Autel MaxiFlash', paths: [
    'C:\\Program Files\\Autel\\MaxiFlash\\j2534.dll',
    'C:\\Program Files (x86)\\Autel\\MaxiFlash\\j2534.dll',
  ]},
];

// OBD-II PIDs
const PIDS = {
  rpm:         { cmd:'010C', name:'RPM',             unit:'rpm',  parse: d => ((d[2]*256)+d[3])/4 },
  speed:       { cmd:'010D', name:'Velocidad',        unit:'km/h', parse: d => d[2] },
  coolant:     { cmd:'0105', name:'Temp. Motor',      unit:'°C',   parse: d => d[2]-40 },
  throttle:    { cmd:'0111', name:'Mariposa',         unit:'%',    parse: d => d[2]*100/255 },
  engine_load: { cmd:'0104', name:'Carga Motor',      unit:'%',    parse: d => d[2]*100/255 },
  fuel_short:  { cmd:'0106', name:'Fuel Trim C',      unit:'%',    parse: d => (d[2]-128)*100/128 },
  fuel_long:   { cmd:'0107', name:'Fuel Trim L',      unit:'%',    parse: d => (d[2]-128)*100/128 },
  o2_b1s1:     { cmd:'0114', name:'O2 B1S1',          unit:'V',    parse: d => d[2]/200 },
  maf:         { cmd:'0110', name:'MAF',              unit:'g/s',  parse: d => ((d[2]*256)+d[3])/100 },
  intake_temp: { cmd:'010F', name:'Temp. Admisión',   unit:'°C',   parse: d => d[2]-40 },
  timing:      { cmd:'010E', name:'Avance',           unit:'°',    parse: d => d[2]/2-64 },
  map:         { cmd:'010B', name:'MAP',              unit:'kPa',  parse: d => d[2] },
  voltage:     { cmd:'0142', name:'Voltaje',          unit:'V',    parse: d => ((d[2]*256)+d[3])/1000 },
  vin:         { cmd:'0902', name:'VIN',              unit:'',     parse: null }, // special
};

// Modules to scan
const MODULES = [
  { key:'ENGINE',       id:'7E0', name:'Motor (ECU/PCM)',    icon:'🔧' },
  { key:'TRANSMISSION', id:'7E1', name:'Transmisión (TCM)',  icon:'⚙️'  },
  { key:'ABS',          id:'7A0', name:'ABS / ESP',          icon:'🛑' },
  { key:'AIRBAG',       id:'7B0', name:'Airbag (SRS)',       icon:'🫧' },
  { key:'BCM',          id:'720', name:'Carrocería (BCM)',    icon:'💡' },
  { key:'HVAC',         id:'7C0', name:'Climatizador (HVAC)',icon:'❄️'  },
  { key:'STEERING',     id:'730', name:'Dirección (EPS)',     icon:'🎯' },
  { key:'CLUSTER',      id:'740', name:'Instrumentos (IPC)', icon:'📊' },
];

// ── SERIAL / ELM327 ───────────────────────────────────────────
async function initSerial() {
  try {
    const { SerialPort } = require('serialport');
    const ports = await SerialPort.list();
    log(`🔍 ${ports.length} puerto(s) serie encontrado(s)`, 'c');
    ports.forEach(p => log(`   ${p.path} — ${p.manufacturer||'desconocido'} ${p.vendorId||''}`, 'x'));

    // Try each port that could be J2534/ELM327
    const candidates = ports.filter(p =>
      p.manufacturer?.includes('FTDI') ||
      p.manufacturer?.includes('Silicon') ||
      p.manufacturer?.includes('CH340') ||
      p.manufacturer?.includes('Prolific') ||
      p.manufacturer?.includes('Microsoft') || // VNCI appears as Microsoft
      p.vendorId === '0403' || p.vendorId === '10c4' ||
      p.vendorId === '1a86' || p.vendorId === '067b'
    );

    if (candidates.length === 0) {
      log('   No se encontró interfaz serial compatible', 'y');
      return false;
    }

    // Try each candidate
    for (const port of candidates) {
      log(`🔌 Probando ${port.path} (${port.manufacturer||'?'})...`, 'c');
      try {
        const result = await tryConnectSerial(port.path);
        if (result) {
          log(`✅ Conectado via ${port.path}`, 'g');
          return true;
        }
      } catch(e) {
        log(`   ${port.path} falló: ${e.message}`, 'y');
      }
    }
    return false;
  } catch(e) {
    if (e.code !== 'MODULE_NOT_FOUND') log(`Error serial: ${e.message}`, 'y');
    return false;
  }
}

async function tryConnectSerial(portPath) {
  const { SerialPort } = require('serialport');
  
  const sp = new SerialPort({ path: portPath, baudRate: 38400, autoOpen: false });
  await new Promise((res,rej) => sp.open(e => e ? rej(e) : res()));

  // Test with ATI command
  const response = await sendCmd(sp, 'ATI', 1500);
  if (!response || (!response.includes('ELM') && !response.includes('OBD') && !response.includes('OK'))) {
    sp.close();
    return false;
  }

  log(`   Respuesta ATI: ${response.trim()}`, 'g');
  
  // Initialize ELM327
  await sendCmd(sp, 'ATZ',   2000); // Reset
  await sendCmd(sp, 'ATE0',  300);  // Echo off
  await sendCmd(sp, 'ATL0',  300);  // Linefeeds off
  await sendCmd(sp, 'ATS0',  300);  // Spaces off
  await sendCmd(sp, 'ATH1',  300);  // Headers on
  
  // Set protocol for Mercedes-Benz GLK (ISO 15765-4 CAN 500kbps)
  await sendCmd(sp, 'ATSP6', 500);  // Protocol 6 = ISO 15765-4 CAN 500kbps
  
  // Test connection to ECU
  const testResp = await sendCmd(sp, '0100', 3000); // Supported PIDs
  if (!testResp || testResp.includes('NO DATA') || testResp.includes('UNABLE')) {
    // Try auto protocol
    await sendCmd(sp, 'ATSP0', 500);
    const testResp2 = await sendCmd(sp, '0100', 4000);
    if (!testResp2 || testResp2.includes('NO DATA') || testResp2.includes('UNABLE')) {
      sp.close();
      return false;
    }
  }

  serialPort  = sp;
  obdReady    = true;
  useSimulation = false;
  
  // Setup disconnect detection
  sp.on('close', () => {
    log('\n⚠️  INTERFAZ DESCONECTADA FÍSICAMENTE', 'r');
    log('   Reconectá la VNCI Nano al USB y reiniciá el agente.', 'y');
    obdReady = false;
    useSimulation = true;
    serialPort = null;
    send('agent_status', {
      connected: true,
      obdConnected: false,
      simMode: true,
      warning: 'Interfaz OBD desconectada del USB',
    });
  });

  sp.on('error', (err) => {
    log(`Error interfaz: ${err.message}`, 'r');
    obdReady = false;
    useSimulation = true;
  });

  return true;
}

function sendCmd(sp, cmd, timeout=2000) {
  return new Promise((resolve) => {
    if (!sp?.isOpen) { resolve(null); return; }
    let buffer = '';
    const timer = setTimeout(() => {
      try { sp.removeAllListeners('data'); } catch(e) {}
      resolve(buffer || null);
    }, timeout);

    try {
      sp.write(cmd + '\r', (err) => {
        if (err) { clearTimeout(timer); resolve(null); }
      });
    } catch(e) { clearTimeout(timer); resolve(null); return; }

    const onData = (chunk) => {
      buffer += chunk.toString();
      if (buffer.includes('>')) {
        clearTimeout(timer);
        try { sp.removeListener('data', onData); } catch(e) {}
        resolve(buffer.replace(/>/g, '').trim());
      }
    };
    sp.on('data', onData);
  });
}

// ── HEALTH CHECK — detect physical disconnect ─────────────────
async function checkPhysicalConnection() {
  if (!serialPort?.isOpen) {
    if (obdReady) {
      log('⚠️  Puerto serie cerrado — interfaz desconectada', 'r');
      obdReady = false;
      useSimulation = true;
      send('obd_disconnected', { reason: 'Serial port closed' });
    }
    return;
  }
  // Port is open = interface is connected physically
  // Just update lastResponse to keep alive
  lastResponse = Date.now();
}

// ── READ VIN ──────────────────────────────────────────────────
async function readVIN() {
  if (!serialPort?.isOpen) return null;
  try {
    const resp = await sendCmd(serialPort, '0902', 5000);
    if (!resp || resp.includes('NO DATA')) return null;
    // Parse VIN from response bytes
    const lines = resp.split('\n').map(l => l.trim()).filter(Boolean);
    let vinHex = '';
    for (const line of lines) {
      const bytes = line.split(/\s+/).filter(b => /^[0-9A-F]{2}$/i.test(b));
      vinHex += bytes.slice(2).join(''); // skip header bytes
    }
    // Convert hex to ASCII
    const vin = vinHex.match(/.{2}/g)
      ?.map(h => String.fromCharCode(parseInt(h,16)))
      .filter(ch => /[\w]/.test(ch))
      .join('') || null;
    return vin?.length >= 10 ? vin : null;
  } catch(e) { return null; }
}

// ── READ LIVE DATA ────────────────────────────────────────────
async function readLiveData() {
  if (useSimulation || !obdReady || !serialPort?.isOpen) return getSimData();

  const result = {};
  for (const [key, pid] of Object.entries(PIDS)) {
    if (key === 'vin') continue;
    try {
      const raw = await sendCmd(serialPort, pid.cmd, 1500);
      if (!raw || raw.includes('NO DATA') || raw.includes('ERROR') || raw.includes('UNABLE')) continue;
      const bytes = raw.split(/\s+/).filter(b => /^[0-9A-F]{2}$/i.test(b)).map(b => parseInt(b,16));
      if (bytes.length >= 3) {
        const val = pid.parse(bytes);
        if (!isNaN(val) && isFinite(val)) {
          result[key] = { value: Math.round(val*10)/10, unit: pid.unit, label: pid.name };
          lastResponse = Date.now();
        }
      }
    } catch(e) {}
  }
  return Object.keys(result).length > 2 ? result : getSimData();
}

// ── READ DTCs ─────────────────────────────────────────────────
async function readDTCsFromModule(moduleId) {
  if (!serialPort?.isOpen) return [];
  try {
    // Set CAN header for specific module
    await sendCmd(serialPort, `ATSH${moduleId}`, 300);
    await sleep(100);
    const raw = await sendCmd(serialPort, '03', 4000); // Mode 03 = stored DTCs
    if (!raw || raw.includes('NO DATA') || raw.includes('ERROR')) return [];
    
    const bytes = raw.split(/\s+/).filter(b => /^[0-9A-F]{2}$/i.test(b)).map(b => parseInt(b,16));
    const dtcs = [];
    // Skip response header bytes (43 NN), start at DTC data
    const start = bytes.findIndex(b => b === 0x43) + 2;
    if (start < 2) return [];
    
    for (let i = start; i < bytes.length - 1; i += 2) {
      if (bytes[i] === 0 && bytes[i+1] === 0) continue;
      const type   = (bytes[i] >> 6) & 0x03;
      const digit  = (bytes[i] >> 4) & 0x03;
      const rest   = ((bytes[i] & 0x0F) << 8) | bytes[i+1];
      const prefix = ['P','C','B','U'][type];
      const code   = `${prefix}${digit}${rest.toString(16).padStart(3,'0').toUpperCase()}`;
      if (!dtcs.includes(code)) dtcs.push(code);
    }
    return dtcs;
  } catch(e) { return []; }
}

// ── SCAN ALL MODULES ──────────────────────────────────────────
async function scanAllModules() {
  log('\n🔍 Escaneando todos los módulos del vehículo...', 'c');
  send('scan_started', { modules: MODULES.map(m => m.key) });

  // Read VIN first
  if (!useSimulation && serialPort?.isOpen) {
    const vin = await readVIN();
    if (vin) {
      log(`   VIN: ${vin}`, 'g');
      send('vehicle_vin', { vin });
    }
  }

  const results = [];
  for (const mod of MODULES) {
    await sleep(400);
    const dtcs = await readDTCsFromModule(mod.id);
    const hasFault = dtcs.length > 0;
    const status = useSimulation ? 'sim' : (hasFault ? 'fault' : 'ok');
    log(`  ${mod.icon} ${mod.name}: ${hasFault ? '⚠ '+dtcs.join(', ') : '✓ OK'}${useSimulation?' (sim)':''}`, hasFault?'r':'g');
    send('module_scanned', { ...mod, dtcs, status, dtcCount: dtcs.length, realData: !useSimulation });
    results.push({ ...mod, dtcs });
  }

  const totalDTCs    = results.reduce((a,m) => a + m.dtcs.length, 0);
  const faultyModules = results.filter(m => m.dtcs.length > 0).length;
  send('scan_complete', { modules: results, totalDTCs, faultyModules, realData: !useSimulation });
  log(`\n${useSimulation?'⚠ SIMULACIÓN':'✅ REAL'} — ${totalDTCs} DTC${totalDTCs!==1?'s':''} en ${faultyModules} módulo${faultyModules!==1?'s':''}`, totalDTCs>0?'y':'g');
}

// ── SIMULATION FALLBACK ───────────────────────────────────────
function getSimData() {
  tick++;
  return {
    rpm:         { value: Math.round(750+Math.sin(tick*.1)*200+Math.random()*50), unit:'rpm', label:'RPM', sim:true },
    speed:       { value: 0,   unit:'km/h', label:'Velocidad', sim:true },
    coolant:     { value: Math.round(85+Math.sin(tick*.05)*3), unit:'°C', label:'Temp. Motor', sim:true },
    throttle:    { value: 15,  unit:'%',    label:'Mariposa', sim:true },
    engine_load: { value: 20,  unit:'%',    label:'Carga Motor', sim:true },
    fuel_short:  { value: parseFloat((14+(Math.random()-.5)*6).toFixed(1)), unit:'%', label:'Fuel Trim C', sim:true },
    fuel_long:   { value: 22.1,unit:'%',    label:'Fuel Trim L', sim:true },
    o2_b1s1:     { value: parseFloat((.1+Math.abs(Math.sin(tick*.3))*.85).toFixed(3)), unit:'V', label:'O2 B1S1', sim:true },
    maf:         { value: parseFloat((1.6+(Math.random()-.5)*.4).toFixed(2)), unit:'g/s', label:'MAF', sim:true },
    voltage:     { value: 12.6,unit:'V',    label:'Voltaje', sim:true },
  };
}

// ── REGISTRY SEARCH ───────────────────────────────────────────
function findDLLFromRegistry() {
  for (const key of [
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\PassThruSupport.04.04',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\PassThruSupport.04.04',
  ]) {
    try {
      const out = execSync(`reg query "${key}" /s 2>nul`, { encoding:'utf8', timeout:3000 });
      const match = out.match(/FunctionLibrary\s+REG_SZ\s+(.+)/);
      if (match && fs.existsSync(match[1].trim())) return match[1].trim();
    } catch(e) {}
  }
  return null;
}

function findDLL() {
  const fromReg = findDLLFromRegistry();
  if (fromReg) return fromReg;
  for (const iface of KNOWN_DLLS) {
    for (const p of iface.paths) {
      if (fs.existsSync(p)) { log(`🔍 ${iface.name}: ${p}`, 'g'); return p; }
    }
  }
  return null;
}

// ── WEBSOCKET ─────────────────────────────────────────────────
function send(type, payload) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload, ts: Date.now(), agent: true }));
  }
}

function connect() {
  ws = new WebSocket(config.serverUrl + '/agent', {
    headers: { 'x-agent-token': config.authToken||'', 'x-agent-version': VERSION },
    rejectUnauthorized: false,
  });

  ws.on('open', () => {
    connected = true;
    log('✅ Conectado a AutoDiag Pro', 'g');
    send('agent_hello', {
      version:    VERSION,
      j2534Dll:   config.dllPath ? path.basename(config.dllPath) : null,
      simMode:    useSimulation,
      obdReady:   obdReady,
      protocol:   'ISO15765',
      realOBD:    !useSimulation && obdReady,
    });

    // Live data every 500ms
    liveTimer = setInterval(async () => {
      if (!connected) return;
      const data = await readLiveData();
      send('live_data', { ...data, obdConnected: obdReady, simMode: useSimulation });
    }, 500);

    // Full scan every 60s
    setTimeout(() => scanAllModules(), 2000);
    scanTimer = setInterval(() => scanAllModules(), 60000);

    // Health check every 5s — detect physical disconnect
    healthTimer = setInterval(() => checkPhysicalConnection(), 10000);
  });

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.action === 'scan_all_modules') await scanAllModules();
      if (msg.action === 'read_live') send('live_data', await readLiveData());
      if (msg.action === 'ping') send('pong', { ts:Date.now(), simMode:useSimulation, obdReady });
    } catch(e) {}
  });

  ws.on('close', () => {
    connected = false;
    clearInterval(liveTimer); clearInterval(scanTimer); clearInterval(healthTimer);
    log('⚠️  Desconectado del servidor. Reconectando en 5s...', 'y');
    setTimeout(connect, 5000);
  });

  ws.on('error', e => log(`❌ WebSocket error: ${e.message}`, 'r'));
}

// ── UTILS ─────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const C = { r:'\x1b[31m', g:'\x1b[32m', y:'\x1b[33m', c:'\x1b[36m', x:'\x1b[0m' };
function log(msg, color='x') {
  console.log(`${C[color]||''}[${new Date().toLocaleTimeString('es-AR')}] ${msg}${C.x}`);
}
function loadConfig() {
  try { if (fs.existsSync(CONFIG_FILE)) config = {...config, ...JSON.parse(fs.readFileSync(CONFIG_FILE,'utf8'))}; } catch(e) {}
}
function saveConfig() {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config,null,2)); } catch(e) {}
}

// ── MAIN ──────────────────────────────────────────────────────
async function main() {
  console.clear();
  console.log('\x1b[36m');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║   AUTODIAG PRO — Agente v3.0             ║');
  console.log('  ║   Detección real de interfaz + salud      ║');
  console.log('  ╚══════════════════════════════════════════╝\x1b[0m\n');

  loadConfig();

  // Token
  if (!config.authToken) {
    console.log('\x1b[33m  Para PEGAR: CLICK DERECHO en esta ventana\x1b[0m\n');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    config.authToken = await new Promise(r => {
      rl.question('  Pega tu token (click derecho) y Enter: ', ans => { rl.close(); r(ans.trim()); });
    });
    if (!config.authToken) { log('Sin token. Cerrando.','r'); process.exit(1); }
    saveConfig();
    log('✓ Token guardado para siempre','g');
  } else {
    log('✓ Token cargado','g');
  }

  // Find J2534 DLL
  const dllPath = findDLL();
  if (dllPath) {
    log(`✅ Interfaz J2534: ${path.basename(dllPath)}`,'g');
    config.dllPath = dllPath;
    saveConfig();
  }

  // Connect to OBD via serial
  log('\n🔍 Buscando interfaz OBD en puertos serie...','c');
  const serialOk = await initSerial();

  if (serialOk) {
    log('\n✅ MODO REAL — Leyendo datos del auto','g');
    log('   Protocolo: ISO 15765-4 CAN 500kbps','g');
    log('   Compatible: Mercedes GLK300 2012\n','g');
  } else {
    log('\n⚠️  MODO SIMULACIÓN — datos NO reales','y');
    log('   Asegurate que la VNCI Nano esté conectada al USB\n','y');
  }

  connect();

  // CLI
  const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
  log('Comandos: scan | status | quit\n','x');
  rl2.on('line', async line => {
    const cmd = line.trim().toLowerCase();
    if (cmd === 'scan')   await scanAllModules();
    if (cmd === 'status') {
      log(`Servidor: ${connected?'✅ Conectado':'❌ Desconectado'}`, connected?'g':'r');
      log(`OBD real: ${obdReady?'✅ Activo':'⚠️  Simulación'}`, obdReady?'g':'y');
      log(`Interfaz: ${serialPort?.isOpen?'✅ Puerto abierto':'❌ Desconectada'}`, serialPort?.isOpen?'g':'r');
    }
    if (cmd === 'quit') { ws?.close(); process.exit(0); }
  });

  process.on('SIGINT', () => { ws?.close(); process.exit(0); });
}

main().catch(e => { console.error('Error fatal:', e.message); process.exit(1); });
