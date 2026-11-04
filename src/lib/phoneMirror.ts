/** USB iPhone / iPad screen mirroring via macOS camera capture (same path QuickTime uses). */

export type MirrorDevice = {
  deviceId: string;
  label: string;
  /** True when the label looks like Continuity Camera (rear cam), not screen mirror */
  continuityLikely: boolean;
};

const IOS_LABEL = /\b(iphone|ipad|ipod)\b/i;
const CONTINUITY_LABEL = /continuity|desk\s*view|iphone\s*camera|wide\s*angle|ultra\s*wide|center\s*stage/i;

export function isDesktopApp() {
  return typeof window !== 'undefined' && Boolean(window.mockupDesktop);
}

export function looksLikeIosCaptureDevice(label: string) {
  return IOS_LABEL.test(label || '');
}

export function isContinuityLikely(label: string) {
  return CONTINUITY_LABEL.test(label || '');
}

let labelsUnlocked = false;

async function unlockDeviceLabels() {
  if (labelsUnlocked || !navigator.mediaDevices?.getUserMedia) return;
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    probe.getTracks().forEach((t) => t.stop());
    labelsUnlocked = true;
  } catch {
    // Permission denied — enumerate may still return unlabeled devices.
  }
}

export async function listMirrorDevices(options?: { unlockLabels?: boolean }): Promise<MirrorDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];

  let devices = await navigator.mediaDevices.enumerateDevices();
  const videoInputs = devices.filter((d) => d.kind === 'videoinput' && d.deviceId);
  const labelsMissing = videoInputs.some((d) => !d.label);

  // Labels stay blank until camera permission has been granted once.
  if (labelsMissing && (options?.unlockLabels || labelsUnlocked)) {
    if (options?.unlockLabels) await unlockDeviceLabels();
    devices = await navigator.mediaDevices.enumerateDevices();
  }

  const ios = devices
    .filter((d) => d.kind === 'videoinput' && d.deviceId && looksLikeIosCaptureDevice(d.label))
    .map((d) => ({
      deviceId: d.deviceId,
      label: d.label || 'iOS device',
      continuityLikely: isContinuityLikely(d.label),
    }));

  // Prefer USB screen-mirror candidates over Continuity Camera.
  ios.sort((a, b) => Number(a.continuityLikely) - Number(b.continuityLikely));
  return ios;
}

export async function startPhoneMirror(deviceId?: string): Promise<{
  stream: MediaStream;
  device: MirrorDevice;
}> {
  if (window.mockupDesktop?.ensureCameraAccess) {
    const access = await window.mockupDesktop.ensureCameraAccess();
    if (!access.granted) {
      throw new Error(
        access.reason
        || 'Camera permission is required to mirror your iPhone. Enable it in System Settings → Privacy & Security → Camera.',
      );
    }
  }

  const available = await listMirrorDevices({ unlockLabels: true });
  if (!available.length) {
    throw new Error(
      'No iPhone or iPad found. Plug in with a data USB cable, unlock the phone, and tap Trust — then try Mirror again.',
    );
  }

  const preferred = deviceId
    ? available.find((d) => d.deviceId === deviceId) ?? available[0]
    : available[0];

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      deviceId: { exact: preferred.deviceId },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    },
  });

  return { stream, device: preferred };
}

export function stopPhoneMirror(stream: MediaStream | null | undefined) {
  if (!stream) return;
  stream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      /* ignore */
    }
  });
}

function waitForVideoFrame(video: HTMLVideoElement, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const tick = () => {
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        resolve();
        return;
      }
      if (performance.now() - start > timeoutMs) {
        reject(new Error('Mirror stream never produced a frame'));
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

/** Capture the current mirror frame as a PNG data URL for the device screen. */
export async function snapshotMirrorStream(stream: MediaStream): Promise<string> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;

  try {
    await video.play();
    await waitForVideoFrame(video);

    const width = video.videoWidth;
    const height = video.videoHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not capture snapshot');
    ctx.drawImage(video, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/png');
    if (!dataUrl.startsWith('data:image/png')) {
      throw new Error('Snapshot failed');
    }
    return dataUrl;
  } finally {
    video.pause();
    video.srcObject = null;
    video.removeAttribute('src');
    video.load();
  }
}
