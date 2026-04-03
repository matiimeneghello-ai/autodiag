require('dotenv').config();
const express      = require('express');
const http         = require('http');
const WebSocket    = require('ws');
const cors         = require('cors');
const path         = require('path');
const crypto       = require('crypto');
const { v4: uuidv4 } = require('uuid');

// Security & performance
let helmet, rateLimit, compression;
try { helmet      = require('helmet');           } catch(e) { console.log('helmet not installed yet'); }
try { rateLimit   = require('express-rate-limit'); } catch(e) { console.log('rate-limit not installed yet'); }
try { compression = require('compression');      } catch(e) { console.log('compression not installed yet'); }

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// ── SECURITY MIDDLEWARE ───────────────────────────────────────
// Trust Railway's reverse proxy (needed for correct IP in rate limiting)
app.set('trust proxy', 1);
// Helmet: security headers
if (helmet) {
  app.use(helmet({
    contentSecurityPolicy: false, // we load CDN scripts
    crossOriginEmbedderPolicy: false,
  }));
}

// Compression: gzip responses
if (compression) app.use(compression());

// CORS: restrict in production
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['*'];
app.use(cors({
  origin: allowedOrigins[0] === '*' ? '*' : function(origin, cb) {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// Body size limit: 1mb max (prevent DoS)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// ── RATE LIMITERS ─────────────────────────────────────────────
function makeRateLimit(windowMs, max, message) {
  if (!rateLimit) return (req, res, next) => next();
  return rateLimit({
    windowMs, max,
    message: { ok: false, error: message },
    standardHeaders: true,
    legacyHeaders: false,
    // Key by IP + user token if available
    keyGenerator: (req) => {
      try {
        const token = req.headers['x-auth-token'] || '';
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        return ip + '_' + token.substring(0, 16);
      } catch(e) { return 'unknown'; }
    },
  });
}

const authLimiter    = makeRateLimit(15 * 60 * 1000, 10,  'Demasiados intentos de login. Esperá 15 minutos.');
const aiLimiter      = makeRateLimit(60 * 60 * 1000, 30,  'Límite de IA alcanzado (30/hora). Reintentá en 1 hora.');
const apiLimiter     = makeRateLimit(60 * 1000,       120, 'Demasiadas requests. Esperá un minuto.');
const nhtsaLimiter   = makeRateLimit(60 * 1000,       20,  'Límite NHTSA alcanzado.');

app.use('/api/', apiLimiter);

// ── INPUT VALIDATION HELPERS ──────────────────────────────────
function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function validatePassword(pass) {
  return pass && pass.length >= 6;
}
function sanitizeString(str, maxLen = 255) {
  if (!str || typeof str !== 'string') return '';
  return str.trim().substring(0, maxLen).replace(/[<>]/g, '');
}
function safeError(e, fallback = 'Error interno del servidor') {
  // Show full error in non-production for debugging
  if (process.env.NODE_ENV !== 'production') return (fallback + ': ' + (e?.message||'')).trim();
  return fallback;
}

// ── AUTH MIDDLEWARE ───────────────────────────────────────────
async function requireAuth(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (!token) return res.status(401).json({ ok: false, error: 'Autenticación requerida' });
  try {
    if (db) {
      const session = await db.getSession(token);
      if (!session) return res.status(401).json({ ok: false, error: 'Sesión expirada. Ingresá de nuevo.' });
      req.user = { id: session.user_id, email: session.email, tallerName: session.taller || session.taller_name };
      return next();
    }
    next(); // no DB: allow through
  } catch(e) {
    return res.status(401).json({ ok: false, error: 'Token inválido' });
  }
}

// ── GLOBALS ───────────────────────────────────────────────────
function generateToken() { return crypto.randomBytes(32).toString('hex'); }

// Wait for DB to be ready (up to 10s on startup)
async function waitForDB(maxWaitMs = 30000) {
  if (db) return db;
  console.log('Waiting for DB connection...');
  const start = Date.now();
  while (!db && Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 500));
  }
  if (!db) console.error('DB not available after', maxWaitMs, 'ms');
  return db;
}

let db  = null;
let obd = null;

// ── OBD SIMULATION ────────────────────────────────────────────
function createSimOBD() {
  const { EventEmitter } = require('events');
  const em = new EventEmitter();
  let liveData = {}, history = [], interval = null, tick = 0;

  const sim = {
    isConnected: () => true, simMode: true,
    getLiveData: () => liveData, getHistory: () => history.slice(-60),
    getDTCs: () => ['P0171','P0420','P0441'], vinCode: null, protocol: 'SIMULACION',
    on: (e,cb) => em.on(e,cb), removeListener: (e,cb) => em.removeListener(e,cb),
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
        const rpm     = Math.round(750 + Math.sin(tick*.1)*200 + (Math.random()-.5)*50);
        const coolant = Math.round(85 + Math.sin(tick*.05)*3);
        const o2      = parseFloat((.1+Math.abs(Math.sin(tick*.3))*.85).toFixed(3));
        const ftShort = parseFloat((14+(Math.random()-.5)*6).toFixed(1));
        const maf     = parseFloat((1.6+(Math.random()-.5)*.4).toFixed(2));
        const load    = Math.round(20+Math.sin(tick*.08)*10);
        liveData = {
          rpm:             { value:rpm,     unit:'rpm',  label:'RPM' },
          speed:           { value:0,        unit:'km/h', label:'Velocidad' },
          coolant:         { value:coolant,  unit:'°C',   label:'Temp. Refrigerante' },
          intake_temp:     { value:24,        unit:'°C',   label:'Temp. Admisión' },
          throttle:        { value:15,        unit:'%',    label:'Mariposa' },
          map:             { value:45,        unit:'kPa',  label:'MAP' },
          maf:             { value:maf,       unit:'g/s',  label:'MAF' },
          fuel_trim_short: { value:ftShort,   unit:'%',    label:'Fuel Trim C' },
          fuel_trim_long:  { value:22.1,      unit:'%',    label:'Fuel Trim L' },
          o2_b1s1:         { value:o2,        unit:'V',    label:'O2 B1S1' },
          o2_b1s2:         { value:parseFloat((.6+Math.random()*.3).toFixed(3)), unit:'V', label:'O2 B1S2' },
          voltage:         { value:12.6,      unit:'V',    label:'Voltaje' },
          engine_load:     { value:load,      unit:'%',    label:'Carga Motor' },
          timing:          { value:14.2,      unit:'°',    label:'Avance' },
        };
        if (tick%2===0) {
          history.push({ ts:Date.now(), rpm, coolant, o2, load, ftShort });
          if (history.length>120) history.shift();
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
  // Connect to DB with retries (Railway DB can take a few seconds to wake up)
  const dbModule = require('./db');
  let connected = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await dbModule.connectDB();
      db = dbModule;
      connected = true;
      console.log('✓ PostgreSQL conectado (intento ' + attempt + ')');
      break;
    } catch(e) {
      console.error('✗ DB intento ' + attempt + '/5:', e.message);
      if (attempt < 5) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  if (!connected) {
    console.error('✗ No se pudo conectar a PostgreSQL después de 5 intentos');
    db = null;
  } else {
    try {
      const { importDTCDatabase } = require('../db/import_dtc');
      await importDTCDatabase(db);
    } catch(ie) { console.log('⚠ DTC import:', ie.message); }
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

wss.on('connection', (ws, req) => {
  const id = uuidv4();
  clients.set(id, { ws, vehicleId: null });
  sendTo(ws, 'connected', {
    clientId: id, sim_mode: obd?.simMode||true,
    live_data: obd?.getLiveData()||{}, dtcs: obd?.getDTCs()||[],
    history: obd?.getHistory ? obd.getHistory() : [],
  });
  ws.on('message', async (raw) => {
    if (raw.length > 10240) return; // 10kb max WS message
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
  sim_mode: obd?.simMode||false, uptime: Math.round(process.uptime()), version:'2.1.0'
}));

// ── AUTH ──────────────────────────────────────────────────────
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const email     = sanitizeString(req.body.email, 255).toLowerCase();
    const password  = req.body.password || '';
    const tallerName = sanitizeString(req.body.taller_name || req.body.tallerName, 100) || 'Mi Taller';

    if (!validateEmail(email))    return res.status(400).json({ ok: false, error: 'Email inválido' });
    if (!validatePassword(password)) return res.status(400).json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres' });
    if (!tallerName.trim())       return res.status(400).json({ ok: false, error: 'Ingresá el nombre del taller' });

    const dbReady = await waitForDB();
    if (!dbReady) return res.status(503).json({ ok: false, error: 'El servidor está iniciando. Recargá la página en 30 segundos.' });

    const existing = await db.query('SELECT id FROM users WHERE email=$1', [email]);
    if (existing.rows.length) return res.status(400).json({ ok: false, error: 'Ya existe una cuenta con ese email' });

    const hash = crypto.createHash('sha256').update(password).digest('hex');
    const r = await db.query(
      'INSERT INTO users (email, password_hash, taller_name) VALUES ($1,$2,$3) RETURNING id, email, taller_name',
      [email, hash, tallerName]
    );
    const user = r.rows[0];
    const token = generateToken();
    await db.createSession(token, user.id, user.email, user.taller_name);
    console.log('NEW USER:', user.email, '|', user.taller_name, '|', new Date().toISOString());
    res.json({ ok: true, token, user: { id: user.id, email: user.email, tallerName: user.taller_name } });
  } catch(e) {
    console.error('Register error:', e.message, e.stack);
    res.status(500).json({ ok: false, error: safeError(e, 'Error al crear la cuenta: ' + e.message) });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const email    = sanitizeString(req.body.email, 255).toLowerCase();
    const password = req.body.password || '';

    if (!validateEmail(email)) return res.status(400).json({ ok: false, error: 'Email inválido' });
    if (!password)             return res.status(400).json({ ok: false, error: 'Contraseña requerida' });
    
    const dbReady = await waitForDB();
    if (!dbReady) return res.status(503).json({ ok: false, error: 'El servidor está iniciando. Recargá la página en 30 segundos.' });

    const hash = crypto.createHash('sha256').update(password).digest('hex');
    const r = await db.query(
      'SELECT id, email, taller_name FROM users WHERE email=$1 AND password_hash=$2',
      [email, hash]
    );
    if (!r.rows.length) return res.status(401).json({ ok: false, error: 'Email o contraseña incorrectos' });

    const user  = r.rows[0];
    const token = generateToken();
    await db.createSession(token, user.id, user.email, user.taller_name);
    res.json({ ok: true, token, user: { id: user.id, email: user.email, tallerName: user.taller_name } });
  } catch(e) {
    console.error('Login error:', e.message, e.stack);
    res.status(500).json({ ok: false, error: safeError(e, 'Error al iniciar sesión: ' + e.message) });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = req.headers['x-auth-token'];
    if (token && db) await db.deleteSession(token).catch(()=>{});
    res.json({ ok: true });
  } catch(e) { res.json({ ok: true }); }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const token = req.headers['x-auth-token'];
    if (!token) return res.status(401).json({ ok: false, error: 'Sin token' });
    if (!db) return res.status(503).json({ ok: false, error: 'Sin DB' });
    const session = await db.getSession(token);
    if (!session) return res.status(401).json({ ok: false, error: 'Sesión expirada' });
    res.json({ ok: true, user: { id: session.user_id, email: session.email, tallerName: session.taller || session.taller_name } });
  } catch(e) { res.status(401).json({ ok: false, error: 'Token inválido' }); }
});

// ── OBD ──────────────────────────────────────────────────────
app.get('/api/obd/status', (req, res) => res.json({
  ok: true, connected: obd?.isConnected()||false, sim_mode: obd?.simMode||false,
  live_data: obd?.getLiveData()||{}, dtcs: obd?.getDTCs()||[], vin: obd?.vinCode||null,
  history: obd?.getHistory ? obd.getHistory().slice(-30) : []
}));

// ── VEHICLES ─────────────────────────────────────────────────
app.get('/api/vehicles', async (req,res) => {
  try {
    if (!db) return res.json({ok:true,data:[]});
    res.json({ok:true,data:await db.getVehicles()});
  } catch(e) { res.status(500).json({ok:false,error:safeError(e)}); }
});

app.get('/api/vehicles/:id', async (req,res) => {
  try {
    if (!db) return res.status(503).json({ok:false,error:'Sin DB'});
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ok:false,error:'ID inválido'});
    const v = await db.getVehicle(id);
    v ? res.json({ok:true,data:v}) : res.status(404).json({ok:false,error:'No encontrado'});
  } catch(e) { res.status(500).json({ok:false,error:safeError(e)}); }
});

app.post('/api/vehicles', async (req,res) => {
  try {
    if (!db) return res.status(503).json({ok:false,error:'Sin DB'});
    const { make, model, year, engine, vin, owner_name } = req.body;
    if (!make || !model) return res.status(400).json({ok:false,error:'Marca y modelo requeridos'});
    const clean = {
      make:       sanitizeString(make, 50),
      model:      sanitizeString(model, 50),
      year:       year ? parseInt(year) : null,
      engine:     sanitizeString(engine||'', 50),
      vin:        sanitizeString(vin||'', 20).toUpperCase(),
      owner_name: sanitizeString(owner_name||'', 100),
    };
    res.json({ok:true,data:await db.createVehicle(clean)});
  } catch(e) { res.status(500).json({ok:false,error:safeError(e)}); }
});

app.put('/api/vehicles/:id', async (req,res) => {
  try {
    if (!db) return res.status(503).json({ok:false,error:'Sin DB'});
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ok:false,error:'ID inválido'});
    res.json({ok:true,data:await db.updateVehicle(id, req.body)});
  } catch(e) { res.status(500).json({ok:false,error:safeError(e)}); }
});

