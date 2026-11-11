/**
 * Distribution channel detection — gates Stripe vs StoreKit vs Electron updater UI.
 */

export type DistributionChannel = 'web' | 'mac_direct' | 'mac_mas';

/** Injected at build time for packaged Electron; falls back to runtime heuristics. */
declare const __DISTRIBUTION_CHANNEL__: string | undefined;

export function getDistributionChannel(): DistributionChannel {
  // Desktop runtime wins — Vite may inject `web` during shared builds.
  if (typeof window !== 'undefined' && window.mockupDesktop) {
    try {
      const fromApi = window.mockupDesktop.getDistributionChannel?.();
      if (fromApi === 'mac_mas' || fromApi === 'mac_direct' || fromApi === 'web') {
        return fromApi;
      }
    } catch {
      /* fall through */
    }
    return 'mac_direct';
  }

  try {
    if (typeof __DISTRIBUTION_CHANNEL__ === 'string') {
      if (__DISTRIBUTION_CHANNEL__ === 'mac_mas') return 'mac_mas';
      if (__DISTRIBUTION_CHANNEL__ === 'mac_direct') return 'mac_direct';
      if (__DISTRIBUTION_CHANNEL__ === 'web') return 'web';
    }
  } catch {
    /* ignore */
  }

  return 'web';
}

export function isDirectDesktopBuild(): boolean {
  return getDistributionChannel() === 'mac_direct';
}

export function isMasBuild(): boolean {
  return getDistributionChannel() === 'mac_mas';
}

export function supportsStripeBilling(): boolean {
  const channel = getDistributionChannel();
  return channel === 'web' || channel === 'mac_direct';
}

export function supportsElectronUpdater(): boolean {
  return getDistributionChannel() === 'mac_direct' && Boolean(window.mockupDesktop?.checkForUpdates);
}

export function supportsDeviceSeats(): boolean {
  return getDistributionChannel() === 'mac_direct';
}

export function supportsAppleIap(): boolean {
  return getDistributionChannel() === 'mac_mas';
}
