require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
});

async function connectDB() {
  const client = await pool.connect();
  client.release();
  console.log('✓ DB pool connected, running migrations...');
  await runMigrations();
  console.log('✓ Migrations complete');
}

// Handle pool errors gracefully
pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

async function query(sql, params) {
  const client = await pool.connect();
  try { return await client.query(sql, params); }
  finally { client.release(); }
}

async function runMigrations() {
  // Users table para auth
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id          SERIAL PRIMARY KEY,
      email       VARCHAR(200) UNIQUE NOT NULL,
      password_hash VARCHAR(64) NOT NULL,
      taller_name VARCHAR(200) DEFAULT 'Mi Taller',
      plan        VARCHAR(20) DEFAULT 'free',
      created_at  TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id           SERIAL PRIMARY KEY,
      user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
      make         VARCHAR(100) NOT NULL,
      model        VARCHAR(100) NOT NULL,
      year         INTEGER,
      engine       VARCHAR(100),
      vin          VARCHAR(17),
      owner_name   VARCHAR(200),
      owner_phone  VARCHAR(50),
      notes        TEXT,
      mileage_km   INTEGER,
      fuel_type    VARCHAR(20) DEFAULT 'Nafta',
      transmission VARCHAR(20) DEFAULT 'Manual',
      color        VARCHAR(50),
      license_plate VARCHAR(20),
      created_at   TIMESTAMP DEFAULT NOW(),
      updated_at   TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS scans (
      id          SERIAL PRIMARY KEY,
      vehicle_id  INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
      dtcs        TEXT[],
      live_data   JSONB,
      protocol    VARCHAR(50),
      created_at  TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS dtcs (
      id                   SERIAL PRIMARY KEY,
      code                 VARCHAR(10) UNIQUE NOT NULL,
      title                VARCHAR(300),
      description          TEXT,
      system               VARCHAR(100),
      severity             VARCHAR(20),
      causes               TEXT[],
      brands               TEXT[],
      symptoms             TEXT[],
      diagnostic_steps     TEXT[],
      diagnostic_params    JSONB DEFAULT '{}',
      freeze_frame_hints   TEXT,
      differential_diagnosis JSONB DEFAULT '{}',
      repair_priority      INTEGER DEFAULT 2,
      latam_cost_usd       VARCHAR(50),
      latam_notes          TEXT,
      created_at           TIMESTAMP DEFAULT NOW()
    )
  `);
  
  // Add columns if they don't exist (for existing DB)
  const newCols = [
    "ALTER TABLE dtcs ADD COLUMN IF NOT EXISTS symptoms TEXT[]",
    "ALTER TABLE dtcs ADD COLUMN IF NOT EXISTS diagnostic_steps TEXT[]",
    "ALTER TABLE dtcs ADD COLUMN IF NOT EXISTS diagnostic_params JSONB DEFAULT '{}'",
    "ALTER TABLE dtcs ADD COLUMN IF NOT EXISTS freeze_frame_hints TEXT",
    "ALTER TABLE dtcs ADD COLUMN IF NOT EXISTS differential_diagnosis JSONB DEFAULT '{}'",
    "ALTER TABLE dtcs ADD COLUMN IF NOT EXISTS repair_priority INTEGER DEFAULT 2",
    "ALTER TABLE dtcs ADD COLUMN IF NOT EXISTS latam_cost_usd VARCHAR(50)",
    "ALTER TABLE dtcs ADD COLUMN IF NOT EXISTS latam_notes TEXT",
  ];
  for (const sql of newCols) {
    await query(sql).catch(()=>{});
  }

  await query(`
    CREATE TABLE IF NOT EXISTS resolutions (
      id          SERIAL PRIMARY KEY,
      vehicle_id  INTEGER REFERENCES vehicles(id),
      dtc_code    VARCHAR(10) NOT NULL,
      cause_found TEXT NOT NULL,
      fix_applied TEXT,
      cost_usd    NUMERIC(10,2),
      parts_used  TEXT[],
      mechanic    VARCHAR(200),
      confirmed   BOOLEAN DEFAULT TRUE,
      created_at  TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS workshop_jobs (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id),
      vehicle_id  INTEGER REFERENCES vehicles(id),
      car_label   VARCHAR(200) NOT NULL,
      mechanic    VARCHAR(200),
      dtcs        TEXT[],
      description TEXT,
      status      VARCHAR(20) DEFAULT 'diag',
      priority    VARCHAR(20) DEFAULT 'normal',
      notes       TEXT,
      created_at  TIMESTAMP DEFAULT NOW(),
      updated_at  TIMESTAMP DEFAULT NOW()
    )
  `);

  // Crear índices
  await query(`CREATE INDEX IF NOT EXISTS idx_vehicles_user ON vehicles(user_id)`).catch(()=>{});
  await query(`CREATE INDEX IF NOT EXISTS idx_scans_vehicle ON scans(vehicle_id)`).catch(()=>{});
  await query(`CREATE INDEX IF NOT EXISTS idx_scans_created ON scans(created_at DESC)`).catch(()=>{});
  await query(`CREATE INDEX IF NOT EXISTS idx_dtcs_code ON dtcs(code)`).catch(()=>{});
  await query(`CREATE INDEX IF NOT EXISTS idx_resolutions_code ON resolutions(dtc_code)`).catch(()=>{});
  await query(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON workshop_jobs(status)`).catch(()=>{});


  await query(`
    CREATE TABLE IF NOT EXISTS vehicle_profiles (
      id          SERIAL PRIMARY KEY,
      vehicle_id  INTEGER REFERENCES vehicles(id) ON DELETE CASCADE UNIQUE,
      profile     JSONB NOT NULL DEFAULT '{}',
      generated_at TIMESTAMP DEFAULT NOW(),
      updated_at  TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_profiles_vehicle ON vehicle_profiles(vehicle_id)`).catch(()=>{});


  // Add scanner snapshot columns to resolutions for learning system
  await query("ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS scanner_snapshot JSONB").catch(()=>{});
  await query("ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS freeze_frame_data JSONB").catch(()=>{});
  await query("ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS symptoms TEXT[]").catch(()=>{});
  await query("ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS resolution_time_hours NUMERIC").catch(()=>{});
  await query("ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS mechanic_notes TEXT").catch(()=>{});
  await query("ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS brand VARCHAR(100)").catch(()=>{});
  await query("ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS model VARCHAR(100)").catch(()=>{});
  await query("ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS year INTEGER").catch(()=>{});


  // Enhanced scan columns for historial
  await query("ALTER TABLE scans ADD COLUMN IF NOT EXISTS notes TEXT").catch(()=>{});
  await query("ALTER TABLE scans ADD COLUMN IF NOT EXISTS resolved_codes TEXT[] DEFAULT '{}'").catch(()=>{});
  await query("ALTER TABLE scans ADD COLUMN IF NOT EXISTS total_cost_usd NUMERIC").catch(()=>{});
  await query("ALTER TABLE scans ADD COLUMN IF NOT EXISTS freeze_frame JSONB").catch(()=>{});
  await query("ALTER TABLE scans ADD COLUMN IF NOT EXISTS severity VARCHAR(20)").catch(()=>{});


  // Sessions table — persiste entre reinicios del servidor
  await query(
    'CREATE TABLE IF NOT EXISTS sessions (' +
    'token VARCHAR(64) PRIMARY KEY,' +
    'user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,' +
    'email VARCHAR(255),' +
    'taller_name VARCHAR(255),' +
    'created_at TIMESTAMP DEFAULT NOW(),' +
    "expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '30 days'," +
    'last_used TIMESTAMP DEFAULT NOW()' +
    ')'
  );
  // Index for cleanup
  await query("CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)").catch(()=>{});
  // Add new vehicle columns if they don't exist
  await query("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS mileage_km INTEGER").catch(()=>{});
  await query("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fuel_type VARCHAR(20) DEFAULT 'Nafta'").catch(()=>{});
  await query("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS transmission VARCHAR(20) DEFAULT 'Manual'").catch(()=>{});
  await query("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS color VARCHAR(50)").catch(()=>{});
  await query("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS license_plate VARCHAR(20)").catch(()=>{});
  // Add mileage to scans for tracking km at time of scan
  await query("ALTER TABLE scans ADD COLUMN IF NOT EXISTS mileage_km INTEGER").catch(()=>{});
  // Clean expired sessions on startup
  await query("DELETE FROM sessions WHERE expires_at < NOW()").catch(()=>{});

  console.log('✓ Migraciones DB completadas');
}

