const BASE = "https://v3.football.api-sports.io";

// Passe à true le jour où tu prends le plan Pro d'API-Football :
// les 10 derniers matchs de chaque équipe seront alors récupérés.
const PLAN_PRO = false;
const MSG_PLAN_GRATUIT = "10 derniers matchs indisponibles avec le plan gratuit";

// Appel API-Football avec cache (ttl en secondes). On ne met en cache QUE les réponses sans erreur.
async function apiGet(path, apiKey, ttl) {
  const cacheKey = new Request(`https://horizon-football-cache.local${path}`);
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    return { data: await cached.json(), cached: true, status: 200 };
  }
  let response = await fetch(`${BASE}${path}`, {
    headers: { "x-apisports-key": apiKey }
  });
  let data = await response.json();
  // limite par minute : une seule nouvelle tentative après une courte pause
  if (data.errors && (data.errors.rateLimit || data.errors.requests) && !data.errors.requests) {
    await new Promise(r => setTimeout(r, 1500));
    response = await fetch(`${BASE}${path}`, { headers: { "x-apisports-key": apiKey } });
    data = await response.json();
  }
  const hasErrors = data.errors && Object.keys(data.errors).length > 0;
  if (response.ok && !hasErrors) {
    const seconds = typeof ttl === "function" ? ttl(data) : ttl;
    await caches.default.put(
      cacheKey,
      new Response(JSON.stringify(data), {
        headers: {
          "content-type": "application/json",
          "cache-control": `public, max-age=${seconds}`
        }
      })
    );
  }
  return { data, cached: false, status: response.status };
}

// 10 derniers matchs terminés d'une équipe (plan Pro uniquement ; cache 6 h si succès).
async function teamLast10(teamId, apiKey) {
  return apiGet(`/fixtures?team=${teamId}&last=10&status=FT`, apiKey, 21600);
}

function hasApiErrors(data) {
  return data && data.errors && Object.keys(data.errors).length > 0;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      // pas de cache navigateur quand il y a une erreur
      "cache-control": hasApiErrors(data) ? "no-store" : "public, max-age=300"
    }
  });
}


const AI_ANALYSIS_CACHE_TTL = 1800;
const AI_ANALYSIS_MAX_PROMPT_CHARS = 3500;
const AI_ANALYSIS_MAX_RESPONSE_CHARS = 1200;
const AI_DAILY_CAP = 40; // nombre maximum d'appels réels à l'IA par jour (protège ton quota)

async function handleAnalyze(request, env) {
  const url = new URL(request.url);
      const fixtureId = url.searchParams.get("id");
      if (!fixtureId) {
        return Response.json({ error: "Missing fixture id" }, { status: 400 });
      }
      const apiKey = env.API_FOOTBALL_KEY;
      if (!apiKey) {
        return Response.json({ error: "API_FOOTBALL_KEY is not configured" }, { status: 500 });
      }
      // ?odds=0 pour économiser une requête pendant les tests
      const withOdds = url.searchParams.get("odds") !== "0";

      try {
        const qh = url.searchParams.get("h"), qa = url.searchParams.get("a"), qd = url.searchParams.get("d");
        let fixture;
        if (/^\d+$/.test(qh || "") && /^\d+$/.test(qa || "") && qd && !isNaN(new Date(qd))) {
          // le site fournit déjà les équipes et la date : on économise une requête
          fixture = {
            fixture: { id: Number(fixtureId), date: qd },
            teams: { home: { id: Number(qh), name: url.searchParams.get("hn") || "" }, away: { id: Number(qa), name: url.searchParams.get("an") || "" } },
            league: { id: 0, season: 0 }
          };
        } else {
        const fixtureResult = await apiGet(
          `/fixtures?id=${encodeURIComponent(fixtureId)}`,
          apiKey,
          3600
        );
        const fixtureData = fixtureResult.data;
        if (!fixtureData.response?.length) {
          const rate = fixtureData.errors?.rateLimit || fixtureData.errors?.requests;
          return Response.json(
            {
              error: rate
                ? "Limite de requêtes API-Football atteinte, réessaie plus tard"
                : "Match introuvable",
              details: fixtureData.errors || {}
            },
            { status: rate ? 429 : 404 }
          );
        }

        fixture = fixtureData.response[0];
        }
        const homeId = fixture.teams.home.id;
        const awayId = fixture.teams.away.id;
        const leagueId = fixture.league.id;
        const season = fixture.league.season;
        const fixtureDate = new Date(fixture.fixture.date);

        // Appels l'un après l'autre : l'envoi simultané déclenche l'erreur "Too many requests"
        // sur le plan gratuit, même sous la limite de 10 par minute.
        const none = { data: { response: [], errors: { info: MSG_PLAN_GRATUIT } } };
        const homeResult = PLAN_PRO ? await teamLast10(homeId, apiKey) : none;
        const awayResult = PLAN_PRO ? await teamLast10(awayId, apiKey) : none;
        const h2hResult = await apiGet(
          `/fixtures/headtohead?h2h=${homeId}-${awayId}`,
          apiKey,
          86400
        );
        const oddsResult = withOdds
          ? await apiGet(`/odds?fixture=${fixtureId}`, apiKey, 1800)
          : { data: { response: [], errors: { odds: "Cotes désactivées (odds=0)" } } };

        const homeLast10 = (homeResult.data.response || [])
          .filter(match => new Date(match.fixture.date) < fixtureDate)
          .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date))
          .slice(0, 10);

        const awayLast10 = (awayResult.data.response || [])
          .filter(match => new Date(match.fixture.date) < fixtureDate)
          .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date))
          .slice(0, 10);

        const h2hLast10 = (h2hResult.data.response || [])
          .filter(match => new Date(match.fixture.date) < fixtureDate)
          .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date))
          .slice(0, 10);

        const payload = {
          fixture,
          teams: {
            home: { id: homeId, name: fixture.teams.home.name, last10: homeLast10 },
            away: { id: awayId, name: fixture.teams.away.name, last10: awayLast10 }
          },
          h2h: h2hLast10,
          odds: oddsResult.data.response || [],
          league: { id: leagueId, season },
          plan: PLAN_PRO ? "pro" : "gratuit",
          apiErrors: {
            home: homeResult.data.errors || {},
            away: awayResult.data.errors || {},
            h2h: h2hResult.data.errors || {},
            odds: oddsResult.data.errors || {}
          }
        };

        const anyError = Object.values(payload.apiErrors).some(
          e => e && Object.keys(e).length > 0
        );
        return new Response(JSON.stringify(payload), {
          headers: {
            "content-type": "application/json; charset=UTF-8",
            "cache-control": anyError ? "no-store" : "public, max-age=300"
          }
        });
      } catch (error) {
        return Response.json(
          { error: "Erreur pendant l'analyse", message: error.message },
          { status: 500 }
        );
      }
    }

