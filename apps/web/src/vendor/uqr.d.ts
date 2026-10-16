export type QrCodeDataType = number

export interface QrOptions {
  ecc?: 'L' | 'M' | 'Q' | 'H'
  boostEcc?: boolean
  minVersion?: number
  maxVersion?: number
  maskPattern?: number
  border?: number
  invert?: boolean
}

export function encode(data: string | Uint8Array | ArrayLike<number>, options?: QrOptions): {
  size: number
  data: Uint8Array
  version: number
  maskPattern: number
}

export function renderSVG(data: string | Uint8Array | ArrayLike<number>, options?: QrOptions & {
  pixelSize?: number
  whiteColor?: string
  blackColor?: string
}): string

export function renderUnicode(data: string | Uint8Array | ArrayLike<number>, options?: QrOptions): string
export function renderUnicodeCompact(data: string | Uint8Array | ArrayLike<number>, options?: QrOptions): string
export function renderANSI(data: string | Uint8Array | ArrayLike<number>, options?: QrOptions): string
