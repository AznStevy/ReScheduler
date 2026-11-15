import { describe, expect, it } from "vitest";
import { contrastRatio, paletteFor, SCHEMES } from "./theme";

describe("color scheme", () => {
  it("keeps the clinical colors", () => {
    const palette = paletteFor({ id: "clinical" });
    expect(palette.navy).toBe("#253e50");
    expect(palette.steel).toBe("#477587");
    expect(palette.paper).toBe("#f7f8f6");
  });

  it("uses a light emphasis color when a custom background is dark", () => {
    const palette = paletteFor({
      id: "custom",
      custom: { sidebar: "#102030", steel: "#d7e8ee", paper: "#121820", card: "#1b2630", ink: "#e6eef2" },
    });
    expect(palette.navy).toBe("#d7e8ee");
    expect(palette.sidebar).toBe("#102030");
    expect(palette.paper).toBe("#121820");
  });

  it("falls back when the scheme is unknown", () => {
    expect(paletteFor({ id: "missing" }).navy).toBe("#253e50");
  });

  it("keeps text readable on every scheme", () => {
    for (const scheme of SCHEMES) {
      const palette = paletteFor({ id: scheme.id });
      for (const color of [palette.ink, palette.navy, palette.muted, palette.good, palette.bad, palette.amber]) {
        expect(contrastRatio(color, palette.paper)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(color, palette.card)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(color, palette.head)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(palette.steel, palette.paper)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.onNavy, palette.navy)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.onSidebar, palette.sidebar)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("darkens text that disappears on a light custom background", () => {
    const palette = paletteFor({
      id: "custom",
      custom: { sidebar: "#f4f7f6", steel: "#d7e8ee", paper: "#f7f8f6", card: "#ffffff", ink: "#f4f7f6" },
    });
    expect(contrastRatio(palette.ink, palette.paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.navy, palette.paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.ink, palette.card)).toBeGreaterThanOrEqual(4.5);
  });
});
