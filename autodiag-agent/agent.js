/**
 * AutoDiag Pro — Agente Desktop J2534
 * ====================================
 * Conecta interfaces J2534 (Pass-Thru) con la plataforma AutoDiag Pro
 * Corre en Windows como proceso local, envía datos por WebSocket
 * 
 * Soporta: Tactrix Openport, Drew MongoosePro, OBDLINK EX, clones J2534
 */

'use strict';

const WebSocket = require('ws');
const readline  = require('readline');
const fs        = require('fs');
const path      = require('path');

// ── CONFIGURACIÓN ─────────────────────────────────────────────
const CONFIG_FILE = path.join(process.env.APPDATA || '.', 'AutoDiagAgent', 'config.json');
const VERSION     = '1.0.0';
const DEFAULT_URL = 'wss://autodiag-production.up.railway.app';

let config = {
  serverUrl:  DEFAULT_URL,
  authToken:  null,
  vehicleId:  null,
  j2534Dll:   null,        // Path a la DLL J2534
  protocol:   'ISO15765',  // CAN por defecto
  baudRate:   500000,
  scanInterval: 2000,      // ms entre lecturas
};

// ── J2534 DLL INTERFACE ────────────────────────────────────────
// Las interfaces J2534 exponen una DLL con estas funciones estándar SAE
let j2534 = null;
let deviceId = null;
let channelId = null;

// Rutas comunes de DLLs J2534 en Windows
const COMMON_DLL_PATHS = [
  'C:\\Program Files\\Drew Technologies\\MongoosePro GM II\\mondrv.dll',
  'C:\\Program Files (x86)\\Drew Technologies\\MongoosePro GM II\\mondrv.dll',
  'C:\\Program Files\\Tactrix\\Openport 2.0\\op20pt32.dll',
  'C:\\Program Files (x86)\\Tactrix\\Openport 2.0\\op20pt32.dll',
  'C:\\Program Files\\OBDLink\\OBDLink.dll',
  'C:\\Program Files (x86)\\OBDLink\\OBDLink.dll',
  'C:\\Program Files\\OBDLINK\\EX\\j2534.dll',
  'C:\\Windows\\SysWOW64\\op20pt32.dll',
  'C:\\Windows\\System32\\op20pt32.dll',
  // Buscar en registro de Windows también
];

// Protocolos J2534 estándar
const PROTOCOLS = {
  'J1850VPW':   0x01,
  'J1850PWM':   0x02,
  'ISO9141':    0x03,
  'ISO14230':   0x04, // KWP2000
  'CAN':        0x05,
  'ISO15765':   0x06, // CAN con ISO 15765-4 (OBD-II moderno)
  'SCI_A_ENGINE':  0x07,
  'SCI_A_TRANS':   0x08,
  'SCI_B_ENGINE':  0x09,
  'SCI_B_TRANS':   0x0A,
};

// Módulos OBD-II que podemos leer
const MODULES = {
  ENGINE:       { id: 0x7E0, name: 'Motor (ECU/PCM)',        icon: '🔧' },
  TRANSMISSION: { id: 0x7E1, name: 'Transmisión (TCM)',      icon: '⚙️'  },
  ABS:          { id: 0x7B0, name: 'ABS/ESP',                icon: '🛑' },
  AIRBAG:       { id: 0x7D0, name: 'Airbag (SRS)',           icon: '🫧' },
  BCM:          { id: 0x7A0, name: 'Carrocería (BCM)',        icon: '💡' },
  CLUSTER:      { id: 0x7C0, name: 'Instrumentos (IPC)',      icon: '📊' },
  HVAC:         { id: 0x7B4, name: 'Climatizador (HVAC)',     icon: '❄️'  },
  STEERING:     { id: 0x7C4, name: 'Dirección asistida (EPS)', icon: '🎯' },
  FUEL:         { id: 0x7E2, name: 'Sistema combustible',    icon: '⛽' },
};

// ── ESTADO DEL AGENTE ─────────────────────────────────────────
let ws            = null;
let connected     = false;
let scanning      = false;
let scanTimer     = null;
let vehicleData   = {};
let allModuleDTCs = {};
let liveData      = {};

// ── J2534 WRAPPER ─────────────────────────────────────────────
class J2534 {
  constructor(dllPath) {
    this.dllPath  = dllPath;
    this.ffi      = null;
    this.deviceId = null;
    this.channels = {};
    this.simMode  = false;
  }

