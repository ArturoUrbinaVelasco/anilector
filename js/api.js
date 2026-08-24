/* ============================================================
   AniLector — capa de datos
   Fuentes gratuitas y sin llave:
   - Jikan v4 (MyAnimeList) → anime y manga
   - Open Library → libros (con lectura en línea vía Internet Archive)
   - Google Books → respaldo de libros
   ============================================================ */

const JIKAN = "https://api.jikan.moe/v4";
const OPENLIB = "https://openlibrary.org";
const GBOOKS = "https://www.googleapis.com/books/v1";

/* ---------- Cola con límite de velocidad para Jikan (3 req/s) ---------- */
let lastJikan = 0;
async function jikanFetch(path) {
  const wait = Math.max(0, lastJikan + 420 - Date.now());
  lastJikan = Date.now() + wait;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  const res = await fetch(`${JIKAN}${path}`);
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1200));
    return jikanFetch(path);
  }
  if (!res.ok) throw new Error(`Jikan ${res.status}`);
  return res.json();
}

/* ---------- Géneros ---------- */
const genreCache = {};
export async function getGenres(cat) {
  if (cat === "books") {
    // Open Library usa "subjects" libres: lista curada de los más comunes.
    return [
      "fantasy", "science fiction", "romance", "mystery", "horror",
      "adventure", "history", "biography", "poetry", "philosophy",
      "psychology", "self-help", "comics", "manga", "young adult",
      "children", "thriller", "drama", "classics", "art",
    ].map((s) => ({ id: s, name: s.replace(/\b\w/g, (c) => c.toUpperCase()) }));
  }
  if (genreCache[cat]) return genreCache[cat];
  const data = await jikanFetch(`/genres/${cat}`);
  const list = (data.data || [])
    .filter((g) => !["Hentai", "Erotica"].includes(g.name))
    .map((g) => ({ id: g.mal_id, name: g.name }));
  genreCache[cat] = list;
  return list;
}

/* ---------- Normalización a un formato común ---------- */
function normJikan(x, cat) {
  return {
    id: `${cat}:${x.mal_id}`,
    sourceId: x.mal_id,
    cat, // 'anime' | 'manga'
    title: x.title_english || x.title || "?",
    originalTitle: x.title_japanese || "",
    cover: x.images?.webp?.large_image_url || x.images?.jpg?.large_image_url || "",
    year: x.year || (x.aired?.prop?.from?.year) || (x.published?.prop?.from?.year) || null,
    type: x.type || "",
    score: x.score || null,
    status: x.status || "",
    genres: (x.genres || []).map((g) => g.name),
    counts: {
      episodes: cat === "anime" ? x.episodes : null,
      chapters: cat === "manga" ? x.chapters : null,
      volumes: cat === "manga" ? x.volumes : null,
    },
    synopsis: x.synopsis || "",
    url: x.url, // página en MyAnimeList
    authors: (x.authors || []).map((a) => a.name),
    studios: (x.studios || []).map((s) => s.name),
  };
}

function normOpenLib(d) {
  return {
    id: `book:${d.key}`,
    sourceId: d.key, // "/works/OL123W"
    cat: "book",
    title: d.title || "?",
    originalTitle: "",
    cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : "",
    year: d.first_publish_year || null,
    type: "Libro",
    score: d.ratings_average ? Math.round(d.ratings_average * 10) / 10 : null,
    status: "",
    genres: (d.subject || []).slice(0, 6),
    counts: {
      editions: d.edition_count || null,
      pages: d.number_of_pages_median || null,
    },
    synopsis: "",
    url: `${OPENLIB}${d.key}`,
    authors: d.author_name || [],
    ia: (d.ia && d.ia[0]) || null, // identificador de Internet Archive → lectura embebida
    hasFulltext: !!d.has_fulltext,
  };
}

/* ---------- Búsqueda ---------- */
export async function search({ cat, q, genre, year, order, status, page = 1 }) {
  if (cat === "books") return searchBooks({ q, genre, year, order, page });

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  params.set("page", page);
  params.set("limit", 24);
  params.set("sfw", "true");
  if (genre) params.set("genres", genre);
  if (year) {
    params.set("start_date", `${year}-01-01`);
    params.set("end_date", `${year}-12-31`);
  }
  if (status) {
    const map =
      cat === "anime"
        ? { airing: "airing", complete: "complete", upcoming: "upcoming" }
        : { airing: "publishing", complete: "complete", upcoming: "upcoming" };
    params.set("status", map[status] || status);
  }
  const orderMap = {
    score: ["score", "desc"],
    popularity: ["members", "desc"],
    newest: ["start_date", "desc"],
    title: ["title", "asc"],
  };
  if (order && orderMap[order]) {
    params.set("order_by", orderMap[order][0]);
    params.set("sort", orderMap[order][1]);
  } else if (!q) {
    params.set("order_by", "members");
    params.set("sort", "desc");
  }

  const data = await jikanFetch(`/${cat}?${params}`);
  return {
    items: (data.data || []).map((x) => normJikan(x, cat)),
    hasMore: !!data.pagination?.has_next_page,
    total: data.pagination?.items?.total ?? null,
  };
}

