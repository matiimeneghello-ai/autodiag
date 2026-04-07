/**
 * AutoDiag Pro — Agente J2534 v4.0
 * - Usa ffi-napi para llamar RKW_VNCI_PT32.dll DIRECTAMENTE
 * - Lee modulos propietarios Mercedes: ABS, Airbag, BCM, TCM, HVAC, EPS
 * - Fallback a ELM327 serial para OBD-II estandar (solo motor)
 * - NUNCA muestra datos simulados como reales
 */
'use strict';

const WebSocket    = require('ws');
const readline     = require('readline');
const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');

const VERSION     = '4.0.0';
const SERVER_URL  = 'wss://autodiag-production.up.railway.app';
const CONFIG_FILE = path.join(__dirname, 'config.json');

let config        = { serverUrl: SERVER_URL, authToken: null, dllPath: null };
let ws            = null;
let connected     = false;
let liveTimer     = null;
let scanTimer     = null;
let healthTimer   = null;
let tick          = 0;
let useSimulation = true;
let obdReady      = false;
let serialPort    = null;
let j2534lib      = null;   // ffi-napi handle a la DLL
let j2534DeviceId = null;
let j2534ChannelId= null;
let j2534Mode     = false;  // true = usando DLL real

// Constantes J2534
const ISO15765            = 6;
const ISO15765_FRAME_PAD  = 0x0004;
const TX_TIMEOUT          = 500;
const PASSTHRU_MSG_SIZE   = 4152 + 24; // PASSTHRU_MSG struct total

// DLLs conocidas
const KNOWN_DLLS = [
  { name: 'Rockway VNCI Nano J2534', paths: [
    'C:\\Program Files (x86)\\Rockway\\VNCI Nano Driver\\RKW_VNCI_PT32.dll',
    'C:\\Program Files (x86)\\Rockway\\VNCI Nano Driver\\VNCI.dll',
    'C:\\Program Files\\Rockway\\VNCI Nano Driver\\RKW_VNCI_PT32.dll',
    'C:\\Windows\\SysWOW64\\RKW_VNCI_PT32.dll',
  ]},
  { name: 'Tactrix Openport 2.0', paths: [
    'C:\\Program Files\\Tactrix\\Openport 2.0 J2534\\op20pt32.dll',
    'C:\\Program Files (x86)\\Tactrix\\Openport 2.0 J2534\\op20pt32.dll',
  ]},
];

// PIDs OBD-II estandar
const PIDS = {
  rpm:         { cmd:'010C', name:'RPM',           unit:'rpm',  parse: d => ((d[2]*256)+d[3])/4 },
  speed:       { cmd:'010D', name:'Velocidad',      unit:'km/h', parse: d => d[2] },
  coolant:     { cmd:'0105', name:'Temp. Motor',    unit:'C',    parse: d => d[2]-40 },
  throttle:    { cmd:'0111', name:'Mariposa',       unit:'%',    parse: d => d[2]*100/255 },
  engine_load: { cmd:'0104', name:'Carga Motor',    unit:'%',    parse: d => d[2]*100/255 },
  fuel_short:  { cmd:'0106', name:'Fuel Trim C',    unit:'%',    parse: d => (d[2]-128)*100/128 },
  fuel_long:   { cmd:'0107', name:'Fuel Trim L',    unit:'%',    parse: d => (d[2]-128)*100/128 },
  o2_b1s1:     { cmd:'0114', name:'O2 B1S1',        unit:'V',    parse: d => d[2]/200 },
  maf:         { cmd:'0110', name:'MAF',            unit:'g/s',  parse: d => ((d[2]*256)+d[3])/100 },
  intake_temp: { cmd:'010F', name:'Temp. Admision', unit:'C',    parse: d => d[2]-40 },
  voltage:     { cmd:'0142', name:'Voltaje',        unit:'V',    parse: d => ((d[2]*256)+d[3])/1000 },
};

