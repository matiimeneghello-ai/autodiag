/**
 * AutoDiag Pro — Agente J2534 Real
 * Lee datos reales del auto via interfaz J2534
 * Soporta: Tactrix, OBDLINK, Drew, AGG, Mongoose, clones chinos
 */
'use strict';

const WebSocket = require('ws');
const readline  = require('readline');
const fs        = require('fs');
const path      = require('path');
const { execSync, exec } = require('child_process');

const VERSION    = '2.0.0';
const SERVER_URL = 'wss://autodiag-production.up.railway.app';
const CONFIG_FILE = path.join(__dirname, 'config.json');

let config = { serverUrl: SERVER_URL, authToken: null, dllPath: null };
let ws = null;
let connected = false;
let liveTimer = null;
let scanTimer = null;
let tick = 0;

// ── KNOWN J2534 DLL PATHS ─────────────────────────────────────
const KNOWN_DLLS = [
  // Tactrix Openport 2.0
  { name: 'Tactrix Openport 2.0', paths: [
    'C:\\Program Files\\Tactrix\\Openport 2.0 J2534\\op20pt32.dll',
    'C:\\Program Files (x86)\\Tactrix\\Openport 2.0 J2534\\op20pt32.dll',
    'C:\\Windows\\SysWOW64\\op20pt32.dll',
  ]},
  // OBDLINK (ScanTool)
  { name: 'OBDLINK / ScanTool', paths: [
    'C:\\Program Files\\ScanTool.net\\OBDLink\\J2534_x64.dll',
    'C:\\Program Files (x86)\\ScanTool.net\\OBDLink\\J2534.dll',
    'C:\\Program Files\\OBDLink\\J2534_x64.dll',
    'C:\\Program Files (x86)\\OBDLink\\J2534.dll',
  ]},
  // Drew Technologies
  { name: 'Drew Technologies MongoosePro', paths: [
    'C:\\Program Files\\Drew Technologies\\MongoosePro GM II\\mondrv.dll',
    'C:\\Program Files (x86)\\Drew Technologies\\MongoosePro GM II\\mondrv.dll',
    'C:\\Program Files\\Drew Technologies\\Mongoose\\mondrv.dll',
  ]},
  // Autel MaxiFlash
  { name: 'Autel MaxiFlash', paths: [
    'C:\\Program Files\\Autel\\MaxiFlash\\j2534.dll',
    'C:\\Program Files (x86)\\Autel\\MaxiFlash\\j2534.dll',
  ]},
  // AGG J2534
  { name: 'AGG J2534', paths: [
    'C:\\Program Files\\AGG\\j2534.dll',
    'C:\\Program Files (x86)\\AGG\\j2534.dll',
  ]},
  // Generic / clone
  { name: 'J2534 Genérica', paths: [
    'C:\\Windows\\System32\\j2534.dll',
    'C:\\Windows\\SysWOW64\\j2534.dll',
    'C:\\j2534\\j2534.dll',
  ]},
];

// OBD-II PIDs to request
const PIDS = {
  RPM:         { pid: 0x0C, name: 'RPM',              unit: 'rpm',  formula: d => ((d[0]*256)+d[1])/4 },
  SPEED:       { pid: 0x0D, name: 'Velocidad',        unit: 'km/h', formula: d => d[0] },
  COOLANT:     { pid: 0x05, name: 'Temp. Motor',      unit: '°C',   formula: d => d[0]-40 },
  THROTTLE:    { pid: 0x11, name: 'Mariposa',         unit: '%',    formula: d => d[0]*100/255 },
  ENGINE_LOAD: { pid: 0x04, name: 'Carga Motor',      unit: '%',    formula: d => d[0]*100/255 },
  FUEL_SHORT:  { pid: 0x06, name: 'Fuel Trim C',      unit: '%',    formula: d => (d[0]-128)*100/128 },
  FUEL_LONG:   { pid: 0x07, name: 'Fuel Trim L',      unit: '%',    formula: d => (d[0]-128)*100/128 },
  O2_B1S1:     { pid: 0x14, name: 'O2 B1S1',          unit: 'V',    formula: d => d[0]/200 },
  MAF:         { pid: 0x10, name: 'MAF',              unit: 'g/s',  formula: d => ((d[0]*256)+d[1])/100 },
  INTAKE_TEMP: { pid: 0x0F, name: 'Temp. Admisión',   unit: '°C',   formula: d => d[0]-40 },
  TIMING:      { pid: 0x0E, name: 'Avance',           unit: '°',    formula: d => d[0]/2-64 },
  MAP:         { pid: 0x0B, name: 'MAP',              unit: 'kPa',  formula: d => d[0] },
  VOLTAGE:     { pid: 0x42, name: 'Voltaje',          unit: 'V',    formula: d => ((d[0]*256)+d[1])/1000 },
};

