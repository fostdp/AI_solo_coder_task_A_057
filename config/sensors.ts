export interface SensorConfig {
  id: string
  type: 'temperature' | 'wind' | 'solar'
  latitude: number
  longitude: number
  linePositionKm: number
  lineName: string
  maxAllowedTemp: number
  isActive: boolean
}

const LINE_LENGTH_KM = 200
const BASE_LAT = 30.0
const BASE_LNG = 114.0
const KM_PER_DEGREE = 0.009

function generateSensors(): SensorConfig[] {
  const sensors: SensorConfig[] = []

  const tempCount = 80
  const tempInterval = LINE_LENGTH_KM / tempCount
  for (let i = 0; i < tempCount; i++) {
    const km = tempInterval * (i + 0.5)
    sensors.push({
      id: `T${String(i + 1).padStart(3, '0')}`,
      type: 'temperature',
      latitude: BASE_LAT + km * KM_PER_DEGREE * 0.3,
      longitude: BASE_LNG + km * KM_PER_DEGREE,
      linePositionKm: Math.round(km * 10) / 10,
      lineName: '主干线',
      maxAllowedTemp: 70.0,
      isActive: true,
    })
  }

  const windCount = 60
  const windInterval = LINE_LENGTH_KM / windCount
  for (let i = 0; i < windCount; i++) {
    const km = windInterval * (i + 0.5)
    sensors.push({
      id: `W${String(i + 1).padStart(3, '0')}`,
      type: 'wind',
      latitude: BASE_LAT + km * KM_PER_DEGREE * 0.3 + 0.002,
      longitude: BASE_LNG + km * KM_PER_DEGREE + 0.002,
      linePositionKm: Math.round(km * 10) / 10,
      lineName: '主干线',
      maxAllowedTemp: 70.0,
      isActive: true,
    })
  }

  const solarCount = 40
  const solarInterval = LINE_LENGTH_KM / solarCount
  for (let i = 0; i < solarCount; i++) {
    const km = solarInterval * (i + 0.5)
    sensors.push({
      id: `S${String(i + 1).padStart(3, '0')}`,
      type: 'solar',
      latitude: BASE_LAT + km * KM_PER_DEGREE * 0.3 - 0.002,
      longitude: BASE_LNG + km * KM_PER_DEGREE - 0.002,
      linePositionKm: Math.round(km * 10) / 10,
      lineName: '主干线',
      maxAllowedTemp: 70.0,
      isActive: true,
    })
  }

  return sensors
}

export const SENSORS: SensorConfig[] = generateSensors()

export function getSensorById(id: string): SensorConfig | undefined {
  return SENSORS.find(s => s.id === id)
}

export function getSensorsByType(type: 'temperature' | 'wind' | 'solar'): SensorConfig[] {
  return SENSORS.filter(s => s.type === type)
}

export function getNearestSensors(
  km: number,
  type?: 'temperature' | 'wind' | 'solar',
  count: number = 3,
): SensorConfig[] {
  const candidates = type ? getSensorsByType(type) : SENSORS
  return candidates
    .map(s => ({ ...s, distance: Math.abs(s.linePositionKm - km) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count)
}
