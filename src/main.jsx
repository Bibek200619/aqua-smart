import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  Bell,
  CheckCircle2,
  CircuitBoard,
  Clock3,
  Droplets,
  Gauge,
  PlugZap,
  Power,
  Radio,
  RefreshCw,
  ShieldAlert,
  Siren,
  UsersRound,
  Waves,
  X,
  Zap,
} from 'lucide-react';
import './styles.css';

const API_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vZmZ1aWFjbHhsa2xkcWp1dndrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNjU5NzcsImV4cCI6MjA5Mjk0MTk3N30.JxKn4OywOS2-SxeWyiwfVxta-mqhHw2LMLKiDPd1pQo';
const BASE_URL = 'https://moffuiaclxlkldqjuvwk.supabase.co';
const TABLE_URL = `${BASE_URL}/rest/v1/tank?id=eq.1`;

const EMPTY_DISTANCE_CM = 12;
const FULL_DISTANCE_CM = 5;
const POLL_INTERVAL_MS = 2500;
const OFFLINE_TIMEOUT_MS = 9000;

const TEAM_MEMBERS = [
  'Bibek Kumar Shah',
  'Lenin Sarmah',
  'Bhoomi Gupta',
  'Avani Kulkarni',
  'Haleema sadiya Rida Khan',
];

const COMPONENTS = [
  'Ultrasonic Sensor (JSN-SR04T) - 1',
  'ESP8266 - 1',
  '1-Channel Relay - 1',
  'Submersible Water Pump - 1',
  'USB Cable - 1',
  'M-M Jumper Wires - 10',
  'M-F Jumper Wires - 10',
  'F-F Jumper Wires - 10',
  'Breadboard - 1',
  'Buzzer - 1',
  '12V Adapter - 1',
];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePump(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    return ['true', 'on', '1', 'yes'].includes(value.trim().toLowerCase());
  }
  return false;
}

function waterPercentFromDistance(distance) {
  const distanceCm = toNumber(distance);
  if (distanceCm === null) return null;

  const span = EMPTY_DISTANCE_CM - FULL_DISTANCE_CM;
  return Math.round(clamp(((EMPTY_DISTANCE_CM - distanceCm) / span) * 100, 0, 100));
}

function resolveTankStatus(row, waterPercent) {
  if (!row || waterPercent === null) return 'NO_DATA';

  const rawStatus = String(row.status || '').toUpperCase();
  const distance = toNumber(row.distance);

  if (rawStatus.includes('OVERFLOW') || rawStatus.includes('FULL') || waterPercent >= 95 || distance <= FULL_DISTANCE_CM) {
    return 'OVERFLOW';
  }

  if (rawStatus.includes('LOW') || waterPercent <= 25 || distance > EMPTY_DISTANCE_CM) {
    return 'LOW';
  }

  return 'NORMAL';
}

function normalizeTankRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    distance: toNumber(row.distance),
    status: row.status || '',
    pump: row.pump ?? 'OFF',
    buzzer: row.buzzer ?? 'OFF',
    mode: row.mode || 'AUTO',
    updated_at: row.updated_at || null,
  };
}

function tankSignature(tank) {
  if (!tank) return '';

  return JSON.stringify({
    distance: tank.distance,
    status: tank.status,
    pump: normalizePump(tank.pump) ? 'ON' : 'OFF',
    buzzer: tank.buzzer,
    mode: tank.mode,
    updated_at: tank.updated_at,
  });
}

function formatTime(value) {
  if (!value) return 'No data available';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No data available';

  return date.toLocaleString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: 'short',
  });
}

function getStatusTone(status) {
  if (status === 'OVERFLOW') return 'danger';
  if (status === 'LOW') return 'warning';
  if (status === 'NORMAL') return 'success';
  return 'muted';
}

function notificationIcon(type) {
  if (type === 'danger') return <ShieldAlert size={18} />;
  if (type === 'warning') return <Gauge size={18} />;
  if (type === 'success') return <CheckCircle2 size={18} />;
  return <Activity size={18} />;
}

