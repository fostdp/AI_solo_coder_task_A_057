-- ============================================================
-- TimescaleDB 连续聚合和自动化策略配置
-- ============================================================

-- 创建传感器数据1分钟聚合视图
CREATE MATERIALIZED VIEW sensor_data_1min
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 minute', time) AS bucket,
  sensor_id,
  COUNT(*) AS sample_count,
  AVG(value) AS avg_value,
  MIN(value) AS min_value,
  MAX(value) AS max_value,
  STDDEV(value) AS stddev_value
FROM sensor_data
GROUP BY bucket, sensor_id
WITH NO DATA;

-- 创建传感器数据15分钟聚合视图
CREATE MATERIALIZED VIEW sensor_data_15min
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('15 minutes', time) AS bucket,
  sensor_id,
  COUNT(*) AS sample_count,
  AVG(value) AS avg_value,
  MIN(value) AS min_value,
  MAX(value) AS max_value,
  STDDEV(value) AS stddev_value,
  FIRST(value, time) AS first_value,
  LAST(value, time) AS last_value
FROM sensor_data
GROUP BY bucket, sensor_id
WITH NO DATA;

-- 创建传感器数据1小时聚合视图
CREATE MATERIALIZED VIEW sensor_data_1h
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', time) AS bucket,
  sensor_id,
  COUNT(*) AS sample_count,
  AVG(value) AS avg_value,
  MIN(value) AS min_value,
  MAX(value) AS max_value,
  STDDEV(value) AS stddev_value,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value) AS median_value
FROM sensor_data
GROUP BY bucket, sensor_id
WITH NO DATA;

-- 创建传感器数据1天聚合视图
CREATE MATERIALIZED VIEW sensor_data_1d
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', time) AS bucket,
  sensor_id,
  COUNT(*) AS sample_count,
  AVG(value) AS avg_value,
  MIN(value) AS min_value,
  MAX(value) AS max_value,
  STDDEV(value) AS stddev_value,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY value) AS p95_value
FROM sensor_data
GROUP BY bucket, sensor_id
WITH NO DATA;

-- ============================================================
-- 按传感器类型的聚合视图
-- ============================================================

-- 温度传感器1分钟聚合
CREATE MATERIALIZED VIEW temperature_1min
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 minute', sd.time) AS bucket,
  COUNT(*) AS sensor_count,
  AVG(sd.value) AS avg_temperature,
  MIN(sd.value) AS min_temperature,
  MAX(sd.value) AS max_temperature
FROM sensor_data sd
JOIN sensor_config sc ON sd.sensor_id = sc.id
WHERE sc.type = 'temperature'
GROUP BY bucket
WITH NO DATA;

-- 风速传感器1分钟聚合
CREATE MATERIALIZED VIEW wind_1min
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 minute', sd.time) AS bucket,
  COUNT(*) AS sensor_count,
  AVG(sd.value) AS avg_wind_speed,
  MIN(sd.value) AS min_wind_speed,
  MAX(sd.value) AS max_wind_speed
FROM sensor_data sd
JOIN sensor_config sc ON sd.sensor_id = sc.id
WHERE sc.type = 'wind'
GROUP BY bucket
WITH NO DATA;

-- 日照传感器1分钟聚合
CREATE MATERIALIZED VIEW solar_1min
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 minute', sd.time) AS bucket,
  COUNT(*) AS sensor_count,
  AVG(sd.value) AS avg_solar_irradiance,
  MIN(sd.value) AS min_solar_irradiance,
  MAX(sd.value) AS max_solar_irradiance
FROM sensor_data sd
JOIN sensor_config sc ON sd.sensor_id = sc.id
WHERE sc.type = 'solar'
GROUP BY bucket
WITH NO DATA;

-- ============================================================
-- 连续聚合刷新策略
-- ============================================================

-- 1分钟聚合：实时刷新，间隔30秒
SELECT add_continuous_aggregate_policy(
  'sensor_data_1min',
  start_offset => INTERVAL '5 minutes',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '30 seconds',
  if_not_exists => TRUE
);

-- 15分钟聚合：每5分钟刷新
SELECT add_continuous_aggregate_policy(
  'sensor_data_15min',
  start_offset => INTERVAL '1 hour',
  end_offset => INTERVAL '15 minutes',
  schedule_interval => INTERVAL '5 minutes',
  if_not_exists => TRUE
);

-- 1小时聚合：每30分钟刷新
SELECT add_continuous_aggregate_policy(
  'sensor_data_1h',
  start_offset => INTERVAL '4 hours',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '30 minutes',
  if_not_exists => TRUE
);

-- 1天聚合：每天凌晨2点刷新
SELECT add_continuous_aggregate_policy(
  'sensor_data_1d',
  start_offset => INTERVAL '3 days',
  end_offset => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 day',
  initial_start => TIMESTAMPTZ 'today 02:00:00+08',
  if_not_exists => TRUE
);

-- 类型聚合视图刷新策略
SELECT add_continuous_aggregate_policy(
  'temperature_1min',
  start_offset => INTERVAL '5 minutes',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '30 seconds',
  if_not_exists => TRUE
);

SELECT add_continuous_aggregate_policy(
  'wind_1min',
  start_offset => INTERVAL '5 minutes',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '30 seconds',
  if_not_exists => TRUE
);

SELECT add_continuous_aggregate_policy(
  'solar_1min',
  start_offset => INTERVAL '5 minutes',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '30 seconds',
  if_not_exists => TRUE
);