function getClientIp(request) {
  return (request.headers.get("cf-connecting-ip") || "anonymous").replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 64) || "anonymous";
}

function summarizeTeamLast10(team, label) {
  const list = Array.isArray(team && team.last10) ? team.last10 : [];
  if (!list.length) return `${label}: données indisponibles.`;
  let conceded = 0, clean = 0, under = 0;
  list.forEach(match => {
    const home = match.teams && match.teams.home && match.teams.home.id === team.id;
    const gh = match.goals && match.goals.home != null ? match.goals.home : 0;
    const ga = match.goals && match.goals.away != null ? match.goals.away : 0;
    const c = home ? ga : gh;
    conceded += c;
    if (c === 0) clean += 1;
    if (gh + ga <= 2) under += 1;
  });
  return `${label}: ${list.length} derniers matchs, buts encaissés par match ${(conceded / list.length).toFixed(2)}, clean sheets ${clean}/${list.length}, sous 2.5 buts ${under}/${list.length}.`;
}

function summarizeH2H(list) {
  const done = Array.isArray(list) ? list.filter(m => m.goals && m.goals.home != null && m.goals.away != null) : [];
  if (!done.length) return "H2H: aucune confrontation disponible.";
  const under = done.filter(m => (m.goals.home || 0) + (m.goals.away || 0) <= 2).length;
  return `H2H: ${done.length} confrontations, sous 2.5 buts ${under}/${done.length}.`;
}

function summarizeOdds(list) {
  const found = [];
  (Array.isArray(list) ? list : []).forEach(entry => (entry.bookmakers || []).forEach(bk => {
    const bet = (bk.bets || []).find(b => /over\/under/i.test(b.name) && !/half|1st|2nd|team|first|second/i.test(b.name));
    const u = bet && (bet.values || []).find(v => /^under 2\.5$/i.test(String(v.value)));
    if (u) found.push(`${bk.name} ${u.odd}`);
  }));
  return found.length ? `Cotes Under 2.5: ${found.slice(0, 4).join(", ")}.` : "Cotes Under 2.5: indisponibles.";
}