// Mercedes GLK300 2012 - modulos CAN
const MODULES = [
  { key:'ENGINE',       id:0x7E0, tester:0x7E8, name:'Motor (ECU/PCM)',     icon:'M', stdOBD:true  },
  { key:'TRANSMISSION', id:0x7E1, tester:0x7E9, name:'Transmision (TCM)',   icon:'T', stdOBD:false },
  { key:'ABS',          id:0x7A0, tester:0x7A8, name:'ABS / ESP',           icon:'A', stdOBD:false },
  { key:'AIRBAG',       id:0x7B0, tester:0x7B8, name:'Airbag (SRS)',        icon:'S', stdOBD:false },
  { key:'BCM',          id:0x720, tester:0x728, name:'Carroceria (BCM)',     icon:'B', stdOBD:false },
  { key:'HVAC',         id:0x7C0, tester:0x7C8, name:'Climatizador (HVAC)', icon:'H', stdOBD:false },
  { key:'STEERING',     id:0x730, tester:0x738, name:'Direccion (EPS)',      icon:'E', stdOBD:false },
  { key:'CLUSTER',      id:0x740, tester:0x748, name:'Instrumentos (IPC)',   icon:'I', stdOBD:false },
];

// ============================================================
// J2534 via ffi-napi
// ============================================================
function loadJ2534DLL(dllPath) {
  try {
    const ffi = require('ffi-napi');
    const ref = require('ref-napi');
    const ulong   = ref.types.ulong;
    const uint    = ref.types.uint;
    const voidPtr = ref.refType(ref.types.void);
    const lib = ffi.Library(dllPath, {
      'PassThruOpen':           [ ulong, [ voidPtr, ref.refType(ulong) ] ],
      'PassThruClose':          [ ulong, [ ulong ] ],
      'PassThruConnect':        [ ulong, [ ulong, ulong, ulong, ulong, ref.refType(ulong) ] ],
      'PassThruDisconnect':     [ ulong, [ ulong ] ],
      'PassThruReadMsgs':       [ ulong, [ ulong, voidPtr, ref.refType(ulong), ulong ] ],
      'PassThruWriteMsgs':      [ ulong, [ ulong, voidPtr, ref.refType(ulong), ulong ] ],
      'PassThruStartMsgFilter': [ ulong, [ ulong, uint, voidPtr, voidPtr, voidPtr, ref.refType(ulong) ] ],
    });
    log('ffi-napi cargo la DLL J2534 OK', 'g');
    return lib;
  } catch (e) {
    log('ffi-napi no disponible: ' + e.message, 'y');
    log('Usando ELM327 serial (solo modulo motor)', 'y');
    return null;
  }
}

function buildMsg(arbId, dataBytes) {
  const buf = Buffer.alloc(PASSTHRU_MSG_SIZE, 0);
  buf.writeUInt32LE(ISO15765,           0);   // ProtocolID
  buf.writeUInt32LE(0,                  4);   // RxStatus
  buf.writeUInt32LE(ISO15765_FRAME_PAD, 8);   // TxFlags
  buf.writeUInt32LE(0,                 12);   // Timestamp
  buf.writeUInt32LE(dataBytes.length + 4, 16); // DataSize
  buf.writeUInt32LE(0,                 20);   // ExtraDataIndex
  buf.writeUInt32BE(arbId,             24);   // ArbId big-endian
  dataBytes.copy(buf, 28);
  return buf;
}

async function j2534SR(txId, rxId, data, timeoutMs = 600) {
  if (!j2534lib || !j2534ChannelId) return null;
  try {
    const ref   = require('ref-napi');
    const ulong = ref.types.ulong;
    const txMsg = buildMsg(txId, data);
    const n     = ref.alloc(ulong, 1);
    if (j2534lib.PassThruWriteMsgs(j2534ChannelId, txMsg, n, TX_TIMEOUT) !== 0) return null;
    const rxMsg   = Buffer.alloc(PASSTHRU_MSG_SIZE, 0);
    const rxCount = ref.alloc(ulong, 1);
    const dead    = Date.now() + timeoutMs;
    while (Date.now() < dead) {
      const ret = j2534lib.PassThruReadMsgs(j2534ChannelId, rxMsg, rxCount, 100);
      if (ret !== 0 || rxCount.deref() === 0) { await sleep(20); continue; }
      const sz  = rxMsg.readUInt32LE(16);
      const arb = rxMsg.readUInt32BE(24);
      if (arb === rxId && sz > 4) return rxMsg.slice(28, 28 + sz - 4);
      await sleep(10);
    }
    return null;
  } catch (e) { return null; }
}

