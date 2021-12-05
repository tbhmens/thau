import { Coggers, renderEngine, serveStatic } from "coggers";
import { coggersSession } from "coggers-session";
import { webcrypto } from "node:crypto";
import { STATUS_CODES } from "node:http";
import { renderFile } from "poggies";
import * as discord from "./accounts/discord.js";
import * as github from "./accounts/github.js";
import * as twitch from "./accounts/twitch.js";
import * as twitter from "./accounts/twitter.js";
import { getsert } from "./database.js";
import { sample } from "./sample.js";
import { Handler, prod, Req, Res, secrets } from "./utils.js";
const { subtle } = webcrypto as unknown as typeof window.crypto;
type ThauToken = {
	uid: string;
	iat: number;
	aud: string;
};
const { publicKey: publicJWK, privateKey: privateJWK } = secrets("signing");
const sessionSecret: string[] = secrets("session");

const SHATYPE = "SHA-384";
const privateKey = await subtle.importKey(
	"jwk",
	privateJWK,
	{ name: "ECDSA", hash: SHATYPE, namedCurve: privateJWK.crv },
	false,
	["sign"]
);
const sessionPass = sessionSecret.map(str => Buffer.from(str, "base64"));

const prelogin: Handler = (req, res) => {
	if (!req.session.callback) res.error("No Callback", 400);
};
const postlogin: Handler = async (req, res) => {
	const user = req.user;
	const { callback } = req.session;
	if (!callback) return res.status(400).send("No callback");

	const uid = await getsert(user.type, user.id);
	const token: ThauToken = {
		uid,
		iat: Date.now() / 1000,
		aud: callback,
	};
	const bufToken = Buffer.from(JSON.stringify(token));
	const sign = await subtle.sign(
		{
			name: "ECDSA",
			hash: { name: SHATYPE },
		},
		privateKey,
		bufToken
	);
	const signature = Buffer.from(sign).toString("base64url");
	const b64token = bufToken.toString("base64url");
	const redirect = `${callback}?token=${b64token}&signature=${signature}`;
	res.deleteSession();
	res.redirect(redirect);
};
const preredirect =
	(saveSession = true): Handler =>
	(req, res) => {
		const { callback } = req.query;
		if (!callback) res.error("No Callback", 400);
		req.session = { callback };
		if (saveSession) res.saveSession();
	};
const coggers = new Coggers(
	{
		$: [
			coggersSession({
				password: sessionPass,
				name: "thau-session",
				cookie: {
					maxAge: 604800,
					sameSite: "Lax",
					httpOnly: true,
					path: "/",
					secure: prod,
				},
			}),
			(req, res) => {
				if (req.headers["x-forwarded-proto"])
					if (req.headers["x-forwarded-proto"] === "http")
						// Redirect http to https
						return res.redirect(`https://${req.host}${req.url}`);
					else req.purl.protocol = req.headers["x-forwarded-proto"] + ":";
				res.set("Access-Control-Allow-Origin", "*");
				res.error = (msg: string, code = 400) => res.status(code).send(msg);
			},
			prod
				? []
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
							const type = Math.floor(code / 100);
							const color: string = colors[type];
							console.log(
								req.method +
									` \x1b[1m${color + code} \x1b[0m${color}` +
									(res.statusMessage || STATUS_CODES[code]) +
									` \x1b[0m${req.url}` +
									(res.headers.Location ? " => " + res.headers.Location : "")
							);
						});
				  },
			renderEngine(renderFile, new URL("../views", import.meta.url), "pog"),
		],
		keys: {
			$get(_, res) {
				res.json({ key: publicJWK, shatype: SHATYPE });
			},
		},
		auth: {
			...serveStatic(new URL("../static/auth", import.meta.url)),
			$get(req: Req, res: Res) {
				const callback = req.query.callback;
				if (!callback) return res.status(400).send("No callback specified");
				res.render("auth", {
					callback,
					accounts: [
						["Discord", "discord"],
						["GitHub", "github"],
						["Twitch", "twitch"],
						["Twitter", "twitter"],
					],
				});
			},
			// future: construct this bluepart automatically
			discord: {
				$get: [preredirect(!discord.redirect.savesSession), discord.redirect],
				callback: { $get: [prelogin, discord.callback, postlogin] },
			},
			github: {
				$get: [preredirect(!github.redirect.savesSession), github.redirect],
				callback: { $get: [prelogin, github.callback, postlogin] },
			},
			twitch: {
				$get: [preredirect(!twitch.redirect.savesSession), twitch.redirect],
				callback: { $get: [prelogin, twitch.callback, postlogin] },
			},
			twitter: {
				$get: [preredirect(!twitter.redirect.savesSession), twitter.redirect],
				callback: { $get: [prelogin, twitter.callback, postlogin] },
			},
		},
		sample,
		$get(_req, res) {
			res.redirect("/sample");
		},
	},
	{
		xPoweredBy: [
			"a bunch of little cogwheels spinning around",
			"just a little guy",
			"three cats in a hat",
			"one (1) cogger",
			"gaming",
		][Math.floor(Math.random() * 5)],
	}
);
const PORT = process.env.PORT || 8080;
await coggers.listen(PORT);
console.log(`Thau listening @ http://localhost:${PORT}/`);
export const server = coggers.server;
