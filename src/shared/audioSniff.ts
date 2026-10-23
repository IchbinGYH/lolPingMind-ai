export type AudioType = 'ogg' | 'mp3' | 'wav';
export const AUDIO_TYPES: readonly AudioType[] = ['ogg', 'mp3', 'wav'];

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const startsWith = (b: Uint8Array, at: number, sig: readonly number[]): boolean =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);

/** Names a sound file by its magic bytes, never by its extension or a claimed type. */
export function sniffAudio(bytes: Uint8Array): AudioType | null {
  if (startsWith(bytes, 0, ascii('OggS'))) return 'ogg';
  if (startsWith(bytes, 0, ascii('RIFF')) && startsWith(bytes, 8, ascii('WAVE'))) return 'wav';
  if (startsWith(bytes, 0, ascii('ID3'))) return 'mp3'; // an ID3v2 tag, then the frames
  // A bare MPEG audio frame: 11 sync bits, then a layer other than "reserved".
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0) return 'mp3';
  return null;
}
