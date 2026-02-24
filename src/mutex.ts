/**
 * Simple async Mutex for preventing race conditions (Dirty Writes & Lost Updates)
 * in single-threaded Node.js when dealing with asynchronous I/O across parallel subagents.
 */
export class Mutex {
    private locked = false;
    private queue: (() => void)[] = [];

    /** Acquires the lock. Returns a release function to be called in a finally block. */
    async acquire(): Promise<() => void> {
        return new Promise((resolve) => {
            const release = () => {
                if (this.queue.length > 0) {
                    const next = this.queue.shift();
                    next?.();
                } else {
                    this.locked = false;
                }
            };
            if (!this.locked) {
                this.locked = true;
                resolve(release);
            } else {
                this.queue.push(() => resolve(release));
            }
        });
    }
}

/** 
 * Map of Mutexes keyed by arbitrary strings (e.g., groupFolder).
 * Useful for locking resources specific to a tenant/group.
 */
export class KeyedMutex {
    private mutexes = new Map<string, Mutex>();

    /** Acquires a lock for a specific key. */
    async acquire(key: string): Promise<() => void> {
        let mutex = this.mutexes.get(key);
        if (!mutex) {
            mutex = new Mutex();
            this.mutexes.set(key, mutex);
        }
        const release = await mutex.acquire();
        // Wrap release to cleanup empty mutexes to prevent memory leaks over long uptimes
        return () => {
            release();
            // Note: we don't strictly delete here to avoid race conditions on the map itself
            // without extra tracking, but maintaining a Map of groupFolders is safe since
            // groupFolders are finite and small in number.
        };
    }
}
