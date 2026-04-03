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
  try {
    await connectDB();
    console.log('✓ PostgreSQL conectado');

    // Intentar conectar OBD-II si hay config
    if (process.env.OBD_HOST) {
      await obd.connect({
        type: process.env.OBD_TYPE || 'wifi',  // wifi | bluetooth | serial
        host: process.env.OBD_HOST,
        port: parseInt(process.env.OBD_PORT) || 35000,
        serialPath: process.env.OBD_SERIAL_PATH
      });
      console.log('✓ OBD-II ELM327 conectado');
    } else {
      console.log('⚠ OBD_HOST no configurado — modo simulación activo');
      obd.startSimulation();
    }

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`✓ AutoDiag Pro corriendo en puerto ${PORT}`);
      console.log(`  → Dashboard: http://localhost:${PORT}`);
      console.log(`  → API:       http://localhost:${PORT}/api`);
      console.log(`  → WS:        ws://localhost:${PORT}`);
    });

  } catch (err) {
    console.error('✗ Error al iniciar:', err.message);
    process.exit(1);
  }
}

init();

module.exports = { app, server, wss };
