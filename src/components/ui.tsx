import type { ReactNode } from 'react';
import type { Channel, MatchStatus } from '../domain/types';
import { channelName } from '../domain/calculations';

export function ChannelBadge({ channel }: { channel: Channel }) {
  return <span className={`channel-badge ${channel}`}>{channelName(channel)}</span>;
}

export function StatusBadge({ status }: { status: MatchStatus }) {
  const labels = { scheduled: '待进行', completed: '已完成', cancelled: '已取消' };
  return <span className={`status-badge ${status}`}><span />{labels[status]}</span>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="page-description">{description}</p></div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{description}</p></div>;
}

export function StatCard({ label, value, suffix, tone }: { label: string; value: string | number; suffix?: string; tone?: string }) {
  return <div className={`stat-card ${tone || ''}`}><span>{label}</span><strong>{value}<small>{suffix}</small></strong></div>;
}
