import { useEffect, useState } from 'react';

type UpdateStatus = {
  state: 'idle' | 'downloading' | 'ready';
  version?: string | null;
  percent?: number;
};

export default function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    const api = window.mockupDesktop;
    if (!api?.onUpdateStatus) return undefined;
    void api.updateStatus?.().then((current) => {
      if (current) setStatus(current);
    });
    return api.onUpdateStatus(setStatus);
  }, []);

  if (!status || (status.state !== 'downloading' && status.state !== 'ready')) return null;

  return (
    <div className="update-banner" role="status">
      {status.state === 'ready' ? (
        <>
          <span>Update{status.version ? ` ${status.version}` : ''} is ready.</span>
          <button type="button" onClick={() => void window.mockupDesktop?.installUpdate?.()}>
            Restart
          </button>
        </>
      ) : (
        <span>
          Downloading update
          {typeof status.percent === 'number' ? ` ${status.percent}%` : '…'}
        </span>
      )}
    </div>
  );
}
