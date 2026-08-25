/* ============================================================
   AniLector — capa de datos
   Fuentes gratuitas y sin llave:
   - Jikan v4 (MyAnimeList) → anime y manga
   - Open Library → libros (con lectura en línea vía Internet Archive)
   - Google Books → respaldo de libros
   ============================================================ */

const JIKAN = "https://api.jikan.moe/v4";
const ANILIST = "https://graphql.anilist.co";
const OPENLIB = "https://openlibrary.org";
const GBOOKS = "https://www.googleapis.com/books/v1";

/* ---------- Proveedor de anime/manga con respaldo automático ----------
   Primario: Jikan (MyAnimeList). Si falla (caída/504), se cambia
   automáticamente a AniList por el resto de la sesión. */
let animeProvider = "jikan";
let providerChangeCb = null;
export function onProviderChange(cb) { providerChangeCb = cb; }
export function getProvider() { return animeProvider; }
function switchToAniList() {
  if (animeProvider !== "anilist") {
    animeProvider = "anilist";
    try { providerChangeCb?.(); } catch (_) {}
  }
}

/* ---------- Cola con límite de velocidad para Jikan (3 req/s) ---------- */
let lastJikan = 0;
async function jikanFetch(path, retried = false) {
  const wait = Math.max(0, lastJikan + 420 - Date.now());
  lastJikan = Date.now() + wait;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  let res;
  try {
    res = await fetch(`${JIKAN}${path}`, { signal: ctrl.signal });
  } finally { clearTimeout(timer); }
  if (res.status === 429 && !retried) {
    await new Promise((r) => setTimeout(r, 1200));
    return jikanFetch(path, true);
  }
  if (!res.ok) throw new Error(`Jikan ${res.status}`);
  return res.json();
}

