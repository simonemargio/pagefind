import { Pagefind } from "./coupled_search.js";

const hasWorkerSupport =
  typeof window !== "undefined" &&
  typeof document !== "undefined" &&
  typeof Worker !== "undefined";

export class PagefindWrapper {
  private worker: Worker | null = null;
  private messageId = 0;
  private pendingMessages: Map<
    string,
    { resolve: Function; reject: Function }
  > = new Map();
  private fallback: Pagefind | null = null;
  private basePath: string;
  private initOptions: PagefindIndexOptions;
  private cleanup: FinalizationRegistry<string> | undefined;

  private initCleanup() {
    // Only initialize FinalizationRegistry if it exists (ES2021+)
    if (typeof FinalizationRegistry !== "undefined") {
      this.cleanup = new FinalizationRegistry((dataId: string) => {
        // When result object is GC'd, tell worker to release its data function
        if (this.worker) {
          this.worker.postMessage({
            id: `cleanup_${Date.now()}`,
            method: "releaseData",
            args: [dataId],
          });
          // Don't wait for response - this is just cleanup
        }
      });
    }
  }

  constructor(options: PagefindIndexOptions = {}) {
    this.basePath = options.basePath || "/pagefind/";
    this.initOptions = options;

    if (/[^\/]$/.test(this.basePath)) {
      this.basePath = `${this.basePath}/`;
    }

    if (
      hasWorkerSupport &&
      window?.location?.origin &&
      this.basePath.startsWith(window.location.origin)
    ) {
      this.basePath = this.basePath.replace(window.location.origin, "");
    }

    this.initCleanup();
    this.init();
  }

  private async init() {
    if (hasWorkerSupport && !(this.initOptions as any).noWorker) {
      try {
        const workerUrl = `${this.basePath}pagefind-worker.js`;
        this.worker = new Worker(workerUrl);

        this.worker.addEventListener("error", (error) => {
          console.warn(
            "The Pagefind web worker encountered an error, falling back to main thread:",
            error,
          );
          this.worker = null;
          this.initFallback();
        });

        this.worker.addEventListener("message", (event) => {
          const { id, result, error } = event.data;
          const pending = this.pendingMessages.get(id);
          if (pending) {
            this.pendingMessages.delete(id);
            if (error) {
              pending.reject(new Error(error));
            } else {
              pending.resolve(result);
            }
          }
        });

        await Promise.race([
          this.sendMessage("init", [this.initOptions]),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Worker initialization timeout")),
              5000,
            ),
          ),
        ]);
      } catch (error) {
        console.warn(
          "Failed to initialize the Pagefind web worker, falling back to main thread:",
          error,
        );
        this.worker = null;
        this.initFallback();
      }
    } else {
      this.initFallback();
    }
  }

  private initFallback() {
    if (!this.fallback) {
      this.fallback = new Pagefind(this.initOptions);
    }
  }

  private async sendMessage(method: string, args: any[]): Promise<any> {
    if (this.fallback) {
      const fn = (this.fallback as any)[method];
      if (typeof fn === "function") {
        const result = await fn.apply(this.fallback, args);

        // Mark any verbose search results with the main thread marker,
        // which is mainly used in the test suite.
        if (
          (method === "search" || method === "debouncedSearch") &&
          result &&
          args[1] &&
          args[1].verbose
        ) {
          result.search_environment = "mainthread";
        }

        return result;
      }
      throw new Error(`Method ${method} not found on fallback`);
    }

    if (!this.worker) {
      throw new Error("Worker not initialized");
    }

    return new Promise((resolve, reject) => {
      const id = `msg_${this.messageId++}`;
      this.pendingMessages.set(id, { resolve, reject });
      this.worker!.postMessage({ id, method, args });
    });
  }

  async options(options: PagefindIndexOptions) {
    return this.sendMessage("options", [options]);
  }

  async enterPlaygroundMode() {
    return this.sendMessage("enterPlaygroundMode", []);
  }

  async mergeIndex(indexPath: string, options: PagefindIndexOptions = {}) {
    return this.sendMessage("mergeIndex", [indexPath, options]);
  }

  async search(
    term: string,
    options: PagefindSearchOptions = {},
  ): Promise<PagefindIndexesSearchResults> {
    const results = await this.sendMessage("search", [term, options]);

    // Convert result data IDs into worker-calling functions
    if (results && results.results) {
      for (const result of results.results) {
        if (typeof result.data === "string") {
          const dataId = result.data;

          // Register this result object for cleanup when GC'd
          if (this.cleanup) {
            this.cleanup.register(result, dataId);
          }

          result.data = async () => {
            return this.sendMessage("getData", [dataId]);
          };
        }
      }
    }

    return results;
  }

  async debouncedSearch(
    term: string,
    options?: PagefindSearchOptions,
    debounceTimeoutMs?: number,
  ): Promise<PagefindIndexesSearchResults | null> {
    const results = await this.sendMessage("debouncedSearch", [
      term,
      options,
      debounceTimeoutMs,
    ]);

    // Convert result data IDs into worker-calling functions
    if (results && results.results) {
      for (const result of results.results) {
        if (typeof result.data === "string") {
          const dataId = result.data;

          // Register this result object for cleanup when GC'd
          if (this.cleanup) {
            this.cleanup.register(result, dataId);
          }

          result.data = async () => {
            return this.sendMessage("getData", [dataId]);
          };
        }
      }
    }

    return results;
  }

  async preload(term: string, options: PagefindSearchOptions = {}) {
    return this.sendMessage("preload", [term, options]);
  }

  async filters(): Promise<PagefindFilterCounts> {
    return this.sendMessage("filters", []);
  }

  async destroy() {
    if (this.worker) {
      await this.sendMessage("destroy", []);
      this.worker.terminate();
      this.worker = null;
    }
    if (this.fallback) {
      this.fallback = null;
    }
    this.pendingMessages.clear();
  }
}
