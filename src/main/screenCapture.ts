import { desktopCapturer, screen, type Display, type NativeImage } from 'electron';

/** Read one display at a bounded resolution; callers hide lolPing windows before taking the snapshot. */
export async function captureScreen(displayId: number): Promise<{ display: Display; image: NativeImage }> {
  const display = screen.getAllDisplays().find((item) => item.id === displayId);
  if (!display) throw new Error('capture');
  const factor = Math.min(1, 3840 / (display.bounds.width * display.scaleFactor), 2160 / (display.bounds.height * display.scaleFactor));
  const thumbnailSize = {
    width: Math.max(1, Math.round(display.bounds.width * display.scaleFactor * factor)),
    height: Math.max(1, Math.round(display.bounds.height * display.scaleFactor * factor)),
  };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize, fetchWindowIcons: false });
  const source = sources.find((item) => item.display_id === String(displayId));
  if (!source || source.thumbnail.isEmpty()) throw new Error('capture');
  return { display, image: source.thumbnail };
}

export async function captureAround(displayId: number, x: number, y: number): Promise<Buffer> {
  const { display, image } = await captureScreen(displayId);
  const size = image.getSize();
  const scaleX = size.width / display.bounds.width, scaleY = size.height / display.bounds.height;
  const width = Math.min(size.width, Math.max(1, Math.round(960 * scaleX)));
  const height = Math.min(size.height, Math.max(1, Math.round(620 * scaleY)));
  return image.crop({
    x: Math.max(0, Math.min(size.width - width, Math.round(x * scaleX) - Math.floor(width / 2))),
    y: Math.max(0, Math.min(size.height - height, Math.round(y * scaleY) - Math.floor(height / 2))),
    width, height,
  }).toJPEG(82);
}
