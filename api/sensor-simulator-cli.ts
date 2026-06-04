#!/usr/bin/env node

import { WebSocket } from 'ws'
import {
  generateReadings,
  setSimulatorConfig,
  setWeather,
  setSeason,
  setBaseValues,
  setAnomalyProbability,
  getSimulatorConfig,
  getSimulatorState,
  resetSimulator,
  type SimulatorConfig,
  type SensorReading,
} from './enhanced-sensor-simulator.js'
import dotenv from 'dotenv'

dotenv.config()

const WS_URL = process.env.SIMULATOR_WS_URL || 'ws://localhost:3001/ws'
const REPORT_INTERVAL = Number(process.env.SIMULATOR_INTERVAL || 10000)

interface SimulatorOptions {
  interval?: number
  wsUrl?: string
  config?: Partial<SimulatorConfig>
  weather?: SimulatorConfig['weather']
  season?: SimulatorConfig['season']
  anomaly?: number
  temp?: number
  wind?: number
  solar?: number
  verbose?: boolean
  oneShot?: boolean
}

function parseArgs(): SimulatorOptions {
  const args = process.argv.slice(2)
  const options: SimulatorOptions = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case '--interval':
      case '-i':
        options.interval = Number(args[++i])
        break
      case '--url':
      case '-u':
        options.wsUrl = args[++i]
        break
      case '--weather':
      case '-w':
        options.weather = args[++i] as SimulatorConfig['weather']
        break
      case '--season':
      case '-s':
        options.season = args[++i] as SimulatorConfig['season']
        break
      case '--anomaly':
      case '-a':
        options.anomaly = Number(args[++i])
        break
      case '--temp':
        options.temp = Number(args[++i])
        break
      case '--wind':
        options.wind = Number(args[++i])
        break
      case '--solar':
        options.solar = Number(args[++i])
        break
      case '--verbose':
      case '-v':
        options.verbose = true
        break
      case '--one-shot':
      case '-1':
        options.oneShot = true
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
        break
      case '--print-config':
        printConfig()
        process.exit(0)
        break
      case '--reset':
        resetSimulator()
        console.log('Simulator reset to defaults')
        process.exit(0)
        break
      default:
        console.error(`Unknown argument: ${arg}`)
        printHelp()
        process.exit(1)
    }
  }

  return options
}

function printHelp(): void {
  console.log(`
传感器数据模拟器 - 电网输电线路动态增容监测系统

Usage:
  node --import tsx api/sensor-simulator-cli.ts [options]

Options:
  -i, --interval <ms>       上报间隔时间（毫秒），默认：10000
  -u, --url <url>           WebSocket服务器地址，默认：ws://localhost:3001/ws
  -w, --weather <type>      设置天气类型：sunny | cloudy | rainy | stormy | snowy
  -s, --season <type>       设置季节：spring | summer | autumn | winter
  -a, --anomaly <prob>      异常概率（0-1），默认：0.015
  --temp <value>            设置基础温度（°C），默认：25
  --wind <value>            设置基础风速（m/s），默认：5
  --solar <value>           设置基础日照（W/m²），默认：800
  -v, --verbose             详细输出模式
  -1, --one-shot            只发送一次数据后退出
  --print-config            打印当前配置
  --reset                   重置为默认配置
  -h, --help                显示帮助信息

Examples:
  # 启动模拟器，上报间隔5秒
  node --import tsx api/sensor-simulator-cli.ts -i 5000

  # 设置暴风雨天气
  node --import tsx api/sensor-simulator-cli.ts --weather stormy

  # 设置冬季，增加异常概率
  node --import tsx api/sensor-simulator-cli.ts --season winter -a 0.05

  # 只发送一次测试数据
  node --import tsx api/sensor-simulator-cli.ts -1 -v

  # 自定义基础值
  node --import tsx api/sensor-simulator-cli.ts --temp 30 --wind 8 --solar 600
`)
}

function printConfig(): void {
  const config = getSimulatorConfig()
  const state = getSimulatorState()
  console.log('=== 模拟器配置 ===')
  console.log(JSON.stringify({ config, state }, null, 2))
}

class SensorSimulatorClient {
  private ws: WebSocket | null = null
  private intervalId: NodeJS.Timeout | null = null
  private options: SimulatorOptions
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10