async function initJ2534(dllPath) {
  if (!dllPath || !fs.existsSync(dllPath)) { log('DLL no encontrada: ' + dllPath, 'y'); return false; }
  log('Cargando DLL J2534: ' + path.basename(dllPath), 'c');
  j2534lib = loadJ2534DLL(dllPath);
  if (!j2534lib) return false;
  try {
    const ref   = require('ref-napi');
    const ulong = ref.types.ulong;
    const devBuf = ref.alloc(ulong);
    if (j2534lib.PassThruOpen(ref.NULL, devBuf) !== 0) { log('PassThruOpen fallo', 'r'); return false; }
    j2534DeviceId = devBuf.deref();
    log('PassThruOpen OK - device: ' + j2534DeviceId, 'g');
    const chBuf = ref.alloc(ulong);
    let ret = j2534lib.PassThruConnect(j2534DeviceId, ISO15765, 0, 500000, chBuf);
    if (ret !== 0) {
      log('CAN 500k fallo (' + ret + '), probando 250k...', 'y');
      ret = j2534lib.PassThruConnect(j2534DeviceId, ISO15765, 0, 250000, chBuf);
    }
    if (ret !== 0) { log('PassThruConnect fallo: ' + ret, 'r'); j2534lib.PassThruClose(j2534DeviceId); j2534DeviceId = null; return false; }
    j2534ChannelId = chBuf.deref();
    log('PassThruConnect OK - channel: ' + j2534ChannelId, 'g');
    // Filtro paso libre
    const filterId = ref.alloc(ulong);
    const zeroMsg  = buildMsg(0, Buffer.alloc(4, 0));
    j2534lib.PassThruStartMsgFilter(j2534ChannelId, 1, zeroMsg, zeroMsg, ref.NULL, filterId);
    j2534Mode     = true;
    obdReady      = true;
    useSimulation = false;
    log('J2534 listo - TODOS los modulos Mercedes accesibles', 'g');
    return true;
  } catch (e) { log('Error init J2534: ' + e.message, 'r'); return false; }
}