async function searchBooks({ q, genre, year, order, page }) {
  const params = new URLSearchParams();
  let query = q || "";
  if (genre) query += ` subject:"${genre}"`;
  if (year) query += ` first_publish_year:${year}`;
  if (!query.trim()) query = "subject:fiction";
  params.set("q", query.trim());
  params.set("page", page);
  params.set("limit", 24);
  params.set(
    "fields",
    "key,title,author_name,first_publish_year,cover_i,edition_count,subject,ia,has_fulltext,ratings_average,number_of_pages_median"
  );
  if (order === "newest") params.set("sort", "new");
  else if (order === "score") params.set("sort", "rating");
  else if (order === "title") params.set("sort", "title");
  else if (order === "popularity") params.set("sort", "readinglog");

  const res = await fetch(`${OPENLIB}/search.json?${params}`);
  if (!res.ok) throw new Error(`OpenLibrary ${res.status}`);
  const data = await res.json();
  return {
    items: (data.docs || []).map(normOpenLib),
    hasMore: page * 24 < (data.numFound || 0),
    total: data.numFound ?? null,
  };
}

/* ---------- Detalle ---------- */
export async function getDetail(item) {
  if (item.cat === "book") return getBookDetail(item);
  const data = await jikanFetch(`/${item.cat}/${item.sourceId}/full`);
  const full = normJikan(data.data, item.cat);
  full.relations = (data.data.relations || []).map((r) => ({
    relation: r.relation,
    entries: r.entry
      .filter((e) => e.type === item.cat)
      .map((e) => ({ mal_id: e.mal_id, name: e.name, url: e.url })),
  }));
  full.external = (data.data.external || []).slice(0, 5);
  full.trailer = data.data.trailer?.embed_url || null;
  return full;
}

async function getBookDetail(item) {
  const full = { ...item };
  try {
    const res = await fetch(`${OPENLIB}${item.sourceId}.json`);
    if (res.ok) {
      const d = await res.json();
      full.synopsis =
        typeof d.description === "string"
          ? d.description
          : d.description?.value || "";
      if (!full.cover && d.covers?.length)
        full.cover = `https://covers.openlibrary.org/b/id/${d.covers[0]}-L.jpg`;
      full.genres = (d.subjects || item.genres || []).slice(0, 8);
    }
  } catch (_) { /* detalle opcional */ }

  // Complemento con Google Books (vista previa / enlaces de lectura)
  try {
    const gq = encodeURIComponent(`${item.title} ${item.authors?.[0] || ""}`.trim());
    const res = await fetch(`${GBOOKS}/volumes?q=${gq}&maxResults=1`);
    if (res.ok) {
      const d = await res.json();
      const v = d.items?.[0];
      if (v) {
        full.gbooks = {
          preview: v.volumeInfo?.previewLink || null,
          webReader: v.accessInfo?.webReaderLink || null,
          pdf: v.accessInfo?.pdf?.isAvailable || false,
          viewability: v.accessInfo?.viewability || "NO_PAGES",
          pageCount: v.volumeInfo?.pageCount || null,
        };
        if (!full.synopsis) full.synopsis = v.volumeInfo?.description || "";
        if (!full.counts.pages && v.volumeInfo?.pageCount)
          full.counts.pages = v.volumeInfo.pageCount;
      }
    }
  } catch (_) { /* opcional */ }
  return full;
}

/* ---------- Orden de visualización / lectura (cadena precuela→secuela) ---------- */
const orderCache = {};
export async function buildOrder(item, onProgress) {
  const key = item.id;
  if (orderCache[key]) return orderCache[key];

  const cat = item.cat;
  const visited = new Set();
  const MAXN = 12; // tope de peticiones para respetar el límite de la API

  async function fetchNode(malId) {
    const data = await jikanFetch(`/${cat}/${malId}/full`);
    const n = normJikan(data.data, cat);
    n.relations = (data.data.relations || []).map((r) => ({
      relation: r.relation,
      entries: r.entry.filter((e) => e.type === cat),
    }));
    return n;
  }

  function pick(node, rel) {
    const g = (node.relations || []).find((r) => r.relation === rel);
    return g?.entries?.[0] || null;
  }

  // caché de nodos ya descargados
  const nodes = new Map();
  let count = 0;
  async function getNode(malId) {
    if (nodes.has(malId)) return nodes.get(malId);
    const n = await fetchNode(malId);
    nodes.set(malId, n);
    count++;
    onProgress?.(count);
    return n;
  }

  // 1) retroceder hasta la raíz por precuelas
  const node = await getNode(item.sourceId);
  visited.add(node.sourceId);
  let root = node;
  while (count < MAXN) {
    const prev = pick(root, "Prequel");
    if (!prev || visited.has(prev.mal_id)) break;
    root = await getNode(prev.mal_id);
    visited.add(root.sourceId);
  }
  // 2) avanzar desde la raíz por secuelas (incluyendo la obra consultada)
  const chain = [root];
  const chainSet = new Set([root.sourceId]);
  let cur = root;
  while (count < MAXN) {
    const next = pick(cur, "Sequel");
    if (!next || chainSet.has(next.mal_id)) break;
    cur = await getNode(next.mal_id);
    chain.push(cur);
    chainSet.add(cur.sourceId);
  }
  chainSet.forEach((id) => visited.add(id));
  // 3) anexos relevantes (películas, especiales, spin-offs) del nodo consultado
  const extras = [];
  for (const rel of ["Side story", "Alternative version", "Spin-off", "Summary"]) {
    for (const g of node.relations || []) {
      if (g.relation === rel) {
        for (const e of g.entries.slice(0, 2)) {
          if (!visited.has(e.mal_id)) extras.push({ relation: rel, name: e.name, mal_id: e.mal_id, url: e.url });
        }
      }
    }
  }

  const result = { chain, extras };
  orderCache[key] = result;
  return result;
}
