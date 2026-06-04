import { SENSORS, type SensorConfig } from '../config/sensors.js'

const MAX_ALLOWED_TEMP = Number(process.env.MAX_ALLOWED_TEMP || 70)

export interface SimulatorConfig {
  baseTemp: number
  baseWind: number
  baseSolar: number
  tempAmplitude: number
  windAmplitude: number
  solarAmplitude: number
  tempRandomness: number
  windRandomness: number
  solarRandomness: number
  tempHourlyPattern: number[]
  windHourlyPattern: number[]
  solarHourlyPattern: number[]
  positionFactorStrength: number
  anomalyProbability: number
  anomalyMultiplier: number
  season: 'spring' | 'summer' | 'autumn' | 'winter'
  weather: 'sunny' | 'cloudy' | 'rainy' | 'stormy' | 'snowy'
}

export interface SensorReading {
  id: string
  type: 'temperature' | 'wind' | 'solar'
  value: number
  timestamp: string
}

interface SimulatorState {
  config: SimulatorConfig
  globalTrend: {
    temp: number
    wind: number
    solar: number
  }
  lastUpdate: Date
  weatherHistory: Array<{ time: Date; weather: SimulatorConfig['weather'] }>
}

const DEFAULT_HOURLY_PATTERN = [
  0.6, 0.55, 0.5, 0.5, 0.55, 0.65,
  0.75, 0.85, 0.95, 1.0, 1.0, 0.95,
  0.9, 0.85, 0.8, 0.75, 0.7, 0.65,
  0.6, 0.6, 0.6, 0.6, 0.6, 0.6
]

const DEFAULT_SOLAR_HOURLY_PATTERN = [
  0, 0, 0, 0, 0, 0.1,
  0.3, 0.5, 0.7, 0.85, 0.95, 1.0,
  1.0, 0.95, 0.85, 0.7, 0.5, 0.3,
  0.1, 0, 0, 0, 0, 0
]

const SEASON_ADJUSTMENTS = {
  spring: { temp: 1.0, solar: 0.8, wind: 1.1 },
  summer: { temp: 1.3, solar: 1.2, wind: 0.8 },
  autumn: { temp: 0.9, solar: 0.7, wind: 1.2 },
  winter: { temp: 0.6, solar: 0.5, wind: 1.3 },
}

const WEATHER_ADJUSTMENTS = {
  sunny: { temp: 1.0, solar: 1.0, wind: 0.9 },
  cloudy: { temp: 0.9, solar: 0.5, wind: 1.0 },
  rainy: { temp: 0.8, solar: 0.2, wind: 1.3 },
  stormy: { temp: 0.75, solar: 0.1, wind: 1.8 },
  snowy: { temp: 0.5, solar: 0.3, wind: 1.5 },
}

const DEFAULT_CONFIG: SimulatorConfig = {
  baseTemp: 25,
  baseWind: 5,
  baseSolar: 800,
  tempAmplitude: 15,
  windAmplitude: 10,
  solarAmplitude: 400,
  tempRandomness: 0.15,
  windRandomness: 0.25,
  solarRandomness: 0.2,
  tempHourlyPattern: DEFAULT_HOURLY_PATTERN,
  windHourlyPattern: DEFAULT_HOURLY_PATTERN,
  solarHourlyPattern: DEFAULT_SOLAR_HOURLY_PATTERN,
  positionFactorStrength: 0.15,
  anomalyProbability: 0.015,
  anomalyMultiplier: 2.5,
  season: 'summer',
  weather: 'sunny',
}