// Vehicles
async function getVehicles(userId) {
  const sql = userId
    ? `SELECT v.*, (SELECT array_agg(DISTINCT unnest) FROM scans s, unnest(s.dtcs) WHERE s.vehicle_id = v.id) as last_dtcs, (SELECT created_at FROM scans WHERE vehicle_id = v.id ORDER BY created_at DESC LIMIT 1) as last_scan FROM vehicles v WHERE v.user_id=$1 ORDER BY v.updated_at DESC`
    : `SELECT v.*, (SELECT array_agg(DISTINCT unnest) FROM scans s, unnest(s.dtcs) WHERE s.vehicle_id = v.id) as last_dtcs FROM vehicles v ORDER BY v.updated_at DESC`;
  const r = await query(sql, userId ? [userId] : []);
  return r.rows;
}
async function getVehicle(id) { return (await query('SELECT * FROM vehicles WHERE id=$1',[id])).rows[0]; }
async function createVehicle(data) {
  const r = await query(`INSERT INTO vehicles (user_id,make,model,year,engine,vin,owner_name,owner_phone,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [data.user_id||null,data.make,data.model,data.year,data.engine,data.vin||null,data.owner_name||null,data.owner_phone||null,data.notes||null]);
  return r.rows[0];
}
async function updateVehicle(id,data) {
  const r = await query(`UPDATE vehicles SET make=$1,model=$2,year=$3,engine=$4,vin=$5,owner_name=$6,owner_phone=$7,notes=$8,updated_at=NOW() WHERE id=$9 RETURNING *`,
    [data.make,data.model,data.year,data.engine,data.vin,data.owner_name,data.owner_phone,data.notes,id]);
  return r.rows[0];
}
async function deleteVehicle(id) { await query('DELETE FROM vehicles WHERE id=$1',[id]); }

// Scans
async function saveScan(vehicleId,dtcs,liveData) {
  const r = await query(`INSERT INTO scans (vehicle_id,dtcs,live_data) VALUES ($1,$2,$3) RETURNING *`,[vehicleId,dtcs,JSON.stringify(liveData)]);
  await query('UPDATE vehicles SET updated_at=NOW() WHERE id=$1',[vehicleId]);
  return r.rows[0];
}
async function getScans(vehicleId,limit=50) {
  return (await query(`SELECT * FROM scans WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT $2`,[vehicleId,limit])).rows;
}

// DTCs
async function getDTCInfo(code) { return (await query('SELECT * FROM dtcs WHERE code=$1',[code])).rows[0]; }
async function upsertDTCInfo(data) {
  const r = await query(`
    INSERT INTO dtcs (code,title,description,system,severity,causes,brands,
      symptoms,diagnostic_steps,diagnostic_params,freeze_frame_hints,
      differential_diagnosis,repair_priority,latam_cost_usd,latam_notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT (code) DO UPDATE SET
      title=$2,description=$3,system=$4,severity=$5,causes=$6,brands=$7,
      symptoms=$8,diagnostic_steps=$9,diagnostic_params=$10,
      freeze_frame_hints=$11,differential_diagnosis=$12,
      repair_priority=$13,latam_cost_usd=$14,latam_notes=$15
    RETURNING *
  `, [
    data.code, data.title, data.description, data.system, data.severity,
    data.causes, data.brands || data.brands_affected || ['Universal'],
    data.symptoms || [], data.diagnostic_steps || [],
    JSON.stringify(data.diagnostic_params || {}),
    data.freeze_frame_hints || '',
    JSON.stringify(data.differential_diagnosis || {}),
    data.repair_priority || 2,
    data.latam_cost_usd || '',
    data.latam_notes || ''
  ]);
  return r.rows[0];
}

async function getDTCWithFullData(code) {
  const r = await query('SELECT * FROM dtcs WHERE code=$1', [code.toUpperCase()]);
  return r.rows[0] || null;
}

async function searchDTCs(query_text, limit=20) {
  const r = await query(`
    SELECT * FROM dtcs 
    WHERE code ILIKE $1 
    OR title ILIKE $1 
    OR description ILIKE $1
    OR $2 = ANY(causes)
    ORDER BY repair_priority ASC, code ASC
    LIMIT $3
  `, ['%'+query_text+'%', query_text, limit]);
  return r.rows;
}

// Resolutions
async function getResolutions(code,limit=50) {
  return (await query(`SELECT r.*,v.make,v.model,v.year FROM resolutions r LEFT JOIN vehicles v ON r.vehicle_id=v.id WHERE r.dtc_code=$1 AND r.confirmed=TRUE ORDER BY r.created_at DESC LIMIT $2`,[code,limit])).rows;
}
async function saveResolution(data) {
  const r = await query(`INSERT INTO resolutions (vehicle_id,dtc_code,cause_found,fix_applied,cost_usd,mechanic,confirmed) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [data.vehicle_id||null,data.dtc_code,data.cause_found,data.fix_applied||data.cause_found,data.cost_usd||null,data.mechanic||null,true]);
  return r.rows[0];
}
async function getResolutionStats(code) {
  return (await query(`SELECT cause_found,COUNT(*) as count,AVG(cost_usd) as avg_cost,MIN(cost_usd) as min_cost,MAX(cost_usd) as max_cost FROM resolutions WHERE dtc_code=$1 AND confirmed=TRUE GROUP BY cause_found ORDER BY count DESC`,[code])).rows;
}

// Jobs
async function getJobs(status,userId) {
  let sql,params;
  if(status && userId){sql='SELECT * FROM workshop_jobs WHERE status=$1 AND user_id=$2 ORDER BY created_at DESC';params=[status,userId];}
  else if(status){sql='SELECT * FROM workshop_jobs WHERE status=$1 ORDER BY created_at DESC';params=[status];}
  else if(userId){sql='SELECT * FROM workshop_jobs WHERE user_id=$1 ORDER BY created_at DESC';params=[userId];}
  else{sql='SELECT * FROM workshop_jobs ORDER BY created_at DESC';params=[];}
  return (await query(sql,params)).rows;
}
async function createJob(data) {
  const r = await query(`INSERT INTO workshop_jobs (user_id,vehicle_id,car_label,mechanic,dtcs,description,status,priority,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [data.user_id||null,data.vehicle_id||null,data.car_label,data.mechanic,data.dtcs,data.description,data.status||'diag',data.priority||'normal',data.notes||null]);
  return r.rows[0];
}
async function updateJobStatus(id,status) {
  return (await query(`UPDATE workshop_jobs SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *`,[status,id])).rows[0];
}


// Vehicle Profiles
async function getProfile(vehicleId) {
  const r = await query('SELECT * FROM vehicle_profiles WHERE vehicle_id=$1', [vehicleId]);
  return r.rows[0] || null;
}

async function upsertProfile(vehicleId, profileData) {
  const r = await query(`
    INSERT INTO vehicle_profiles (vehicle_id, profile, generated_at, updated_at)
    VALUES ($1,$2,NOW(),NOW())
    ON CONFLICT (vehicle_id) DO UPDATE SET profile=$2, updated_at=NOW()
    RETURNING *
  `, [vehicleId, JSON.stringify(profileData)]);
  return r.rows[0];
}


// ── HISTORIAL COMPLETO ────────────────────────────────────────
async function saveFullScan(vehicleId, {dtcs, liveData, freezeFrame, protocol, notes, resolvedCodes, totalCost}) {
  const r = await query(
    `INSERT INTO scans (vehicle_id, dtcs, live_data, protocol, notes, resolved_codes, total_cost_usd, freeze_frame)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [vehicleId, dtcs, JSON.stringify(liveData||{}), protocol||'OBD-II',
     notes||null, resolvedCodes||[], totalCost||null, JSON.stringify(freezeFrame||{})]
  );
  await query('UPDATE vehicles SET updated_at=NOW() WHERE id=$1', [vehicleId]);
  return r.rows[0];
}

async function getVehicleHistory(vehicleId) {
  // Scans with resolution data joined
  const scans = await query(`
    SELECT s.*,
      (SELECT json_agg(r.*) FROM resolutions r WHERE r.vehicle_id=s.vehicle_id AND r.created_at::date = s.created_at::date) as resolutions_that_day
    FROM scans s
    WHERE s.vehicle_id=$1
    ORDER BY s.created_at DESC
    LIMIT 100
  `, [vehicleId]);

  // All resolutions for this vehicle
  const resolutions = await query(`
    SELECT * FROM resolutions WHERE vehicle_id=$1 ORDER BY created_at DESC
  `, [vehicleId]);

  // DTC frequency stats
  const dtcStats = await query(`
    SELECT unnest(dtcs) as code, COUNT(*) as appearances,
           MIN(created_at) as first_seen, MAX(created_at) as last_seen
    FROM scans WHERE vehicle_id=$1
    GROUP BY code ORDER BY appearances DESC
  `, [vehicleId]);

  // Cost history
  const costs = await query(`
    SELECT DATE_TRUNC('month', created_at) as month,
           SUM(cost_usd) as total_cost, COUNT(*) as repairs
    FROM resolutions WHERE vehicle_id=$1 AND cost_usd IS NOT NULL
    GROUP BY month ORDER BY month DESC
  `, [vehicleId]);

  return {
    scans: scans.rows,
    resolutions: resolutions.rows,
    dtc_stats: dtcStats.rows,
    cost_by_month: costs.rows,
  };
}

async function addScanNote(scanId, note) {
  return (await query('UPDATE scans SET notes=$1 WHERE id=$2 RETURNING *', [note, scanId])).rows[0];
}

async function markDTCResolved(scanId, code, resolution) {
  // Add code to resolved_codes array of that scan
  await query(`UPDATE scans SET resolved_codes = array_append(resolved_codes, $1) WHERE id=$2`, [code, scanId]);
  return true;
}

// ── SESSIONS EN DB ────────────────────────────────────────────
async function createSession(token, userId, email, tallerName) {
  await query(
    `INSERT INTO sessions (token, user_id, email, taller_name)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (token) DO UPDATE SET last_used=NOW(), expires_at=NOW()+INTERVAL '30 days'`,
    [token, userId, email, tallerName]
  );
}

async function getSession(token) {
  const r = await query(
    `SELECT s.*, u.taller_name as taller FROM sessions s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE s.token=$1 AND s.expires_at > NOW()`,
    [token]
  );
  if (!r.rows.length) return null;
  // Update last_used
  await query('UPDATE sessions SET last_used=NOW() WHERE token=$1', [token]).catch(()=>{});
  return r.rows[0];
}

async function deleteSession(token) {
  await query('DELETE FROM sessions WHERE token=$1', [token]);
}

async function cleanExpiredSessions() {
  const r = await query('DELETE FROM sessions WHERE expires_at < NOW() RETURNING token');
  if (r.rows.length > 0) console.log('Cleaned', r.rows.length, 'expired sessions');
}

module.exports = {
  query,connectDB,pool,
  getVehicles,getVehicle,createVehicle,updateVehicle,deleteVehicle,
  saveScan,getScans,saveFullScan,getVehicleHistory,addScanNote,markDTCResolved,
  getDTCInfo,upsertDTCInfo,
  getResolutions,saveResolution,getResolutionStats,
  getJobs,createJob,updateJobStatus,
  getProfile,upsertProfile,
  upsertDTCInfo,getDTCWithFullData,searchDTCs,
  createSession,getSession,deleteSession,cleanExpiredSessions,
};
