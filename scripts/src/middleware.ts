import * as express from "express";
import { performance } from "perf_hooks";
import { LoggerInstance } from "winston";
import { Request, Response } from "express-serve-static-core";

import { generateId } from "./utils";
import { getDefaultLogger } from "./logging";

const START_TIME = (new Date()).toISOString();
let logger: LoggerInstance;
export function init(app: express.Express) {
	logger = getDefaultLogger();

	app.use(requestLogger);
	app.use(logRequest);
}

declare module "express" {
	interface Request {
		readonly id: string;
		readonly logger: LoggerInstance;
	}
}

/**
 * augments the request object with a request-id and a logger.
 * the logger should be then used when logging inside request handlers, which will then add some more info per log
 */
export const requestLogger = function(req: express.Request, res: express.Response, next: express.NextFunction) {
	const methods = ["debug", "info", "warn", "error"];
	const id = generateId();
	const proxy = new Proxy(logger, {
		get(target, name: keyof LoggerInstance) {
			if (typeof name === "string" && methods.includes(name)) {
				return function(...args: any[]) {
					if (typeof args[args.length - 1] === "object") {
						args[args.length - 1] = Object.assign({}, args[args.length - 1], { reqId: id });
					} else {
						args = [...args, { reqId: id }];
					}

					(target[name] as (...args: any[]) => void)(...args);
				};
			}

			return target[name];
		}
	});

	// id & logger are readonly and so cannot be assigned, unless cast to any
	(req as any).id = id;
	(req as any).logger = proxy;
	next();
} as express.RequestHandler;

export const logRequest = function(req: express.Request, res: express.Response, next: express.NextFunction) {
	const t = performance.now();
	const data = Object.assign({}, req.headers);

	if (req.query && Object.keys(req.query).length > 0) {
		data.querystring = req.query;
	}

	req.logger.info(`start handling request ${ req.id }: ${ req.method } ${ req.path }`, data);

	res.on("finish", () => {
		req.logger.info(`finished handling request ${ req.id }`, { time: performance.now() - t });
	});

	next();
} as express.RequestHandler;

export const notFoundHandler = function(req: Request, res: Response) {
	// log.error(`Error 404 on ${req.url}.`);
	res.status(404).send({ status: 404, error: "Not found" });
} as express.RequestHandler;

export type ApiError = {
	status: number;
	error: string;
};

/**
 * The "next" arg is needed even though it's not used, otherwise express won't understand that it's an error handler
 */
export function generalErrorHandler(err: any, req: Request, res: Response, next: express.NextFunction) {
	let message = `Error
	method: ${ req.method }
	path: ${ req.url }
	payload: ${ JSON.stringify(req.body) }
	`;

	if (err instanceof Error) {
		message += `message: ${ err.message }
	stack: ${ err.stack }`;
	} else {
		message += `message: ${ err.toString() }`;
	}

	logger.error(message);
	res.status(500).send({ status: 500, error: err.message || "Server error" });
}

export const statusHandler = async function(req: express.Request, res: express.Response) {
	res.status(200).send(
		{
			status: "ok",
			app_name: process.env.APP_NAME,
			start_time: START_TIME,
			build: {
				commit: process.env.BUILD_COMMIT,
				timestamp: process.env.BUILD_TIMESTAMP,
			}
		});
} as any as express.RequestHandler;