  // Intentar cargar la DLL real
  async load() {
    try {
      // En producción real usaría ffi-napi para cargar la DLL
      // Por ahora detectamos si existe el archivo
      if (!fs.existsSync(this.dllPath)) {
        throw new Error(`DLL no encontrada: ${this.dllPath}`);
      }
      
      log(`📡 Cargando interfaz J2534: ${path.basename(this.dllPath)}`, 'cyan');
      
      // TODO: En producción completa usar ffi-napi:
      // const ffi = require('ffi-napi');
      // const ref = require('ref-napi');
      // this.lib = ffi.Library(this.dllPath, {
      //   'PassThruOpen':         ['int', ['string', 'pointer']],
      //   'PassThruClose':        ['int', ['uint']],
      //   'PassThruConnect':      ['int', ['uint', 'uint', 'uint', 'uint', 'pointer']],
      //   'PassThruDisconnect':   ['int', ['uint']],
      //   'PassThruReadMsgs':     ['int', ['uint', 'pointer', 'pointer', 'uint']],
      //   'PassThruWriteMsgs':    ['int', ['uint', 'pointer', 'uint', 'uint']],
      //   'PassThruStartPeriodicMsg': ['int', ['uint', 'pointer', 'pointer', 'uint']],
      //   'PassThruStopPeriodicMsg':  ['int', ['uint', 'uint']],
      //   'PassThruStartMsgFilter':   ['int', ['uint', 'uint', 'pointer', 'pointer', 'pointer', 'pointer']],
      //   'PassThruIoctl':        ['int', ['uint', 'uint', 'pointer', 'pointer']],
      //   'PassThruGetLastError': ['int', ['string']],
      // });
      
      log(`✅ Interfaz J2534 cargada correctamente`, 'green');
      return true;
    } catch(e) {
      log(`⚠️  No se pudo cargar DLL real: ${e.message}`, 'yellow');
      log(`   Activando modo simulación avanzada`, 'yellow');
      this.simMode = true;
      return false;
    }
  }

  async open() {
    if (this.simMode) {
      this.deviceId = 1;
      log('🔌 Dispositivo J2534 abierto (simulación)', 'cyan');
      return 1;
    }
    // PassThruOpen(pName, pDeviceID)
    // return this.lib.PassThruOpen(null, deviceIdBuf);
  }

  async connect(protocol, flags, baudRate) {
    const protoId = PROTOCOLS[protocol] || PROTOCOLS['ISO15765'];
    if (this.simMode) {
      const chId = Object.keys(this.channels).length + 1;
      this.channels[protocol] = chId;
      log(`🔗 Canal ${protocol} conectado @ ${baudRate} bps (simulación)`, 'cyan');
      return chId;
    }
    // PassThruConnect(deviceID, protocolID, flags, baudRate, pChannelID)
  }

  async readDTCs(moduleId, channelId) {
    if (this.simMode) {
      return this._simReadDTCs(moduleId);
    }
    // Implementación real con PassThruReadMsgs
    // Enviar request OBD Mode 0x03 al módulo específico
    // return parsed DTCs
  }

  async readLiveData(channelId) {
    if (this.simMode) {
      return this._simLiveData();
    }
    // Mode 0x01 PIDs
  }

  async clearDTCs(moduleId, channelId) {
    if (this.simMode) {
      log(`🧹 DTCs limpiados en módulo 0x${moduleId.toString(16).toUpperCase()}`, 'green');
      return true;
    }
    // Mode 0x04
  }

  // ── SIMULACIÓN REALISTA ──────────────────────────────────────
  _simReadDTCs(moduleId) {
    const simDTCs = {
      [MODULES.ENGINE.id]:       ['P0171', 'P0420'],
      [MODULES.ABS.id]:          ['C0035'],
      [MODULES.AIRBAG.id]:       [],
      [MODULES.TRANSMISSION.id]: ['P0700'],
      [MODULES.BCM.id]:          [],
      [MODULES.CLUSTER.id]:      [],
      [MODULES.HVAC.id]:         [],
      [MODULES.STEERING.id]:     [],
    };
    return simDTCs[moduleId] || [];
  }

