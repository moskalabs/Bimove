import { useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, Grid, Environment, Html } from '@react-three/drei'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { useEditor } from '../context/EditorContext'
import { getScaleConfig } from '../lib/scaleConfig'
import { getWallHeightMm, getRoomNames } from '../lib/settings'
import { detectRooms } from '../lib/roomDetection'

// ── Types ─────────────────────────────────────────────────────────────────────

type WallOpening = { type: 'door' | 'window'; t: number; width: number }

type Wall3D = {
  id: string
  cx: number; cz: number
  startX: number; startZ: number
  len: number; thick: number; rotY: number
  color: string
  openings: WallOpening[]
}

type Floor3D = {
  id: number
  pts: { x: number; z: number }[]
  label: string
  labelX: number; labelZ: number
}

type Scene = {
  walls: Wall3D[]
  floors: Floor3D[]
  height: number
  empty: boolean
  camDist: number; camY: number
}

// ── Scene builder ─────────────────────────────────────────────────────────────

function roomKey(cx: number, cy: number) {
  return `${Math.round(cx / 50) * 50},${Math.round(cy / 50) * 50}`
}

function buildScene(editor: ReturnType<typeof useEditor>): Scene {
  const empty: Scene = { walls: [], floors: [], height: 2.4, empty: true, camDist: 8, camY: 5 }
  if (!editor) return empty

  const shapes = editor.getCurrentPageShapes()
  const scale = getScaleConfig(editor)
  const toM = (px: number) => px / scale.pxPerMm / 1000
  const heightM = getWallHeightMm() / 1000
  const names = getRoomNames()

  const wallShapes = shapes.filter(s => s.type === 'wall')
  if (wallShapes.length === 0) return empty

  // Bounding box for re-centering
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const s of wallShapes) {
    const p = s.props as { x2: number; y2: number }
    minX = Math.min(minX, s.x, s.x + p.x2); maxX = Math.max(maxX, s.x, s.x + p.x2)
    minY = Math.min(minY, s.y, s.y + p.y2); maxY = Math.max(maxY, s.y, s.y + p.y2)
  }
  const ccx = (minX + maxX) / 2, ccy = (minY + maxY) / 2
  const cx = (px: number) => toM(px - ccx)
  const cz = (py: number) => toM(py - ccy)

  // Build walls
  const wallMap = new Map<string, Wall3D>()
  for (const s of wallShapes) {
    const p = s.props as { x2: number; y2: number; thickness: number }
    const lenPx = Math.hypot(p.x2, p.y2)
    if (lenPx < 1) continue
    const rotY = -Math.atan2(p.y2, p.x2)
    const lenM = toM(lenPx)
    const startX = cx(s.x)
    const startZ = cz(s.y)
    const midX = cx(s.x + p.x2 / 2)
    const midZ = cz(s.y + p.y2 / 2)
    const wall: Wall3D = {
      id: s.id,
      cx: midX, cz: midZ,
      startX, startZ,
      len: lenM,
      thick: toM(p.thickness),
      rotY,
      color: (s.meta?.fill as string | undefined) ?? '#d0ccc4',
      openings: [],
    }
    wallMap.set(s.id, wall)
  }

  // Attach doors/windows to their walls
  const openingShapes = shapes.filter(s => s.type === 'door' || s.type === 'window')
  for (const s of openingShapes) {
    const p = s.props as { width: number }
    const widthM = toM(p.width)
    const wallId = (s.meta as Record<string, unknown> | undefined)?.wallId as string | undefined

    let target: Wall3D | undefined
    let t = 0

    if (wallId) {
      target = wallMap.get(wallId)
      if (target) {
        // Project opening center onto wall axis
        const relX = cx(s.x) - target.startX
        const relZ = cz(s.y) - target.startZ
        t = relX * Math.cos(target.rotY) - relZ * Math.sin(target.rotY)
      }
    }

    if (!target) {
      // Fallback: find nearest wall by projection
      let bestDist = 0.3 // max 0.3m away
      for (const w of wallMap.values()) {
        const relX = cx(s.x) - w.startX
        const relZ = cz(s.y) - w.startZ
        const proj = relX * Math.cos(w.rotY) - relZ * Math.sin(w.rotY)
        const perpX = cx(s.x) - (w.startX + proj * Math.cos(w.rotY))
        const perpZ = cz(s.y) - (w.startZ - proj * Math.sin(w.rotY))
        const perpDist = Math.hypot(perpX, perpZ)
        if (proj >= 0 && proj <= w.len && perpDist < bestDist) {
          bestDist = perpDist
          target = w
          t = proj
        }
      }
    }

    if (target && t >= 0 && t <= target.len) {
      target.openings.push({ type: s.type as 'door' | 'window', t, width: widthM })
    }
  }

  // Rooms + floors
  const wallSegs = wallShapes.map(s => {
    const p = s.props as { x2: number; y2: number }
    return { x1: s.x, y1: s.y, x2: s.x + p.x2, y2: s.y + p.y2 }
  })
  const rooms = detectRooms(wallSegs)
  const floors: Floor3D[] = rooms.map((r, i) => {
    const key = roomKey(r.centroid.x, r.centroid.y)
    return {
      id: i,
      pts: r.vertices.map(v => ({ x: cx(v.x), z: cz(v.y) })),
      label: names[key] ?? `방 ${i + 1}`,
      labelX: cx(r.centroid.x),
      labelZ: cz(r.centroid.y),
    }
  })

  const sizeX = toM(maxX - minX)
  const sizeZ = toM(maxY - minY)
  const footprint = Math.max(sizeX, sizeZ, 0.5)
  const camDist = Math.max(footprint * 2, heightM * 1.5)
  const camY = Math.max(heightM * 1.5, camDist * 0.55)

  return { walls: [...wallMap.values()], floors, height: heightM, empty: false, camDist, camY }
}

