import { getNearestSensors, type SensorConfig } from '../../config/sensors.js'

const ICING_OPTIMAL_TEMP_MIN = -5
const ICING_OPTIMAL_TEMP_MAX = 5
const HIGH_HUMIDITY_THRESHOLD = 80
const MAX_ICING_RISK_FACTOR = 0.4
const BASE_GALLOPING_WIND_THRESHOLD = 30
const MIN_GALLOPING_WIND_THRESHOLD = 15
const ICING_ACCUMULATION_RATE = 0.12
const ICING_MELT_TEMP_THRESHOLD = 3
const MAX_ICING_THICKNESS = 30

export interface IcingConditions {
  ambientTemp: number
  humidity: number
  windSpeed: number
  solarIrradiance: number
  precipitation?: number
}

export interface IcingContext {
  ambientTemp: number
  humidity: number
  tempRisk: number
  humidityRisk: number
  icingRiskFactor: number
  adjustedThreshold: number
  estimatedThickness: number
  isIcingCondition: boolean
  gallopingSensitivity: number
}

export interface IcingEstimatorOptions {
  baseWindThreshold?: number
  minWindThreshold?: number
  maxRiskFactor?: number
  optimalTempMin?: number
  optimalTempMax?: number
  highHumidityThreshold?: number
}

export class IceAccretionEstimator {
  private baseWindThreshold: number
  private minWindThreshold: number
  private maxRiskFactor: number
  private optimalTempMin: number
  private optimalTempMax: number
  private highHumidityThreshold: number
  private thicknessHistory: Map<string, { thickness: number; lastUpdated: Date }> = new Map()

  constructor(options: IcingEstimatorOptions = {}) {
    this.baseWindThreshold = options.baseWindThreshold ?? BASE_GALLOPING_WIND_THRESHOLD
    this.minWindThreshold = options.minWindThreshold ?? MIN_GALLOPING_WIND_THRESHOLD
    this.maxRiskFactor = options.maxRiskFactor ?? MAX_ICING_RISK_FACTOR
    this.optimalTempMin = options.optimalTempMin ?? ICING_OPTIMAL_TEMP_MIN
    this.optimalTempMax = options.optimalTempMax ?? ICING_OPTIMAL_TEMP_MAX
    this.highHumidityThreshold = options.highHumidityThreshold ?? HIGH_HUMIDITY_THRESHOLD
  }

  public calculateTemperatureRisk(ambientTemp: number): number {
    const center = (this.optimalTempMin + this.optimalTempMax) / 2
    const range = this.optimalTempMax - this.optimalTempMin

    if (ambientTemp >= this.optimalTempMin && ambientTemp <= this.optimalTempMax) {
      return 1 - Math.abs(ambientTemp - center) / (range / 2)
    } else if (ambientTemp < this.optimalTempMin) {
      return Math.max(0, 1 + (ambientTemp - this.optimalTempMin) / 10)
    } else {
      return Math.max(0, 1 - (ambientTemp - this.optimalTempMax) / 15)
    }
  }

  public calculateHumidityRisk(humidity: number): number {
    if (humidity >= this.highHumidityThreshold) {
      return 1
    }
    return Math.max(0, humidity / this.highHumidityThreshold)
  }

  public estimateHumidityFromSolar(solarIrradiance: number, temp: number): number {
    const baseHumidity = 100 - (Math.min(Math.max(solarIrradiance, 0), 1000) / 1000) * 60
    const tempAdjustment = temp > 25 ? -5 : (temp < 5 ? 10 : 0)
    return Math.max(20, Math.min(95, baseHumidity + tempAdjustment))
  }

  public getIcingContextForSensor(
    windSensorId: string,
    sensorDataMap: Map<string, { value: number; timestamp: string }>,
    sensorConfig: SensorConfig,
  ): IcingContext {
    const nearbyTemps = getNearestSensors(sensorConfig.linePositionKm, 'temperature', 3)
    let avgTemp = 15
    let tempCount = 0
    for (const s of nearbyTemps) {
      const data = sensorDataMap.get(s.id)
      if (data) {
        avgTemp += data.value
        tempCount++
      }
    }
    if (tempCount > 0) avgTemp /= tempCount

    const nearbySolar = getNearestSensors(sensorConfig.linePositionKm, 'solar', 1)
    let solarValue = 500
    if (nearbySolar.length > 0) {
      const solarData = sensorDataMap.get(nearbySolar[0].id)
      if (solarData) solarValue = solarData.value
    }

    const windData = sensorDataMap.get(windSensorId)
    const windSpeed = windData?.value || 0

    const estimatedHumidity = this.estimateHumidityFromSolar(solarValue, avgTemp)
    return this.calculateIcingContext({
      ambientTemp: avgTemp,
      humidity: estimatedHumidity,
      windSpeed,
      solarIrradiance: solarValue,
    }, windSensorId)
  }