app.delete('/api/vehicles/:id', async (req,res) => {
  try {
    if (!db) return res.status(503).json({ok:false,error:'Sin DB'});
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ok:false,error:'ID inválido'});
    await db.deleteVehicle(id);
    res.json({ok:true});
  } catch(e) { res.status(500).json({ok:false,error:safeError(e)}); }
});

// ── SCANS ─────────────────────────────────────────────────────
app.get('/api/vehicles/:id/scans', async (req,res) => {
  try {
    if (!db) return res.json({ok:true,data:[]});
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ok:false,error:'ID inválido'});
    res.json({ok:true,data:await db.getScans(id, 50)});
  } catch(e) { res.status(500).json({ok:false,error:safeError(e)}); }
});

app.post('/api/vehicles/:id/scans', async (req,res) => {
  try {
    if (!db) return res.status(503).json({ok:false,error:'Sin DB'});
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ok:false,error:'ID inválido'});
    res.json({ok:true,data:await db.saveScan(id, req.body.dtcs||[], req.body.live_data||{})});
  } catch(e) { res.status(500).json({ok:false,error:safeError(e)}); }
});

app.post('/api/vehicles/:id/scans/full', async (req,res) => {
  try {
    if (!db) return res.status(503).json({ok:false,error:'Sin DB'});
    res.json({ok:true,data:await db.saveFullScan(parseInt(req.params.id), req.body)});
  } catch(e) { res.status(500).json({ok:false,error:safeError(e)}); }
});

