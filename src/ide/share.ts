import type { World } from '../lang/robot';

/** Programs travel in the URL hash (#p=…), compressed, so a link works with no server. */
export interface Shared {
  name: string;
  code: string;
  world?: World;
}

function toB64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeShare(s: Shared): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(s));
  return toB64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

export async function decodeShare(token: string): Promise<Shared | null> {
  try {
    const json = await pipe(fromB64Url(token), new DecompressionStream('deflate-raw'));
    const s = JSON.parse(new TextDecoder().decode(json));
    if (typeof s?.code !== 'string') return null;
    return { name: String(s.name ?? 'Shared program').slice(0, 80), code: s.code, world: s.world };
  } catch {
    return null;
  }
}
