const http = require('http');
const https = require('https');

const probeHttpAsset = (url, method) =>
  new Promise((resolve) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(
      parsed,
      {
        method,
        timeout: 5000,
        headers: method === 'GET' ? { Range: 'bytes=0-0' } : undefined,
      },
      (res) => {
        res.resume();
        const status = res.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 400, status });
      },
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, reason: 'timeout' });
    });
    req.on('error', (err) => resolve({ ok: false, reason: err.message }));
    req.end();
  });

async function test(url) {
  let head = await probeHttpAsset(url, 'HEAD');
  console.log(`HEAD ${url} ->`, head);
  if (head.status === 405) {
    const get = await probeHttpAsset(url, 'GET');
    console.log(`GET ${url} ->`, get);
  }
}

async function run() {
  await test('https://example.com/video/DATA301/1');
  await test('https://example.com');
  await test('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4');
}

run();
