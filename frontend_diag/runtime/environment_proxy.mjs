/*! COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027 */

// ../runtime/environment_proxy.ts
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { isIP } from "node:net";
function proxyRoute(address, env = process.env) {
  const host = address.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || /^127\./.test(host)) return null;
  const secure = address.protocol === "https:", port = address.port || (secure ? "443" : "80");
  for (const entry of (env.no_proxy || env.NO_PROXY || "").toLowerCase().split(/[,\s]+/).filter(Boolean)) {
    if (entry === "*") return null;
    const match = entry.match(/^(.+):(\d+)$/);
    if (match && match[2] !== port) continue;
    const name = match?.[1] || entry;
    if (name.startsWith(".") || name.startsWith("*")) {
      if (host.endsWith(name.replace(/^\*/, ""))) return null;
    } else if (host === name) return null;
  }
  const httpProxy = env.http_proxy || env.HTTP_PROXY || "";
  const value = secure ? env.https_proxy || env.HTTPS_PROXY || httpProxy : httpProxy;
  if (!value) return null;
  try {
    const proxy = new URL(value);
    if (!["http:", "https:"].includes(proxy.protocol) || proxy.pathname !== "/" || proxy.search || proxy.hash) throw Error();
    decodeURIComponent(proxy.username);
    decodeURIComponent(proxy.password);
    return proxy;
  } catch {
    throw new Error("proxy-config");
  }
}
var MetadataProxyAgent = class extends https.Agent {
  constructor(proxy) {
    super({ keepAlive: false, maxCachedSessions: 0 });
    this.proxy = proxy;
  }
  pending = /* @__PURE__ */ new Set();
  tunnels = /* @__PURE__ */ new Set();
  closed = false;
  createConnection(options, callback) {
    let complete = false;
    const done = (error, socket) => {
      if (complete) return;
      complete = true;
      callback?.(error, socket);
    };
    if (this.closed) {
      done(new Error("stopped"));
      return;
    }
    const hostname = String(options.hostname || options.host), authority = `${hostname}:${options.port || 443}`;
    const headers = { Host: authority };
    if (this.proxy.username || this.proxy.password) headers["Proxy-Authorization"] = "Basic " + Buffer.from(decodeURIComponent(this.proxy.username) + ":" + decodeURIComponent(this.proxy.password)).toString("base64");
    const transport = this.proxy.protocol === "https:" ? https : http;
    const request = transport.request({ hostname: this.proxy.hostname.replace(/^\[|\]$/g, ""), port: this.proxy.port || (this.proxy.protocol === "https:" ? 443 : 80), method: "CONNECT", path: authority, headers, agent: false, rejectUnauthorized: true });
    this.pending.add(request);
    request.once("close", () => this.pending.delete(request));
    request.once("error", (error) => done(error));
    request.once("connect", (response, socket, head) => {
      this.pending.delete(request);
      if (this.closed) {
        socket.destroy();
        done(new Error("stopped"));
        return;
      }
      if (response.statusCode !== 200) {
        socket.destroy();
        done(new Error(response.statusCode === 407 ? "proxy-auth" : "proxy-connect"));
        return;
      }
      if (head.length) {
        socket.destroy();
        done(new Error("proxy-connect"));
        return;
      }
      this.tunnels.add(socket);
      socket.once("close", () => this.tunnels.delete(socket));
      const secured = tls.connect({ socket, servername: isIP(hostname) ? void 0 : hostname, rejectUnauthorized: true });
      this.tunnels.add(secured);
      secured.once("close", () => this.tunnels.delete(secured));
      secured.once("error", (error) => {
        socket.destroy();
        done(error);
      });
      secured.once("secureConnect", () => done(null, secured));
    });
    request.end();
  }
  destroy() {
    this.closed = true;
    for (const request of this.pending) request.destroy();
    for (const socket of this.tunnels) socket.destroy();
    this.pending.clear();
    this.tunnels.clear();
    super.destroy();
  }
};
function networkFailure(error) {
  const code = error?.code || "";
  const message = error instanceof Error ? error.message : "";
  if (["proxy-config", "proxy-auth", "proxy-connect", "stopped"].includes(message)) return message;
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return "dns";
  if (["CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_TLS_CERT_ALTNAME_INVALID"].includes(code)) return "tls";
  return "network";
}
export {
  MetadataProxyAgent,
  networkFailure,
  proxyRoute
};
