import type { ServiceId } from '../../lib/services.ts';
import { STATUSES, statusLabel, type StatusId } from '../../lib/status.ts';

export function StatusBadge({ status, service }: { status: StatusId; service?: ServiceId }) {
  return <span className={`badge badge--${STATUSES[status].tone}`}>{statusLabel(status, service)}</span>;
}
