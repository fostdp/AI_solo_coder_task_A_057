import { WebSocketServer, WebSocket } from 'ws'
import { createServer } from 'http'
import type { IncomingMessage } from 'http'
import type { Duplex } from 'stream'

import { createLineDataCollector, type SensorReading } from './modules/line-data-collector.js'
import { createDynamicRatingEngine } from './modules/dynamic-rating-engine.js'
import { createLineAlarmProcessor, type Alarm } from './modules/line-alarm-processor.js'
import { createGridStatePusher } from './modules/grid-state-pusher.js'
import { generateReadings } from './sensor-simulator.js'

const OFFLINE_CHECK_INTERVAL_MS = 30 * 1000
const SENSOR_REPORT_INTERVAL_MS = 10 * 1000
const CAPACITY_CALC_INTERVAL_MS = 10 * 1000

const dataCollector = createLineDataCollector({
  persistToDb: true,
  batchSize: 180,
  batchTimeoutMs: 5000,
})

const ratingEngine = createDynamicRatingEngine({
  globalStaticCapacity: Number(process.env.STATIC_CAPACITY || 1000),
  maxAllowedTemp: Number(process.env.MAX_ALLOWED_TEMP || 70),
  persistResults: true,
})

const alarmProcessor = createLineAlarmProcessor({
  maxAllowedTemp: Number(process.env.MAX_ALLOWED_TEMP || 70),
  offlineThresholdMs: 5 * 60 * 1000,
  overheatDurationMs: 5 * 60 * 1000,
  baseGallopingWindThreshold: 30,
})

const pusher = createGridStatePusher({
  throttleMs: 0,
  maxQueueSize: 1000,
  enableQos: true,
})

pusher.setDataCollector(dataCollector)

const wss = new WebSocketServer({ noServer: true })

const sensors = dataCollector.getAllSensorData()
const initialReadings: SensorReading[] = Array.from(sensors.entries()).map(([id, data]) => ({
  id,
  type: 'temperature' as const,
  value: data.value,
  timestamp: data.timestamp,
}))

void dataCollector.ingest(initialReadings)

dataCollector.onData(async (readings, aggregated) => {
  pusher.broadcastSensorData(readings)

  for (const reading of readings) {
    const allData = dataCollector.getAllSensorData()
    const alarm = await alarmProcessor.processSensorReading(
      reading.id,
      reading.value,
      new Date(reading.timestamp),
      allData,
    )

    if (alarm) {
      pusher.broadcastAlarm(alarm)
    }
  }
})

ratingEngine.onRatingUpdate((result) => {
  pusher.broadcastCapacity(result)
})

alarmProcessor.onAlarm((alarm) => {
  pusher.broadcastAlarm(alarm)
})

function setupUpgrade(server: ReturnType<typeof createServer>): void {
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (request.url === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        handleNewConnection(ws, request)
      })
    }
  })
}

function handleNewConnection(ws: WebSocket, request: IncomingMessage): void {
  const clientId = pusher.addClient(ws)
  console.log(`New WebSocket client connected: ${clientId}`)

  ws.send(JSON.stringify({ type: 'connection_established', clientId }))

  void pusher.sendInitialData(clientId)

  setImmediate(async () => {
    const allData = dataCollector.getAllSensorData()
    const ratingResult = await ratingEngine.calculateLineRating(allData)
    pusher.broadcastCapacityInitial({
      dynamicCapacity: ratingResult.globalRating.dynamicCapacity,
      staticCapacity: ratingResult.globalRating.staticCapacity,
      marginPercent: ratingResult.globalRating.marginPercent,
      maxSafeTemp: ratingResult.globalRating.maxSafeTemp,
      cloudCoverFactor: ratingResult.globalRating.cloudCoverFactor,
      effectiveIrradiance: ratingResult.globalRating.effectiveIrradiance,
      timestamp: ratingResult.timestamp.toISOString(),
    })
  })

  ws.on('close', () => {
    console.log(`WebSocket client disconnected: ${clientId}`)
  })
}

async function startSensorSimulation(): Promise<void> {
  console.log('Starting sensor simulation...')

  const sendSensorData = async () => {
    const readings = generateReadings()
    try {
      await dataCollector.ingest(readings)
    } catch (err) {
      console.error('Error ingesting sensor readings:', err)
    }
  }

  await sendSensorData()
  setInterval(sendSensorData, SENSOR_REPORT_INTERVAL_MS)
}

async function startCapacityCalculation(): Promise<void> {
  console.log('Starting capacity calculation engine...')

  const calculate = async () => {
    try {
      const allData = dataCollector.getAllSensorData()
      await ratingEngine.calculateLineRating(allData)
    } catch (err) {
      console.error('Error calculating line rating:', err)
    }
  }

  setTimeout(calculate, 2000)
  setInterval(calculate, CAPACITY_CALC_INTERVAL_MS)
}

function startOfflineMonitoring(): void {
  console.log('Starting offline sensor monitoring...')

  const check = async () => {
    try {
      const newOfflineAlarms = await alarmProcessor.checkOfflineSensors()
      for (const alarm of newOfflineAlarms) {
        pusher.broadcastAlarm(alarm)
      }
    } catch (err) {
      console.error('Error checking offline sensors:', err)
    }
  }

  setInterval(check, OFFLINE_CHECK_INTERVAL_MS)
}

function start(): void {
  dataCollector.start()
  void startSensorSimulation()
  void startCapacityCalculation()
  startOfflineMonitoring()
  console.log('WebSocket server module system initialized')
}

function stop(): void {
  dataCollector.stop()
  pusher.disconnectAll()
  alarmProcessor.removeAllListeners()
  ratingEngine.removeAllListeners()
  console.log('WebSocket server module system stopped')
}

function getModules() {
  return {
    dataCollector,
    ratingEngine,
    alarmProcessor,
    pusher,
  }
}

export { setupUpgrade, start, stop, getModules, wss }