// ── HISTORIAL ────────────────────────────────────────────────
app.get('/api/vehicles/:id/history', async (req,res) => {
  try {
    if (!db) return res.json({ok:true,data:{scans:[],resolutions:[],dtc_stats:[],cost_by_month:[]}});
    res.json({ok:true,data:await db.getVehicleHistory(parseInt(req.params.id))});
  } catch(e) { res.status(500).json({ok:false,error:safeError(e)}); }
});

app.patch('/api/scans/:id/note', async (req,res) => {
  try {
    if (!db) return res.status(503).json({ok:false,error:'Sin DB'});
    const note = sanitizeString(req.body.note||'', 500);
    res.json({ok:true,data:await db.addScanNote(parseInt(req.params.id), note)});
  } catch(e) { res.status(500).json({ok:false,error:safeError(e)}); }
});

// ── JOBS ──────────────────────────────────────────────────────
app.get('/api/jobs', async (req,res) => {
  try {
    if (!db) return res.json({ok:true,data:[]});
    res.json({ok:true,data:await db.getJobs(req.query.status)});
  } catch(e) { res.status(500).json({ok:false,error:safeError(e)}); }
});

app.post('/api/jobs', async (req,res) => {
  try {
    if (!db) return res.status(503).json({ok:false,error:'Sin DB'});
    res.json({ok:true,data:await db.createJob(req.body)});
  } catch(e) { res.status(500).json({ok:false,error:safeError(e)}); }
});

