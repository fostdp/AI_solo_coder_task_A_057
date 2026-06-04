import {
  IEEERatingCalculator,
  createRatingCalculator,
  type RatingResult,
} from './ieee-rating-calculator.js'
import { getNearestSensors, getSensorById } from '../../config/sensors.js'
import { LINE_CORRIDOR_CONFIG, getSegmentAtKm } from '../../config/line-corridor.js'
import { insertDynamicCapacity } from '../db.js'

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

export interface SegmentRatingResult {
  segmentId: string
  rating: RatingResult
  conditions: SegmentCondition
}

export interface LineRatingResult {
  globalRating: RatingResult
  segmentRatings: SegmentRatingResult[]
  aggregated: {
    avgDynamicCapacity: number
    minDynamicCapacity: number
    maxDynamicCapacity: number
    avgMarginPercent: number
    minMarginPercent: number
    maxMarginPercent: number
    avgCloudCoverFactor: number
  }
  timestamp: Date
}

export type RatingCallback = (result: LineRatingResult) => void | Promise<void>

export interface RatingEngineOptions {
  defaultConductorCode?: string
  globalStaticCapacity?: number
  maxAllowedTemp?: number
  persistResults?: boolean
}

export class DynamicRatingEngine {
  private calculators: Map<string, IEEERatingCalculator> = new Map()
  private listeners: Set<RatingCallback> = new Set()
  private lastResult: LineRatingResult | null = null
  private defaultConductorCode: string
  private globalStaticCapacity: number
  private maxAllowedTemp: number
  private persistResults: boolean
  private stats = {
    totalCalculations: 0,
    totalPersists: 0,
    failedPersists: 0,
    avgCalculationTimeMs: 0,
  }

  constructor(options: RatingEngineOptions = {}) {
    this.defaultConductorCode = options.defaultConductorCode ?? 'LGJ-400/35'
    this.globalStaticCapacity = options.globalStaticCapacity ?? 1000
    this.maxAllowedTemp = options.maxAllowedTemp ?? 70
    this.persistResults = options.persistResults ?? true

    this.initializeCalculators()
  }

  private initializeCalculators(): void {
    const conductorCodes = new Set<string>()
    for (const segment of LINE_CORRIDOR_CONFIG.segments) {
      conductorCodes.add(segment.conductorType)
    }
    conductorCodes.add(this.defaultConductorCode)

    for (const code of conductorCodes) {
      try {
        const calculator = createRatingCalculator(code, {
          staticCapacity: this.globalStaticCapacity,
          maxAllowedTemp: this.maxAllowedTemp,
        })
        this.calculators.set(code, calculator)
      } catch (err) {
        console.warn(`Failed to create calculator for ${code}, using default`, err)
      }
    }

    if (!this.calculators.has(this.defaultConductorCode)) {
      const calculator = createRatingCalculator(this.defaultConductorCode, {
        staticCapacity: this.globalStaticCapacity,
        maxAllowedTemp: this.maxAllowedTemp,
      })
      this.calculators.set(this.defaultConductorCode, calculator)
    }
  }

  private getCalculator(conductorCode: string): IEEERatingCalculator {
    let calc = this.calculators.get(conductorCode)
    if (!calc) {
      calc = this.calculators.get(this.defaultConductorCode)
      if (!calc) {
        throw new Error('No calculator available')
      }
    }
    return calc
  }

  public getSegmentConditions(
    sensorDataMap: Map<string, { value: number; timestamp: string }>,
  ): SegmentCondition[] {
    const results: SegmentCondition[] = []

    for (const segment of LINE_CORRIDOR_CONFIG.segments) {
      const fromTower = LINE_CORRIDOR_CONFIG.towers.find(t => t.id === segment.fromTower)
      const toTower = LINE_CORRIDOR_CONFIG.towers.find(t => t.id === segment.toTower)
      if (!fromTower || !toTower) continue

      const midKm = (fromTower.km + toTower.km) / 2

      const tempSensors = getNearestSensors(midKm, 'temperature', 2)
      const windSensors = getNearestSensors(midKm, 'wind', 2)
      const solarSensors = getNearestSensors(midKm, 'solar', 1)

      let avgTemp = 0
      let count = 0
      for (const s of tempSensors) {
        const data = sensorDataMap.get(s.id)
        if (data) {
          avgTemp += data.value
          count++
        }
      }
      const conductorTemp = count > 0 ? avgTemp / count : 45

      let avgWind = 0
      count = 0
      for (const s of windSensors) {
        const data = sensorDataMap.get(s.id)
        if (data) {
          avgWind += data.value
          count++
        }
      }
      const windSpeed = count > 0 ? avgWind / count : 5

      let avgSolar = 0
      count = 0
      for (const s of solarSensors) {
        const data = sensorDataMap.get(s.id)
        if (data) {
          avgSolar += data.value
          count++
        }
      }
      const solarIrradiance = count > 0 ? avgSolar / count : 500

      const avgAmbientTemp = 25
      const humidity = 50

      results.push({
        segmentId: segment.id,
        conductorTemp,
        windSpeed,
        solarIrradiance,
        ambientTemp: avgAmbientTemp,
        humidity,
        fromKm: fromTower.km,
        toKm: toTower.km,
      })
    }

    return results
  }

