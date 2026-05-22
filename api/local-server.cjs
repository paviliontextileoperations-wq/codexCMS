const http = require("node:http");
const { URL } = require("node:url");
const { handler } = require("./handler.cjs");

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
  const body = await readBody(request);
  const result = await handler({
    version: "2.0",
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    headers: request.headers,
    requestContext: {
      http: {
        method: request.method,
        path: url.pathname,
      },
    },
    body,
    isBase64Encoded: false,
  });

  response.writeHead(result.statusCode || 200, result.headers || {});
  response.end(result.body || "");
});

server.listen(port, host, () => {
  console.log(`Pavilion API listening on http://${host}:${port}`);
});