app.patch('/api/jobs/:id/status', async (req,res) => {
  try {
    if (!db) return res.status(503).json({ok:false,error:'Sin DB'});
    const status = req.body.status;
    if (!['diag','repair','done'].includes(status)) return res.status(400).json({ok:false,error:'Estado inválido'});
    res.json({ok:true,data:await db.updateJobStatus(parseInt(req.params.id), status)});
  } catch(e) { res.status(500).json({ok:false,error:safeError(e)}); }
});

// ── RESOLUTIONS ───────────────────────────────────────────────
app.get('/api/resolutions/:code', async (req,res) => {
  try {
    if (!db) return res.json({ok:true,data:{resolutions:[],stats:[]}});
    const code = req.params.code.toUpperCase().replace(/[^A-Z0-9]/g,'');
    const [resolutions,stats] = await Promise.all([
      db.getResolutions(code), db.getResolutionStats(code)
    ]);
    res.json({ok:true,data:{resolutions,stats}});
  } catch(e) { res.status(500).json({ok:false,error:safeError(e)}); }
});

app.post('/api/resolutions', async (req,res) => {
  try {
    if (!db) return res.status(503).json({ok:false,error:'Sin DB'});
    res.json({ok:true,data:await db.saveResolution(req.body)});
  } catch(e) { res.status(500).json({ok:false,error:safeError(e)}); }
});

// ── VEHICLE PROFILES ──────────────────────────────────────────
app.get('/api/vehicles/:id/profile', async (req,res) => {
  try {
    if (!db) return res.json({ok:true,data:null});
    res.json({ok:true,data:await db.getProfile(parseInt(req.params.id))});
  } catch(e) { res.status(500).json({ok:false,error:safeError(e)}); }
});

app.post('/api/vehicles/:id/profile/generate', aiLimiter, async (req,res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ok:false,error:'API key no configurada'});
    const vehicleId = parseInt(req.params.id);
    const vehicle = db ? await db.getVehicle(vehicleId) : req.body;
    const scans   = db ? await db.getScans(vehicleId, 20) : [];
    const make    = sanitizeString(vehicle?.make||req.body.make||'Desconocido', 50);
    const model   = sanitizeString(vehicle?.model||req.body.model||'Desconocido', 50);
    const year    = vehicle?.year||req.body.year||'';
    const engine  = vehicle?.engine||req.body.engine||'';
    const allDtcs = [...new Set(scans.flatMap(s => s.dtcs||[]))];

    const prompt = 'Sos un experto en diagnóstico automotriz para Argentina. Generá un perfil técnico completo para: '
      + make + ' ' + model + ' ' + year + ' ' + engine + '. '
      + (allDtcs.length ? 'DTCs detectados: ' + allDtcs.join(', ') + '. ' : '')
      + 'Priorizá información del mercado argentino. '
      + 'SOLO JSON: {"overview":"resumen","common_issues":[{"title":"","description":"","frequency":"Muy frecuente|Frecuente|Ocasional","estimated_cost":"$XX-$XXX USD"}],"maintenance_schedule":{"oil_change_km":5000,"timing_belt_km":90000,"spark_plugs_km":30000,"notes":""},"specs":{"fuel_type":"Nafta","fuel_capacity_liters":50,"oil_type":"5W30","oil_capacity_liters":4.2,"tire_size":"195/65 R15","coolant_type":"OAT"},"argentina_notes":"","dtc_patterns":"","reliability_score":7,"sources":[]}';

    const raw = await callClaude(prompt, true, 1800);
    const clean = raw.replace(/```json/g,'').replace(/```/g,'');
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ok:false,error:'No se pudo generar el perfil'});
    const profileData = JSON.parse(match[0]);
    profileData.vehicle = { make, model, year, engine };
    profileData.generated_at = new Date().toISOString();
    profileData.dtc_history = allDtcs;
    if (db) await db.upsertProfile(vehicleId, profileData);
    res.json({ok:true,data:profileData});
  } catch(e) {
    console.error('Profile error:', e.message);
    res.status(500).json({ok:false,error:safeError(e,'Error al generar perfil')});
  }
});

