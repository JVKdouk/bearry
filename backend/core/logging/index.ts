 
/* eslint-disable @typescript-eslint/no-explicit-any */

import { inspect } from "node:util";
import chalk from "chalk";
import { WinstonLogger } from "./winston";
import { CONFIG } from "../config";

const _console = globalThis.console;

/**
 * Override default console.log to provide the necessary structure
 * for improved software debugging and automated persistent logs
 * @param prefix Prefix of the log (symbol to represent the severity)
 * @param color Color of the log (also represents severity)
 * @param messages Variadic message to be printed out
 */
function genericLogger(prefix: string, color: string, drop?: boolean, ...messages: any) {
  if (!CONFIG.IS_DEV && drop) return;
  
  const colorWrapper = chalk.hex(color);
  const formattedMessages = messages.map((message: any) => {
    if (typeof message == "string") return colorWrapper(message);
    return colorWrapper(inspect(message));
  });

  _console.log(colorWrapper(prefix), "", ...formattedMessages);
}

// Functions implemented for the logger. Not all console functions
// and utilities are implemented, which could lead to an error if
// invoked by the end user
export const logger = {
  ...(console as any),

  log: (...message: any) => {
    genericLogger("●", "#2980b9", true, ...message);
  },
  info: (...message: any) => {
    genericLogger("🛈", "#2980b9", false, ...message);
  },
  error: (...message: any) => {
    genericLogger("✖", "#e74c3c", false, ...message);
  },
  warn: (...message: any) => {
    genericLogger("⚠", "#f39c12", false, ...message);
  },
  router: (url: string) => {
    genericLogger(">", "#16a085", true, url);
  },
  debug: (...message: any) => {
    genericLogger(">", "#8e44ad", true, ...message);
    WinstonLogger.log("debug", message.join(" "));
  },
};

type Logger = typeof logger;

globalThis.console = logger as Console & Logger;

declare global {
  interface Console extends Logger {}
}
