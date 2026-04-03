require('dotenv').config();
const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const cors      = require('cors');
const path      = require('path');
const { v4: uuidv4 } = require('uuid');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

let db  = null;
let obd = null;

// ── OBD Simulación ──────────────────────────────────────────
function createSimOBD() {
  const { EventEmitter } = require('events');
  const em = new EventEmitter();
  let liveData = {};
  let interval = null;

  const sim = {
    isConnected: () => true,
    simMode: true,
    getLiveData: () => liveData,
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
        liveData = {
          rpm:             { value: Math.round(750+(Math.random()-.5)*80),        unit:'rpm',  label:'RPM' },
          speed:           { value: 0,                                             unit:'km/h', label:'Velocidad' },
          coolant:         { value: Math.round(85+(Math.random()-.5)*4),          unit:'°C',   label:'Temp. Refrigerante' },
          intake_temp:     { value: 24,                                            unit:'°C',   label:'Temp. Admisión' },
          throttle:        { value: 15,                                            unit:'%',    label:'Posición Mariposa' },
          map:             { value: 45,                                            unit:'kPa',  label:'Presión MAP' },
          maf:             { value: parseFloat((1.6+(Math.random()-.5)*.4).toFixed(2)), unit:'g/s', label:'Flujo MAF' },
          fuel_trim_short: { value: parseFloat((14+(Math.random()-.5)*6).toFixed(1)),  unit:'%',   label:'Fuel Trim Corto' },
          fuel_trim_long:  { value: 22.1,                                          unit:'%',   label:'Fuel Trim Largo' },
          o2_b1s1:         { value: parseFloat((.1+Math.random()*.85).toFixed(3)), unit:'V',   label:'O2 Sensor B1S1' },
          o2_b1s2:         { value: parseFloat((.6+Math.random()*.3).toFixed(3)),  unit:'V',   label:'O2 Sensor B1S2' },
          voltage:         { value: 12.6,                                          unit:'V',   label:'Voltaje Batería' },
          engine_load:     { value: 22,                                            unit:'%',   label:'Carga Motor' },
          timing:          { value: 14.2,                                          unit:'°',   label:'Avance Encendido' },
        };
        em.emit('liveData', liveData);
      }, 300);
    },
    stopSimulation() { if(interval) clearInterval(interval); }
  };
  return sim;
}

// ── Init módulos ────────────────────────────────────────────
async function loadModules() {
  // DB
  try {
    db = require('./db');
    await db.connectDB();
    console.log('✓ PostgreSQL conectado');
  } catch(e) {
    console.error('✗ PostgreSQL:', e.message);
    db = null;
  }

  // OBD
  try {
    if (process.env.OBD_HOST) {
      obd = require('./obd');
      await obd.connect({ type: process.env.OBD_TYPE||'wifi', host: process.env.OBD_HOST, port: parseInt(process.env.OBD_PORT)||35000 });
      console.log('✓ OBD-II físico conectado');
    } else {
      throw new Error('Sin OBD_HOST');
    }
  } catch(e) {
    console.log('⚡ Modo simulación OBD-II activo');
    obd = createSimOBD();
    obd.startSimulation();
  }

  // Conectar eventos OBD al WS broadcast
  obd.on('liveData', data => broadcast('live_data', data));
  obd.on('dtcs',     data => broadcast('dtcs', { codes: data, count: data.length }));
}

// ── WebSocket ───────────────────────────────────────────────
const clients = new Map();

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, ts: Date.now() });
  wss.clients.forEach(ws => { if(ws.readyState===1) ws.send(msg); });
}

