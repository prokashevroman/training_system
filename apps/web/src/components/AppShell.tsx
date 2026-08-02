import clsx from "clsx";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

/**
 * Mobile-first layout: bottom navigation on phones, a sidebar on desktop.
 * The nav is the brief's five destinations; Plan is present but disabled
 * until Phase 5 builds the planner, rather than hidden — the shape of the app
 * should not change when the planner arrives.
 */

interface NavItem {
  to: string;
  label: string;
  icon: string;
  enabled: boolean;
}

const NAV: NavItem[] = [
  {
    to: "/",
    label: "Today",
    icon: "M3 11l9-8 9 8v9a2 2 0 01-2 2h-4v-6H9v6H5a2 2 0 01-2-2z",
    enabled: true,
  },
  {
    to: "/record",
    label: "Record",
    icon: "M12 15a3 3 0 003-3V6a3 3 0 10-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.9V21h2v-2.1A7 7 0 0019 12z",
    enabled: true,
  },
  {
    to: "/plan",
    label: "Plan",
    icon: "M7 2v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2h-2V2h-2v2H9V2zm12 8v10H5V10z",
    enabled: false,
  },
  {
    to: "/history",
    label: "History",
    icon: "M13 3a9 9 0 00-9 9H1l4 4 4-4H6a7 7 0 111.9 4.8l-1.5 1.3A9 9 0 1013 3zm-1 5v5l4 2 .8-1.3-3.3-1.9V8z",
    enabled: true,
  },
  {
    to: "/more",
    label: "More",
    icon: "M6 10a2 2 0 100 4 2 2 0 000-4zm6 0a2 2 0 100 4 2 2 0 000-4zm6 0a2 2 0 100 4 2 2 0 000-4z",
    enabled: true,
  },
];

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100 md:flex">
      <nav className="hidden md:flex md:w-56 md:shrink-0 md:flex-col md:gap-1 md:border-r md:border-slate-800 md:p-4">
        <p className="mb-4 px-3 text-sm font-semibold tracking-wide text-slate-400">Training log</p>
        {NAV.map((item) => (
          <NavItemLink key={item.to} item={item} variant="sidebar" />
        ))}
      </nav>

      <main className="flex-1 pb-24 md:pb-8">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">{children}</div>
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-slate-800 bg-slate-900/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "var(--safe-bottom)" }}
      >
        {NAV.map((item) => (
          <NavItemLink key={item.to} item={item} variant="bottom" />
        ))}
      </nav>
    </div>
  );
}

function NavItemLink({ item, variant }: { item: NavItem; variant: "bottom" | "sidebar" }) {
  const base =
    variant === "bottom"
      ? "flex flex-col items-center gap-1 py-2 text-[11px]"
      : "flex items-center gap-3 rounded-lg px-3 py-2 text-sm";

  if (!item.enabled) {
    return (
      <span
        className={clsx(base, "cursor-not-allowed text-slate-600")}
        title="Planning arrives in Phase 5"
        aria-disabled="true"
      >
        <Icon path={item.icon} />
        {item.label}
      </span>
    );
  }

  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      className={({ isActive }) =>
        clsx(base, isActive ? "text-sky-400" : "text-slate-400 hover:text-slate-200")
      }
    >
      <Icon path={item.icon} />
      {item.label}
    </NavLink>
  );
}
