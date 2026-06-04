import { create } from 'zustand'

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

export interface SensorData {
  id: string
  value: number
  timestamp: string
}

export interface CapacityData {
  dynamicCapacity: number
  staticCapacity: number
  marginPercent: number
  timestamp: string
}

export interface Alarm {
  id: number
  sensorId: string
  alarmType: 'overheat' | 'galloping' | 'offline'
  level: 'warning' | 'critical'
  message: string
  startedAt: string
  isActive: boolean
}

interface SensorState {
  sensors: SensorConfig[]
  sensorData: Map<string, SensorData>
  capacity: CapacityData | null
  alarms: Alarm[]
  selectedSensor: string | null
  historyData: Map<string, Array<{ timestamp: string; value: number }>>
  isConnected: boolean
}

interface SensorActions {
  setSensors: (sensors: SensorConfig[]) => void
  updateSensorData: (data: SensorData[]) => void
  setCapacity: (capacity: CapacityData) => void
  addAlarm: (alarm: Alarm) => void
  setSelectedSensor: (id: string | null) => void
  setHistoryData: (sensorId: string, data: Array<{ timestamp: string; value: number }>) => void
  setConnected: (connected: boolean) => void
  getSensorById: (id: string) => SensorConfig | undefined
  getSensorData: (id: string) => SensorData | undefined
  getTemperatureColor: (value: number, maxTemp: number) => string
  hasAlarm: (sensorId: string) => Alarm | undefined
  getNearestSensorByType: (km: number, type: 'temperature' | 'wind' | 'solar') => SensorConfig | undefined
}

export type SensorStore = SensorState & SensorActions

export const useSensorStore = create<SensorStore>((set, get) => ({
  sensors: [],
  sensorData: new Map(),
  capacity: null,
  alarms: [],
  selectedSensor: null,
  historyData: new Map(),
  isConnected: false,

  setSensors: (sensors) => set({ sensors }),

  updateSensorData: (data) => {
    set((state) => {
      const newMap = new Map(state.sensorData)
      data.forEach((d) => {
        newMap.set(d.id, d)
      })
      return { sensorData: newMap }
    })
  },

  setCapacity: (capacity) => set({ capacity }),

  addAlarm: (alarm) => {
    set((state) => ({
      alarms: [alarm, ...state.alarms.filter((a) => a.id !== alarm.id)].slice(0, 100),
    }))
  },

  setSelectedSensor: (id) => set({ selectedSensor: id }),

  setHistoryData: (sensorId, data) => {
    set((state) => {
      const newMap = new Map(state.historyData)
      newMap.set(sensorId, data)
      return { historyData: newMap }
    })
  },

  setConnected: (connected) => set({ isConnected: connected }),

  getSensorById: (id) => get().sensors.find((s) => s.id === id),

  getSensorData: (id) => get().sensorData.get(id),

  getTemperatureColor: (value, maxTemp) => {
    const ratio = value / maxTemp
    if (ratio < 0.8) return '#2ed573'
    if (ratio < 0.95) return '#ffa502'
    return '#ff4757'
  },

  hasAlarm: (sensorId) => {
    return get().alarms.find((a) => a.sensorId === sensorId && a.isActive)
  },

  getNearestSensorByType: (km, type) => {
    const sensors = get().sensors.filter((s) => s.type === type)
    if (sensors.length === 0) return undefined
    return sensors.reduce((nearest, s) => {
      const dist = Math.abs(s.linePositionKm - km)
      const nearestDist = Math.abs(nearest.linePositionKm - km)
      return dist < nearestDist ? s : nearest
    })
  },
}))