async function fetchTankRow() {
  const response = await fetch(TABLE_URL, {
    method: 'GET',
    headers: {
      apikey: API_KEY,
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Supabase responded with ${response.status}`);
  }

  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

async function patchPumpState(nextPumpState) {
  // Supabase pump control endpoint. The payload is intentionally only the pump value.
  const response = await fetch(TABLE_URL, {
    method: 'PATCH',
    headers: {
      apikey: API_KEY,
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ pump: nextPumpState }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Pump update failed with ${response.status}`);
  }

  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] : rows;
}

function Header({
  isDeviceOnline,
  isPanelOpen,
  notifications,
  onTogglePanel,
  onClosePanel,
  onMarkAllRead,
  onMarkRead,
}) {
  const unreadCount = notifications.filter((item) => !item.read).length;

  return (
    <header className="site-header">
      <a className="brand" href="#dashboard" aria-label="IoT Smart Water Tank dashboard">
        <span className="brand-mark">
          <Droplets size={22} />
        </span>
        <span>
          <strong>IoT Smart Water Tank</strong>
          <small>Cloud Control Dashboard</small>
        </span>
      </a>

      <nav className="nav-links" aria-label="Dashboard sections">
        <a href="#dashboard">Dashboard</a>
        <a href="#about">Project</a>
        <a href="#team">Team</a>
      </nav>

      <div className="header-actions">
        <span className={`live-chip ${isDeviceOnline ? 'online' : 'offline'}`}>
          <Radio size={15} />
          {isDeviceOnline ? 'Online' : 'Offline'}
        </span>
        <button className="icon-button bell-button" type="button" onClick={onTogglePanel} aria-label="Open notifications">
          <Bell size={21} />
          {unreadCount > 0 && <span className="notification-count">{Math.min(unreadCount, 9)}</span>}
        </button>
      </div>

      <NotificationPanel
        isOpen={isPanelOpen}
        notifications={notifications}
        unreadCount={unreadCount}
        onClose={onClosePanel}
        onMarkRead={onMarkRead}
        onMarkAllRead={onMarkAllRead}
      />
    </header>
  );
}

