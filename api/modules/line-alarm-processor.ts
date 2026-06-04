import {
  IceAccretionEstimator,
  createIceAccretionEstimator,
  type IcingContext,
} from './ice-accretion-estimator.js'
import { getSensorById, SENSORS, type SensorConfig } from '../../config/sensors.js'
import { insertAlarm, closeAlarm } from '../db.js'

export interface Alarm {
  id: number
  sensorId: string
  alarmType: 'overheat' | 'galloping' | 'offline'
  level: 'warning' | 'critical'
  message: string
  startedAt: string
  endedAt?: string
  isActive: boolean
  icingContext?: IcingContext
}

export type AlarmCallback = (alarm: Alarm) => void | Promise<void>

interface SensorAlarmState {
  overheatStartTime?: Date
  gallopingStartTime?: Date
  offlineStartTime?: Date
  lastValue: number
  lastSeen: Date
}

export interface AlarmProcessorOptions {
  maxAllowedTemp?: number
  offlineThresholdMs?: number
  overheatDurationMs?: number
  baseGallopingWindThreshold?: number
}

export class LineAlarmProcessor {
  private sensorStates: Map<string, SensorAlarmState> = new Map()
  private activeAlarms: Map<string, number> = new Map()
  private alarmHistory: Map<number, Alarm> = new Map()
  private listeners: Set<AlarmCallback> = new Set()
  private icingEstimator: IceAccretionEstimator
  private maxAllowedTemp: number
  private offlineThresholdMs: number
  private overheatDurationMs: number
  private stats = {
    totalAlarms: 0,
    activeAlarmsCount: 0,
    resolvedAlarms: 0,
    overheatAlarms: 0,
    gallopingAlarms: 0,
    offlineAlarms: 0,
  }

  constructor(options: AlarmProcessorOptions = {}) {
    this.maxAllowedTemp = options.maxAllowedTemp ?? 70
    this.offlineThresholdMs = options.offlineThresholdMs ?? 5 * 60 * 1000
    this.overheatDurationMs = options.overheatDurationMs ?? 5 * 60 * 1000
    this.icingEstimator = createIceAccretionEstimator({
      baseWindThreshold: options.baseGallopingWindThreshold ?? 30,
    })

    this.initializeSensorStates()
  }

  private initializeSensorStates(): void {
    const now = new Date()
    for (const sensor of SENSORS) {
      this.sensorStates.set(sensor.id, {
        lastValue: 0,
        lastSeen: now,
      })
    }
  }

  public async processSensorReading(
    sensorId: string,
    value: number,
    timestamp: Date,
    allSensorData: Map<string, { value: number; timestamp: string }>,
  ): Promise<Alarm | null> {
    const state = this.sensorStates.get(sensorId)
    if (!state) return null

    state.lastValue = value
    state.lastSeen = timestamp

    const sensor = getSensorById(sensorId)
    if (!sensor) return null

    if (state.offlineStartTime) {
      state.offlineStartTime = undefined
      await this.clearAlarm(sensorId, 'offline')
    }

    let triggeredAlarm: Alarm | null = null

    if (sensor.type === 'temperature') {
      triggeredAlarm = await this.processOverheat(sensor, state, value, timestamp)
    } else if (sensor.type === 'wind') {
      triggeredAlarm = await this.processGalloping(
        sensor,
        state,
        value,
        timestamp,
        allSensorData,
      )
    }

    return triggeredAlarm
  }

  private async processOverheat(
    sensor: SensorConfig,
    state: SensorAlarmState,
    value: number,
    timestamp: Date,
  ): Promise<Alarm | null> {
    const staticTempThreshold = sensor.maxAllowedTemp || this.maxAllowedTemp

    if (value > staticTempThreshold) {
      if (!state.overheatStartTime) {
        state.overheatStartTime = timestamp
      }
      const duration = timestamp.getTime() - state.overheatStartTime.getTime()

      if (duration >= this.overheatDurationMs && !this.hasActiveAlarm(sensor.id, 'overheat')) {
        return this.triggerAlarm({
          sensorId: sensor.id,
          alarmType: 'overheat',
          level: 'critical',
          message:
            `导线温度 ${value.toFixed(1)}°C 超过最大允许温度 ${staticTempThreshold}°C，` +
            `持续时间超过 ${(this.overheatDurationMs / 60000).toFixed(0)} 分钟`,
          startedAt: state.overheatStartTime,
        })
      }
    } else {
      if (state.overheatStartTime) {
        state.overheatStartTime = undefined
        await this.clearAlarm(sensor.id, 'overheat')
      }
    }

    return null
  }

