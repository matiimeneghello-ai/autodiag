require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function connectDB() {
  const client = await pool.connect();
  client.release();
  await runMigrations();
}

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
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
      make        VARCHAR(100) NOT NULL,
      model       VARCHAR(100) NOT NULL,
      year        INTEGER,
      engine      VARCHAR(100),
      vin         VARCHAR(17),
      owner_name  VARCHAR(200),
      owner_phone VARCHAR(50),
      notes       TEXT,
      created_at  TIMESTAMP DEFAULT NOW(),
      updated_at  TIMESTAMP DEFAULT NOW()
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
      id           SERIAL PRIMARY KEY,
      code         VARCHAR(10) UNIQUE NOT NULL,
      title        VARCHAR(300),
      description  TEXT,
      system       VARCHAR(100),
      severity     VARCHAR(20),
      causes       TEXT[],
      brands       TEXT[],
      created_at   TIMESTAMP DEFAULT NOW()
    )
  `);

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
  const r = await query(`INSERT INTO dtcs (code,title,description,system,severity,causes,brands) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (code) DO UPDATE SET title=$2,description=$3,system=$4,severity=$5,causes=$6,brands=$7 RETURNING *`,
    [data.code,data.title,data.description,data.system,data.severity,data.causes,data.brands||data.brands_affected]);
  return r.rows[0];
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

module.exports = {
  query,connectDB,pool,
  getVehicles,getVehicle,createVehicle,updateVehicle,deleteVehicle,
  saveScan,getScans,
  getDTCInfo,upsertDTCInfo,
  getResolutions,saveResolution,getResolutionStats,
  getJobs,createJob,updateJobStatus
};
