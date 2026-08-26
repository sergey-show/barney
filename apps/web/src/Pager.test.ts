import { expect, test } from "bun:test";
import { pageSlice } from "./Pager.tsx";

test("pageSlice clamps and cuts a window", () => {
  const items = [1, 2, 3, 4, 5];
  expect(pageSlice(items, 0, 2)).toEqual({ current: 0, pages: 3, slice: [1, 2] });
  expect(pageSlice(items, 2, 2)).toEqual({ current: 2, pages: 3, slice: [5] });
  expect(pageSlice(items, 9, 2).current).toBe(2);
  expect(pageSlice([], 0, 20)).toEqual({ current: 0, pages: 1, slice: [] });
});
