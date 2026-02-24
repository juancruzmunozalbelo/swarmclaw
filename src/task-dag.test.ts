import { describe, it, expect } from 'vitest';
import { evaluateDag, getNextTasks, topologicalSort, type DagTask } from './task-dag.js';

const task = (id: string, state: DagTask['state'], deps: string[] = []): DagTask => ({ id, state, deps });

describe('evaluateDag', () => {
    it('classifies ready tasks (no deps)', () => {
        const result = evaluateDag([
            task('A', 'todo'),
            task('B', 'todo'),
        ]);
        expect(result.ready).toEqual(['A', 'B']);
        expect(result.waiting).toEqual([]);
    });

    it('classifies waiting tasks (unmet deps)', () => {
        const result = evaluateDag([
            task('A', 'todo'),
            task('B', 'todo', ['A']),
        ]);
        expect(result.ready).toEqual(['A']);
        expect(result.waiting).toEqual(['B']);
    });

    it('classifies completed and active tasks', () => {
        const result = evaluateDag([
            task('A', 'done'),
            task('B', 'doing', ['A']),
            task('C', 'todo', ['A']),
        ]);
        expect(result.completed).toEqual(['A']);
        expect(result.active).toEqual(['B']);
        expect(result.ready).toEqual(['C']);
    });

    it('unlocks tasks when deps are done', () => {
        const result = evaluateDag([
            task('A', 'done'),
            task('B', 'done'),
            task('C', 'todo', ['A', 'B']),
        ]);
        expect(result.ready).toEqual(['C']);
    });

    it('detects dependency cycles', () => {
        const result = evaluateDag([
            task('A', 'todo', ['B']),
            task('B', 'todo', ['A']),
        ]);
        expect(result.cycles).toContain('A');
        expect(result.cycles).toContain('B');
    });

    it('handles blocked tasks', () => {
        const result = evaluateDag([
            task('A', 'blocked'),
        ]);
        expect(result.waiting).toEqual(['A']);
    });
});

describe('getNextTasks', () => {
    it('respects maxConcurrent', () => {
        const tasks = [
            task('A', 'todo'),
            task('B', 'todo'),
            task('C', 'todo'),
        ];
        expect(getNextTasks(tasks, 2)).toEqual(['A', 'B']);
    });

    it('accounts for active tasks', () => {
        const tasks = [
            task('A', 'doing'),
            task('B', 'todo'),
            task('C', 'todo'),
        ];
        expect(getNextTasks(tasks, 2)).toEqual(['B']);
    });

    it('returns empty when at capacity', () => {
        const tasks = [
            task('A', 'doing'),
            task('B', 'doing'),
            task('C', 'todo'),
        ];
        expect(getNextTasks(tasks, 2)).toEqual([]);
    });
});

describe('topologicalSort', () => {
    it('returns dependency order', () => {
        const sorted = topologicalSort([
            task('C', 'todo', ['A', 'B']),
            task('A', 'todo'),
            task('B', 'todo', ['A']),
        ]);
        expect(sorted.indexOf('A')).toBeLessThan(sorted.indexOf('B'));
        expect(sorted.indexOf('B')).toBeLessThan(sorted.indexOf('C'));
    });

    it('handles independent tasks', () => {
        const sorted = topologicalSort([
            task('X', 'todo'),
            task('Y', 'todo'),
        ]);
        expect(sorted).toHaveLength(2);
    });

    it('handles cycles without crashing', () => {
        const sorted = topologicalSort([
            task('A', 'todo', ['B']),
            task('B', 'todo', ['A']),
        ]);
        expect(sorted).toHaveLength(2);
    });
});