// ── DTC KNOWLEDGE ─────────────────────────────────────────────
app.get('/api/dtc/search', async (req,res) => {
  try {
    const q = sanitizeString(req.query.q||'', 20);
    if (!q || !db) return res.json({ok:true,data:[]});
    res.json({ok:true,data:await db.searchDTCs(q,20)});
  } catch(e) { res.status(500).json({ok:false,error:safeError(e)}); }
});

app.get('/api/dtc/:code', async (req,res) => {
  try {
    const code = req.params.code.toUpperCase().replace(/[^A-Z0-9]/g,'').substring(0,10);
    if (db) {
      const local = await db.getDTCWithFullData(code);
      if (local) return res.json({ok:true,data:local,source:'local_db'});
    }
    res.status(404).json({ok:false,error:'No encontrado'});
  } catch(e) { res.status(500).json({ok:false,error:safeError(e)}); }
});

// ── AI HELPERS ────────────────────────────────────────────────
async function callClaude(prompt, webSearch, maxTokens) {
  const fetch = require('node-fetch');
  maxTokens = maxTokens || 1500;
  const body = { model:'claude-sonnet-4-20250514', max_tokens:maxTokens, messages:[{role:'user',content:prompt}] };
  if (webSearch) body.tools = [{type:'web_search_20250305',name:'web_search'}];
  const r = await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
    body:JSON.stringify(body)
  });
  if (!r.ok) throw new Error('Claude API error: ' + r.status);
  const data = await r.json();
  let raw='';
  for (const b of (data.content||[])) if(b.type==='text') raw+=b.text;
  return raw;
}

// ── AI DIAGNOSE ───────────────────────────────────────────────
app.post('/api/ai/diagnose', aiLimiter, async (req,res) => {
  try {
    const code   = sanitizeString(req.body.code||'', 10).toUpperCase().replace(/[^A-Z0-9]/g,'');
    const brand  = sanitizeString(req.body.brand||'', 50);
    const model  = sanitizeString(req.body.model||'', 50);
    if (!code) return res.status(400).json({ok:false,error:'Código requerido'});
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ok:false,error:'API key no configurada'});

    let localDTC = null, communityData = [];
    if (db) {
      [localDTC, communityData] = await Promise.all([
        db.getDTCWithFullData(code).catch(()=>null),
        db.getResolutionStats(code).catch(()=>[]),
      ]);
    }

    const communityLines = communityData.length > 0
      ? communityData.map(r => r.cause_found+': '+r.count+' casos'+(r.avg_cost?', $'+Math.round(r.avg_cost)+' USD':'')).join(' | ')
      : 'Sin datos';

    const dataSource = (req.body.live_data && Object.keys(req.body.live_data).length) ? req.body.live_data : (req.body.freeze_frame||{});
    const scannerLines = Object.values(dataSource)
      .filter(v => v && v.value !== undefined)
      .map(v => v.label+': '+v.value+v.unit).join(', ') || req.body.scanner_data || 'No disponible';

    let localLines = 'Sin datos locales.';
    if (localDTC) {
      localLines = 'Descripcion: '+(localDTC.description||'')+' | Causas: '+(localDTC.causes||[]).join(', ')+' | Costo LATAM: '+(localDTC.latam_cost_usd||'N/A');
    }

    const prompt = 'Experto diagnostico automotriz Argentina. Codigo: '+code+'. Vehiculo: '+brand+' '+model+'. '
      + 'BASE LOCAL: '+localLines+'. SCANNER: '+scannerLines+'. COMUNIDAD: '+communityLines+'. '
      + 'SOLO JSON: {"code":"'+code+'","primary_diagnosis":"","confidence":85,"scanner_interpretation":"","recommended_action":"","differential":[{"cause":"","probability":75,"evidence_for":"","evidence_against":"","confirming_test":"","estimated_cost_usd":"XX-XXX"}],"parts_to_check":[],"tools_needed":[],"latam_availability":""}';

    const raw = await callClaude(prompt, false, 1500);
    const clean = raw.replace(/```json/g,'').replace(/```/g,'');
    const match = clean.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : { code, primary_diagnosis: raw, confidence:50, differential:[] };
    if (localDTC) { parsed.local_causes=localDTC.causes; parsed.latam_cost=localDTC.latam_cost_usd; }
    parsed.community_data = communityData;
    res.json({ok:true,data:parsed});
  } catch(e) {
    console.error('Diagnose error:', e.message);
    res.status(500).json({ok:false,error:safeError(e,'Error en diagnóstico')});
  }
});

