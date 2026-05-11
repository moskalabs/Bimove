import { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Grid, Environment } from '@react-three/drei'
import * as THREE from 'three'
import { useEditor } from '../context/EditorContext'
import { getScaleConfig } from '../lib/scaleConfig'
import { getWallHeightMm } from '../lib/settings'
import { detectRooms } from '../lib/roomDetection'

type Wall3D = { id: string; cx: number; cz: number; len: number; thick: number; rotY: number }
type Opening3D = { id: string; type: 'door' | 'window'; cx: number; cz: number; w: number; rotY: number }
type Floor3D = { id: number; pts: { x: number; z: number }[] }

type Scene = {
  walls: Wall3D[]
  openings: Opening3D[]
  floors: Floor3D[]
  height: number
  empty: boolean
}

function buildScene(editor: ReturnType<typeof useEditor>): Scene {
  const empty: Scene = { walls: [], openings: [], floors: [], height: 2.4, empty: true }
  if (!editor) return empty

  const shapes = editor.getCurrentPageShapes()
  const scale = getScaleConfig(editor)
  const toM = (px: number) => px / scale.pxPerMm / 1000   // px → metres
  const heightM = getWallHeightMm() / 1000

  const wallShapes = shapes.filter(s => s.type === 'wall')
  if (wallShapes.length === 0) return empty

  // bounding box centre (page px) for re-centring the model on origin
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const segs: { id: string; x1: number; y1: number; x2: number; y2: number }[] = []
  for (const s of wallShapes) {
    const p = s.props as { x2: number; y2: number }
    const x1 = s.x, y1 = s.y, x2 = s.x + p.x2, y2 = s.y + p.y2
    segs.push({ id: s.id, x1, y1, x2, y2 })
    minX = Math.min(minX, x1, x2); maxX = Math.max(maxX, x1, x2)
    minY = Math.min(minY, y1, y2); maxY = Math.max(maxY, y1, y2)
  }
  const ccx = (minX + maxX) / 2, ccy = (minY + maxY) / 2
  const cx = (x: number) => toM(x - ccx)
  const cz = (y: number) => toM(y - ccy)

  const walls: Wall3D[] = wallShapes.map(s => {
    const p = s.props as { x2: number; y2: number; thickness: number }
    const lenPx = Math.hypot(p.x2, p.y2)
    return {
      id: s.id,
      cx: cx(s.x + p.x2 / 2),
      cz: cz(s.y + p.y2 / 2),
      len: toM(lenPx),
      thick: toM(p.thickness),
      rotY: -Math.atan2(p.y2, p.x2),
    }
  })

  const openings: Opening3D[] = shapes
    .filter(s => s.type === 'door' || s.type === 'window')
    .map(s => {
      const p = s.props as { width: number }
      return {
        id: s.id,
        type: s.type as 'door' | 'window',
        cx: cx(s.x), cz: cz(s.y),
        w: toM(p.width),
        rotY: -((s as { rotation?: number }).rotation ?? 0),
      }
    })

  const rooms = detectRooms(segs)
  const floors: Floor3D[] = rooms.map((r, i) => ({
    id: i,
    pts: r.vertices.map(v => ({ x: cx(v.x), z: cz(v.y) })),
  }))

  return { walls, openings, floors, height: heightM, empty: false }
}

function FloorMesh({ pts }: { pts: { x: number; z: number }[] }) {
  const shape = useMemo(() => {
    const s = new THREE.Shape()
    pts.forEach((p, i) => (i === 0 ? s.moveTo(p.x, p.z) : s.lineTo(p.x, p.z)))
    s.closePath()
    return s
  }, [pts])
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} receiveShadow>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial color="#e8ddc8" side={THREE.DoubleSide} />
    </mesh>
  )
}

export function Viewer3D({ onClose }: { onClose: () => void }) {
  const editor = useEditor()
  const scene = useMemo(() => buildScene(editor), [editor])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 600, background: '#1e2228',
    }}>
      <button
        onClick={onClose}
        style={{
          position: 'absolute', top: 14, right: 16, zIndex: 601,
          background: '#fff', border: 'none', borderRadius: 8,
          padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}
      >✕ 2D로 돌아가기</button>

      <div style={{
        position: 'absolute', top: 14, left: 16, zIndex: 601,
        color: '#fff', fontSize: 13, opacity: 0.7,
      }}>
        🧱 3D 미리보기 · 드래그=회전, 스크롤=줌
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
        <Canvas shadows camera={{ position: [8, 8, 8], fov: 50 }}>
          <color attach="background" args={['#1e2228']} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[10, 20, 8]} intensity={1.1} castShadow
            shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
          <Environment preset="city" />
          <Grid args={[40, 40]} cellSize={1} cellColor="#3a3f47" sectionSize={5}
            sectionColor="#4a5058" fadeDistance={40} infiniteGrid position={[0, 0, 0]} />

          {scene.floors.map(f => <FloorMesh key={f.id} pts={f.pts} />)}

          {scene.walls.map(w => (
            <mesh key={w.id} position={[w.cx, scene.height / 2, w.cz]} rotation={[0, w.rotY, 0]} castShadow receiveShadow>
              <boxGeometry args={[w.len, scene.height, Math.max(w.thick, 0.02)]} />
              <meshStandardMaterial color="#d8d8d8" />
            </mesh>
          ))}

          {scene.openings.map(o => (
            <mesh
              key={o.id}
              position={[o.cx, o.type === 'door' ? 1.0 : 1.3, o.cz]}
              rotation={[0, o.rotY, 0]}
            >
              <boxGeometry args={[o.w, o.type === 'door' ? 2.0 : 1.2, 0.06]} />
              <meshStandardMaterial
                color={o.type === 'door' ? '#8d6e63' : '#81d4fa'}
                transparent opacity={o.type === 'door' ? 0.9 : 0.55}
              />
            </mesh>
          ))}

          <OrbitControls makeDefault target={[0, 1, 0]} />
        </Canvas>
      )}
    </div>
  )
}
