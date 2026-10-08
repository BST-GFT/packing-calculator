/**
 * A packed box in 3D that can be turned and zoomed. Loaded on demand because
 * three.js is larger than the rest of the page put together.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  TOUCH,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import { placeUnits, toMm, type BoxFit, type PlacedUnit } from '../engine/index.ts'
import { count } from './format.ts'

/** Beyond this many units the box is not drawn in 3D. */
const MAX_3D = 20_000

/** Starting view: from the front right, above the box. */
const VIEW = new Vector3(1, 0.85, 1.35).normalize()

/** The 12 edges of a cuboid as pairs of corners; bit 0 is x, bit 1 is y, bit 2 is z. */
const EDGES = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7]

export function Box3D({ fit }: { fit: BoxFit }) {
  const units = useMemo(() => placeUnits(fit, Math.min(fit.capacity, MAX_3D + 1)), [fit])
  if (units.length === 0) return null
  if (units.length > MAX_3D) {
    return <p className="note">São unidades demais para mostrar em 3D; siga as camadas abaixo.</p>
  }
  return <Viewer fit={fit} units={units} />
}

function Viewer({ fit, units }: { fit: BoxFit; units: PlacedUnit[] }) {
  const layers = units[units.length - 1].layer + 1
  const [shown, setShown] = useState(layers)
  // New contents start with every layer showing.
  const [current, setCurrent] = useState(units)
  if (current !== units) {
    setCurrent(units)
    setShown(layers)
  }

  const host = useRef<HTMLDivElement>(null)
  const view = useRef<View | null>(null)
  useEffect(() => {
    const created = createView(host.current!)
    view.current = created
    return () => {
      created.dispose()
      view.current = null
    }
  }, [])
  useEffect(() => view.current?.setContents(fit, units), [fit, units])
  useEffect(() => view.current?.showLayers(shown), [shown, units])

  return (
    <div className="view3d">
      <div className="view3d-canvas" ref={host} />
      <div className="view3d-bar">
        {layers > 1 && (
          <label className="view3d-layers">
            <span>
              Mostrando {shown} de {count(layers, 'camada', 'camadas')}
            </span>
            <input
              type="range"
              min={1}
              max={layers}
              value={shown}
              onChange={(e) => setShown(Number(e.target.value))}
            />
          </label>
        )}
        <button type="button" className="link" onClick={() => view.current?.reset()}>
          Vista inicial
        </button>
      </div>
      <p className="hint view3d-hint">
        Arraste para girar a caixa. Para aproximar, use dois dedos ou Ctrl + roda do mouse.
      </p>
    </div>
  )
}

interface View {
  setContents: (fit: BoxFit, units: PlacedUnit[]) => void
  showLayers: (layers: number) => void
  reset: () => void
  dispose: () => void
}

