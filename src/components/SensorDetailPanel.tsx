import { useEffect, useState, useMemo } from 'react'
import { X, Thermometer, Wind, Sun, MapPin, Clock, AlertTriangle, Zap } from 'lucide-react'
import { useSensorStore } from '../store/index.js'
import { useWebSocket } from '../hooks/useWebSocket.js'
import { TrendChart } from './TrendChart.js'

const TYPE_CONFIG = {
  temperature: { label: '导线温度', unit: '°C', icon: Thermometer, color: '#2ed573' },
  wind: { label: '风速', unit: 'm/s', icon: Wind, color: '#3498db' },
  solar: { label: '日照强度', unit: 'W/m²', icon: Sun, color: '#f39c12' },
} as const

export function SensorDetailPanel() {
  const {
    selectedSensor,
    setSelectedSensor,
    getSensorById,
    getSensorData,
    getNearestSensorByType,
    historyData,
    hasAlarm,
    getTemperatureColor,
    capacity,
  } = useSensorStore()
  const { requestHistory } = useWebSocket()
  const [loading, setLoading] = useState(false)

  const sensor = selectedSensor ? getSensorById(selectedSensor) : null
  const data = selectedSensor ? getSensorData(selectedSensor) : null
  const alarm = selectedSensor ? hasAlarm(selectedSensor) : undefined

  const relatedSensors = useMemo(() => {
    if (!sensor) return null
    const km = sensor.linePositionKm
    return {
      temperature: getNearestSensorByType(km, 'temperature'),
      wind: getNearestSensorByType(km, 'wind'),
      solar: getNearestSensorByType(km, 'solar'),
    }
  }, [sensor, getNearestSensorByType])

  useEffect(() => {
    if (!selectedSensor || !relatedSensors) return
    setLoading(true)
    const ids = [
      relatedSensors.temperature?.id,
      relatedSensors.wind?.id,
      relatedSensors.solar?.id,
    ].filter(Boolean) as string[]

    ids.forEach((id) => {
      if (!historyData.has(id)) {
        requestHistory(id, 1)
      }
    })
    const timer = setTimeout(() => setLoading(false), 800)
    return () => clearTimeout(timer)
  }, [selectedSensor, relatedSensors])

  useEffect(() => {
    if (!relatedSensors) return
    const ids = [
      relatedSensors.temperature?.id,
      relatedSensors.wind?.id,
      relatedSensors.solar?.id,
    ].filter(Boolean) as string[]

    const allLoaded = ids.every((id) => historyData.has(id))
    if (allLoaded) setLoading(false)
  }, [historyData, relatedSensors])

  if (!sensor || !selectedSensor) return null

  const sensorColor =
    sensor.type === 'temperature'
      ? getTemperatureColor(data?.value || 0, sensor.maxAllowedTemp)
      : TYPE_CONFIG[sensor.type].color

  const trendEntries = (['temperature', 'wind', 'solar'] as const).map((type) => {
    const cfg = TYPE_CONFIG[type]
    const related = relatedSensors?.[type]
    const sensorData = related ? getSensorData(related.id) : undefined
    const history = related ? historyData.get(related.id) : undefined
    const isMainSensor = related?.id === selectedSensor
    const trendColor =
      type === 'temperature' && related
        ? getTemperatureColor(sensorData?.value || 0, related.maxAllowedTemp)
        : cfg.color
    return {
      type,
      ...cfg,
      sensorId: related?.id || '',
      sensorData,
      history,
      isMainSensor,
      trendColor,
      maxAllowedTemp: related?.maxAllowedTemp,
    }
  })

  return (
    <div className="absolute top-4 right-4 w-[420px] max-h-[calc(100vh-100px)] bg-[#0a1628]/95 backdrop-blur-md border border-[#00d4ff]/30 rounded-xl shadow-2xl overflow-hidden z-20 overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#00d4ff]/20 bg-gradient-to-r from-[#00d4ff]/10 to-transparent sticky top-0 z-10 bg-[#0a1628]/98">
        <div className="flex items-center gap-3">
          <div
            className="p-2 rounded-lg"
            style={{ backgroundColor: sensorColor + '20', color: sensorColor }}
          >
            {sensor.type === 'temperature' ? (
              <Thermometer className="w-5 h-5" />
            ) : sensor.type === 'wind' ? (
              <Wind className="w-5 h-5" />
            ) : (
              <Sun className="w-5 h-5" />
            )}
          </div>
          <div>
            <h3 className="text-white font-bold text-lg">
              {sensor.id} - {TYPE_CONFIG[sensor.type].label}
            </h3>
            <p className="text-gray-400 text-xs flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {sensor.lineName} · {sensor.linePositionKm} km
            </p>
          </div>
        </div>
        <button
          onClick={() => setSelectedSensor(null)}
          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-gray-400 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {alarm && (
        <div className="px-4 py-2 bg-red-500/20 border-b border-red-500/30 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          <span className="text-red-400 text-sm font-medium">
            {alarm.alarmType === 'overheat'
              ? '过热告警'
              : alarm.alarmType === 'galloping'
              ? '线路舞动告警'
              : '传感器离线'}
          </span>
        </div>
      )}

      <div className="p-4 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {trendEntries.map((entry) => {
            const Icon = entry.icon
            const isActive = entry.sensorId === selectedSensor
            return (
              <div
                key={entry.type}
                className={`bg-white/5 rounded-lg p-3 ${isActive ? 'ring-1 ring-[#00d4ff]/50' : ''}`}
              >
                <div className="flex items-center gap-1 mb-1">
                  <Icon className="w-3.5 h-3.5" style={{ color: entry.trendColor }} />
                  <span className="text-gray-400 text-xs">{entry.label}</span>
                </div>
                <p
                  className="text-xl font-bold font-mono"
                  style={{ color: entry.trendColor }}
                >
                  {entry.sensorData?.value.toFixed(1) || '--'}
                  <span className="text-xs ml-0.5 opacity-70">{entry.unit}</span>
                </p>
              </div>
            )
          })}
        </div>

        {sensor.type === 'temperature' && (
          <div className="bg-white/5 rounded-lg p-3">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-400">温度占比</span>
              <span className="text-white font-mono">
                {data ? ((data.value / sensor.maxAllowedTemp) * 100).toFixed(1) : '--'}%
              </span>
            </div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full transition-all duration-500 rounded-full"
                style={{
                  width: `${Math.min(data ? (data.value / sensor.maxAllowedTemp) * 100 : 0, 120)}%`,
                  backgroundColor: sensorColor,
                }}
              />
            </div>
            <div className="flex justify-between text-xs mt-1">
              <span className="text-green-400">安全 &lt;80%</span>
              <span className="text-yellow-400">预警 80-95%</span>
              <span className="text-red-400">告警 &gt;95%</span>
            </div>
          </div>
        )}

        {capacity && (
          <div className="bg-white/5 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-[#00d4ff]" />
              <span className="text-white text-sm font-semibold">线路载流量</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-gray-400 text-xs">静态</p>
                <p className="text-white font-mono font-bold text-sm">{capacity.staticCapacity}A</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs">动态</p>
                <p
                  className="font-mono font-bold text-sm"
                  style={{ color: capacity.marginPercent > 0 ? '#2ed573' : '#ff4757' }}
                >
                  {capacity.dynamicCapacity}A
                </p>
              </div>
              <div>
                <p className="text-gray-400 text-xs">裕度</p>
                <p
                  className="font-mono font-bold text-sm"
                  style={{ color: capacity.marginPercent > 0 ? '#2ed573' : '#ff4757' }}
                >
                  {capacity.marginPercent > 0 ? '+' : ''}{capacity.marginPercent}%
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <h4 className="text-white font-semibold text-sm flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#00d4ff]" />
            近1小时趋势曲线
          </h4>
          {trendEntries.map((entry) => (
            <div key={entry.type} className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.trendColor }} />
                  <span className="text-gray-300 text-xs">{entry.label}</span>
                  {entry.sensorId && entry.sensorId !== selectedSensor && (
                    <span className="text-gray-500 text-xs">({entry.sensorId})</span>
                  )}
                </div>
                <span className="text-xs font-mono" style={{ color: entry.trendColor }}>
                  {entry.sensorData?.value.toFixed(1) || '--'} {entry.unit}
                </span>
              </div>
              <div className="h-28 bg-[#060e1a] rounded-lg border border-white/5">
                {loading ? (
                  <div className="flex items-center justify-center h-full text-gray-500 text-xs">
                    加载中...
                  </div>
                ) : entry.history && entry.history.length > 0 ? (
                  <TrendChart
                    data={entry.history}
                    color={entry.trendColor}
                    label={entry.label}
                    unit={entry.unit}
                    minY={entry.type === 'temperature' ? 0 : undefined}
                    maxY={
                      entry.type === 'temperature' && entry.maxAllowedTemp
                        ? entry.maxAllowedTemp * 1.2
                        : undefined
                    }
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-600 text-xs">
                    暂无数据
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white/5 rounded-lg p-3 text-xs">
          <p className="text-gray-400 mb-1.5">传感器信息</p>
          <div className="grid grid-cols-2 gap-2 font-mono">
            <div>
              <span className="text-gray-500">ID: </span>
              <span className="text-white">{sensor.id}</span>
            </div>
            <div>
              <span className="text-gray-500">类型: </span>
              <span className="text-white">{TYPE_CONFIG[sensor.type].label}</span>
            </div>
            <div>
              <span className="text-gray-500">纬度: </span>
              <span className="text-white">{sensor.latitude.toFixed(6)}</span>
            </div>
            <div>
              <span className="text-gray-500">经度: </span>
              <span className="text-white">{sensor.longitude.toFixed(6)}</span>
            </div>
            <div>
              <span className="text-gray-500">里程: </span>
              <span className="text-white">{sensor.linePositionKm} km</span>
            </div>
            <div>
              <span className="text-gray-500">状态: </span>
              <span className={sensor.isActive ? 'text-green-400' : 'text-red-400'}>
                {sensor.isActive ? '在线' : '离线'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
