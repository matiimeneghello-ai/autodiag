require('dotenv').config();
const express    = require('express');
const http       = require('http');
const WebSocket  = require('ws');
const cors       = require('cors');
const compression = require('compression');
const path       = require('path');

const { connectDB }   = require('./db');
const obd             = require('./obd');
const apiRoutes       = require('./routes/api');
const wsHandler       = require('./ws');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// ── Middleware ──────────────────────────────────────────────
app.use(compression());
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── API Routes ──────────────────────────────────────────────
app.use('/api', apiRoutes);

// Health check para Railway
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    obd_connected: obd.isConnected(),
    uptime: process.uptime()
  });
});

// Serve frontend SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── WebSocket ───────────────────────────────────────────────
wsHandler(wss, obd);

// ── Init ────────────────────────────────────────────────────
async function init() {
  console.log('Iniciando AutoDiag Pro...');
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'configurado ✓' : 'NO configurado ✗');
  console.log('ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? 'configurado ✓' : 'NO configurado ✗');

  // Conectar DB (no bloquea el inicio si falla)
  if (process.env.DATABASE_URL) {
    try {
      await connectDB();
      console.log('✓ PostgreSQL conectado');
    } catch (err) {
      console.error('✗ PostgreSQL error:', err.message);
      console.error(err.stack);
    }
  } else {
    console.log('⚠ DATABASE_URL no configurado — sin base de datos');
  }

  // OBD-II
  if (process.env.OBD_HOST) {
    try {
      await obd.connect({
        type: process.env.OBD_TYPE || 'wifi',
        host: process.env.OBD_HOST,
        port: parseInt(process.env.OBD_PORT) || 35000,
        serialPath: process.env.OBD_SERIAL_PATH
      });
      console.log('✓ OBD-II ELM327 conectado');
    } catch (err) {
      console.error('✗ OBD-II error:', err.message);
      obd.startSimulation();
    }
  } else {
    console.log('⚠ OBD_HOST no configurado — modo simulación activo');
    obd.startSimulation();
  }

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`✓ AutoDiag Pro corriendo en puerto ${PORT}`);
  });
}

init();

module.exports = { app, server, wss };
