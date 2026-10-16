import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";

// Exercise the native runtime already locked and installed with Wrangler.
// No new package or external network request is needed for this regression.
const require = createRequire(import.meta.url);
const { Miniflare } = createRequire(require.resolve("wrangler"))("miniflare");

test(
  "native Workers API reads succeed and redirects never forward credentials",
  { timeout: 20000 },
  async () => {
    const bundled = await build({
      stdin: {
        contents: `import { api } from './src/api.ts';
        export default { async fetch() {
          try { return Response.json(await api('test-only')('/probe')); }
          catch (error) { return Response.json({ error:error.message }, { status:502 }); }
        } };`,
        resolveDir: resolve("."),
        sourcefile: "runtime-probe.ts",
        loader: "ts",
      },
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      write: false,
    });
    let redirect = false;
    const requests: { url: string; authorization: string | null }[] = [];
    const runtime = new Miniflare({
      workers: [
        {
          config: {
            name: "guard-runtime-test",
            compatibilityDate: "2026-08-31",
            manifest: {
              mainModule: "worker.js",
              modules: {
                "worker.js": {
                  type: "esm",
                  contents: bundled.outputFiles[0].text,
                },
              },
            },
          },
          dev: {
            outboundService: {
              type: "fetcher",
              handler: (request: Request) => {
                requests.push({
                  url: request.url,
                  authorization: request.headers.get("Authorization"),
                });
                return redirect
                  ? new Response(null, {
                      status: 302,
                      headers: { Location: "https://untrusted.invalid/" },
                    })
                  : Response.json({ success: true, result: { ok: true } });
              },
            },
          },
        },
      ],
    });
    try {
      const success = await runtime.dispatchFetch("http://localhost/probe");
      assert.equal(success.status, 200);
      assert.deepEqual(await success.json(), { ok: true });
      redirect = true;
      const rejected = await runtime.dispatchFetch("http://localhost/probe");
      assert.equal(rejected.status, 502);
      assert.deepEqual(await rejected.json(), { error: "Cloudflare HTTP 302" });
      assert.deepEqual(
        requests,
        Array.from({ length: 2 }, () => ({
          url: "https://api.cloudflare.com/client/v4/probe",
          authorization: "Bearer test-only",
        })),
      );
    } finally {
      await runtime.dispose();
    }
  },
);
