/** Application chrome: landmarks, navigation, update status, GitHub sync status. */

import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { usePreferences } from './providers';
import { useAnnounceRoute } from './hooks';
import { SyncStatusPill } from '../modules/books/SyncStatusPill';
import {
  BrandMark,
  IconBook,
  IconCards,
  IconGear,
  IconGrid,
  IconPen,
  IconSearch,
} from './icons';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

/**
 * Five primary destinations (D-22). Both the desktop sidebar and the mobile bottom bar render this
 * same list, so a route can never exist in one and be missing from the other.
 */
const PRIMARY_NAV: NavItem[] = [
  { to: '/books', label: 'Sách & Khóa học', icon: <IconBook /> },
  { to: '/', label: 'Từ điển', icon: <IconSearch />, end: true },
  { to: '/study', label: 'Ôn tập', icon: <IconCards /> },
  { to: '/writing', label: 'Tập viết', icon: <IconPen /> },
  { to: '/library', label: 'Sổ tay', icon: <IconGrid /> },
];

/** Destinations reachable from the header/sidebar, not part of the five primary tabs. */
const SECONDARY_NAV: NavItem[] = [
  { to: '/reader', label: 'Dán văn bản', icon: <IconBook /> },
  { to: '/progress', label: 'Tiến độ', icon: <IconCards /> },
  { to: '/test', label: 'Kiểm tra', icon: <IconPen /> },
];

function UpdateBanner() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const registration = registerSW({
      immediate: true,
      onNeedRefresh() {
        setAvailable(true);
      },
      onOfflineReady() {
        setAvailable(false);
      },
    });
    return () => void registration;
  }, []);
  if (!available) return null;
  return (
    <div className="notice notice-info update-banner" role="status">
      <div className="row-wrap">
        <span>Có bản mới. Cập nhật không làm mất ghi chú hay lịch ôn tập của bạn.</span>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => window.location.reload()}>
          Cập nhật ngay
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setAvailable(false)}>
          Để sau
        </button>
      </div>
    </div>
  );
}

function OfflinePill() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  if (online) return null;
  return <span className="badge badge-warn offline-pill">Ngoại tuyến</span>;
}

export function Shell() {
  const { prefs } = usePreferences();
  const location = useLocation();
  useAnnounceRoute(location.pathname);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Bỏ qua tới nội dung
      </a>

      <nav className="app-sidebar" aria-label="Khu vực chính">
        <Link to="/" className="brand" aria-label="Hán Ngữ — trang chủ">
          <BrandMark />
          <span>
            Hán Ngữ
            <span className="visually-hidden"> — từ điển và giáo trình</span>
          </span>
        </Link>
        {PRIMARY_NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end}>
            {item.icon}
            <span>{item.label}</span>
          </NavLink>
        ))}
        <p className="side-title">Công cụ</p>
        {SECONDARY_NAV.map((item) => (
          <NavLink key={item.to} to={item.to}>
            {item.icon}
            <span>{item.label}</span>
          </NavLink>
        ))}
        <span className="spacer" />
        <p className="side-title">Trạng thái</p>
        <p className="text-sm faint" style={{ padding: '0 0.75rem' }}>
          <OfflinePill />
          <span>Gói dữ liệu: {prefs.installedPacks.length || '…'}</span>
        </p>
        <Link to="/settings" className="btn btn-ghost btn-sm">
          <IconGear /> Cài đặt &amp; bản quyền
        </Link>
      </nav>

      <div className="app-body">
        <header className="app-bar">
          <Link to="/" className="brand" aria-label="Hán Ngữ — trang chủ">
            <BrandMark />
            <span>Hán Ngữ</span>
          </Link>
          <span className="spacer" />
          <SyncStatusPill />
          <OfflinePill />
          <Link to="/settings" className="btn btn-ghost btn-icon" aria-label="Cài đặt">
            <IconGear />
          </Link>
        </header>

        <main id="main" className="app-main">
          <UpdateBanner />
          <Outlet />
        </main>

        <nav className="app-nav" aria-label="Điều hướng chính">
          {PRIMARY_NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
