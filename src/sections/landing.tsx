import type { SectionId } from "@/state/store";
import { useApp } from "@/state/store";
import { Logo } from "@/ui/logo";

const STEPS: Array<{ title: string; line: string; go: SectionId }> = [
  { title: "Import", line: "Load a schedule file, or save this year.", go: "transfer" },
  { title: "Schedule", line: "The year, week by week. Lock what should stay.", go: "schedule" },
  { title: "Generation", line: "Other ways to fill the weeks still open.", go: "optimize" },
  { title: "Conflicts", line: "Gaps and rules the current schedule breaks.", go: "conflicts" },
];

export function LandingSection() {
  const { setSection } = useApp();
  return (
    <div className="@container/overview w-full">
      <div className="grid items-center gap-8 @min-[40rem]/overview:grid-cols-[180px_minmax(0,1fr)] @min-[40rem]/overview:gap-12">
        <Logo label="ReScheduler" className="mx-auto h-36 w-36 text-steel @min-[40rem]/overview:mx-0 @min-[40rem]/overview:h-44 @min-[40rem]/overview:w-44" />
        <div className="@container/steps grid min-w-0 gap-6">
          <p className="text-[17px] leading-7">
            Assigns residents to rotations for the year and shows what still doesn't work.
          </p>
          <div className="grid gap-3 @min-[24rem]/steps:grid-cols-2">
            {STEPS.map((step) => (
              <button
                key={step.title}
                type="button"
                onClick={() => setSection(step.go)}
                className="grid min-h-32 content-between gap-6 border border-line bg-card px-5 py-5 text-left hover:border-steel"
              >
                <span className="text-[28px] font-semibold leading-none text-navy">{step.title}</span>
                <span className="text-[15px] leading-5 text-muted">{step.line}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setSection("dashboard")} className="w-fit text-[15px] font-semibold text-navy underline decoration-line underline-offset-4">
            Open the dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
