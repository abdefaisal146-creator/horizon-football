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
    const fixtureRes = await fetch(
      `${base}/fixtures?id=${encodeURIComponent(fixtureId)}`,
      { headers }
    );

    const fixtureData = await fixtureRes.json();

    if (!fixtureRes.ok || !fixtureData.response?.length) {
      return Response.json(
        { error: "Match introuvable", details: fixtureData.errors || {} },
        { status: 404 }
      );
    }

    const fixture = fixtureData.response[0];
    const homeId = fixture.teams.home.id;
    const awayId = fixture.teams.away.id;
    const leagueId = fixture.league.id;
    const season = fixture.league.season;

    const requests = [
      fetch(`${base}/fixtures?team=${homeId}&last=10`, { headers }),
      fetch(`${base}/fixtures?team=${awayId}&last=10`, { headers }),
      fetch(`${base}/fixtures?h2h=${homeId}-${awayId}&last=10`, { headers }),
      fetch(`${base}/odds?fixture=${fixtureId}`, { headers })
    ];

    const [homeLastRes, awayLastRes, h2hRes, oddsRes] =
      await Promise.all(requests);

    const [homeLast, awayLast, h2h, odds] =
      await Promise.all([
        homeLastRes.json(),
        awayLastRes.json(),
        h2hRes.json(),
        oddsRes.json()
      ]);

    return Response.json({
      fixture,
      teams: {
        home: {
          id: homeId,
          name: fixture.teams.home.name,
          last10: homeLast.response || []
        },
        away: {
          id: awayId,
          name: fixture.teams.away.name,
          last10: awayLast.response || []
        }
      },
      h2h: h2h.response || [],
      odds: odds.response || [],
      league: {
        id: leagueId,
        season
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
    }if (url.pathname === "/api/fixtures") {
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
