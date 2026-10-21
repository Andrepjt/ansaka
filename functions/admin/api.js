// Admin API for /admin/: reads and saves the link list in Cloudflare KV (binding LINKS, key "links").
// Needs Cloudflare Pages variables ADMIN_USERNAME and ADMIN_PASSWORD, plus the KV namespace binding LINKS.

const FIELDS = ['number', 'title', 'category', 'platform', 'badge', 'url'];
const PLATFORMS = ['shopee', 'tiktok', 'tokopedia', 'lazada', 'umum'];

const json = (data, status = 200) => Response.json(data, { status });

// Until the first save (or before LINKS is bound), the list comes from the static links.json seed.
export async function readLinks(env, request) {
    const saved = env.LINKS && await env.LINKS.get('links', 'json');
    if (saved) return saved;
    const res = await env.ASSETS.fetch(new URL('/links.json', request.url));
    return res.ok ? res.json() : [];
}

// Hash both sides so timingSafeEqual gets equal-length inputs.
async function same(a, b) {
    const hash = text => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return crypto.subtle.timingSafeEqual(await hash(a), await hash(b));
}

async function checkAccess(request, env) {
    const missing = ['ADMIN_USERNAME', 'ADMIN_PASSWORD'].filter(name => !env[name]);
    if (missing.length) return json({ error: `Variable ${missing.join(', ')} belum di-set di Cloudflare Pages.` }, 500);
    if (!env.LINKS) return json({ error: 'KV namespace belum disambungkan dengan nama LINKS di Cloudflare Pages.' }, 500);

    // The admin page sends "user:pass" with each part URI-encoded: header values must be ASCII, and ":" can't appear inside a part.
    const [user = '', pass = ''] = (request.headers.get('Authorization') || '').replace(/^Bearer /, '').split(':');
    const okUser = await same(user, encodeURIComponent(env.ADMIN_USERNAME));
    const okPass = await same(pass, encodeURIComponent(env.ADMIN_PASSWORD));
    return okUser && okPass ? null : json({ error: 'Username atau password salah.' }, 401);
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
    return json({ links: await readLinks(env, request) });
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
    await env.LINKS.put('links', JSON.stringify(links));
    return json({ links });
}