  private async processGalloping(
    sensor: SensorConfig,
    state: SensorAlarmState,
    value: number,
    timestamp: Date,
    allSensorData: Map<string, { value: number; timestamp: string }>,
  ): Promise<Alarm | null> {
    const icingContext = this.icingEstimator.getIcingContextForSensor(
      sensor.id,
      allSensorData,
      sensor,
    )
    const threshold = icingContext.adjustedThreshold
    const icingRiskPercent = Math.round(icingContext.icingRiskFactor * 100)

    if (value > threshold) {
      if (!state.gallopingStartTime) {
        state.gallopingStartTime = timestamp
      }

      if (!this.hasActiveAlarm(sensor.id, 'galloping')) {
        const icingInfo =
          icingRiskPercent > 0
            ? `，覆冰风险 ${icingRiskPercent}%（温度 ${icingContext.ambientTemp.toFixed(1)}°C，湿度 ${icingContext.humidity.toFixed(0)}%）`
            : ''

        return this.triggerAlarm({
          sensorId: sensor.id,
          alarmType: 'galloping',
          level: 'critical',
          message:
            `风速 ${value.toFixed(1)}m/s 超过调整后阈值 ${threshold.toFixed(1)}m/s` +
            icingInfo +
            '，可能引发线路舞动',
          startedAt: state.gallopingStartTime,
          icingContext,
        })
      }
    } else {
      if (state.gallopingStartTime) {
        state.gallopingStartTime = undefined
        await this.clearAlarm(sensor.id, 'galloping')
      }
    }

    return null
  }

  public async checkOfflineSensors(
    checkTime: Date = new Date(),
  ): Promise<Alarm[]> {
    const newOfflineAlarms: Alarm[] = []
    const knownOfflineIds = new Set<string>()

    for (const [id, state] of this.sensorStates.entries()) {
      const age = checkTime.getTime() - state.lastSeen.getTime()

      if (age > this.offlineThresholdMs) {
        knownOfflineIds.add(id)

        if (!this.hasActiveAlarm(id, 'offline')) {
          if (!state.offlineStartTime) {
            state.offlineStartTime = state.lastSeen
          }

          const sensor = getSensorById(id)
          const typeLabel = sensor
            ? sensor.type === 'temperature'
              ? '温度'
              : sensor.type === 'wind'
              ? '风速'
              : '日照'
            : '未知'

          const offlineMinutes = Math.round(age / 60000)

          const alarm = await this.triggerAlarm({
            sensorId: id,
            alarmType: 'offline',
            level: 'warning',
            message: `${typeLabel}传感器 ${id} 离线超过 ${offlineMinutes} 分钟，最后心跳 ${state.lastSeen.toISOString()}`,
            startedAt: state.offlineStartTime,
          })

          if (alarm) {
            newOfflineAlarms.push(alarm)
          }
        }
      }
    }

    for (const [alarmKey, alarmId] of this.activeAlarms.entries()) {
      const [sensorId, alarmType] = alarmKey.split('_')
      if (alarmType === 'offline' && !knownOfflineIds.has(sensorId)) {
        const state = this.sensorStates.get(sensorId)
        if (state) {
          state.offlineStartTime = undefined
        }
        await this.clearAlarm(sensorId, 'offline')
      }
    }

    return newOfflineAlarms
  }

  private hasActiveAlarm(sensorId: string, alarmType: string): boolean {
    return this.activeAlarms.has(`${sensorId}_${alarmType}`)
  }

