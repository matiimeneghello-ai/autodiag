require('dotenv').config();
const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const cors      = require('cors');
const path      = require('path');
const crypto    = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

let db  = null;
let obd = null;

// ── AUTH ──────────────────────────────────────────────────────
function generateToken() { return crypto.randomBytes(32).toString('hex'); }
// Sessions stored in PostgreSQL (not in-memory) — survive server restarts

// ── OBD SIMULATION ────────────────────────────────────────────
function createSimOBD() {
  const { EventEmitter } = require('events');
  const em = new EventEmitter();
  let liveData = {};
  let history = [];
  let interval = null;
  let tick = 0;

  const sim = {
    isConnected: () => true,
    simMode: true,
    getLiveData: () => liveData,
    getHistory: () => history.slice(-60),
    getDTCs: () => ['P0171','P0420','P0441'],
    vinCode: null,
    protocol: 'SIMULACION',
    on: (e,cb) => em.on(e,cb),
    removeListener: (e,cb) => em.removeListener(e,cb),
    readDTCs: async () => ['P0171','P0420','P0441'],
    clearDTCs: async () => true,
    readFreezeFrame: async () => ({
      rpm:             { value:750,  unit:'rpm', label:'RPM al fallar' },
      speed:           { value:0,    unit:'km/h',label:'Velocidad' },
      coolant:         { value:87,   unit:'°C',  label:'Temp. Refrigerante' },
      fuel_trim_short: { value:18.4, unit:'%',   label:'Fuel Trim Corto' },
      fuel_trim_long:  { value:22.1, unit:'%',   label:'Fuel Trim Largo' },
      o2_b1s1:         { value:0.89, unit:'V',   label:'O2 Sensor B1S1' },
    }),
    startSimulation() {
      em.emit('dtcs', ['P0171','P0420','P0441']);
      interval = setInterval(() => {
        tick++;
        const rpm = Math.round(750 + Math.sin(tick * 0.1) * 200 + (Math.random()-.5)*50);
        const coolant = Math.round(85 + Math.sin(tick * 0.05) * 3);
        const o2 = parseFloat((.1 + Math.abs(Math.sin(tick * 0.3)) * .85).toFixed(3));
        const ftShort = parseFloat((14+(Math.random()-.5)*6).toFixed(1));
        const maf = parseFloat((1.6+(Math.random()-.5)*.4).toFixed(2));
        const load = Math.round(20 + Math.sin(tick * 0.08) * 10);

        liveData = {
          rpm:             { value: rpm,     unit:'rpm',  label:'RPM' },
          speed:           { value: 0,        unit:'km/h', label:'Velocidad' },
          coolant:         { value: coolant,  unit:'°C',   label:'Temp. Refrigerante' },
          intake_temp:     { value: 24,        unit:'°C',   label:'Temp. Admisión' },
          throttle:        { value: 15,        unit:'%',    label:'Mariposa' },
          map:             { value: 45,        unit:'kPa',  label:'MAP' },
          maf:             { value: maf,       unit:'g/s',  label:'MAF' },
          fuel_trim_short: { value: ftShort,   unit:'%',    label:'Fuel Trim C' },
          fuel_trim_long:  { value: 22.1,      unit:'%',    label:'Fuel Trim L' },
          o2_b1s1:         { value: o2,        unit:'V',    label:'O2 B1S1' },
          o2_b1s2:         { value: parseFloat((.6+Math.random()*.3).toFixed(3)), unit:'V', label:'O2 B1S2' },
          voltage:         { value: 12.6,      unit:'V',    label:'Voltaje' },
          engine_load:     { value: load,      unit:'%',    label:'Carga Motor' },
          timing:          { value: 14.2,      unit:'°',    label:'Avance' },
        };
        if (tick % 2 === 0) {
          history.push({ ts: Date.now(), rpm, coolant, o2, load, ftShort });
          if (history.length > 120) history.shift();
        }
        em.emit('liveData', liveData);
      }, 300);
    },
    stopSimulation() { if(interval) clearInterval(interval); }
  };
  return sim;
}

// ── INIT ──────────────────────────────────────────────────────
async function loadModules() {
  try {
    db = require('./db');
    await db.connectDB();
    console.log('✓ PostgreSQL conectado');
    try {
      const { importDTCDatabase } = require('../db/import_dtc');
      await importDTCDatabase(db);
    } catch(ie) { console.log('⚠ DTC import:', ie.message); }
  } catch(e) {
    console.error('✗ PostgreSQL:', e.message);
    db = null;
  }

  try {
    if (process.env.OBD_HOST) {
      obd = require('./obd');
      await obd.connect({ type: process.env.OBD_TYPE||'wifi', host: process.env.OBD_HOST, port: parseInt(process.env.OBD_PORT)||35000 });
    } else throw new Error('Sin OBD_HOST');
  } catch(e) {
    obd = createSimOBD();
    obd.startSimulation();
    console.log('⚡ Modo simulación OBD-II');
  }

  obd.on('liveData', data => broadcast('live_data', data));
  obd.on('dtcs',     data => broadcast('dtcs', { codes: data, count: data.length }));
}

