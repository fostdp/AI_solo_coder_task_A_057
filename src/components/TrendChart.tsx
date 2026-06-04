import { useEffect, useRef, useCallback } from 'react'

interface TrendData {
  timestamp: string
  value: number
}

interface TrendChartProps {
  data: TrendData[]
  color: string
  label: string
  unit: string
  minY?: number
  maxY?: number
}

export function TrendChart({
  data,
  color,
  label,
  unit,
  minY,
  maxY,
}: TrendChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const animationRef = useRef<number>(0)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

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

    ctx.fillStyle = '#0a1628'
    ctx.fillRect(0, 0, width, height)

    ctx.strokeStyle = 'rgba(0, 212, 255, 0.1)'
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartHeight / 4) * i
      ctx.beginPath()
      ctx.moveTo(padding.left, y)
      ctx.lineTo(width - padding.right, y)
      ctx.stroke()
    }

    ctx.strokeStyle = 'rgba(0, 212, 255, 0.3)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(padding.left, padding.top)
    ctx.lineTo(padding.left, height - padding.bottom)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(padding.left, height - padding.bottom)
    ctx.lineTo(width - padding.right, height - padding.bottom)
    ctx.stroke()

    if (data.length < 2) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
      ctx.font = '14px "Noto Sans SC", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('暂无数据', width / 2, height / 2)
      return
    }

    const values = data.map((d) => d.value)
    const dataMin = Math.min(...values)
    const dataMax = Math.max(...values)
    const yMin = minY !== undefined ? minY : dataMin - (dataMax - dataMin) * 0.1
    const yMax = maxY !== undefined ? maxY : dataMax + (dataMax - dataMin) * 0.1
    const yRange = yMax - yMin || 1

    const xScale = chartWidth / (data.length - 1)
    const yScale = chartHeight / yRange

    const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom)
    gradient.addColorStop(0, color + '40')
    gradient.addColorStop(1, color + '00')

    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.moveTo(padding.left, height - padding.bottom)
    data.forEach((d, i) => {
      const x = padding.left + i * xScale
      const y = padding.top + (yMax - d.value) * yScale
      if (i === 0) {
        ctx.lineTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    })
    ctx.lineTo(padding.left + (data.length - 1) * xScale, height - padding.bottom)
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = color
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    data.forEach((d, i) => {
      const x = padding.left + i * xScale
      const y = padding.top + (yMax - d.value) * yScale
      if (i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    })
    ctx.stroke()

    const lastPoint = data[data.length - 1]
    const lastX = padding.left + (data.length - 1) * xScale
    const lastY = padding.top + (yMax - lastPoint.value) * yScale

    const glowGradient = ctx.createRadialGradient(lastX, lastY, 0, lastX, lastY, 12)
    glowGradient.addColorStop(0, color)
    glowGradient.addColorStop(0.5, color + '60')
    glowGradient.addColorStop(1, color + '00')

    ctx.fillStyle = glowGradient
    ctx.beginPath()
    ctx.arc(lastX, lastY, 12, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = color
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(lastX, lastY, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
    ctx.font = '11px "JetBrains Mono", monospace'
    ctx.textAlign = 'right'
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartHeight / 4) * i
      const value = yMax - (yRange / 4) * i
      ctx.fillText(value.toFixed(1), padding.left - 8, y + 4)
    }

    ctx.textAlign = 'center'
    const timeStep = Math.max(1, Math.floor(data.length / 6))
    for (let i = 0; i < data.length; i += timeStep) {
      const x = padding.left + i * xScale
      const time = new Date(data[i].timestamp)
      const timeStr = time.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      })
      ctx.fillText(timeStr, x, height - padding.bottom + 20)
    }

    ctx.fillStyle = color
    ctx.font = 'bold 12px "Noto Sans SC", sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(label, padding.left, 12)

    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 16px "JetBrains Mono", monospace'
    ctx.textAlign = 'right'
    ctx.fillText(`${lastPoint.value.toFixed(2)} ${unit}`, width - padding.right, 12)

    animationRef.current = requestAnimationFrame(draw)
  }, [data, color, label, unit, minY, maxY])

  useEffect(() => {
    const handleResize = () => {
      draw()
    }
    window.addEventListener('resize', handleResize)

    animationRef.current = requestAnimationFrame(draw)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [draw])

  return (
    <div ref={containerRef} className="w-full h-full">
      <canvas ref={canvasRef} />
    </div>
  )
}
