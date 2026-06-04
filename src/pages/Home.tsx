import { Header } from '../components/Header.js'
import { LineCorridorMap } from '../components/LineCorridorMap.js'
import { SensorDetailPanel } from '../components/SensorDetailPanel.js'
import { AlarmPanel } from '../components/AlarmPanel.js'
import { CapacityPanel } from '../components/CapacityPanel.js'
import { useWebSocket } from '../hooks/useWebSocket.js'

export default function Home() {
  useWebSocket()

  return (
    <div className="w-screen h-screen bg-[#0a1628] overflow-hidden relative">
      <Header />

      <main className="absolute top-16 left-0 right-0 bottom-0">
        <LineCorridorMap />
      </main>

      <AlarmPanel />
      <SensorDetailPanel />
      <CapacityPanel />
    </div>
  )
}