function createView(host: HTMLElement): View {
  const css = getComputedStyle(document.documentElement)
  const color = (name: string) => new Color(css.getPropertyValue(name).trim())
  const unitColor = color('--unit')
  const turnedColor = color('--unit-turned')

  const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  const canvas = renderer.domElement
  canvas.setAttribute('role', 'img')
  host.append(canvas)

  const scene = new Scene()
  const camera = new PerspectiveCamera(30, 1, 1, 1000)
  scene.add(camera)
  scene.add(new HemisphereLight(0xffffff, 0x8f8a9c, 1.7))
  // The light moves with the camera, so the faces in view are always lit the same way.
  const sun = new DirectionalLight(0xffffff, 1.6)
  sun.position.set(0.5, 1, 0.3)
  camera.add(sun)

  // A plain mouse wheel keeps scrolling the page; Ctrl + wheel, or a trackpad
  // pinch, zooms. This must be registered before the controls' own listener.
  canvas.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) e.stopImmediatePropagation()
  })
  const controls = new OrbitControls(camera, canvas)
  // The controls take over every touch. Letting vertical swipes through keeps
  // the page scrollable on phones: one finger turns the box sideways, two
  // fingers turn it any way and zoom.
  canvas.style.touchAction = 'pan-y'
  controls.enablePan = false
  controls.maxPolarAngle = Math.PI / 2
  controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_ROTATE }

  let frame = 0
  const render = () => {
    frame = 0
    renderer.render(scene, camera)
  }
  controls.addEventListener('change', () => {
    if (!frame) frame = requestAnimationFrame(render)
  })
  let moved = false
  controls.addEventListener('start', () => {
    moved = true
  })

  const cube = new BoxGeometry(1, 1, 1)
  const unitMaterial = new MeshLambertMaterial({
    // Pushes the faces back a little so the unit outlines are drawn on top.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
  const edgeMaterial = new LineBasicMaterial({ color: color('--ink'), transparent: true })
  const wallMaterial = new MeshLambertMaterial({ color: color('--kraft'), side: BackSide })
  const rimMaterial = new LineBasicMaterial({ color: color('--kraft-edge') })

  const contents = new Group()
  scene.add(contents)
  let mesh: InstancedMesh | null = null
  let outlines: LineSegments | null = null
  let ends: number[] = []
  // Box size in cm: x is its length, y its height, z its width.
  let size = new Vector3()

  const clear = () => {
    for (const child of contents.children) {
      if (child instanceof InstancedMesh) child.dispose()
      else if (child instanceof Mesh || child instanceof LineSegments) child.geometry.dispose()
    }
    contents.clear()
  }

  const fitCamera = () => {
    if (size.lengthSq() === 0) return
    const radius = size.length() / 2
    const vertical = MathUtils.degToRad(camera.fov)
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect)
    const distance = (radius / Math.sin(Math.min(vertical, horizontal) / 2)) * 1.02
    controls.target.set(0, size.y / 2, 0)
    camera.position.copy(VIEW).multiplyScalar(distance).add(controls.target)
    camera.near = distance / 100
    camera.far = distance * 5
    camera.updateProjectionMatrix()
    controls.minDistance = radius * 1.2
    controls.maxDistance = distance * 2.5
    controls.update()
    controls.saveState()
  }

  const resize = () => {
    const width = host.clientWidth
    const height = host.clientHeight
    if (!width || !height) return
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    if (moved) camera.updateProjectionMatrix()
    else fitCamera()
    render()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()

  return {
    setContents(fit, units) {
      clear()
      const { box } = fit
      const next = new Vector3(box.dims.length, box.dims.height, box.dims.width)
      const newBox = !next.equals(size)
      size = next

      const shell = new BoxGeometry(size.x, size.y, size.z)
      const walls = new Mesh(shell, wallMaterial)
      const rim = new LineSegments(new EdgesGeometry(shell), rimMaterial)
      walls.position.y = rim.position.y = size.y / 2
      contents.add(walls, rim)

      // Units sit in the usable space, centred in the box.
      const inset = (toMm(box.dims[fit.plane.u]) - fit.plane.uMm) / 2
      const matrix = new Matrix4()
      const centre = new Vector3()
      const scale = new Vector3()
      const turn = new Quaternion()
      const lines = new Float32Array(units.length * EDGES.length * 3)
      const corner = [new Vector3(), new Vector3()]
      mesh = new InstancedMesh(cube, unitMaterial, units.length)
      mesh.frustumCulled = false
      ends = []
      units.forEach((unit, i) => {
        corner[0].set(
          (inset + unit.at.length) / 10 - size.x / 2,
          (inset + unit.at.height) / 10,
          (inset + unit.at.width) / 10 - size.z / 2,
        )
        scale.set(unit.size.length / 10, unit.size.height / 10, unit.size.width / 10)
        corner[1].copy(corner[0]).add(scale)
        centre.copy(corner[0]).addScaledVector(scale, 0.5)
        mesh!.setMatrixAt(i, matrix.compose(centre, turn, scale))
        mesh!.setColorAt(i, unit.turned ? turnedColor : unitColor)
        EDGES.forEach((c, k) => {
          const at = (i * EDGES.length + k) * 3
          lines[at] = corner[c & 1].x
          lines[at + 1] = corner[(c >> 1) & 1].y
          lines[at + 2] = corner[(c >> 2) & 1].z
        })
        ends[unit.layer] = i + 1
      })
      const outlineGeometry = new BufferGeometry()
      outlineGeometry.setAttribute('position', new BufferAttribute(lines, 3))
      outlines = new LineSegments(outlineGeometry, edgeMaterial)
      outlines.frustumCulled = false
      contents.add(mesh, outlines)

      // Outlines of many small units would turn the view grey, so they fade.
      const smallest = Math.min(units[0].size.length, units[0].size.width, units[0].size.height)
      edgeMaterial.opacity = MathUtils.clamp((smallest / 10 / Math.max(size.x, size.y, size.z)) * 12, 0.18, 0.6)

      canvas.setAttribute(
        'aria-label',
        `Caixa ${box.name} em 3D, com ${count(units.length, 'unidade', 'unidades')}`,
      )
      if (newBox || !moved) fitCamera()
      render()
    },

    showLayers(layers) {
      if (!mesh || !outlines) return
      const visible = ends[layers - 1] ?? 0
      mesh.count = visible
      outlines.geometry.setDrawRange(0, visible * EDGES.length)
      render()
    },

    reset() {
      controls.reset()
      moved = false
      render()
    },

    dispose() {
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      clear()
      cube.dispose()
      for (const m of [unitMaterial, edgeMaterial, wallMaterial, rimMaterial]) m.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    },
  }
}