async function readDTCsJ2534(mod) {
  // UDS 0x19 0x02 0xFF = ReadDTCByStatusMask todos los estados
  let resp = await j2534SR(mod.id, mod.tester, Buffer.from([0x19, 0x02, 0xFF]), 1000);
  if (!resp) {
    // Fallback OBD-II Mode 03
    resp = await j2534SR(mod.id, mod.tester, Buffer.from([0x02, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), 1000);
  }
  if (!resp) return null;
  const dtcs = [];
  if (resp[0] === 0x59 && resp[1] === 0x02) {
    for (let i = 3; i + 1 < resp.length; i += 3) {
      const b1 = resp[i], b2 = resp[i+1];
      if (!b1 && !b2) continue;
      const prefix = ['P','C','B','U'][(b1>>6)&3];
      const rest   = ((b1&0x0F)<<8)|b2;
      const code   = prefix + ((b1>>4)&3) + rest.toString(16).padStart(3,'0').toUpperCase();
      if (!dtcs.includes(code)) dtcs.push(code);
    }
  } else if (resp[0] === 0x43) {
    for (let i = 1; i + 1 < resp.length; i += 2) {
      const b1 = resp[i], b2 = resp[i+1];
      if (!b1 && !b2) continue;
      const prefix = ['P','C','B','U'][(b1>>6)&3];
      const rest   = ((b1&0x0F)<<8)|b2;
      const code   = prefix + ((b1>>4)&3) + rest.toString(16).padStart(3,'0').toUpperCase();
      if (!dtcs.includes(code)) dtcs.push(code);
    }
  } else if (resp[0] === 0x7F) {
    log('   NRC UDS: 0x' + (resp[2]||0).toString(16).toUpperCase(), 'y');
    return []; // modulo respondio pero rechazo el servicio
  }
  return dtcs;
}

// ============================================================
// SERIAL / ELM327
// ============================================================
async function initSerial() {
  try {
    const { SerialPort } = require('serialport');
    const ports = await SerialPort.list();
    log(ports.length + ' puerto(s) serie encontrado(s)', 'c');
    ports.forEach(p => log('   ' + p.path + ' - ' + (p.manufacturer||'?') + ' ' + (p.vendorId||''), 'x'));
    const candidates = ports.filter(p =>
      p.manufacturer?.includes('FTDI') || p.manufacturer?.includes('Silicon') ||
      p.manufacturer?.includes('CH340') || p.manufacturer?.includes('Prolific') ||
      p.manufacturer?.includes('Microsoft') ||
      ['0403','10c4','1a86','067b'].includes(p.vendorId)
    );
    if (!candidates.length) { log('No se encontro interfaz serial compatible', 'y'); return false; }
    for (const port of candidates) {
      log('Probando ' + port.path + '...', 'c');
      try { if (await tryConnectSerial(port.path)) { log('Conectado via serial ' + port.path, 'g'); return true; } }
      catch(e) { log('   ' + port.path + ' fallo: ' + e.message, 'y'); }
    }
    return false;
  } catch(e) { if (e.code !== 'MODULE_NOT_FOUND') log('Error serial: ' + e.message, 'y'); return false; }
}

async function tryConnectSerial(portPath) {
  const { SerialPort } = require('serialport');
  const sp = new SerialPort({ path: portPath, baudRate: 38400, autoOpen: false });
  await new Promise((res,rej) => sp.open(e => e ? rej(e) : res()));
  const r = await sendCmd(sp, 'ATI', 1500);
  if (!r || (!r.includes('ELM') && !r.includes('OBD') && !r.includes('OK'))) { sp.close(); return false; }
  log('   ATI: ' + r.trim(), 'g');
  await sendCmd(sp, 'ATZ',   3000); await sleep(1000);
  await sendCmd(sp, 'ATE0',  500);
  await sendCmd(sp, 'ATL0',  500);
  await sendCmd(sp, 'ATS0',  500);
  await sendCmd(sp, 'ATH1',  500);
  await sendCmd(sp, 'ATAT2', 500);
  await sendCmd(sp, 'ATST64',500);
  for (const proto of [
    { code:'6', name:'ISO 15765-4 CAN 500kbps' },
    { code:'0', name:'Auto' },
    { code:'A', name:'ISO 15765-4 CAN 250kbps' },
  ]) {
    log('   Proto ' + proto.code + ': ' + proto.name, 'c');
    await sendCmd(sp, 'ATSP' + proto.code, 500); await sleep(300);
    const t = await sendCmd(sp, '0100', 5000);
    if (t && t.includes('41')) { log('   OK protocolo ' + proto.code, 'g'); break; }
  }
  const fin = await sendCmd(sp, '0100', 3000);
  if (!fin || !fin.includes('41')) { log('   ECU no responde', 'r'); sp.close(); return false; }
  serialPort    = sp;
  obdReady      = true;
  useSimulation = false;
  sp.on('close', () => {
    log('INTERFAZ DESCONECTADA FISICAMENTE', 'r');
    obdReady = false; useSimulation = true; serialPort = null;
    send('agent_status', { connected:true, obdConnected:false, simMode:true, warning:'Interfaz OBD desconectada del USB' });
  });
  sp.on('error', err => { log('Error interfaz: ' + err.message, 'r'); obdReady = false; });
  return true;
}

function sendCmd(sp, cmd, timeout=2000) {
  return new Promise((resolve) => {
    if (!sp?.isOpen) { resolve(null); return; }
    let buffer = '';
    const timer = setTimeout(() => { try { sp.removeAllListeners('data'); } catch(e) {} resolve(buffer||null); }, timeout);
    try { sp.write(cmd + '\r', err => { if (err) { clearTimeout(timer); resolve(null); } }); }
    catch(e) { clearTimeout(timer); resolve(null); return; }
    const onData = chunk => {
      buffer += chunk.toString();
      if (buffer.includes('>')) {
        clearTimeout(timer);
        try { sp.removeListener('data', onData); } catch(e) {}
        resolve(buffer.replace(/>/g,'').trim());
      }
    };
    sp.on('data', onData);
  });
}

async function readDTCsSerial(moduleId) {
  if (!serialPort?.isOpen) return null;
  try {
    await sendCmd(serialPort, 'ATSH' + moduleId.toString(16).toUpperCase(), 300);
    await sleep(100);
    const raw = await sendCmd(serialPort, '03', 4000);
    if (!raw || raw.includes('NO DATA') || raw.includes('ERROR') || raw.includes('UNABLE')) return null;
    const bytes = raw.split(/\s+/).filter(b => /^[0-9A-F]{2}$/i.test(b)).map(b => parseInt(b,16));
    const dtcs = [];
    const start = bytes.findIndex(b => b === 0x43) + 2;
    if (start < 2) return null;
    for (let i = start; i + 1 < bytes.length; i += 2) {
      if (!bytes[i] && !bytes[i+1]) continue;
      const prefix = ['P','C','B','U'][(bytes[i]>>6)&3];
      const rest   = ((bytes[i]&0x0F)<<8)|bytes[i+1];
      const code   = prefix + ((bytes[i]>>4)&3) + rest.toString(16).padStart(3,'0').toUpperCase();
      if (!dtcs.includes(code)) dtcs.push(code);
    }
    return dtcs;
  } catch(e) { return null; }
}

// ============================================================
// LIVE DATA
// ============================================================
async function readLiveData() {
  if (useSimulation || !obdReady) return { _noData:true, _reason:'Sin conexion OBD real' };
  const result = {};
  if (j2534Mode && j2534ChannelId) {
    const eng = MODULES.find(m => m.key === 'ENGINE');
    for (const [key, pid] of Object.entries(PIDS)) {
      const svc = parseInt(pid.cmd.slice(0,2),16);
      const p   = parseInt(pid.cmd.slice(2,4),16);
      const resp = await j2534SR(eng.id, eng.tester, Buffer.from([0x02,svc,p,0,0,0,0,0]), 400);
      if (!resp || resp.length < 3) continue;
      const bytes = Array.from(resp);
      if (bytes[0] === svc+0x40 && bytes[1] === p) {
        const val = pid.parse(bytes);
        if (!isNaN(val) && isFinite(val)) result[key] = { value: Math.round(val*10)/10, unit: pid.unit, label: pid.name };
      }
    }
  } else if (serialPort?.isOpen) {
    for (const [key, pid] of Object.entries(PIDS)) {
      try {
        const raw = await sendCmd(serialPort, pid.cmd, 1500);
        if (!raw || raw.includes('NO DATA') || raw.includes('ERROR')) continue;
        const bytes = raw.split(/\s+/).filter(b => /^[0-9A-F]{2}$/i.test(b)).map(b => parseInt(b,16));
        if (bytes.length >= 3) { const val = pid.parse(bytes); if (!isNaN(val) && isFinite(val)) result[key] = { value:Math.round(val*10)/10, unit:pid.unit, label:pid.name }; }
      } catch(e) {}
    }
  }
  if (Object.keys(result).length < 2) return { _noData:true, _reason:'ECU no responde (auto apagado o protocolo incorrecto)' };
  return result;
}

// ============================================================
// SCAN ALL MODULES
// ============================================================
async function scanAllModules() {
  if (!obdReady || (!j2534Mode && !serialPort?.isOpen)) {
    log('Sin conexion OBD real - escaneo cancelado', 'r');
    send('scan_error', { reason:'Sin conexion OBD real. Conecta la VNCI Nano al USB y al OBD-II del auto, y encende el auto (contacto).' });
    return;
  }
  const mode = j2534Mode ? 'J2534 DLL (todos los modulos)' : 'ELM327 serial (solo motor)';
  log('Escaneando - modo: ' + mode, 'c');
  send('scan_started', { modules: MODULES.map(m => m.key), realData:true, mode });
  
  // VIN
  let vin = null;
  if (j2534Mode) {
    const eng = MODULES.find(m => m.key === 'ENGINE');
    const vr = await j2534SR(eng.id, eng.tester, Buffer.from([0x02,0x09,0x02,0,0,0,0,0]), 2000);
    if (vr) {
      vin = Array.from(vr).slice(3).map(b => String.fromCharCode(b)).filter(c => /[\w]/.test(c)).join('');
      if (vin.length < 10) vin = null;
    }
  } else if (serialPort?.isOpen) {
    const vresp = await sendCmd(serialPort, '0902', 5000);
    if (vresp && !vresp.includes('NO DATA')) {
      let vinHex = '';
      for (const line of vresp.split('\n').map(l=>l.trim()).filter(Boolean)) {
        const bytes = line.split(/\s+/).filter(b => /^[0-9A-F]{2}$/i.test(b));
        vinHex += bytes.slice(2).join('');
      }
      const c = vinHex.match(/.{2}/g)?.map(h=>String.fromCharCode(parseInt(h,16))).filter(c=>/[\w]/.test(c)).join('');
      vin = c?.length >= 10 ? c : null;
    }
  }
  if (vin) { log('VIN: ' + vin, 'g'); send('vehicle_vin', { vin }); }
  else log('VIN: no disponible', 'y');

  const results = [];
  for (const mod of MODULES) {
    await sleep(300);
    log(mod.key + ' - ' + mod.name + '...', 'x');
    let dtcs = null;
    let accessMethod = 'N/A';
    if (j2534Mode) { dtcs = await readDTCsJ2534(mod); accessMethod = 'J2534'; }
    else if (mod.stdOBD && serialPort?.isOpen) { dtcs = await readDTCsSerial(mod.id); accessMethod = 'ELM327'; }
    else { accessMethod = 'requiere_dll'; }
    
    const responded = dtcs !== null;
    const hasFault  = dtcs?.length > 0;
    let status;
    if (!responded && !j2534Mode && !mod.stdOBD) { status = 'requires_dll'; log('   Requiere DLL J2534', 'y'); }
    else if (!responded) { status = 'no_response'; log('   Sin respuesta', 'y'); }
    else if (hasFault)   { status = 'fault'; log('   FALLA: ' + dtcs.join(', '), 'r'); }
    else                 { status = 'ok'; log('   Sin fallas', 'g'); }
    
    send('module_scanned', { ...mod, id:mod.id.toString(16).toUpperCase(), dtcs:dtcs||[], status, dtcCount:dtcs?.length||0, realData:true, responded, accessMethod, j2534Mode });
    results.push({ ...mod, dtcs:dtcs||[], responded, status });
  }
  
  const resp2 = results.filter(m => m.responded);
  const total = results.reduce((a,m) => a+(m.dtcs?.length||0), 0);
  const faulty= results.filter(m => m.dtcs?.length > 0).length;
  const reqDll= results.filter(m => m.status==='requires_dll').length;
  log('SCAN COMPLETO - ' + resp2.length + '/' + MODULES.length + ' modulos, ' + total + ' DTC(s)', total>0?'y':'g');
  if (reqDll) log(reqDll + ' modulos propietarios requieren DLL J2534', 'y');
  send('scan_complete', { modules:results.map(m=>({...m,id:m.id.toString(16).toUpperCase()})), totalDTCs:total, faultyModules:faulty, modulesResponded:resp2.length, realData:true, mode:j2534Mode?'j2534':'serial', requiresDll:reqDll });
}

// ============================================================
// WEBSOCKET
// ============================================================
function send(type, payload) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, payload, ts:Date.now(), agent:true }));
}

