export interface TowerConfig {
  id: string
  name: string
  km: number
  latitude: number
  longitude: number
  elevation: number
  towerType: 'tangent' | 'angle' | 'dead-end'
}

export interface LineSegmentConfig {
  id: string
  fromTower: string
  toTower: string
  lengthKm: number
  conductorType: string
  maxAllowedTemp: number
}

export interface LineCorridorConfig {
  lineName: string
  totalLengthKm: number
  voltageLevel: string
  towers: TowerConfig[]
  segments: LineSegmentConfig[]
  boundingBox: {
    minLat: number
    maxLat: number
    minLng: number
    maxLng: number
  }
}

export interface ConductorSpec {
  code: string
  name: string
  diameter: number
  crossSection: number
  dcResistance20C: number
  acResistance20C: number
  weightPerMeter: number
  ratedBreakingStrength: number
}

export const CONDUCTOR_SPECS: Record<string, ConductorSpec> = {
  'LGJ-240/30': {
    code: 'LGJ-240/30',
    name: '钢芯铝绞线 240/30',
    diameter: 0.0216,
    crossSection: 275.96,
    dcResistance20C: 0.1181,
    acResistance20C: 0.119,
    weightPerMeter: 0.925,
    ratedBreakingStrength: 75620,
  },
  'LGJ-300/40': {
    code: 'LGJ-300/40',
    name: '钢芯铝绞线 300/40',
    diameter: 0.02394,
    crossSection: 338.99,
    dcResistance20C: 0.0939,
    acResistance20C: 0.095,
    weightPerMeter: 1.133,
    ratedBreakingStrength: 92220,
  },
  'LGJ-400/35': {
    code: 'LGJ-400/35',
    name: '钢芯铝绞线 400/35',
    diameter: 0.02682,
    crossSection: 425.24,
    dcResistance20C: 0.07389,
    acResistance20C: 0.075,
    weightPerMeter: 1.349,
    ratedBreakingStrength: 103900,
  },
  'LGJ-630/45': {
    code: 'LGJ-630/45',
    name: '钢芯铝绞线 630/45',
    diameter: 0.0338,
    crossSection: 666.55,
    dcResistance20C: 0.04633,
    acResistance20C: 0.048,
    weightPerMeter: 2.06,
    ratedBreakingStrength: 148700,
  },
}

function generateTowers(startLat: number, startLng: number, endLat: number, endLng: number, totalKm: number, count: number): TowerConfig[] {
  const towers: TowerConfig[] = []
  const latStep = (endLat - startLat) / (count - 1)
  const lngStep = (endLng - startLng) / (count - 1)
  const kmStep = totalKm / (count - 1)

  for (let i = 0; i < count; i++) {
    const isEven = i % 2 === 0
    const isTen = i % 10 === 0
    const km = i * kmStep
    towers.push({
      id: `T${String(i).padStart(3, '0')}`,
      name: `#${i}号杆塔`,
      km,
      latitude: startLat + latStep * i + (isEven ? 0.0001 : -0.0001) * Math.sin(km * 0.5),
      longitude: startLng + lngStep * i + (isEven ? 0.00015 : -0.00008) * Math.cos(km * 0.3),
      elevation: 50 + Math.sin(km * 0.2) * 30 + (i % 7 === 0 ? 20 : 0),
      towerType: isTen ? 'dead-end' : (i % 4 === 0 ? 'angle' : 'tangent'),
    })
  }
  return towers
}

const START_LAT = 30.45
const START_LNG = 114.30
const END_LAT = 30.75
const END_LNG = 114.55
const TOTAL_KM = 200
const TOWER_COUNT = 41

const TOWERS = generateTowers(START_LAT, START_LNG, END_LAT, END_LNG, TOTAL_KM, TOWER_COUNT)

const SEGMENTS: LineSegmentConfig[] = TOWERS.slice(0, -1).map((tower, i) => {
  const nextTower = TOWERS[i + 1]
  return {
    id: `SEG-${String(i).padStart(3, '0')}`,
    fromTower: tower.id,
    toTower: nextTower.id,
    lengthKm: nextTower.km - tower.km,
    conductorType: i < 10 ? 'LGJ-400/35' : (i < 25 ? 'LGJ-630/45' : 'LGJ-400/35'),
    maxAllowedTemp: 70,
  }
})

const LAT_ARRAY = TOWERS.map(t => t.latitude)
const LNG_ARRAY = TOWERS.map(t => t.longitude)

export const LINE_CORRIDOR_CONFIG: LineCorridorConfig = {
  lineName: '220kV 江城III回线',
  totalLengthKm: TOTAL_KM,
  voltageLevel: '220kV',
  towers: TOWERS,
  segments: SEGMENTS,
  boundingBox: {
    minLat: Math.min(...LAT_ARRAY) - 0.002,
    maxLat: Math.max(...LAT_ARRAY) + 0.002,
    minLng: Math.min(...LNG_ARRAY) - 0.002,
    maxLng: Math.max(...LNG_ARRAY) + 0.002,
  },
}

export function getTowerAtKm(km: number): TowerConfig {
  return TOWERS.reduce((nearest, t) => {
    const d = Math.abs(t.km - km)
    const nearestD = Math.abs(nearest.km - km)
    return d < nearestD ? t : nearest
  })
}

export function getSegmentAtKm(km: number): LineSegmentConfig | undefined {
  return SEGMENTS.find(s => {
    const fromTower = TOWERS.find(t => t.id === s.fromTower)
    const toTower = TOWERS.find(t => t.id === s.toTower)
    return fromTower && toTower && km >= fromTower.km && km < toTower.km
  })
}

export function getPathPoints(): Array<{ x: number; y: number; km: number }> {
  return TOWERS.map(t => ({
    x: t.longitude,
    y: t.latitude,
    km: t.km,
  }))
}