// ── Wall mesh with openings ───────────────────────────────────────────────────

const WINDOW_SILL = 0.9    // window sill height in metres
const WINDOW_HEIGHT = 1.0  // window panel height in metres

function WallMesh({ wall, height }: { wall: Wall3D; height: number }) {
  const segments = useMemo(() => {
    type Seg = { t0: number; t1: number; h0: number; h1: number }
    if (wall.openings.length === 0) {
      return [{ t0: 0, t1: wall.len, h0: 0, h1: height }] as Seg[]
    }

    const sorted = [...wall.openings].sort((a, b) => a.t - b.t)
    const result: Seg[] = []
    let cursor = 0

    for (const o of sorted) {
      const oT0 = Math.max(0, o.t - o.width / 2)
      const oT1 = Math.min(wall.len, o.t + o.width / 2)

      if (oT0 > cursor + 0.001)
        result.push({ t0: cursor, t1: oT0, h0: 0, h1: height })

      if (o.type === 'window') {
        result.push({ t0: oT0, t1: oT1, h0: 0, h1: WINDOW_SILL })
        result.push({ t0: oT0, t1: oT1, h0: WINDOW_SILL + WINDOW_HEIGHT, h1: height })
      }
      // door: full-height gap, no segment added

      cursor = oT1
    }

    if (cursor < wall.len - 0.001)
      result.push({ t0: cursor, t1: wall.len, h0: 0, h1: height })

    return result
  }, [wall, height])

  return (
    <group position={[wall.startX, 0, wall.startZ]} rotation={[0, wall.rotY, 0]}>
      {segments.map((seg, i) => {
        const segLen = seg.t1 - seg.t0
        const segH = seg.h1 - seg.h0
        if (segLen < 0.001 || segH < 0.001) return null
        return (
          <mesh
            key={i}
            position={[seg.t0 + segLen / 2, seg.h0 + segH / 2, 0]}
            castShadow receiveShadow
          >
            <boxGeometry args={[segLen, segH, Math.max(wall.thick, 0.02)]} />
            <meshStandardMaterial color={wall.color} />
          </mesh>
        )
      })}
    </group>
  )
}

// ── Floor / ceiling mesh ──────────────────────────────────────────────────────

function RoomMesh({ pts, y, opacity = 1 }: { pts: { x: number; z: number }[]; y: number; opacity?: number }) {
  const shape = useMemo(() => {
    const s = new THREE.Shape()
    pts.forEach((p, i) => (i === 0 ? s.moveTo(p.x, p.z) : s.lineTo(p.x, p.z)))
    s.closePath()
    return s
  }, [pts])

  return (
    <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, y, 0]} receiveShadow>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial
        color={y === 0 ? '#e8ddc8' : '#f5f5f5'}
        side={THREE.DoubleSide}
        transparent={opacity < 1}
        opacity={opacity}
      />
    </mesh>
  )
}

// ── GLTF exporter hook ────────────────────────────────────────────────────────

function SceneExporter({ exportRef }: { exportRef: React.MutableRefObject<(() => void) | null> }) {
  const { scene } = useThree()
  exportRef.current = () => {
    const exporter = new GLTFExporter()
    exporter.parse(
      scene,
      (result) => {
        const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = 'model.glb'; a.click()
        setTimeout(() => URL.revokeObjectURL(url), 5000)
      },
      (err) => console.error('GLTF export error:', err),
      { binary: true },
    )
  }
  return null
}

// ── Main viewer ───────────────────────────────────────────────────────────────

