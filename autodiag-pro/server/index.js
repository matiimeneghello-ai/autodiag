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

// ── AUTH HELPERS ────────────────────────────────────────────
const sessions = new Map(); // token → { userId, email, tallerName }

function generateToken() { return crypto.randomBytes(32).toString('hex'); }

function authMiddleware(req, res, next) {
  const token = req.headers['x-auth-token'] || req.query.token;
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ ok: false, error: 'No autorizado' });
  }
  req.user = sessions.get(token);
  next();
}

// ── OBD SIMULATION ──────────────────────────────────────────
function createSimOBD() {
  const { EventEmitter } = require('events');
  const em = new EventEmitter();
  let liveData = {};
  let history = []; // últimas 60 lecturas para gráficas
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
        // Simular rpm que sube y baja con patrón sinusoidal
        const rpmBase = 750 + Math.sin(tick * 0.1) * 200;
        const rpm = Math.round(rpmBase + (Math.random()-.5)*50);
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

        // Guardar en historial para gráficas (cada 2 ticks = cada 600ms)
        if (tick % 2 === 0) {
          history.push({ ts: Date.now(), rpm: rpm, coolant: coolant, o2: o2, load: load, ftShort });
          if (history.length > 120) history.shift();
        }

        em.emit('liveData', liveData);
      }, 300);
    },
    stopSimulation() { if(interval) clearInterval(interval); }
  };
  return sim;
}

// ── INIT MODULES ────────────────────────────────────────────
async function loadModules() {
  try {
    db = require('./db');
    await db.connectDB();
    console.log('✓ PostgreSQL conectado');
  } catch(e) {
    console.error('✗ PostgreSQL:', e.message);
    db = null;
  }

  try {
    if (process.env.OBD_HOST) {
      obd = require('./obd');
      await obd.connect({ type: process.env.OBD_TYPE||'wifi', host: process.env.OBD_HOST, port: parseInt(process.env.OBD_PORT)||35000 });
      console.log('✓ OBD-II físico conectado');
    } else throw new Error('Sin OBD_HOST');
  } catch(e) {
    console.log('⚡ Modo simulación OBD-II');
    obd = createSimOBD();
    obd.startSimulation();
  }

  obd.on('liveData', data => broadcast('live_data', data));
  obd.on('dtcs',     data => broadcast('dtcs', { codes: data, count: data.length }));
}

// ── WEBSOCKET ───────────────────────────────────────────────
const clients = new Map();

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, ts: Date.now() });
  wss.clients.forEach(ws => { if(ws.readyState===1) ws.send(msg); });
}

function sendTo(ws, type, payload) {
  if(ws.readyState===1) ws.send(JSON.stringify({type, payload, ts: Date.now()}));
}

wss.on('connection', (ws, req) => {
  const id = uuidv4();
  clients.set(id, { ws, vehicleId: null, userId: null });

  sendTo(ws, 'connected', {
    clientId: id,
    sim_mode: obd?.simMode || true,
    live_data: obd?.getLiveData() || {},
    dtcs: obd?.getDTCs() || [],
    history: obd?.getHistory ? obd.getHistory() : [],
  });

  ws.on('message', async (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch(e) { return; }
    const { action, payload } = msg;
    const send = (type, data) => sendTo(ws, type, data);

    switch(action) {
      case 'read_dtcs':
        const dtcs = await obd.readDTCs();
        const client = clients.get(id);
        if (db && client?.vehicleId) {
          await db.saveScan(client.vehicleId, dtcs, obd.getLiveData()).catch(()=>{});
        }
        send('dtcs', { codes: dtcs, count: dtcs.length });
        break;
      case 'clear_dtcs':
        await obd.clearDTCs();
        send('dtcs_cleared', {});
        break;
      case 'read_freeze_frame':
        send('freeze_frame', { data: await obd.readFreezeFrame(), dtc: payload?.dtc });
        break;
      case 'set_vehicle':
        clients.get(id).vehicleId = payload?.vehicleId;
        send('vehicle_set', { vehicleId: payload?.vehicleId });
        break;
      case 'get_history':
        send('history', { data: obd?.getHistory ? obd.getHistory() : [] });
        break;
      case 'ping':
        send('pong', { ts: Date.now() });
        break;
    }
  });

  ws.on('close', () => clients.delete(id));
  ws.on('error', () => clients.delete(id));
});