function connect() {
  ws = new WebSocket(config.serverUrl + '/agent', {
    headers: { 'x-agent-token':config.authToken||'', 'x-agent-version':VERSION },
    rejectUnauthorized: false,
  });
  ws.on('open', () => {
    connected = true;
    log('Conectado a AutoDiag Pro', 'g');
    send('agent_hello', { version:VERSION, j2534Dll:config.dllPath?path.basename(config.dllPath):null, j2534Mode, simMode:useSimulation, obdReady, protocol:j2534Mode?'J2534/ISO15765':'ELM327/serial', realOBD:!useSimulation&&obdReady, canModules:j2534Mode?'TODOS':'SOLO MOTOR' });
    liveTimer = setInterval(async () => {
      if (!connected) return;
      const data = await readLiveData();
      if (data._noData) send('obd_status', { obdConnected:false, reason:data._reason });
      else send('live_data', { ...data, obdConnected:true, simMode:false });
    }, 500);
    setTimeout(() => scanAllModules(), 3000);
    scanTimer   = setInterval(() => scanAllModules(), 60000);
    healthTimer = setInterval(() => {
      if (j2534Mode) { if (!j2534lib||!j2534ChannelId) { obdReady=false; useSimulation=true; j2534Mode=false; send('obd_disconnected',{reason:'J2534 perdio conexion'}); } }
      else if (!serialPort?.isOpen && obdReady) { obdReady=false; useSimulation=true; send('obd_disconnected',{reason:'Serial port closed'}); }
    }, 10000);
  });
  ws.on('message', async raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.action === 'scan_all_modules') await scanAllModules();
      if (msg.action === 'read_live') send('live_data', await readLiveData());
      if (msg.action === 'ping') send('pong', { ts:Date.now(), simMode:useSimulation, obdReady, j2534Mode });
    } catch(e) {}
  });
  ws.on('close', () => {
    connected = false;
    clearInterval(liveTimer); clearInterval(scanTimer); clearInterval(healthTimer);
    log('Desconectado. Reconectando en 5s...', 'y');
    setTimeout(connect, 5000);
  });
  ws.on('error', e => log('WebSocket error: ' + e.message, 'r'));
}

