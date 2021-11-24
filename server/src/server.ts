import { Coggers, express } from "coggers";
import { coggersSession } from "coggers-session";
import { createPrivateKey, createSign } from "node:crypto";
import { STATUS_CODES } from "node:http";
import { fileURLToPath } from "node:url";
import sirv from "sirv";
import * as discord from "./accounts/discord.js";
import { getsert } from "./database.js";
import { Req, Res, secrets } from "./utils.js";

type ThauToken = {
	uid: string;
	iat: number;
	aud: string;
};
const { publicKey: publicJWK, privateKey: privateJWK } = secrets("signing");
const sessionSecret: string[] = secrets("session");

const privateKey = createPrivateKey({ key: privateJWK, format: "jwk" });
const decodeB64url = (str: string) => Buffer.from(str, "base64url");
const sessionPass = sessionSecret.map(decodeB64url);

const done = async (req: Req, res: Res) => {
	const { callback, user } = req.session;
	if (!callback) return res.status(400).send();

	const uid = await getsert(user.type, user.id);
	const token: ThauToken = {
		uid,
		iat: Date.now() / 1000,
		aud: callback,
	};
	const strToken = JSON.stringify(token);
	const sign = createSign("SHA256");
	sign.update(strToken);
	sign.end();
	const signature = sign.sign(privateKey).toString("base64url");
	const b64token = Buffer.from(strToken).toString("base64url");
	const redirect = `${callback}?token=${b64token}&signature=${signature}`;
	res.deleteSession();
	res.redirect(redirect);
};
const coggers = new Coggers(
	{
		$: [
			express(
				sirv(fileURLToPath(new URL("../static", import.meta.url)), {
					dev: true,
					extensions: [],
				})
			),
			coggersSession({
				password: sessionPass,
				name: "thau-session",
				cookie: {
					maxAge: 604800,
					sameSite: "Lax",
					httpOnly: true,
					path: "/",
				},
			}),
			(_, res) => {
				res.error = (msg: string, code = 400) => res.status(code).send(msg);
			},
			process.env.NODE_ENV === "production"
				? // prod logger
				  (req, res) =>
						res.on("finish", () =>
							console.log(`${req.method} ${res.statusCode} ${req.url}`)
						)
				: // dev logger
				  (req, res) => {
						const colors = {
							2: "\x1b[36m",
							3: "\x1b[32m",
							4: "\x1b[31m",
							5: "\x1b[35m",
						};
						res.on("finish", () => {
							const code = res.statusCode;
							const type = ~~(code / 100);
							const color: string = colors[type];
							console.log(
								req.method +
									` \x1b[1m${color + code} \x1b[0m${color}` +
									(res.statusMessage || STATUS_CODES[code]) +
									` \x1b[0m${req.url}` +
									(type === 3 ? " => " + res.headers.Location : "")
							);
						});
				  },
		],
		keys: {
			$get(_, res) {
				res.json({
					key: publicJWK,
				});
			},
		},
		auth: {
			$get(req: Req, res: Res) {
				const callback = req.query.callback;
				if (!callback) return res.status(400).send("No callback specified");
				req.session = { callback };
				res.saveSession();
				res.sendFile(new URL("../static/auth.html", import.meta.url));
			},
			discord: {
				$get: discord.redirect,
				callback: { $get: [discord.callback, done] },
			},
		},
	},
	{
		xPoweredBy: "a bunch of little cogwheels spinning around",
	}
);

const PORT = process.env.PORT || 8080;
await coggers.listen(PORT);
console.log(`Thau listening @ http://localhost:${PORT}/`);
export const server = coggers.server;