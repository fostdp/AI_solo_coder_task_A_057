import { useEffect, useRef, useCallback } from 'react'
import { useSensorStore, type SensorConfig, type CapacityData, type Alarm } from '../store/index.js'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001'

interface WebSocketMessage {
  type: string
  [key: string]: unknown
}

interface InitialDataMessage extends WebSocketMessage {
  sensors: SensorConfig[]
  sensorData: Array<{ id: string; value: number; timestamp: string }>
  capacity: CapacityData | null
}

interface SensorDataMessage extends WebSocketMessage {
  sensors: Array<{
    id: string
    type: 'temperature' | 'wind' | 'solar'
    value: number
    timestamp: string
  }>
}

interface CapacityMessage extends WebSocketMessage {
  data: CapacityData
}

interface AlarmMessage extends WebSocketMessage {
  alarm: Alarm
}

interface HistoryResponseMessage extends WebSocketMessage {
  sensorId: string
  data: Array<{ timestamp: string; value: number }>
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const {
    setSensors,
    updateSensorData,
    setCapacity,
    addAlarm,
    setHistoryData,
    setConnected,
  } = useSensorStore()

  const connect = useCallback(() => {
    const ws = new WebSocket(WS_URL + '/ws')

    ws.onopen = () => {
      console.log('WebSocket connected')
      setConnected(true)
    }

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WebSocketMessage
        handleMessage(message)
      } catch (err) {
        console.error('Error parsing WebSocket message:', err)
      }
    }

    ws.onclose = () => {
      console.log('WebSocket disconnected')
      setConnected(false)
      setTimeout(() => {
        connect()
      }, 3000)
    }

    ws.onerror = (err) => {
      console.error('WebSocket error:', err)
    }

    wsRef.current = ws
  }, [setConnected])

  const handleMessage = useCallback(
    (message: WebSocketMessage) => {
      switch (message.type) {
        case 'initial_data': {
          const { sensors = [], sensorData = [], capacity } =
            message as InitialDataMessage
          setSensors(sensors)
          updateSensorData(sensorData.map(d => ({ id: d.id, value: d.value, timestamp: d.timestamp })))
          if (capacity) {
            setCapacity(capacity)
          }
          break
        }
        case 'sensor_data': {
          const { sensors = [] } = message as SensorDataMessage
          const validSensors = sensors.filter(s => s && s.id !== undefined)
          updateSensorData(validSensors.map(s => ({ id: s.id, value: s.value, timestamp: s.timestamp })))
          break
        }
        case 'capacity': {
          const { data } = message as CapacityMessage
          if (data) {
            setCapacity(data)
          }
          break
        }
        case 'alarm': {
          const { alarm } = message as AlarmMessage
          if (alarm) {
            addAlarm(alarm)
          }
          break
        }
        case 'history_response': {
          const { sensorId, data = [] } = message as HistoryResponseMessage
          if (sensorId) {
            setHistoryData(sensorId, data)
          }
          break
        }
      }
    },
    [setSensors, updateSensorData, setCapacity, addAlarm, setHistoryData]
  )

  const sendMessage = useCallback((message: WebSocketMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    }
  }, [])

  const requestHistory = useCallback(
    (sensorId: string, hours: number = 1) => {
      sendMessage({ type: 'history_request', sensorId, hours })
    },
    [sendMessage]
  )

  useEffect(() => {
    connect()

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [connect])

  return {
    sendMessage,
    requestHistory,
  }
}
