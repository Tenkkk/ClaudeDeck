export type ImageSource =
  | { kind: 'local'; source: string }
  | { kind: 'remote' | 'data'; source: string }
  | { kind: 'unsupported' }

/** 不让模型提供的任意协议进入 img 或系统 shell。 */
export function imageSource(source: string, baseDir = ''): ImageSource {
  if (/^data:/i.test(source)) {
    return source.length <= 28 * 1024 * 1024 && /^data:image\/(png|jpeg|gif|webp);base64,[a-z\d+/=]+$/i.test(source)
      ? { kind: 'data', source } : { kind: 'unsupported' }
  }
  if (/^https:/i.test(source)) {
    try {
      const url = new URL(source)
      if (!url.username && !url.password) return { kind: 'remote', source: url.href }
    } catch { /* 非法 URL */ }
    return { kind: 'unsupported' }
  }
  if (/^[\\/]{2}/.test(source) || (/^[a-z][a-z\d+.-]*:/i.test(source) &&
    !/^file:/i.test(source) && !/^[a-z]:[\\/]/i.test(source))) return { kind: 'unsupported' }
  const absolute = /^file:|^[a-z]:[\\/]|^[\\/]/i.test(source)
  return { kind: 'local', source: !absolute && baseDir ? `${baseDir}/${source}` : source }
}