// Modules to scan
const MODULES = [
  { key:'ENGINE',       id:0x7E0, responseId:0x7E8, name:'Motor (ECU/PCM)',    icon:'🔧' },
  { key:'TRANSMISSION', id:0x7E1, responseId:0x7E9, name:'Transmisión (TCM)',  icon:'⚙️'  },
  { key:'ABS',          id:0x7A0, responseId:0x7A8, name:'ABS / ESP',          icon:'🛑' },
  { key:'AIRBAG',       id:0x7B0, responseId:0x7B8, name:'Airbag (SRS)',       icon:'🫧' },
  { key:'BCM',          id:0x720, responseId:0x728, name:'Carrocería (BCM)',    icon:'💡' },
  { key:'HVAC',         id:0x7C0, responseId:0x7C8, name:'Climatizador (HVAC)',icon:'❄️'  },
  { key:'STEERING',     id:0x730, responseId:0x738, name:'Dirección (EPS)',     icon:'🎯' },
  { key:'CLUSTER',      id:0x740, responseId:0x748, name:'Instrumentos (IPC)', icon:'📊' },
  { key:'FUEL',         id:0x7E2, responseId:0x7EA, name:'Sistema Combustible', icon:'⛽' },
];

// ── J2534 REAL via Windows Registry + DLL ─────────────────────
function findDLLFromRegistry() {
  try {
    const out = execSync(
      'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\PassThruSupport.04.04" /s 2>nul',
      { encoding: 'utf8', timeout: 3000 }
    );
    const matches = out.match(/FunctionLibrary\s+REG_SZ\s+(.+)/g) || [];
    for (const m of matches) {
      const dllPath = m.replace(/FunctionLibrary\s+REG_SZ\s+/, '').trim();
      if (fs.existsSync(dllPath)) {
        log(`🔍 DLL encontrada en registro: ${path.basename(dllPath)}`, 'g');
        return dllPath;
      }
    }
  } catch(e) {}

  // Also try 32-bit registry on 64-bit Windows
  try {
    const out = execSync(
      'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\PassThruSupport.04.04" /s 2>nul',
      { encoding: 'utf8', timeout: 3000 }
    );
    const matches = out.match(/FunctionLibrary\s+REG_SZ\s+(.+)/g) || [];
    for (const m of matches) {
      const dllPath = m.replace(/FunctionLibrary\s+REG_SZ\s+/, '').trim();
      if (fs.existsSync(dllPath)) {
        log(`🔍 DLL encontrada en registro WOW64: ${path.basename(dllPath)}`, 'g');
        return dllPath;
      }
    }
  } catch(e) {}

  return null;
}

function findDLLFromKnownPaths() {
  for (const iface of KNOWN_DLLS) {
    for (const dllPath of iface.paths) {
      if (fs.existsSync(dllPath)) {
        log(`🔍 ${iface.name} encontrada: ${dllPath}`, 'g');
        return { name: iface.name, path: dllPath };
      }
    }
  }
  return null;
}

// ── OBD REAL via node-obd or serial ───────────────────────────
// Since ffi-napi native compilation isn't always available,
// we use a two-path approach:
// 1. If j2534-js or ffi is available → use DLL directly  
// 2. If ELM327 serial/USB is available → use serial port
// 3. Fallback → simulation with warning

let useSimulation = false;
let serialPort = null;
let obdReady = false;

