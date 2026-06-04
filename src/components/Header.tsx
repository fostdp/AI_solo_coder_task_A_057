import { Activity, Wifi, WifiOff, Clock, Thermometer, Wind, Sun } from 'lucide-react'
import { useSensorStore } from '../store/index.js'
import { useState, useEffect } from 'react'

export function Header() {
  const { isConnected, sensors = [], sensorData, alarms = [] } = useSensorStore()
  const [currentTime, setCurrentTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const activeAlarms = alarms.filter((a) => a?.isActive).length
  const onlineSensors = Array.from(sensorData.keys()).length
  const totalSensors = sensors.length

  const getMaxValue = (type: string) => {
    const typeSensors = sensors.filter((s) => s.type === type)
    let max = 0
    for (const s of typeSensors) {
      const data = sensorData.get(s.id)
      if (data && data.value > max) max = data.value
    }
    return max
  }

  const maxTemp = getMaxValue('temperature')
  const maxWind = getMaxValue('wind')
  const maxSolar = getMaxValue('solar')

  return (
    <header className="absolute top-0 left-0 right-0 h-16 bg-[#0a1628]/95 backdrop-blur-md border-b border-[#00d4ff]/30 flex items-center justify-between px-6 z-30">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Activity className="w-8 h-8 text-[#00d4ff]" />
            <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full animate-pulse" />
          </div>
          <div>
            <h1 className="text-white font-bold text-lg">电网输电线路动态增容监测系统</h1>
            <p className="text-gray-400 text-xs">200km 主干线 · 180个监测点</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20">
            <Thermometer className="w-4 h-4 text-red-400" />
            <span className="text-gray-400">最高温</span>
            <span className="text-red-400 font-mono font-bold">{maxTemp.toFixed(1)}°C</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <Wind className="w-4 h-4 text-blue-400" />
            <span className="text-gray-400">最大风</span>
            <span className="text-blue-400 font-mono font-bold">{maxWind.toFixed(1)} m/s</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <Sun className="w-4 h-4 text-yellow-400" />
            <span className="text-gray-400">最大日照</span>
            <span className="text-yellow-400 font-mono font-bold">{maxSolar.toFixed(0)} W/m²</span>
          </div>
        </div>

        <div className="h-8 w-px bg-white/10" />

        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            {isConnected ? (
              <>
                <Wifi className="w-4 h-4 text-green-400" />
                <span className="text-green-400">已连接</span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4 text-red-400" />
                <span className="text-red-400">断开</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-white/5">
            <span className="text-gray-400">传感器</span>
            <span className="text-white font-mono font-bold">
              {onlineSensors}/{totalSensors}
            </span>
          </div>

          {activeAlarms > 0 && (
            <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-red-500/20 border border-red-500/30 animate-pulse">
              <span className="text-red-400 font-bold">{activeAlarms}</span>
              <span className="text-red-400">告警</span>
            </div>
          )}
        </div>

        <div className="h-8 w-px bg-white/10" />

        <div className="flex items-center gap-2 text-gray-400">
          <Clock className="w-4 h-4" />
          <span className="font-mono">
            {currentTime.toLocaleString('zh-CN', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
        </div>
      </div>
    </header>
  )
}
