/** Application chrome: landmarks, navigation, update and offline status. */

import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { usePreferences } from './providers';
import { useAnnounceRoute } from './hooks';
import {
  BrandMark,
  IconBook,
  IconCamera,
  IconCards,
  IconDownload,
  IconGear,
  IconGrid,
  IconPen,
  IconSearch,
  IconSpark,
} from './icons';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: 'Dictionary', icon: <IconSearch />, end: true },
  { to: '/library', label: 'Library', icon: <IconGrid /> },
  { to: '/practice', label: 'Practice', icon: <IconCards /> },
  { to: '/learn', label: 'Learn', icon: <IconBook /> },
  { to: '/settings', label: 'Settings', icon: <IconGear /> },
];

const SECONDARY_NAV: NavItem[] = [
  { to: '/capture', label: 'Camera & OCR', icon: <IconCamera /> },
  { to: '/reader', label: 'Reader', icon: <IconBook /> },
  { to: '/writing', label: 'Writing practice', icon: <IconPen /> },
  { to: '/progress', label: 'Progress', icon: <IconSpark /> },
  { to: '/offline-data', label: 'Offline data', icon: <IconDownload /> },
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
        <span>A new version is ready. Updating does not delete your notes or study schedule.</span>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => window.location.reload()}>
          Update now
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setAvailable(false)}>
          Later
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
  return (
    <span className="badge badge-warn offline-pill">
      Offline — installed data only
    </span>
  );
}

export function Shell() {
  const { prefs } = usePreferences();
  const location = useLocation();
  useAnnounceRoute(location.pathname);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <nav className="app-sidebar" aria-label="Main sections">
        <Link to="/" className="brand" aria-label="Hanyu Dictionary home">
          <BrandMark />
          <span>
            Hanyu Dictionary
            <span className="visually-hidden"> — independent, offline-capable</span>
          </span>
        </Link>
        {PRIMARY_NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end}>
            {item.icon}
            <span>{item.label}</span>
          </NavLink>
        ))}
        <p className="side-title">Tools</p>
        {SECONDARY_NAV.map((item) => (
          <NavLink key={item.to} to={item.to}>
            {item.icon}
            <span>{item.label}</span>
          </NavLink>
        ))}
        <span className="spacer" />
        <p className="side-title">Status</p>
        <p className="text-sm faint" style={{ padding: '0 0.75rem' }}>
          <OfflinePill />
          <span>Data packs: {prefs.installedPacks.length || 'checking'}</span>
        </p>
        <Link to="/about" className="btn btn-ghost btn-sm">
          About &amp; licences
        </Link>
      </nav>

      <div className="app-body">
        <header className="app-bar">
          <Link to="/" className="brand" aria-label="Hanyu Dictionary home">
            <BrandMark />
            <span>Hanyu Dictionary</span>
          </Link>
          <span className="spacer" />
          <OfflinePill />
          <Link to="/settings" className="btn btn-ghost btn-icon" aria-label="Settings">
            <IconGear />
          </Link>
        </header>

        <main id="main" className="app-main">
          <UpdateBanner />
          <Outlet />
        </main>

        <nav className="app-nav" aria-label="Primary">
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