const state: SimulatorState = {
  config: { ...DEFAULT_CONFIG },
  globalTrend: { temp: 0, wind: 0, solar: 0 },
  lastUpdate: new Date(),
  weatherHistory: [],
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function getHourlyFactor(pattern: number[], date: Date): number {
  const hour = date.getHours()
  const minutes = date.getMinutes()
  const fraction = (hour + minutes / 60) % 24
  const index = Math.floor(fraction)
  const nextIndex = (index + 1) % 24
  const t = fraction - index
  return pattern[index] * (1 - t) + pattern[nextIndex] * t
}

function getPositionFactor(sensor: SensorConfig, strength: number): number {
  const normalizedPos = sensor.linePositionKm / 200
  return Math.sin(normalizedPos * Math.PI * 3) * strength
}

function gaussianRandom(): number {
  const u1 = Math.random()
  const u2 = Math.random()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

function updateGlobalTrend(): void {
  const now = new Date()
  const timeDiff = (now.getTime() - state.lastUpdate.getTime()) / 1000
  state.lastUpdate = now

  const smoothing = 0.98
  state.globalTrend.temp = state.globalTrend.temp * smoothing + gaussianRandom() * 0.02 * (1 - smoothing)
  state.globalTrend.wind = state.globalTrend.wind * smoothing + gaussianRandom() * 0.05 * (1 - smoothing)
  state.globalTrend.solar = state.globalTrend.solar * smoothing + gaussianRandom() * 0.03 * (1 - smoothing)

  state.globalTrend.temp = clamp(state.globalTrend.temp, -1, 1)
  state.globalTrend.wind = clamp(state.globalTrend.wind, -1, 1)
  state.globalTrend.solar = clamp(state.globalTrend.solar, -1, 1)
}

function maybeChangeWeather(): void {
  const now = new Date()
  const lastWeatherChange = state.weatherHistory.length > 0
    ? state.weatherHistory[state.weatherHistory.length - 1].time
    : new Date(0)

  if (now.getTime() - lastWeatherChange.getTime() > 2 * 60 * 60 * 1000) {
    if (Math.random() < 0.1) {
      const weathers: SimulatorConfig['weather'][] = ['sunny', 'cloudy', 'rainy', 'stormy', 'snowy']
      const weights = [0.5, 0.3, 0.12, 0.05, 0.03]
      let random = Math.random()
      let newWeather: SimulatorConfig['weather'] = 'sunny'
      for (let i = 0; i < weathers.length; i++) {
        if (random < weights[i]) {
          newWeather = weathers[i]
          break
        }
        random -= weights[i]
      }
      state.config.weather = newWeather
      state.weatherHistory.push({ time: now, weather: newWeather })
      if (state.weatherHistory.length > 100) {
        state.weatherHistory.shift()
      }
      console.log(`Weather changed to: ${newWeather}`)
    }
  }
}

function updateSeason(): void {
  const month = new Date().getMonth()
  const seasons: SimulatorConfig['season'][] = ['winter', 'spring', 'summer', 'autumn']
  const seasonIndex = Math.floor((month + 1) / 3) % 4
  state.config.season = seasons[seasonIndex]
}

function generateSensorValue(
  sensor: SensorConfig,
  now: Date,
): number {
  const { config, globalTrend } = state
  const seasonAdj = SEASON_ADJUSTMENTS[config.season]
  const weatherAdj = WEATHER_ADJUSTMENTS[config.weather]
  const positionFactor = getPositionFactor(sensor, config.positionFactorStrength)

  switch (sensor.type) {
    case 'temperature': {
      const hourlyFactor = getHourlyFactor(config.tempHourlyPattern, now)
      const baseValue = config.baseTemp + (hourlyFactor - 0.7) * config.tempAmplitude
      const trendValue = baseValue * seasonAdj.temp * weatherAdj.temp
      const randomNoise = gaussianRandom() * config.tempRandomness * config.tempAmplitude
      const trendEffect = globalTrend.temp * config.tempAmplitude * 0.5
      let value = trendValue + positionFactor * config.tempAmplitude + randomNoise + trendEffect

      if (Math.random() < config.anomalyProbability) {
        value += (Math.random() - 0.5) * 2 * config.anomalyMultiplier * config.tempAmplitude * 0.3
      }

      return clamp(value, -20, MAX_ALLOWED_TEMP + 15)
    }

    case 'wind': {
      const hourlyFactor = getHourlyFactor(config.windHourlyPattern, now)
      const baseValue = config.baseWind + hourlyFactor * config.windAmplitude * 0.5
      const trendValue = baseValue * seasonAdj.wind * weatherAdj.wind
      const randomNoise = Math.abs(gaussianRandom()) * config.windRandomness * config.windAmplitude
      const trendEffect = globalTrend.wind * config.windAmplitude * 0.3
      let value = trendValue + positionFactor * config.windAmplitude + randomNoise + trendEffect

      if (Math.random() < config.anomalyProbability) {
        value += Math.random() * config.anomalyMultiplier * config.windAmplitude
      }

      return clamp(value, 0, 50)
    }

    case 'solar': {
      const hourlyFactor = getHourlyFactor(config.solarHourlyPattern, now)
      if (hourlyFactor <= 0.01) {
        return 0
      }
      const baseValue = config.baseSolar * hourlyFactor
      const trendValue = baseValue * seasonAdj.solar * weatherAdj.solar
      const randomNoise = gaussianRandom() * config.solarRandomness * config.solarAmplitude
      const trendEffect = globalTrend.solar * config.solarAmplitude * 0.3
      let value = trendValue + positionFactor * config.solarAmplitude + randomNoise + trendEffect

      if (Math.random() < config.anomalyProbability * 0.5) {
        value *= (0.5 + Math.random() * 0.5)
      }

      return clamp(value, 0, 1400)
    }

    default:
      return 0
  }
}

export function generateReadings(): SensorReading[] {
  updateGlobalTrend()
  maybeChangeWeather()
  updateSeason()

  const now = new Date()
  const timestamp = now.toISOString()

  const readings: SensorReading[] = SENSORS.map(sensor => ({
    id: sensor.id,
    type: sensor.type,
    value: +generateSensorValue(sensor, now).toFixed(2),
    timestamp,
  }))

  return readings
}

export function setSimulatorConfig(partialConfig: Partial<SimulatorConfig>): void {
  state.config = { ...state.config, ...partialConfig }
}

export function getSimulatorConfig(): SimulatorConfig {
  return { ...state.config }
}

export function setWeather(weather: SimulatorConfig['weather']): void {
  state.config.weather = weather
  state.weatherHistory.push({ time: new Date(), weather })
}

export function setSeason(season: SimulatorConfig['season']): void {
  state.config.season = season
}

export function setBaseValues(baseTemp?: number, baseWind?: number, baseSolar?: number): void {
  if (baseTemp !== undefined) state.config.baseTemp = baseTemp
  if (baseWind !== undefined) state.config.baseWind = baseWind
  if (baseSolar !== undefined) state.config.baseSolar = baseSolar
}

export function setAnomalyProbability(probability: number): void {
  state.config.anomalyProbability = clamp(probability, 0, 1)
}

export function getCurrentWeather(): SimulatorConfig['weather'] {
  return state.config.weather
}

export function getCurrentSeason(): SimulatorConfig['season'] {
  return state.config.season
}

export function getSimulatorState(): Omit<SimulatorState, 'config'> & { config: SimulatorConfig } {
  return {
    config: { ...state.config },
    globalTrend: { ...state.globalTrend },
    lastUpdate: new Date(state.lastUpdate),
    weatherHistory: [...state.weatherHistory],
  }
}

export function startSensorSimulation(
  callback: (readings: SensorReading[]) => void,
  intervalMs: number = 10000,
): NodeJS.Timeout {
  const readings = generateReadings()
  callback(readings)

  return setInterval(() => {
    const readings = generateReadings()
    callback(readings)
  }, intervalMs)
}

export function resetSimulator(): void {
  state.config = { ...DEFAULT_CONFIG }
  state.globalTrend = { temp: 0, wind: 0, solar: 0 }
  state.lastUpdate = new Date()
  state.weatherHistory = []
}
