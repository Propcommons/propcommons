// Minimal reader and writer for the GLB container (header + JSON chunk + optional BIN chunk).
// Used to inspect the raw glTF JSON before any library touches external URIs, and by the
// fixture builder to make mutations that glTF-Transform would refuse to write.

const MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a; // "JSON"
const BIN_CHUNK = 0x004e4942; // "BIN\0"

export interface Glb {
  json: any;
  bin: Uint8Array | null;
}

export function readGlb(bytes: Uint8Array): Glb {
  if (bytes.byteLength < 20) throw new Error("file is too short to be a GLB");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw new Error("file does not start with the GLB magic");
  if (view.getUint32(4, true) !== 2) throw new Error("GLB container version is not 2");
  const total = view.getUint32(8, true);
  if (total > bytes.byteLength) throw new Error("GLB length is larger than the file");
  let offset = 12;
  let json: any = null;
  let bin: Uint8Array | null = null;
  while (offset + 8 <= total) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > total) throw new Error("GLB chunk runs past the end of the file");
    const data = bytes.subarray(start, start + length);
    if (type === JSON_CHUNK && json === null) json = JSON.parse(new TextDecoder().decode(data));
    else if (type === BIN_CHUNK && bin === null) bin = data;
    offset = start + length;
  }
  if (json === null) throw new Error("GLB has no JSON chunk");
  return { json, bin };
}

function pad(data: Uint8Array, fill: number): Uint8Array {
  const padded = new Uint8Array(Math.ceil(data.byteLength / 4) * 4).fill(fill);
  padded.set(data);
  return padded;
}

export function writeGlb({ json, bin }: Glb): Uint8Array {
  const jsonBytes = pad(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const binBytes = bin ? pad(bin, 0) : null;
  const total = 12 + 8 + jsonBytes.byteLength + (binBytes ? 8 + binBytes.byteLength : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.byteLength, true);
  view.setUint32(16, JSON_CHUNK, true);
  out.set(jsonBytes, 20);
  if (binBytes) {
    const o = 20 + jsonBytes.byteLength;
    view.setUint32(o, binBytes.byteLength, true);
    view.setUint32(o + 4, BIN_CHUNK, true);
    out.set(binBytes, o + 8);
  }
  return out;
}

/** URIs in buffers and images that point outside the file (anything but a data: URI). */
export function externalUris(json: any): string[] {
  const uris: string[] = [];
  for (const list of [json.buffers ?? [], json.images ?? []]) {
    for (const item of list) {
      if (typeof item?.uri === "string" && !item.uri.startsWith("data:")) uris.push(item.uri);
    }
  }
  return uris;
}

/** Detects PNG or JPEG from the first bytes; anything else is "unknown". */
export function sniffImage(bytes: Uint8Array): "png" | "jpeg" | "unknown" {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpeg";
  return "unknown";
}
