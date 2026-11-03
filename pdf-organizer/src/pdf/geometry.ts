/** Margins removed from a page, as fractions of its visible size: [left, top, right, bottom]. Stored for the page at rotation 0. */
export type Crop = [number, number, number, number];
export const noCrop: Crop = [0, 0, 0, 0];

/** Re-expresses margins after turning the page `turns` quarter turns clockwise (negative = counter-clockwise). */
export function turnCrop(crop: Crop, turns: number): Crop {
  let [left, top, right, bottom] = crop;
  for (let i = ((turns % 4) + 4) % 4; i > 0; i--) [left, top, right, bottom] = [bottom, left, top, right];
  return [left, top, right, bottom];
}

/** Narrows an existing crop by `margins`, which are fractions of the region that is still visible. Both in the same orientation. */
export function narrowCrop(base: Crop | undefined, margins: Crop): Crop {
  const [left, top, right, bottom] = base ?? noCrop;
  const width = 1 - left - right, height = 1 - top - bottom;
  return [left + margins[0] * width, top + margins[1] * height, right + margins[2] * width, bottom + margins[3] * height];
}

export function validCrop(crop: unknown): crop is Crop {
  return Array.isArray(crop) && crop.length === 4 && crop.every(value => Number.isFinite(value) && value >= 0 && value < 1)
    && crop[0] + crop[2] < 0.99 && crop[1] + crop[3] < 0.99;
}

export const SCALE_MIN = 0.1, SCALE_MAX = 4;
