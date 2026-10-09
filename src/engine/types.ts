/** All lengths are in centimetres and all weights in kilograms. */
export interface Dims {
  length: number
  width: number
  height: number
}

export type Axis = 'length' | 'width' | 'height'

/** One of the shipping boxes the company keeps in stock. */
export interface BoxType {
  id: string
  name: string
  /** Box measurements as listed by logistics. */
  dims: Dims
  /** Weight of the empty box. */
  emptyWeightKg: number
  /** Heaviest this particular box may be when packed. Optional; the shipping limit applies too. */
  maxWeightKg?: number
  /** Cost of sending one box (the box plus its freight). Optional. */
  costBRL?: number
}

/** A single unit of the product, in its own retail packaging. */
export interface Unit {
  dims: Dims
  weightKg: number
}

/** Limits that apply to every box in a shipment. */
export interface PackingRules {
  /** Heaviest a packed box may be, box and padding included. */
  maxGrossKg: number
  /** Weight of padding material added to each box. */
  protectionKg: number
  /** Space lost on each box dimension (wall thickness, padding, bulging). */
  lossCm: number
  /** When true the unit's height stays vertical; it may still turn on the spot. */
  keepUpright: boolean
  /**
   * Most units that may sit on top of each other. With a limit the units go in
   * flat layers only, so it is also the most layers a box holds. Leave it out,
   * or use Infinity, for no limit.
   */
  maxLayers?: number
}
