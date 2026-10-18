import type { ResourceType } from './types';

const BY_EXTENSION: [RegExp, ResourceType][] = [
  [/\.css$/, 'stylesheet'],
  [/\.(m?js|cjs)$/, 'script'],
  [/\.(woff2?|ttf|otf|eot)$/, 'font'],
  [/\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/, 'image'],
  [/\.(mp4|webm|ogg|mp3|wav|m4a|m3u8|ts|mov)$/, 'media'],
  [/\.(webmanifest)$/, 'manifest'],
];

function byUrl(url: string): ResourceType | undefined {
  let path = url;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    /* keep raw */
  }
  return BY_EXTENSION.find(([re]) => re.test(path))?.[1];
}

function byMime(mime: string | undefined): ResourceType | undefined {
  if (!mime) return undefined;
  if (mime.includes('css')) return 'stylesheet';
  if (mime.includes('javascript') || mime.includes('ecmascript')) return 'script';
  if (mime.startsWith('font/') || mime.includes('font')) return 'font';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/') || mime.startsWith('audio/')) return 'media';
  if (mime.includes('manifest')) return 'manifest';
  if (mime.includes('html')) return 'document';
  return undefined;
}

/** Maps a PerformanceResourceTiming initiatorType (+ url/mime hints) to a DevTools-like type. */
export function inferType(initiatorType: string, url: string, mime?: string): ResourceType {
  switch (initiatorType) {
    case 'fetch':
      return 'fetch';
    case 'xmlhttprequest':
      return 'xhr';
    case 'img':
    case 'image':
    case 'input':
      return 'image';
    case 'script':
      return 'script';
    case 'iframe':
    case 'frame':
    case 'navigation':
      return 'document';
    case 'video':
    case 'audio':
    case 'track':
      return 'media';
    case 'css':
    case 'link':
    case 'other':
    default:
      return byUrl(url) ?? byMime(mime) ?? (initiatorType === 'css' ? 'image' : 'other');
  }
}

export function fromWebRequestType(type: string): ResourceType | undefined {
  switch (type) {
    case 'main_frame':
    case 'sub_frame':
      return 'document';
    case 'stylesheet':
      return 'stylesheet';
    case 'script':
      return 'script';
    case 'image':
      return 'image';
    case 'font':
      return 'font';
    case 'media':
      return 'media';
    case 'websocket':
      return 'websocket';
    default:
      return undefined;
  }
}
