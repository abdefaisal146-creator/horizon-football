
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
async function sofaSearchTeam(teamName) {
  const url =
    `https://www.sofascore.com/api/v1/search/all?q=${encodeURIComponent(teamName)}`;

  const response = await fetch(url);

  if (!response.ok) {
    return null;
  }

  const data = await response.json();

  const result = (data.results || []).find(
    item =>
      item.type === "team" &&
      item.entity &&
      item.entity.sport &&
      item.entity.sport.slug === "football"
  );

  return result ? result.entity : null;
}

async function sofaLast10(teamName) {
  const team = await sofaSearchTeam(teamName);

  if (!team || !team.id) {
    return [];
  }

  const response = await fetch(
    `https://www.sofascore.com/api/v1/team/${team.id}/events/last/0`
  );

  if (!response.ok) {
    return [];
  }

  const data = await response.json();

  return (data.events || [])
  .filter(event => event.status?.type === "finished")
  .sort((a, b) => b.startTimestamp - a.startTimestamp)
  .slice(0, 10)
  .map(event => ({
    fixture: {
      id: event.id,
      date: new Date(event.startTimestamp * 1000).toISOString(),
      status: {
        short: "FT"
      }
    },
    teams: {
      home: {
        id: event.homeTeam?.id,
        name: event.homeTeam?.name
      },
      away: {
        id: event.awayTeam?.id,
        name: event.awayTeam?.name
      }
    },
    goals: {
      home: event.homeScore?.current ?? null,
      away: event.awayScore?.current ?? null
    }
  }));
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

    const fixtureDate = new Date(fixture.fixture.date);
const toDate = fixture.fixture.date.slice(0, 10);

const fromDateObj = new Date(fixtureDate);
fromDateObj.setUTCDate(fromDateObj.getUTCDate() - 180);

const fromDate = fromDateObj.toISOString().slice(0, 10);

const homeResult = {
  data: {
    response: await sofaLast10(fixture.teams.home.name),
    errors: []
  }
};

const awayResult = {
  data: {
    response: await sofaLast10(fixture.teams.away.name),
    errors: []
  }
};

const h2hResult = await apiGet(
  `/fixtures/headtohead?h2h=${homeId}-${awayId}`
);

const oddsResult = await apiGet(
  `/odds?fixture=${fixtureId}`
);

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