// ── AI RESEARCH ───────────────────────────────────────────────
app.post('/api/ai/research', aiLimiter, async (req,res) => {
  try {
    const code    = sanitizeString(req.body.code||'', 10).toUpperCase().replace(/[^A-Z0-9]/g,'');
    const brand   = sanitizeString(req.body.brand||'', 50);
    const model   = sanitizeString(req.body.model||'', 50);
    const symptoms= sanitizeString(req.body.symptoms||'', 200);
    const scanner = sanitizeString(req.body.scanner_data||'', 200);
    if (!code) return res.status(400).json({ok:false,error:'Código requerido'});
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ok:false,error:'API key no configurada'});

    let localContext = '';
    if (db) {
      const localDTC = await db.getDTCWithFullData(code).catch(()=>null);
      if (localDTC) localContext = 'Datos locales: causas='+( localDTC.causes||[]).join(', ')+', costo LATAM='+(localDTC.latam_cost_usd||'N/A')+'. ';
    }

    const prompt = 'Experto tecnico automotriz LATAM Argentina. Codigo DTC '+code+' para '+brand+' '+model+'. '
      + (symptoms?'Sintomas: '+symptoms+'. ':'') + (scanner?'Scanner: '+scanner+'. ':'') + localContext
      + 'Busca en fuentes tecnicas. Prioriza info y precios para Argentina. '
      + 'SOLO JSON: {"code":"'+code+'","title":"","severity":"Critico|Moderado|Bajo","system":"","description":"","brands":[],"causes":[],"diagnosis_steps":[],"brand_specific":"","latam_notes":"","scanner_interpretation":"","costs":{"diagnostic":"","repair_low":"","repair_high":"","latam_parts_usd":""},"sources":[]}';

    const raw = await callClaude(prompt, true, 1500);
    const clean = raw.replace(/```json/g,'').replace(/```/g,'');
    const match = clean.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : {code, title:'Resultado', description:raw, causes:[], costs:{}};
    if (db && parsed.code) await db.upsertDTCInfo(parsed).catch(()=>{});
    res.json({ok:true,data:parsed});
  } catch(e) {
    console.error('Research error:', e.message);
    res.status(500).json({ok:false,error:safeError(e,'Error en investigación')});
  }
});

app.post('/api/ai/analyze-multi', aiLimiter, async (req,res) => {
  try {
    const codes = (req.body.codes||[]).slice(0,10).map(c => sanitizeString(c,10).toUpperCase().replace(/[^A-Z0-9]/g,''));
    const brand = sanitizeString(req.body.brand||'',50);
    const model = sanitizeString(req.body.model||'',50);
    if (!codes.length) return res.status(400).json({ok:false,error:'Códigos requeridos'});
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ok:false,error:'API key no configurada'});

    const prompt = 'Experto diagnostico automotriz LATAM. '+brand+' '+model+'. DTCs simultaneos: '+codes.join(', ')+'. '
      + 'Identifica causa raiz. SOLO JSON: {"root_cause":"","root_explanation":"","codes":[{"code":"","is_root":true,"title":"","role":"CAUSA RAIZ|CONSECUENCIA|INDEPENDIENTE","description":"","causes":[],"repair_order":1,"estimated_cost":"$XX-$XXX"}],"repair_sequence":""}';
    const raw   = await callClaude(prompt, true, 1200);
    const clean = raw.replace(/```json/g,'').replace(/```/g,'');
    const match = clean.match(/\{[\s\S]*\}/);
    res.json({ok:true,data:match?JSON.parse(match[0]):{codes:[],root_explanation:raw}});
  } catch(e) { res.status(500).json({ok:false,error:safeError(e)}); }
});

app.post('/api/ai/symptoms', aiLimiter, async (req,res) => {
  try {
    const symptoms = (req.body.symptoms||[]).slice(0,20).map(s=>sanitizeString(s,50));
    const brand    = sanitizeString(req.body.brand||'',50);
    const model    = sanitizeString(req.body.model||'',50);
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ok:false,error:'API key no configurada'});

    const prompt = 'Experto diagnostico LATAM. '+brand+' '+model+'. Sintomas: '+symptoms.join(', ')+'. '
      + 'SOLO JSON: {"probable_dtcs":[{"code":"","probability":85,"title":"","why":"","system":""}],"recommended_tests":[],"urgency":"URGENTE|MODERADO|BAJO","urgency_reason":""}';
    const raw   = await callClaude(prompt, false, 800);
    const clean = raw.replace(/```json/g,'').replace(/```/g,'');
    const match = clean.match(/\{[\s\S]*\}/);
    res.json({ok:true,data:match?JSON.parse(match[0]):{probable_dtcs:[],urgency:'MODERADO',urgency_reason:raw}});
  } catch(e) { res.status(500).json({ok:false,error:safeError(e)}); }
});

