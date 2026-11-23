export const LOGO_MAX_BYTES = 40960;
export const LOGO_BOX = { width: 600, height: 200 };

export function fitWithin(w: number, h: number, maxW: number, maxH: number): { width: number; height: number } {
  const scale = Math.min(1, maxW / w, maxH / h);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export async function prepareLogo(file: File): Promise<{ type: 'image/png' | 'image/jpeg'; base64: string; bytes: number }> {
  if (file.size > 5 * 1024 * 1024 || !file.type.startsWith('image/')) throw new Error('Choose a PNG or JPEG image under 5 MB');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('This image could not be read'); }
  try {
    const canvas = document.createElement('canvas');
    let size = fitWithin(bitmap.width, bitmap.height, LOGO_BOX.width, LOGO_BOX.height);
    // Try the initial size, followed by at most three reductions.
    for (let attempt = 0; attempt <= 3; attempt++) {
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This image could not be read');
      for (const [type, quality] of [['image/png', undefined], ['image/jpeg', 0.85], ['image/jpeg', 0.7]] as const) {
        context.clearRect(0, 0, size.width, size.height);
        if (type === 'image/jpeg') {
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, size.width, size.height);
        }
        context.drawImage(bitmap, 0, 0, size.width, size.height);
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
        if (!blob || blob.size > LOGO_MAX_BYTES) continue;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 8192) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        }
        return { type, base64: btoa(binary), bytes: bytes.length };
      }
      size = { width: Math.max(1, Math.round(size.width * 0.75)), height: Math.max(1, Math.round(size.height * 0.75)) };
    }
    throw new Error('This logo is too large. Try a simpler or smaller image.');
  } finally { bitmap.close(); }
}
