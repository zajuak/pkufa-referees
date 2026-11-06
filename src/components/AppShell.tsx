import { assetUrl } from '../hooks/useData';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { BookOpen, CalendarDays, ShieldCheck, UsersRound } from 'lucide-react';

const navigation = [
  { to: '/assignments', label: '每周选派', icon: CalendarDays },
  { to: '/referees', label: '裁判员查询', icon: UsersRound },
  { to: '/rules', label: '管理办法', icon: BookOpen },
];

export default function AppShell() {
  const { pathname } = useLocation();
  const adminEntry = <NavLink to="/admin" className="admin-entry"><ShieldCheck size={14} /><span>管理员登录</span></NavLink>;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink to="/assignments" className="brand">
          <img src={assetUrl('PKUFA.png')} alt="北京大学足球协会" />
          <span><strong>北大足协</strong><small>裁判部管理平台</small></span>
        </NavLink>
        <nav className="side-nav" aria-label="主导航">
          <p className="nav-caption">工作台</p>
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              <Icon size={19} strokeWidth={1.8} /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="pulse-dot" />
          <div><strong>内部工作平台</strong><small>规则版本 · 2026 秋</small></div>
        </div>
      </aside>
      <header className="mobile-header">
        <NavLink to="/assignments" className="mobile-brand"><img src={assetUrl('PKUFA.png')} alt="" /><strong>北大足协裁判部</strong></NavLink>
        {pathname === '/admin' ? <span className="internal-tag">内部版</span> : adminEntry}
      </header>
      <main className="main-content">{pathname !== '/admin' && <div className="admin-entry-bar">{adminEntry}</div>}<Outlet /></main>
      <nav className="mobile-nav" aria-label="移动端主导航">
        {navigation.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'mobile-nav-link active' : 'mobile-nav-link'}>
            <Icon size={20} /><span>{label.replace('裁判员', '裁判').replace('管理', '')}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
