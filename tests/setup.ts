import "@testing-library/jest-dom";
import fs from "fs";
import path from "path";

// Load .env.local into process.env for local integration tests
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

// Polyfill/stub BroadcastChannel in test environment to avoid Node 22 / JSDOM MessageEvent collision
if (typeof globalThis.BroadcastChannel !== "undefined") {
  class MockBroadcastChannel {
    name: string;
    onmessage = null;
    onmessageerror = null;
    constructor(name: string) {
      this.name = name;
    }
    postMessage() {}
    close() {}
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() {
      return true;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.BroadcastChannel = MockBroadcastChannel as any;
  if (typeof window !== "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).BroadcastChannel = MockBroadcastChannel as any;
  }
}
