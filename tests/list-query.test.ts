import { describe, expect, it } from "vitest";
import {
  MAX_SEARCH_CHARS,
  ilikePattern,
  matchesAny,
  pageFrom,
  pageWindow,
  searchTerm,
} from "../src/lib/list-query";

describe("searchTerm", () => {
  it("trims, collapses whitespace and caps the length", () => {
    expect(searchTerm("  Millbrook   Restaurant \n")).toBe("Millbrook Restaurant");
    expect(searchTerm(undefined)).toBe("");
    expect(searchTerm(null)).toBe("");
    expect(searchTerm("x".repeat(500))).toHaveLength(MAX_SEARCH_CHARS);
  });
});

describe("ilikePattern", () => {
  it("wraps the term in wildcards", () => {
    expect(ilikePattern("acme")).toBe("%acme%");
  });

  it("escapes the characters ILIKE would otherwise treat as wildcards", () => {
    expect(ilikePattern("100%")).toBe("%100\\%%");
    expect(ilikePattern("a_b")).toBe("%a\\_b%");
    expect(ilikePattern("c:\\temp")).toBe("%c:\\\\temp%");
  });
});

describe("matchesAny", () => {
  const fields = ["Millbrook Restaurant", "orders@millbrook.example", "(555) 010-0000"];

  it("matches any field, case-insensitively, and everything when the term is empty", () => {
    expect(matchesAny("", fields)).toBe(true);
    expect(matchesAny("MILLBROOK", fields)).toBe(true);
    expect(matchesAny("orders@", fields)).toBe(true);
    expect(matchesAny("bakery", fields)).toBe(false);
    expect(matchesAny("x", [null, undefined, ""])).toBe(false);
  });

  it("compares digits with digits when the term is mostly digits", () => {
    expect(matchesAny("555 0100", fields)).toBe(true);
    expect(matchesAny("5550100000", fields)).toBe(true);
    expect(matchesAny("555-0199", fields)).toBe(false);
  });

  it("does not let the digits of a mostly-text term reach into a phone number", () => {
    expect(matchesAny("acme 010", fields)).toBe(false);
  });
});

describe("pageFrom", () => {
  it("accepts a positive whole number and nothing else", () => {
    expect(pageFrom("3")).toBe(3);
    expect(pageFrom("1")).toBe(1);
    expect(pageFrom("0")).toBe(1);
    expect(pageFrom("-2")).toBe(1);
    expect(pageFrom("2.5")).toBe(1);
    expect(pageFrom("abc")).toBe(1);
    expect(pageFrom(undefined)).toBe(1);
  });
});

describe("pageWindow", () => {
  it("describes the first page of a list longer than a page", () => {
    expect(pageWindow(1, 50, 312)).toEqual({
      page: 1,
      pageSize: 50,
      total: 312,
      pages: 7,
      offset: 0,
      from: 1,
      to: 50,
      hasPrev: false,
      hasNext: true,
    });
  });

  it("describes a middle page and the short last page", () => {
    expect(pageWindow(3, 50, 312)).toMatchObject({ offset: 100, from: 101, to: 150, hasPrev: true, hasNext: true });
    expect(pageWindow(7, 50, 312)).toMatchObject({ offset: 300, from: 301, to: 312, hasPrev: true, hasNext: false });
  });

  it("clamps a page past the end to the last page, so a stale link still shows rows", () => {
    expect(pageWindow(40, 50, 312)).toMatchObject({ page: 7, from: 301, to: 312 });
  });

  it("is a single page when the list fits, and empty when there is nothing", () => {
    expect(pageWindow(1, 50, 12)).toMatchObject({ pages: 1, from: 1, to: 12, hasPrev: false, hasNext: false });
    expect(pageWindow(1, 50, 0)).toMatchObject({ pages: 1, offset: 0, from: 0, to: 0, hasPrev: false, hasNext: false });
    expect(pageWindow(5, 50, 0)).toMatchObject({ page: 1, from: 0, to: 0 });
  });
});
