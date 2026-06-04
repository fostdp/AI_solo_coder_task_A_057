import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useSensorStore } from '../store/index.js'
import { LINE_CORRIDOR_CONFIG, getSegmentAtKm, type TowerConfig } from '../../config/line-corridor.js'

interface MapPoint {
  x: number
  y: number
  sensorId: string
}

interface TowerMapPoint {
  x: number
  y: number
  tower: TowerConfig
}

export function LineCorridorMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const animationRef = useRef<number>(0)
  const [hoveredSensor, setHoveredSensor] = useState<string | null>(null)

  const {
    sensors,
    sensorData,
    selectedSensor,
    setSelectedSensor,
    getSensorById,
    getSensorData,
    getTemperatureColor,
    hasAlarm,
  } = useSensorStore()

  const mapPointsRef = useRef<MapPoint[]>([])
  const towerPointsRef = useRef<TowerMapPoint[]>([])
  const scaleRef = useRef({ offsetX: 0, offsetY: 0, scale: 1, minLng: 0, maxLat: 0, maxLng: 0 })

  const corridorConfig = useMemo(() => LINE_CORRIDOR_CONFIG, [])

  const calculateMapPoints = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const padding = 60
    const width = canvas.width - padding * 2
    const height = canvas.height - padding * 2

    const { boundingBox, towers } = corridorConfig
    const maxLat = boundingBox.maxLat
    const minLng = boundingBox.minLng
    const maxLng = boundingBox.maxLng
    const minLat = boundingBox.minLat

    const latRange = maxLat - minLat || 1
    const lngRange = maxLng - minLng || 1

    const scaleX = width / lngRange
    const scaleY = height / latRange
    const scale = Math.min(scaleX, scaleY)

    const offsetX = padding + (width - lngRange * scale) / 2
    const offsetY = padding + (height - latRange * scale) / 2

    scaleRef.current = { offsetX, offsetY, scale, minLng, maxLat, maxLng }

    const towerPoints: TowerMapPoint[] = towers.map((tower) => ({
      x: offsetX + (tower.longitude - minLng) * scale,
      y: offsetY + (maxLat - tower.latitude) * scale,
      tower,
    }))
    towerPointsRef.current = towerPoints

    const points: MapPoint[] = sensors.map((sensor) => ({
      x: offsetX + (sensor.longitude - minLng) * scale,
      y: offsetY + (maxLat - sensor.latitude) * scale,
      sensorId: sensor.id,
    }))
    mapPointsRef.current = points
  }, [sensors, corridorConfig])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { offsetX, offsetY, scale, minLng, maxLat } = scaleRef.current
    const { towers, segments } = corridorConfig
    const time = Date.now() / 1000

    ctx.fillStyle = '#0a1628'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    ctx.strokeStyle = 'rgba(0, 212, 255, 0.06)'
    ctx.lineWidth = 1
    for (let x = 0; x < canvas.width; x += 50) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, canvas.height)
      ctx.stroke()
    }
    for (let y = 0; y < canvas.height; y += 50) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(canvas.width, y)
      ctx.stroke()
    }

    if (towers.length > 1) {
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.15)'
      ctx.lineWidth = 16
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      towers.forEach((tower, idx) => {
        const x = offsetX + (tower.longitude - minLng) * scale
        const y = offsetY + (maxLat - tower.latitude) * scale
        if (idx === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]
        const fromTower = towers.find((t) => t.id === segment.fromTower)
        const toTower = towers.find((t) => t.id === segment.toTower)
        if (!fromTower || !toTower) continue

        const x1 = offsetX + (fromTower.longitude - minLng) * scale
        const y1 = offsetY + (maxLat - fromTower.latitude) * scale
        const x2 = offsetX + (toTower.longitude - minLng) * scale
        const y2 = offsetY + (maxLat - toTower.latitude) * scale

        const midKm = (fromTower.km + toTower.km) / 2
        const tempSensors = useSensorStore
          .getState()
          .sensors.filter(
            (s) =>
              s.type === 'temperature' &&
              Math.abs(s.linePositionKm - midKm) < 5,
          )

        let avgTemp = 45
        if (tempSensors.length > 0) {
          const vals = tempSensors
            .map((s) => {
              const d = sensorData.get(s.id)
              return d?.value || 0
            })
            .filter((v) => v > 0)
          if (vals.length > 0) avgTemp = vals.reduce((a, b) => a + b, 0) / vals.length
        }

        const maxTemp = segment.maxAllowedTemp || 70
        const ratio = avgTemp / maxTemp

        let segColor: string
        if (ratio < 0.8) segColor = 'rgba(46, 213, 115, 0.6)'
        else if (ratio < 0.95) segColor = 'rgba(255, 165, 2, 0.7)'
        else segColor = 'rgba(255, 71, 87, 0.8)'

        ctx.strokeStyle = segColor
        ctx.lineWidth = 4
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()
      }

      const particleCount = 5
      for (let i = 0; i < particleCount; i++) {
        const t = ((time * 0.1 + i / particleCount) % 1)
        const idx = Math.floor(t * (towers.length - 1))
        const nextIdx = Math.min(idx + 1, towers.length - 1)
        const localT = (t * (towers.length - 1)) % 1

        const t1 = towers[idx]
        const t2 = towers[nextIdx]

        const x1 = offsetX + (t1.longitude - minLng) * scale
        const y1 = offsetY + (maxLat - t1.latitude) * scale
        const x2 = offsetX + (t2.longitude - minLng) * scale
        const y2 = offsetY + (maxLat - t2.latitude) * scale

        const px = x1 + (x2 - x1) * localT
        const py = y1 + (y2 - y1) * localT

        const particleGradient = ctx.createRadialGradient(px, py, 0, px, py, 8)
        particleGradient.addColorStop(0, 'rgba(0, 255, 200, 1)')
        particleGradient.addColorStop(0.5, 'rgba(0, 212, 255, 0.5)')
        particleGradient.addColorStop(1, 'rgba(0, 212, 255, 0)')

        ctx.fillStyle = particleGradient
        ctx.beginPath()
        ctx.arc(px, py, 8, 0, Math.PI * 2)
        ctx.fill()
      }

      towerPointsRef.current.forEach((tp) => {
        const { tower } = tp
        const isMajor = tower.towerType !== 'tangent'

        ctx.strokeStyle = 'rgba(0, 212, 255, 0.3)'
        ctx.fillStyle = isMajor ? 'rgba(0, 212, 255, 0.3)' : 'rgba(0, 212, 255, 0.15)'
        ctx.lineWidth = 1.5

        ctx.beginPath()
        ctx.moveTo(tp.x, tp.y - 12)
        ctx.lineTo(tp.x - 6, tp.y + 6)
        ctx.lineTo(tp.x + 6, tp.y + 6)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()

        if (isMajor) {
          ctx.fillStyle = 'rgba(0, 212, 255, 0.7)'
          ctx.font = '9px "JetBrains Mono", monospace'
          ctx.textAlign = 'center'
          ctx.fillText(tower.id, tp.x, tp.y - 14)
          ctx.textAlign = 'left'
        }
      })

      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'
      ctx.font = '10px "JetBrains Mono", monospace'
      ctx.textAlign = 'center'
      const kmMarkers = [0, 50, 100, 150, 200]
      kmMarkers.forEach((km) => {
        const towerAtKm = towers.reduce((best, t) =>
          Math.abs(t.km - km) < Math.abs(best.km - km) ? t : best,
        )
        const x = offsetX + (towerAtKm.longitude - minLng) * scale
        const y = offsetY + (maxLat - towerAtKm.latitude) * scale

        ctx.strokeStyle = 'rgba(0, 212, 255, 0.15)'
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(x, y + 10)
        ctx.lineTo(x, y + 20)
        ctx.stroke()
        ctx.setLineDash([])

        ctx.fillText(`${km}km`, x, y + 30)
      })
      ctx.textAlign = 'left'
    }

    mapPointsRef.current.forEach((point) => {
      const sensor = getSensorById(point.sensorId)
      const data = getSensorData(point.sensorId)
      if (!sensor) return

      const isHovered = hoveredSensor === point.sensorId
      const isSelected = selectedSensor === point.sensorId
      const alarm = hasAlarm(point.sensorId)

      let markerColor = '#00d4ff'
      let size = 6

      if (sensor.type === 'temperature') {
        const maxTemp = sensor.maxAllowedTemp || 70
        const value = data?.value || 0
        markerColor = getTemperatureColor(value, maxTemp)
        size = 7
      } else if (sensor.type === 'wind') {
        markerColor = '#3498db'
        size = 5
      } else if (sensor.type === 'solar') {
        markerColor = '#f39c12'
        size = 5
      }

      if (alarm) {
        const pulse = (Math.sin(time * 4) + 1) / 2
        const pulseSize = size + 6 + pulse * 4

        const alarmGradient = ctx.createRadialGradient(
          point.x,
          point.y,
          0,
          point.x,
          point.y,
          pulseSize,
        )
        alarmGradient.addColorStop(0, 'rgba(255, 71, 87, 0.8)')
        alarmGradient.addColorStop(0.5, 'rgba(255, 71, 87, 0.3)')
        alarmGradient.addColorStop(1, 'rgba(255, 71, 87, 0)')

        ctx.fillStyle = alarmGradient
        ctx.beginPath()
        ctx.arc(point.x, point.y, pulseSize, 0, Math.PI * 2)
        ctx.fill()
      }

      if (isHovered || isSelected) {
        const glowSize = size + 12
        const glowGradient = ctx.createRadialGradient(
          point.x,
          point.y,
          0,
          point.x,
          point.y,
          glowSize,
        )
        glowGradient.addColorStop(0, 'rgba(0, 212, 255, 0.6)')
        glowGradient.addColorStop(0.5, 'rgba(0, 212, 255, 0.2)')
        glowGradient.addColorStop(1, 'rgba(0, 212, 255, 0)')

        ctx.fillStyle = glowGradient
        ctx.beginPath()
        ctx.arc(point.x, point.y, glowSize, 0, Math.PI * 2)
        ctx.fill()
      }

      const breathe = (Math.sin(time * 2 + point.sensorId.charCodeAt(0)) + 1) / 2
      const currentSize = size + breathe * 2

      ctx.fillStyle = markerColor
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2

      if (sensor.type === 'temperature') {
        ctx.beginPath()
        ctx.arc(point.x, point.y, currentSize, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      } else if (sensor.type === 'wind') {
        ctx.beginPath()
        ctx.moveTo(point.x, point.y - currentSize)
        ctx.lineTo(point.x + currentSize, point.y)
        ctx.lineTo(point.x, point.y + currentSize)
        ctx.lineTo(point.x - currentSize, point.y)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      } else if (sensor.type === 'solar') {
        ctx.beginPath()
        for (let i = 0; i < 6; i++) {
          const angle = (i / 6) * Math.PI * 2 - Math.PI / 2
          const r = i % 2 === 0 ? currentSize : currentSize * 0.5
          const x = point.x + Math.cos(angle) * r
          const y = point.y + Math.sin(angle) * r
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }

      if (isSelected) {
        ctx.strokeStyle = '#00d4ff'
        ctx.lineWidth = 3
        ctx.setLineDash([5, 5])
        ctx.beginPath()
        ctx.arc(point.x, point.y, currentSize + 8, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
      }

      if (isHovered && data) {
        ctx.fillStyle = 'rgba(0, 22, 40, 0.95)'
        ctx.strokeStyle = '#00d4ff'
        ctx.lineWidth = 1

        const unit = sensor.type === 'temperature' ? '°C' : sensor.type === 'wind' ? 'm/s' : 'W/m²'
        const text = `${sensor.id}: ${data.value.toFixed(1)} ${unit}`
        ctx.font = '12px "JetBrains Mono", monospace'
        const textWidth = ctx.measureText(text).width
        const boxWidth = textWidth + 20
        const boxHeight = 28

        const boxX = point.x + 15
        const boxY = point.y - boxHeight / 2

        ctx.beginPath()
        ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 4)
        ctx.fill()
        ctx.stroke()

        ctx.fillStyle = '#00d4ff'
        ctx.fillText(text, boxX + 10, boxY + 18)
      }
    })

    const { boundingBox } = corridorConfig
    const lngRange = boundingBox.maxLng - boundingBox.minLng
    const latRange = boundingBox.maxLat - boundingBox.minLat

    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
    ctx.font = '11px "Noto Sans SC", sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('起点 (0km)', offsetX - 10, offsetY + latRange * scale + 30)
    ctx.fillText('终点 (200km)', offsetX + lngRange * scale + 10, offsetY + latRange * scale + 30)
    ctx.textAlign = 'left'

    const legendX = canvas.width - 180
    const legendY = 20
    ctx.fillStyle = 'rgba(0, 22, 40, 0.9)'
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.3)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(legendX, legendY, 160, 145, 8)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 12px "Noto Sans SC", sans-serif'
    ctx.fillText(corridorConfig.lineName, legendX + 15, legendY + 25)
    ctx.font = '11px "Noto Sans SC", sans-serif'
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
    ctx.fillText(`${corridorConfig.voltageLevel} · ${segments.length} 段`, legendX + 15, legendY + 42)

    const items = [
      { color: '#2ed573', label: '< 80% 安全' },
      { color: '#ffa502', label: '80%-95% 预警' },
      { color: '#ff4757', label: '> 95% 告警' },
      { color: '#3498db', label: '风速传感器' },
      { color: '#f39c12', label: '日照传感器' },
    ]

    items.forEach((item, idx) => {
      const y = legendY + 65 + idx * 18
      ctx.fillStyle = item.color
      ctx.beginPath()
      ctx.arc(legendX + 25, y, 5, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
      ctx.font = '11px "Noto Sans SC", sans-serif'
      ctx.fillText(item.label, legendX + 40, y + 4)
    })

    animationRef.current = requestAnimationFrame(draw)
  }, [
    sensors,
    hoveredSensor,
    selectedSensor,
    sensorData,
    getSensorById,
    getSensorData,
    getTemperatureColor,
    hasAlarm,
    corridorConfig,
  ])

  const handleResize = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const dpr = window.devicePixelRatio || 1
    const rect = container.getBoundingClientRect()

    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.style.width = rect.width + 'px'
    canvas.style.height = rect.height + 'px'

    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.scale(dpr, dpr)
    }

    calculateMapPoints()
  }, [calculateMapPoints])

  const findSensorAtPoint = useCallback(
    (x: number, y: number): string | null => {
      for (const point of mapPointsRef.current) {
        const dist = Math.sqrt((point.x - x) ** 2 + (point.y - y) ** 2)
        if (dist < 15) {
          return point.sensorId
        }
      }
      return null
    },
    [],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      const sensorId = findSensorAtPoint(x, y)
      setHoveredSensor(sensorId)

      if (sensorId) {
        canvas.style.cursor = 'pointer'
      } else {
        canvas.style.cursor = 'default'
      }
    },
    [findSensorAtPoint],
  )

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      const sensorId = findSensorAtPoint(x, y)
      if (sensorId) {
        setSelectedSensor(selectedSensor === sensorId ? null : sensorId)
      } else {
        setSelectedSensor(null)
      }
    },
    [findSensorAtPoint, selectedSensor, setSelectedSensor],
  )

  useEffect(() => {
    handleResize()
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [handleResize])

  useEffect(() => {
    calculateMapPoints()
  }, [sensors, calculateMapPoints])

  useEffect(() => {
    animationRef.current = requestAnimationFrame(draw)
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [draw])

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        onMouseMove={handleMouseMove}
        onClick={handleClick}
      />
    </div>
  )
}
