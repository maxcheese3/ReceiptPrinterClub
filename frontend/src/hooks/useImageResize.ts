import { useCallback } from 'react';

const MAX_UPLOAD_PX = 1200;

export function useImageResize() {
  const resize = useCallback((file: File): Promise<File> => {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.onload = () => {
        URL.revokeObjectURL(url);
        const { naturalWidth: w, naturalHeight: h } = img;
        if (w <= MAX_UPLOAD_PX && h <= MAX_UPLOAD_PX) {
          resolve(file);
          return;
        }
        const scale = MAX_UPLOAD_PX / Math.max(w, h);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          const name = file.name.replace(/\.[^.]+$/, '.jpg');
          resolve(new File([blob!], name, { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.92);
      };
      img.src = url;
    });
  }, []);

  return { resize };
}