function buildAiPrompt(data) {
  const fx = data && data.fixture ? data.fixture : {};
  const teams = data && data.teams ? data.teams : {};
  const homeName = (teams.home && teams.home.name) || "Équipe domicile";
  const awayName = (teams.away && teams.away.name) || "Équipe extérieure";
  const missing = [];
  if (!teams.home || !teams.home.last10 || !teams.home.last10.length) missing.push("10 derniers matchs domicile");
  if (!teams.away || !teams.away.last10 || !teams.away.last10.length) missing.push("10 derniers matchs extérieur");
  if (!Array.isArray(data && data.h2h) || !data.h2h.length) missing.push("face-à-face");
  return [
    "Données réelles du match (n'utilise rien d'autre) :",
    `Match : ${homeName} vs ${awayName}`,
    `Compétition : ${fx.league && fx.league.name ? fx.league.name : "inconnue"}`,
    summarizeTeamLast10(teams.home, homeName),
    summarizeTeamLast10(teams.away, awayName),
    summarizeH2H(data && data.h2h),
    summarizeOdds(data && data.odds),
    missing.length ? `Données manquantes : ${missing.join(", ")}.` : "Aucune donnée de base manquante.",
    "",
    "Rédige en français, en 4 phrases maximum, un résumé prudent de la cohérence entre les statistiques disponibles et les cotes Under 2.5. Cite explicitement les données manquantes. N'invente aucun chiffre."
  ].join("\n").slice(0, AI_ANALYSIS_MAX_PROMPT_CHARS);
}

// Plafond quotidien d'appels réels à l'IA (cache) + limite par visiteur si un KV est branché
async function aiBudgetOk(request, env) {
  if (env.AI_RATE_LIMIT_KV) {
    const key = `agnes:${getClientIp(request)}`;
    const current = Number((await env.AI_RATE_LIMIT_KV.get(key)) || "0");
    if (current >= 10) return false;
    await env.AI_RATE_LIMIT_KV.put(key, String(current + 1), { expirationTtl: 86400 });
  }
  const day = new Date().toISOString().slice(0, 10);
  const key = new Request(`https://horizon-football-ai.local/budget?d=${day}`);
  const hit = await caches.default.match(key);
  const n = hit ? Number(await hit.text()) : 0;
  if (n >= AI_DAILY_CAP) return false;
  await caches.default.put(key, new Response(String(n + 1), { headers: { "cache-control": "public, max-age=86400" } }));
  return true;
}

