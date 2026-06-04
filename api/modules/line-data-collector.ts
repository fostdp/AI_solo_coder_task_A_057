import { insertSensorData, insertSensorDataBatch } from '../db.js'
import { SENSORS, getSensorById, type SensorConfig } from '../../config/sensors.js'

export interface SensorReading {
  id: string
  type: 'temperature' | 'wind' | 'solar'
  value: number
  timestamp: string
}

export interface CachedSensorData {
  value: number
  timestamp: string
  receivedAt: Date
}

export interface AggregatedConditions {
  avgTemp: number
  avgWind: number
  avgSolar: number
  maxTemp: number
  maxWind: number
  tempSensorCount: number
  windSensorCount: number
  solarSensorCount: number
  timestamp: Date
  overheatedSensors: string[]
  highWindSensors: string[]
}

export interface CollectorStatistics {
  totalReadings: number
  totalBatches: number
  totalWrites: number
  failedWrites: number
  lastReadingTime: Date | null
  avgLatencyMs: number
}

export interface CollectorOptions {
  persistToDb?: boolean
  batchSize?: number
  batchTimeoutMs?: number
  maxCacheAgeMs?: number
}

export type SensorDataCallback = (
  readings: SensorReading[],
  aggregated: AggregatedConditions,
) => void | Promise<void>

export class LineDataCollector {
  private cache: Map<string, CachedSensorData> = new Map()
  private listeners: Set<SensorDataCallback> = new Set()
  private stats: CollectorStatistics = {
    totalReadings: 0,
    totalBatches: 0,
    totalWrites: 0,
    failedWrites: 0,
    lastReadingTime: null,
    avgLatencyMs: 0,
  }

