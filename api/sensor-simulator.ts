import { SENSORS, type SensorConfig } from '../config/sensors.js'

const REPORT_INTERVAL = Number(process.env.SENSOR_REPORT_INTERVAL || 10000)
const MAX_ALLOWED_TEMP = Number(process.env.MAX_ALLOWED_TEMP || 70)

export interface SensorReading {
  id: string
  type: 'temperature' | 'wind' | 'solar'
  value: number
  timestamp: string
}

interface SensorSimulatorState {
  baseTemp: number
  baseWind: number
  baseSolar: number
  tempTrend: number
  windTrend: number
  solarTrend: number
  lastUpdate: Date
}

const state: SensorSimulatorState = {
  baseTemp: 45,
  baseWind: 5,
  baseSolar: 600,
  tempTrend: 0,
  windTrend: 0,
  solarTrend: 0,
  lastUpdate: new Date(),
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function generateSensorValue(
  sensor: SensorConfig,
  globalState: SensorSimulatorState,
): number {
  const positionFactor = Math.sin((sensor.linePositionKm / 200) * Math.PI * 2)
  const noise = (Math.random() - 0.5) * 2

  switch (sensor.type) {
    case 'temperature': {
      const tempVariation = positionFactor * 8 + globalState.tempTrend * 5 + noise
      const baseValue = globalState.baseTemp + tempVariation
      if (Math.random() < 0.02) {
        return clamp(baseValue + 25, 0, MAX_ALLOWED_TEMP + 15)
      }
      return clamp(baseValue, 0, MAX_ALLOWED_TEMP + 10)
    }
    case 'wind': {
      const windVariation = positionFactor * 3 + globalState.windTrend * 8 + noise * 2
      const baseValue = globalState.baseWind + windVariation
      if (Math.random() < 0.015) {
        return clamp(baseValue + 30, 0, 50)
      }
      return clamp(baseValue, 0, 45)
    }
    case 'solar': {
      const timeOfDay = new Date().getHours()
      const dayFactor = Math.max(0, Math.sin(((timeOfDay - 6) / 12) * Math.PI))
      const solarVariation = positionFactor * 80 + globalState.solarTrend * 200 + noise * 20
      const baseValue = globalState.baseSolar * dayFactor + solarVariation
      return clamp(baseValue, 0, 1200)
    }
    default:
      return 0
  }
}

function updateGlobalState(): void {
  const now = new Date()
  const timeDiff = (now.getTime() - state.lastUpdate.getTime()) / 1000
  state.lastUpdate = now

  state.tempTrend += (Math.random() - 0.5) * 0.1 * timeDiff
  state.tempTrend = clamp(state.tempTrend, -1, 1)

  state.windTrend += (Math.random() - 0.5) * 0.15 * timeDiff
  state.windTrend = clamp(state.windTrend, -1, 1)

  state.solarTrend += (Math.random() - 0.5) * 0.05 * timeDiff
  state.solarTrend = clamp(state.solarTrend, -1, 1)

  state.baseTemp += (Math.random() - 0.5) * 0.2 * timeDiff
  state.baseTemp = clamp(state.baseTemp, 20, 55)

  state.baseWind += (Math.random() - 0.5) * 0.3 * timeDiff
  state.baseWind = clamp(state.baseWind, 2, 15)

  state.baseSolar += (Math.random() - 0.5) * 10 * timeDiff
  state.baseSolar = clamp(state.baseSolar, 200, 1000)
}

export function generateReadings(): SensorReading[] {
  updateGlobalState()

  const now = new Date()
  const timestamp = now.toISOString()

  const readings: SensorReading[] = SENSORS.map(sensor => ({
    id: sensor.id,
    type: sensor.type,
    value: +generateSensorValue(sensor, state).toFixed(2),
    timestamp,
  }))

  return readings
}

export function startSensorSimulation(
  callback: (readings: SensorReading[]) => void,
): NodeJS.Timeout {
  const readings = generateReadings()
  callback(readings)

  return setInterval(() => {
    const readings = generateReadings()
    callback(readings)
  }, REPORT_INTERVAL)
}
