import {
  createRatingCalculator,
  type RatingInput,
  type RatingResult,
} from './modules/ieee-rating-calculator.js'
import { getNearestSensors, type SensorConfig } from '../config/sensors.js'
import { CONDUCTOR_SPECS } from '../config/line-corridor.js'

export { CONDUCTOR_SPECS } from '../config/line-corridor.js'

const STATIC_CAPACITY = Number(process.env.STATIC_CAPACITY || 1000)
const MAX_ALLOWED_TEMP = Number(process.env.MAX_ALLOWED_TEMP || 70)
const AMBIENT_TEMP = 25
const DEFAULT_CONDUCTOR = 'LGJ-400/35'

export { type RatingInput as CapacityInput } from './modules/ieee-rating-calculator.js'

export type CapacityResult = RatingResult

export function calculateDynamicCapacity(
  input: RatingInput,
): RatingResult {
  const calculator = createRatingCalculator(DEFAULT_CONDUCTOR, {
    staticCapacity: STATIC_CAPACITY,
    maxAllowedTemp: MAX_ALLOWED_TEMP,
  })

  const ambientTemp = input.ambientTemp ?? AMBIENT_TEMP

  return calculator.calculateDynamicRating({
    ...input,
    ambientTemp,
  })
}

export interface SegmentCondition {
  segmentId: string
  conductorTemp: number
  windSpeed: number
  solarIrradiance: number
  ambientTemp: number
  humidity: number
  fromKm: number
  toKm: number
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
}

export function aggregateSensorData(
  sensorData: Map<string, { value: number; timestamp: string }>,
  sensors: SensorConfig[],
): AggregatedConditions {
  let totalTemp = 0
  let totalWind = 0
  let totalSolar = 0
  let maxTemp = -Infinity
  let maxWind = -Infinity
  let tempCount = 0
  let windCount = 0
  let solarCount = 0

  for (const sensor of sensors) {
    const data = sensorData.get(sensor.id)
    if (!data) continue

    if (sensor.type === 'temperature') {
      totalTemp += data.value
      tempCount++
      if (data.value > maxTemp) maxTemp = data.value
    } else if (sensor.type === 'wind') {
      totalWind += data.value
      windCount++
      if (data.value > maxWind) maxWind = data.value
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
  }
}

export { getNearestSensors }

export {
  createRatingCalculator,
} from './modules/ieee-rating-calculator.js'
export {
  createDynamicRatingEngine,
} from './modules/dynamic-rating-engine.js'

export {
  IceAccretionEstimator,
  createIceAccretionEstimator,
  type IcingContext,
  type IcingConditions,
} from './modules/ice-accretion-estimator.js'
