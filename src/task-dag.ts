/**
 * Task DAG — dependency-aware task scheduling.
 * Provides topological sort and "ready to run" evaluation for tasks
 * with explicit dependencies (from todo.md Dependencias field).
 *
 * Sprint 17 — Audit item #5 (DAG Workflow Foundation).
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface DagTask {
    id: string;
    state: 'planning' | 'todo' | 'doing' | 'blocked' | 'done';
    deps: string[];
}

export interface DagEvaluation {
    /** Tasks ready to start (all deps done, not yet started) */
    ready: string[];
    /** Tasks currently in progress */
    active: string[];
    /** Tasks blocked by unmet dependencies */
    waiting: string[];
    /** Tasks that are done */
    completed: string[];
    /** Tasks involved in a dependency cycle */
    cycles: string[];
}

// ── Core API ───────────────────────────────────────────────────────────────

/**
 * Evaluate the DAG and classify tasks by readiness.
 */
export function evaluateDag(tasks: DagTask[]): DagEvaluation {
    const byId = new Map<string, DagTask>();
    for (const t of tasks) byId.set(t.id, t);

    const completed: string[] = [];
    const active: string[] = [];
    const ready: string[] = [];
    const waiting: string[] = [];
    const cycles: string[] = [];

    const doneSet = new Set<string>();
    for (const t of tasks) {
        if (t.state === 'done') doneSet.add(t.id);
    }

    // Detect cycles via DFS
    const cycleSet = detectCycles(tasks);

    for (const t of tasks) {
        if (cycleSet.has(t.id)) {
            cycles.push(t.id);
            continue;
        }

        if (t.state === 'done') {
            completed.push(t.id);
        } else if (t.state === 'doing') {
            active.push(t.id);
        } else if (t.state === 'blocked') {
            waiting.push(t.id);
        } else {
            // planning or todo: check if all deps are done
            const allDepsDone = t.deps.every((d) => doneSet.has(d));
            if (allDepsDone) {
                ready.push(t.id);
            } else {
                waiting.push(t.id);
            }
        }
    }

    return { ready, active, waiting, completed, cycles };
}

/**
 * Get the next N tasks to start, respecting dependencies and concurrency.
 */
export function getNextTasks(tasks: DagTask[], maxConcurrent = 1): string[] {
    const evaluation = evaluateDag(tasks);
    const slotsAvailable = Math.max(0, maxConcurrent - evaluation.active.length);
    return evaluation.ready.slice(0, slotsAvailable);
}

/**
 * Topological sort of task IDs. Returns tasks in dependency order.
 * Tasks with no dependencies come first.
 */
export function topologicalSort(tasks: DagTask[]): string[] {
    const byId = new Map<string, DagTask>();
    for (const t of tasks) byId.set(t.id, t);

    const visited = new Set<string>();
    const result: string[] = [];
    const visiting = new Set<string>(); // cycle detection

    function visit(id: string): void {
        if (visited.has(id)) return;
        if (visiting.has(id)) return; // cycle — skip
        visiting.add(id);

        const task = byId.get(id);
        if (task) {
            for (const dep of task.deps) {
                visit(dep);
            }
        }

        visiting.delete(id);
        visited.add(id);
        result.push(id);
    }

    for (const t of tasks) visit(t.id);
    return result;
}

// ── Cycle detection ────────────────────────────────────────────────────────

function detectCycles(tasks: DagTask[]): Set<string> {
    const byId = new Map<string, DagTask>();
    for (const t of tasks) byId.set(t.id, t);

    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    for (const t of tasks) color.set(t.id, WHITE);

    const inCycle = new Set<string>();

    function dfs(id: string, path: string[]): boolean {
        color.set(id, GRAY);
        path.push(id);

        const task = byId.get(id);
        if (task) {
            for (const dep of task.deps) {
                if (!byId.has(dep)) continue; // external dep — ignore
                const c = color.get(dep);
                if (c === GRAY) {
                    // Found cycle — mark all nodes in the cycle path
                    const cycleStart = path.indexOf(dep);
                    for (let i = cycleStart; i < path.length; i++) {
                        inCycle.add(path[i]);
                    }
                    return true;
                }
                if (c === WHITE) {
                    dfs(dep, path);
                }
            }
        }

        path.pop();
        color.set(id, BLACK);
        return false;
    }

    for (const t of tasks) {
        if (color.get(t.id) === WHITE) {
            dfs(t.id, []);
        }
    }

    return inCycle;
}
