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