  private async triggerAlarm(params: {
    sensorId: string
    alarmType: 'overheat' | 'galloping' | 'offline'
    level: 'warning' | 'critical'
    message: string
    startedAt: Date
    icingContext?: IcingContext
  }): Promise<Alarm | null> {
    const alarmKey = `${params.sensorId}_${params.alarmType}`
    if (this.activeAlarms.has(alarmKey)) return null

    let dbId: number
    try {
      dbId = await insertAlarm(
        {
          sensorId: params.sensorId,
          alarmType: params.alarmType,
          level: params.level,
          message: params.message,
        },
        params.startedAt,
      )
      if (typeof dbId !== 'number') {
        dbId = Date.now() + Math.floor(Math.random() * 1000000)
      }
    } catch (err) {
      console.error('Failed to insert alarm to DB:', err)
      dbId = Date.now() + Math.floor(Math.random() * 1000000)
    }

    const alarm: Alarm = {
      id: dbId,
      sensorId: params.sensorId,
      alarmType: params.alarmType,
      level: params.level,
      message: params.message,
      startedAt: params.startedAt.toISOString(),
      isActive: true,
      icingContext: params.icingContext,
    }

    this.activeAlarms.set(alarmKey, dbId)
    this.alarmHistory.set(dbId, alarm)

    this.stats.totalAlarms++
    this.stats.activeAlarmsCount++
    if (params.alarmType === 'overheat') this.stats.overheatAlarms++
    if (params.alarmType === 'galloping') this.stats.gallopingAlarms++
    if (params.alarmType === 'offline') this.stats.offlineAlarms++

    for (const listener of this.listeners) {
      try {
        const result = listener(alarm)
        if (result instanceof Promise) {
          void result.catch((err) => console.error('Alarm listener error:', err))
        }
      } catch (err) {
        console.error('Alarm listener error:', err)
      }
    }

    return alarm
  }

  private async clearAlarm(sensorId: string, alarmType: string): Promise<void> {
    const alarmKey = `${sensorId}_${alarmType}`
    const alarmId = this.activeAlarms.get(alarmKey)

    if (alarmId) {
      try {
        await closeAlarm(alarmId)
      } catch (err) {
        console.error('Failed to close alarm in DB:', err)
      }

      const alarm = this.alarmHistory.get(alarmId)
      if (alarm) {
        alarm.isActive = false
        alarm.endedAt = new Date().toISOString()
      }

      this.activeAlarms.delete(alarmKey)
      this.stats.activeAlarmsCount--
      this.stats.resolvedAlarms++
    }
  }

  public getActiveAlarms(): Alarm[] {
    const result: Alarm[] = []
    for (const [alarmKey, alarmId] of this.activeAlarms.entries()) {
      const [sensorId, alarmType] = alarmKey.split('_')
      const alarm = this.alarmHistory.get(alarmId)
      if (alarm && alarm.isActive) {
        result.push(alarm)
      } else {
        const sensor = getSensorById(sensorId)
        const typeLabel = sensor
          ? sensor.type === 'temperature'
            ? '温度'
            : sensor.type === 'wind'
            ? '风速'
            : '日照'
          : '未知'
        result.push({
          id: alarmId,
          sensorId,
          alarmType: alarmType as 'overheat' | 'galloping' | 'offline',
          level: 'warning',
          message: `${typeLabel}传感器 ${sensorId} 告警`,
          startedAt: new Date().toISOString(),
          isActive: true,
        })
      }
    }
    return result.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
  }

  public getAlarmHistory(limit: number = 100): Alarm[] {
    return Array.from(this.alarmHistory.values())
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, limit)
  }

  public getIcingEstimator(): IceAccretionEstimator {
    return this.icingEstimator
  }

  public getStatistics() {
    return { ...this.stats }
  }

  public getSensorState(sensorId: string): SensorAlarmState | undefined {
    return this.sensorStates.get(sensorId)
  }

  public onAlarm(callback: AlarmCallback): () => void {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }

  public removeAllListeners(): void {
    this.listeners.clear()
  }

  public reset(): void {
    this.sensorStates.clear()
    this.activeAlarms.clear()
    this.alarmHistory.clear()
    this.stats = {
      totalAlarms: 0,
      activeAlarmsCount: 0,
      resolvedAlarms: 0,
      overheatAlarms: 0,
      gallopingAlarms: 0,
      offlineAlarms: 0,
    }
    this.icingEstimator.resetThicknessHistory()
    this.initializeSensorStates()
  }
}

export function createLineAlarmProcessor(
  options?: AlarmProcessorOptions,
): LineAlarmProcessor {
  return new LineAlarmProcessor(options)
}