-- ============================================================
-- 连续聚合压缩策略
-- ============================================================

ALTER MATERIALIZED VIEW sensor_data_1min SET (
  timescaledb.compress,
  timescaledb.compress_orderby = 'bucket DESC',
  timescaledb.compress_segmentby = 'sensor_id'
);

ALTER MATERIALIZED VIEW sensor_data_15min SET (
  timescaledb.compress,
  timescaledb.compress_orderby = 'bucket DESC',
  timescaledb.compress_segmentby = 'sensor_id'
);

ALTER MATERIALIZED VIEW sensor_data_1h SET (
  timescaledb.compress,
  timescaledb.compress_orderby = 'bucket DESC',
  timescaledb.compress_segmentby = 'sensor_id'
);

ALTER MATERIALIZED VIEW sensor_data_1d SET (
  timescaledb.compress,
  timescaledb.compress_orderby = 'bucket DESC',
  timescaledb.compress_segmentby = 'sensor_id'
);

SELECT add_compression_policy(
  'sensor_data_1min',
  compress_after => INTERVAL '1 hour',
  if_not_exists => TRUE
);

SELECT add_compression_policy(
  'sensor_data_15min',
  compress_after => INTERVAL '1 day',
  if_not_exists => TRUE
);

SELECT add_compression_policy(
  'sensor_data_1h',
  compress_after => INTERVAL '7 days',
  if_not_exists => TRUE
);

SELECT add_compression_policy(
  'sensor_data_1d',
  compress_after => INTERVAL '30 days',
  if_not_exists => TRUE
);

-- ============================================================
-- 告警统计聚合视图
-- ============================================================

CREATE MATERIALIZED VIEW alarm_stats_1d
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', started_at) AS bucket,
  alarm_type,
  level,
  COUNT(*) AS alarm_count,
  COUNT(DISTINCT sensor_id) AS affected_sensors
FROM alarms
WHERE started_at IS NOT NULL
GROUP BY bucket, alarm_type, level
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
  'alarm_stats_1d',
  start_offset => INTERVAL '3 days',
  end_offset => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 day',
  initial_start => TIMESTAMPTZ 'today 01:00:00+08',
  if_not_exists => TRUE
);

-- ============================================================
-- 动态载流量聚合视图
-- ============================================================

CREATE MATERIALIZED VIEW capacity_stats_1h
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', time) AS bucket,
  COUNT(*) AS sample_count,
  AVG(dynamic_capacity) AS avg_dynamic_capacity,
  MIN(dynamic_capacity) AS min_dynamic_capacity,
  MAX(dynamic_capacity) AS max_dynamic_capacity,
  AVG(margin_percent) AS avg_margin_percent
FROM dynamic_capacity
GROUP BY bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
  'capacity_stats_1h',
  start_offset => INTERVAL '4 hours',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '30 minutes',
  if_not_exists => TRUE
);

-- ============================================================
-- 索引优化
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_sensor_data_1min_bucket_sensor ON sensor_data_1min (bucket DESC, sensor_id);
CREATE INDEX IF NOT EXISTS idx_sensor_data_15min_bucket_sensor ON sensor_data_15min (bucket DESC, sensor_id);
CREATE INDEX IF NOT EXISTS idx_sensor_data_1h_bucket_sensor ON sensor_data_1h (bucket DESC, sensor_id);
CREATE INDEX IF NOT EXISTS idx_sensor_data_1d_bucket_sensor ON sensor_data_1d (bucket DESC, sensor_id);

CREATE INDEX IF NOT EXISTS idx_temperature_1min_bucket ON temperature_1min (bucket DESC);
CREATE INDEX IF NOT EXISTS idx_wind_1min_bucket ON wind_1min (bucket DESC);
CREATE INDEX IF NOT EXISTS idx_solar_1min_bucket ON solar_1min (bucket DESC);
CREATE INDEX IF NOT EXISTS idx_alarm_stats_1d_bucket ON alarm_stats_1d (bucket DESC);
CREATE INDEX IF NOT EXISTS idx_capacity_stats_1h_bucket ON capacity_stats_1h (bucket DESC);

-- ============================================================
-- 数据保留策略
-- ============================================================

SELECT add_retention_policy(
  'sensor_data_1min',
  drop_after => INTERVAL '7 days',
  if_not_exists => TRUE
);

SELECT add_retention_policy(
  'sensor_data_15min',
  drop_after => INTERVAL '30 days',
  if_not_exists => TRUE
);

SELECT add_retention_policy(
  'sensor_data_1h',
  drop_after => INTERVAL '180 days',
  if_not_exists => TRUE
);

SELECT add_retention_policy(
  'sensor_data_1d',
  drop_after => INTERVAL '3 years',
  if_not_exists => TRUE
);

SELECT add_retention_policy(
  'temperature_1min',
  drop_after => INTERVAL '7 days',
  if_not_exists => TRUE
);

SELECT add_retention_policy(
  'wind_1min',
  drop_after => INTERVAL '7 days',
  if_not_exists => TRUE
);

SELECT add_retention_policy(
  'solar_1min',
  drop_after => INTERVAL '7 days',
  if_not_exists => TRUE
);

ANALYZE sensor_data_1min;
ANALYZE sensor_data_15min;
ANALYZE sensor_data_1h;
ANALYZE sensor_data_1d;
ANALYZE temperature_1min;
ANALYZE wind_1min;
ANALYZE solar_1min;
ANALYZE alarm_stats_1d;
ANALYZE capacity_stats_1h;