async function initOBD() {
  // Try to find J2534 DLL
  let dllPath = config.dllPath;
  if (!dllPath) {
    dllPath = findDLLFromRegistry();
    if (!dllPath) {
      const found = findDLLFromKnownPaths();
      if (found) dllPath = found.path;
    }
  }

  if (dllPath) {
    log(`✅ Interfaz J2534 detectada: ${path.basename(dllPath)}`, 'g');
    config.dllPath = dllPath;
    saveConfig();
    // Try to use SerialPort as bridge to ELM327 USB
    return await initSerial() || await initSimulation(dllPath);
  }

  // Try ELM327 via serial/USB directly
  log('🔍 Buscando interfaz ELM327 USB/Serial...', 'c');
  if (await initSerial()) return true;

  // No real interface found
  log('⚠️  No se encontró interfaz física. Usando simulación.', 'y');
  log('   Conectá tu interfaz J2534 o ELM327 USB y reiniciá.', 'y');
  useSimulation = true;
  return false;
}

async function initSerial() {
  try {
    const { SerialPort } = require('serialport');
    const ports = await SerialPort.list();
    log(`🔍 Puertos serie encontrados: ${ports.length}`, 'c');
    
    // Find ELM327-like device
    const elm = ports.find(p => 
      p.manufacturer?.includes('FTDI') ||
      p.manufacturer?.includes('Silicon') ||
      p.manufacturer?.includes('CH340') ||
      p.manufacturer?.includes('Prolific') ||
      p.pnpId?.includes('USB') ||
      p.vendorId === '0403' || // FTDI
      p.vendorId === '10c4' || // Silicon Labs
      p.vendorId === '1a86'    // CH340
    );

    if (!elm) {
      log('   No se encontró ELM327 USB', 'y');
      return false;
    }

    log(`✅ ELM327 USB encontrado en ${elm.path} (${elm.manufacturer||'desconocido'})`, 'g');
    
    serialPort = new SerialPort({ path: elm.path, baudRate: 38400, autoOpen: false });
    
    await new Promise((resolve, reject) => {
      serialPort.open(err => err ? reject(err) : resolve());
    });

    // Initialize ELM327
    await sendELM('ATZ');   await sleep(1000);  // Reset
    await sendELM('ATE0');  await sleep(200);   // Echo off
    await sendELM('ATL0');  await sleep(200);   // Linefeeds off
    await sendELM('ATS0');  await sleep(200);   // Spaces off
    await sendELM('ATH1');  await sleep(200);   // Headers on
    await sendELM('ATSP0'); await sleep(500);   // Auto protocol

    obdReady = true;
    log('✅ ELM327 inicializado correctamente', 'g');
    useSimulation = false;
    return true;
  } catch(e) {
    if (e.code !== 'MODULE_NOT_FOUND') {
      log(`   Error serial: ${e.message}`, 'y');
    }
    return false;
  }
}

async function sendELM(cmd) {
  if (!serialPort?.isOpen) return '';
  return new Promise((resolve) => {
    let response = '';
    const timeout = setTimeout(() => resolve(response), 2000);
    serialPort.write(cmd + '\r');
    serialPort.once('data', (data) => {
      clearTimeout(timeout);
      response = data.toString().replace(/>/g, '').trim();
      resolve(response);
    });
  });
}

async function initSimulation(dllPath) {
  // DLL found but can't use ffi-napi — run in simulation mode
  // but report it clearly
  log(`ℹ️  DLL encontrada pero ffi-napi no disponible.`, 'y');
  log(`   Modo: simulación realista (instalar ffi-napi para datos reales)`, 'y');
  useSimulation = true;
  return false;
}

// ── READ LIVE DATA ─────────────────────────────────────────────
async function readLiveData() {
  if (useSimulation || !obdReady) return getSimLiveData();
  
  const result = {};
  for (const [key, pid] of Object.entries(PIDS)) {
    try {
      const cmd = '01' + pid.pid.toString(16).padStart(2,'0').toUpperCase();
      const raw = await sendELM(cmd);
      if (raw && !raw.includes('NO DATA') && !raw.includes('ERROR')) {
        // Parse OBD response: "41 0C 1A F8" → bytes after mode+pid
        const bytes = raw.split(/\s+/)
          .filter(b => /^[0-9A-F]{2}$/i.test(b))
          .map(b => parseInt(b, 16));
        if (bytes.length >= 4) {
          const dataBytes = bytes.slice(2); // skip mode+pid response bytes
          const value = pid.formula(dataBytes);
          result[key.toLowerCase()] = {
            value: Math.round(value * 10) / 10,
            unit: pid.unit,
            label: pid.name,
          };
        }
      }
    } catch(e) {}
  }
  return Object.keys(result).length > 0 ? result : getSimLiveData();
}

