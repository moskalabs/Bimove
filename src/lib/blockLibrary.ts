/**
 * Built-in block library — reusable furniture & fixture symbols.
 *
 * Each symbol is drawn in a coordinate space equal to its real-world size in
 * millimetres (`wmm` × `hmm`), so the SVG path data reads like a 1:1 plan.
 * When a block is placed on the canvas it is scaled to the page using the
 * current drawing scale (px-per-mm), then freely resizable from there.
 */

import type { ReactNode } from 'react'
import { createElement as h } from 'react'

export type BlockDef = {
  id: string
  name: string
  category: string
  /** Real-world footprint in millimetres. */
  wmm: number
  hmm: number
  /** Symbol geometry, authored in a `0 0 wmm hmm` viewBox. */
  draw: () => ReactNode
}

// ---- small drawing helpers -------------------------------------------------

const STROKE = '#333'
const THIN = '#888'

const rect = (x: number, y: number, w: number, hh: number, extra: Record<string, unknown> = {}) =>
  h('rect', { x, y, width: w, height: hh, fill: 'none', stroke: STROKE, strokeWidth: 12, ...extra })

const line = (x1: number, y1: number, x2: number, y2: number, extra: Record<string, unknown> = {}) =>
  h('line', { x1, y1, x2, y2, stroke: THIN, strokeWidth: 10, ...extra })

const circle = (cx: number, cy: number, r: number, extra: Record<string, unknown> = {}) =>
  h('circle', { cx, cy, r, fill: 'none', stroke: STROKE, strokeWidth: 12, ...extra })

const g = (...kids: ReactNode[]) => h('g', {}, ...kids)

// ---- block definitions -----------------------------------------------------

