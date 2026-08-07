// Run: npx tsx lib/todo.test.ts
// Deadline logic. Small, but a to-do list that shows "late" a day early — or a
// day late — is worse than none, and off-by-one across midnight is the classic
// way that happens.

import { todoState, sortTodos, todoCounts, todayISO, type Todo } from "./supabase";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}

const TODAY = "2026-08-03";
function todo(t: Partial<Todo>): Todo {
  return {
    id: Math.random().toString(36).slice(2), text: "x", due: null, done: false,
    done_at: null, created_at: "2026-08-01T00:00:00Z", updated_at: "", ...t,
  };
}

console.log("\ntodoState()");
check("yesterday is late", todoState({ due: "2026-08-02", done: false }, TODAY), "overdue");
check("today is today", todoState({ due: TODAY, done: false }, TODAY), "today");
check("tomorrow is upcoming", todoState({ due: "2026-08-04", done: false }, TODAY), "upcoming");
check("no deadline is someday", todoState({ due: null, done: false }, TODAY), "someday");
check("finished beats everything, even a missed deadline",
  todoState({ due: "2020-01-01", done: true }, TODAY), "done");

console.log("\nmidnight and timezones");
// Both sides are yyyy-mm-dd strings, so this is a plain lexical compare — no
// Date parsing, so nothing can shift by a day in a non-UTC timezone.
check("a deadline is never 'late' on its own day", todoState({ due: TODAY, done: false }, TODAY), "today");
check("year boundary", todoState({ due: "2025-12-31", done: false }, "2026-01-01"), "overdue");
check("month boundary", todoState({ due: "2026-08-01", done: false }, "2026-07-31"), "upcoming");
// todayISO() must be LOCAL: toISOString() is UTC and reads as yesterday for
// anyone west of it late in the evening.
const late = new Date(2026, 7, 3, 23, 30); // 3 Aug, 23:30 local
check("todayISO uses the local date, not UTC", todayISO(late), "2026-08-03");

console.log("\nsortTodos() — what's late must be first");
const list = [
  todo({ text: "no deadline", created_at: "2026-08-01T10:00:00Z" }),
  todo({ text: "finished", done: true, due: "2026-08-01" }),
  todo({ text: "next week", due: "2026-08-10" }),
  todo({ text: "late", due: "2026-07-30" }),
  todo({ text: "today", due: TODAY }),
  todo({ text: "later note", created_at: "2026-08-02T10:00:00Z" }),
  todo({ text: "very late", due: "2026-07-01" }),
];
check("order", sortTodos(list, TODAY).map((t) => t.text),
  ["very late", "late", "today", "next week", "later note", "no deadline", "finished"]);
check("undated notes are newest-first — a note is a thought you just had",
  sortTodos([
    todo({ text: "older", created_at: "2026-01-01T00:00:00Z" }),
    todo({ text: "newer", created_at: "2026-08-01T00:00:00Z" }),
  ], TODAY).map((t) => t.text), ["newer", "older"]);
check("sorting doesn't mutate the array it was given", list[0].text, "no deadline");

console.log("\ntodoCounts() — the sidebar badge");
check("counts", todoCounts(list, TODAY), { open: 6, overdue: 2, dueToday: 1, done: 1, total: 7 });
check("empty list", todoCounts([], TODAY), { open: 0, overdue: 0, dueToday: 0, done: 0, total: 0 });
check("a finished item is never counted as late",
  todoCounts([todo({ due: "2020-01-01", done: true })], TODAY).overdue, 0);

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
