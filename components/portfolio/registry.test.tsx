import type { Spec } from "@json-render/core";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { registry } from "@/components/portfolio/registry";
import { describeVocabulary, propsMatchComponents } from "@/lib/ui/catalog";
import { parsePortfolioSpec } from "@/lib/ui/spec";

/**
 * The shapes added for one kind of fact each: a comparison, a chronology, a
 * share, a divider.
 *
 * Two things are checked for every one of them, because a component the model
 * can name but not render is worse than none at all, and a component the catalog
 * refuses can never be named. So: the props gate agrees with the renderer, and
 * the renderer puts the facts on screen.
 */

type Element = Spec["elements"][string];

/** Render one node on the canvas, through the gate the app puts it through. */
function draw(id: string, element: Element) {
  const spec: Spec = {
    root: "canvas",
    elements: {
      canvas: { type: "Canvas", props: { layout: "stack" }, children: [id] },
      [id]: element,
    },
  };
  expect(parsePortfolioSpec(spec), "the fixture itself has to pass the gate").not.toBeNull();
  render(
    <JSONUIProvider registry={registry}>
      <Renderer spec={spec} registry={registry} />
    </JSONUIProvider>,
  );
}

const accepts = (type: string, props: unknown) => propsMatchComponents({ x: { type, props } });

describe("Table", () => {
  const columns = ["role", "when", "where"];
  const rows = [
    ["Founder and CTO", "2019 to 2022", "Brazil"],
    ["Senior Backend", "2025 to 2026", "Remote"],
  ];

  it("draws a real table, with headers and every cell", () => {
    draw("t", { type: "Table", props: { columns, rows, caption: "roles" }, children: [] });

    expect(screen.getByRole("table")).toBeDefined();
    for (const column of columns) {
      expect(screen.getByRole("columnheader", { name: column })).toBeDefined();
    }
    for (const cell of rows.flat()) {
      expect(screen.getByRole("cell", { name: cell })).toBeDefined();
    }
    expect(screen.getAllByRole("row")).toHaveLength(rows.length + 1);
  });

  it("pads a short row instead of dropping it", () => {
    // A model that miscounts a row is a nuisance, not a hazard: the answer is
    // otherwise fine, and refusing the transaction would throw all of it away.
    draw("t", { type: "Table", props: { columns, rows: [["only one"]], caption: null }, children: [] });

    expect(screen.getByRole("cell", { name: "only one" })).toBeDefined();
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getAllByRole("cell")).toHaveLength(columns.length);
  });

  it("ignores cells beyond the columns rather than widening the grid", () => {
    draw("t", {
      type: "Table",
      props: { columns: ["a"], rows: [["kept", "dropped"]], caption: null },
      children: [],
    });

    expect(screen.getByRole("cell", { name: "kept" })).toBeDefined();
    expect(screen.queryByRole("cell", { name: "dropped" })).toBeNull();
  });

  it("refuses a table with no columns, or a cell that is not a string", () => {
    expect(accepts("Table", { columns, rows })).toBe(true);
    expect(accepts("Table", { columns: [], rows })).toBe(false);
    expect(accepts("Table", { columns, rows: [[1, 2, 3]] })).toBe(false);
    expect(accepts("Table", { columns, rows: ["not a row"] })).toBe(false);
  });
});

describe("Timeline", () => {
  it("keeps the order it was given", () => {
    draw("tl", {
      type: "Timeline",
      props: {
        items: [
          { when: "2026", what: "Revv" },
          { when: "2019", what: "Reflow" },
        ],
      },
      children: [],
    });

    const entries = screen.getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    expect(entries[0].textContent).toContain("2026");
    expect(entries[1].textContent).toContain("Reflow");
  });

  it("refuses an empty timeline, or an entry missing a date", () => {
    expect(accepts("Timeline", { items: [{ when: "2019", what: "Reflow" }] })).toBe(true);
    expect(accepts("Timeline", { items: [] })).toBe(false);
    expect(accepts("Timeline", { items: [{ what: "Reflow" }] })).toBe(false);
    expect(accepts("Timeline", { items: [["2019", "Reflow"]] })).toBe(false);
  });
});

describe("Meter", () => {
  it("draws a bar in proportion, and says the number out loud", () => {
    draw("m", { type: "Meter", props: { label: "TypeScript", percent: 50, note: null }, children: [] });

    const meter = screen.getByRole("meter", { name: "TypeScript" });
    expect(meter.getAttribute("aria-valuenow")).toBe("50");
    // Twenty cells, so half of them are filled.
    expect(meter.textContent).toBe(`[${"#".repeat(10)}${"-".repeat(10)}]`);
    expect(screen.getByText("50%")).toBeDefined();
  });

  it("draws the ends without spilling outside the bar", () => {
    draw("a", { type: "Meter", props: { label: "none", percent: 0, note: null }, children: [] });
    expect(screen.getByRole("meter", { name: "none" }).textContent).toBe(`[${"-".repeat(20)}]`);
  });

  it("refuses a share that is not one", () => {
    expect(accepts("Meter", { label: "TypeScript", percent: 98 })).toBe(true);
    expect(accepts("Meter", { label: "TypeScript", percent: 120 })).toBe(false);
    expect(accepts("Meter", { label: "TypeScript", percent: -1 })).toBe(false);
    expect(accepts("Meter", { label: "TypeScript", percent: "98" })).toBe(false);
  });
});

describe("Separator", () => {
  it("is a labelled row of dashes", () => {
    draw("s", { type: "Separator", props: { label: "links" }, children: [] });
    expect(screen.getByText(/^-- links -+$/)).toBeDefined();
  });

  it("accepts no label at all", () => {
    expect(accepts("Separator", {})).toBe(true);
    expect(accepts("Separator", { label: null })).toBe(true);
    expect(accepts("Separator", { label: 4 })).toBe(false);
  });
});

describe("the vocabulary the model is shown", () => {
  const described = describeVocabulary()
    .split("\n")
    .map((line) => line.slice(0, line.indexOf("(")));

  it("names every new shape, with its props", () => {
    for (const name of ["Table", "Timeline", "Meter", "Separator"]) {
      expect(described, name).toContain(name);
    }
    expect(describeVocabulary()).toContain("columns: string[]");
    expect(describeVocabulary()).toContain("percent: number");
  });

  it("lists each component once, and nothing the gate would refuse", () => {
    expect(new Set(described).size).toBe(described.length);
    for (const name of described) {
      expect(name, "a described name must be a real component").toMatch(/^[A-Z][A-Za-z]+$/);
    }
    // The other direction: a name the vocabulary does not list cannot render.
    expect(described).not.toContain("Dialog");
    expect(accepts("Dialog", {})).toBe(false);
  });
});
