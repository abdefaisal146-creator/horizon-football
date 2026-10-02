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
