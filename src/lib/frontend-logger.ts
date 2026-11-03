import { privateLogContext } from './log-privacy';

interface LogOptions {
  /** Compatibility only: browser diagnostics are no longer uploaded. */
  sendToBackend?: boolean;
}

/** Local diagnostics only. Never collect page URLs, browser identity or request payloads. */
class FrontendLogger {
  info(prefix: string, message: string, context?: Record<string, unknown>, options: LogOptions = {}) {
    void options;
    console.log(`${prefix} ${message}`, privateLogContext(context) ?? '');
  }
  warn(prefix: string, message: string, context?: Record<string, unknown>, options: LogOptions = {}) {
    void options;
    console.warn(`${prefix} ${message}`, privateLogContext(context) ?? '');
  }
  error(prefix: string, message: string, context?: Record<string, unknown>, options: LogOptions = {}) {
    void options;
    console.error(`${prefix} ${message}`, privateLogContext(context) ?? '');
  }
  forceFlush() { /* Compatibility for old callers; there is no upload buffer. */ }
}

export const frontendLogger = new FrontendLogger();