app.post('/api/ai/chat', aiLimiter, async (req,res) => {
  try {
    const message = sanitizeString(req.body.message||'', 500);
    if (!message) return res.status(400).json({ok:false,error:'Mensaje requerido'});
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ok:false,error:'API key no configurada'});

    const prompt = 'Sos un experto en diagnóstico automotriz para Argentina. Responde en español, técnico y conciso. Max 3 párrafos. Contexto: '
      + JSON.stringify(req.body.context||{}) + '. Pregunta: ' + message;
    const response = await callClaude(prompt, false, 600);
    res.json({ok:true,data:{response}});
  } catch(e) { res.status(500).json({ok:false,error:safeError(e)}); }
});

// ── LEARNING ─────────────────────────────────────────────────
app.post('/api/learn/case', async (req,res) => {
  try {
    const dtc_code   = sanitizeString(req.body.dtc_code||'',10).toUpperCase().replace(/[^A-Z0-9]/g,'');
    const cause_found= sanitizeString(req.body.cause_found||'',500);
    if (!dtc_code||!cause_found) return res.status(400).json({ok:false,error:'DTC y causa requeridos'});
    if (!db) return res.json({ok:true,message:'Sin DB — no guardado'});

    await db.query(
      'INSERT INTO resolutions (vehicle_id,dtc_code,cause_found,fix_applied,cost_usd,mechanic,confirmed,parts_used) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [req.body.vehicle_id||null, dtc_code, cause_found,
       sanitizeString(req.body.fix_applied||cause_found,500),
       req.body.cost_usd||null, sanitizeString(req.body.mechanic_notes||'',200), true, req.body.parts_replaced||[]]
    );
    console.log('CASE LEARNED:', dtc_code, '->', cause_found);
    res.json({ok:true,message:'Caso guardado'});
  } catch(e) { res.status(500).json({ok:false,error:safeError(e)}); }
});

app.get('/api/learn/stats', async (req,res) => {
  try {
    if (!db) return res.json({ok:true,data:{total:0,top_codes:[],top_causes:[],recent:[]}});
    const [total,topCodes,topCauses,recent] = await Promise.all([
      db.query('SELECT COUNT(*) as count FROM resolutions WHERE confirmed=TRUE'),
      db.query('SELECT dtc_code,COUNT(*) as count,AVG(cost_usd) as avg_cost FROM resolutions WHERE confirmed=TRUE GROUP BY dtc_code ORDER BY count DESC LIMIT 10'),
      db.query('SELECT cause_found,COUNT(*) as count,AVG(cost_usd) as avg_cost FROM resolutions WHERE confirmed=TRUE GROUP BY cause_found ORDER BY count DESC LIMIT 10'),
      db.query('SELECT r.*,v.make,v.model,v.year FROM resolutions r LEFT JOIN vehicles v ON r.vehicle_id=v.id WHERE r.confirmed=TRUE ORDER BY r.created_at DESC LIMIT 20'),
    ]);
    res.json({ok:true,data:{total:parseInt(total.rows[0].count),top_codes:topCodes.rows,top_causes:topCauses.rows,recent:recent.rows}});
  } catch(e) { res.status(500).json({ok:false,error:safeError(e)}); }
});

// ── ASSISTANT ─────────────────────────────────────────────────
app.post('/api/assistant/ask', aiLimiter, async (req,res) => {
  try {
    const message = sanitizeString(req.body.message||'', 500);
    if (!message) return res.status(400).json({ok:false,error:'Mensaje requerido'});
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ok:false,error:'API key no configurada'});

    const context = req.body.context||{};
    const vehicle = context.vehicle||{};
    const dtcs    = (context.dtcs||[]).slice(0,10).map(d=>sanitizeString(d,10));
    const history = (context.history||[]).slice(-6);

    let communityContext='', dtcContext='';
    if (db && dtcs.length) {
      for (const code of dtcs.slice(0,3)) {
        const stats = await db.getResolutionStats(code).catch(()=>[]);
        if (stats.length) communityContext += code+': '+stats.slice(0,2).map(s=>s.cause_found+'('+s.count+' casos)').join(', ')+'. ';
        const local = await db.getDTCWithFullData(code).catch(()=>null);
        if (local) dtcContext += code+': '+(local.causes||[]).slice(0,3).join(', ')+'. ';
      }
    }

    const systemPrompt = 'Sos el asistente de AutoDiag Pro para talleres en Argentina. '
      + 'Responde en español, técnico pero claro. Máximo 3 oraciones salvo que pidan más. '
      + 'Prioriza soluciones económicas y prácticas para Argentina. '
      + 'Vehículo: '+(vehicle.make||'')+' '+(vehicle.model||'')+' '+(vehicle.year||'')+'. '
      + 'DTCs activos: '+(dtcs.join(', ')||'ninguno')+'. '
      + (dtcContext?'Info técnica: '+dtcContext:'')
      + (communityContext?'Casos comunidad: '+communityContext:'');

    const messages = history.map(h=>({role:h.role,content:sanitizeString(h.content,500)}));
    messages.push({role:'user',content:message});

    const fetch = require('node-fetch');
    const r = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:500,system:systemPrompt,messages})
    });
    if (!r.ok) throw new Error('Claude API '+r.status);
    const data = await r.json();
    const response = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
    res.json({ok:true,data:{response,tokens:data.usage}});
  } catch(e) {
    console.error('Assistant error:', e.message);
    res.status(500).json({ok:false,error:safeError(e,'Error en asistente')});
  }
});

