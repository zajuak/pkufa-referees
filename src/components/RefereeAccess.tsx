import { useState, type ReactNode, type FormEvent } from 'react';
import { KeyRound, LogOut } from 'lucide-react';
import { api, useData } from '../hooks/useData';
import { PageHeader } from './ui';

export default function RefereeAccess({ children }: { children: ReactNode }) {
  const { data, refresh } = useData();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try { await api('/api/referee-login', { method: 'POST', body: JSON.stringify({ username, password }) }); await refresh(); setPassword(''); }
    catch (e) { setMessage(e instanceof Error ? e.message : '登录失败'); }
    finally { setBusy(false); }
  };
  if (!data?.access || data.access.role === 'admin') return children;
  if (data.access.role === 'public') return <div className="page"><PageHeader eyebrow="REFEREE QUERY" title="裁判员查询" description="赛程无需登录。查询个人积分和工资，请使用管理员发放的查询账号。" /><form className="panel login-form referee-login" onSubmit={submit}><KeyRound size={25} /><h2>个人查询登录</h2><label>姓名或档案编号<input autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} placeholder="例如：姓名或 ref-001" /></label><label>查询密码<input autoComplete="current-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>{message && <p role="alert" className="form-error">{message}</p>}<button className="button primary full" disabled={busy}>{busy ? '正在登录…' : '查询我的积分和工资'}</button><p className="adjustment-help">尚未领取密码、忘记密码或有同名档案时，请联系裁判部管理员。登录后仅显示本人资料。</p></form></div>;
  return <><div className="query-session"><span>个人查询 · {data.referees[0]?.name}</span><button className="button secondary" onClick={() => { setChanging(!changing); setMessage(''); }}>修改密码</button><button className="button secondary" onClick={() => void (async () => { await api('/api/logout', { method: 'POST' }); await refresh(); })()}><LogOut size={15} />退出查询</button></div>{changing && <form className="panel query-password" onSubmit={(event) => { event.preventDefault(); setBusy(true); setMessage(''); void (async () => { try { await api('/api/me/password', { method: 'POST', body: JSON.stringify({ oldPassword, password: newPassword }) }); setOldPassword(''); setNewPassword(''); setMessage('密码已修改，旧登录状态已失效。'); } catch (e) { setMessage(e instanceof Error ? e.message : '修改失败'); } finally { setBusy(false); } })(); }}><label>原密码<input type="password" autoComplete="current-password" required value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} /></label><label>新密码<input type="password" autoComplete="new-password" required minLength={10} maxLength={100} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></label><button className="button primary" disabled={busy}>保存新密码</button>{message && <p role="status">{message}</p>}</form>}{children}</>;
}
