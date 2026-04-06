/**
 * AutoDiag Pro — Agente Desktop Lite
 * Solo necesita Node.js instalado. Sin dependencias nativas.
 * Conecta con AutoDiag Pro por WebSocket y envía datos OBD-II simulados
 * (soporte J2534 real requiere la versión completa)
 */
'use strict';

const WebSocket  = require('ws');
const readline   = require('readline');
const fs         = require('fs');
const path       = require('path');
const http       = require('http');
const https      = require('https');

const VERSION     = '1.0.0';
const SERVER_URL  = 'wss://autodiag-production.up.railway.app';
const CONFIG_FILE = path.join(__dirname, 'config.json');

let config = { serverUrl: SERVER_URL, authToken: null };
let ws = null;
let connected = false;
let liveTimer = null;
let scanTimer = null;
let tick = 0;

// Load config
function loadConfig() {
  try {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(CONFIG_FILE)) {
      config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    }
  } catch(e) {}
}

function saveConfig() {
  try {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch(e) {}
}

// Colors
const C = { r:'\x1b[31m', g:'\x1b[32m', y:'\x1b[33m', c:'\x1b[36m', w:'\x1b[37m', x:'\x1b[0m' };
function log(msg, color='w') {
  const ts = new Date().toLocaleTimeString('es-AR');
  console.log(`${C[color]}[${ts}] ${msg}${C.x}`);
}

// Simulate live data (replace with real J2534 data in full version)
function getLiveData() {
  tick++;
  const rpm     = Math.round(750 + Math.sin(tick*.1)*200 + Math.random()*50);
  const coolant = Math.round(85 + Math.sin(tick*.05)*3);
  const o2      = parseFloat((.1+Math.abs(Math.sin(tick*.3))*.85).toFixed(3));
  const ftShort = parseFloat((14+(Math.random()-.5)*6).toFixed(1));
  const maf     = parseFloat((1.6+(Math.random()-.5)*.4).toFixed(2));
  return {
    rpm:             { value:rpm,     unit:'rpm', label:'RPM' },
    speed:           { value:0,       unit:'km/h',label:'Velocidad' },
    coolant:         { value:coolant, unit:'°C',  label:'Temp. Refrigerante' },
    intake_temp:     { value:24,      unit:'°C',  label:'Temp. Admisión' },
    throttle:        { value:15,      unit:'%',   label:'Mariposa' },
    maf:             { value:maf,     unit:'g/s', label:'MAF' },
    fuel_trim_short: { value:ftShort, unit:'%',   label:'Fuel Trim C' },
    fuel_trim_long:  { value:22.1,    unit:'%',   label:'Fuel Trim L' },
    o2_b1s1:         { value:o2,      unit:'V',   label:'O2 B1S1' },
    voltage:         { value:12.6,    unit:'V',   label:'Voltaje' },
    engine_load:     { value:20,      unit:'%',   label:'Carga Motor' },
    timing:          { value:14.2,    unit:'°',   label:'Avance' },
    map:             { value:45,      unit:'kPa', label:'MAP' },
  };
}

// Simulate module scan
async function scanModules() {
  const modules = [
    { key:'ENGINE',       id:0x7E0, name:'Motor (ECU/PCM)',      icon:'🔧', dtcs:['P0171','P0420'] },
    { key:'TRANSMISSION', id:0x7E1, name:'Transmisión (TCM)',    icon:'⚙️',  dtcs:[] },
    { key:'ABS',          id:0x7B0, name:'ABS/ESP',              icon:'🛑', dtcs:['C0035'] },
    { key:'AIRBAG',       id:0x7D0, name:'Airbag (SRS)',         icon:'🫧', dtcs:[] },
    { key:'BCM',          id:0x7A0, name:'Carrocería (BCM)',      icon:'💡', dtcs:[] },
    { key:'HVAC',         id:0x7B4, name:'Climatizador',         icon:'❄️',  dtcs:[] },
    { key:'STEERING',     id:0x7C4, name:'Dirección (EPS)',      icon:'🎯', dtcs:[] },
    { key:'CLUSTER',      id:0x7C0, name:'Instrumentos',         icon:'📊', dtcs:[] },
  ];

  send('scan_started', { modules: modules.map(m => m.key) });
  log('🔍 Escaneando todos los módulos...', 'c');

  for (const mod of modules) {
    await sleep(400);
    log(`  ${mod.icon} ${mod.name}: ${mod.dtcs.length > 0 ? mod.dtcs.join(', ') : '✓ OK'}`, mod.dtcs.length > 0 ? 'r' : 'g');
    send('module_scanned', { ...mod, status: mod.dtcs.length > 0 ? 'fault' : 'ok', dtcCount: mod.dtcs.length });
  }

  const totalDTCs = modules.reduce((a, m) => a + m.dtcs.length, 0);
  const faulty    = modules.filter(m => m.dtcs.length > 0).length;
  send('scan_complete', { modules, totalDTCs, faultyModules: faulty });
  log(`\n✅ Escaneo completo: ${totalDTCs} DTCs en ${faulty} módulos`, totalDTCs > 0 ? 'y' : 'g');
}

function send(type, payload) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload, ts: Date.now(), agent: true }));
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function connect() {
  const url = config.serverUrl + '/agent';
  log(`🌐 Conectando a ${url}...`, 'c');

  ws = new WebSocket(url, {
    headers: { 'x-agent-token': config.authToken || '', 'x-agent-version': VERSION },
    rejectUnauthorized: false,
  });

  ws.on('open', () => {
    connected = true;
    log('✅ Conectado a AutoDiag Pro — el panel J2534 está activo en la web', 'g');
    send('agent_hello', { version: VERSION, j2534Dll: 'AutoDiagAgent-Lite', simMode: true });

    // Live data every 500ms
    liveTimer = setInterval(() => { if (connected) send('live_data', getLiveData()); }, 500);
    // Auto scan every 60s
    setTimeout(() => scanModules(), 2000);
    scanTimer = setInterval(() => scanModules(), 60000);
  });

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.action === 'scan_all_modules') await scanModules();
      if (msg.action === 'read_live') send('live_data', getLiveData());
      if (msg.action === 'ping') send('pong', { ts: Date.now() });
    } catch(e) {}
  });

  ws.on('close', () => {
    connected = false;
    clearInterval(liveTimer);
    clearInterval(scanTimer);
    log('⚠️  Desconectado. Reconectando en 5s...', 'y');
    setTimeout(connect, 5000);
  });

  ws.on('error', (e) => log(`❌ Error: ${e.message}`, 'r'));
}