export function Viewer3D({ onClose }: { onClose: () => void }) {
  const editor = useEditor()
  const scene = useMemo(() => buildScene(editor), [editor])
  const [showCeiling, setShowCeiling] = useState(false)
  const exportRef = useRef<(() => void) | null>(null)

  const btnStyle: React.CSSProperties = {
    background: '#fff', border: 'none', borderRadius: 8,
    padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
    boxShadow: '0 1px 4px rgba(0,0,0,0.2)', color: '#333',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 600, background: '#1e2228' }}>
      {/* Top bar */}
      <div style={{
        position: 'absolute', top: 12, left: 16, right: 16, zIndex: 601,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{ color: '#fff', fontSize: 13, opacity: 0.7, flex: 1 }}>
          🧱 3D 미리보기 · 드래그=회전, 스크롤=줌
        </div>
        <button
          style={{ ...btnStyle, background: showCeiling ? '#555' : '#fff', color: showCeiling ? '#fff' : '#333' }}
          onClick={() => setShowCeiling(v => !v)}
        >
          {showCeiling ? '천장 켜짐' : '천장 꺼짐'}
        </button>
        {!scene.empty && (
          <button style={btnStyle} onClick={() => exportRef.current?.()}>
            ↓ GLTF
          </button>
        )}
        <button
          onClick={onClose}
          style={{ ...btnStyle, background: '#333', color: '#fff' }}
        >
          ✕ 2D로
        </button>
      </div>

      {scene.empty ? (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          color: '#999', fontSize: 15,
        }}>
          벽을 그리면 3D로 표시됩니다.
        </div>
      ) : (
        <Canvas shadows camera={{ position: [scene.camDist, scene.camY, scene.camDist], fov: 50 }}>
          <SceneExporter exportRef={exportRef} />
          <color attach="background" args={['#1e2228']} />
          <ambientLight intensity={0.5} />
          <directionalLight
            position={[scene.camDist * 2, scene.camDist * 3, scene.camDist]}
            intensity={1.1}
            castShadow
            shadow-mapSize-width={1024}
            shadow-mapSize-height={1024}
          />
          <Environment preset="city" />
          <Grid
            args={[scene.camDist * 6, scene.camDist * 6]}
            cellSize={scene.camDist * 0.15}
            cellColor="#3a3f47"
            sectionSize={scene.camDist * 0.6}
            sectionColor="#4a5058"
            fadeDistance={scene.camDist * 8}
            infiniteGrid
            position={[0, 0, 0]}
          />

          {/* Floors */}
          {scene.floors.map(f => <RoomMesh key={f.id} pts={f.pts} y={0.002} />)}

          {/* Ceilings */}
          {showCeiling && scene.floors.map(f => (
            <RoomMesh key={f.id} pts={f.pts} y={scene.height} opacity={0.6} />
          ))}

          {/* Room labels */}
          {scene.floors.map(f => (
            <Html key={f.id} position={[f.labelX, scene.height * 0.5, f.labelZ]} center>
              <div style={{
                background: 'rgba(255,255,255,0.85)', color: '#333',
                padding: '2px 8px', borderRadius: 4, fontSize: 11,
                fontWeight: 600, whiteSpace: 'nowrap', pointerEvents: 'none',
                fontFamily: 'sans-serif', boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
              }}>
                {f.label}
              </div>
            </Html>
          ))}

          {/* Walls with openings */}
          {scene.walls.map(w => (
            <WallMesh key={w.id} wall={w} height={scene.height} />
          ))}

          {/* Window panes */}
          {scene.walls.flatMap(w =>
            w.openings.filter(o => o.type === 'window').map((o, i) => (
              <group key={`${w.id}-win-${i}`} position={[w.startX, 0, w.startZ]} rotation={[0, w.rotY, 0]}>
                <mesh position={[o.t, WINDOW_SILL + WINDOW_HEIGHT / 2, 0]}>
                  <boxGeometry args={[o.width, WINDOW_HEIGHT, 0.04]} />
                  <meshStandardMaterial color="#81d4fa" transparent opacity={0.5} />
                </mesh>
              </group>
            ))
          )}

          {/* Door panels */}
          {scene.walls.flatMap(w =>
            w.openings.filter(o => o.type === 'door').map((o, i) => (
              <group key={`${w.id}-door-${i}`} position={[w.startX, 0, w.startZ]} rotation={[0, w.rotY, 0]}>
                <mesh position={[o.t, scene.height * 0.45, 0.01]}>
                  <boxGeometry args={[o.width * 0.98, scene.height * 0.9, 0.04]} />
                  <meshStandardMaterial color="#a1887f" transparent opacity={0.85} />
                </mesh>
              </group>
            ))
          )}

          <OrbitControls makeDefault target={[0, scene.height / 2, 0]} />
        </Canvas>
      )}
    </div>
  )
}