// ── WEBSOCKET ─────────────────────────────────────────────────
const clients = new Map();
function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, ts: Date.now() });
  wss.clients.forEach(ws => { if(ws.readyState===1) ws.send(msg); });
}
function sendTo(ws, type, payload) {
  if(ws.readyState===1) ws.send(JSON.stringify({type, payload, ts: Date.now()}));
}

wss.on('connection', (ws) => {
  const id = uuidv4();
  clients.set(id, { ws, vehicleId: null });
  sendTo(ws, 'connected', {
    clientId: id, sim_mode: obd?.simMode || true,
    live_data: obd?.getLiveData() || {}, dtcs: obd?.getDTCs() || [],
    history: obd?.getHistory ? obd.getHistory() : [],
  });
  ws.on('message', async (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch(e) { return; }
    const { action, payload } = msg;
    const send = (type, data) => sendTo(ws, type, data);
    switch(action) {
      case 'read_dtcs':
        const dtcs = await obd.readDTCs();
        if (db && clients.get(id)?.vehicleId) await db.saveScan(clients.get(id).vehicleId, dtcs, obd.getLiveData()).catch(()=>{});
        send('dtcs', { codes: dtcs, count: dtcs.length }); break;
      case 'clear_dtcs': await obd.clearDTCs(); send('dtcs_cleared', {}); break;
      case 'read_freeze_frame': send('freeze_frame', { data: await obd.readFreezeFrame() }); break;
      case 'set_vehicle': clients.get(id).vehicleId = payload?.vehicleId; send('vehicle_set', {}); break;
      case 'ping': send('pong', { ts: Date.now() }); break;
    }
  });
  ws.on('close', () => clients.delete(id));
  ws.on('error', () => clients.delete(id));
});
setInterval(() => { wss.clients.forEach(ws => { if(ws.readyState===1) ws.send(JSON.stringify({type:'heartbeat',ts:Date.now()})); }); }, 25000);

// ── HEALTH ────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: 'ok', db: db?'connected':'disconnected',
  sim_mode: obd?.simMode||false, uptime: Math.round(process.uptime()), version:'2.0.0'
}));

// ── AUTH ──────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { email, password, taller_name } = req.body;
  if (!email || !password) return res.status(400).json({ ok: false, error: 'Email y contraseña requeridos' });
  try {
    if (db) {
      const existing = await db.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
      if (existing.rows.length) return res.status(400).json({ ok: false, error: 'Email ya registrado' });
      const hash = crypto.createHash('sha256').update(password).digest('hex');
      const r = await db.query('INSERT INTO users (email, password_hash, taller_name) VALUES ($1,$2,$3) RETURNING id, email, taller_name', [email.toLowerCase(), hash, taller_name || 'Mi Taller']);
      const user = r.rows[0];
      const token = generateToken();
      if (db) await db.createSession(token, user.id, user.email, user.taller_name).catch(()=>{});
      console.log('NEW USER REGISTERED:', user.email, '|', user.taller_name, '|', new Date().toISOString());
      return res.json({ ok: true, token, user: { id: user.id, email: user.email, tallerName: user.taller_name } });
    } else {
      const token = generateToken();
      return res.json({ ok: true, token, user: { email: email.toLowerCase(), tallerName: taller_name || 'Mi Taller' } });
    }
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ ok: false, error: 'Credenciales requeridas' });
  try {
    if (db) {
      const hash = crypto.createHash('sha256').update(password).digest('hex');
      const r = await db.query('SELECT id, email, taller_name FROM users WHERE email=$1 AND password_hash=$2', [email.toLowerCase(), hash]);
      if (!r.rows.length) return res.status(401).json({ ok: false, error: 'Email o contraseña incorrectos' });
      const user = r.rows[0];
      const token = generateToken();
      sessions.set(token, { userId: user.id, email: user.email, tallerName: user.taller_name });
      console.log('NEW USER REGISTERED:', user.email, '|', user.taller_name, '|', new Date().toISOString());
      return res.json({ ok: true, token, user: { id: user.id, email: user.email, tallerName: user.taller_name } });
    } else {
      return res.status(401).json({ ok: false, error: 'Email o contraseña incorrectos' });
    }
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/auth/logout', async (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token && db) await db.deleteSession(token).catch(()=>{});
  res.json({ ok: true });
});

// ── OBD ──────────────────────────────────────────────────────
app.get('/api/obd/status', (req, res) => res.json({
  ok: true, connected: obd?.isConnected()||false, sim_mode: obd?.simMode||false,
  live_data: obd?.getLiveData()||{}, dtcs: obd?.getDTCs()||[], vin: obd?.vinCode||null,
  history: obd?.getHistory ? obd.getHistory().slice(-30) : []
}));