  constructor(options: SimulatorOptions) {
    this.options = options
    this.applyConfig()
  }

  private applyConfig(): void {
    if (this.options.config) {
      setSimulatorConfig(this.options.config)
    }
    if (this.options.weather) {
      setWeather(this.options.weather)
    }
    if (this.options.season) {
      setSeason(this.options.season)
    }
    if (this.options.temp !== undefined ||
        this.options.wind !== undefined ||
        this.options.solar !== undefined) {
      setBaseValues(this.options.temp, this.options.wind, this.options.solar)
    }
    if (this.options.anomaly !== undefined) {
      setAnomalyProbability(this.options.anomaly)
    }
  }

  private log(message: string, data?: unknown): void {
    if (this.options.verbose) {
      const timestamp = new Date().toISOString()
      console.log(`[${timestamp}] ${message}`, data || '')
    }
  }

  public async connect(): Promise<void> {
    const wsUrl = this.options.wsUrl || WS_URL
    console.log(`Connecting to ${wsUrl}...`)

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl)

      this.ws.on('open', () => {
        console.log('✅ Connected to server')
        this.reconnectAttempts = 0
        resolve()
      })

      this.ws.on('error', (error) => {
        console.error('❌ Connection error:', error)
        reject(error)
      })

      this.ws.on('close', (code, reason) => {
        console.log(`⚠️  Disconnected (code: ${code}, reason: ${reason})`)
        this.ws = null
        if (!this.options.oneShot) {
          this.scheduleReconnect()
        }
      })

      this.ws.on('message', (data) => {
        this.log('Received message:', data.toString())
      })
    })
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Max reconnection attempts reached')
      process.exit(1)
    }

    this.reconnectAttempts++
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)

    console.log(`🔄 Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`)

    setTimeout(async () => {
      try {
        await this.connect()
        this.start()
      } catch (err) {
        console.error('❌ Reconnection failed:', err)
      }
    }, delay)
  }

  private sendReadings(readings: SensorReading[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('⚠️  WebSocket not ready, skipping send')
      return
    }

    const message = {
      type: 'sensor_data',
      sensors: readings,
    }

    try {
      this.ws.send(JSON.stringify(message))
      const tempCount = readings.filter(r => r.type === 'temperature').length
      const windCount = readings.filter(r => r.type === 'wind').length
      const solarCount = readings.filter(r => r.type === 'solar').length

      const summary = {
        timestamp: readings[0]?.timestamp,
        total: readings.length,
        temperature: tempCount,
        wind: windCount,
        solar: solarCount,
        avgTemp: readings.filter(r => r.type === 'temperature').reduce((s, r) => s + r.value, 0) / tempCount,
        maxWind: Math.max(...readings.filter(r => r.type === 'wind').map(r => r.value)),
      }

      console.log(`📡 Sent ${readings.length} readings`, summary)
      this.log('Full payload:', readings)
    } catch (err) {
      console.error('❌ Failed to send readings:', err)
    }
  }

  public start(): void {
    const interval = this.options.interval || REPORT_INTERVAL
    console.log(`🚀 Starting simulator (interval: ${interval}ms, weather: ${getSimulatorConfig().weather}, season: ${getSimulatorConfig().season})`)

    if (this.options.oneShot) {
      const readings = generateReadings()
      this.sendReadings(readings)
      setTimeout(() => {
        this.stop()
        process.exit(0)
      }, 1000)
      return
    }

    const readings = generateReadings()
    this.sendReadings(readings)

    this.intervalId = setInterval(() => {
      const readings = generateReadings()
      this.sendReadings(readings)
    }, interval)
  }

  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    console.log('🛑 Simulator stopped')
  }
}

async function main(): Promise<void> {
  const options = parseArgs()

  const simulator = new SensorSimulatorClient(options)

  try {
    await simulator.connect()
    simulator.start()

    process.on('SIGINT', () => {
      console.log('\nReceived SIGINT, shutting down...')
      simulator.stop()
      process.exit(0)
    })

    process.on('SIGTERM', () => {
      console.log('\nReceived SIGTERM, shutting down...')
      simulator.stop()
      process.exit(0)
    })
  } catch (err) {
    console.error('❌ Failed to start simulator:', err)
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

export { SensorSimulatorClient }
