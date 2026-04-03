/**
 * API REST — AutoDiag Pro
 * Endpoints para vehículos, DTCs, escaneos, taller e IA
 */

const express  = require('express');
const router   = express.Router();
const fetch    = require('node-fetch');
const db       = require('../db');
const obd      = require('../obd');

// ── Vehicles ───────────────────────────────────────────────
router.get('/vehicles', async (req, res) => {
  try {
    const vehicles = await db.getVehicles();
    res.json({ ok: true, data: vehicles });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get('/vehicles/:id', async (req, res) => {
  try {
    const v = await db.getVehicle(req.params.id);
    if (!v) return res.status(404).json({ ok: false, error: 'Vehículo no encontrado' });
    res.json({ ok: true, data: v });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/vehicles', async (req, res) => {
  try {
    const v = await db.createVehicle(req.body);
    res.json({ ok: true, data: v });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.put('/vehicles/:id', async (req, res) => {
  try {
    const v = await db.updateVehicle(req.params.id, req.body);
    res.json({ ok: true, data: v });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.delete('/vehicles/:id', async (req, res) => {
  try {
    await db.deleteVehicle(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Scans ─────────────────────────────────────────────────
router.get('/vehicles/:id/scans', async (req, res) => {
  try {
    const scans = await db.getScans(req.params.id);
    res.json({ ok: true, data: scans });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/vehicles/:id/scans', async (req, res) => {
  try {
    const scan = await db.saveScan(req.params.id, req.body.dtcs, req.body.live_data);
    res.json({ ok: true, data: scan });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── OBD Status ────────────────────────────────────────────
router.get('/obd/status', (req, res) => {
  res.json({
    ok: true,
    connected: obd.isConnected(),
    sim_mode: obd.simMode,
    live_data: obd.getLiveData(),
    dtcs: obd.getDTCs(),
    vin: obd.vinCode,
    protocol: obd.protocol
  });
});

router.post('/obd/connect', async (req, res) => {
  try {
    const { type, host, port, serial_path } = req.body;
    await obd.connect({ type, host, port: port || 35000, serialPath: serial_path });
    res.json({ ok: true, message: 'OBD-II conectado' });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/obd/disconnect', (req, res) => {
  obd.disconnect();
  res.json({ ok: true });
});

router.post('/obd/simulation', (req, res) => {
  if (req.body.active) {
    obd.startSimulation();
  } else {
    obd.stopSimulation();
  }
  res.json({ ok: true, sim_mode: obd.simMode });
});

// ── DTC Database ──────────────────────────────────────────
router.get('/dtc/:code', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const local = await db.getDTCInfo(code);
    if (local) return res.json({ ok: true, data: local, source: 'cache' });
    // Si no está en cache, retornar 404 para que el frontend use IA Research
    res.status(404).json({ ok: false, error: 'No encontrado en base local — usar IA Research' });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── AI Research ───────────────────────────────────────────
router.post('/ai/research', async (req, res) => {
  try {
    const { code, brand, model, symptoms, scanner_data } = req.body;
    if (!code) return res.status(400).json({ ok: false, error: 'Código DTC requerido' });

    const prompt = buildResearchPrompt(code, brand, model, symptoms, scanner_data);
    const result = await callClaudeAPI(prompt, true); // true = web search

    // Guardar en cache local
    if (result?.code) {
      await db.upsertDTCInfo(result).catch(console.error);
    }

    res.json({ ok: true, data: result });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/ai/analyze-multi', async (req, res) => {
  try {
    const { codes, brand, model } = req.body;
    if (!codes?.length) return res.status(400).json({ ok: false, error: 'Códigos requeridos' });

    const prompt = buildMultiAnalysisPrompt(codes, brand, model);
    const result = await callClaudeAPI(prompt, true);
    res.json({ ok: true, data: result });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/ai/symptoms', async (req, res) => {
  try {
    const { symptoms, brand, model, scanner_data } = req.body;
    const prompt = buildSymptomsPrompt(symptoms, brand, model, scanner_data);
    const result = await callClaudeAPI(prompt, false);
    res.json({ ok: true, data: result });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/ai/chat', async (req, res) => {
  try {
    const { message, context } = req.body;
    const prompt = `Sos un experto en diagnóstico automotriz para el mercado latinoamericano.\nContexto del vehículo: ${JSON.stringify(context || {})}\nPregunta del mecánico: ${message}\nRespondé de forma concisa y técnica en español.`;
    const response = await callClaudeAPIChat(prompt);
    res.json({ ok: true, data: { response } });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Resolutions / Learning ────────────────────────────────
router.get('/resolutions/:code', async (req, res) => {
  try {
    const resolutions = await db.getResolutions(req.params.code.toUpperCase());
    const stats = await db.getResolutionStats(req.params.code.toUpperCase());
    res.json({ ok: true, data: { resolutions, stats } });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/resolutions', async (req, res) => {
  try {
    const r = await db.saveResolution(req.body);
    res.json({ ok: true, data: r });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Workshop Jobs ─────────────────────────────────────────
router.get('/jobs', async (req, res) => {
  try {
    const jobs = await db.getJobs(req.query.status);
    res.json({ ok: true, data: jobs });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/jobs', async (req, res) => {
  try {
    const job = await db.createJob(req.body);
    res.json({ ok: true, data: job });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.patch('/jobs/:id/status', async (req, res) => {
  try {
    const job = await db.updateJobStatus(req.params.id, req.body.status);
    res.json({ ok: true, data: job });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── PDF Report ────────────────────────────────────────────
router.post('/report', async (req, res) => {
  try {
    // El PDF se genera en el frontend con jsPDF
    // Este endpoint guarda el reporte y puede enviarlo por email en el futuro
    res.json({ ok: true, message: 'Reporte registrado' });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Claude API helpers ────────────────────────────────────
async function callClaudeAPI(prompt, useWebSearch = false) {
  const body = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }]
  };
  if (useWebSearch) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
  }
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  let raw = '';
  for (const block of (data.content || [])) {
    if (block.type === 'text') raw += block.text;
  }
  try {
    const match = raw.replace(/```json|```/g,'').match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : { raw };
  } catch(e) { return { raw }; }
}

async function callClaudeAPIChat(prompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await response.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

function buildResearchPrompt(code, brand, model, symptoms, scanner) {
  return `Sos un experto técnico automotriz para el mercado LATINOAMERICANO (Argentina principalmente).
Investigá el código DTC ${code} para: ${brand||'Universal'} ${model||''}.
${symptoms ? 'Síntomas: ' + symptoms : ''}
${scanner ? 'Datos scanner en tiempo real: ' + scanner : ''}

Buscá en la web en fuentes técnicas: obd-codes.com, engine-codes.com, autozone.com, foros de mecánicos en español, TSB oficiales.
Priorizá información relevante para Argentina/LATAM (disponibilidad de repuestos, precios locales).

Respondé SOLO JSON:
{
  "code":"${code}",
  "title":"título descriptivo",
  "severity":"Crítico|Moderado|Bajo",
  "system":"sistema",
  "description":"descripción técnica completa",
  "brands":["marca1"],
  "causes":["causa más frecuente primero","causa2","causa3","causa4","causa5"],
  "diagnosis_steps":["paso1","paso2","paso3","paso4"],
  "brand_specific":"notas TSB específicas para ${brand||'esta marca'}",
  "latam_notes":"disponibilidad y precios aproximados en Argentina/LATAM",
  "scanner_interpretation":"interpretación de los datos del scanner provistos",
  "costs":{"diagnostic":"$XX","repair_low":"$XXX","repair_high":"$XXXX","latam_parts_usd":"precio repuesto"},
  "sources":["url1","url2"]
}`;
}

function buildMultiAnalysisPrompt(codes, brand, model) {
  return `Experto en diagnóstico automotriz. Vehículo: ${brand||'Universal'} ${model||''}.
Códigos DTC simultáneos: ${codes.join(', ')}.
Analizá la relación entre ellos e identificá causa raíz y consecuencias.
Respondé SOLO JSON:
{
  "root_cause":"PXXXX",
  "root_explanation":"por qué",
  "codes":[{"code":"PXXXX","is_root":true,"title":"título","role":"CAUSA RAÍZ|CONSECUENCIA|INDEPENDIENTE","description":"descripción","causes":["c1","c2"],"repair_order":1,"estimated_cost":"$XX-$XXX"}],
  "repair_sequence":"orden y lógica de reparación"
}`;
}

function buildSymptomsPrompt(symptoms, brand, model, scanner) {
  return `Experto diagnóstico automotriz LATAM. Vehículo: ${brand||'Universal'} ${model||''}.
Síntomas: ${(symptoms||[]).join(', ')}.
${scanner ? 'Datos scanner: ' + JSON.stringify(scanner) : ''}
Identificá los códigos DTC más probables con probabilidad estadística.
Respondé SOLO JSON:
{
  "probable_dtcs":[{"code":"PXXXX","probability":85,"title":"título","why":"por qué este síntoma apunta aquí","system":"sistema"}],
  "recommended_tests":["test1","test2","test3"],
  "urgency":"URGENTE|MODERADO|BAJO",
  "urgency_reason":"por qué"
}`;
}

module.exports = router;