async function main() {
  console.clear();
  console.log('\x1b[36m');
  console.log('╔═══════════════════════════════════════╗');
  console.log('║     AUTODIAG PRO — AGENTE v1.0        ║');
  console.log('║     Diagnóstico Multi-Módulo          ║');
  console.log('╚═══════════════════════════════════════╝\x1b[0m\n');

  loadConfig();

  // Ask for token if not set
  if (!config.authToken) {
    console.log('[33m');
    console.log('  PASO IMPORTANTE:');
    console.log('  ==========================================');
    console.log('  1. Abri AutoDiag Pro en el browser');
    console.log('  2. Ir a: Mas > J2534 Multi-modulo');
    console.log('  3. Click en "Copiar token"');
    console.log('  4. Pega el token aqui abajo');
    console.log('  ==========================================');
    console.log('[0m');
    const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
    config.authToken = await new Promise(r => {
      rl2.question('  Pega tu token y presiona Enter: ', ans => { rl2.close(); r(ans.trim()); });
    });
    if (!config.authToken) {
      console.log('[31m  [Error] No ingresaste un token. Cerrando...[0m');
      process.exit(1);
    }
    saveConfig();
    log('✓ Token guardado. La proxima vez no te lo pedira.', 'g');
  } else {
    log('✓ Token cargado desde configuracion guardada.', 'g');
  }

  log('🚀 Iniciando agente...', 'c');
  connect();

  // Simple CLI
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  log('\nComandos: scan | quit\n', 'w');
  rl.on('line', async (line) => {
    const cmd = line.trim().toLowerCase();
    if (cmd === 'scan') await scanModules();
    if (cmd === 'quit' || cmd === 'exit') { clearInterval(liveTimer); clearInterval(scanTimer); ws?.close(); process.exit(0); }
  });

  process.on('SIGINT', () => { clearInterval(liveTimer); clearInterval(scanTimer); ws?.close(); process.exit(0); });
}

main().catch(e => { console.error('Error fatal:', e.message); process.exit(1); });
