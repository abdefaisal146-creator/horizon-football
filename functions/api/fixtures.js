export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const date = url.searchParams.get("date");
  const timezone = url.searchParams.get("timezone") || "Africa/Douala";

  if (!date) {
    return Response.json({ error: "Missing date parameter" }, { status: 400 });
  }

  const apiKey = context.env.API_FOOTBALL_KEY;
  if (!apiKey) {
    return Response.json({
      error: "API_FOOTBALL_KEY is not configured",
      setup: "Add API_FOOTBALL_KEY as a secret/environment variable in your hosting dashboard."
    }, { status: 500 });
  }

  const apiUrl =
    `https://v3.football.api-sports.io/fixtures?date=${encodeURIComponent(date)}&timezone=${encodeURIComponent(timezone)}`;

  const response = await fetch(apiUrl, {
    headers: { "x-apisports-key": apiKey },
    cf: { cacheTtl: 300, cacheEverything: true }
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
