import {
  isMacDownloadConfigured,
  macDownloadHref,
  macDownloadLabel,
} from '@shared/download';

interface Props {
  className?: string;
  /** Used when VITE_DOWNLOAD_MAC_URL is not set (e.g. `/#download` off the home page). */
  fallbackHref?: string;
  /** Shorter label for compact CTAs. */
  short?: boolean;
  children?: string;
}

export function DownloadButton({
  className = 'btn btn-primary',
  fallbackHref = '#download',
  short = false,
  children,
}: Props) {
  const configured = isMacDownloadConfigured();
  const href = macDownloadHref(fallbackHref);
  const label = children ?? macDownloadLabel(short);

  return (
    <a
      className={className}
      href={href}
      {...(configured
        ? {
            download: true as const,
            rel: 'noopener noreferrer',
            target: '_blank' as const,
          }
        : {})}
      data-download-ready={configured ? 'true' : 'false'}
    >
      {label}
    </a>
  );
}
