import { blockRangeLabel, editBlockDate, makeBlocks } from "./calendar";
import { describe, expect, it } from "vitest";

describe("editBlockDate", () => {
  it("moves the previous block's end when a start date moves earlier", () => {
    const blocks = makeBlocks(3);
    const edited = editBlockDate(blocks, "b02", "startDate", "2026-07-20");
    expect(edited.map((block) => [block.startDate, block.endDate])).toEqual([
      ["2026-07-01", "2026-07-19"],
      ["2026-07-20", "2026-08-25"],
      ["2026-08-26", "2026-09-22"],
    ]);
    expect(edited.map((block) => block.label)).toEqual(["Block 1", "Block 2", "Block 3"]);
  });

  it("moves the next block's start when an end date moves later", () => {
    const blocks = makeBlocks(3);
    const edited = editBlockDate(blocks, "b02", "endDate", "2026-08-31");
    expect(edited[1]).toMatchObject({ startDate: "2026-07-29", endDate: "2026-08-31" });
    expect(edited[2]).toMatchObject({ startDate: "2026-09-01", endDate: "2026-09-22" });
    expect(edited[0].endDate).toBe(blocks[0].endDate);
  });

  it("keeps a one-day block when the start passes the end, and shifts the neighbor", () => {
    const blocks = makeBlocks(3);
    const edited = editBlockDate(blocks, "b02", "startDate", "2026-08-30");
    expect(edited.map((block) => [block.startDate, block.endDate])).toEqual([
      ["2026-07-01", "2026-08-29"],
      ["2026-08-30", "2026-08-30"],
      ["2026-08-31", "2026-09-22"],
    ]);
  });

  it("rewrites a date-range label and leaves a custom label", () => {
    const blocks = makeBlocks(2).map((block, index) =>
      index === 0 ? { ...block, label: blockRangeLabel(block.startDate, block.endDate) } : { ...block, label: "Thanksgiving" },
    );
    const edited = editBlockDate(blocks, "b01", "endDate", "2026-07-20");
    expect(edited[0].label).toBe("Jul 1 – Jul 20");
    expect(edited[1].label).toBe("Thanksgiving");
    expect(edited[1].startDate).toBe("2026-07-21");
  });

  it("ignores a date that is not a full day", () => {
    const blocks = makeBlocks(2);
    expect(editBlockDate(blocks, "b01", "startDate", "")).toBe(blocks);
  });
});
