import { CONDUCTOR_SPECS, type ConductorSpec } from '../../config/line-corridor.js'

const STEFAN_BOLTZMANN = 5.67e-8
const SOLAR_CONSTANT = 1361
const MAX_THEORETICAL_IRRADIANCE = 1000
const ALTITUDE_CORRECTION_FACTOR = 0.9
const CLOUD_BASE_TEMP = 5
const DEFAULT_SOLAR_ABSORPTIVITY = 0.5
const DEFAULT_EMISSIVITY = 0.5

export interface MeteorologicalConditions {
  ambientTemperature: number
  windSpeed: number
  windDirection?: number
  solarIrradiance: number
  humidity?: number
  elevation?: number
}

export interface RatingInput {
  conductorTemp: number
  ambientTemp: number
  windSpeed: number
  solarIrradiance: number
  humidity?: number
  elevation?: number
}

export interface SolarHeatingResult {
  heating: number
  cloudCoverFactor: number
  effectiveIrradiance: number
  theoreticalClearSky: number
}

export interface CoolingBreakdown {
  forcedConvection: number
  naturalConvection: number
  radiation: number
  total: number
}

export interface RatingResult {
  dynamicCapacity: number
  staticCapacity: number
  marginPercent: number
  maxSafeTemp: number
  cloudCoverFactor: number
  effectiveIrradiance: number
  solarHeating: number
  totalCooling: number
  conductor: ConductorSpec
  reynoldsNumber: number
  nusseltNumber: number
  coolingBreakdown: CoolingBreakdown
}

export interface IEEERatingCalculatorOptions {
  solarAbsorptivity?: number
  emissivity?: number
  staticCapacity?: number
  maxAllowedTemp?: number
}

export class IEEERatingCalculator {
  private conductor: ConductorSpec
  private solarAbsorptivity: number
  private emissivity: number
  private maxAllowedTemp: number
  private staticCapacity: number

  constructor(
    conductorCode: string,
    options: IEEERatingCalculatorOptions = {},
  ) {
    const spec = CONDUCTOR_SPECS[conductorCode]
    if (!spec) {
      throw new Error(`Conductor ${conductorCode} not found in specs`)
    }

    this.conductor = spec
    this.solarAbsorptivity = options.solarAbsorptivity ?? DEFAULT_SOLAR_ABSORPTIVITY
    this.emissivity = options.emissivity ?? DEFAULT_EMISSIVITY
    this.maxAllowedTemp = options.maxAllowedTemp ?? 70
    this.staticCapacity = options.staticCapacity ?? 1000
  }

  public getConductorSpec(): ConductorSpec {
    return { ...this.conductor }
  }

  public getReynoldsNumber(windSpeed: number, temp: number, ambientTemp: number): number {
    const filmTemp = (temp + ambientTemp) / 2
    const airViscosity = 1.32e-5 + filmTemp * 0.1e-7
    return (windSpeed * this.conductor.diameter) / airViscosity
  }

  public getNusseltNumber(reynolds: number): number {
    if (reynolds < 2000) {
      return 0.43 * Math.pow(reynolds, 0.471)
    } else {
      return 0.648 * Math.pow(reynolds, 0.471)
    }
  }

  public calculateForcedConvection(
    windSpeed: number,
    tempDiff: number,
  ): number {
    if (windSpeed < 0.1) return 0

    const avgTemp = (2 * 25 + this.maxAllowedTemp) / 3
    const airThermalConductivity = 0.024 + avgTemp * 0.000072
    const reynolds = this.getReynoldsNumber(windSpeed, this.maxAllowedTemp, 25)
    const nusselt = this.getNusseltNumber(reynolds)
    const hc = (nusselt * airThermalConductivity) / this.conductor.diameter
    return Math.PI * this.conductor.diameter * hc * tempDiff
  }

  public calculateNaturalConvection(tempDiff: number): number {
    const diameter = this.conductor.diameter
    const delta = tempDiff
    return 0.0205 * Math.pow(delta, 1.25) * Math.pow(diameter, -0.25)
  }

  public calculateRadiationCooling(
    conductorTemp: number,
    ambientTemp: number,
  ): number {
    const ts = conductorTemp + 273.15
    const ta = ambientTemp + 273.15
    return (
      Math.PI *
      this.conductor.diameter *
      this.emissivity *
      STEFAN_BOLTZMANN *
      (Math.pow(ts, 4) - Math.pow(ta, 4))
    )
  }

  public calculateSolarHeating(
    solarIrradiance: number,
    ambientTemp: number,
    elevation: number = 100,
  ): SolarHeatingResult {
    const elevationFactor = 1 + elevation / 10000
    const clearSkyIrradiance = MAX_THEORETICAL_IRRADIANCE * ALTITUDE_CORRECTION_FACTOR * elevationFactor

    const cloudCoverFactor = Math.min(solarIrradiance / Math.max(clearSkyIrradiance, 1), 1)
    const tempCloudAdjustment = ambientTemp < CLOUD_BASE_TEMP ? 1.1 : 1.0
    const effectiveIrradiance = solarIrradiance * tempCloudAdjustment

    return {
      heating: this.solarAbsorptivity * effectiveIrradiance * this.conductor.diameter,
      cloudCoverFactor: Math.max(0, Math.min(1, cloudCoverFactor)),
      effectiveIrradiance,
      theoreticalClearSky: clearSkyIrradiance,
    }
  }

