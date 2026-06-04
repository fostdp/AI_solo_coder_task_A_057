import express, { type Request, type Response } from 'express'
import { getActiveAlarms, getAlarmHistory, closeAlarm } from '../db.js'

const router = express.Router()

router.get('/active', async (req: Request, res: Response) => {
  try {
    const alarms = await getActiveAlarms()
    res.json({
      success: true,
      data: alarms.map(alarm => ({
        id: alarm.id,
        sensorId: alarm.sensor_id,
        sensorType: alarm.sensor_type,
        linePositionKm: alarm.line_position_km,
        alarmType: alarm.alarm_type,
        level: alarm.level,
        message: alarm.message,
        startedAt: alarm.started_at?.toISOString(),
        isActive: alarm.is_active,
      })),
    })
  } catch (err) {
    console.error('Error fetching active alarms:', err)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch active alarms',
    })
  }
})

router.get('/history', async (req: Request, res: Response) => {
  const { limit = '100', type } = req.query

  try {
    let alarms = await getAlarmHistory(Number(limit))

    if (type && ['overheat', 'galloping', 'offline'].includes(type as string)) {
      alarms = alarms.filter(a => a.alarm_type === type)
    }

    res.json({
      success: true,
      data: alarms.map(alarm => ({
        id: alarm.id,
        sensorId: alarm.sensor_id,
        sensorType: alarm.sensor_type,
        linePositionKm: alarm.line_position_km,
        alarmType: alarm.alarm_type,
        level: alarm.level,
        message: alarm.message,
        startedAt: alarm.started_at?.toISOString(),
        endedAt: alarm.ended_at?.toISOString(),
        isActive: alarm.is_active,
      })),
    })
  } catch (err) {
    console.error('Error fetching alarm history:', err)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch alarm history',
    })
  }
})

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const activeAlarms = await getActiveAlarms()
    const history = await getAlarmHistory(1000)

    const stats = {
      active: {
        total: activeAlarms.length,
        overheat: activeAlarms.filter(a => a.alarm_type === 'overheat').length,
        galloping: activeAlarms.filter(a => a.alarm_type === 'galloping').length,
        offline: activeAlarms.filter(a => a.alarm_type === 'offline').length,
        critical: activeAlarms.filter(a => a.level === 'critical').length,
        warning: activeAlarms.filter(a => a.level === 'warning').length,
      },
      today: {
        total: history.filter(a => {
          const today = new Date()
          const alarmDate = new Date(a.started_at)
          return alarmDate.toDateString() === today.toDateString()
        }).length,
      },
    }

    res.json({
      success: true,
      data: stats,
    })
  } catch (err) {
    console.error('Error fetching alarm stats:', err)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch alarm stats',
    })
  }
})

router.post('/:id/acknowledge', async (req: Request, res: Response) => {
  const { id } = req.params

  try {
    await closeAlarm(Number(id))
    res.json({
      success: true,
      message: 'Alarm acknowledged',
    })
  } catch (err) {
    console.error('Error acknowledging alarm:', err)
    res.status(500).json({
      success: false,
      error: 'Failed to acknowledge alarm',
    })
  }
})

export default router