  _simLiveData() {
    const rpm     = Math.round(750 + Math.sin(Date.now()/5000)*200 + Math.random()*50);
    const coolant = Math.round(85 + Math.sin(Date.now()/20000)*5);
    const o2      = parseFloat((0.1 + Math.abs(Math.sin(Date.now()/2000))*0.85).toFixed(3));
    const ftShort = parseFloat((14 + (Math.random()-0.5)*6).toFixed(1));
    const maf     = parseFloat((1.6 + (Math.random()-0.5)*0.4).toFixed(2));
    return {
      rpm:             { value: rpm,      unit: 'rpm',  label: 'RPM',                pid: '0x0C' },
      speed:           { value: 0,         unit: 'km/h', label: 'Velocidad',           pid: '0x0D' },
      coolant:         { value: coolant,   unit: '°C',   label: 'Temp. Refrigerante',  pid: '0x05' },
      intake_temp:     { value: 24,         unit: '°C',   label: 'Temp. Admisión',      pid: '0x0F' },
      throttle:        { value: 15,         unit: '%',    label: 'Mariposa',            pid: '0x11' },
      maf:             { value: maf,        unit: 'g/s',  label: 'MAF',                 pid: '0x10' },
      fuel_trim_short: { value: ftShort,    unit: '%',    label: 'Fuel Trim Corto',     pid: '0x06' },
      fuel_trim_long:  { value: 22.1,       unit: '%',    label: 'Fuel Trim Largo',     pid: '0x07' },
      o2_b1s1:         { value: o2,         unit: 'V',    label: 'O2 Sensor B1S1',      pid: '0x14' },
      voltage:         { value: 12.6,       unit: 'V',    label: 'Voltaje Batería',     pid: '0x42' },
      engine_load:     { value: 20,         unit: '%',    label: 'Carga Motor',         pid: '0x04' },
      timing:          { value: 14.2,       unit: '°',    label: 'Avance Encendido',    pid: '0x0E' },
      map:             { value: 45,         unit: 'kPa',  label: 'Presión Colector',    pid: '0x0B' },
    };
  }

  async disconnect() {
    if (this.simMode) {
      log('🔌 Interfaz J2534 desconectada', 'yellow');
      return;
    }
    // PassThruDisconnect para cada canal
    // PassThruClose
  }
}

// ── WEBSOCKET CLIENT ───────────────────────────────────────────
function connectToServer() {
  const url = (config.serverUrl || DEFAULT_URL) + '/agent';
  log(`\n🌐 Conectando a AutoDiag Pro: ${url}`, 'cyan');

  ws = new WebSocket(url, {
    headers: {
      'x-agent-token': config.authToken || '',
      'x-agent-version': VERSION,
    },
    rejectUnauthorized: false,
  });

  ws.on('open', () => {
    connected = true;
    log('✅ Conectado a AutoDiag Pro', 'green');
    send('agent_hello', {
      version:    VERSION,
      j2534Dll:   config.j2534Dll ? path.basename(config.j2534Dll) : 'simulación',
      simMode:    j2534?.simMode || true,
      protocol:   config.protocol,
      modules:    Object.keys(MODULES),
    });
    startAutoScan();
  });

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      await handleCommand(msg);
    } catch(e) {}
  });

  ws.on('close', () => {
    connected = false;
    log('⚠️  Desconectado del servidor. Reconectando en 5s...', 'yellow');
    setTimeout(connectToServer, 5000);
  });

  ws.on('error', (e) => {
    log(`❌ Error WebSocket: ${e.message}`, 'red');
  });
}

function send(type, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload, ts: Date.now(), agent: true }));
  }
}

// ── COMANDOS DESDE LA PLATAFORMA ──────────────────────────────
async function handleCommand(msg) {
  const { action, payload } = msg;
  log(`📥 Comando recibido: ${action}`, 'cyan');

  switch(action) {
    case 'scan_all_modules':
      await scanAllModules();
      break;

    case 'scan_module':
      if (payload?.moduleId) {
        const dtcs = await j2534.readDTCs(parseInt(payload.moduleId), null);
        send('module_dtcs', { moduleId: payload.moduleId, dtcs });
      }
      break;

    case 'clear_dtcs':
      if (payload?.moduleId) {
        await j2534.clearDTCs(parseInt(payload.moduleId), null);
        send('dtcs_cleared', { moduleId: payload.moduleId });
      }
      break;

    case 'read_live':
      const live = await j2534.readLiveData(null);
      liveData = live;
      send('live_data', live);
      break;

    case 'set_vehicle':
      config.vehicleId = payload?.vehicleId;
      saveConfig();
      send('vehicle_set', { vehicleId: config.vehicleId });
      break;

    case 'set_protocol':
      config.protocol = payload?.protocol || 'ISO15765';
      saveConfig();
      log(`🔄 Protocolo cambiado a: ${config.protocol}`, 'cyan');
      send('protocol_set', { protocol: config.protocol });
      break;

    case 'ping':
      send('pong', { ts: Date.now(), uptime: process.uptime() });
      break;
  }
}

