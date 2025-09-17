import { createLogger, format, transports } from 'winston';

const logger = createLogger({
    levels: { error: 0, warn: 1, info: 2, debug: 3, verbose: 4 },
    transports: [
        new transports.Console({ level: process.env.VERBOSE === 'true' ? 'verbose' : 'debug' }),
    ],
    format: format.combine(
        format.colorize(),
        format.timestamp({ format: 'MM-DD HH:mm:ss' }),
        format.printf(({ timestamp, level, message }) => `[${timestamp}] ${level}: ${message}`),
    ),
});

export {
    logger,
}