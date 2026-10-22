import assert from "node:assert";

// Mock mínimo para entorno Node puro
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
globalThis.location = { hostname: "localhost" };
globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };
globalThis.window = { addEventListener: () => {} };

const { buildIptvUrl, parseM3U } = await import("../js/tv.js");

console.log("=== Pruebas de servidor IPTV y parseM3U ===");

// 1. Construcción de URL desde host base
const u1 = buildIptvUrl("http://iptv.server.com:8080", "juan", "secreto123", "m3u8");
assert.strictEqual(u1, "http://iptv.server.com:8080/get.php?username=juan&password=secreto123&type=m3u_plus&output=m3u8");
console.log("✓ buildIptvUrl: host base con puerto");

// 2. Host sin http:// inicial
const u2 = buildIptvUrl("iptv.server.com:8080/", "juan", "secreto123", "ts");
assert.strictEqual(u2, "http://iptv.server.com:8080/get.php?username=juan&password=secreto123&type=m3u_plus&output=ts");
console.log("✓ buildIptvUrl: host sin esquema y con barra final");

// 3. get.php preexistente
const u3 = buildIptvUrl("http://iptv.com:8080/get.php?username=viejo&password=viejo", "nuevo", "nuevoPass", "m3u8");
assert.strictEqual(u3, "http://iptv.com:8080/get.php?username=nuevo&password=nuevoPass&type=m3u_plus&output=m3u8");
console.log("✓ buildIptvUrl: get.php actualiza usuario y contraseña");

// 4. URL con archivo m3u directo
const u4 = buildIptvUrl("https://servidor.com/mi_lista.m3u", "usuario", "clave123");
assert.strictEqual(u4, "https://servidor.com/mi_lista.m3u?username=usuario&password=clave123");
console.log("✓ buildIptvUrl: archivo m3u directo");

// 5. URL completa sin pasar credenciales separadas
const u5 = buildIptvUrl("http://iptv.com:8080/get.php?username=auto&password=pwd");
assert.strictEqual(u5, "http://iptv.com:8080/get.php?username=auto&password=pwd");
console.log("✓ buildIptvUrl: URL completa ya armada");

// 6. parseM3U con resolución de rutas relativas
const m3uSample = `#EXTM3U
#EXTINF:-1 tvg-logo="http://logo.png" group-title="Noticias",Canal 1
live/juan/pass/101.m3u8
#EXTINF:-1,Canal 2
http://absoluto.com/stream.m3u8
`;

const canales = parseM3U(m3uSample, "http://iptv.server.com:8080/get.php?username=x");
assert.strictEqual(canales.length, 2);
assert.strictEqual(canales[0].name, "Canal 1");
assert.strictEqual(canales[0].url, "http://iptv.server.com:8080/live/juan/pass/101.m3u8");
assert.strictEqual(canales[0].group, "Noticias");
assert.strictEqual(canales[1].name, "Canal 2");
assert.strictEqual(canales[1].url, "http://absoluto.com/stream.m3u8");
console.log("✓ parseM3U: resolución de canales relativos y absolutos");

console.log("\nTodas las pruebas de servidor IPTV pasaron exitosamente.");