  public calculateIcingContext(
    conditions: IcingConditions,
    sensorId: string = 'default',
  ): IcingContext {
    const { ambientTemp, humidity, windSpeed, solarIrradiance } = conditions

    const tempRisk = this.calculateTemperatureRisk(ambientTemp)
    const humidityRisk = this.calculateHumidityRisk(humidity)
    const icingRiskFactor = tempRisk * humidityRisk * this.maxRiskFactor

    const adjustedThreshold = this.baseWindThreshold * (1 - icingRiskFactor)
    const finalThreshold = Math.max(this.minWindThreshold, adjustedThreshold)

    const isIcingCondition = tempRisk > 0.3 && humidityRisk > 0.4
    const estimatedThickness = this.updateThicknessEstimate(sensorId, conditions, isIcingCondition)

    const gallopingSensitivity = Math.max(
      1,
      1 + (estimatedThickness / 10) * (1 + icingRiskFactor * 2),
    )

    return {
      ambientTemp,
      humidity,
      tempRisk,
      humidityRisk,
      icingRiskFactor,
      adjustedThreshold: finalThreshold,
      estimatedThickness,
      isIcingCondition,
      gallopingSensitivity,
    }
  }

  private updateThicknessEstimate(
    sensorId: string,
    conditions: IcingConditions,
    isIcing: boolean,
  ): number {
    const now = new Date()
    const history = this.thicknessHistory.get(sensorId)
    const { ambientTemp, windSpeed, solarIrradiance } = conditions

    let currentThickness = history?.thickness || 0

    if (history) {
      const hoursSinceUpdate = (now.getTime() - history.lastUpdated.getTime()) / (1000 * 60 * 60)

      if (isIcing && ambientTemp < ICING_MELT_TEMP_THRESHOLD) {
        const accumulation = ICING_ACCUMULATION_RATE * hoursSinceUpdate * (windSpeed / 10)
        currentThickness = Math.min(MAX_ICING_THICKNESS, currentThickness + accumulation)
      } else {
        let meltRate = 0
        if (ambientTemp > ICING_MELT_TEMP_THRESHOLD) {
          meltRate = (ambientTemp - ICING_MELT_TEMP_THRESHOLD) * 0.5
        }
        meltRate += (solarIrradiance / 1000) * 0.3
        currentThickness = Math.max(0, currentThickness - meltRate * hoursSinceUpdate)
      }
    }

    this.thicknessHistory.set(sensorId, {
      thickness: currentThickness,
      lastUpdated: now,
    })

    return currentThickness
  }

  public getIcingSeverity(thickness: number): 'none' | 'light' | 'moderate' | 'heavy' | 'severe' {
    if (thickness <= 0) return 'none'
    if (thickness < 3) return 'light'
    if (thickness < 8) return 'moderate'
    if (thickness < 15) return 'heavy'
    return 'severe'
  }

  public getWindLoadIncreaseFactor(thickness: number): number {
    if (thickness <= 0) return 1
    const dragCoeff = 1.2 + thickness / 20
    const iceDensity = 900
    const conductorDiameter = 0.028
    const projectedArea = (conductorDiameter + thickness * 2) / 1000
    return Math.min(5, 1 + projectedArea * dragCoeff * iceDensity * 0.1)
  }

  public resetThicknessHistory(sensorId?: string): void {
    if (sensorId) {
      this.thicknessHistory.delete(sensorId)
    } else {
      this.thicknessHistory.clear()
    }
  }

  public getAllThicknessEstimates(): Array<{ sensorId: string; thickness: number; severity: string }> {
    const result: Array<{ sensorId: string; thickness: number; severity: string }> = []
    for (const [sensorId, data] of this.thicknessHistory.entries()) {
      result.push({
        sensorId,
        thickness: data.thickness,
        severity: this.getIcingSeverity(data.thickness),
      })
    }
    return result
  }
}

export function createIceAccretionEstimator(
  options?: IcingEstimatorOptions,
): IceAccretionEstimator {
  return new IceAccretionEstimator(options)
}
