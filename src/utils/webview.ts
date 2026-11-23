export const PRODUCTION_ORIGIN = 'https://conversorworldpdffeitosa.netlify.app';

const ALLOWED_BRIDGE_HOSTNAMES = new Set([
  'conversorworldpdffeitosa.netlify.app',
  'appassets.androidplatform.net',
  'localhost',
  '127.0.0.1',
]);

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export interface NativeAndroidBridge {
  saveFile?: (base64Data: string, fileName: string, mimeType: string) => void;
  downloadBase64?: (base64Data: string, fileName: string, mimeType: string) => void;
}

declare global {
  interface Window {
    Android?: NativeAndroidBridge;
    AndroidBridge?: NativeAndroidBridge;
    AndroidInterface?: NativeAndroidBridge;
    ReactNativeWebView?: {
      postMessage: (message: string) => void;
    };
    Capacitor?: {
      isNativePlatform?: () => boolean;
    };
  }
}

export function isTrustedBridgeOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  const { protocol, hostname } = window.location;
  if (protocol === 'file:') return true;
  if (protocol === 'https:' && ALLOWED_BRIDGE_HOSTNAMES.has(hostname)) return true;
  if (protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1')) {
    return true;
  }
  return false;
}

export function sanitizeDownloadFileName(rawName: string): string {
  const leaf = rawName.split(/[/\\]/).pop() ?? 'documento';
  const cleaned = leaf
    .replace(/[\x00-\x1f\x7f<>:"|?*]/g, '')
    .replace(/^\.+/, '')
    .trim();
  const safe = cleaned || 'documento';
  return safe.length > 120 ? safe.slice(0, 120) : safe;
}

export function isAndroidWebView(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }

  const ua = navigator.userAgent || '';
  const hasNativeBridge = Boolean(
    window.Android ||
      window.AndroidBridge ||
      window.AndroidInterface ||
      window.ReactNativeWebView ||
      window.Capacitor?.isNativePlatform?.()
  );

  if (hasNativeBridge) {
    return true;
  }

  if (window.location.protocol === 'file:') {
    return true;
  }

  if (/Android/i.test(ua) && (/;\s*wv\)/i.test(ua) || /Version\/\d+\.\d+/i.test(ua))) {
    return true;
  }

  return false;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Falha ao preparar arquivo para download no WebView.'));
      }
    };
    reader.onerror = () => {
      reject(new Error('Erro ao ler dados do arquivo convertido.'));
    };
    reader.readAsDataURL(blob);
  });
}

function triggerAnchorDownload(href: string, fileName: string): void {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  anchor.rel = 'noopener noreferrer';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export async function downloadForWebViewOrBrowser(
  blob: Blob,
  blobUrl: string,
  rawFileName: string
): Promise<'bridge' | 'data-url' | 'blob-url'> {
  const fileName = sanitizeDownloadFileName(rawFileName);
  const inferredMime = fileName.toLowerCase().endsWith('.pdf')
    ? 'application/pdf'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const mimeType = ALLOWED_MIME_TYPES.has(blob.type) ? blob.type : inferredMime;

  const nativeBridge = window.AndroidBridge || window.Android || window.AndroidInterface;
  const hasReactNativeBridge = Boolean(window.ReactNativeWebView?.postMessage);

  // Only invoke native APK bridges when running inside a verified origin
  if (
    isTrustedBridgeOrigin() &&
    (nativeBridge?.saveFile || nativeBridge?.downloadBase64 || hasReactNativeBridge)
  ) {
    const dataUrl = await blobToDataUrl(blob);
    const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

    if (nativeBridge?.saveFile) {
      nativeBridge.saveFile(base64, fileName, mimeType);
      return 'bridge';
    }
    if (nativeBridge?.downloadBase64) {
      nativeBridge.downloadBase64(base64, fileName, mimeType);
      return 'bridge';
    }
    if (window.ReactNativeWebView?.postMessage) {
      window.ReactNativeWebView.postMessage(
        JSON.stringify({
          type: 'WORDPDF_DOWNLOAD',
          fileName,
          mimeType,
          base64,
        })
      );
      return 'bridge';
    }
  }

  // Android WebView without a custom JS bridge: use data: URI for DownloadListener
  if (isAndroidWebView()) {
    const dataUrl = await blobToDataUrl(blob);
    triggerAnchorDownload(dataUrl, fileName);
    return 'data-url';
  }

  // Standard browser: fast blob: URL download
  triggerAnchorDownload(blobUrl, fileName);
  return 'blob-url';
}

export function canShareFiles(blob: Blob, rawFileName: string): boolean {
  if (typeof navigator === 'undefined' || !navigator.share || !navigator.canShare) {
    return false;
  }
  try {
    const fileName = sanitizeDownloadFileName(rawFileName);
    const mimeType = fileName.toLowerCase().endsWith('.pdf')
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const file = new File([blob], fileName, { type: mimeType });
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export async function shareConvertedFile(blob: Blob, rawFileName: string): Promise<void> {
  const fileName = sanitizeDownloadFileName(rawFileName);
  const mimeType = fileName.toLowerCase().endsWith('.pdf')
    ? 'application/pdf'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const file = new File([blob], fileName, { type: mimeType });
  await navigator.share({
    title: fileName,
    files: [file],
  });
}
