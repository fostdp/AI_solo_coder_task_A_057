import { useEffect, useRef, useCallback } from 'react'
import { Zap, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { useSensorStore } from '../store/index.js'

export function CapacityPanel() {
  const { capacity, sensors = [], sensorData, getSensorData } = useSensorStore()

  const tempSensors = sensors.filter((s) => s.type === 'temperature')
  const windSensors = sensors.filter((s) => s.type === 'wind')
  const solarSensors = sensors.filter((s) => s.type === 'solar')

  const getAvgValue = (sensorIds: string[]) => {
    const values = sensorIds
      .map((id) => getSensorData(id)?.value)
      .filter((v): v is number => v !== undefined)
    return values.length > 0
      ? values.reduce((a, b) => a + b, 0) / values.length
      : 0
  }

  const avgTemp = getAvgValue(tempSensors.map((s) => s.id))
  const avgWind = getAvgValue(windSensors.map((s) => s.id))
  const avgSolar = getAvgValue(solarSensors.map((s) => s.id))

  const onlineCount = Array.from(sensorData.keys()).length
  const totalSensors = sensors.length

  const onlineRate = totalSensors > 0 ? ((onlineCount / totalSensors) * 100).toFixed(1) : '0.0'

  return (
    <div className="absolute bottom-4 left-4 right-4 flex gap-4 z-10">
      <div className="flex-1 bg-[#0a1628]/90 backdrop-blur-md border border-[#00d4ff]/30 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 rounded-lg bg-[#00d4ff]/20">
            <Zap className="w-5 h-5 text-[#00d4ff]" />
          </div>
          <div>
            <h3 className="text-white font-bold">动态载流量监测</h3>
            <p className="text-gray-400 text-xs">实时气象条件计算</p>
          </div>
        </div>

        {capacity && (
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-gray-400 text-xs mb-1">静态载流量</p>
              <p className="text-2xl font-bold text-white font-mono">
                {capacity.staticCapacity}
                <span className="text-sm text-gray-400 ml-1">A</span>
              </p>
              <div className="h-1 bg-gray-700 rounded-full mt-2">
                <div
                  className="h-full bg-gray-500 rounded-full"
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div className="text-center">
              <p className="text-gray-400 text-xs mb-1">动态载流量</p>
              <p
                className="text-2xl font-bold font-mono"
                style={{
                  color:
                    capacity.marginPercent > 0 ? '#2ed573' : '#ff4757',
                }}
              >
                {capacity.dynamicCapacity}
                <span className="text-sm text-gray-400 ml-1">A</span>
              </p>
              <div className="h-1 bg-gray-700 rounded-full mt-2">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(
                      (capacity.dynamicCapacity / capacity.staticCapacity) * 100,
                      150
                    )}%`,
                    backgroundColor:
                      capacity.marginPercent > 0 ? '#2ed573' : '#ff4757',
                  }}
                />
              </div>
            </div>

            <div className="text-center">
              <p className="text-gray-400 text-xs mb-1">增容裕度</p>
              <div className="flex items-center justify-center gap-1">
                {capacity.marginPercent > 0 ? (
                  <TrendingUp className="w-5 h-5 text-green-400" />
                ) : capacity.marginPercent < 0 ? (
                  <TrendingDown className="w-5 h-5 text-red-400" />
                ) : (
                  <Minus className="w-5 h-5 text-gray-400" />
                )}
                <span
                  className="text-2xl font-bold font-mono"
                  style={{
                    color:
                      capacity.marginPercent > 0
                        ? '#2ed573'
                        : capacity.marginPercent < 0
                        ? '#ff4757'
                        : '#ffffff',
                  }}
                >
                  {capacity.marginPercent > 0 ? '+' : ''}
                  {capacity.marginPercent}%
                </span>
              </div>
              <p className="text-xs mt-2">
                <span className="text-[#00d4ff] font-medium">
                  {capacity.marginPercent > 0 ? '可增容' : '需降容'}
                </span>
                <span className="text-gray-400 ml-1">
                  {Math.abs(capacity.dynamicCapacity - capacity.staticCapacity)} A
                </span>
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="w-72 bg-[#0a1628]/90 backdrop-blur-md border border-[#00d4ff]/30 rounded-xl p-4">
        <h3 className="text-white font-bold mb-3">关键指标</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-gray-400 text-sm">最高温度</span>
            <span className="text-red-400 font-mono font-bold">
              {avgTemp.toFixed(1)}°C
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-400 text-sm">平均风速</span>
            <span className="text-blue-400 font-mono font-bold">
              {avgWind.toFixed(1)} m/s
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-400 text-sm">平均日照</span>
            <span className="text-yellow-400 font-mono font-bold">
              {avgSolar.toFixed(0)} W/m²
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-400 text-sm">在线传感器</span>
            <span className="text-green-400 font-mono font-bold">
              {onlineCount} / {totalSensors}
            </span>
          </div>
          <div className="pt-2 border-t border-white/10">
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full transition-all duration-500"
                style={{
                  width: `${totalSensors > 0 ? (onlineCount / totalSensors) * 100 : 0}%`,
                }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1 text-center">
              在线率 {onlineRate}%
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export function CapacityComparisonChart() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { capacity } = useSensorStore()

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !capacity) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = container.getBoundingClientRect()

    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = rect.width + 'px'
    canvas.style.height = rect.height + 'px'
    ctx.scale(dpr, dpr)

    const width = rect.width
    const height = rect.height
    const padding = { top: 20, right: 20, bottom: 30, left: 50 }
    const chartWidth = width - padding.left - padding.right
    const chartHeight = height - padding.top - padding.bottom

    ctx.fillStyle = 'transparent'
    ctx.fillRect(0, 0, width, height)

    const maxValue = Math.max(capacity.dynamicCapacity, capacity.staticCapacity) * 1.2

    const barWidth = chartWidth * 0.3
    const staticX = padding.left + chartWidth * 0.2
    const dynamicX = padding.left + chartWidth * 0.6

    const staticHeight = (capacity.staticCapacity / maxValue) * chartHeight
    const dynamicHeight = (capacity.dynamicCapacity / maxValue) * chartHeight

    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'
    ctx.fillRect(staticX, height - padding.bottom - staticHeight, barWidth, staticHeight)
    ctx.fillStyle = capacity.marginPercent > 0 ? 'rgba(46, 213, 115, 0.3)' : 'rgba(255, 71, 87, 0.3)'
    ctx.fillRect(dynamicX, height - padding.bottom - dynamicHeight, barWidth, dynamicHeight)

    const staticGradient = ctx.createLinearGradient(
      staticX,
      height - padding.bottom,
      staticX,
      height - padding.bottom - staticHeight
    )
    staticGradient.addColorStop(0, '#64748b')
    staticGradient.addColorStop(1, '#94a3b8')

    const dynamicGradient = ctx.createLinearGradient(
      dynamicX,
      height - padding.bottom,
      dynamicX,
      height - padding.bottom - dynamicHeight
    )
    dynamicGradient.addColorStop(
      0,
      capacity.marginPercent > 0 ? '#2ed573' : '#ff4757'
    )
    dynamicGradient.addColorStop(
      1,
      capacity.marginPercent > 0 ? '#4ade80' : '#f87171'
    )

    ctx.fillStyle = staticGradient
    ctx.fillRect(staticX, height - padding.bottom - staticHeight, barWidth, staticHeight)

    ctx.fillStyle = dynamicGradient
    ctx.fillRect(dynamicX, height - padding.bottom - dynamicHeight, barWidth, dynamicHeight)

    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 14px "JetBrains Mono", monospace'
    ctx.textAlign = 'center'
    ctx.fillText(
      `${capacity.staticCapacity} A`,
      staticX + barWidth / 2,
      height - padding.bottom - staticHeight - 8
    )
    ctx.fillText(
      `${capacity.dynamicCapacity} A`,
      dynamicX + barWidth / 2,
      height - padding.bottom - dynamicHeight - 8
    )

    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
    ctx.font = '12px "Noto Sans SC", sans-serif'
    ctx.fillText('静态载流量', staticX + barWidth / 2, height - padding.bottom + 20)
    ctx.fillText('动态载流量', dynamicX + barWidth / 2, height - padding.bottom + 20)

    if (capacity.marginPercent !== 0) {
      const arrowY = Math.min(
        height - padding.bottom - staticHeight,
        height - padding.bottom - dynamicHeight
      ) - 20

      ctx.strokeStyle = capacity.marginPercent > 0 ? '#2ed573' : '#ff4757'
      ctx.lineWidth = 2
      ctx.setLineDash([5, 5])
      ctx.beginPath()
      ctx.moveTo(staticX + barWidth / 2, height - padding.bottom - staticHeight - 15)
      ctx.lineTo(staticX + barWidth / 2, arrowY)
      ctx.lineTo(dynamicX + barWidth / 2, arrowY)
      ctx.lineTo(dynamicX + barWidth / 2, height - padding.bottom - dynamicHeight - 15)
      ctx.stroke()
      ctx.setLineDash([])

      ctx.fillStyle = capacity.marginPercent > 0 ? '#2ed573' : '#ff4757'
      ctx.font = 'bold 12px "JetBrains Mono", monospace'
      ctx.fillText(
        `${capacity.marginPercent > 0 ? '+' : ''}${capacity.marginPercent}%`,
        (staticX + dynamicX) / 2 + barWidth / 2,
        arrowY - 5
      )
    }
  }, [capacity])

  useEffect(() => {
    const handleResize = () => draw()
    window.addEventListener('resize', handleResize)
    draw()
    return () => window.removeEventListener('resize', handleResize)
  }, [draw])

  if (!capacity) return null

  return (
    <div ref={containerRef} className="w-full h-full">
      <canvas ref={canvasRef} />
    </div>
  )
}
