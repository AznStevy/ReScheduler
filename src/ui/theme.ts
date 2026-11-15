import { faviconHref } from "@/ui/logo";

export interface CustomColors {
  sidebar: string;
  steel: string;
  paper: string;
  card: string;
  ink: string;
}

export interface ThemeChoice {
  id: string;
  custom?: CustomColors;
}

export interface Palette extends CustomColors {
  navy: string;
  onNavy: string;
  onSidebar: string;
  head: string;
  line: string;
  muted: string;
  good: string;
  bad: string;
  amber: string;
}

interface Scheme extends Palette {
  id: string;
  name: string;
}

const CLINICAL: Scheme = {
  id: "clinical",
  name: "Clinical",
  sidebar: "#253e50",
  onSidebar: "#f7f8f6",
  navy: "#253e50",
  onNavy: "#f7f8f6",
  steel: "#477587",
  paper: "#f7f8f6",
  head: "#e9eef0",
  line: "#d7dee1",
  ink: "#25343d",
  muted: "#52626b",
  card: "#ffffff",
  good: "#527b68",
  bad: "#a34747",
  amber: "#b47b42",
};

export const SCHEMES: Scheme[] = [
  CLINICAL,
  {
    id: "harbor",
    name: "Harbor",
    sidebar: "#1a3c40",
    onSidebar: "#f4f7f6",
    navy: "#1a3c40",
    onNavy: "#f4f7f6",
    steel: "#3d7a78",
    paper: "#f4f7f6",
    head: "#e4eeec",
    line: "#d0dedb",
    ink: "#1c3330",
    muted: "#4e6460",
    card: "#ffffff",
    good: "#527b68",
    bad: "#a34747",
    amber: "#b47b42",
  },
  {
    id: "slate",
    name: "Slate",
    sidebar: "#2c3a47",
    onSidebar: "#f5f6f8",
    navy: "#2c3a47",
    onNavy: "#f5f6f8",
    steel: "#5c6e80",
    paper: "#f5f6f8",
    head: "#e7eaee",
    line: "#d4dae0",
    ink: "#2a3138",
    muted: "#5a656e",
    card: "#ffffff",
    good: "#527b68",
    bad: "#a34747",
    amber: "#b47b42",
  },
  {
    id: "pine",
    name: "Pine",
    sidebar: "#1e3a2f",
    onSidebar: "#f5f7f4",
    navy: "#1e3a2f",
    onNavy: "#f5f7f4",
    steel: "#3f6b52",
    paper: "#f5f7f4",
    head: "#e5eee8",
    line: "#d2dfd6",
    ink: "#24312a",
    muted: "#55685c",
    card: "#ffffff",
    good: "#527b68",
    bad: "#a34747",
    amber: "#b47b42",
  },
  {
    id: "dusk",
    name: "Dusk",
    sidebar: "#0e1a24",
    onSidebar: "#e7eef3",
    navy: "#d5e4ec",
    onNavy: "#12202a",
    steel: "#8fb8c4",
    paper: "#141c24",
    head: "#1c2832",
    line: "#31404c",
    ink: "#e7eef3",
    muted: "#9aadb8",
    card: "#1c2730",
    good: "#b7dfc8",
    bad: "#f3b7b3",
    amber: "#efd09a",
  },
];

const STORAGE_KEY = "rescheduler-color-scheme";

const VARIABLES: Record<keyof Palette, string> = {
  sidebar: "--color-sidebar",
  onSidebar: "--color-on-sidebar",
  navy: "--color-navy",
  onNavy: "--color-on-navy",
  steel: "--color-steel",
  paper: "--color-paper",
  head: "--color-head",
  line: "--color-line",
  ink: "--color-ink",
  muted: "--color-muted",
  card: "--color-card",
  good: "--color-good",
  bad: "--color-bad",
  amber: "--color-amber",
};

export function paletteFor(choice: ThemeChoice): Palette {
  const base = choice.id === "custom" ? fromCustom(choice.custom ?? colorsOf("clinical")) : SCHEMES.find((scheme) => scheme.id === choice.id) ?? CLINICAL;
  return withReadable(base);
}

export function colorsOf(id: string): CustomColors {
  const scheme = SCHEMES.find((item) => item.id === id) ?? CLINICAL;
  return { sidebar: scheme.sidebar, steel: scheme.steel, paper: scheme.paper, card: scheme.card, ink: scheme.ink };
}

export function loadTheme(): ThemeChoice {
  if (typeof localStorage === "undefined") return { id: "clinical" };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "") as Partial<ThemeChoice>;
    if (parsed.id === "custom" && parsed.custom && isCustom(parsed.custom)) return { id: "custom", custom: normalizeCustom(parsed.custom) };
    if (typeof parsed.id === "string" && SCHEMES.some((scheme) => scheme.id === parsed.id)) return { id: parsed.id };
  } catch {
    return { id: "clinical" };
  }
  return { id: "clinical" };
}

export function saveTheme(choice: ThemeChoice): void {
  if (typeof localStorage === "undefined") return;
  const stored = choice.id === "custom" ? { id: "custom", custom: choice.custom ?? colorsOf("clinical") } : { id: choice.id };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  themeListeners.forEach((listener) => listener(stored));
}