// ── VEHICLES ─────────────────────────────────────────────────
app.get('/api/vehicles', async (req,res) => {
  if(!db) return res.json({ok:true,data:[]});
  try { res.json({ok:true,data:await db.getVehicles()}); } catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.get('/api/vehicles/:id', async (req,res) => {
  if(!db) return res.status(503).json({ok:false,error:'Sin DB'});
  try { const v=await db.getVehicle(req.params.id); v?res.json({ok:true,data:v}):res.status(404).json({ok:false,error:'No encontrado'}); } catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.post('/api/vehicles', async (req,res) => {
  if(!db) return res.status(503).json({ok:false,error:'Sin DB'});
  try { res.json({ok:true,data:await db.createVehicle(req.body)}); } catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.put('/api/vehicles/:id', async (req,res) => {
  if(!db) return res.status(503).json({ok:false,error:'Sin DB'});
  try { res.json({ok:true,data:await db.updateVehicle(req.params.id,req.body)}); } catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.delete('/api/vehicles/:id', async (req,res) => {
  if(!db) return res.status(503).json({ok:false,error:'Sin DB'});
  try { await db.deleteVehicle(req.params.id); res.json({ok:true}); } catch(e){res.status(500).json({ok:false,error:e.message});}
});

// ── SCANS ─────────────────────────────────────────────────────
app.get('/api/vehicles/:id/scans', async (req,res) => {
  if(!db) return res.json({ok:true,data:[]});
  try { res.json({ok:true,data:await db.getScans(req.params.id,50)}); } catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.post('/api/vehicles/:id/scans', async (req,res) => {
  if(!db) return res.status(503).json({ok:false,error:'Sin DB'});
  try { res.json({ok:true,data:await db.saveScan(req.params.id,req.body.dtcs,req.body.live_data)}); } catch(e){res.status(500).json({ok:false,error:e.message});}
});

// ── JOBS ──────────────────────────────────────────────────────
app.get('/api/jobs', async (req,res) => {
  if(!db) return res.json({ok:true,data:[]});
  try { res.json({ok:true,data:await db.getJobs(req.query.status)}); } catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.post('/api/jobs', async (req,res) => {
  if(!db) return res.status(503).json({ok:false,error:'Sin DB'});
  try { res.json({ok:true,data:await db.createJob(req.body)}); } catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.patch('/api/jobs/:id/status', async (req,res) => {
  if(!db) return res.status(503).json({ok:false,error:'Sin DB'});
  try { res.json({ok:true,data:await db.updateJobStatus(req.params.id,req.body.status)}); } catch(e){res.status(500).json({ok:false,error:e.message});}
});

// ── RESOLUTIONS ───────────────────────────────────────────────
app.get('/api/resolutions/:code', async (req,res) => {
  if(!db) return res.json({ok:true,data:{resolutions:[],stats:[]}});
  try {
    const [resolutions,stats] = await Promise.all([db.getResolutions(req.params.code.toUpperCase()),db.getResolutionStats(req.params.code.toUpperCase())]);
    res.json({ok:true,data:{resolutions,stats}});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.post('/api/resolutions', async (req,res) => {
  if(!db) return res.status(503).json({ok:false,error:'Sin DB'});
  try { res.json({ok:true,data:await db.saveResolution(req.body)}); } catch(e){res.status(500).json({ok:false,error:e.message});}
});

// ── VEHICLE PROFILES ──────────────────────────────────────────
app.get('/api/vehicles/:id/profile', async (req,res) => {
  if(!db) return res.json({ok:true,data:null});
  try { res.json({ok:true,data:await db.getProfile(req.params.id)}); } catch(e){res.status(500).json({ok:false,error:e.message});}
});

app.post('/api/vehicles/:id/profile/generate', async (req,res) => {
  const vehicleId = req.params.id;
  if(!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ok:false,error:'API key no configurada'});
  try {
    const vehicle = db ? await db.getVehicle(vehicleId) : req.body;
    const scans   = db ? await db.getScans(vehicleId, 20) : [];
    const make  = vehicle?.make  || req.body.make  || 'Desconocido';
    const model = vehicle?.model || req.body.model || 'Desconocido';
    const year  = vehicle?.year  || req.body.year  || '';
    const engine= vehicle?.engine|| req.body.engine|| '';
    const allDtcs = [...new Set(scans.flatMap(s => s.dtcs || []))];

    const prompt = 'Sos un experto en diagnóstico automotriz para Argentina. Generá un perfil técnico completo para: '
      + make + ' ' + model + ' ' + year + ' ' + engine + '. '
      + (allDtcs.length ? 'DTCs detectados: ' + allDtcs.join(', ') + '. ' : '')
      + 'Priorizá información del mercado argentino. '
      + 'SOLO JSON: {"overview":"resumen 2-3 oraciones","common_issues":[{"title":"problema","description":"desc","frequency":"Muy frecuente|Frecuente|Ocasional","estimated_cost":"$XX-$XXX USD"}],"maintenance_schedule":{"oil_change_km":5000,"timing_belt_km":90000,"spark_plugs_km":30000,"notes":"notas modelo"},"specs":{"fuel_type":"Nafta/Diesel/GNC","fuel_capacity_liters":50,"oil_type":"5W30","oil_capacity_liters":4.2,"tire_size":"195/65 R15","coolant_type":"OAT"},"argentina_notes":"disponibilidad repuestos y precios Argentina","dtc_patterns":"analisis de los DTCs detectados","reliability_score":7,"sources":["fuente1"]}';

    const raw = await callClaude(prompt, true, 1800);
    const clean = raw.replace(/```json/g,'').replace(/```/g,'');
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ok:false,error:'No se pudo generar el perfil'});
    const profileData = JSON.parse(match[0]);
    profileData.vehicle = { make, model, year, engine };
    profileData.generated_at = new Date().toISOString();
    profileData.dtc_history = allDtcs;
    profileData.scan_count = scans.length;
    if (db) await db.upsertProfile(vehicleId, profileData);
    res.json({ok:true,data:profileData});
  } catch(e) { res.status(500).json({ok:false,error:e.message}); }
});

// ── DTC KNOWLEDGE BASE ────────────────────────────────────────
app.get('/api/dtc/search', async (req,res) => {
  const q = req.query.q || '';
  if (!q) return res.json({ok:true,data:[]});
  if (!db) return res.json({ok:true,data:[]});
  try { res.json({ok:true,data:await db.searchDTCs(q,20)}); } catch(e){res.status(500).json({ok:false,error:e.message});}
});

app.get('/api/dtc/:code', async (req,res) => {
  const code = req.params.code.toUpperCase();
  if (db) {
    try {
      const local = await db.getDTCWithFullData(code);
      if (local) return res.json({ok:true,data:local,source:'local_db'});
    } catch(e) {}
  }
  res.status(404).json({ok:false,error:'No encontrado en base local'});
});

// ── AI HELPERS ────────────────────────────────────────────────
async function callClaude(prompt, webSearch, maxTokens) {
  const fetch = require('node-fetch');
  maxTokens = maxTokens || 1500;
  const body = { model:'claude-sonnet-4-20250514', max_tokens:maxTokens, messages:[{role:'user',content:prompt}] };
  if(webSearch) body.tools = [{type:'web_search_20250305',name:'web_search'}];
  const r = await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
    body:JSON.stringify(body)
  });
  const data = await r.json();
  let raw=''; for(const b of (data.content||[])) if(b.type==='text') raw+=b.text;
  return raw;
}

// ── AI DIAGNOSE (smart differential) ─────────────────────────
app.post('/api/ai/diagnose', async (req,res) => {
  const { code, brand, model, freeze_frame, live_data, scanner_data } = req.body;
  if (!code) return res.status(400).json({ok:false,error:'Código requerido'});
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ok:false,error:'API key no configurada'});
  try {
    // 1. Local DB lookup
    let localDTC = null;
    if (db) localDTC = await db.getDTCWithFullData(code).catch(()=>null);

    // 2. Community resolutions
    let communityData = [];
    if (db) communityData = await db.getResolutionStats(code).catch(()=>[]);

    // 3. Build data strings safely (no nested template literals)
    const communityLines = communityData.length > 0
      ? communityData.map(function(r) {
          return r.cause_found + ': ' + r.count + ' casos' + (r.avg_cost ? ', $' + Math.round(r.avg_cost) + ' USD promedio' : '');
        }).join(' | ')
      : 'Sin datos de comunidad aun';

    const dataSource = (live_data && Object.keys(live_data).length > 0) ? live_data : (freeze_frame || {});
    const scannerLines = Object.values(dataSource)
      .filter(function(v) { return v && v.value !== undefined && v.value !== ''; })
      .map(function(v) { return v.label + ': ' + v.value + v.unit; })
      .join(', ') || scanner_data || 'No disponible';

    let localLines = 'Sin datos tecnicos locales para este codigo.';
    if (localDTC) {
      localLines = 'Descripcion: ' + (localDTC.description || '') + ' | '
        + 'Causas: ' + (localDTC.causes || []).join(', ') + ' | '
        + 'Freeze frame hints: ' + (localDTC.freeze_frame_hints || 'N/A') + ' | '
        + 'Costo LATAM: ' + (localDTC.latam_cost_usd || 'N/A') + ' | '
        + 'Notas Argentina: ' + (localDTC.latam_notes || 'N/A');
    }

    // 4. Build prompt using string concatenation to avoid template literal issues
    const prompt = 'Sos un experto en diagnostico automotriz para Argentina con datos tecnicos completos. '
      + 'Codigo DTC: ' + code + '. '
      + 'Vehiculo: ' + (brand || 'Universal') + ' ' + (model || '') + '. '
      + 'BASE DE DATOS LOCAL: ' + localLines + '. '
      + 'DATOS SCANNER ACTUALES: ' + scannerLines + '. '
      + 'RESOLUCIONES COMUNIDAD: ' + communityLines + '. '
      + 'Interpreta los datos del scanner en relacion al codigo. '
      + 'Calcula probabilidad de cada causa basandote en los datos disponibles. '
      + 'SOLO JSON: {"code":"' + code + '",'
      + '"primary_diagnosis":"diagnostico mas probable",'
      + '"confidence":85,'
      + '"scanner_interpretation":"que dicen los valores del scanner",'
      + '"recommended_action":"primer paso concreto a realizar",'
      + '"differential":[{"cause":"nombre causa","probability":75,"evidence_for":"datos a favor","evidence_against":"datos en contra","confirming_test":"prueba confirmatoria","estimated_cost_usd":"XX-XXX"}],'
      + '"parts_to_check":["componente1"],'
      + '"tools_needed":["herramienta1"],'
      + '"latam_availability":"disponibilidad repuestos Argentina"}';

    const raw = await callClaude(prompt, false, 1500);
    const clean = raw.replace(/```json/g,'').replace(/```/g,'');
    const match = clean.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : { code, primary_diagnosis: raw, confidence: 50, differential: [] };

    if (localDTC) {
      parsed.local_causes = localDTC.causes;
      parsed.local_steps  = localDTC.diagnostic_steps;
      parsed.latam_cost   = localDTC.latam_cost_usd;
      parsed.latam_notes  = localDTC.latam_notes;
    }
    parsed.community_data = communityData;

    res.json({ok:true,data:parsed});
  } catch(e) { res.status(500).json({ok:false,error:e.message}); }
});

// ── AI RESEARCH ───────────────────────────────────────────────
app.post('/api/ai/research', async (req,res) => {
  const {code,brand,model,symptoms,scanner_data} = req.body;
  if(!code) return res.status(400).json({ok:false,error:'Codigo requerido'});
  if(!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ok:false,error:'API key no configurada'});
  try {
    let localContext = '';
    if (db) {
      const localDTC = await db.getDTCWithFullData(code).catch(()=>null);
      if (localDTC) {
        localContext = 'Datos de base local: causas=' + (localDTC.causes||[]).join(', ')
          + ', costo LATAM=' + (localDTC.latam_cost_usd||'N/A')
          + ', notas AR=' + (localDTC.latam_notes||'N/A') + '. Complementa con busqueda web.';
      }
    }
    const prompt = 'Sos un experto tecnico automotriz para LATINOAMERICA (Argentina). '
      + 'Investiga el codigo DTC ' + code + ' para: ' + (brand||'Universal') + ' ' + (model||'') + '. '
      + (symptoms ? 'Sintomas: ' + symptoms + '. ' : '')
      + (scanner_data ? 'Datos scanner: ' + scanner_data + '. ' : '')
      + localContext + ' '
      + 'Busca en fuentes tecnicas reales. Prioriza info y precios para Argentina/LATAM. '
      + 'SOLO JSON: {"code":"' + code + '","title":"titulo","severity":"Critico|Moderado|Bajo","system":"sistema","description":"descripcion tecnica","brands":["marca"],"causes":["causa1","causa2","causa3","causa4","causa5"],"diagnosis_steps":["paso1","paso2","paso3","paso4"],"brand_specific":"notas TSB","latam_notes":"disponibilidad y precios Argentina","scanner_interpretation":"interpretacion datos","costs":{"diagnostic":"$XX","repair_low":"$XXX","repair_high":"$XXXX","latam_parts_usd":"precio repuesto"},"sources":["url1","url2"]}';

    const raw = await callClaude(prompt, true, 1500);
    const clean = raw.replace(/```json/g,'').replace(/```/g,'');
    const match = clean.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : {code,title:'Resultado',description:raw,causes:[],costs:{}};
    if(db && parsed.code) await db.upsertDTCInfo(parsed).catch(()=>{});
    res.json({ok:true,data:parsed});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});

app.post('/api/ai/analyze-multi', async (req,res) => {
  const {codes,brand,model} = req.body;
  if(!codes?.length) return res.status(400).json({ok:false,error:'Codigos requeridos'});
  if(!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ok:false,error:'API key no configurada'});
  try {
    const prompt = 'Experto diagnostico automotriz LATAM. ' + (brand||'') + ' ' + (model||'') + '. DTCs simultaneos: ' + codes.join(', ') + '. '
      + 'Identifica causa raiz. SOLO JSON: {"root_cause":"PXXXX","root_explanation":"por que","codes":[{"code":"PXXXX","is_root":true,"title":"titulo","role":"CAUSA RAIZ|CONSECUENCIA|INDEPENDIENTE","description":"desc","causes":["c1","c2"],"repair_order":1,"estimated_cost":"$XX-$XXX"}],"repair_sequence":"orden recomendado"}';
    const raw = await callClaude(prompt, true, 1200);
    const clean = raw.replace(/```json/g,'').replace(/```/g,'');
    const match = clean.match(/\{[\s\S]*\}/);
    res.json({ok:true,data:match?JSON.parse(match[0]):{codes:[],root_explanation:raw}});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});

app.post('/api/ai/symptoms', async (req,res) => {
  const {symptoms,brand,model,scanner_data} = req.body;
  if(!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ok:false,error:'API key no configurada'});
  try {
    const prompt = 'Experto diagnostico LATAM. ' + (brand||'') + ' ' + (model||'') + '. Sintomas: ' + (symptoms||[]).join(', ') + '. '
      + (scanner_data ? 'Scanner: ' + JSON.stringify(scanner_data) + '. ' : '')
      + 'SOLO JSON: {"probable_dtcs":[{"code":"PXXXX","probability":85,"title":"titulo","why":"razon","system":"sistema"}],"recommended_tests":["test1","test2"],"urgency":"URGENTE|MODERADO|BAJO","urgency_reason":"razon"}';
    const raw = await callClaude(prompt, false, 800);
    const clean = raw.replace(/```json/g,'').replace(/```/g,'');
    const match = clean.match(/\{[\s\S]*\}/);
    res.json({ok:true,data:match?JSON.parse(match[0]):{probable_dtcs:[],urgency:'MODERADO',urgency_reason:raw}});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});

app.post('/api/ai/chat', async (req,res) => {
  const {message,context} = req.body;
  if(!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ok:false,error:'API key no configurada'});
  try {
    const prompt = 'Sos un experto en diagnostico automotriz para Argentina. Responde en espanol, tecnico y conciso. Max 3 parrafos. Contexto: '
      + JSON.stringify(context||{}) + '. Pregunta: ' + message;
    const response = await callClaude(prompt, false, 600);
    res.json({ok:true,data:{response}});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});


// ── LEARNING SYSTEM — aprendizaje continuo ───────────────────
// Cada caso resuelto alimenta el conocimiento de la plataforma

app.post('/api/learn/case', async (req,res) => {
  // Guardar caso completo: DTC + datos scanner + freeze frame + causa + solucion + costo
  const { vehicle_id, dtc_code, brand, model, year, engine,
          scanner_snapshot, freeze_frame, symptoms,
          cause_found, fix_applied, parts_replaced,
          cost_usd, resolution_time_hours, confirmed, mechanic_notes } = req.body;

  if (!dtc_code || !cause_found) return res.status(400).json({ok:false,error:'DTC y causa requeridos'});

  try {
    if (db) {
      await db.query(`
        INSERT INTO resolutions
          (vehicle_id, dtc_code, cause_found, fix_applied, cost_usd, mechanic, confirmed,
           parts_used)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `, [
        vehicle_id||null, dtc_code.toUpperCase(), cause_found, fix_applied||cause_found,
        cost_usd||null, mechanic_notes||null, true,
        parts_replaced||[]
      ]);

      // Update DTC stats in dtcs table — incrementar confianza de causas
      const existing = await db.getDTCWithFullData(dtc_code.toUpperCase()).catch(()=>null);
      if (existing) {
        const causes = existing.causes || [];
        // Move confirmed cause to top if not already there
        const idx = causes.findIndex(c => c.toLowerCase().includes(cause_found.toLowerCase().split(' ')[0]));
        if (idx > 0) {
          const confirmed_cause = causes.splice(idx, 1)[0];
          causes.unshift(confirmed_cause);
          await db.query('UPDATE dtcs SET causes=$1 WHERE code=$2', [causes, dtc_code.toUpperCase()]).catch(()=>{});
        }
      }
    }

    // Log para analytics futuros
    console.log('CASE LEARNED: ' + dtc_code + ' -> ' + cause_found + ' | ' + (brand||'') + ' ' + (model||'') + ' ' + (year||''));

    res.json({ok:true, message:'Caso guardado. La plataforma aprendio de este diagnostico.'});
  } catch(e) { res.status(500).json({ok:false,error:e.message}); }
});

app.get('/api/learn/stats', async (req,res) => {
  if (!db) return res.json({ok:true,data:{total:0,top_codes:[],top_causes:[],recent:[]}});
  try {
    const [total, topCodes, topCauses, recent] = await Promise.all([
      db.query('SELECT COUNT(*) as count FROM resolutions WHERE confirmed=TRUE'),
      db.query('SELECT dtc_code, COUNT(*) as count, AVG(cost_usd) as avg_cost FROM resolutions WHERE confirmed=TRUE GROUP BY dtc_code ORDER BY count DESC LIMIT 10'),
      db.query('SELECT cause_found, COUNT(*) as count, AVG(cost_usd) as avg_cost FROM resolutions WHERE confirmed=TRUE GROUP BY cause_found ORDER BY count DESC LIMIT 10'),
      db.query('SELECT r.*, v.make, v.model, v.year FROM resolutions r LEFT JOIN vehicles v ON r.vehicle_id=v.id WHERE r.confirmed=TRUE ORDER BY r.created_at DESC LIMIT 20'),
    ]);
    res.json({ok:true, data:{
      total: parseInt(total.rows[0].count),
      top_codes: topCodes.rows,
      top_causes: topCauses.rows,
      recent: recent.rows,
    }});
  } catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

// ── FLOATING ASSISTANT — contexto completo ───────────────────
app.post('/api/assistant/ask', async (req,res) => {
  const { message, context } = req.body;
  if (!message) return res.status(400).json({ok:false,error:'Mensaje requerido'});
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ok:false,error:'API key no configurada'});

  try {
    // Build rich context from everything we know
    const vehicle = context?.vehicle || {};
    const dtcs    = context?.dtcs || [];
    const scanner = context?.scanner || {};
    const history = context?.history || [];
    const currentView = context?.current_view || '';

    // Get community data for active DTCs
    let communityContext = '';
    if (db && dtcs.length > 0) {
      for (const code of dtcs.slice(0,3)) {
        const stats = await db.getResolutionStats(code).catch(()=>[]);
        if (stats.length > 0) {
          communityContext += code + ': ' + stats.slice(0,2).map(function(s){
            return s.cause_found + '(' + s.count + ' casos)';
          }).join(', ') + '. ';
        }
      }
    }

    // Get local DTC data
    let dtcContext = '';
    if (db && dtcs.length > 0) {
      for (const code of dtcs.slice(0,2)) {
        const local = await db.getDTCWithFullData(code).catch(()=>null);
        if (local) {
          dtcContext += code + ': ' + local.title + '. Causas: ' + (local.causes||[]).slice(0,3).join(', ') + '. ';
        }
      }
    }

    const scannerStr = Object.values(scanner)
      .filter(function(v){ return v && v.value !== undefined; })
      .map(function(v){ return v.label + ': ' + v.value + (v.unit||''); })
      .join(', ') || 'Sin datos';

    const systemPrompt = 'Sos el asistente de AutoDiag Pro, una plataforma de diagnostico automotriz para talleres en Argentina. '
      + 'Tu rol es ayudar al mecanico a diagnosticar y resolver problemas de manera practica y concisa. '
      + 'Responde siempre en espanol, de forma tecnica pero clara. Maximo 3 oraciones por respuesta salvo que se pida mas detalle. '
      + 'Prioriza soluciones economicas y practicas para el mercado argentino. '
      + 'CONTEXTO ACTUAL: '
      + 'Vehiculo: ' + (vehicle.make||'') + ' ' + (vehicle.model||'') + ' ' + (vehicle.year||'') + ' ' + (vehicle.engine||'') + '. '
      + 'DTCs activos: ' + (dtcs.join(', ') || 'ninguno') + '. '
      + 'Datos scanner: ' + scannerStr + '. '
      + (dtcContext ? 'Info tecnica: ' + dtcContext : '')
      + (communityContext ? 'Casos resueltos comunidad: ' + communityContext : '')
      + (currentView ? 'El mecanico esta en la seccion: ' + currentView + '. ' : '')
      + (history.length ? 'Historial conversacion: ' + history.slice(-4).map(function(h){ return h.role+': '+h.content; }).join(' | ') : '');

    // Build messages including conversation history
    const messages = [];
    if (history.length > 0) {
      history.slice(-6).forEach(function(h) {
        messages.push({ role: h.role, content: h.content });
      });
    }
    messages.push({ role: 'user', content: message });

    const fetch = require('node-fetch');
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: systemPrompt,
        messages: messages
      })
    });

    const data = await r.json();
    const response = (data.content||[]).filter(function(b){ return b.type==='text'; }).map(function(b){ return b.text; }).join('');
    res.json({ok:true, data:{ response, tokens: data.usage }});
  } catch(e) { res.status(500).json({ok:false,error:e.message}); }
});

// ── NHTSA — Recalls, complaints y ratings oficiales del gobierno EEUU ──────
app.get('/api/nhtsa/recalls', async (req, res) => {
  const { make, model, year } = req.query;
  if (!make || !model || !year) return res.status(400).json({ ok: false, error: 'make, model y year requeridos' });
  try {
    const fetch = require('node-fetch');
    // Normalize: NHTSA needs English names and specific formatting
    const makeEnc  = encodeURIComponent(make.trim());
    const modelEnc = encodeURIComponent(model.trim());
    const yearEnc  = encodeURIComponent(year.toString().trim());
    
    const url = `https://api.nhtsa.dot.gov/recalls/recallsByVehicle?make=${makeEnc}&model=${modelEnc}&modelYear=${yearEnc}`;
    const r = await fetch(url, { timeout: 8000 });
    const data = await r.json();
    
    const recalls = (data.results || []).map(rec => ({
      id:           rec.NHTSACampaignNumber,
      subject:      rec.Subject,
      summary:      rec.Summary,
      consequence:  rec.Consequence,
      remedy:       rec.Remedy,
      component:    rec.Component,
      date:         rec.ReportReceivedDate,
      manufacturer: rec.Manufacturer,
      park_it:      rec.ParkIt,
    }));
    
    res.json({ ok: true, count: recalls.length, data: recalls });
  } catch(e) {
    console.log('NHTSA recalls error:', e.message);
    res.json({ ok: true, count: 0, data: [], error: e.message });
  }
});

app.get('/api/nhtsa/complaints', async (req, res) => {
  const { make, model, year } = req.query;
  if (!make || !model || !year) return res.status(400).json({ ok: false, error: 'Parámetros requeridos' });
  try {
    const fetch = require('node-fetch');
    const url = `https://api.nhtsa.dot.gov/complaints/complaintsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(year)}`;
    const r = await fetch(url, { timeout: 8000 });
    const data = await r.json();
    
    const complaints = (data.results || []).slice(0, 20).map(c => ({
      id:          c.odiNumber,
      summary:     c.summary,
      components:  c.components,
      crash:       c.crash,
      fire:        c.fire,
      injuries:    c.numberOfInjuries,
      deaths:      c.numberOfDeaths,
      date:        c.dateOfIncident,
      date_filed:  c.dateComplaintFiled,
    }));
    
    res.json({ ok: true, count: data.Count || complaints.length, data: complaints });
  } catch(e) {
    console.log('NHTSA complaints error:', e.message);
    res.json({ ok: true, count: 0, data: [], error: e.message });
  }
});

app.get('/api/nhtsa/ratings', async (req, res) => {
  const { make, model, year } = req.query;
  if (!make || !model || !year) return res.status(400).json({ ok: false, error: 'Parámetros requeridos' });
  try {
    const fetch = require('node-fetch');
    const url = `https://api.nhtsa.dot.gov/SafetyRatings/modelyear/${encodeURIComponent(year)}/make/${encodeURIComponent(make)}/model/${encodeURIComponent(model)}`;
    const r = await fetch(url, { timeout: 8000 });
    const data = await r.json();
    
    const ratings = (data.Results || []).map(v => ({
      vehicle_id:       v.VehicleId,
      vehicle_desc:     v.VehicleDescription,
      overall_rating:   v.OverallRating,
      front_crash:      v.OverallFrontCrashRating,
      side_crash:       v.OverallSideCrashRating,
      rollover:         v.RolloverRating,
      front_crash_pct:  v.FrontCrashDriversideRating,
    }));
    
    res.json({ ok: true, count: ratings.length, data: ratings });
  } catch(e) {
    res.json({ ok: true, count: 0, data: [], error: e.message });
  }
});

// Combined endpoint - fetches recalls + complaints + ratings in parallel
app.get('/api/nhtsa/full', async (req, res) => {
  const { make, model, year } = req.query;
  if (!make || !model || !year) return res.status(400).json({ ok: false, error: 'make, model y year requeridos' });
  
  try {
    const fetch = require('node-fetch');
    const opts = { timeout: 10000 };
    
    const [recallsR, complaintsR, ratingsR] = await Promise.allSettled([
      fetch(`https://api.nhtsa.dot.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(year)}`, opts).then(r=>r.json()),
      fetch(`https://api.nhtsa.dot.gov/complaints/complaintsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(year)}`, opts).then(r=>r.json()),
      fetch(`https://api.nhtsa.dot.gov/SafetyRatings/modelyear/${encodeURIComponent(year)}/make/${encodeURIComponent(make)}/model/${encodeURIComponent(model)}`, opts).then(r=>r.json()),
    ]);
    
    const recalls    = recallsR.status === 'fulfilled'    ? (recallsR.value.results || [])     : [];
    const complaints = complaintsR.status === 'fulfilled' ? (complaintsR.value.results || []).slice(0,15) : [];
    const ratings    = ratingsR.status === 'fulfilled'    ? (ratingsR.value.Results || [])     : [];
    
    res.json({
      ok: true,
      make, model, year,
      recalls: recalls.map(r => ({
        id: r.NHTSACampaignNumber, subject: r.Subject, summary: r.Summary,
        consequence: r.Consequence, remedy: r.Remedy, component: r.Component,
        date: r.ReportReceivedDate, park_it: r.ParkIt,
      })),
      complaints: complaints.map(c => ({
        id: c.odiNumber, summary: c.summary, components: c.components,
        crash: c.crash, fire: c.fire, injuries: c.numberOfInjuries,
        deaths: c.numberOfDeaths, date: c.dateOfIncident,
      })),
      ratings: ratings.slice(0,3).map(v => ({
        desc: v.VehicleDescription, overall: v.OverallRating,
        front: v.OverallFrontCrashRating, side: v.OverallSideCrashRating,
        rollover: v.RolloverRating,
      })),
    });
  } catch(e) {
    res.json({ ok: true, recalls: [], complaints: [], ratings: [], error: e.message });
  }
});



app.get('/api/auth/me', async (req, res) => {
  const token = req.headers['x-auth-token'];
  if (!token) return res.status(401).json({ ok: false, error: 'Sin token' });
  try {
    if (db) {
      const session = await db.getSession(token);
      if (!session) return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });
      return res.json({ ok: true, user: {
        id: session.user_id,
        email: session.email,
        tallerName: session.taller || session.taller_name
      }});
    }
    return res.status(401).json({ ok: false, error: 'Sin base de datos' });
  } catch(e) {
    return res.status(401).json({ ok: false, error: 'Token inválido' });
  }
});

// ── ROUTING ──────────────────────────────────────────────────
// / → landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/landing/index.html'));
});

// /app → main app (login + platform)
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});