export const BLOCKS: BlockDef[] = [
  // ---------------- 가구 ----------------
  {
    id: 'bed_single', name: '싱글 침대', category: '가구', wmm: 1000, hmm: 2000,
    draw: () => g(
      rect(0, 0, 1000, 2000, { rx: 30 }),
      rect(80, 80, 840, 600, { stroke: THIN, strokeWidth: 10 }),     // pillow area
      line(80, 700, 920, 700),                                       // blanket fold
    ),
  },
  {
    id: 'bed_double', name: '더블 침대', category: '가구', wmm: 1500, hmm: 2000,
    draw: () => g(
      rect(0, 0, 1500, 2000, { rx: 30 }),
      rect(90, 80, 580, 380, { stroke: THIN, strokeWidth: 10 }),
      rect(830, 80, 580, 380, { stroke: THIN, strokeWidth: 10 }),
      line(80, 560, 1420, 560),
    ),
  },
  {
    id: 'sofa_2', name: '2인 소파', category: '가구', wmm: 1600, hmm: 850,
    draw: () => g(
      rect(0, 0, 1600, 850, { rx: 60 }),
      rect(120, 180, 1360, 600, { rx: 40, stroke: THIN, strokeWidth: 10 }),
      line(800, 180, 800, 780),
    ),
  },
  {
    id: 'sofa_3', name: '3인 소파', category: '가구', wmm: 2200, hmm: 900,
    draw: () => g(
      rect(0, 0, 2200, 900, { rx: 60 }),
      rect(140, 200, 1920, 620, { rx: 40, stroke: THIN, strokeWidth: 10 }),
      line(140 + 640, 200, 140 + 640, 820),
      line(140 + 1280, 200, 140 + 1280, 820),
    ),
  },
  {
    id: 'desk', name: '책상', category: '가구', wmm: 1200, hmm: 600,
    draw: () => g(
      rect(0, 0, 1200, 600),
      rect(820, 60, 320, 480, { stroke: THIN, strokeWidth: 10 }),     // drawer unit
    ),
  },
  {
    id: 'dining_table', name: '식탁 (4인)', category: '가구', wmm: 1400, hmm: 800,
    draw: () => g(
      rect(0, 0, 1400, 800, { rx: 20 }),
      rect(250, -380, 350, 350, { rx: 20, stroke: THIN, strokeWidth: 10 }),   // chairs
      rect(800, -380, 350, 350, { rx: 20, stroke: THIN, strokeWidth: 10 }),
      rect(250, 830, 350, 350, { rx: 20, stroke: THIN, strokeWidth: 10 }),
      rect(800, 830, 350, 350, { rx: 20, stroke: THIN, strokeWidth: 10 }),
    ),
  },
  {
    id: 'chair', name: '의자', category: '가구', wmm: 450, hmm: 450,
    draw: () => g(
      rect(0, 60, 450, 390, { rx: 30 }),
      rect(0, 0, 450, 90, { rx: 20, stroke: THIN, strokeWidth: 10 }),  // backrest
    ),
  },
  {
    id: 'wardrobe', name: '옷장', category: '가구', wmm: 1200, hmm: 600,
    draw: () => g(
      rect(0, 0, 1200, 600),
      line(600, 0, 600, 600),
      line(0, 600, 200, 720), line(600, 600, 800, 720),               // door swing hints
    ),
  },
  {
    id: 'bookshelf', name: '책장', category: '가구', wmm: 900, hmm: 300,
    draw: () => g(
      rect(0, 0, 900, 300),
      line(300, 0, 300, 300), line(600, 0, 600, 300),
    ),
  },
  {
    id: 'tv', name: 'TV', category: '가구', wmm: 1300, hmm: 80,
    draw: () => g(
      rect(0, 0, 1300, 80),
      line(550, 80, 750, 200),
      rect(450, 200, 400, 60, { stroke: THIN, strokeWidth: 10 }),     // stand foot
    ),
  },

  // ---------------- 욕실 ----------------
  {
    id: 'toilet', name: '변기', category: '욕실', wmm: 380, hmm: 680,
    draw: () => g(
      rect(40, 0, 300, 180, { rx: 20 }),                              // tank
      h('ellipse', { cx: 190, cy: 430, rx: 175, ry: 230, fill: 'none', stroke: STROKE, strokeWidth: 12 }),
      h('ellipse', { cx: 190, cy: 430, rx: 110, ry: 160, fill: 'none', stroke: THIN, strokeWidth: 10 }),
    ),
  },
  {
    id: 'sink_bath', name: '세면대', category: '욕실', wmm: 550, hmm: 450,
    draw: () => g(
      rect(0, 0, 550, 450, { rx: 30 }),
      h('ellipse', { cx: 275, cy: 250, rx: 200, ry: 150, fill: 'none', stroke: THIN, strokeWidth: 10 }),
      circle(275, 70, 22),                                            // faucet
    ),
  },
  {
    id: 'bathtub', name: '욕조', category: '욕실', wmm: 1700, hmm: 750,
    draw: () => g(
      rect(0, 0, 1700, 750, { rx: 60 }),
      rect(120, 100, 1300, 550, { rx: 90, stroke: THIN, strokeWidth: 10 }),
      circle(1550, 375, 28),                                          // drain
    ),
  },
  {
    id: 'shower', name: '샤워부스', category: '욕실', wmm: 900, hmm: 900,
    draw: () => g(
      rect(0, 0, 900, 900),
      h('path', { d: 'M0 0 L900 900', stroke: THIN, strokeWidth: 10 }),
      h('path', { d: 'M900 0 L0 900', stroke: THIN, strokeWidth: 10 }),
      circle(450, 450, 40),
    ),
  },

  // ---------------- 주방 ----------------
  {
    id: 'kitchen_sink', name: '싱크대', category: '주방', wmm: 800, hmm: 600,
    draw: () => g(
      rect(0, 0, 800, 600),
      rect(90, 110, 480, 400, { rx: 30, stroke: THIN, strokeWidth: 10 }),
      circle(330, 310, 26),
      circle(660, 110, 22),
    ),
  },
  {
    id: 'stove', name: '가스레인지', category: '주방', wmm: 600, hmm: 600,
    draw: () => g(
      rect(0, 0, 600, 600),
      circle(180, 180, 100), circle(420, 180, 100),
      circle(180, 420, 100), circle(420, 420, 100),
    ),
  },
  {
    id: 'fridge', name: '냉장고', category: '주방', wmm: 700, hmm: 700,
    draw: () => g(
      rect(0, 0, 700, 700, { rx: 20 }),
      line(0, 350, 700, 350),
      rect(560, 60, 60, 220, { stroke: THIN, strokeWidth: 10 }),      // handle
      rect(560, 420, 60, 220, { stroke: THIN, strokeWidth: 10 }),
    ),
  },
  {
    id: 'counter', name: '주방 상판', category: '주방', wmm: 2400, hmm: 600,
    draw: () => g(
      rect(0, 0, 2400, 600),
      line(0, 80, 2400, 80, { strokeDasharray: '20 20' }),
    ),
  },
]

export const BLOCK_CATEGORIES = Array.from(new Set(BLOCKS.map((b) => b.category)))

export const getBlock = (id: string): BlockDef | undefined => BLOCKS.find((b) => b.id === id)