  private persistToDb: boolean
  private batchSize: number
  private batchTimeoutMs: number
  private maxCacheAgeMs: number
  private pendingWrites: SensorReading[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private isRunning: boolean = false

  constructor(options: CollectorOptions = {}) {
    this.persistToDb = options.persistToDb ?? true
    this.batchSize = options.batchSize ?? 180
    this.batchTimeoutMs = options.batchTimeoutMs ?? 5000
    this.maxCacheAgeMs = options.maxCacheAgeMs ?? 5 * 60 * 1000

    SENSORS.forEach((sensor) => {
      this.cache.set(sensor.id, {
        value: 0,
        timestamp: new Date().toISOString(),
        receivedAt: new Date(),
      })
    })
  }

  public start(): void {
    if (this.isRunning) return
    this.isRunning = true
    this.startFlushTimer()
  }

  public stop(): void {
    this.isRunning = false
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    void this.flushPendingWrites()
  }

  public async ingest(readings: SensorReading[]): Promise<AggregatedConditions> {
    const now = new Date()
    const startTs = performance.now()

    for (const reading of readings) {
      this.cache.set(reading.id, {
        value: reading.value,
        timestamp: reading.timestamp,
        receivedAt: now,
      })

      if (this.persistToDb) {
        this.pendingWrites.push(reading)
      }

      this.stats.totalReadings++
    }

    this.stats.lastReadingTime = now
    this.stats.totalBatches++

    if (this.pendingWrites.length >= this.batchSize) {
      void this.flushPendingWrites()
    }

    const aggregated = this.aggregate()

    for (const listener of this.listeners) {
      try {
        const result = listener(readings, aggregated)
        if (result instanceof Promise) {
          void result.catch((err) => console.error('Listener error:', err))
        }
      } catch (err) {
        console.error('Listener error:', err)
      }
    }

    const latency = performance.now() - startTs
    this.stats.avgLatencyMs = this.stats.avgLatencyMs * 0.9 + latency * 0.1

    return aggregated
  }

  public getSensorData(sensorId: string): CachedSensorData | undefined {
    return this.cache.get(sensorId)
  }

  public getSensorValue(sensorId: string): number | null {
    const data = this.cache.get(sensorId)
    return data ? data.value : null
  }

  public getSensorsByType(type: 'temperature' | 'wind' | 'solar'): Array<{
    sensor: SensorConfig
    data: CachedSensorData
  }> {
    const result: Array<{ sensor: SensorConfig; data: CachedSensorData }> = []
    for (const [id, data] of this.cache.entries()) {
      const sensor = getSensorById(id)
      if (sensor && sensor.type === type) {
        result.push({ sensor, data })
      }
    }
    return result
  }

  public getAllSensorData(): Map<string, CachedSensorData> {
    return new Map(this.cache)
  }

  public getAllReadings(): SensorReading[] {
    const readings: SensorReading[] = []
    for (const [id, data] of this.cache.entries()) {
      const sensor = getSensorById(id)
      if (sensor) {
        readings.push({
          id,
          type: sensor.type,
          value: data.value,
          timestamp: data.timestamp,
        })
      }
    }
    return readings
  }

  public aggregate(): AggregatedConditions {
    let totalTemp = 0
    let totalWind = 0
    let totalSolar = 0
    let maxTemp = -Infinity
    let maxWind = -Infinity
    let tempCount = 0
    let windCount = 0
    let solarCount = 0
    const overheated: string[] = []
    const highWind: string[] = []

    for (const [id, data] of this.cache.entries()) {
      const sensor = getSensorById(id)
      if (!sensor) continue

      if (sensor.type === 'temperature') {
        totalTemp += data.value
        tempCount++
        if (data.value > maxTemp) maxTemp = data.value
        if (data.value > (sensor.maxAllowedTemp || 70)) {
          overheated.push(id)
        }
      } else if (sensor.type === 'wind') {
        totalWind += data.value
        windCount++
        if (data.value > maxWind) maxWind = data.value
        if (data.value > 30) {
          highWind.push(id)
        }
      } else if (sensor.type === 'solar') {
        totalSolar += data.value
        solarCount++
      }
    }

    return {
      avgTemp: tempCount > 0 ? totalTemp / tempCount : 0,
      avgWind: windCount > 0 ? totalWind / windCount : 0,
      avgSolar: solarCount > 0 ? totalSolar / solarCount : 0,
      maxTemp: maxTemp === -Infinity ? 0 : maxTemp,
      maxWind: maxWind === -Infinity ? 0 : maxWind,
      tempSensorCount: tempCount,
      windSensorCount: windCount,
      solarSensorCount: solarCount,
      timestamp: new Date(),
      overheatedSensors: overheated,
      highWindSensors: highWind,
    }
  }

  public getOfflineSensors(offlineThresholdMs: number = 5 * 60 * 1000): string[] {
    const now = new Date()
    const offline: string[] = []
    for (const [id, data] of this.cache.entries()) {
      const age = now.getTime() - data.receivedAt.getTime()
      if (age > offlineThresholdMs) {
        offline.push(id)
      }
    }
    return offline
  }

  public getOnlineRate(): number {
    const total = this.cache.size
    if (total === 0) return 0
    const offline = this.getOfflineSensors().length
    return ((total - offline) / total) * 100
  }

  public getStatistics(): CollectorStatistics {
    return { ...this.stats }
  }

  public onData(callback: SensorDataCallback): () => void {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }

  public removeAllListeners(): void {
    this.listeners.clear()
  }

  public cleanupStaleData(): number {
    const now = new Date()
    let removed = 0
    for (const [id, data] of this.cache.entries()) {
      const age = now.getTime() - data.receivedAt.getTime()
      if (age > this.maxCacheAgeMs) {
        this.cache.delete(id)
        removed++
      }
    }
    return removed
  }

  public reset(): void {
    this.cache.clear()
    this.pendingWrites = []
    this.stats = {
      totalReadings: 0,
      totalBatches: 0,
      totalWrites: 0,
      failedWrites: 0,
      lastReadingTime: null,
      avgLatencyMs: 0,
    }
    SENSORS.forEach((sensor) => {
      this.cache.set(sensor.id, {
        value: 0,
        timestamp: new Date().toISOString(),
        receivedAt: new Date(),
      })
    })
  }

  private startFlushTimer(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => {
      void this.flushPendingWrites()
      if (this.isRunning) this.startFlushTimer()
    }, this.batchTimeoutMs)
  }

  private async flushPendingWrites(): Promise<void> {
    if (this.pendingWrites.length === 0) return
    if (!this.persistToDb) {
      this.pendingWrites = []
      return
    }

    const toWrite = [...this.pendingWrites]
    this.pendingWrites = []

    try {
      await insertSensorDataBatch(toWrite)
      this.stats.totalWrites += toWrite.length
    } catch (err) {
      console.error('Error flushing sensor data batch:', err)
      this.stats.failedWrites += toWrite.length

      for (const reading of toWrite) {
        try {
          await insertSensorData(reading.id, reading.value, new Date(reading.timestamp))
          this.stats.totalWrites++
        } catch (err2) {
          console.error('Error inserting individual reading:', err2)
          this.stats.failedWrites++
        }
      }
    }
  }
}

export function createLineDataCollector(
  options?: CollectorOptions,
): LineDataCollector {
  return new LineDataCollector(options)
}
