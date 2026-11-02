import sharp from "sharp";

export class InvalidImageError extends Error {}

/**
 * Validate and normalise an uploaded image: decodes it (rejects non-images), applies EXIF rotation,
 * strips metadata, bounds the longest side and re-encodes as JPEG. Bounded input pixels guard against
 * decompression bombs. Normalising also makes cache keys stable across re-encodes of the same photo.
 */
export async function normalizeImage(input: Buffer, maxSide = 1024): Promise<Buffer> {
  try {
    return await sharp(input, { limitInputPixels: 40_000_000, failOn: "error" })
      .rotate()
      .resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    throw new InvalidImageError("That file could not be read as an image (use JPG, PNG or WebP).");
  }
}
