CREATE EXTENSION IF NOT EXISTS timescaledb;

DROP TABLE IF EXISTS dynamic_capacity;
DROP TABLE IF EXISTS alarms;
DROP TABLE IF EXISTS sensor_data;
DROP TABLE IF EXISTS sensor_config;

CREATE TABLE sensor_config (
  id VARCHAR(20) PRIMARY KEY,
  type VARCHAR(20) NOT NULL CHECK (type IN ('temperature', 'wind', 'solar')),
  latitude FLOAT NOT NULL,
  longitude FLOAT NOT NULL,
  line_position_km FLOAT NOT NULL,
  line_name VARCHAR(50) NOT NULL DEFAULT '主干线',
  max_allowed_temp FLOAT DEFAULT 70.0,
  is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE sensor_data (
  time TIMESTAMPTZ NOT NULL,
  sensor_id VARCHAR(20) NOT NULL,
  value FLOAT NOT NULL,
  FOREIGN KEY (sensor_id) REFERENCES sensor_config(id)
);

SELECT create_hypertable(
  'sensor_data',
  'time',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE
);

ALTER TABLE sensor_data SET (
  timescaledb.compress,
  timescaledb.compress_orderby = 'time DESC',
  timescaledb.compress_segmentby = 'sensor_id'
);

SELECT add_compression_policy(
  'sensor_data',
  compress_after => INTERVAL '7 days',
  if_not_exists => TRUE
);

SELECT add_retention_policy(
  'sensor_data',
  drop_after => INTERVAL '90 days',
  if_not_exists => TRUE
);

CREATE TABLE alarms (
  id BIGSERIAL PRIMARY KEY,
  sensor_id VARCHAR(20) NOT NULL,
  alarm_type VARCHAR(20) NOT NULL CHECK (alarm_type IN ('overheat', 'galloping', 'offline')),
  level VARCHAR(20) NOT NULL CHECK (level IN ('warning', 'critical')),
  message TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (sensor_id) REFERENCES sensor_config(id)
);

CREATE TABLE dynamic_capacity (
  time TIMESTAMPTZ NOT NULL,
  dynamic_capacity FLOAT NOT NULL,
  static_capacity FLOAT NOT NULL,
  margin_percent FLOAT NOT NULL,
  conductor_temp FLOAT,
  wind_speed FLOAT,
  solar_irradiance FLOAT,
  cloud_cover_factor FLOAT,
  effective_irradiance FLOAT
);

SELECT create_hypertable(
  'dynamic_capacity',
  'time',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists => TRUE
);

ALTER TABLE dynamic_capacity SET (
  timescaledb.compress,
  timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy(
  'dynamic_capacity',
  compress_after => INTERVAL '30 days',
  if_not_exists => TRUE
);

SELECT add_retention_policy(
  'dynamic_capacity',
  drop_after => INTERVAL '365 days',
  if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_sensor_data_sensor_time ON sensor_data (sensor_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_sensor_data_time_value ON sensor_data (time DESC, value);
CREATE INDEX IF NOT EXISTS idx_alarms_sensor_id ON alarms (sensor_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_alarms_active ON alarms (is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_alarms_type ON alarms (alarm_type, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_dynamic_capacity_time ON dynamic_capacity (time DESC);

ANALYZE sensor_data;
ANALYZE alarms;
ANALYZE dynamic_capacity;
