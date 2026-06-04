import express, { type Request, type Response } from 'express'
import { getCurrentCapacity, getCapacityHistory } from '../db.js'
import { createRatingCalculator, type RatingInput } from '../modules/ieee-rating-calculator.js'
import { createDynamicRatingEngine } from '../modules/dynamic-rating-engine.js'
import { createLineDataCollector } from '../modules/line-data-collector.js'

const router = express.Router()

const defaultConductor = 'LGJ-400/35'
const collector = createLineDataCollector({ persistToDb: false })
const engine = createDynamicRatingEngine({ persistResults: false })

router.get('/current', async (req: Request, res: Response) => {
  try {
    const capacity = await getCurrentCapacity()
    res.json({
      success: true,
      data: capacity,
    })
  } catch (err) {
    console.error('Error fetching current capacity:', err)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch current capacity',
    })
  }
})

router.get('/history', async (req: Request, res: Response) => {
  const { hours = '24' } = req.query

  try {
    const history = await getCapacityHistory(Number(hours))
    res.json({
      success: true,
      data: history,
    })
  } catch (err) {
    console.error('Error fetching capacity history:', err)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch capacity history',
    })
  }
})

router.post('/calculate', (req: Request, res: Response) => {
  const { conductorTemp, windSpeed, solarIrradiance, ambientTemp, humidity, conductorCode } =
    req.body as RatingInput & { conductorCode?: string }

  if (
    conductorTemp === undefined ||
    windSpeed === undefined ||
    solarIrradiance === undefined
  ) {
    return res.status(400).json({
      success: false,
      error:
        'Missing required parameters: conductorTemp, windSpeed, solarIrradiance',
    })
  }

  try {
    const calculator = createRatingCalculator(conductorCode || defaultConductor)
    const result = calculator.calculateDynamicRating({
      conductorTemp: Number(conductorTemp),
      windSpeed: Number(windSpeed),
      solarIrradiance: Number(solarIrradiance),
      ambientTemp: ambientTemp ? Number(ambientTemp) : 25,
      humidity: humidity ? Number(humidity) : undefined,
    })

    res.json({
      success: true,
      data: result,
    })
  } catch (err) {
    console.error('Error calculating dynamic capacity:', err)
    res.status(500).json({
      success: false,
      error: 'Failed to calculate dynamic capacity',
    })
  }
})

router.post('/calculate/line', async (req: Request, res: Response) => {
  try {
    const allData = collector.getAllSensorData()
    const result = await engine.calculateLineRating(allData)
    res.json({
      success: true,
      data: result,
    })
  } catch (err) {
    console.error('Error calculating line rating:', err)
    res.status(500).json({
      success: false,
      error: 'Failed to calculate line rating',
    })
  }
})

router.get('/conductors', (req: Request, res: Response) => {
  try {
    const engine = createDynamicRatingEngine({ persistResults: false })
    const codes = engine.getConductorCodes()
    const specs = codes.map(code => ({
      code,
      spec: engine.getConductorSpec(code),
    }))
    res.json({
      success: true,
      data: specs,
    })
  } catch (err) {
    console.error('Error fetching conductor specs:', err)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch conductor specs',
    })
  }
})

export default router
