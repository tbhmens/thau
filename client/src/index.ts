import type { Thau as ThauT } from "./thau.js";

const isWeb = typeof window !== "undefined";
export type {
	MWOptions,
	ThauError,
	ThauExtended,
	UnknownError,
} from "./middleware.js";
export type {
	ExpiredToken,
	InvalidSignature,
	InvalidToken,
	MissingQuery,
	ThauOptions,
	ThauToken,
	WrongAudience,
} from "./thau.js";

export const Thau: ThauT = (
	isWeb ? await import("./web.js") : await import("./node.js")
).Thau;

function THROW() {
	throw new Error("Thau middleware is not available in a web environment.");
}
const middleware = isWeb
	? { coggers: THROW, express: THROW }
	: await import("./middleware.js");
export const coggers: typeof import("./middleware.js").coggers =
	middleware.coggers as typeof import("./middleware.js").coggers;
export const express: typeof import("./middleware.js").express =
	middleware.express as typeof import("./middleware.js").express;