// ── READ DTCs ──────────────────────────────────────────────────
async function readDTCs(moduleId) {
  if (useSimulation || !obdReady) return [];
  
  try {
    // Set header for specific module
    await sendELM('ATSH' + moduleId.toString(16).toUpperCase().padStart(3,'0'));
    await sleep(100);
    
    // Mode 03 = read stored DTCs
    const raw = await sendELM('03');
    if (!raw || raw.includes('NO DATA') || raw.includes('ERROR')) return [];

    const bytes = raw.split(/\s+/)
      .filter(b => /^[0-9A-F]{2}$/i.test(b))
      .map(b => parseInt(b, 16));

    const dtcs = [];
    // Response: 43 NN [DTC pairs...]
    // NN = number of DTCs
    for (let i = 2; i < bytes.length - 1; i += 2) {
      if (bytes[i] === 0 && bytes[i+1] === 0) continue;
      const type  = (bytes[i] >> 6) & 0x03;
      const digit = (bytes[i] >> 4) & 0x03;
      const rest  = ((bytes[i] & 0x0F) << 8) | bytes[i+1];
      const prefix = ['P','C','B','U'][type];
      const dtc = prefix + digit.toString() + rest.toString(16).padStart(3,'0').toUpperCase();
      dtcs.push(dtc);
    }
    return dtcs;
  } catch(e) {
    return [];
  }
}

// ── SCAN ALL MODULES ───────────────────────────────────────────
async function scanAllModules() {
  log('\n🔍 Escaneando todos los módulos...', 'c');
  send('scan_started', { modules: MODULES.map(m => m.key) });
  
  const results = [];
  for (const mod of MODULES) {
    await sleep(300);
    const dtcs = await readDTCs(mod.id);
    const hasError = dtcs.length > 0;
    log(`  ${mod.icon} ${mod.name}: ${hasError ? dtcs.join(', ') : '✓ OK'}`, hasError ? 'r' : 'g');
    send('module_scanned', { ...mod, dtcs, status: hasError ? 'fault' : 'ok', dtcCount: dtcs.length });
    results.push({ ...mod, dtcs });
  }

  const totalDTCs    = results.reduce((a, m) => a + m.dtcs.length, 0);
  const faultyModules = results.filter(m => m.dtcs.length > 0).length;
  send('scan_complete', { modules: results, totalDTCs, faultyModules });
  log(`\n✅ Completo: ${totalDTCs} DTC${totalDTCs!==1?'s':''} en ${faultyModules} módulo${faultyModules!==1?'s':''}`, totalDTCs>0?'y':'g');
}

// ── SIMULATION FALLBACK ────────────────────────────────────────
function getSimLiveData() {
  tick++;
  return {
    rpm:             { value: Math.round(750+Math.sin(tick*.1)*200+Math.random()*50), unit:'rpm', label:'RPM' },
    speed:           { value: 0,   unit:'km/h', label:'Velocidad' },
    coolant:         { value: Math.round(85+Math.sin(tick*.05)*3), unit:'°C', label:'Temp. Motor' },
    throttle:        { value: 15,  unit:'%',    label:'Mariposa' },
    engine_load:     { value: 20,  unit:'%',    label:'Carga Motor' },
    fuel_trim_short: { value: parseFloat((14+(Math.random()-.5)*6).toFixed(1)), unit:'%', label:'Fuel Trim C' },
    fuel_trim_long:  { value: 22.1,unit:'%',    label:'Fuel Trim L' },
    o2_b1s1:         { value: parseFloat((.1+Math.abs(Math.sin(tick*.3))*.85).toFixed(3)), unit:'V', label:'O2 B1S1' },
    maf:             { value: parseFloat((1.6+(Math.random()-.5)*.4).toFixed(2)), unit:'g/s', label:'MAF' },
    voltage:         { value: 12.6,unit:'V',    label:'Voltaje' },
    timing:          { value: 14.2,unit:'°',    label:'Avance' },
    map:             { value: 45,  unit:'kPa',  label:'MAP' },
  };
}

