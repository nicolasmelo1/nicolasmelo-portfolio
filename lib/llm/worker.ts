/// <reference lib="webworker" />
import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

/**
 * The model runs here, off the main thread.
 *
 * Weight download, GPU compilation and token generation are all long and all
 * CPU-bound at some point; on the main thread each of them stalls typing. In a
 * worker the page stays responsive while the weights arrive in the background.
 */
const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (event: MessageEvent) => {
  handler.onmessage(event);
};
