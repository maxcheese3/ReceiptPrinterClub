import { useCallback } from 'react';

export type DitherMethod = 'none' | 'ordered' | 'floyd' | 'atkinson';

export interface DitheringOptions {
  method: DitherMethod;
  brightness: number;
  contrast: number;
  threshold: number;
}

function toGrayArray(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  brightness: number,
  contrast: number
): Float32Array {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    let lum = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    lum += brightness;
    if (contrast !== 0) {
      const f = (259 * (contrast + 255)) / (255 * (259 - contrast));
      lum = f * (lum - 128) + 128;
    }
    gray[i] = Math.max(0, Math.min(255, lum));
  }
  return gray;
}

function ditherNone(gray: Float32Array, _width: number, _height: number, threshold: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = gray[i] >= threshold ? 255 : 0;
  return out;
}

function ditherOrdered(gray: Float32Array, width: number, height: number, threshold: number): Uint8ClampedArray {
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const bv = (bayer[(y % 4) * 4 + (x % 4)] / 16 - 0.5) * 255;
      out[i] = gray[i] + bv * 0.5 >= threshold ? 255 : 0;
    }
  }
  return out;
}

function ditherFloydSteinberg(gray: Float32Array, width: number, height: number, threshold: number): Uint8ClampedArray {
  const buf = new Float32Array(gray);
  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const nw = buf[i] >= threshold ? 255 : 0;
      out[i] = nw;
      const err = buf[i] - nw;
      if (x + 1 < width) buf[i + 1] += err * 7 / 16;
      if (y + 1 < height) {
        if (x > 0) buf[i + width - 1] += err * 3 / 16;
        buf[i + width] += err * 5 / 16;
        if (x + 1 < width) buf[i + width + 1] += err * 1 / 16;
      }
    }
  }
  return out;
}

function ditherAtkinson(gray: Float32Array, width: number, height: number, threshold: number): Uint8ClampedArray {
  const buf = new Float32Array(gray);
  const out = new Uint8ClampedArray(gray.length);
  const dirs: [number, number][] = [[0, 1], [0, 2], [1, -1], [1, 0], [1, 1], [2, 0]];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const nw = buf[i] >= threshold ? 255 : 0;
      out[i] = nw;
      const err = (buf[i] - nw) / 8;
      for (const [dy, dx] of dirs) {
        const ny = y + dy, nx = x + dx;
        if (ny < height && nx >= 0 && nx < width) buf[ny * width + nx] += err;
      }
    }
  }
  return out;
}

export function useDithering() {
  const processImage = useCallback(
    (file: File, opts: DitheringOptions): Promise<{ dataUrl: string; blob: Blob }> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.onload = (e) => {
          const dataUrl = e.target!.result as string;
          const img = new Image();
          img.onerror = () => reject(new Error('Failed to load image'));
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
            ctx.drawImage(img, 0, 0);

            let imageData: ImageData;
            try {
              imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            } catch {
              // Tainted canvas — return original
              resolve({ dataUrl, blob: file });
              return;
            }

            const { data, width, height } = imageData;
            const gray = toGrayArray(data, width, height, opts.brightness, opts.contrast);

            let mono: Uint8ClampedArray;
            switch (opts.method) {
              case 'none':     mono = ditherNone(gray, width, height, opts.threshold); break;
              case 'floyd':    mono = ditherFloydSteinberg(gray, width, height, opts.threshold); break;
              case 'atkinson': mono = ditherAtkinson(gray, width, height, opts.threshold); break;
              default:         mono = ditherOrdered(gray, width, height, opts.threshold); break;
            }

            for (let i = 0; i < width * height; i++) {
              const v = mono[i];
              data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
              data[i * 4 + 3] = 255;
            }
            ctx.putImageData(imageData, 0, 0);

            const outDataUrl = canvas.toDataURL('image/png');
            canvas.toBlob((blob) => {
              if (blob) resolve({ dataUrl: outDataUrl, blob });
              else reject(new Error('Canvas toBlob failed'));
            }, 'image/png');
          };
          img.src = dataUrl;
        };
        reader.readAsDataURL(file);
      });
    },
    []
  );

  return { processImage };
}
