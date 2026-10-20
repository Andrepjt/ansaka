// Admin API for /admin/: reads and saves links.json in the GitHub repo.
// Every save is a commit, which makes Cloudflare Pages redeploy, so the public page stays a static file.
// Needs Cloudflare Pages variables ADMIN_USERNAME, ADMIN_PASSWORD and GITHUB_TOKEN (fine-grained, Contents read/write on this repo).

const FILE_URL = 'https://api.github.com/repos/Andrepjt/ansaka/contents/links.json';
const FIELDS = ['number', 'title', 'category', 'platform', 'badge', 'url'];
const PLATFORMS = ['shopee', 'tiktok', 'tokopedia', 'lazada', 'umum'];

const json = (data, status = 200) => Response.json(data, { status });

// Hash both sides so timingSafeEqual gets equal-length inputs.
async function same(a, b) {
    const hash = text => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return crypto.subtle.timingSafeEqual(await hash(a), await hash(b));
}

async function checkAccess(request, env) {
    const missing = ['ADMIN_USERNAME', 'ADMIN_PASSWORD', 'GITHUB_TOKEN'].filter(name => !env[name]);
    if (missing.length) return json({ error: `Variable ${missing.join(', ')} belum di-set di Cloudflare Pages.` }, 500);

    // The admin page sends "user:pass" with each part URI-encoded: header values must be ASCII, and ":" can't appear inside a part.
    const [user = '', pass = ''] = (request.headers.get('Authorization') || '').replace(/^Bearer /, '').split(':');
    const okUser = await same(user, encodeURIComponent(env.ADMIN_USERNAME));
    const okPass = await same(pass, encodeURIComponent(env.ADMIN_PASSWORD));
    return okUser && okPass ? null : json({ error: 'Username atau password salah.' }, 401);
}

function github(env, init = {}) {
    return fetch(FILE_URL, {
        ...init,
        headers: {
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'rumah-ansaka-admin',
        },
    });
}

function decodeBase64(base64) {
    return new TextDecoder().decode(Uint8Array.from(atob(base64), ch => ch.charCodeAt(0)));
}

function encodeBase64(text) {
    let binary = '';
    for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function validate(links) {
    if (!Array.isArray(links)) return 'Data harus berupa array JSON.';
    for (const [i, item] of links.entries()) {
        const label = `Item ke-${i + 1}`;
        if (!item || FIELDS.some(field => typeof item[field] !== 'string')) return `${label}: wajib punya ${FIELDS.join(', ')} (semuanya teks).`;
        if (!item.number.trim() || !item.title.trim() || !item.url.trim()) return `${label}: nomor, nama barang, dan link wajib diisi.`;
        if (!PLATFORMS.includes(item.platform)) return `${label}: platform harus salah satu dari ${PLATFORMS.join(', ')}.`;
        if (!/^https?:\/\//i.test(item.url.trim())) return `${label}: link harus diawali https://`;
    }
    const numbers = links.map(item => item.number.trim());
    const duplicate = numbers.find((number, i) => numbers.indexOf(number) !== i);
    if (duplicate) return `Nomor #${duplicate} dipakai lebih dari sekali.`;
    return null;
}

export async function onRequestGet({ request, env }) {
    const denied = await checkAccess(request, env);
    if (denied) return denied;

    const res = await github(env);
    if (!res.ok) return json({ error: `Gagal membaca links.json dari GitHub (${res.status}).` }, 502);
    const file = await res.json();
    return json({ sha: file.sha, links: JSON.parse(decodeBase64(file.content)) });
}

export async function onRequestPut({ request, env }) {
    const denied = await checkAccess(request, env);
    if (denied) return denied;

    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: 'Isi request harus JSON.' }, 400);
    }
    const problem = validate(body.links);
    if (problem) return json({ error: problem }, 400);

    const links = body.links.map(item => Object.fromEntries(FIELDS.map(field => [field, item[field].trim()])));
    const res = await github(env, {
        method: 'PUT',
        body: JSON.stringify({
            message: String(body.message || 'Update link dari admin').slice(0, 100),
            content: encodeBase64(JSON.stringify(links, null, 4) + '\n'),
            sha: body.sha,
            branch: 'main',
        }),
    });
    // GitHub rejects a stale sha, so a save never silently overwrites changes made elsewhere.
    if (res.status === 409) return json({ error: 'links.json sudah berubah di tempat lain. Muat ulang halaman admin dulu.' }, 409);
    if (!res.ok) return json({ error: `Gagal menyimpan ke GitHub (${res.status}).` }, 502);
    return json({ sha: (await res.json()).content.sha, links });
}
