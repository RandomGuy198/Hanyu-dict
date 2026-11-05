/** Compact GitHub-sync status pill shown in the app bar. */

import { useEffect, useState } from 'react';
import { getSyncStatus, subscribeSyncStatus, type SyncStatus } from '../../data/syncStatus';

const LABELS: Record<SyncStatus['phase'], string> = {
  disconnected: 'Chưa kết nối GitHub',
  idle: 'Đã kết nối',
  syncing: 'Đang đồng bộ…',
  synced: 'Đã đồng bộ',
  error: 'Lỗi đồng bộ — thử lại',
  offline: 'Ngoại tuyến',
};

export function SyncStatusPill() {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus);

  useEffect(() => subscribeSyncStatus(setStatus), []);

  const tone =
    status.phase === 'error'
      ? 'badge badge-danger'
      : status.phase === 'synced'
        ? 'badge badge-ok'
        : status.phase === 'syncing'
          ? 'badge badge-info'
          : 'badge';

  return (
    <span className={tone} title={status.message ?? LABELS[status.phase]} role="status" aria-live="polite">
      {LABELS[status.phase]}
    </span>
  );
}