async function handleAiAnalysis(request, env) {
  const url = new URL(request.url);
  const fixtureId = (url.searchParams.get("id") || "").trim();
  if (!/^\d+$/.test(fixtureId)) {
    return Response.json({ error: "Invalid fixture id" }, { status: 400 });
  }
  if (!env.AGNES_API_KEY) {
    return Response.json({ error: "AI service is not configured", disclaimer: "L'analyse IA n'est pas encore disponible." }, { status: 503 });
  }
  const cacheKey = new Request(`https://horizon-football-ai.local/analysis?id=${fixtureId}`);
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;
  const unavailable = status => Response.json({ error: "AI unavailable", disclaimer: "L'analyse IA est temporairement indisponible. Réessaie plus tard." }, { status });
  try {
    // appel direct de la fonction d'analyse (pas de requête vers soi-même)
    const analysis = await handleAnalyze(new Request(`${url.origin}/api/analyze?id=${fixtureId}`), env);
    if (!analysis.ok) return unavailable(analysis.status === 429 ? 429 : 502);
    const data = await analysis.json();
    if (!(await aiBudgetOk(request, env))) {
      return Response.json({ error: "AI quota exceeded", disclaimer: "Le quota d'analyses IA du jour est atteint." }, { status: 429 });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let res;
    try {
      res = await fetch("https://apihub.agnes-ai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${env.AGNES_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "agnes-2.5-flash",
          messages: [
            { role: "system", content: "Tu es un analyste football pour Horizon Football. Tu n'utilises que les données fournies. Tu n'inventes aucune statistique, tu ne promets jamais de gain et tu ne donnes aucun pronostic garanti. Ton ton est informatif." },
            { role: "user", content: buildAiPrompt(data) }
          ],
          temperature: 0.3,
          max_tokens: 350,
          stream: false
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return unavailable(502);
    const out = await res.json();
    const text = out && out.choices && out.choices[0] && out.choices[0].message && out.choices[0].message.content;
    if (typeof text !== "string" || !text.trim()) return unavailable(502);
    const response = new Response(JSON.stringify({
      summary: text.replace(/\r\n/g, "\n").trim().slice(0, AI_ANALYSIS_MAX_RESPONSE_CHARS),
      disclaimer: "Analyse informative générée par IA à partir des données disponibles. Aucun gain n'est garanti. Réservé aux majeurs."
    }), { headers: { "content-type": "application/json; charset=UTF-8", "cache-control": `public, max-age=${AI_ANALYSIS_CACHE_TTL}` } });
    await caches.default.put(cacheKey, response.clone());
    return response;
  } catch (e) {
    return unavailable(504);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/fixture") {
      const id = url.searchParams.get("id");
      if (!id) {
        return Response.json({ error: "Missing fixture id" }, { status: 400 });
      }
      const apiKey = env.API_FOOTBALL_KEY;
      if (!apiKey) {
        return Response.json({ error: "API_FOOTBALL_KEY is not configured" }, { status: 500 });
      }
      const result = await apiGet(`/fixtures?id=${encodeURIComponent(id)}`, apiKey, 3600);
      return jsonResponse(result.data, result.status);
    }

    if (url.pathname === "/api/analyze") {
      return handleAnalyze(request, env);
    }

    if (url.pathname === "/api/ai-analysis") {
      return handleAiAnalysis(request, env);
    }

    if (url.pathname === "/api/live") {
      const ids = (url.searchParams.get("ids") || "").split(",").map(s => s.trim()).filter(s => /^\d+$/.test(s)).slice(0, 20);
      if (!ids.length) {
        return Response.json({ error: "Missing ids" }, { status: 400 });
      }
      const apiKey = env.API_FOOTBALL_KEY;
      if (!apiKey) {
        return Response.json({ error: "API_FOOTBALL_KEY is not configured" }, { status: 500 });
      }
      // 1 seule requête pour tous les matchs suivis, gardée 5 minutes (quota du plan gratuit)
      const result = await apiGet(`/fixtures?ids=${ids.join("-")}&timezone=Africa/Douala`, apiKey, 300);
      return jsonResponse(result.data, result.status);
    }

    if (url.pathname === "/api/find") {
      // Recherche légère : ne renvoie que les matchs du jour dont une équipe contient un des mots demandés
      const date = url.searchParams.get("date");
      const words = (url.searchParams.get("q") || "").split(",").map(s => s.trim()).filter(Boolean);
      if (!date || !words.length) {
        return Response.json({ error: "Missing date or q" }, { status: 400 });
      }
      const apiKey = env.API_FOOTBALL_KEY;
      if (!apiKey) {
        return Response.json({ error: "API_FOOTBALL_KEY is not configured" }, { status: 500 });
      }
      const plain = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const result = await apiGet(
        `/fixtures?date=${encodeURIComponent(date)}&timezone=Africa/Douala`,
        apiKey,
        data => {
          const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Douala" }).format(new Date());
          if (date >= today) return 3600;
          const done = ["FT", "AET", "PEN", "CANC", "PST", "ABD", "AWD", "WO"];
          const pending = (data.response || []).some(m => !done.includes(m.fixture && m.fixture.status && m.fixture.status.short));
          return pending ? 600 : 2592000;
        }
      );
      if (hasApiErrors(result.data)) {
        return Response.json({ errors: result.data.errors }, { status: 200, headers: { "cache-control": "no-store" } });
      }
      const keys = words.map(plain);
      const matches = (result.data.response || [])
        .filter(m => { const n = plain(m.teams.home.name) + " | " + plain(m.teams.away.name); return keys.some(k => n.includes(k)); })
        .slice(0, 40)
        .map(m => ({
          id: m.fixture.id,
          heure: m.fixture.date,
          ligue: m.league.name + " (" + m.league.country + ")",
          domicile: m.teams.home.name,
          exterieur: m.teams.away.name,
          statut: m.fixture.status.short,
          minute: m.fixture.status.elapsed,
          buts: [m.goals.home, m.goals.away],
          fin90: [m.score.fulltime.home, m.score.fulltime.away]
        }));
      return new Response(JSON.stringify({ date, trouves: matches.length, matchs: matches }), {
        headers: { "content-type": "application/json; charset=UTF-8", "cache-control": "no-store" }
      });
    }

    if (url.pathname === "/api/fixtures") {
      const date = url.searchParams.get("date");
      const timezone = url.searchParams.get("timezone") || "Africa/Douala";
      if (!date) {
        return Response.json({ error: "Missing date parameter" }, { status: 400 });
      }
      const apiKey = env.API_FOOTBALL_KEY;
      if (!apiKey) {
        return Response.json({ error: "API_FOOTBALL_KEY is not configured" }, { status: 500 });
      }
      const result = await apiGet(
        `/fixtures?date=${encodeURIComponent(date)}&timezone=${encodeURIComponent(timezone)}`,
        apiKey,
        // un jour passé dont tous les matchs sont terminés est archivé 30 jours
        // (le plan gratuit ne redonne plus les anciens jours)
        data => {
          const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Douala" }).format(new Date());
          if (date >= today) return 3600;
          const done = ["FT", "AET", "PEN", "CANC", "PST", "ABD", "AWD", "WO"];
          const pending = (data.response || []).some(m => !done.includes(m.fixture && m.fixture.status && m.fixture.status.short));
          return pending ? 600 : 2592000;
        }
      );
      return jsonResponse(result.data, result.status);
    }

    return env.ASSETS.fetch(request);
  }
};