function NotificationPanel({ isOpen, notifications, unreadCount, onClose, onMarkRead, onMarkAllRead }) {
  return (
    <aside className={`notification-panel ${isOpen ? 'open' : ''}`} aria-hidden={!isOpen}>
      <div className="panel-head">
        <div>
          <p>Alert Center</p>
          <strong>{unreadCount} unread</strong>
        </div>
        <button className="icon-button ghost" type="button" onClick={onClose} aria-label="Close notifications">
          <X size={19} />
        </button>
      </div>

      <div className="panel-toolbar">
        <span>{notifications.length ? `${notifications.length} live events` : 'No notifications yet'}</span>
        <button type="button" onClick={onMarkAllRead} disabled={!unreadCount}>
          Mark all as read
        </button>
      </div>

      <div className="notification-list">
        {notifications.length === 0 ? (
          <div className="empty-notifications">Live alerts from Supabase will appear here.</div>
        ) : (
          notifications.map((item) => (
            <button
              className={`notification-card ${item.type} ${item.read ? 'read' : 'unread'}`}
              key={item.id}
              type="button"
              onClick={() => onMarkRead(item.id)}
            >
              <span className="notification-icon">{notificationIcon(item.type)}</span>
              <span className="notification-copy">
                <strong>{item.title}</strong>
                <span>{item.message}</span>
                <time>{formatTime(item.time)}</time>
              </span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

function AlertBanner({ status, pumpOn, hasData, isDeviceOnline, lastLiveDataAt }) {
  if (!hasData) {
    return (
      <section className="alert-banner muted" aria-live="polite">
        <span>
          <Activity size={20} />
        </span>
        <div>
          <strong>No data available</strong>
          <p>The dashboard is waiting for the tank row from Supabase.</p>
        </div>
      </section>
    );
  }

  if (!isDeviceOnline) {
    return (
      <section className="alert-banner offline" aria-live="polite">
        <span>
          <ShieldAlert size={20} />
        </span>
        <div>
          <strong>Device Offline</strong>
          <p>Device is offline. Showing last known data from {formatTime(lastLiveDataAt)}.</p>
        </div>
      </section>
    );
  }

  const copy = {
    LOW: {
      title: 'Low Water Level',
      message: 'Water is below the safe range. Pump control is available from the dashboard.',
      tone: 'warning',
    },
    OVERFLOW: {
      title: 'Overflow Threshold',
      message: 'Tank is near maximum capacity. Turn the pump off if it is still running.',
      tone: 'danger',
    },
    NORMAL: {
      title: 'System Stable',
      message: `Tank level is within safe range. Pump is currently ${pumpOn ? 'ON' : 'OFF'}.`,
      tone: 'normal',
    },
  };

  const content = copy[status] || copy.NORMAL;

  return (
    <section className={`alert-banner ${content.tone}`} aria-live="polite">
      <span>{content.tone === 'normal' ? <CheckCircle2 size={20} /> : <ShieldAlert size={20} />}</span>
      <div>
        <strong>{content.title}</strong>
        <p>{content.message}</p>
      </div>
    </section>
  );
}

function TankVisual({ waterPercent, status, distance, hasData, isDeviceOnline }) {
  const displayPercent = hasData && waterPercent !== null ? `${waterPercent}%` : '--';
  const waterHeight = hasData && waterPercent !== null ? waterPercent : 0;

  return (
    <section
      className={`tank-stage ${status.toLowerCase()} ${hasData && !isDeviceOnline ? 'device-offline' : ''}`}
      aria-label="Animated live tank level"
    >
      <div className="tank-status-row">
        <span>
          <Waves size={18} />
          {hasData && !isDeviceOnline ? 'Last Known Tank Level' : 'Live Tank Level'}
        </span>
        <strong>{hasData ? status : 'NO DATA'}</strong>
      </div>

      <div className="tank-wrap">
        <div className={`tank-glass ${!hasData ? 'no-data' : ''}`}>
          <div className="tick tick-top">100%</div>
          <div className="tick tick-mid">50%</div>
          <div className="tick tick-low">0%</div>
          <div className="tank-water" style={{ height: `${waterHeight}%` }}>
            <span className="wave wave-a" />
            <span className="wave wave-b" />
            <span className="bubble bubble-a" />
            <span className="bubble bubble-b" />
            <span className="bubble bubble-c" />
          </div>
          <div className="tank-shine" />
          <div className="level-number">
            <strong>{displayPercent}</strong>
            <span>{hasData && distance !== null ? `${distance.toFixed(1)} cm` : 'No data available'}</span>
          </div>
        </div>
      </div>

      <div className="tank-footer">
        <span>Empty reference: {EMPTY_DISTANCE_CM} cm</span>
        <span>Full reference: {FULL_DISTANCE_CM} cm</span>
      </div>
    </section>
  );
}

function MetricCard({ icon, label, value, detail, tone = 'normal' }) {
  return (
    <article className={`metric-card ${tone}`}>
      <span className="metric-icon">{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function StatusCards({ tank, waterPercent, status, apiConnected, isDeviceOnline, lastSuccessfulFetchAt }) {
  const hasData = Boolean(tank);
  const pumpOn = hasData ? normalizePump(tank.pump) : false;
  const statusTone = getStatusTone(status);
  const syncText = isDeviceOnline ? 'Online data stream' : 'Last known value';

  return (
    <section className="metrics-grid" aria-label="Live tank status cards">
      <MetricCard
        icon={<Droplets size={22} />}
        label="Water Level"
        value={hasData && waterPercent !== null ? `${waterPercent}%` : 'No data'}
        detail={hasData && tank.distance !== null ? `${tank.distance.toFixed(1)} cm from sensor - ${syncText}` : 'No data available'}
        tone={statusTone}
      />
      <MetricCard
        icon={<Gauge size={22} />}
        label="Tank Status"
        value={hasData ? status : 'No data'}
        detail={apiConnected ? `${isDeviceOnline ? 'Online' : 'Offline'} - API reachable` : 'Waiting for API response'}
        tone={statusTone}
      />
      <MetricCard
        icon={<Zap size={22} />}
        label="Pump Status"
        value={hasData ? (pumpOn ? 'ON' : 'OFF') : 'No data'}
        detail={hasData ? (isDeviceOnline ? 'Controls enabled' : 'Controls disabled while offline') : 'No data available'}
        tone={hasData ? (pumpOn ? 'success' : 'muted') : 'muted'}
      />
      <MetricCard
        icon={<Clock3 size={22} />}
        label="Last Updated"
        value={formatTime(tank?.updated_at)}
        detail={hasData ? `Mode: ${tank.mode} - Last API fetch: ${formatTime(lastSuccessfulFetchAt)}` : 'No data available'}
        tone="info"
      />
    </section>
  );
}

function PumpControls({ hasData, isDeviceOnline, pumpOn, loadingState, onPumpChange }) {
  const disabled = !hasData || !isDeviceOnline || Boolean(loadingState);

  return (
    <section className={`control-panel ${hasData && !isDeviceOnline ? 'offline' : ''}`} aria-label="Pump control panel">
      <div>
        <span>Remote Pump Control</span>
        <strong>
          {hasData
            ? `${isDeviceOnline ? 'Pump is' : 'Last known pump'} ${pumpOn ? 'ON' : 'OFF'}`
            : 'No data available'}
        </strong>
        {hasData && !isDeviceOnline && <p>Device is offline. Pump controls are disabled.</p>}
      </div>
      <div className="control-actions">
        <button
          className="control-button on"
          type="button"
          disabled={disabled}
          onClick={() => onPumpChange('ON')}
        >
          <Power size={18} />
          {loadingState === 'ON' ? 'Turning ON...' : 'Turn Pump ON'}
        </button>
        <button
          className="control-button off"
          type="button"
          disabled={disabled}
          onClick={() => onPumpChange('OFF')}
        >
          <Power size={18} />
          {loadingState === 'OFF' ? 'Turning OFF...' : 'Turn Pump OFF'}
        </button>
      </div>
    </section>
  );
}

function DashboardHero({
  tank,
  tankStatus,
  waterPercent,
  apiConnected,
  isDeviceOnline,
  lastLiveDataAt,
  lastSuccessfulFetchAt,
  isRefreshing,
  controlLoading,
  onRefresh,
  onPumpChange,
  lastError,
}) {
  const hasData = Boolean(tank);
  const pumpOn = hasData ? normalizePump(tank.pump) : false;

  return (
    <main id="dashboard" className="dashboard-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className={`connection-pill ${isDeviceOnline ? 'online' : 'offline'}`}>
            <span />
            {isDeviceOnline ? 'Device Online' : 'Device Offline'}
          </span>
          <span className={`api-pill ${apiConnected ? 'online' : 'offline'}`}>
            {apiConnected ? 'Supabase API reachable' : 'Supabase API unavailable'}
          </span>
          <h1>Smart Water Tank Control Center</h1>
          <p>
            Real-time ESP8266 tank telemetry, water-level intelligence, and remote relay control in one refined
            dashboard.
          </p>
          <div className="hero-actions">
            <button className="primary-button" type="button" onClick={onRefresh} disabled={isRefreshing}>
              <RefreshCw size={18} className={isRefreshing ? 'spin' : ''} />
              {isRefreshing ? 'Refreshing...' : 'Refresh Live Data'}
            </button>
            <a className="secondary-button" href="#about">
              View Project
            </a>
          </div>
          {lastError && <p className="error-note">{lastError}</p>}
        </div>

        <TankVisual
          waterPercent={waterPercent}
          status={tankStatus}
          distance={tank?.distance ?? null}
          hasData={hasData}
          isDeviceOnline={isDeviceOnline}
        />
      </section>

      <AlertBanner
        status={tankStatus}
        pumpOn={pumpOn}
        hasData={hasData}
        isDeviceOnline={isDeviceOnline}
        lastLiveDataAt={lastLiveDataAt}
      />
      <PumpControls
        hasData={hasData}
        isDeviceOnline={isDeviceOnline}
        pumpOn={pumpOn}
        loadingState={controlLoading}
        onPumpChange={onPumpChange}
      />
      <StatusCards
        waterPercent={waterPercent}
        status={tankStatus}
        tank={tank}
        apiConnected={apiConnected}
        isDeviceOnline={isDeviceOnline}
        lastSuccessfulFetchAt={lastSuccessfulFetchAt}
      />
    </main>
  );
}

function AboutProject() {
  return (
    <section id="about" className="content-section about-section">
      <div className="section-heading">
        <span>About Project</span>
        <h2>IoT-based Smart Water Tank Monitoring System</h2>
      </div>

      <div className="about-grid">
        <article className="about-copy project-statement">
          <p>
            This is an IoT-based Smart Water Tank Monitoring System using ESP8266 and cloud integration. It enables
            real-time monitoring, remote control, and prevents water overflow.
          </p>
        </article>

        <div className="feature-list">
          <div className="feature-item">
            <CheckCircle2 size={18} />
            <span>Live water level is fetched directly from Supabase every few seconds.</span>
          </div>
          <div className="feature-item">
            <CheckCircle2 size={18} />
            <span>Remote pump control uses authenticated PATCH requests to the tank table.</span>
          </div>
          <div className="feature-item">
            <CheckCircle2 size={18} />
            <span>Low-level and overflow transitions create readable alert history.</span>
          </div>
          <div className="feature-item">
            <CheckCircle2 size={18} />
            <span>The interface is responsive for presentation screens, laptops, tablets, and phones.</span>
          </div>
        </div>
      </div>

      <article className="components-panel">
        <div className="components-heading">
          <span className="hardware-icon">
            <CircuitBoard size={22} />
          </span>
          <div>
            <span>Hardware Stack</span>
            <h3>Components Used in the Project</h3>
          </div>
        </div>

        <div className="components-grid">
          {COMPONENTS.map((component, index) => (
            <div className="component-pill" key={component}>
              <span>{index === 0 ? <Waves size={17} /> : index === 10 ? <PlugZap size={17} /> : index === 9 ? <Siren size={17} /> : <CircuitBoard size={17} />}</span>
              <strong>{component}</strong>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

function TeamSection() {
  return (
    <section id="team" className="content-section team-section">
      <div className="section-heading">
        <span>Team Members</span>
        <h2>Built by the project team</h2>
      </div>

      <div className="team-grid">
        {TEAM_MEMBERS.map((member, index) => (
          <article className={`team-card member-${index + 1}`} key={member}>
            <span className="avatar">
              <UsersRound size={22} />
            </span>
            <div>
              <strong>{member}</strong>
              <p>Project Contributor</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function App() {
  const [tank, setTank] = useState(null);
  const [apiConnected, setApiConnected] = useState(false);
  const [isDeviceOnline, setIsDeviceOnline] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [controlLoading, setControlLoading] = useState(null);
  const [lastError, setLastError] = useState('');
  const [lastSuccessfulFetchAt, setLastSuccessfulFetchAt] = useState(null);
  const [lastLiveDataAt, setLastLiveDataAt] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  const previousPumpRef = useRef(null);
  const previousStatusRef = useRef(null);
  const lastSignatureRef = useRef('');
  const lastDeviceTimestampRef = useRef(0);
  const hasInitializedEventsRef = useRef(false);

  const waterPercent = useMemo(() => waterPercentFromDistance(tank?.distance), [tank?.distance]);
  const tankStatus = useMemo(() => resolveTankStatus(tank, waterPercent), [tank, waterPercent]);

  const addNotification = useCallback((title, message, type = 'info', key = '') => {
    const eventKey = key || `${title}-${message}`;

    setNotifications((current) => {
      if (current[0]?.key === eventKey && Date.now() - current[0].createdAt < 8000) {
        return current;
      }

      return [
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          key: eventKey,
          title,
          message,
          type,
          read: false,
          time: new Date().toISOString(),
          createdAt: Date.now(),
        },
        ...current,
      ].slice(0, 30);
    });
  }, []);

  const handleLiveEvents = useCallback(
    (nextTank, nextStatus, online) => {
      // Offline or initial data should never create alerts. Alerts are only for live state transitions.
      if (!online) return;

      const nextPump = normalizePump(nextTank.pump);
      const previousPump = previousPumpRef.current;
      const previousStatus = previousStatusRef.current;

      if (!hasInitializedEventsRef.current || previousStatus === null || previousPump === null) {
        hasInitializedEventsRef.current = true;
        previousPumpRef.current = nextPump;
        previousStatusRef.current = nextStatus;
        return;
      }

      if (previousStatus !== nextStatus) {
        if (nextStatus === 'LOW') {
          addNotification(
            'Low water alert',
            'Tank level moved into the LOW range.',
            'warning',
            `status-${previousStatus}-${nextStatus}-${nextTank.updated_at || Date.now()}`,
          );
        }

        if (nextStatus === 'OVERFLOW') {
          addNotification(
            'Overflow alert',
            'Tank level reached the overflow threshold.',
            'danger',
            `status-${previousStatus}-${nextStatus}-${nextTank.updated_at || Date.now()}`,
          );
        }

        if (nextStatus === 'NORMAL') {
          addNotification(
            'Tank back to normal',
            'Tank level returned to the normal operating range.',
            'success',
            `status-${previousStatus}-${nextStatus}-${nextTank.updated_at || Date.now()}`,
          );
        }
      }

      if (previousPump !== null && previousPump !== nextPump) {
        addNotification(
          nextPump ? 'Pump turned ON' : 'Pump turned OFF',
          nextPump ? 'Relay command is now ON in Supabase.' : 'Relay command is now OFF in Supabase.',
          nextPump ? 'success' : 'info',
          `pump-${previousPump ? 'ON' : 'OFF'}-${nextPump ? 'ON' : 'OFF'}-${nextTank.updated_at || Date.now()}`,
        );
      }

      previousPumpRef.current = nextPump;
      previousStatusRef.current = nextStatus;
    },
    [addNotification],
  );

  const applyTankRow = useCallback(
    (row, { force = false } = {}) => {
      const nextTank = normalizeTankRow(row);

      if (!nextTank) {
        if (!lastSignatureRef.current) {
          setTank(null);
        }
        return { changed: false, tank: null, status: 'NO_DATA' };
      }

      const nextDeviceTime = Date.parse(nextTank.updated_at || '');
      if (Number.isFinite(nextDeviceTime) && lastDeviceTimestampRef.current && nextDeviceTime < lastDeviceTimestampRef.current) {
        return { changed: false, tank: nextTank, status: resolveTankStatus(nextTank, waterPercentFromDistance(nextTank.distance)) };
      }

      const nextSignature = tankSignature(nextTank);
      if (!force && nextSignature === lastSignatureRef.current) {
        return { changed: false, tank: nextTank, status: resolveTankStatus(nextTank, waterPercentFromDistance(nextTank.distance)) };
      }

      const nextPercent = waterPercentFromDistance(nextTank.distance);
      const nextStatus = resolveTankStatus(nextTank, nextPercent);

      // A changed row is treated as fresh device telemetry. Repeated identical rows are ignored.
      lastSignatureRef.current = nextSignature;
      if (Number.isFinite(nextDeviceTime)) {
        lastDeviceTimestampRef.current = Math.max(lastDeviceTimestampRef.current, nextDeviceTime);
      }
      setLastLiveDataAt(new Date().toISOString());
      setIsDeviceOnline(true);
      setTank(nextTank);
      handleLiveEvents(nextTank, nextStatus, true);
      return { changed: true, tank: nextTank, status: nextStatus };
    },
    [handleLiveEvents],
  );

  const loadLiveTank = useCallback(async () => {
    setIsRefreshing(true);

    try {
      const row = await fetchTankRow();
      setApiConnected(true);
      setLastSuccessfulFetchAt(new Date().toISOString());

      if (!row) {
        if (!lastSignatureRef.current) {
          applyTankRow(null);
          setLastError('No data available');
        }
        return;
      }

      const result = applyTankRow(row);
      if (!result.changed) {
        // Stale/repeated responses do not refresh device-online state or create alerts.
      }
      setLastError('');
    } catch (error) {
      setApiConnected(false);
      setLastError(error.message || 'Unable to fetch live tank data');
    } finally {
      setIsRefreshing(false);
    }
  }, [applyTankRow]);

  const handlePumpChange = useCallback(
    async (nextPumpState) => {
      if (!isDeviceOnline) {
        setLastError('Device is offline. Showing last known data.');
        return;
      }

      setControlLoading(nextPumpState);
      setLastError('');

      try {
        const updatedRow = await patchPumpState(nextPumpState);

        if (updatedRow) {
          applyTankRow(updatedRow);
        } else {
          setTank((current) => {
            if (!current) return current;
            const nextTank = { ...current, pump: nextPumpState };
            const nextPercent = waterPercentFromDistance(nextTank.distance);
            lastSignatureRef.current = tankSignature(nextTank);
            setLastLiveDataAt(new Date().toISOString());
            handleLiveEvents(nextTank, resolveTankStatus(nextTank, nextPercent), true);
            return nextTank;
          });
        }

        setApiConnected(true);
        setLastSuccessfulFetchAt(new Date().toISOString());
      } catch (error) {
        setLastError(error.message || 'Unable to update pump state');
      } finally {
        setControlLoading(null);
      }
    },
    [applyTankRow, handleLiveEvents, isDeviceOnline],
  );

  const markNotificationRead = useCallback((id) => {
    setNotifications((current) => current.map((item) => (item.id === id ? { ...item, read: true } : item)));
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((current) => current.map((item) => ({ ...item, read: true })));
  }, []);

  useEffect(() => {
    loadLiveTank();
    const timer = window.setInterval(loadLiveTank, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadLiveTank]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!lastLiveDataAt) {
        setIsDeviceOnline(false);
        return;
      }

      const elapsed = Date.now() - new Date(lastLiveDataAt).getTime();
      setIsDeviceOnline(elapsed <= OFFLINE_TIMEOUT_MS);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [lastLiveDataAt]);

  return (
    <>
      <div className="animated-backdrop" />
      <Header
        isDeviceOnline={isDeviceOnline}
        isPanelOpen={isPanelOpen}
        notifications={notifications}
        onTogglePanel={() => setIsPanelOpen((open) => !open)}
        onClosePanel={() => setIsPanelOpen(false)}
        onMarkRead={markNotificationRead}
        onMarkAllRead={markAllNotificationsRead}
      />
      <DashboardHero
        tank={tank}
        tankStatus={tankStatus}
        waterPercent={waterPercent}
        apiConnected={apiConnected}
        isDeviceOnline={isDeviceOnline}
        lastLiveDataAt={lastLiveDataAt}
        lastSuccessfulFetchAt={lastSuccessfulFetchAt}
        isRefreshing={isRefreshing}
        controlLoading={controlLoading}
        onRefresh={loadLiveTank}
        onPumpChange={handlePumpChange}
        lastError={lastError}
      />
      <AboutProject />
      <TeamSection />
      <footer className="page-footer">IoT Smart Water Tank Monitoring System</footer>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
