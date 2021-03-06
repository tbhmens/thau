import type { IncomingMessage, ServerResponse } from "node:http";
import type { ThauOptions, ThauToken } from "./index.js";
import { Thau } from "./node.js";
import {
	ExpiredToken,
	InvalidKeyId,
	InvalidSignature,
	InvalidToken,
	MissingQuery,
	WrongAudience,
} from "./thau.js";

export type UnknownError = ["unknown_error", Error];
export type ThauError =
	| MissingQuery
	| InvalidToken
	| ExpiredToken
	| WrongAudience
	| InvalidSignature
	| InvalidKeyId
	| UnknownError;

type baseH = (
	req: IncomingMessage,
	res: ServerResponse
) => void | Promise<void>;

export type MWOptions<H extends baseH = baseH> = {
	error?: (reason: ThauError, ...reqres: Parameters<H>) => ReturnType<H>;
};

const messages = {
	missing_query: ([, missing]: MissingQuery) =>
		`[thau] Invalid Request (Missing ${missing.join(", ")})`,
	invalid_token: ([, missing]: InvalidToken) =>
		`[thau] Invalid Token (Missing ${missing.join(", ")})`,
	expired_token: ([, since]: ExpiredToken) =>
		`[thau] Expired Token (since ${since})`,
	invalid_signature: ([, signature]: InvalidSignature) =>
		`[thau] Invalid Signature (got ${signature})`,
	wrong_audience: ([, audience]: WrongAudience) =>
		`[thau] Invalid Token (Wrong Audience: ${audience})`,
	invalid_key_id: ([, keyId]: InvalidKeyId) =>
		`[thau] Invalid Token (Invalid Key ID: ${keyId})`,
	unknown_error: ([, error]: UnknownError) => {
		console.error(error);
		return "[thau] Unknown Error.";
	},
};

const defaults: MWOptions = {
	error: (err, _, res) => {
		res.writeHead(400).end(messages[err[0]](err as any));
	},
};

export type ThauExtended = {
	thau?: ThauToken;
};

/** After this middleware, you can get the thau uid (as a string) from req.thau.uid */
const coggersHandler = (options: ThauOptions & MWOptions) => {
	const { error: sendError } = { ...defaults, ...options };
	const thau = new Thau(options);

	return (
		req: IncomingMessage & {
			query: Record<string, any>;
		} & Partial<ThauExtended>,
		res: ServerResponse
	): Promise<void> => {
		return thau.verifyRequest(req).then(
			token => ((req.thau = token), undefined),
			error =>
				sendError(
					Array.isArray(error)
						? (error as ThauError)
						: ["unknown_error", error],
					req,
					res
				)
		);
	};
};

const expressHandler = (options: ThauOptions & MWOptions) => {
	const coggers = coggersHandler(options);
	return (req, res: ServerResponse, next) =>
		coggers(req, res).then(() => res.writableEnded || next(), next);
};
export { coggersHandler as coggers, expressHandler as express };
