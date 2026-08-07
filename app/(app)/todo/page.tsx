"use client";

import { useMemo, useState } from "react";
import { sortTodos, todoCounts, todoState, todayISO, type Todo } from "@/lib/supabase";
import { useDash } from "../DashContext";

// ─────────────────────────────────────────────────────────────
// To do — notes for work that still has to go into the tracker.
//
// Written in a hurry, so the bar at the top asks for one thing: what needs
// doing. The deadline is optional and sits beside it; anything that demanded
// more fields would simply stop getting written down.
//
// Order is the whole value of the page: overdue first, then today, then by
// deadline, undated below that, finished at the bottom. You should never have
// to look for what's late.
// ─────────────────────────────────────────────────────────────

const LABEL: Record<ReturnType<typeof todoState>, string> = {
  overdue: "late", today: "today", upcoming: "", someday: "", done: "",
};

/** "in 3 days" / "2 days late" — a date alone doesn't say how urgent it is. */
function relative(due: string, today: string): string {
  const days = Math.round((Date.parse(due) - Date.parse(today)) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days late`;
}

export default function TodoPage() {
  const { todos, loading, todosError, saveTodo, removeTodo, clearDoneTodos } = useDash();
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [showDone, setShowDone] = useState(true);
  // Fixed for the render, so a row can't change category mid-interaction.
  const today = todayISO();

  const counts = useMemo(() => todoCounts(todos, today), [todos, today]);
  const shown = useMemo(() => {
    const list = showDone ? todos : todos.filter((t) => !t.done);
    return sortTodos(list, today);
  }, [todos, showDone, today]);

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    saveTodo({ text: text.trim(), due: due || null });
    setText("");
    setDue("");
  }

  return (
    <>
      <div className="toolbar">
        <h1>To do</h1>
        <div className="summary">
          <div className="stat">
            <div className="label">Open</div>
            <div className="value">{counts.open || "—"}</div>
          </div>
          <div className="stat">
            <div className="label">Late</div>
            <div className={"value " + (counts.overdue > 0 ? "stat-problem" : "")}>
              {counts.overdue || "—"}
            </div>
          </div>
          <div className="stat">
            <div className="label">Due today</div>
            <div className="value">{counts.dueToday || "—"}</div>
          </div>
        </div>
      </div>

      {/* Write and hit Enter. The deadline is optional and stays put after
          adding, so a run of items for the same day costs one date pick. */}
      <form className="quick-add" onSubmit={add}>
        <input className="qa-desc" value={text} onChange={(e) => setText(e.target.value)}
               placeholder="What needs doing? e.g. add buy prices for the LA28 batch"
               aria-label="Note" autoFocus />
        <input className="qa-date" type="date" value={due} onChange={(e) => setDue(e.target.value)}
               aria-label="Deadline" title="Deadline — optional" />
        <button className="btn btn-primary" type="submit">Add</button>
      </form>

      {todosError && (
        <div className="error-banner">
          <strong>Couldn’t load your notes.</strong> {todosError}
          {" "}If this is the first time you’re opening this page, run <code>supabase/schema.sql</code> again
          in the Supabase SQL editor — it creates the <code>todos</code> table.
        </div>
      )}

      {todos.length > 0 && (
        <div className="table-toolbar">
          <label className="scan-check" style={{ margin: 0 }}>
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            <span>Show finished ({counts.done})</span>
          </label>
          {counts.done > 0 && (
            <div className="export-actions">
              <button className="btn btn-sm btn-ghost" onClick={clearDoneTodos}>Clear finished</button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="empty">Loading…</div>
      ) : todosError ? null : todos.length === 0 ? (
        <div className="empty">
          Nothing noted yet. Type what you need to get back to — a deadline is optional.
        </div>
      ) : shown.length === 0 ? (
        <div className="empty">Nothing open. Tick “Show finished” to see what’s been cleared.</div>
      ) : (
        <div className="todo-list">
          {shown.map((t: Todo) => {
            const state = todoState(t, today);
            return (
              <div key={t.id} className={`todo-row is-${state}`}>
                <input type="checkbox" className="todo-check" checked={t.done}
                       onChange={() => saveTodo({ id: t.id, done: !t.done })}
                       title={t.done ? "Reopen" : "Mark as done"} />
                <div className="todo-body">
                  <div className="todo-text">{t.text}</div>
                  {t.due && (
                    <div className="todo-meta">
                      <span className="todo-due">{t.due}</span>
                      <span className="todo-rel">
                        {t.done ? "" : relative(t.due, today)}
                      </span>
                      {LABEL[state] && <span className={`todo-tag tag-${state}`}>{LABEL[state]}</span>}
                    </div>
                  )}
                </div>
                {/* Editing the deadline in place: the date is the thing that
                    actually moves once something is written down. */}
                <input type="date" className="todo-date" value={t.due ?? ""}
                       onChange={(e) => saveTodo({ id: t.id, due: e.target.value || null })}
                       title="Deadline" />
                <button className="btn btn-sm btn-danger" onClick={() => removeTodo(t.id)}>Delete</button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
