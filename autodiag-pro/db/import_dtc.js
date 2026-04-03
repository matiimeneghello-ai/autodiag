/**
 * AutoDiag Pro — Importador de base de datos DTC
 * Importa la base de conocimiento técnica a PostgreSQL al iniciar el servidor
 * Se ejecuta automáticamente desde server/index.js
 */

const DTC_DATABASE = require('./dtc_seed');

async function importDTCDatabase(db) {
  try {
    // Verificar cuántos DTCs ya están en DB
    const existing = await db.query('SELECT COUNT(*) as count FROM dtcs');
    const count = parseInt(existing.rows[0].count);

    if (count >= DTC_DATABASE.length) {
      console.log(`✓ Base DTC ya importada (${count} códigos)`);
      return count;
    }

    console.log(`⏳ Importando base DTC: ${DTC_DATABASE.length} códigos técnicos...`);

    let imported = 0;
    let updated = 0;

    for (const dtc of DTC_DATABASE) {
      try {
        await db.query(`
          INSERT INTO dtcs (
            code, title, description, system, severity, causes, brands,
            symptoms, diagnostic_steps, diagnostic_params, freeze_frame_hints,
            differential_diagnosis, repair_priority, latam_cost_usd, latam_notes
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
          ON CONFLICT (code) DO UPDATE SET
            title=$2, description=$3, system=$4, severity=$5,
            causes=$6, brands=$7, symptoms=$8, diagnostic_steps=$9,
            diagnostic_params=$10, freeze_frame_hints=$11,
            differential_diagnosis=$12, repair_priority=$13,
            latam_cost_usd=$14, latam_notes=$15
        `, [
          dtc.code,
          dtc.title || '',
          dtc.description || '',
          dtc.system || '',
          dtc.severity || 'Moderado',
          dtc.causes || [],
          dtc.brands_affected || ['Universal'],
          dtc.symptoms || [],
          dtc.diagnostic_steps || [],
          JSON.stringify(dtc.diagnostic_params || {}),
          dtc.freeze_frame_hints || '',
          JSON.stringify(dtc.differential_diagnosis || {}),
          dtc.repair_priority || 2,
          dtc.latam_cost_usd || '',
          dtc.latam_notes || ''
        ]);
        imported++;
      } catch(e) {
        console.error(`Error importando ${dtc.code}:`, e.message);
      }
    }

    console.log(`✓ Base DTC importada: ${imported} códigos con datos técnicos completos`);
    return imported;

  } catch(e) {
    console.error('Error en importación DTC:', e.message);
    return 0;
  }
}

module.exports = { importDTCDatabase };
