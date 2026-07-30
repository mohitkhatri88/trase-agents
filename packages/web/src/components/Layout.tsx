import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { StatsFooter } from "./StatsFooter.js";

export function Layout({ children }: { children: ReactNode }) {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded px-3 py-1.5 text-sm font-medium transition-colors ${
      isActive
        ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
        : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
    }`;

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <h1 className="text-lg font-semibold">Trase Agents</h1>
          <nav className="flex gap-1">
            <NavLink to="/agents" className={linkClass}>
              Agents
            </NavLink>
            <NavLink to="/tasks" className={linkClass}>
              All tasks
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>

      <footer className="border-t border-slate-200 dark:border-slate-800">
        <div className="mx-auto max-w-6xl px-4 py-3">
          <StatsFooter />
        </div>
      </footer>
    </div>
  );
}