const themeListeners = new Set<(choice: ThemeChoice) => void>();

export function subscribeTheme(listener: (choice: ThemeChoice) => void): () => void {
  themeListeners.add(listener);
  return () => themeListeners.delete(listener);
}

export function applyTheme(choice: ThemeChoice): void {
  if (typeof document === "undefined") return;
  const palette = paletteFor(choice);
  for (const [key, name] of Object.entries(VARIABLES)) {
    document.documentElement.style.setProperty(name, palette[key as keyof Palette]);
  }
  document.documentElement.style.colorScheme = luminance(palette.paper) < 0.4 ? "dark" : "light";
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon) icon.href = faviconHref(palette.steel);
}

export function applyStoredTheme(): void {
  applyTheme(loadTheme());
}

function fromCustom(colors: CustomColors): Palette {
  const custom = normalizeCustom(colors);
  const paperDark = luminance(custom.paper) < 0.4;
  const navy = paperDark ? (luminance(custom.steel) > 0.45 ? custom.steel : custom.ink) : custom.sidebar;
  return {
    ...custom,
    navy,
    onNavy: contrast(navy),
    onSidebar: contrast(custom.sidebar),
    head: mix(custom.paper, custom.ink, paperDark ? 0.14 : 0.06),
    line: mix(custom.paper, custom.ink, paperDark ? 0.28 : 0.16),
    muted: mix(custom.ink, custom.paper, 0.35),
    good: "#527b68",
    bad: "#a34747",
    amber: "#b47b42",
  };
}

function isCustom(value: Partial<CustomColors>): value is CustomColors {
  return Boolean(hex(value.sidebar ?? "") && hex(value.steel ?? "") && hex(value.paper ?? "") && hex(value.card ?? "") && hex(value.ink ?? ""));
}

function normalizeCustom(colors: CustomColors): CustomColors {
  return {
    sidebar: hex(colors.sidebar) ?? CLINICAL.sidebar,
    steel: hex(colors.steel) ?? CLINICAL.steel,
    paper: hex(colors.paper) ?? CLINICAL.paper,
    card: hex(colors.card) ?? CLINICAL.card,
    ink: hex(colors.ink) ?? CLINICAL.ink,
  };
}

function hex(value: string): string | null {
  const match = value.trim().match(/^#?([0-9a-fA-F]{6})$/);
  return match ? `#${match[1].toLowerCase()}` : null;
}

function luminance(color: string): number {
  const channels = [0, 2, 4].map((index) => {
    const value = parseInt(color.slice(1 + index, 3 + index), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function mix(from: string, to: string, amount: number): string {
  const parse = (color: string) => [0, 2, 4].map((index) => parseInt(color.slice(1 + index, 3 + index), 16));
  const left = parse(from);
  const right = parse(to);
  return `#${left.map((channel, index) => Math.round(channel + ((right[index] ?? channel) - channel) * amount).toString(16).padStart(2, "0")).join("")}`;
}

function contrast(color: string): string {
  return luminance(color) > 0.42 ? "#1a2428" : "#f7f8f6";
}

const READABLE = 4.5;

function withReadable(palette: Palette): Palette {
  const paper = palette.paper;
  let card = palette.card;
  let head = palette.head;
  let ink = readable(palette.ink, [paper]);
  card = alignSurface(card, ink, paper);
  ink = readable(ink, [paper, card]);
  head = alignSurface(head, ink, paper);
  let navy = readable(palette.navy, [paper, card, head]);
  head = alignSurface(head, navy, head);
  navy = readable(navy, [paper, card, head]);
  const muted = readable(palette.muted, [paper, card, head]);
  const steel = readable(palette.steel, [paper, card]);
  return {
    ...palette,
    card,
    head,
    ink,
    navy,
    muted,
    steel,
    good: readable(palette.good, [paper, card, head]),
    bad: readable(palette.bad, [paper, card, head]),
    amber: readable(palette.amber, [paper, card, head]),
    onNavy: readable(contrast(navy), [navy]),
    onSidebar: readable(contrast(palette.sidebar), [palette.sidebar]),
  };
}

function readable(color: string, backgrounds: string[]): string {
  if (backgrounds.every((background) => contrastRatio(color, background) >= READABLE)) return color;
  let current = color;
  for (let step = 0; step < 16; step += 1) {
    if (backgrounds.every((background) => contrastRatio(current, background) >= READABLE)) return current;
    const worst = backgrounds.reduce((fail, background) => contrastRatio(current, background) < contrastRatio(current, fail) ? background : fail);
    current = mix(current, luminance(worst) > 0.45 ? "#1a2428" : "#f7f8f6", 0.28);
  }
  return current;
}

function alignSurface(surface: string, text: string, toward: string): string {
  if (contrastRatio(text, surface) >= READABLE) return surface;
  let current = surface;
  for (let step = 0; step < 16; step += 1) {
    if (contrastRatio(text, current) >= READABLE) return current;
    current = mix(current, contrastRatio(text, toward) >= READABLE ? toward : (luminance(text) > 0.45 ? "#10161c" : "#f7f8f6"), 0.35);
  }
  return current;
}

export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}
