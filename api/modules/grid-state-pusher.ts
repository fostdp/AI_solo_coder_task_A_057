import { WebSocket } from 'ws'
import { SENSORS, type SensorConfig } from '../../config/sensors.js'
import type { LineDataCollector, SensorReading, AggregatedConditions } from './line-data-collector.js'
import type { LineRatingResult } from './dynamic-rating-engine.js'
import type { Alarm } from './line-alarm-processor.js'
import { getSensorHistory, getCapacityHistory } from '../db.js'

export interface PushStatistics {
  totalMessages: number
  broadcastCount: number
  unicastCount: number
  bytesSent: number
  droppedMessages: number
  avgLatencyMs: number
  clientCount: number
}

export interface PusherOptions {
  throttleMs?: number
  maxQueueSize?: number
  enableQos?: boolean
}

export interface ClientState {
  ws: WebSocket
  id: string
  connectedAt: Date
  lastMessageAt: Date
  messageCount: number
  subscriptions: Set<string>
  pendingQueue: Array<{ type: string; payload: unknown }>
  isReady: boolean
}

type MessageType =
  | 'initial_data'
  | 'sensor_data'
  | 'capacity'
  | 'alarm'
  | 'history_response'
  | 'history_request'
  | 'ping'
  | 'pong'

export class GridStatePusher {
  private clients: Map<string, ClientState> = new Map()
  private stats: PushStatistics = {
    totalMessages: 0,
    broadcastCount: 0,
    unicastCount: 0,
    bytesSent: 0,
    droppedMessages: 0,
    avgLatencyMs: 0,
    clientCount: 0,
  }

  private throttleMs: number
  private maxQueueSize: number
  private enableQos: boolean
  private lastBroadcastTimes: Map<string, number> = new Map()
  private dataCollector: LineDataCollector | null = null

  constructor(options: PusherOptions = {}) {
    this.throttleMs = options.throttleMs ?? 0
    this.maxQueueSize = options.maxQueueSize ?? 1000
    this.enableQos = options.enableQos ?? true
  }

  public setDataCollector(collector: LineDataCollector): void {
    this.dataCollector = collector
  }

