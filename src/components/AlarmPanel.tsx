import { useEffect, useState } from 'react'
import { AlertTriangle, Flame, Wind, WifiOff, X, CheckCircle, Clock } from 'lucide-react'
import { useSensorStore, type Alarm } from '../store/index.js'

const ALARM_TYPE_CONFIG = {
  overheat: {
    label: '过热告警',
    icon: Flame,
    color: '#ff4757',
  },
  galloping: {
    label: '线路舞动',
    icon: Wind,
    color: '#ffa502',
  },
  offline: {
    label: '设备离线',
    icon: WifiOff,
    color: '#3498db',
  },
}

export function AlarmPanel() {
  const { alarms = [], setSelectedSensor } = useSensorStore()
  const [filter, setFilter] = useState<string>('all')
  const [showPanel, setShowPanel] = useState(true)

  const activeAlarms = alarms.filter((a) => a?.isActive)
  const filteredAlarms =
    filter === 'all'
      ? activeAlarms
      : activeAlarms.filter((a) => a?.alarmType === filter)

  const alarmStats = {
    overheat: activeAlarms.filter((a) => a?.alarmType === 'overheat').length,
    galloping: activeAlarms.filter((a) => a?.alarmType === 'galloping').length,
    offline: activeAlarms.filter((a) => a?.alarmType === 'offline').length,
  }

  useEffect(() => {
    if (activeAlarms.length > 0) {
      setShowPanel(true)
    }
  }, [activeAlarms.length])

  return (
    <div
      className={`absolute top-20 left-4 w-80 max-h-[calc(100vh-220px)] bg-[#0a1628]/95 backdrop-blur-md border border-[#ff4757]/30 rounded-xl shadow-2xl overflow-hidden z-20 transition-all duration-300 flex flex-col ${
        showPanel ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-full pointer-events-none'
      }`}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#ff4757]/20 bg-gradient-to-r from-[#ff4757]/10 to-transparent">
        <div className="flex items-center gap-2">
          <div className="relative">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            {activeAlarms.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-xs flex items-center justify-center font-bold">
                {activeAlarms.length}
              </span>
            )}
          </div>
          <h3 className="text-white font-bold">告警中心</h3>
        </div>
        <button
          onClick={() => setShowPanel(false)}
          className="p-1 rounded-lg hover:bg-white/10 transition-colors text-gray-400 hover:text-white"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex gap-1 p-2 border-b border-white/10">
        {(['all', 'overheat', 'galloping', 'offline'] as const).map((type) => {
          const config = type !== 'all' ? ALARM_TYPE_CONFIG[type] : null
          const count =
            type === 'all'
              ? activeAlarms.length
              : alarmStats[type]
          return (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1 ${
                filter === type
                  ? 'bg-white/20 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {config && <config.icon className="w-3 h-3" />}
              <span>{type === 'all' ? '全部' : config?.label}</span>
              <span className="bg-white/10 px-1.5 rounded">{count}</span>
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {filteredAlarms.length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-2" />
            <p className="text-gray-400 text-sm">暂无活动告警</p>
          </div>
        ) : (
          <div className="divide-y divide-white/10">
            {filteredAlarms.map((alarm) => (
              <AlarmItem
                key={alarm.id}
                alarm={alarm}
                onClick={() => setSelectedSensor(alarm.sensorId)}
              />
            ))}
          </div>
        )}
      </div>

      {activeAlarms.length > 0 && showPanel && (
        <button
          onClick={() => setShowPanel(false)}
          className="w-full py-2 border-t border-white/10 text-xs text-gray-400 hover:text-white transition-colors"
        >
          收起面板
        </button>
      )}
    </div>
  )
}

function AlarmItem({
  alarm,
  onClick,
}: {
  alarm: Alarm
  onClick: () => void
}) {
  const config = ALARM_TYPE_CONFIG[alarm.alarmType]
  const Icon = config.icon

  return (
    <div
      onClick={onClick}
      className="p-3 hover:bg-white/5 cursor-pointer transition-colors group"
    >
      <div className="flex items-start gap-3">
        <div
          className="p-1.5 rounded-lg flex-shrink-0"
          style={{ backgroundColor: config.color + '20' }}
        >
          <Icon className="w-4 h-4" style={{ color: config.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span
              className="text-xs font-medium px-1.5 py-0.5 rounded"
              style={{
                backgroundColor:
                  alarm.level === 'critical' ? '#ff475730' : '#ffa50230',
                color: alarm.level === 'critical' ? '#ff4757' : '#ffa502',
              }}
            >
              {alarm.level === 'critical' ? '严重' : '警告'}
            </span>
            <div className="flex items-center gap-1 text-gray-500 text-xs">
              <Clock className="w-3 h-3" />
              <span className="font-mono">
                {new Date(alarm.startedAt).toLocaleTimeString('zh-CN')}
              </span>
            </div>
          </div>
          <p className="text-white text-sm mt-1 font-medium group-hover:text-[#00d4ff] transition-colors">
            {alarm.sensorId} - {config.label}
          </p>
          <p className="text-gray-400 text-xs mt-0.5 truncate">
            {alarm.message}
          </p>
        </div>
      </div>
    </div>
  )
}