setInterval(() => {
  wss.clients.forEach(ws => { if(ws.readyState===1) ws.send(JSON.stringify({type:'heartbeat',ts:Date.now()})); });
}, 25000);

// ── REST API ────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({
  status: 'ok', db: db?'connected':'disconnected',
  sim_mode: obd?.simMode||false, uptime: Math.round(process.uptime()), version:'2.0.0'
}));

// ── AUTH ROUTES ─────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { email, password, taller_name } = req.body;
  if (!email || !password) return res.status(400).json({ ok: false, error: 'Email y contraseña requeridos' });

  try {
    if (db) {
      // Verificar si ya existe
      const existing = await db.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
      if (existing.rows.length) return res.status(400).json({ ok: false, error: 'Email ya registrado' });

      const hash = crypto.createHash('sha256').update(password).digest('hex');
      const r = await db.query(
        'INSERT INTO users (email, password_hash, taller_name) VALUES ($1,$2,$3) RETURNING id, email, taller_name',
        [email.toLowerCase(), hash, taller_name || 'Mi Taller']
      );
      const user = r.rows[0];
      const token = generateToken();
      sessions.set(token, { userId: user.id, email: user.email, tallerName: user.taller_name });
      return res.json({ ok: true, token, user: { id: user.id, email: user.email, tallerName: user.taller_name } });
    } else {
      // Sin DB — sesión en memoria
      const token = generateToken();
      sessions.set(token, { userId: uuidv4(), email: email.toLowerCase(), tallerName: taller_name || 'Mi Taller' });
      return res.json({ ok: true, token, user: { email: email.toLowerCase(), tallerName: taller_name || 'Mi Taller' } });
    }
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ ok: false, error: 'Email y contraseña requeridos' });

  try {
    if (db) {
      const hash = crypto.createHash('sha256').update(password).digest('hex');
      const r = await db.query('SELECT id, email, taller_name FROM users WHERE email=$1 AND password_hash=$2', [email.toLowerCase(), hash]);
      if (!r.rows.length) return res.status(401).json({ ok: false, error: 'Email o contraseña incorrectos' });
      const user = r.rows[0];
      const token = generateToken();
      sessions.set(token, { userId: user.id, email: user.email, tallerName: user.taller_name });
      return res.json({ ok: true, token, user: { id: user.id, email: user.email, tallerName: user.taller_name } });
    } else {
      // Sin DB — demo login
      if (email === 'demo@autodiag.com' && password === 'demo1234') {
        const token = generateToken();
        sessions.set(token, { userId: '1', email: 'demo@autodiag.com', tallerName: 'Taller Demo' });
        return res.json({ ok: true, token, user: { email: 'demo@autodiag.com', tallerName: 'Taller Demo' } });
      }
      return res.status(401).json({ ok: false, error: 'Credenciales incorrectas' });
    }
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ ok: true, user: req.user });
});

// ── OBD STATUS ──────────────────────────────────────────────
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