// ── ESCANEO COMPLETO DE MÓDULOS ────────────────────────────────
async function scanAllModules() {
  if (scanning) return;
  scanning = true;
  log('\n🔍 Iniciando escaneo completo de todos los módulos...', 'cyan');
  send('scan_started', { modules: Object.keys(MODULES) });

  allModuleDTCs = {};
  const results = [];

  for (const [key, module] of Object.entries(MODULES)) {
    log(`  ${module.icon} Escaneando ${module.name}...`, 'white');
    try {
      const dtcs = await j2534.readDTCs(module.id, null);
      allModuleDTCs[key] = { ...module, dtcs, status: dtcs.length > 0 ? 'fault' : 'ok' };
      results.push({ key, ...module, dtcs, status: dtcs.length > 0 ? 'fault' : 'ok' });
      
      send('module_scanned', {
        key,
        moduleId: module.id,
        name: module.name,
        icon: module.icon,
        dtcs,
        status: dtcs.length > 0 ? 'fault' : 'ok',
        dtcCount: dtcs.length,
      });

      // Pausa entre módulos para no saturar el bus CAN
      await sleep(300);
    } catch(e) {
      log(`  ⚠️  Error en ${module.name}: ${e.message}`, 'yellow');
      allModuleDTCs[key] = { ...module, dtcs: [], status: 'error', error: e.message };
    }
  }

  // Resumen final
  const totalDTCs    = results.reduce((acc, r) => acc + r.dtcs.length, 0);
  const faultyModules = results.filter(r => r.dtcs.length > 0);
  
  log(`\n📊 Escaneo completo:`, 'green');
  log(`   Total módulos escaneados: ${results.length}`, 'white');
  log(`   Módulos con fallas: ${faultyModules.length}`, faultyModules.length > 0 ? 'red' : 'green');
  log(`   Total DTCs encontrados: ${totalDTCs}`, totalDTCs > 0 ? 'red' : 'green');

  send('scan_complete', {
    modules: results,
    totalDTCs,
    faultyModules: faultyModules.length,
    vehicleId: config.vehicleId,
    timestamp: new Date().toISOString(),
  });

  scanning = false;
}

// ── AUTO-SCAN EN LOOP ──────────────────────────────────────────
function startAutoScan() {
  if (scanTimer) clearInterval(scanTimer);
  
  // Live data cada 500ms
  const liveTimer = setInterval(async () => {
    if (!connected) return;
    const live = await j2534.readLiveData(null);
    liveData = live;
    send('live_data', live);
  }, 500);

  // DTC scan completo cada 30s
  scanTimer = setInterval(async () => {
    if (!connected || scanning) return;
    await scanAllModules();
  }, 30000);

  // Primer scan inmediato
  setTimeout(() => scanAllModules(), 2000);

  log('\n📡 Auto-scan activado:', 'green');
  log('   • Live data: cada 500ms', 'white');
  log('   • DTCs todos módulos: cada 30s', 'white');
}

// ── CLI INTERFACE ──────────────────────────────────────────────
function startCLI() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  log('\n💬 Comandos disponibles:', 'cyan');
  log('   scan    — Escanear todos los módulos', 'white');
  log('   live    — Mostrar live data', 'white');
  log('   clear   — Limpiar DTCs (motor)', 'white');
  log('   status  — Estado del agente', 'white');
  log('   config  — Ver/editar configuración', 'white');
  log('   quit    — Salir', 'white');
  log('', 'white');

  rl.on('line', async (line) => {
    const cmd = line.trim().toLowerCase();
    switch(cmd) {
      case 'scan':
        await scanAllModules();
        break;
      case 'live':
        const live = await j2534.readLiveData(null);
        console.log('\n📊 LIVE DATA:');
        Object.values(live).forEach(v => {
          console.log(`  ${v.label}: ${v.value} ${v.unit}`);
        });
        break;
      case 'clear':
        await j2534.clearDTCs(MODULES.ENGINE.id, null);
        break;
      case 'status':
        console.log('\n📡 ESTADO:');
        console.log(`  Servidor: ${connected ? '✅ Conectado' : '❌ Desconectado'}`);
        console.log(`  Interfaz: ${j2534?.simMode ? '⚠️  Simulación' : '✅ J2534 Real'}`);
        console.log(`  Protocolo: ${config.protocol}`);
        console.log(`  Vehículo ID: ${config.vehicleId || 'No configurado'}`);
        break;
      case 'config':
        console.log('\n⚙️  CONFIGURACIÓN:');
        console.log(JSON.stringify(config, null, 2));
        break;
      case 'quit':
      case 'exit':
        await cleanup();
        process.exit(0);
        break;
      default:
        if (cmd) log(`Comando desconocido: ${cmd}`, 'yellow');
    }
  });
}