// ============================================================
// UTILS
// ============================================================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const C = { r:'\x1b[31m', g:'\x1b[32m', y:'\x1b[33m', c:'\x1b[36m', x:'\x1b[0m' };
function log(msg, color='x') { console.log((C[color]||'') + '[' + new Date().toLocaleTimeString('es-AR') + '] ' + msg + C.x); }
function loadConfig() { try { if (fs.existsSync(CONFIG_FILE)) config = {...config,...JSON.parse(fs.readFileSync(CONFIG_FILE,'utf8'))}; } catch(e) {} }
function saveConfig() { try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config,null,2)); } catch(e) {} }
function findDLL() {
  try {
    for (const key of ['HKEY_LOCAL_MACHINE\\SOFTWARE\\PassThruSupport.04.04','HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\PassThruSupport.04.04']) {
      try {
        const out = execSync('reg query "' + key + '" /s 2>nul', {encoding:'utf8',timeout:3000});
        const m   = out.match(/FunctionLibrary\s+REG_SZ\s+(.+)/);
        if (m && fs.existsSync(m[1].trim())) { log('DLL en registro: ' + m[1].trim(), 'g'); return m[1].trim(); }
      } catch(e) {}
    }
  } catch(e) {}
  for (const iface of KNOWN_DLLS)
    for (const p of iface.paths)
      if (fs.existsSync(p)) { log(iface.name + ': ' + p, 'g'); return p; }
  return null;
}
function cleanup() {
  try { if (j2534lib && j2534ChannelId) j2534lib.PassThruDisconnect(j2534ChannelId); } catch(e) {}
  try { if (j2534lib && j2534DeviceId)  j2534lib.PassThruClose(j2534DeviceId);       } catch(e) {}
  if (ws) ws.close();
  process.exit(0);
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.clear();
  console.log('\x1b[36m');
  console.log('  +==========================================+');
  console.log('  |  AUTODIAG PRO -- Agente v4.0             |');
  console.log('  |  J2534 DLL real + ELM327 fallback        |');
  console.log('  +==========================================+\x1b[0m\n');
  
  loadConfig();
  
  if (!config.authToken) {
    console.log('\x1b[33m  PEGAR: CLICK DERECHO en esta ventana\x1b[0m\n');
    const rl = readline.createInterface({ input:process.stdin, output:process.stdout });
    config.authToken = await new Promise(r => rl.question('  Token (click derecho) y Enter: ', ans => { rl.close(); r(ans.trim()); }));
    if (!config.authToken) { log('Sin token. Cerrando.','r'); process.exit(1); }
    saveConfig(); log('Token guardado','g');
  } else { log('Token cargado','g'); }

  const dllPath = (config.dllPath && fs.existsSync(config.dllPath)) ? config.dllPath : findDLL();
  if (dllPath) {
    log('DLL J2534 encontrada: ' + path.basename(dllPath), 'g');
    config.dllPath = dllPath; saveConfig();
    const ok = await initJ2534(dllPath);
    if (ok) log('MODO J2534 ACTIVO - acceso a TODOS los modulos', 'g');
    else    log('J2534 no inicio - intentando serial...', 'y');
  }

  if (!j2534Mode) {
    log('Buscando interfaz OBD en puertos serie...', 'c');
    const sok = await initSerial();
    if (sok) { log('MODO SERIAL (ELM327) - solo modulo motor', 'g'); log('Para ABS/Airbag/BCM necesitas DLL J2534 compilada', 'y'); }
    else      { log('Sin conexion OBD - agente en espera', 'y'); log('Conecta la VNCI Nano al USB y al OBD-II del auto', 'y'); }
  }

  connect();

  const rl2 = readline.createInterface({ input:process.stdin, output:process.stdout });
  log('Comandos: scan | status | quit\n', 'x');
  rl2.on('line', async line => {
    const cmd = line.trim().toLowerCase();
    if (cmd === 'scan')   await scanAllModules();
    if (cmd === 'status') {
      log('Servidor: ' + (connected?'OK':'Desconectado'), connected?'g':'r');
      log('OBD:      ' + (obdReady?'Activo':'Sin conexion'), obdReady?'g':'r');
      log('Modo:     ' + (j2534Mode?'J2534 DLL (todos los modulos)':'ELM327 serial (solo motor)'), j2534Mode?'g':'y');
    }
    if (cmd === 'quit') cleanup();
  });

  process.on('SIGINT',  cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch(e => { console.error('Error fatal:', e.message); process.exit(1); });
