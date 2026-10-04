const BASE = "https://v3.football.api-sports.io";

// Appel API-Football avec cache (ttl en secondes). On ne met en cache QUE les réponses sans erreur.
async function apiGet(path, apiKey, ttl) {
  const cacheKey = new Request(`https://horizon-football-cache.local${path}`);
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    return { data: await cached.json(), cached: true, status: 200 };
  }
  const response = await fetch(`${BASE}${path}`, {
    headers: { "x-apisports-key": apiKey }
  });
  const data = await response.json();
  const hasErrors = data.errors && Object.keys(data.errors).length > 0;
  if (response.ok && !hasErrors) {
    await caches.default.put(
      cacheKey,
      new Response(JSON.stringify(data), {
        headers: {
          "content-type": "application/json",
          "cache-control": `public, max-age=${ttl}`
        }
      })
    );
  }
  return { data, cached: false, status: response.status };
}

// 10 derniers matchs terminés d'une équipe via API-Football (cache 6 h si succès).
// 1re tentative : last=10. Si le plan refuse, 2e tentative : toute la saison, on garde les 10 plus récents.
async function teamLast10(teamId, season, apiKey) {
  const first = await apiGet(`/fixtures?team=${teamId}&last=10&status=FT`, apiKey, 21600);
  if (!hasApiErrors(first.data) && (first.data.response || []).length) {
    return first;
  }
  const errs = first.data.errors || {};
  if (errs.rateLimit || errs.requests) {
    return first; // limite atteinte : inutile d'insister
  }
  const second = await apiGet(
    `/fixtures?team=${teamId}&season=${season}&status=FT`,
    apiKey,
    21600
  );
  if (!hasApiErrors(second.data) && (second.data.response || []).length) {
    return second;
  }
  return hasApiErrors(first.data) ? first : second;
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

        const fixture = fixtureData.response[0];
        const homeId = fixture.teams.home.id;
        const awayId = fixture.teams.away.id;
        const leagueId = fixture.league.id;
        const season = fixture.league.season;
        const fixtureDate = new Date(fixture.fixture.date);

        // Les 4 appels partent en même temps (plus rapide qu'un après l'autre)
        const [homeResult, awayResult, h2hResult, oddsResult] = await Promise.all([
          teamLast10(homeId, season, apiKey),
          teamLast10(awayId, season, apiKey),
          apiGet(`/fixtures/headtohead?h2h=${homeId}-${awayId}`, apiKey, 86400),
          withOdds
            ? apiGet(`/odds?fixture=${fixtureId}`, apiKey, 1800)
            : Promise.resolve({ data: { response: [], errors: { odds: "Cotes désactivées (odds=0)" } } })
        ]);

        const homeLast10 = (homeResult.data.response || [])
          .filter(match => new Date(match.fixture.date) < fixtureDate)
          .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date))
          .slice(0, 10);

        const awayLast10 = (awayResult.data.response || [])
          .filter(match => new Date(match.fixture.date) < fixtureDate)
          .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date))
          .slice(0, 10);

        const h2hLast10 = (h2hResult.data.response || [])
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
        3600
      );
      return jsonResponse(result.data, result.status);
    }

    return env.ASSETS.fetch(request);
  }
};
