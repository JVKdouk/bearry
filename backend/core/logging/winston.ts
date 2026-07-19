import winston from "winston";

export const WinstonLogger = winston.createLogger({
  level: "debug",
  format: winston.format.simple(),
  transports: [
    new winston.transports.File({ filename: "logs/debug.log", level: "debug" }),
  ],
});