  public calculateForSegment(
    conditions: SegmentCondition,
  ): SegmentRatingResult {
    const segment = LINE_CORRIDOR_CONFIG.segments.find(s => s.id === conditions.segmentId)
    const conductorCode = segment?.conductorType || this.defaultConductorCode
    const calculator = this.getCalculator(conductorCode)

    const rating = calculator.calculateDynamicRating({
      conductorTemp: conditions.conductorTemp,
      ambientTemp: conditions.ambientTemp,
      windSpeed: conditions.windSpeed,
      solarIrradiance: conditions.solarIrradiance,
      humidity: conditions.humidity,
    })

    return {
      segmentId: conditions.segmentId,
      rating,
      conditions,
    }
  }

  public async calculateLineRating(
    sensorDataMap: Map<string, { value: number; timestamp: string }>,
  ): Promise<LineRatingResult> {
    const startTs = performance.now()
    const segmentConditions = this.getSegmentConditions(sensorDataMap)
    const segmentRatings: SegmentRatingResult[] = []

    for (const conditions of segmentConditions) {
      segmentRatings.push(this.calculateForSegment(conditions))
    }

    const capacities = segmentRatings.map(s => s.rating.dynamicCapacity)
    const margins = segmentRatings.map(s => s.rating.marginPercent)
    const cloudCovers = segmentRatings.map(s => s.rating.cloudCoverFactor)

    const globalRating = segmentRatings.reduce((min, curr) =>
      curr.rating.dynamicCapacity < min.rating.dynamicCapacity ? curr : min,
      segmentRatings[0],
    ).rating

    const result: LineRatingResult = {
      globalRating,
      segmentRatings,
      aggregated: {
        avgDynamicCapacity: capacities.reduce((a, b) => a + b, 0) / capacities.length,
        minDynamicCapacity: Math.min(...capacities),
        maxDynamicCapacity: Math.max(...capacities),
        avgMarginPercent: margins.reduce((a, b) => a + b, 0) / margins.length,
        minMarginPercent: Math.min(...margins),
        maxMarginPercent: Math.max(...margins),
        avgCloudCoverFactor: cloudCovers.reduce((a, b) => a + b, 0) / cloudCovers.length,
      },
      timestamp: new Date(),
    }

    this.lastResult = result
    this.stats.totalCalculations++
    this.stats.avgCalculationTimeMs =
      this.stats.avgCalculationTimeMs * 0.9 + (performance.now() - startTs) * 0.1

    if (this.persistResults) {
      try {
        await insertDynamicCapacity({
          dynamicCapacity: globalRating.dynamicCapacity,
          staticCapacity: globalRating.staticCapacity,
          marginPercent: globalRating.marginPercent,
          conductorTemp: globalRating.coolingBreakdown.total > 0
            ? segmentConditions[0]?.conductorTemp
            : undefined,
          windSpeed: globalRating.coolingBreakdown.forcedConvection > 0
            ? segmentConditions[0]?.windSpeed
            : undefined,
          solarIrradiance: globalRating.effectiveIrradiance,
          cloudCoverFactor: globalRating.cloudCoverFactor,
          effectiveIrradiance: globalRating.effectiveIrradiance,
        }, result.timestamp)
        this.stats.totalPersists++
      } catch (err) {
        console.error('Failed to persist capacity result:', err)
        this.stats.failedPersists++
      }
    }

    for (const listener of this.listeners) {
      try {
        const listenerResult = listener(result)
        if (listenerResult instanceof Promise) {
          void listenerResult.catch((err) => console.error('Rating listener error:', err))
        }
      } catch (err) {
        console.error('Rating listener error:', err)
      }
    }

    return result
  }

  public getLastResult(): LineRatingResult | null {
    return this.lastResult
  }

  public getStatistics() {
    return { ...this.stats }
  }

  public getConductorCodes(): string[] {
    return Array.from(this.calculators.keys())
  }

  public getConductorSpec(code: string) {
    const calc = this.calculators.get(code)
    return calc ? calc.getConductorSpec() : null
  }

  public onRatingUpdate(callback: RatingCallback): () => void {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }

  public removeAllListeners(): void {
    this.listeners.clear()
  }

  public reset(): void {
    this.lastResult = null
    this.stats = {
      totalCalculations: 0,
      totalPersists: 0,
      failedPersists: 0,
      avgCalculationTimeMs: 0,
    }
  }
}

export function createDynamicRatingEngine(
  options?: RatingEngineOptions,
): DynamicRatingEngine {
  return new DynamicRatingEngine(options)
}
