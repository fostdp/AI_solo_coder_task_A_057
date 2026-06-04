import pg from 'pg'

const { Pool } = pg

let pool: pg.Pool | null = null
let dbAvailable = false

async function initDatabase() {
  try {
    pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME || 'power_grid',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    })

    const client = await pool.connect()
    client.release()
    dbAvailable = true
    console.log('Database connection established successfully')
  } catch (err) {
    console.warn('Warning: Database connection failed. Running in memory-only mode.')
    console.warn('Database error:', (err as Error).message)
    dbAvailable = false
    if (pool) {
      await pool.end().catch(() => {})
      pool = null
    }
  }
}

initDatabase()

export async function query(text: string, params?: unknown[]) {
  if (!dbAvailable || !pool) {
    return { rows: [], rowCount: 0 }
  }
  try {
    const start = Date.now()
    const res = await pool.query(text, params)
    const duration = Date.now() - start
    console.log('executed query', { text, duration, rows: res.rowCount })
    return res
  } catch (err) {
    console.error('Query error:', (err as Error).message)
    return { rows: [], rowCount: 0 }
  }
}

export async function insertSensorDataBatch(
  readings: Array<{ id: string; value: number; timestamp: string }>,
) {
  if (readings.length === 0) return { rows: [], rowCount: 0 }

  const values: unknown[] = []
  const placeholders: string[] = []

  readings.forEach((reading, index) => {
    const offset = index * 3
    placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`)
    values.push(new Date(reading.timestamp), reading.id, reading.value)
  })

  return query(
    `INSERT INTO sensor_data (time, sensor_id, value) VALUES ${placeholders.join(',')}`,
    values,
  )
}

export async function insertSensorData(
  sensorId: string,
  value: number,
  timestamp: Date = new Date(),
) {
  return query(
    'INSERT INTO sensor_data (time, sensor_id, value) VALUES ($1, $2, $3)',
    [timestamp, sensorId, value],
  )
}

export async function insertDynamicCapacity(
  data: {
    dynamicCapacity: number
    staticCapacity: number
    marginPercent: number
    conductorTemp?: number
    windSpeed?: number
    solarIrradiance?: number
    cloudCoverFactor?: number
    effectiveIrradiance?: number
  },
  timestamp: Date = new Date(),
) {
  return query(
    `INSERT INTO dynamic_capacity 
     (time, dynamic_capacity, static_capacity, margin_percent, conductor_temp, wind_speed, solar_irradiance, cloud_cover_factor, effective_irradiance) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      timestamp,
      data.dynamicCapacity,
      data.staticCapacity,
      data.marginPercent,
      data.conductorTemp,
      data.windSpeed,
      data.solarIrradiance,
      data.cloudCoverFactor,
      data.effectiveIrradiance,
    ],
  )
}

export async function insertAlarm(
  alarm: {
    sensorId: string
    alarmType: 'overheat' | 'galloping' | 'offline'
    level: 'warning' | 'critical'
    message: string
  },
  startedAt: Date = new Date(),
) {
  const res = await query(
    `INSERT INTO alarms 
     (sensor_id, alarm_type, level, message, started_at, is_active) 
     VALUES ($1, $2, $3, $4, $5, TRUE) 
     RETURNING id`,
    [alarm.sensorId, alarm.alarmType, alarm.level, alarm.message, startedAt],
  )
  if (res.rows.length > 0) {
    return res.rows[0].id
  }
  return Date.now()
}

export async function closeAlarm(alarmId: number, endedAt: Date = new Date()) {
  return query(
    'UPDATE alarms SET ended_at = $1, is_active = FALSE WHERE id = $2',
    [endedAt, alarmId],
  )
}

export async function getSensorHistory(sensorId: string, hours: number = 1) {
  const safeHours = Math.max(0.5, Math.min(hours, 24 * 7))
  const res = await query(
    `SELECT time, value FROM sensor_data 
     WHERE sensor_id = $1 AND time >= NOW() - make_interval(hours => $2) 
     ORDER BY time ASC`,
    [sensorId, safeHours],
  )
  return res.rows.map(row => ({
    timestamp: row.time.toISOString(),
    value: row.value,
  }))
}

export async function getActiveAlarms() {
  const res = await query(
    `SELECT a.*, sc.type as sensor_type, sc.line_position_km 
     FROM alarms a 
     JOIN sensor_config sc ON a.sensor_id = sc.id 
     WHERE a.is_active = TRUE 
     ORDER BY a.started_at DESC`,
  )
  return res.rows
}

export async function getAlarmHistory(limit: number = 100) {
  const res = await query(
    `SELECT a.*, sc.type as sensor_type, sc.line_position_km 
     FROM alarms a 
     JOIN sensor_config sc ON a.sensor_id = sc.id 
     ORDER BY a.started_at DESC 
     LIMIT $1`,
    [limit],
  )
  return res.rows
}

export async function getCurrentCapacity() {
  const res = await query(
    'SELECT * FROM dynamic_capacity ORDER BY time DESC LIMIT 1',
  )
  if (res.rows.length === 0) return null
  const row = res.rows[0]
  return {
    timestamp: row.time.toISOString(),
    dynamicCapacity: row.dynamic_capacity,
    staticCapacity: row.static_capacity,
    marginPercent: row.margin_percent,
    conductorTemp: row.conductor_temp,
    windSpeed: row.wind_speed,
    solarIrradiance: row.solar_irradiance,
  }
}

export async function getCapacityHistory(hours: number = 24) {
  const safeHours = Math.max(0.5, Math.min(hours, 365 * 24))
  const res = await query(
    `SELECT time, dynamic_capacity, static_capacity, margin_percent 
     FROM dynamic_capacity 
     WHERE time >= NOW() - make_interval(hours => $1) 
     ORDER BY time ASC`,
    [safeHours],
  )
  return res.rows.map(row => ({
    timestamp: row.time.toISOString(),
    dynamicCapacity: row.dynamic_capacity,
    staticCapacity: row.static_capacity,
    marginPercent: row.margin_percent,
  }))
}

export async function getLatestSensorData(sensorIds?: string[]) {
  if (sensorIds && sensorIds.length > 0) {
    const placeholders = sensorIds.map((_, i) => `$${i + 1}`).join(',')
    const res = await query(
      `SELECT DISTINCT ON (sensor_id) sensor_id, value, time 
       FROM sensor_data 
       WHERE sensor_id IN (${placeholders}) 
       ORDER BY sensor_id, time DESC`,
      sensorIds,
    )
    return res.rows.map(row => ({
      sensorId: row.sensor_id,
      value: row.value,
      timestamp: row.time.toISOString(),
    }))
  } else {
    const res = await query(
      `SELECT DISTINCT ON (sensor_id) sensor_id, value, time 
       FROM sensor_data 
       ORDER BY sensor_id, time DESC`,
    )
    return res.rows.map(row => ({
      sensorId: row.sensor_id,
      value: row.value,
      timestamp: row.time.toISOString(),
    }))
  }
}

export function isDatabaseAvailable() {
  return dbAvailable
}
