import { useState } from 'react'
import { Eye, EyeOff, LogOut, ChevronDown, ChevronUp, LocateFixed } from 'lucide-react'
import type { SatCategory } from '../types/satellite'
import { ALL_CATEGORIES, CATEGORY_LABELS, CATEGORY_COLORS } from '../lib/categories'
import { ORBITAL_ZONES } from './GlobeView'

interface Props {
  visible: boolean
  activeCategories: Set<SatCategory>
  onToggleCategory: (cat: SatCategory) => void
  visibleZones: Set<string>
  onToggleZone: (name: string) => void
  isPassthrough: boolean
  onTogglePassthrough: () => void
  onExitXR: () => void
  visibleCount: number
  totalCount: number
  hasUserLocation: boolean
  onLocate: () => void
}

export function XRPanel({
  visible,
  activeCategories, onToggleCategory,
  visibleZones, onToggleZone,
  isPassthrough, onTogglePassthrough,
  onExitXR,
  visibleCount, totalCount,
  hasUserLocation, onLocate,
}: Props) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div
      style={{
        position: 'fixed',
        // Slide off-screen when not in XR so it stays in the DOM (and in the
        // dom-overlay root) at all times — Quest may snapshot the overlay at
        // session-start before React can mount a conditionally-rendered panel.
        right: visible ? '16px' : '-9999px',
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 9999,
        width: '210px',
        borderRadius: '14px',
        overflow: 'hidden',
        background: 'rgb(7, 14, 26)',
        border: '1px solid rgba(100,116,139,0.5)',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px', borderBottom: '1px solid rgba(51,65,85,0.6)',
      }}>
        <div>
          <div style={{ fontFamily: 'monospace', fontSize: '12px', color: '#e2e8f0', fontWeight: 600 }}>
            TrackSat XR
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: '10px', color: '#475569', marginTop: '1px' }}>
            {visibleCount.toLocaleString()} / {totalCount.toLocaleString()} visible
          </div>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {hasUserLocation && (
            <button onClick={onLocate} style={iconBtn} title="Center on location">
              <LocateFixed size={13} />
            </button>
          )}
          <button onClick={onTogglePassthrough} style={iconBtn}
            title={isPassthrough ? 'Switch to starfield' : 'Switch to passthrough'}>
            {isPassthrough ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
          <button onClick={() => setExpanded(e => !e)} style={iconBtn}>
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          <button onClick={onExitXR} style={{ ...iconBtn, color: '#f87171' }} title="Exit AR">
            <LogOut size={13} />
          </button>
        </div>
      </div>

      {expanded && (
        <>
          {/* Category filters */}
          <div style={{ padding: '10px 12px 8px' }}>
            <div style={sectionLabel}>Satellites</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {ALL_CATEGORIES.map(cat => {
                const active = activeCategories.has(cat)
                const color = CATEGORY_COLORS[cat]
                return (
                  <button
                    key={cat}
                    onClick={() => onToggleCategory(cat)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '7px 10px', borderRadius: '8px', width: '100%',
                      border: `1px solid ${active ? color + '55' : 'rgba(51,65,85,0.5)'}`,
                      background: active ? color + '18' : 'transparent',
                      color: active ? color : '#475569',
                      fontFamily: 'monospace', fontSize: '12px',
                      cursor: 'pointer', textAlign: 'left',
                      transition: 'all 0.15s',
                    }}
                  >
                    <span style={{
                      width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
                      background: active ? color : '#334155',
                    }} />
                    {CATEGORY_LABELS[cat]}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Orbital zones */}
          <div style={{ padding: '0 12px 12px', borderTop: '1px solid rgba(51,65,85,0.5)', paddingTop: '10px' }}>
            <div style={sectionLabel}>Orbital Zones</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {ORBITAL_ZONES.map(z => {
                const active = visibleZones.has(z.name)
                return (
                  <button
                    key={z.name}
                    onClick={() => onToggleZone(z.name)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '5px 8px', borderRadius: '7px', width: '100%',
                      border: 'none', background: 'transparent',
                      opacity: active ? 1 : 0.32,
                      cursor: 'pointer', textAlign: 'left',
                      transition: 'opacity 0.15s',
                    }}
                  >
                    <span style={{ width: '12px', height: '2px', background: z.color, borderRadius: '1px', flexShrink: 0 }} />
                    <span style={{ fontFamily: 'monospace', fontSize: '11px', color: z.color }}>{z.name}</span>
                    <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {z.label.split('–')[0].trim()}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const iconBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#94a3b8',
  cursor: 'pointer',
  padding: '5px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '6px',
}

const sectionLabel: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: '9px',
  color: '#475569',
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  marginBottom: '8px',
}
