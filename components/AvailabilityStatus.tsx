'use client';

import * as React from 'react';
import { CheckCircle2, CloudOff } from 'lucide-react';

export function AvailabilityStatus() {
  const [online, setOnline] = React.useState(true);
  const [serviceReachable, setServiceReachable] = React.useState<boolean | null>(null);
  const [showRecovered, setShowRecovered] = React.useState(false);
  const wasUnavailable = React.useRef(false);

  const checkService = React.useCallback(async () => {
    if (!navigator.onLine) {
      wasUnavailable.current = true;
      setServiceReachable(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 3500);
    let reachable = false;
    try {
      const response = await fetch('/api/health', { cache: 'no-store', signal: controller.signal });
      reachable = response.ok;
    } catch {
      reachable = false;
    } finally {
      window.clearTimeout(timer);
    }
    setServiceReachable(reachable);
    if (!reachable) {
      wasUnavailable.current = true;
      setShowRecovered(false);
    } else if (wasUnavailable.current) {
      setShowRecovered(true);
      wasUnavailable.current = false;
    }
  }, []);

  React.useEffect(() => {
    const onOffline = () => {
      wasUnavailable.current = true;
      setShowRecovered(false);
      setOnline(false);
      setServiceReachable(false);
    };
    const onOnline = () => {
      setOnline(true);
      void checkService();
    };

    setOnline(navigator.onLine);
    if (!navigator.onLine) wasUnavailable.current = true;
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    if ('serviceWorker' in navigator) {
      if (process.env.NODE_ENV === 'production') {
        void navigator.serviceWorker.register('/sw.js', { scope: '/' });
      } else {
        // A production worker can otherwise keep serving stale, fixed-name dev chunks.
        // That mixes server and client builds, breaks hydration, and leaves every click inert.
        void navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(
          registrations
            .filter((registration) => new URL(registration.scope).origin === location.origin)
            .map((registration) => registration.unregister()),
        ));
        if ('caches' in window) {
          void caches.keys().then((keys) => Promise.all(
            keys
              .filter((key) => key.startsWith('omniwriter-shell-'))
              .map((key) => caches.delete(key)),
          ));
        }
      }
    }

    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [checkService]);

  React.useEffect(() => {
    void checkService();
    const timer = window.setInterval(() => { void checkService(); }, 15_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void checkService();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [checkService]);

  React.useEffect(() => {
    if (!showRecovered) return;
    const timer = window.setTimeout(() => setShowRecovered(false), 3000);
    return () => window.clearTimeout(timer);
  }, [showRecovered]);

  const unavailable = !online || serviceReachable === false;
  if (!unavailable && !showRecovered) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 left-1/2 z-[100] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium shadow-sm ${
        !unavailable
          ? 'border-emerald-200 bg-emerald-50/95 text-emerald-800'
          : 'border-amber-200 bg-amber-50/95 text-amber-900'
      }`}
    >
      {!unavailable ? <CheckCircle2 size={14}/> : <CloudOff size={14}/>} 
      <span>{
        !unavailable
          ? '连接已恢复，内容已保留'
          : !online
            ? '当前离线：仍可编辑已打开的文章，AI 与联网配图暂不可用'
            : '服务暂时不可达：内容已保存在本机，可以继续编辑'
      }</span>
    </div>
  );
}
