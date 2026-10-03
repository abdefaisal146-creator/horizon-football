export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/fixture") {
  const id = url.searchParams.get("id");

  if (!id) {
    return Response.json(
      { error: "Missing fixture id" },
      { status: 400 }
    );
  }

  const apiKey = env.API_FOOTBALL_KEY;

  if (!apiKey) {
    return Response.json(
      { error: "API_FOOTBALL_KEY is not configured" },
      { status: 500 }
    );
  }

  const apiUrl =
    `https://v3.football.api-sports.io/fixtures?id=${encodeURIComponent(id)}`;

  const response = await fetch(apiUrl, {
    headers: {
      "x-apisports-key": apiKey
    }
  });

  const data = await response.json();

  return new Response(JSON.stringify(data), {
    status: response.status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "public, max-age=300"
    }
  });
    }
    if (url.pathname === "/api/analyze") {
  const fixtureId = url.searchParams.get("id");

  if (!fixtureId) {
    return Response.json(
      { error: "Missing fixture id" },
      { status: 400 }
    );
  }

  const apiKey = env.API_FOOTBALL_KEY;

  if (!apiKey) {
    return Response.json(
      { error: "API_FOOTBALL_KEY is not configured" },
      { status: 500 }
    );
  }

  const headers = {
    "x-apisports-key": apiKey
  };

  const base = "https://v3.football.api-sports.io";

  try {
    async function apiGet(path) {
      const cacheKey = new Request(
        `https://horizon-football-cache.local${path}`
      );

      const cached = await caches.default.match(cacheKey);

      if (cached) {
        return {
          data: await cached.json(),
          cached: true,
          status: 200
        };
      }

      const response = await fetch(`${base}${path}`, { headers });
      const data = await response.json();

      const hasErrors =
        data.errors && Object.keys(data.errors).length > 0;

      if (response.ok && !hasErrors) {
        await caches.default.put(
          cacheKey,
          new Response(JSON.stringify(data), {
            headers: {
              "content-type": "application/json",
              "cache-control": "public, max-age=300"
            }
          })
        );
      }

      return {
        data,
        cached: false,
        status: response.status
      };
    }

    const fixtureResult = await apiGet(
      `/fixtures?id=${encodeURIComponent(fixtureId)}`
    );

    const fixtureData = fixtureResult.data;

    if (!fixtureData.response?.length) {
      return Response.json(
        {
          error: "Match introuvable",
          details: fixtureData.errors || {}
        },
        { status: 404 }
      );
    }

    const fixture = fixtureData.response[0];

    const homeId = fixture.teams.home.id;
    const awayId = fixture.teams.away.id;

    const leagueId = fixture.league.id;
    const season = fixture.league.season;

    const [
  homeResult,
  awayResult,
  h2hResult,
  oddsResult
] = await Promise.all([
  apiGet(`/fixtures?team=${homeId}&season=${season}&status=FT&page=1`),
  apiGet(`/fixtures?team=${awayId}&season=${season}&status=FT&page=1`),
  apiGet(`/fixtures?h2h=${homeId}-${awayId}`),
  apiGet(`/odds?fixture=${fixtureId}`)
]);

const homeLast10 = (homeResult.data.response || [])
  .filter(match => new Date(match.fixture.date) < new Date(fixture.date))
  .sort((a, b) =>
    new Date(b.fixture.date) - new Date(a.fixture.date)
  )
  .slice(0, 10);

const awayLast10 = (awayResult.data.response || [])
  .filter(match => new Date(match.fixture.date) < new Date(fixture.date))
  .sort((a, b) =>
    new Date(b.fixture.date) - new Date(a.fixture.date)
  )
  .slice(0, 10);

const h2hLast10 = (h2hResult.data.response || [])
  .sort((a, b) =>
    new Date(b.fixture.date) - new Date(a.fixture.date)
  )
  .slice(0, 10);

    return Response.json({
      fixture,

      teams: {
        home: {
          id: homeId,
          name: fixture.teams.home.name,
          last10: homeLast10
        },

        away: {
          id: awayId,
          name: fixture.teams.away.name,
          last10: awayLast10
        }
      },

      h2h: h2hLast10,
      odds: oddsResult.data.response || [],

      league: {
        id: leagueId,
        season
      },

      apiErrors: {
        home: homeResult.data.errors || {},
        away: awayResult.data.errors || {},
        h2h: h2hResult.data.errors || {},
        odds: oddsResult.data.errors || {}
      }
    });

  } catch (error) {
    return Response.json(
      {
        error: "Erreur pendant l'analyse",
        message: error.message
      },
      { status: 500 }
    );
  }
       }
     if (url.pathname === "/api/fixtures") {
  const date = url.searchParams.get("date");
  const timezone =
    url.searchParams.get("timezone") || "Africa/Douala";

      if (!date) {
        return Response.json(
          { error: "Missing date parameter" },
          { status: 400 }
        );
      }

      const apiKey = env.API_FOOTBALL_KEY;

      if (!apiKey) {
        return Response.json(
          { error: "API_FOOTBALL_KEY is not configured" },
          { status: 500 }
        );
      }

      const apiUrl =
        `https://v3.football.api-sports.io/fixtures?date=${encodeURIComponent(date)}&timezone=${encodeURIComponent(timezone)}`;

      const response = await fetch(apiUrl, {
        headers: {
          "x-apisports-key": apiKey
        }
      });

      const data = await response.json();

      return new Response(JSON.stringify(data), {
        status: response.status,
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "cache-control": "public, max-age=300"
        }
      });
    }

    return env.ASSETS.fetch(request);
  }
};