// ── SCANS / HISTORIAL ────────────────────────────────────────
app.get('/api/vehicles/:id/scans', async (req,res) => {
  if(!db) return res.json({ok:true,data:[]});
  try { res.json({ok:true,data:await db.getScans(req.params.id, 50)}); } catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.post('/api/vehicles/:id/scans', async (req,res) => {
  if(!db) return res.status(503).json({ok:false,error:'Sin DB'});
  try { res.json({ok:true,data:await db.saveScan(req.params.id,req.body.dtcs,req.body.live_data)}); } catch(e){res.status(500).json({ok:false,error:e.message});}
});

// ── JOBS ─────────────────────────────────────────────────────
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

// ── AI ENDPOINTS ──────────────────────────────────────────────
async function callClaude(prompt, webSearch=false, maxTokens=1500) {
  const fetch = require('node-fetch');
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

app.post('/api/ai/research', async (req,res) => {
  const {code,brand,model,symptoms,scanner_data} = req.body;
  if(!code) return res.status(400).json({ok:false,error:'Código requerido'});
  if(!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ok:false,error:'ANTHROPIC_API_KEY no configurada'});
  try {
    const raw = await callClaude(
      `Sos un experto técnico automotriz para LATINOAMÉRICA (Argentina principalmente).
Investigá el código DTC ${code} para: ${brand||'Universal'} ${model||''}.
${symptoms?'Síntomas: '+symptoms:''} ${scanner_data?'Datos scanner: '+scanner_data:''}
Buscá en fuentes técnicas reales. Priorizá info y precios para Argentina/LATAM.
SOLO JSON sin texto extra:
{"code":"${code}","title":"título","severity":"Crítico|Moderado|Bajo","system":"sistema","description":"descripción técnica","brands":["marca"],"causes":["causa1","causa2","causa3","causa4","causa5"],"diagnosis_steps":["paso1","paso2","paso3","paso4"],"brand_specific":"notas TSB","latam_notes":"disponibilidad y precios en Argentina","scanner_interpretation":"interpretación datos","costs":{"diagnostic":"$XX","repair_low":"$XXX","repair_high":"$XXXX","latam_parts_usd":"precio repuesto"},"sources":["url1","url2"]}`,
      true
    );
    const match = raw.replace(/```json|```/g,'').match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : {code,title:'Resultado',description:raw,causes:[],costs:{}};
    if(db && parsed.code) await db.upsertDTCInfo(parsed).catch(()=>{});
    res.json({ok:true,data:parsed});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});

app.post('/api/ai/analyze-multi', async (req,res) => {
  const {codes,brand,model} = req.body;
  if(!codes?.length) return res.status(400).json({ok:false,error:'Códigos requeridos'});
  if(!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ok:false,error:'API key no configurada'});
  try {
    const raw = await callClaude(
      `Experto diagnóstico automotriz LATAM. ${brand||''} ${model||''}. DTCs simultáneos: ${codes.join(', ')}.
Identificá causa raíz y relación entre códigos. SOLO JSON:
{"root_cause":"PXXXX","root_explanation":"por qué","codes":[{"code":"PXXXX","is_root":true,"title":"título","role":"CAUSA RAÍZ|CONSECUENCIA|INDEPENDIENTE","description":"desc","causes":["c1","c2"],"repair_order":1,"estimated_cost":"$XX-$XXX"}],"repair_sequence":"orden recomendado"}`,
      true
    );
    const match = raw.replace(/```json|```/g,'').match(/\{[\s\S]*\}/);
    res.json({ok:true,data:match?JSON.parse(match[0]):{codes:[],root_explanation:raw}});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});

app.post('/api/ai/symptoms', async (req,res) => {
  const {symptoms,brand,model,scanner_data} = req.body;
  if(!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ok:false,error:'API key no configurada'});
  try {
    const raw = await callClaude(
      `Experto diagnóstico LATAM. ${brand||''} ${model||''}. Síntomas: ${(symptoms||[]).join(', ')}. ${scanner_data?'Scanner: '+JSON.stringify(scanner_data):''}
SOLO JSON: {"probable_dtcs":[{"code":"PXXXX","probability":85,"title":"título","why":"razón","system":"sistema"}],"recommended_tests":["test1","test2"],"urgency":"URGENTE|MODERADO|BAJO","urgency_reason":"razón"}`
    );
    const match = raw.replace(/```json|```/g,'').match(/\{[\s\S]*\}/);
    res.json({ok:true,data:match?JSON.parse(match[0]):{probable_dtcs:[],urgency:'MODERADO',urgency_reason:raw}});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});

app.post('/api/ai/chat', async (req,res) => {
  const {message,context} = req.body;
  if(!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ok:false,error:'API key no configurada'});
  try {
    const response = await callClaude(
      `Sos un experto en diagnóstico automotriz para Argentina. Respondé en español, técnico y conciso. Máximo 3 párrafos.
Contexto: ${JSON.stringify(context||{})}
Pregunta: ${message}`,
      false, 600
    );
    res.json({ok:true,data:{response}});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});

// ── NOTIFICATIONS (simple webhook/email placeholder) ─────────
app.post('/api/notifications/dtc-alert', async (req, res) => {
  const { vehicle, dtcs, severity } = req.body;
  // En producción: enviar WhatsApp via Twilio o email via SendGrid
  console.log(`🚨 ALERTA DTC: ${vehicle} — ${dtcs?.join(', ')} [${severity}]`);
  // Por ahora loguea — implementar Twilio/SendGrid cuando haya saldo
  res.json({ ok: true, message: 'Alerta registrada' });
});


// ── VEHICLE PROFILES ─────────────────────────────────────────
app.get('/api/vehicles/:id/profile', async (req,res) => {
  if(!db) return res.json({ok:true,data:null});
  try {
    const profile = await db.getProfile(req.params.id);
    res.json({ok:true,data:profile});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});

app.post('/api/vehicles/:id/profile/generate', async (req,res) => {
  const vehicleId = req.params.id;
  if(!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ok:false,error:'API key no configurada'});
  
  try {
    // Get vehicle info
    const vehicle = db ? await db.getVehicle(vehicleId) : req.body.vehicle;
    const scans   = db ? await db.getScans(vehicleId, 20) : [];
    
    const make  = vehicle?.make  || req.body.make  || 'Desconocido';
    const model = vehicle?.model || req.body.model || 'Desconocido';
    const year  = vehicle?.year  || req.body.year  || '';
    const engine= vehicle?.engine|| req.body.engine|| '';
    
    // Collect all DTCs from history
    const allDtcs = [...new Set(scans.flatMap(s => s.dtcs || []))];
    const scanCount = scans.length;
    const lastScan = scans[0]?.created_at;
    
    const prompt = `Sos un experto en diagnóstico automotriz para el mercado latinoamericano (Argentina).
Generá un perfil técnico completo para el siguiente vehículo:

Vehículo: ${make} ${model} ${year}
Motor: ${engine}
Historial de DTCs detectados: ${allDtcs.length ? allDtcs.join(', ') : 'Sin escaneos previos'}
Cantidad de escaneos: ${scanCount}
${lastScan ? 'Último escaneo: ' + new Date(lastScan).toLocaleDateString('es-AR') : ''}

Generá información técnica útil para el mecánico. Si no hay historial de DTCs, generá el perfil basado en el modelo/año.
Buscá información específica sobre este vehículo en el mercado argentino.

SOLO JSON sin texto extra:
{
  "overview": "Resumen técnico del vehículo en 2-3 oraciones",
  "common_issues": [
    {"title": "Problema conocido", "description": "descripción", "frequency": "Muy frecuente|Frecuente|Ocasional", "estimated_cost": "$XX-$XXX USD"}
  ],
  "maintenance_schedule": {
    "oil_change_km": 5000,
    "timing_belt_km": 90000,
    "spark_plugs_km": 30000,
    "notes": "notas específicas del modelo"
  },
  "specs": {
    "fuel_type": "Nafta/Diesel/GNC",
    "fuel_capacity_liters": 50,
    "oil_type": "5W30",
    "oil_capacity_liters": 4.2,
    "tire_size": "195/65 R15",
    "coolant_type": "OAT"
  },
  "argentina_notes": "Disponibilidad de repuestos, precios aproximados en Argentina, variantes locales",
  "dtc_patterns": "${allDtcs.length ? 'Análisis de los DTCs detectados: ' + allDtcs.join(', ') : 'Sin patrones de falla detectados aún'}",
  "reliability_score": 7,
  "sources": ["fuente1", "fuente2"]
}`;

    const raw = await callClaude(prompt, true, 1800);
    const match = raw.replace(/\`\`\`json|\`\`\`/g,'').match(/\{[\s\S]*\}/);
    
    if (!match) return res.status(500).json({ok:false,error:'No se pudo generar el perfil'});
    
    const profileData = JSON.parse(match[0]);
    profileData.vehicle = { make, model, year, engine };
    profileData.generated_at = new Date().toISOString();
    profileData.dtc_history = allDtcs;
    profileData.scan_count = scanCount;
    
    // Save to DB
    if (db) await db.upsertProfile(vehicleId, profileData);
    
    res.json({ok:true,data:profileData});
  } catch(e) { res.status(500).json({ok:false,error:e.message}); }
});

app.put('/api/vehicles/:id/profile', async (req,res) => {
  if(!db) return res.status(503).json({ok:false,error:'Sin DB'});
  try {
    const profile = await db.upsertProfile(req.params.id, req.body);
    res.json({ok:true,data:profile});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});

// SPA fallback
app.get('*', (req,res) => res.sendFile(path.join(__dirname,'../public/index.html')));

// ── START ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`✓ AutoDiag Pro v2.0 → puerto ${PORT}`);
  await loadModules();
});
