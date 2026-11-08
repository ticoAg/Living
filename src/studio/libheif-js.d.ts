// libheif-js ships no types for its high-level API (HeifDecoder, HeifImage); this is the part heic.worker.ts uses.
// The package's ES module build embeds the .wasm binary, so a bundler needs no extra asset handling.
declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  export interface HeifImage {
    get_width(): number;
    get_height(): number;
    is_primary(): boolean;
    /** Decodes into `target` (RGBA, 4 bytes per pixel) and calls `done` with it, or with null when decoding failed. */
    display(target: { data: Uint8ClampedArray; width: number; height: number }, done: (result: unknown) => void): void;
    free(): void;
  }
  export interface HeifDecoder {
    decoder: unknown;
    /** Every top-level image in the file, not only the primary one. Returns [] when the file cannot be parsed. */
    decode(data: Uint8Array): HeifImage[];
  }
  export interface LibHeif {
    HeifDecoder: new () => HeifDecoder;
    heif_context_free(context: unknown): void;
  }
  /** Instantiates the WebAssembly module synchronously, so call it from a worker. */
  const createLibheif: (options?: Record<string, unknown>) => LibHeif;
  export default createLibheif;
}