// ── NHTSA ─────────────────────────────────────────────────────
const MAKE_MAP = {
  'toyota':'toyota','ford':'ford','chevrolet':'chevrolet','gm':'chevrolet',
  'volkswagen':'volkswagen','vw':'volkswagen','honda':'honda','nissan':'nissan',
  'hyundai':'hyundai','kia':'kia','bmw':'bmw','mercedes':'mercedes-benz',
  'mercedes-benz':'mercedes-benz','renault':'renault','peugeot':'peugeot',
  'fiat':'fiat','jeep':'jeep','dodge':'dodge','ram':'ram','chrysler':'chrysler',
  'subaru':'subaru','mazda':'mazda','mitsubishi':'mitsubishi','suzuki':'suzuki',
  'volvo':'volvo','audi':'audi','lexus':'lexus','seat':'seat','skoda':'skoda',
};

app.get('/api/nhtsa/full', nhtsaLimiter, async (req,res) => {
  try {
    const make  = sanitizeString(req.query.make||'',50);
    const model = sanitizeString(req.query.model||'',50);
    const year  = parseInt(req.query.year)||0;
    if (!make||!model||!year) return res.status(400).json({ok:false,error:'make, model y year requeridos'});
    if (year < 1980 || year > new Date().getFullYear()+2) return res.status(400).json({ok:false,error:'Año inválido'});

    const nhtsaMake = MAKE_MAP[make.toLowerCase()]||make;
    const fetch = require('node-fetch');
    const opts = { timeout: 10000 };
    const enc = encodeURIComponent;

    const [recallsR,complaintsR,ratingsR] = await Promise.allSettled([
      fetch(`https://api.nhtsa.dot.gov/recalls/recallsByVehicle?make=${enc(nhtsaMake)}&model=${enc(model)}&modelYear=${year}`,opts).then(r=>r.json()),
      fetch(`https://api.nhtsa.dot.gov/complaints/complaintsByVehicle?make=${enc(nhtsaMake)}&model=${enc(model)}&modelYear=${year}`,opts).then(r=>r.json()),
      fetch(`https://api.nhtsa.dot.gov/SafetyRatings/modelyear/${year}/make/${enc(nhtsaMake)}/model/${enc(model)}`,opts).then(r=>r.json()),
    ]);

    const recalls    = recallsR.status==='fulfilled'    ? (recallsR.value.results||[])     : [];
    const complaints = complaintsR.status==='fulfilled' ? (complaintsR.value.results||[]).slice(0,15) : [];
    const ratings    = ratingsR.status==='fulfilled'    ? (ratingsR.value.Results||[])     : [];

    res.json({
      ok:true, make, model, year,
      recalls:    recalls.map(r=>({id:r.NHTSACampaignNumber,subject:r.Subject,summary:r.Summary,consequence:r.Consequence,remedy:r.Remedy,component:r.Component,date:r.ReportReceivedDate,park_it:r.ParkIt})),
      complaints: complaints.map(c=>({id:c.odiNumber,summary:c.summary,components:c.components,crash:c.crash,fire:c.fire,injuries:c.numberOfInjuries,deaths:c.numberOfDeaths,date:c.dateOfIncident})),
      ratings:    ratings.slice(0,3).map(v=>({desc:v.VehicleDescription,overall:v.OverallRating,front:v.OverallFrontCrashRating,side:v.OverallSideCrashRating,rollover:v.RolloverRating})),
    });
  } catch(e) {
    console.error('NHTSA error:', e.message);
    res.json({ok:true,recalls:[],complaints:[],ratings:[],error:safeError(e)});
  }
});

// ── ROUTING ──────────────────────────────────────────────────
app.get('/', (req,res) => res.sendFile(path.join(__dirname,'../public/landing/index.html')));
app.get('/app', (req,res) => res.sendFile(path.join(__dirname,'../public/index.html')));

// SPA fallback
app.get('*', (req,res) => res.sendFile(path.join(__dirname,'../public/index.html')));

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ ok: false, error: 'Error interno del servidor' });
});

// ── START ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log('✓ AutoDiag Pro v2.1 → puerto ' + PORT);
  await loadModules();
  // Clean expired sessions every hour
  setInterval(async () => {
    if (db) await db.cleanExpiredSessions().catch(()=>{});
  }, 60 * 60 * 1000);
});

// Handle uncaught exceptions — log but don't crash
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});