  public addClient(ws: WebSocket): string {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const state: ClientState = {
      ws,
      id: clientId,
      connectedAt: new Date(),
      lastMessageAt: new Date(),
      messageCount: 0,
      subscriptions: new Set<string>(),
      pendingQueue: [],
      isReady: ws.readyState === WebSocket.OPEN,
    }

    this.clients.set(clientId, state)
    this.stats.clientCount = this.clients.size

    ws.on('open', () => {
      state.isReady = true
      this.flushQueue(clientId)
    })

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString())
        await this.handleClientMessage(clientId, message)
      } catch (err) {
        console.error('Error parsing client message:', err)
      }
    })

    ws.on('close', () => {
      this.removeClient(clientId)
    })

    ws.on('error', (err) => {
      console.error(`Client ${clientId} error:`, err)
      this.removeClient(clientId)
    })

    return clientId
  }

  public removeClient(clientId: string): void {
    const state = this.clients.get(clientId)
    if (state) {
      state.ws.close()
      this.clients.delete(clientId)
      this.stats.clientCount = this.clients.size
    }
  }

  private async handleClientMessage(clientId: string, message: { type: MessageType; [key: string]: unknown }): Promise<void> {
    const state = this.clients.get(clientId)
    if (!state) return

    state.lastMessageAt = new Date()
    state.messageCount++

    switch (message.type) {
      case 'history_request':
        await this.handleHistoryRequest(clientId, message)
        break
      case 'initial_data':
        await this.sendInitialData(clientId)
        break
      case 'ping':
        this.sendToClient(clientId, 'pong', { timestamp: Date.now() })
        break
      case 'pong':
        break
      default:
        console.warn(`Unknown message type: ${message.type}`)
    }
  }

  private async handleHistoryRequest(
    clientId: string,
    message: { sensorId?: string; hours?: number; type?: string },
  ): Promise<void> {
    const { sensorId, hours = 1, type = 'sensor' } = message

    if (type === 'capacity') {
      const history = await getCapacityHistory(hours as number)
      this.sendToClient(clientId, 'history_response', {
        type: 'capacity',
        hours,
        data: history,
      })
      return
    }

    if (!sensorId) {
      this.sendToClient(clientId, 'history_response', {
        type: 'sensor',
        sensorId: null,
        hours,
        data: [],
        error: 'sensorId is required',
      })
      return
    }

    const history = await getSensorHistory(sensorId as string, hours as number)
    this.sendToClient(clientId, 'history_response', {
      type: 'sensor',
      sensorId,
      hours,
      data: history,
    })
  }

  public async sendInitialData(clientId: string): Promise<void> {
    const allReadings = this.dataCollector?.getAllReadings() || []
    const sensorData = allReadings.map((r) => ({
      id: r.id,
      value: r.value,
      timestamp: r.timestamp,
    }))

    const aggregated = this.dataCollector?.aggregate()
    const activeAlarms: Alarm[] = []

    this.sendToClient(clientId, 'initial_data', {
      sensors: SENSORS,
      sensorData,
      capacity: null,
      alarms: activeAlarms,
      aggregated: aggregated ? {
        avgTemp: aggregated.avgTemp,
        avgWind: aggregated.avgWind,
        avgSolar: aggregated.avgSolar,
        maxTemp: aggregated.maxTemp,
        maxWind: aggregated.maxWind,
      } : null,
    })
  }

  public broadcastSensorData(readings: SensorReading[]): void {
    const messageType = 'sensor_data'
    const now = Date.now()

    const lastSend = this.lastBroadcastTimes.get(messageType) || 0
    if (this.throttleMs > 0 && now - lastSend < this.throttleMs) {
      return
    }
    this.lastBroadcastTimes.set(messageType, now)

    const payload = readings.map((r) => ({
      id: r.id,
      value: r.value,
      timestamp: r.timestamp,
    }))

    this.broadcast(messageType, payload)
  }

  public broadcastCapacity(ratingResult: LineRatingResult): void {
    const payload = {
      dynamicCapacity: ratingResult.globalRating.dynamicCapacity,
      staticCapacity: ratingResult.globalRating.staticCapacity,
      marginPercent: ratingResult.globalRating.marginPercent,
      maxSafeTemp: ratingResult.globalRating.maxSafeTemp,
      cloudCoverFactor: ratingResult.globalRating.cloudCoverFactor,
      effectiveIrradiance: ratingResult.globalRating.effectiveIrradiance,
      timestamp: ratingResult.timestamp.toISOString(),
      aggregated: ratingResult.aggregated,
    }

    this.broadcast('capacity', payload)
  }

  public broadcastAlarm(alarm: Alarm): void {
    this.broadcast('alarm', alarm)
  }

  public broadcastCapacityInitial(capacity: {
    dynamicCapacity: number
    staticCapacity: number
    marginPercent: number
    maxSafeTemp: number
    cloudCoverFactor?: number
    effectiveIrradiance?: number
    timestamp: string
  }): void {
    this.broadcast('capacity', capacity)
  }

  private broadcast(type: MessageType, payload: unknown): void {
    const messageObj: Record<string, unknown> = { type }
    if (type === 'sensor_data') {
      messageObj.sensors = payload
    } else if (type === 'capacity') {
      messageObj.data = payload
    } else if (type === 'alarm') {
      messageObj.alarm = payload
    } else if (type === 'initial_data') {
      Object.assign(messageObj, payload as Record<string, unknown>)
    } else if (type === 'history_response') {
      Object.assign(messageObj, payload as Record<string, unknown>)
    } else {
      messageObj.payload = payload
    }
    const message = JSON.stringify(messageObj)
    const byteLength = Buffer.byteLength(message)

    let sentCount = 0
    for (const [clientId, state] of this.clients.entries()) {
      if (state.ws.readyState === WebSocket.OPEN) {
        try {
          state.ws.send(message)
          state.lastMessageAt = new Date()
          state.messageCount++
          sentCount++
        } catch (err) {
          console.error(`Error sending to client ${clientId}:`, err)
          this.enqueueMessage(clientId, type, payload)
        }
      } else {
        this.enqueueMessage(clientId, type, payload)
      }
    }

    this.stats.totalMessages++
    this.stats.broadcastCount++
    this.stats.bytesSent += byteLength * sentCount
  }

  private sendToClient(clientId: string, type: MessageType, payload: unknown): void {
    const state = this.clients.get(clientId)
    if (!state) return

    const messageObj: Record<string, unknown> = { type }
    if (type === 'sensor_data') {
      messageObj.sensors = payload
    } else if (type === 'capacity') {
      messageObj.data = payload
    } else if (type === 'alarm') {
      messageObj.alarm = payload
    } else if (type === 'initial_data') {
      Object.assign(messageObj, payload as Record<string, unknown>)
    } else if (type === 'history_response') {
      Object.assign(messageObj, payload as Record<string, unknown>)
    } else {
      messageObj.payload = payload
    }
    const message = JSON.stringify(messageObj)
    const byteLength = Buffer.byteLength(message)

    if (state.ws.readyState === WebSocket.OPEN) {
      try {
        state.ws.send(message)
        state.lastMessageAt = new Date()
        state.messageCount++
        this.stats.totalMessages++
        this.stats.unicastCount++
        this.stats.bytesSent += byteLength
      } catch (err) {
        console.error(`Error sending to client ${clientId}:`, err)
        this.enqueueMessage(clientId, type, payload)
      }
    } else {
      this.enqueueMessage(clientId, type, payload)
    }
  }

  private enqueueMessage(clientId: string, type: string, payload: unknown): void {
    const state = this.clients.get(clientId)
    if (!state) return

    if (state.pendingQueue.length >= this.maxQueueSize) {
      state.pendingQueue.shift()
      this.stats.droppedMessages++
    }

    state.pendingQueue.push({ type, payload })
  }

  private flushQueue(clientId: string): void {
    const state = this.clients.get(clientId)
    if (!state || !state.isReady) return

    while (state.pendingQueue.length > 0) {
      const msg = state.pendingQueue.shift()
      if (msg && state.ws.readyState === WebSocket.OPEN) {
        this.sendToClient(clientId, msg.type as MessageType, msg.payload)
      }
    }
  }

  public getClientCount(): number {
    return this.clients.size
  }

  public getStatistics(): PushStatistics {
    return { ...this.stats, clientCount: this.clients.size }
  }

  public getClientIds(): string[] {
    return Array.from(this.clients.keys())
  }

  public getClientState(clientId: string): ClientState | null {
    return this.clients.get(clientId) || null
  }

  public broadcastAll(type: string, payload: unknown): void {
    this.broadcast(type as MessageType, payload)
  }

  public resetStats(): void {
    this.stats = {
      totalMessages: 0,
      broadcastCount: 0,
      unicastCount: 0,
      bytesSent: 0,
      droppedMessages: 0,
      avgLatencyMs: 0,
      clientCount: this.clients.size,
    }
    this.lastBroadcastTimes.clear()
  }

  public disconnectAll(): void {
    for (const clientId of this.clients.keys()) {
      this.removeClient(clientId)
    }
  }
}

export function createGridStatePusher(
  options?: PusherOptions,
): GridStatePusher {
  return new GridStatePusher(options)
}