  public calculateJouleHeating(current: number, temp: number): number {
    const tempFactor = 1 + 0.00403 * (temp - 20)
    const acResistance = this.conductor.acResistance20C * tempFactor
    return Math.pow(current, 2) * acResistance
  }

  public calculateDynamicRating(
    input: RatingInput,
  ): RatingResult {
    const { conductorTemp, ambientTemp, windSpeed, solarIrradiance, elevation = 100 } = input

    const tempDiff = Math.max(conductorTemp - ambientTemp, 1)
    const maxTempDiff = this.maxAllowedTemp - ambientTemp

    const forcedConvection = this.calculateForcedConvection(windSpeed, tempDiff)
    const naturalConvection = this.calculateNaturalConvection(tempDiff)
    const convectionCooling = Math.max(forcedConvection, naturalConvection)
    const radiationCooling = this.calculateRadiationCooling(conductorTemp, ambientTemp)
    const totalCooling = convectionCooling + radiationCooling

    const solarResult = this.calculateSolarHeating(solarIrradiance, ambientTemp, elevation)
    const jouleHeating = totalCooling - solarResult.heating

    const reynolds = this.getReynoldsNumber(windSpeed, conductorTemp, ambientTemp)
    const nusselt = this.getNusseltNumber(reynolds)

    if (jouleHeating <= 0) {
      return {
        dynamicCapacity: 0,
        staticCapacity: this.staticCapacity,
        marginPercent: -100,
        maxSafeTemp: ambientTemp,
        cloudCoverFactor: solarResult.cloudCoverFactor,
        effectiveIrradiance: solarResult.effectiveIrradiance,
        solarHeating: solarResult.heating,
        totalCooling,
        conductor: this.conductor,
        reynoldsNumber: reynolds,
        nusseltNumber: nusselt,
        coolingBreakdown: {
          forcedConvection,
          naturalConvection,
          radiation: radiationCooling,
          total: totalCooling,
        },
      }
    }

    const tempFactor = 1 + 0.00403 * ((conductorTemp + this.maxAllowedTemp) / 2 - 20)
    const acResistance = this.conductor.acResistance20C * tempFactor
    const capacity = Math.sqrt(jouleHeating / acResistance)
    const dynamicCapacity = Math.round(capacity)

    const maxForced = this.calculateForcedConvection(windSpeed, maxTempDiff)
    const maxNatural = this.calculateNaturalConvection(maxTempDiff)
    const maxConvection = Math.max(maxForced, maxNatural)
    const maxRadiation = this.calculateRadiationCooling(this.maxAllowedTemp, ambientTemp)
    const maxJoule = maxConvection + maxRadiation - solarResult.heating
    const maxSafeCurrent = Math.sqrt(Math.max(maxJoule, 0) / acResistance)

    const marginPercent = Math.round(
      ((Math.min(dynamicCapacity, Math.round(maxSafeCurrent)) - this.staticCapacity) / this.staticCapacity) * 100,
    )

    return {
      dynamicCapacity: Math.min(dynamicCapacity, Math.round(maxSafeCurrent)),
      staticCapacity: this.staticCapacity,
      marginPercent: Math.min(
        marginPercent,
        Math.round(((maxSafeCurrent - this.staticCapacity) / this.staticCapacity) * 100),
      ),
      maxSafeTemp: this.maxAllowedTemp,
      cloudCoverFactor: solarResult.cloudCoverFactor,
      effectiveIrradiance: solarResult.effectiveIrradiance,
      solarHeating: solarResult.heating,
      totalCooling,
      conductor: this.conductor,
      reynoldsNumber: reynolds,
      nusseltNumber: nusselt,
      coolingBreakdown: {
        forcedConvection,
        naturalConvection,
        radiation: radiationCooling,
        total: totalCooling,
      },
    }
  }

  public calculateAllowableTempForCurrent(
    current: number,
    ambientTemp: number,
    windSpeed: number,
    solarIrradiance: number,
  ): number {
    const solarResult = this.calculateSolarHeating(solarIrradiance, ambientTemp)
    const jouleHeating = this.calculateJouleHeating(current, (ambientTemp + this.maxAllowedTemp) / 2)

    const targetCooling = jouleHeating + solarResult.heating
    let low = ambientTemp
    let high = 200
    for (let i = 0; i < 20; i++) {
      const mid = (low + high) / 2
      const tempDiff = mid - ambientTemp
      const fc = this.calculateForcedConvection(windSpeed, tempDiff)
      const nc = this.calculateNaturalConvection(tempDiff)
      const rad = this.calculateRadiationCooling(mid, ambientTemp)
      const cooling = Math.max(fc, nc) + rad

      if (cooling < targetCooling) {
        low = mid
      } else {
        high = mid
      }
    }
    return (low + high) / 2
  }
}

export function createRatingCalculator(
  conductorCode: string,
  options?: IEEERatingCalculatorOptions,
): IEEERatingCalculator {
  return new IEEERatingCalculator(conductorCode, options)
}