/* ---------- Cliente GraphQL de AniList ---------- */
async function anilistQuery(query, variables) {
  const res = await fetch(ANILIST, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  const d = await res.json();
  if (d.errors?.length) throw new Error(d.errors[0].message || "AniList error");
  return d.data;
}

const AL_MEDIA_FIELDS = `id siteUrl format status averageScore genres episodes chapters volumes isAdult
  title { romaji english native } coverImage { large extraLarge } startDate { year }
  description(asHtml: false) trailer { id site }
  externalLinks { site url type language }
  relations { edges { relationType node { id type format siteUrl title { romaji english } } } }`;

const AL_GENRES = [
  "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror",
  "Mahou Shoujo", "Mecha", "Music", "Mystery", "Psychological", "Romance",
  "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller",
];

const AL_REL = {
  PREQUEL: "Prequel", SEQUEL: "Sequel", SIDE_STORY: "Side story",
  ALTERNATIVE: "Alternative version", SPIN_OFF: "Spin-off", SUMMARY: "Summary",
};

function normAniList(m, cat) {
  return {
    id: `${cat}:al${m.id}`,
    sourceId: m.id,
    src: "al",
    cat,
    title: m.title?.english || m.title?.romaji || "?",
    originalTitle: m.title?.native || "",
    cover: m.coverImage?.extraLarge || m.coverImage?.large || "",
    year: m.startDate?.year || null,
    type: (m.format || "").replace(/_/g, " "),
    score: m.averageScore ? Math.round(m.averageScore) / 10 : null,
    status: m.status
      ? m.status.charAt(0) + m.status.slice(1).toLowerCase().replace(/_/g, " ")
      : "",
    genres: m.genres || [],
    counts: {
      episodes: cat === "anime" ? m.episodes : null,
      chapters: cat === "manga" ? m.chapters : null,
      volumes: cat === "manga" ? m.volumes : null,
    },
    synopsis: (m.description || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
    url: m.siteUrl,
    authors: [],
    studios: [],
  };
}

function alRelations(m, cat) {
  const type = cat === "anime" ? "ANIME" : "MANGA";
  const groups = {};
  for (const e of m.relations?.edges || []) {
    const rel = AL_REL[e.relationType];
    if (!rel || (e.node?.type || "") !== type) continue;
    (groups[rel] ||= []).push({
      mal_id: e.node.id,
      name: e.node.title?.english || e.node.title?.romaji || "?",
      url: e.node.siteUrl,
      type: cat,
    });
  }
  return Object.entries(groups).map(([relation, entries]) => ({ relation, entries }));
}

async function searchAniList({ cat, q, genre, year, order, status, page = 1 }) {
  const type = cat === "anime" ? "ANIME" : "MANGA";
  const sortMap = {
    score: "SCORE_DESC", popularity: "POPULARITY_DESC",
    newest: "START_DATE_DESC", title: "TITLE_ROMAJI",
  };
  const sort = sortMap[order] || (q ? "SEARCH_MATCH" : "POPULARITY_DESC");
  const stMap = { airing: "RELEASING", complete: "FINISHED", upcoming: "NOT_YET_RELEASED" };
  const vars = { page, type, sort: [sort] };
  if (q) vars.search = q;
  if (genre && !/^\d+$/.test(String(genre))) vars.genre = genre;
  if (year) {
    vars.yGT = Number(`${Number(year) - 1}1231`);
    vars.yLT = Number(`${Number(year) + 1}0101`);
  }
  if (status && stMap[status]) vars.status = stMap[status];
  const data = await anilistQuery(
    `query($page:Int,$type:MediaType,$search:String,$genre:String,$status:MediaStatus,$sort:[MediaSort],$yGT:FuzzyDateInt,$yLT:FuzzyDateInt){
      Page(page:$page,perPage:24){
        pageInfo{ hasNextPage total }
        media(type:$type,search:$search,genre:$genre,status:$status,sort:$sort,isAdult:false,startDate_greater:$yGT,startDate_lesser:$yLT){ ${AL_MEDIA_FIELDS} }
      }
    }`,
    vars
  );
  return {
    items: (data.Page?.media || []).map((m) => normAniList(m, cat)),
    hasMore: !!data.Page?.pageInfo?.hasNextPage,
    total: data.Page?.pageInfo?.total ?? null,
  };
}

async function alFetchNode(cat, id) {
  const d = await anilistQuery(
    `query($id:Int,$type:MediaType){ Media(id:$id,type:$type){ ${AL_MEDIA_FIELDS} } }`,
    { id, type: cat === "anime" ? "ANIME" : "MANGA" }
  );
  const n = normAniList(d.Media, cat);
  n.relations = alRelations(d.Media, cat);
  n.trailer =
    d.Media.trailer?.site === "youtube" && d.Media.trailer.id
      ? `https://www.youtube.com/embed/${d.Media.trailer.id}`
      : null;
  const links = d.Media.externalLinks || [];
  n.streaming = links
    .filter((l) => l.type === "STREAMING")
    .map((l) => ({ site: l.site, url: l.url, language: l.language || "" }));
  n.external = links
    .filter((l) => l.type !== "STREAMING")
    .map((l) => ({ name: l.site, url: l.url }))
    .slice(0, 8);
  return n;
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
  if (animeProvider === "anilist") return AL_GENRES.map((n) => ({ id: n, name: n }));
  if (genreCache[cat]) return genreCache[cat];
  try {
    const data = await jikanFetch(`/genres/${cat}`);
    const list = (data.data || [])
      .filter((g) => !["Hentai", "Erotica"].includes(g.name))
      .map((g) => ({ id: g.mal_id, name: g.name }));
    genreCache[cat] = list;
    return list;
  } catch (e) {
    switchToAniList();
    return AL_GENRES.map((n) => ({ id: n, name: n }));
  }
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
export async function search(args) {
  const { cat, q, genre, year, order, status, page = 1 } = args;
  if (cat === "books") return searchBooks({ q, genre, year, order, page });
  if (animeProvider === "anilist") return searchAniList(args);
  try {
    return await searchJikan({ cat, q, genre, year, order, status, page });
  } catch (e) {
    console.warn("Jikan falló; cambiando a AniList:", e.message);
    switchToAniList();
    return searchAniList(args);
  }
}

async function searchJikan({ cat, q, genre, year, order, status, page }) {
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
  if (item.src === "al") return alFetchNode(item.cat, item.sourceId);
  try {
    const data = await jikanFetch(`/${item.cat}/${item.sourceId}/full`);
    const full = normJikan(data.data, item.cat);
    full.relations = (data.data.relations || []).map((r) => ({
      relation: r.relation,
      entries: r.entry
        .filter((e) => e.type === item.cat)
        .map((e) => ({ mal_id: e.mal_id, name: e.name, url: e.url })),
    }));
    full.external = (data.data.external || []).slice(0, 8);
    full.streaming = (data.data.streaming || []).map((s) => ({ site: s.name, url: s.url }));
    full.trailer = data.data.trailer?.embed_url || null;
    return full;
  } catch (e) {
    // Respaldo: buscar la misma obra en AniList por título
    switchToAniList();
    const { items } = await searchAniList({ cat: item.cat, q: item.title, page: 1 });
    if (items[0]) return alFetchNode(item.cat, items[0].sourceId);
    throw e;
  }
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
          id: v.id || null,
          isbn: (v.volumeInfo?.industryIdentifiers || []).find((i) => i.type === "ISBN_13")?.identifier || null,
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

/* ---------- Sitios de lectura/visualización (solo español e inglés) ---------- */
export function filterEsEn(links) {
  return (links || []).filter(
    (l) => !l.language || /english|spanish|espa/i.test(String(l.language))
  );
}

// Plataformas legales de lectura de manga con búsqueda directa del título.
export function mangaReadingSites(title) {
  const q = encodeURIComponent(title);
  return [
    { site: "MANGA Plus · Shueisha", language: "ES/EN", url: `https://mangaplus.shueisha.co.jp/search_result?keyword=${q}` },
    { site: "VIZ Manga", language: "EN", url: `https://www.viz.com/search?search=${q}` },
    { site: "Comikey", language: "ES/EN", url: `https://comikey.com/search/?q=${q}` },
    { site: "Google Play Libros", language: "ES", url: `https://play.google.com/store/search?q=${q}%20manga&c=books` },
    { site: "BookWalker", language: "EN", url: `https://global.bookwalker.jp/search/?word=${q}` },
    { site: "Kobo", language: "ES", url: `https://www.kobo.com/mx/es/search?query=${q}` },
    { site: "Amazon Kindle", language: "ES", url: `https://www.amazon.com.mx/s?k=${q}+manga` },
  ];
}

/* ---------- Orden de visualización / lectura (cadena precuela→secuela) ---------- */
const orderCache = {};
export async function buildOrder(item, onProgress) {
  const key = item.id;
  if (orderCache[key]) return orderCache[key];

  const cat = item.cat;
  const visited = new Set();
  const MAXN = 12; // tope de peticiones para respetar el límite de la API

  const fetchNode = item.src === "al"
    ? (id) => alFetchNode(cat, id)
    : async (malId) => {
        const data = await jikanFetch(`/${cat}/${malId}/full`);
        const n = normJikan(data.data, cat);
        n.relations = (data.data.relations || []).map((r) => ({
          relation: r.relation,
          entries: r.entry.filter((e) => e.type === cat),
        }));
        return n;
      };

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
