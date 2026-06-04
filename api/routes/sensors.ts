import express, { type Request, type Response } from 'express'
import { SENSORS, getSensorById, getSensorsByType } from '../../config/sensors.js'
import { getSensorHistory, getLatestSensorData } from '../db.js'
import { getModules } from '../websocket-server.js'

function hasActiveAlarm(sensorId: string): boolean {
  try {
    const { alarmProcessor } = getModules()
    const activeAlarms = alarmProcessor.getActiveAlarms()
    return activeAlarms.some((a) => a.sensorId === sensorId)
  } catch (err) {
    return false
  }
}

const router = express.Router()

router.get('/', (req: Request, res: Response) => {
  const { type } = req.query

  let sensors = SENSORS
  if (type && ['temperature', 'wind', 'solar'].includes(type as string)) {
    sensors = getSensorsByType(type as 'temperature' | 'wind' | 'solar')
  }

  const result = sensors.map(sensor => ({
    ...sensor,
    hasAlarm: hasActiveAlarm(sensor.id),
  }))

  res.json({
    success: true,
    data: result,
  })
})

router.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params
  const sensor = getSensorById(id)

  if (!sensor) {
    return res.status(404).json({
      success: false,
      error: 'Sensor not found',
    })
  }

  res.json({
    success: true,
    data: {
      ...sensor,
      hasAlarm: hasActiveAlarm(sensor.id),
    },
  })
})

router.get('/:id/history', async (req: Request, res: Response) => {
  const { id } = req.params
  const { hours = '1' } = req.query

  const sensor = getSensorById(id)
  if (!sensor) {
    return res.status(404).json({
      success: false,
      error: 'Sensor not found',
    })
  }

  try {
    const history = await getSensorHistory(id, Number(hours))
    res.json({
      success: true,
      data: {
        sensorId: id,
        type: sensor.type,
        history,
      },
    })
  } catch (err) {
    console.error('Error fetching sensor history:', err)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sensor history',
    })
  }
})

router.get('/latest/data', async (req: Request, res: Response) => {
  const { ids } = req.query
  let sensorIds: string[] | undefined

  if (ids && typeof ids === 'string') {
    sensorIds = ids.split(',')
  }

  try {
    const data = await getLatestSensorData(sensorIds)
    res.json({
      success: true,
      data,
    })
  } catch (err) {
    console.error('Error fetching latest sensor data:', err)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch latest sensor data',
    })
  }
})

router.get('/:id/latest', async (req: Request, res: Response) => {
  const { id } = req.params

  const sensor = getSensorById(id)
  if (!sensor) {
    return res.status(404).json({
      success: false,
      error: 'Sensor not found',
    })
  }

  try {
    const data = await getLatestSensorData([id])
    res.json({
      success: true,
      data: data[0] || null,
    })
  } catch (err) {
    console.error('Error fetching latest sensor data:', err)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch latest sensor data',
    })
  }
})

export default router
