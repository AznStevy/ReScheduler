import { LandingSection } from "@/sections/landing";
import { ConflictsSection, OptimizeSection } from "@/sections/optimize";
import { BlocksSection, ResidentsSection, RotationsSection } from "@/sections/editors";
import { DashboardSection, SettingsSection, TransferSection } from "@/sections/home";
import { ScheduleSection } from "@/sections/schedule";
import { SECTIONS, useApp, type SectionId } from "@/state/store";
import { Logo } from "@/ui/logo";
import { AlertTriangle, ArrowDownUp, BookOpen, CalendarDays, CalendarRange, LayoutDashboard, Menu, Play, Settings, Stethoscope, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";

const ICONS: Record<SectionId, LucideIcon> = {
  home: BookOpen,
  dashboard: LayoutDashboard,
  residents: Users,
  rotations: Stethoscope,
  blocks: CalendarDays,
  schedule: CalendarRange,
  optimize: Play,
  conflicts: AlertTriangle,
  transfer: ArrowDownUp,
  settings: Settings,
};

const GROUPS: Array<{ label: string; ids: SectionId[] }> = [
  { label: "Program", ids: ["dashboard", "residents", "rotations", "blocks"] },
  { label: "Schedule", ids: ["schedule", "optimize", "conflicts"] },
  { label: "Admin", ids: ["transfer", "settings"] },
];

const VIEWS: Record<SectionId, () => JSX.Element> = {
  home: LandingSection,
  dashboard: DashboardSection,
  residents: ResidentsSection,
  rotations: RotationsSection,
  blocks: BlocksSection,
  schedule: ScheduleSection,
  optimize: OptimizeSection,
  conflicts: ConflictsSection,
  transfer: TransferSection,
  settings: SettingsSection,
};

export function Shell() {
  const { section, setSection, snapshot, notice, setNotice } = useApp();
  const [menu, setMenu] = useState(false);
  const View = VIEWS[section];
  const title = section === "home" ? "Overview" : section === "optimize" ? "Schedule Generation" : section === "schedule" ? "Schedule" : SECTIONS.find((item) => item[0] === section)?.[1] ?? "Overview";
  return (
    <div className="min-h-screen bg-paper md:grid md:grid-cols-[220px_1fr]">
      {menu ? <button className="fixed inset-0 z-20 bg-navy/40 md:hidden" aria-label="Close menu" onClick={() => setMenu(false)} /> : null}
      <aside className={`sidebar h-dvh flex-col overflow-y-auto md:sticky md:top-0 md:z-30 md:flex md:self-start ${menu ? "fixed inset-y-0 left-0 z-30 flex w-[220px]" : "hidden"}`}>
        <button
          type="button"
          onClick={() => { setSection("home"); setMenu(false); }}
          className="sidebar-rule flex h-16 w-full shrink-0 items-center gap-2 border-b px-4 text-left"
          aria-current={section === "home" ? "page" : undefined}
        >
          <Logo className="h-8 w-8 shrink-0 text-on-sidebar" />
          <div>
            <p className="text-[15px] font-semibold leading-none">ReScheduler</p>
            <p className="sidebar-soft mt-1 font-mono text-[11px]">{snapshot.project.academicYear}</p>
          </div>
        </button>
        <nav className="grid gap-4 p-3">
          {GROUPS.map((group) => (
            <div key={group.label} className="grid gap-1">
              <p className="sidebar-faint px-2 text-[11px] font-semibold uppercase tracking-wide">{group.label}</p>
              {group.ids.map((id) => {
                const Icon = ICONS[id];
                const label = id === "optimize" ? "Generation" : id === "schedule" ? "Schedule" : SECTIONS.find((item) => item[0] === id)?.[1];
                return (
                  <button
                    key={id}
                    onClick={() => { setSection(id); setMenu(false); }}
                    className={`flex h-9 items-center gap-2 rounded-sm px-2 text-left text-[14px] transition-colors duration-200 ${section === id ? "nav-active font-semibold" : "nav-idle"}`}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    {label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
      <div className="app-column flex h-dvh min-w-0 flex-col">
        <header className="no-print flex h-16 shrink-0 items-center justify-between gap-x-4 border-b border-line bg-card px-5">
          <div className="flex min-w-0 items-center gap-3">
            <button className="h-8 shrink-0 rounded-sm border border-line bg-card px-2 text-[14px] md:hidden" onClick={() => setMenu(true)}>
              <Menu className="inline h-4 w-4" /> Menu
            </button>
            <div className="min-w-0">
              <h1 key={section} className="page-in text-[22px] font-semibold leading-tight text-navy">{title}</h1>
              <p className="truncate font-mono text-[12px] text-muted">{snapshot.project.name}</p>
            </div>
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col p-5">
          {notice ? (
            <div className="no-print mb-4 flex shrink-0 items-center justify-between gap-3 border border-line bg-card px-4 py-2 text-[14px]">
              <p>{notice}</p>
              <button onClick={() => setNotice(null)} aria-label="Dismiss notice">Close</button>
            </div>
          ) : null}
          <div key={section} className={`page-in flex min-h-0 flex-1 flex-col ${section === "schedule" ? "overflow-hidden" : "overflow-auto"}`}>
            <View />
          </div>
        </main>
      </div>
    </div>
  );
}