wss.on('connection', (ws) => {
  const id = uuidv4();
  clients.set(id, { ws, vehicleId: null });

  ws.send(JSON.stringify({
    type: 'connected',
    payload: {
      clientId: id,
      sim_mode: obd?.simMode || true,
      live_data: obd?.getLiveData() || {},
      dtcs: obd?.getDTCs() || [],
    },
    ts: Date.now()
  }));

  ws.on('message', async (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch(e) { return; }
    const { action, payload } = msg;
    const send = (type, data) => ws.readyState===1 && ws.send(JSON.stringify({type,payload:data,ts:Date.now()}));

    switch(action) {
      case 'read_dtcs':
        const dtcs = await obd.readDTCs();
        if (db && clients.get(id)?.vehicleId) {
          await db.saveScan(clients.get(id).vehicleId, dtcs, obd.getLiveData()).catch(()=>{});
        }
        send('dtcs', { codes: dtcs, count: dtcs.length });
        break;
      case 'clear_dtcs':
        await obd.clearDTCs();
        send('dtcs_cleared', { message: 'Códigos borrados' });
        break;
      case 'read_freeze_frame':
        const ff = await obd.readFreezeFrame();
        send('freeze_frame', { data: ff, dtc: payload?.dtc });
        break;
      case 'set_vehicle':
        clients.get(id).vehicleId = payload?.vehicleId;
        send('vehicle_set', { vehicleId: payload?.vehicleId });
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
  sim_mode: obd?.simMode||false, uptime: Math.round(process.uptime()), version:'1.0.0'
}));

app.get('/api/obd/status', (req, res) => res.json({
  ok:true, connected: obd?.isConnected()||false, sim_mode: obd?.simMode||false,
  live_data: obd?.getLiveData()||{}, dtcs: obd?.getDTCs()||[], vin: obd?.vinCode||null
}));

// Vehicles CRUD
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

// Scans
app.get('/api/vehicles/:id/scans', async (req,res) => {
  if(!db) return res.json({ok:true,data:[]});
  try { res.json({ok:true,data:await db.getScans(req.params.id)}); } catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.post('/api/vehicles/:id/scans', async (req,res) => {
  if(!db) return res.status(503).json({ok:false,error:'Sin DB'});
  try { res.json({ok:true,data:await db.saveScan(req.params.id,req.body.dtcs,req.body.live_data)}); } catch(e){res.status(500).json({ok:false,error:e.message});}
});

// Jobs
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

// Resolutions
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

// AI endpoints
async function callClaude(prompt, webSearch=false) {
  const fetch = require('node-fetch');
  const body = { model:'claude-sonnet-4-20250514', max_tokens:1500, messages:[{role:'user',content:prompt}] };
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
  if(!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ok:false,error:'API key no configurada'});
  try {
    const raw = await callClaude(`Sos un experto técnico automotriz para LATINOAMÉRICA (Argentina).
Investigá el código DTC ${code} para: ${brand||'Universal'} ${model||''}.
${symptoms?'Síntomas: '+symptoms:''} ${scanner_data?'Datos scanner: '+scanner_data:''}
Buscá en fuentes técnicas: obd-codes.com, engine-codes.com, autozone.com, foros mecánicos españoles, TSB oficiales.
Priorizá info para Argentina/LATAM con precios locales.
SOLO JSON:
{"code":"${code}","title":"título","severity":"Crítico|Moderado|Bajo","system":"sistema","description":"descripción técnica","brands":["marca"],"causes":["causa1","causa2","causa3","causa4","causa5"],"diagnosis_steps":["paso1","paso2","paso3","paso4"],"brand_specific":"notas TSB para ${brand||'esta marca'}","latam_notes":"disponibilidad y precios en Argentina","scanner_interpretation":"interpretación datos scanner","costs":{"diagnostic":"$XX","repair_low":"$XXX","repair_high":"$XXXX","latam_parts_usd":"precio repuesto"},"sources":["url1","url2"]}`, true);
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
    const raw = await callClaude(`Experto diagnóstico automotriz LATAM. ${brand||''} ${model||''}. DTCs: ${codes.join(', ')}.
Analizá relación, identificá causa raíz. SOLO JSON:
{"root_cause":"PXXXX","root_explanation":"por qué","codes":[{"code":"PXXXX","is_root":true,"title":"título","role":"CAUSA RAÍZ|CONSECUENCIA|INDEPENDIENTE","description":"desc","causes":["c1","c2"],"repair_order":1,"estimated_cost":"$XX-$XXX"}],"repair_sequence":"orden recomendado"}`, true);
    const match = raw.replace(/```json|```/g,'').match(/\{[\s\S]*\}/);
    res.json({ok:true,data:match?JSON.parse(match[0]):{codes:[],root_explanation:raw}});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});

app.post('/api/ai/symptoms', async (req,res) => {
  const {symptoms,brand,model,scanner_data} = req.body;
  if(!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ok:false,error:'API key no configurada'});
  try {
    const raw = await callClaude(`Experto diagnóstico LATAM. ${brand||''} ${model||''}. Síntomas: ${(symptoms||[]).join(', ')}. ${scanner_data?'Scanner: '+JSON.stringify(scanner_data):''}
SOLO JSON: {"probable_dtcs":[{"code":"PXXXX","probability":85,"title":"título","why":"razón","system":"sistema"}],"recommended_tests":["test1","test2"],"urgency":"URGENTE|MODERADO|BAJO","urgency_reason":"razón"}`);
    const match = raw.replace(/```json|```/g,'').match(/\{[\s\S]*\}/);
    res.json({ok:true,data:match?JSON.parse(match[0]):{probable_dtcs:[],urgency:'MODERADO',urgency_reason:raw}});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});

app.post('/api/ai/chat', async (req,res) => {
  const {message,context} = req.body;
  if(!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ok:false,error:'API key no configurada'});
  try {
    const response = await callClaude(`Experto diagnóstico automotriz Argentina. Respondé en español, técnico y conciso.
Contexto: ${JSON.stringify(context||{})}
Pregunta: ${message}`);
    res.json({ok:true,data:{response}});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});

// SPA fallback
app.get('*', (req,res) => res.sendFile(path.join(__dirname,'../public/index.html')));

// ── Start ───────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`✓ AutoDiag Pro → puerto ${PORT}`);
  await loadModules();
});
