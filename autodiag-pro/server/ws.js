/**
 * WebSocket Handler
 * Gestiona conexiones del frontend y broadcast de datos OBD-II en tiempo real
 */

const { v4: uuidv4 } = require('uuid');
const db = require('./db');

function wsHandler(wss, obd) {
  const clients = new Map(); // clientId → { ws, vehicleId, subscriptions }

  // ── Broadcast a todos los clientes conectados ──────────────
  function broadcast(type, payload) {
    const msg = JSON.stringify({ type, payload, ts: Date.now() });
    wss.clients.forEach(ws => {
      if (ws.readyState === ws.OPEN) ws.send(msg);
    });
  }

  function sendTo(ws, type, payload) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type, payload, ts: Date.now() }));
    }
  }

  // ── Eventos OBD → broadcast a browsers ────────────────────
  obd.on('liveData', (data) => {
    broadcast('live_data', data);
  });

  obd.on('dtcs', (dtcs) => {
    broadcast('dtcs', { codes: dtcs, count: dtcs.length });
  });

  obd.on('dtcsCleared', () => {
    broadcast('dtcs_cleared', {});
  });

  obd.on('vin', (vin) => {
    broadcast('vin', { vin });
  });

  obd.on('disconnected', () => {
    broadcast('obd_disconnected', { message: 'Adaptador OBD-II desconectado' });
  });

  obd.on('error', (err) => {
    broadcast('obd_error', { message: err.message });
  });

  // ── Conexión de nuevo cliente (browser) ───────────────────
  wss.on('connection', (ws, req) => {
    const clientId = uuidv4();
    clients.set(clientId, { ws, vehicleId: null });

    console.log(`WS: cliente conectado [${clientId}] — total: ${clients.size}`);

    // Enviar estado inicial
    sendTo(ws, 'connected', {
      clientId,
      obd_status: obd.isConnected() ? 'connected' : 'disconnected',
      sim_mode: obd.simMode,
      live_data: obd.getLiveData(),
      dtcs: obd.getDTCs(),
      vin: obd.vinCode
    });

    // ── Mensajes del cliente ─────────────────────────────────
    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch(e) { return; }

      const { action, payload } = msg;

      switch (action) {

        case 'read_dtcs':
          try {
            const dtcs = await obd.readDTCs();
            // Guardar en DB si hay vehicleId
            const client = clients.get(clientId);
            if (client?.vehicleId && dtcs.length > 0) {
              await db.saveScan(client.vehicleId, dtcs, obd.getLiveData());
            }
            sendTo(ws, 'dtcs', { codes: dtcs, count: dtcs.length });
          } catch(e) {
            sendTo(ws, 'error', { message: 'Error leyendo DTCs: ' + e.message });
          }
          break;

        case 'clear_dtcs':
          try {
            await obd.clearDTCs();
            sendTo(ws, 'dtcs_cleared', { message: 'Códigos DTC borrados' });
          } catch(e) {
            sendTo(ws, 'error', { message: 'Error borrando DTCs: ' + e.message });
          }
          break;

        case 'read_freeze_frame':
          try {
            const ff = await obd.readFreezeFrame(payload?.dtc_index || 0);
            sendTo(ws, 'freeze_frame', { data: ff, dtc: payload?.dtc });
          } catch(e) {
            sendTo(ws, 'error', { message: 'Error leyendo freeze frame: ' + e.message });
          }
          break;

        case 'set_vehicle':
          clients.get(clientId).vehicleId = payload?.vehicleId;
          sendTo(ws, 'vehicle_set', { vehicleId: payload?.vehicleId });
          break;

        case 'start_recording':
          // Grabar sesión de datos en tiempo real para análisis posterior
          startRecording(clientId, payload?.vehicleId);
          sendTo(ws, 'recording_started', {});
          break;

        case 'stop_recording':
          const session = stopRecording(clientId);
          sendTo(ws, 'recording_stopped', { session });
          break;

        case 'ping':
          sendTo(ws, 'pong', { ts: Date.now() });
          break;

        default:
          sendTo(ws, 'error', { message: 'Acción desconocida: ' + action });
      }
    });

    ws.on('close', () => {
      console.log(`WS: cliente desconectado [${clientId}]`);
      stopRecording(clientId);
      clients.delete(clientId);
    });

    ws.on('error', (err) => {
      console.error(`WS error [${clientId}]:`, err.message);
      clients.delete(clientId);
    });
  });

  // ── Grabación de sesiones ─────────────────────────────────
  const recordings = new Map();

  function startRecording(clientId, vehicleId) {
    recordings.set(clientId, {
      vehicleId,
      startTs: Date.now(),
      frames: [],
      listener: (data) => {
        recordings.get(clientId)?.frames.push({ ts: Date.now(), data });
      }
    });
    obd.on('liveData', recordings.get(clientId).listener);
  }

  async function stopRecording(clientId) {
    const rec = recordings.get(clientId);
    if (!rec) return null;
    obd.removeListener('liveData', rec.listener);
    recordings.delete(clientId);
    // Guardar sesión en DB
    if (rec.vehicleId && rec.frames.length > 0) {
      await db.saveRecording(rec.vehicleId, rec.frames).catch(console.error);
    }
    return { frames: rec.frames.length, duration: Date.now() - rec.startTs };
  }

  // ── Heartbeat para mantener conexiones activas ────────────
  const heartbeat = setInterval(() => {
    wss.clients.forEach(ws => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'heartbeat', ts: Date.now() }));
      }
    });
  }, 30000);

  wss.on('close', () => clearInterval(heartbeat));

  console.log('✓ WebSocket server iniciado');
}

module.exports = wsHandler;
