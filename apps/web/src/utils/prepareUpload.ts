/** 与服务端 multer limits.fileSize 一致 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** 证件照识别与人工核对都用不到更高的分辨率；长边压到这里，体积通常降到 1MB 以内 */
const MAX_EDGE = 2400;
const COMPRESS_ABOVE_BYTES = 1.5 * 1024 * 1024;

export type PreparedUpload = { ok: true; file: File } | { ok: false; reason: string };

const isHeic = (f: File) => /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);

/**
 * 上传前处理：
 * - 大图片在浏览器里等比缩小并转 JPEG（手机原图常超过 10MB，传完才失败太浪费流量和时间）；
 * - 处理后仍超限、或 PDF 超限，直接给出原因，不发请求；
 * - HEIC（iPhone 默认格式）浏览器无法解码时，提示改用「兼容性最佳」或截图。
 */
export async function prepareUpload(file: File): Promise<PreparedUpload> {
  const image = file.type.startsWith('image/') || isHeic(file);
  if (image && (file.size > COMPRESS_ABOVE_BYTES || isHeic(file))) {
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (blob) {
        file = new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
      }
    } catch {
      if (isHeic(file)) {
        return {
          ok: false,
          reason: '当前浏览器无法读取 HEIC 格式照片。请在相机设置中选择「兼容性最佳」，或截图后上传',
        };
      }
      // 其他格式解码失败就按原文件走，交给大小校验与服务端
    }
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: `文件 ${(file.size / 1024 / 1024).toFixed(1)}MB，超过 10MB 上限，请压缩或分页后再传` };
  }
  return { ok: true, file };
}