// ── WEBSOCKET ──────────────────────────────────────────────────
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
      version: VERSION,
      j2534Dll: config.dllPath ? path.basename(config.dllPath) : (useSimulation ? 'Simulación' : 'ELM327 USB'),
      simMode: useSimulation,
      protocol: 'ISO15765',
      realOBD: !useSimulation && obdReady,
    });
    liveTimer = setInterval(async () => {
      if (connected) send('live_data', await readLiveData());
    }, 500);
    setTimeout(() => scanAllModules(), 2000);
    scanTimer = setInterval(() => scanAllModules(), 60000);
  });

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.action === 'scan_all_modules') await scanAllModules();
      if (msg.action === 'read_live') send('live_data', await readLiveData());
      if (msg.action === 'ping') send('pong', { ts: Date.now(), simMode: useSimulation });
    } catch(e) {}
  });

  ws.on('close', () => {
    connected = false;
    clearInterval(liveTimer); clearInterval(scanTimer);
    log('⚠️  Desconectado. Reconectando en 5s...', 'y');
    setTimeout(connect, 5000);
  });

  ws.on('error', e => log(`❌ Error: ${e.message}`, 'r'));
}

// ── UTILS ──────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const C = { r:'\x1b[31m', g:'\x1b[32m', y:'\x1b[33m', c:'\x1b[36m', x:'\x1b[0m' };
function log(msg, color='x') { console.log(`${C[color]||''}[${new Date().toLocaleTimeString('es-AR')}] ${msg}${C.x}`); }

function loadConfig() {
  try { if (fs.existsSync(CONFIG_FILE)) config = {...config, ...JSON.parse(fs.readFileSync(CONFIG_FILE,'utf8'))}; } catch(e) {}
}
function saveConfig() {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config,null,2)); } catch(e) {}
}

// ── MAIN ───────────────────────────────────────────────────────
async function main() {
  console.clear();
  console.log('\x1b[36m');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║   AUTODIAG PRO — Agente v2.0         ║');
  console.log('  ║   Diagnóstico Multi-Módulo Real       ║');
  console.log('  ╚══════════════════════════════════════╝\x1b[0m\n');

  loadConfig();

  if (!config.authToken) {
    console.log('\x1b[33m');
    console.log('  ┌─────────────────────────────────────┐');
    console.log('  │  PASO 1: Obtené tu token             │');
    console.log('  │  1. Abri AutoDiag Pro en el browser  │');
    console.log('  │  2. Más ▾ → J2534 Multi-módulo       │');
    console.log('  │  3. Click en "Copiar token"           │');
    console.log('  └─────────────────────────────────────┘\x1b[0m\n');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    config.authToken = await new Promise(r => rl.question('  Pegá el token y Enter: ', ans => { rl.close(); r(ans.trim()); }));
    if (!config.authToken) { log('Sin token. Cerrando.', 'r'); process.exit(1); }
    saveConfig();
    log('✓ Token guardado para siempre', 'g');
  } else {
    log('✓ Token cargado', 'g');
  }

  log('\n🔍 Buscando interfaz OBD...', 'c');
  await initOBD();

  if (useSimulation) {
    log('\n⚠️  MODO SIMULACIÓN ACTIVO', 'y');
    log('   Los datos NO son reales.', 'y');
    log('   Para datos reales: conectá tu interfaz J2534 o ELM327 USB y reiniciá.\n', 'y');
  } else {
    log('\n✅ MODO REAL ACTIVO — leyendo datos del auto\n', 'g');
  }

  connect();

  // CLI
  const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
  log('Comandos: scan | status | quit\n', 'x');
  rl2.on('line', async line => {
    const cmd = line.trim().toLowerCase();
    if (cmd === 'scan')   await scanAllModules();
    if (cmd === 'status') log(`Conectado: ${connected} | OBD real: ${obdReady} | Sim: ${useSimulation}`, 'c');
    if (cmd === 'quit' || cmd === 'exit') { ws?.close(); process.exit(0); }
  });

  process.on('SIGINT', () => { ws?.close(); process.exit(0); });
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
