import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Bug, Rocket, Tag } from "lucide-react";
import ColumnGroupIcon from "../ColumnGroupIcon";
import { CARD_TYPE_ICONS, CARD_TYPE_ICON_NAMES, CardTypeIcon, getCardTypeIcon } from "../cardTypeIcons";

describe("ColumnGroupIcon", () => {
  it.each([
    ["BACKLOG", "lucide-circle-dashed", "text-slate-400"],
    ["UNSTARTED", "lucide-circle", "text-slate-500"],
    ["STARTED", "lucide-circle-dot", "text-amber-500"],
    ["COMPLETED", "lucide-circle-check", "text-emerald-500"],
    ["CANCELLED", "lucide-circle-x", "text-rose-500"],
  ])("draws the %s group with its own icon and color", (group, iconClass, colorClass) => {
    render(<ColumnGroupIcon group={group} label={`${group} column`} />);

    const badge = screen.getByRole("img", { name: `${group} column` });
    expect(badge).toHaveAttribute("data-group", group);
    expect(badge).toHaveAttribute("title", `${group} column`);
    const svg = badge.querySelector("svg");
    expect(svg).toHaveClass(iconClass, colorClass);
  });

  it("falls back to Completed for an unknown group on a done column, and Unstarted otherwise", () => {
    render(
      <>
        <ColumnGroupIcon group="ARCHIVED" isDone label="done" />
        <ColumnGroupIcon group={null} label="open" />
      </>
    );

    expect(screen.getByRole("img", { name: "done" })).toHaveAttribute("data-group", "COMPLETED");
    expect(screen.getByRole("img", { name: "open" })).toHaveAttribute("data-group", "UNSTARTED");
  });

  it("uses the column's own color instead of the group color", () => {
    render(<ColumnGroupIcon group="STARTED" color="#123456" label="custom" />);

    const svg = screen.getByRole("img", { name: "custom" }).querySelector("svg");
    expect(svg).toHaveStyle({ color: "#123456" });
    expect(svg).not.toHaveClass("text-amber-500");
  });
});

describe("cardTypeIcons", () => {
  it("returns the named icon, and Tag for an unknown, empty or missing name", () => {
    expect(getCardTypeIcon("Bug")).toBe(Bug);
    expect(getCardTypeIcon("Rocket")).toBe(Rocket);
    expect(getCardTypeIcon("NoSuchIcon")).toBe(Tag);
    expect(getCardTypeIcon("")).toBe(Tag);
    expect(getCardTypeIcon(null)).toBe(Tag);
    expect(getCardTypeIcon(undefined)).toBe(Tag);
  });

  it("lists every icon a card type can pick", () => {
    expect(CARD_TYPE_ICON_NAMES).toEqual(Object.keys(CARD_TYPE_ICONS));
    expect(CARD_TYPE_ICON_NAMES).toContain("Tag");
  });

  it("renders the icon for a name with the given className", () => {
    const { container } = render(
      <>
        <CardTypeIcon name="Bug" className="h-3 w-3 bug-type" />
        <CardTypeIcon name="Unknown" className="fallback-type" />
      </>
    );

    expect(container.querySelector(".bug-type")).toHaveClass("lucide-bug");
    expect(container.querySelector(".fallback-type")).toHaveClass("lucide-tag");
  });
});