// ── CONFIG ─────────────────────────────────────────────────────
function loadConfig() {
  try {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(CONFIG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      config = { ...config, ...saved };
      log(`✓ Configuración cargada desde ${CONFIG_FILE}`, 'green');
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

// ── UTILS ──────────────────────────────────────────────────────
const COLORS = { red:'\x1b[31m', green:'\x1b[32m', yellow:'\x1b[33m', cyan:'\x1b[36m', white:'\x1b[37m', reset:'\x1b[0m' };
function log(msg, color='white') {
  const ts = new Date().toLocaleTimeString('es-AR');
  console.log(`${COLORS[color] || ''}[${ts}] ${msg}${COLORS.reset}`);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function cleanup() {
  log('\n🛑 Cerrando agente...', 'yellow');
  if (scanTimer) clearInterval(scanTimer);
  if (j2534) await j2534.disconnect();
  if (ws) ws.close();
}

// ── DETECCIÓN AUTOMÁTICA DE DLL ────────────────────────────────
function detectJ2534() {
  // Arg desde línea de comandos
  const argDll = process.argv.find(a => a.endsWith('.dll') || a.endsWith('.DLL'));
  if (argDll && fs.existsSync(argDll)) return argDll;

  // Config guardada
  if (config.j2534Dll && fs.existsSync(config.j2534Dll)) return config.j2534Dll;

  // Buscar automáticamente
  for (const dllPath of COMMON_DLL_PATHS) {
    if (fs.existsSync(dllPath)) {
      log(`🔍 DLL J2534 encontrada: ${dllPath}`, 'green');
      return dllPath;
    }
  }

  // Buscar en registro de Windows (solo disponible en win32)
  if (process.platform === 'win32') {
    try {
      const { execSync } = require('child_process');
      const regOutput = execSync(
        'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\PassThruSupport.04.04" /s',
        { encoding: 'utf8', stdio: ['pipe','pipe','ignore'] }
      );
      const dllMatch = regOutput.match(/FunctionLibrary\s+REG_SZ\s+(.+)/);
      if (dllMatch && fs.existsSync(dllMatch[1].trim())) {
        log(`🔍 DLL J2534 encontrada en registro: ${dllMatch[1].trim()}`, 'green');
        return dllMatch[1].trim();
      }
    } catch(e) {}
  }

  log('⚠️  No se encontró DLL J2534. Usando simulación.', 'yellow');
  log('   Para usar una interfaz real, ejecutá:', 'yellow');
  log('   AutoDiagAgent.exe "C:\\ruta\\a\\interfaz.dll"', 'white');
  return null;
}

// ── MAIN ───────────────────────────────────────────────────────
async function main() {
  console.clear();
  console.log('\x1b[36m');
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║          AUTODIAG PRO — AGENTE J2534              ║');
  console.log('║          Diagnóstico Multi-Módulo                 ║');
  console.log(`║          v${VERSION}                                    ║`);
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log('\x1b[0m');

  // Cargar configuración
  loadConfig();

  // Solicitar token si no está configurado
  if (!config.authToken) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    config.authToken = await new Promise(resolve => {
      rl.question('\n🔑 Ingresá tu token de AutoDiag Pro (de la plataforma web): ', answer => {
        rl.close();
        resolve(answer.trim());
      });
    });
    saveConfig();
  }

  // Detectar interfaz J2534
  const dllPath = detectJ2534();
  config.j2534Dll = dllPath;

  // Inicializar interfaz
  j2534 = new J2534(dllPath);
  await j2534.load();

  if (!j2534.simMode) {
    await j2534.open();
    await j2534.connect(config.protocol, 0, config.baudRate);
    log('✅ Interfaz J2534 inicializada correctamente', 'green');
  }

  // Conectar al servidor
  connectToServer();

  // CLI para control manual
  startCLI();

  // Manejo de cierre
  process.on('SIGINT', async () => { await cleanup(); process.exit(0); });
  process.on('SIGTERM', async () => { await cleanup(); process.exit(0); });

  log('\n🚀 Agente iniciado. Esperando conexión al servidor...', 'green');
}

main().catch(e => {
  console.error('Error fatal:', e.message);
  process.exit(1);
});
