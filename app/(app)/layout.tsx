"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-context";
import Link from "next/link";
import {
  CalendarDays, Inbox, Settings, LogOut, Menu, X, MessagesSquare,
} from "lucide-react";

const NAV = [
  { href: "/calendar", label: "יומן",    Icon: CalendarDays },
  { href: "/inbox",    label: "דואר",    Icon: Inbox },
  { href: "/slack",    label: "סלאק",    Icon: MessagesSquare },
  { href: "/settings", label: "הגדרות", Icon: Settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const { user, loading, logout } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F8FAFC" }}>
        <div
          className="w-7 h-7 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: "#2563EB", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen" style={{ background: "#F8FAFC", color: "#0D1321" }}>

      {/* Mobile top bar */}
      <header
        className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3"
        style={{ background: "#ffffff", borderBottom: "1px solid #E8EDF5" }}
      >
        <button onClick={() => setMobileNavOpen(true)} aria-label="פתח תפריט" className="p-1.5 -mr-1.5">
          <Menu size={22} color="#0D1321" />
        </button>
        <span className="font-bold" style={{ color: "#0D1321" }}>📅 CalendarSync</span>
        <span style={{ width: 22 }} />
      </header>

      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          style={{ background: "rgba(13,19,33,0.4)" }}
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 right-0 w-64 flex flex-col z-50 transition-transform duration-200 md:translate-x-0 ${mobileNavOpen ? "translate-x-0" : "translate-x-full"}`}
        style={{ background: "#ffffff", borderLeft: "1px solid #E8EDF5" }}
      >
        <div className="px-6 py-5 flex items-center justify-between" style={{ borderBottom: "1px solid #E8EDF5" }}>
          <span className="font-bold text-lg" style={{ color: "#0D1321" }}>📅 CalendarSync</span>
          <button onClick={() => setMobileNavOpen(false)} aria-label="סגור תפריט" className="md:hidden p-1">
            <X size={20} color="#5B6477" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV.map(({ href, label, Icon }) => {
            const active = pathname === href || pathname?.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileNavOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
                style={{
                  background: active ? "#EFF4FF" : "transparent",
                  color:      active ? "#2563EB" : "#5B6477",
                }}
              >
                <Icon size={17} strokeWidth={active ? 2.2 : 1.8} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="px-3 pb-5 pt-3 space-y-2" style={{ borderTop: "1px solid #E8EDF5" }}>
          <div className="px-3 py-2.5 rounded-xl" style={{ background: "#F8FAFC" }}>
            <p className="text-xs font-medium truncate" style={{ color: "#5B6477" }}>
              {user.displayName || user.email}
            </p>
          </div>
          <button
            onClick={async () => { await logout(); window.location.href = "/login"; }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all hover:opacity-80"
            style={{ background: "#EFF4FF", color: "#2563EB" }}
          >
            <LogOut size={15} />
            התנתקות
          </button>
        </div>
      </aside>

      <main className="md:mr-64 min-h-screen">
        <div className={`p-4 md:p-8 ${pathname?.startsWith("/calendar") ? "max-w-6xl" : "max-w-5xl"}`}>
          {children}
        </div>
      </main>
    </div>
  );
}
