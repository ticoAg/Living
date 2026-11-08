// Decodes one HEIC/HEIF file to RGBA pixels with libheif (WebAssembly), for browsers that cannot open HEIC themselves.
// It runs in a module Worker: libheif-js instantiates its WebAssembly synchronously, and a decode takes about a second per
// 12 MP (several for a 48 MP photo), which would freeze the page. Only heic.ts starts it, and only when a file needs it.
// Docs: /docs/product/features/upload.md

import createLibheif, { type HeifImage, type LibHeif } from 'libheif-js/libheif-wasm/libheif-bundle.mjs';

export interface HeicRequest {
  id: number;
  buffer: ArrayBuffer;
  /** refuse images with more pixels than this before allocating anything for them */
  maxPixels: number;
}

export type HeicFailure =
  /** libheif could not parse the file, or found no primary image in it */
  | 'unreadable'
  /** more pixels than `maxPixels` */
  | 'too-large'
  /** the pixel buffer could not be allocated */
  | 'memory'
  /** decoding itself failed */
  | 'failed';

export type HeicReply =
  | { type: 'ready'; error?: string }
  | { type: 'done'; id: number; width: number; height: number; pixels: ArrayBuffer }
  /** `fatal`: an exception came out of the WebAssembly, so this instance can no longer be trusted */
  | { type: 'fail'; id: number; reason: HeicFailure; pixels?: number; fatal?: boolean };

interface Scope {
  onmessage: ((e: MessageEvent<HeicRequest>) => void) | null;
  onunhandledrejection: ((e: PromiseRejectionEvent) => void) | null;
  postMessage(message: HeicReply, transfer?: Transferable[]): void;
}
const scope = self as unknown as Scope;

let libheif: LibHeif | undefined;
try {
  libheif = createLibheif();
  scope.postMessage({ type: 'ready' });
} catch (e) {
  scope.postMessage({ type: 'ready', error: String(e) });
}

/** Rejects the render in flight: libheif-js decodes inside a timer callback, so an exception there never reaches `display`'s callback. */
let abortRender: ((reason: unknown) => void) | null = null;
scope.onunhandledrejection = (e) => {
  if (!abortRender) return;
  e.preventDefault();
  abortRender(e.reason);
};

function render(image: HeifImage, target: { data: Uint8ClampedArray; width: number; height: number }): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    abortRender = reject;
    image.display(target, (result) => resolve(result != null));
  }).finally(() => {
    abortRender = null;
  });
}

async function decode(lib: LibHeif, { id, buffer, maxPixels }: HeicRequest): Promise<HeicReply> {
  const fail = (reason: HeicFailure, extra?: { pixels?: number; fatal?: boolean }): HeicReply => ({ type: 'fail', id, reason, ...extra });
  const decoder = new lib.HeifDecoder();
  let images: HeifImage[] = [];
  try {
    images = decoder.decode(new Uint8Array(buffer));
    // `decode` lists every top-level image. A damaged file can lose its primary image and still list a thumbnail or a tile:
    // taking that instead would publish a postage stamp, so only the primary image counts.
    const image = images.find((i) => i.is_primary());
    if (!image) return fail('unreadable');
    // libheif has already applied the container's rotation and mirroring (irot, imir), so these are the upright dimensions.
    const width = image.get_width();
    const height = image.get_height();
    if (!(width > 0 && height > 0)) return fail('unreadable');
    if (width * height > maxPixels) return fail('too-large', { pixels: width * height });

    let data: Uint8ClampedArray<ArrayBuffer>;
    try {
      data = new Uint8ClampedArray(width * height * 4);
    } catch {
      return fail('memory');
    }
    new Uint32Array(data.buffer).fill(0xff000000); // opaque black (little-endian RGBA); files with an alpha channel overwrite it
    if (!(await render(image, { data, width, height }))) return fail('failed');
    return { type: 'done', id, width, height, pixels: data.buffer };
  } catch {
    return fail('failed', { fatal: true });
  } finally {
    for (const image of images) {
      try {
        image.free();
      } catch {
        /* the handle is already gone */
      }
    }
    try {
      if (decoder.decoder) lib.heif_context_free(decoder.decoder);
    } catch {
      /* same */
    }
  }
}

scope.onmessage = async (e) => {
  const request = e.data;
  const reply: HeicReply = libheif ? await decode(libheif, request) : { type: 'fail', id: request.id, reason: 'failed', fatal: true };
  scope.postMessage(reply, reply.type === 'done' ? [reply.pixels] : []);
};