// ── HISTORIAL COMPLETO DEL VEHÍCULO ──────────────────────────
app.get('/api/vehicles/:id/history', async (req, res) => {
  if (!db) return res.json({ ok: true, data: { scans:[], resolutions:[], dtc_stats:[], cost_by_month:[] } });
  try {
    const data = await db.getVehicleHistory(req.params.id);
    res.json({ ok: true, data });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.patch('/api/scans/:id/note', async (req, res) => {
  if (!db) return res.status(503).json({ ok: false, error: 'Sin DB' });
  try {
    const scan = await db.addScanNote(req.params.id, req.body.note);
    res.json({ ok: true, data: scan });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/vehicles/:id/scans/full', async (req, res) => {
  if (!db) return res.status(503).json({ ok: false, error: 'Sin DB' });
  try {
    const scan = await db.saveFullScan(req.params.id, req.body);
    res.json({ ok: true, data: scan });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// SPA fallback
app.get('*', (req,res) => res.sendFile(path.join(__dirname,'../public/index.html')));

// ── START ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log('✓ AutoDiag Pro v2.0 → puerto ' + PORT);
  await loadModules();
  // Clean expired sessions every hour
  setInterval(async () => {
    if (db) await db.cleanExpiredSessions().catch(()=>{});
  }, 60 * 60 * 1000);
});
