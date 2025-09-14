import { Pagefind } from "./coupled_search.js";

interface WorkerMessage {
  id: string;
  method: string;
  args: any[];
}

interface WorkerResponse {
  id: string;
  result?: any;
  error?: string;
}

let dataCallbacks: Map<string, any> = new Map();
let pagefindInstance: Pagefind | null = null;

const handleMessage = async (
  message: WorkerMessage,
): Promise<WorkerResponse> => {
  const { id, method, args } = message;

  try {
    switch (method) {
      case "init": {
        const [options] = args;
        pagefindInstance = new Pagefind(options);
        return { id, result: true };
      }

      case "options": {
        if (!pagefindInstance) {
          throw new Error("Pagefind not initialized");
        }
        const [options] = args;
        await pagefindInstance.options(options);
        return { id, result: true };
      }

      case "enterPlaygroundMode": {
        if (!pagefindInstance) {
          throw new Error("Pagefind not initialized");
        }
        await pagefindInstance.enterPlaygroundMode();
        return { id, result: true };
      }

      case "mergeIndex": {
        if (!pagefindInstance) {
          throw new Error("Pagefind not initialized");
        }
        const [indexPath, options] = args;
        await pagefindInstance.mergeIndex(indexPath, options);
        return { id, result: true };
      }

      case "search": {
        if (!pagefindInstance) {
          throw new Error("Pagefind not initialized");
        }
        const [term, options] = args;
        const results = await pagefindInstance.search(term, options);

        // Convert the data() functions to IDs that can be called later
        if (results && results.results) {
          for (let i = 0; i < results.results.length; i++) {
            const result = results.results[i];
            const dataFn = result.data;
            const dataId = `data_${id}_${i}`;

            dataCallbacks.set(dataId, {
              getData: dataFn,
            } as any);

            result.data = dataId as any;
          }
        }

        if (results && options && options.verbose) {
          results.search_environment = "webworker";
        }

        return { id, result: results };
      }

      case "debouncedSearch": {
        if (!pagefindInstance) {
          throw new Error("Pagefind not initialized");
        }
        const [term, options, debounceTimeoutMs] = args;
        const results = await pagefindInstance.debouncedSearch(
          term,
          options,
          debounceTimeoutMs,
        );

        // Convert the data() functions to IDs that can be called later
        if (results && results.results) {
          for (let i = 0; i < results.results.length; i++) {
            const result = results.results[i];
            const dataFn = result.data;
            const dataId = `data_${id}_${i}`;

            dataCallbacks.set(dataId, {
              getData: dataFn,
            } as any);

            result.data = dataId as any;
          }
        }

        if (results && options && options.verbose) {
          results.search_environment = "webworker";
        }

        return { id, result: results };
      }

      case "preload": {
        if (!pagefindInstance) {
          throw new Error("Pagefind not initialized");
        }
        const [term, options] = args;
        await pagefindInstance.preload(term, options);
        return { id, result: true };
      }

      case "filters": {
        if (!pagefindInstance) {
          throw new Error("Pagefind not initialized");
        }
        const result = await pagefindInstance.filters();
        return { id, result };
      }

      case "getData": {
        const [dataId] = args;
        const instance = dataCallbacks.get(dataId);
        if (!instance || !(instance as any).getData) {
          throw new Error(`Data function ${dataId} not found`);
        }
        const data = await (instance as any).getData();
        return { id, result: data };
      }

      case "releaseData": {
        const [dataId] = args;
        dataCallbacks.delete(dataId);
        return { id, result: true };
      }

      case "destroy": {
        dataCallbacks.clear();
        pagefindInstance = null;
        return { id, result: true };
      }

      default:
        throw new Error(`Unknown method: ${method}`);
    }
  } catch (error) {
    return {
      id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

self.addEventListener("message", async (event: MessageEvent) => {
  const message = event.data as WorkerMessage;
  const response = await handleMessage(message);
  self.postMessage(response);
});

export {};
