import { describe, expect, it } from 'vitest';
import { sniffAudio } from '../../src/shared/audioSniff';

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const bytes = (...parts: number[][]): Uint8Array => new Uint8Array(parts.flat());

describe('sniffAudio', () => {
  it('names OGG, WAV and MP3 by their first bytes', () => {
    expect(sniffAudio(bytes(ascii('OggS'), [0, 2]))).toBe('ogg');
    expect(sniffAudio(bytes(ascii('RIFF'), [0, 0, 0, 0], ascii('WAVEfmt ')))).toBe('wav');
    expect(sniffAudio(bytes(ascii('ID3'), [4, 0]))).toBe('mp3');
    expect(sniffAudio(bytes([0xff, 0xfb, 0x90, 0x64]))).toBe('mp3'); // a bare MPEG-1 Layer III frame
  });

  it('names nothing else, whatever the file is called', () => {
    expect(sniffAudio(bytes(ascii('RIFF'), [0, 0, 0, 0], ascii('WEBPVP8 ')))).toBeNull(); // a WebP is RIFF too
    expect(sniffAudio(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBeNull(); // a JPEG
    expect(sniffAudio(bytes([0xff, 0xe0]))).toBeNull(); // sync bits with the reserved layer
    expect(sniffAudio(bytes(ascii('fLaC')))).toBeNull();
    expect(sniffAudio(new Uint8Array(0))).toBeNull();
    expect(sniffAudio(bytes(ascii('Ogg')))).toBeNull();
  });
});
