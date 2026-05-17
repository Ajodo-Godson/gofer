const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "GOFER hackathon reservation workflow";

export async function findRestaurantCandidates({ taskTitle, constraints }) {
  const location = normalizeLocation(constraints?.location);
  const origin = await geocode(location);
  const restaurants = await searchRestaurants(origin, constraints);
  const candidates = restaurants
    .map((restaurant) => ({
      ...restaurant,
      distanceMiles: round(distanceMiles(origin, restaurant), 1),
      fitScore: scoreRestaurant(restaurant, constraints, origin)
    }))
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, 5)
    .map((restaurant, index) => ({
      rank: index + 1,
      name: restaurant.name,
      cuisine: restaurant.cuisine || "Chinese / Asian",
      distanceMiles: restaurant.distanceMiles,
      phone: restaurant.phone || null,
      website: restaurant.website || null,
      bookingChannel: restaurant.website ? "website" : restaurant.phone ? "phone" : "manual lookup",
      estimatedPrice: "not verified",
      availability: "not verified until approval to book",
      whyItFits: buildFitReason(restaurant, constraints),
      lat: restaurant.lat,
      lon: restaurant.lon
    }));

  if (!candidates.length) {
    return {
      mode: "real",
      provider: "OpenStreetMap",
      result: "No nearby Chinese restaurant candidates found in OpenStreetMap.",
      success: false,
      output: JSON.stringify({
        status: "no_candidates",
        approval_required: false,
        candidates: [],
        blockers: [`No Chinese/Asian restaurants found near ${location} in OpenStreetMap.`]
      })
    };
  }

  const recommended = candidates[0];
  const output = {
    status: "candidates_ready",
    approval_required: true,
    recommended_candidate: recommended,
    candidates,
    next_action: `Approve ${recommended.name} or another candidate; GOFER will then use the listed booking channel to confirm a table for ${constraints.partySize || 3} around ${(constraints.preferredTimes || ["the requested time"]).join(", ")}.`,
    blockers: [
      "Live reservation availability is not confirmed yet.",
      "GOFER will not make the final booking until the user approves a candidate."
    ],
    source: "OpenStreetMap live geocoding and restaurant data",
    taskTitle
  };

  return {
    mode: "real",
    provider: "OpenStreetMap",
    result: `${candidates.length} restaurant candidates found. Approval required before booking.`,
    success: true,
    output: JSON.stringify(output, null, 2),
    data: output
  };
}

async function geocode(location) {
  const params = new URLSearchParams({
    q: location,
    format: "json",
    limit: "1"
  });
  const response = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: { "User-Agent": USER_AGENT }
  });
  if (!response.ok) {
    throw new Error(`Geocoding failed: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  if (!data[0]) throw new Error(`Could not geocode ${location}`);
  return {
    label: data[0].display_name,
    lat: Number(data[0].lat),
    lon: Number(data[0].lon)
  };
}

async function searchRestaurants(origin, constraints) {
  const radiusMeters = 5000;
  const query = [
    "[out:json][timeout:12];",
    "(",
    `node(around:${radiusMeters},${origin.lat},${origin.lon})[amenity=restaurant];`,
    `way(around:${radiusMeters},${origin.lat},${origin.lon})[amenity=restaurant];`,
    ");",
    "out center tags;"
  ].join("");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14000);
  try {
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT
      },
      body: new URLSearchParams({ data: query }),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Overpass failed: ${response.status} ${await response.text()}`);
    }
    const data = await response.json();
    return data.elements
      .map((element) => {
        const tags = element.tags || {};
        return {
          name: tags.name,
          cuisine: tags.cuisine || "",
          phone: tags.phone || tags["contact:phone"] || "",
          website: tags.website || tags["contact:website"] || "",
          lat: element.lat || element.center?.lat,
          lon: element.lon || element.center?.lon
        };
      })
      .filter((restaurant) => restaurant.name && restaurant.lat && restaurant.lon)
      .filter((restaurant) => matchesCuisine(restaurant, constraints));
  } finally {
    clearTimeout(timeout);
  }
}

function matchesCuisine(restaurant, constraints) {
  const text = `${restaurant.name} ${restaurant.cuisine}`.toLowerCase();
  const requested = (constraints?.cuisine || "").toLowerCase();
  if (requested === "chinese") {
    return /chinese|asian|dim.?sum|dumpling|taiwan|canton|sichuan|szechuan|hunan|shanghai|hong kong/.test(text);
  }
  return requested ? text.includes(requested) : true;
}

function scoreRestaurant(restaurant, constraints, origin) {
  let score = 0;
  const text = `${restaurant.name} ${restaurant.cuisine}`.toLowerCase();
  if (/chinese/.test(text)) score += 40;
  if (/dim.?sum|dumpling|hunan|sichuan|szechuan|canton/.test(text)) score += 12;
  if (restaurant.website) score += 12;
  if (restaurant.phone) score += 10;
  if ((constraints?.occasion || "").includes("team")) score += restaurant.website || restaurant.phone ? 8 : 0;
  score -= distanceMiles(origin, restaurant) * 4;
  return score;
}

function buildFitReason(restaurant, constraints) {
  const reasons = [];
  reasons.push(`${restaurant.distanceMiles} miles from ${constraints.location}`);
  if (/chinese/i.test(restaurant.cuisine || restaurant.name)) reasons.push("listed as Chinese");
  else reasons.push("listed as Asian-adjacent");
  if (restaurant.phone) reasons.push("has a phone number for reservation follow-up");
  if (restaurant.website) reasons.push("has a website for online booking/menu check");
  if (constraints.occasion) reasons.push(`can be screened for ${constraints.occasion}`);
  return reasons.join("; ");
}

function normalizeLocation(location) {
  const raw = location || "560 20th St, San Francisco, CA";
  return /san francisco|california|\bCA\b/i.test(raw) ? raw : `${raw}, San Francisco, CA`;
}

function distanceMiles(a, b) {
  const earthMiles = 3958.8;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return earthMiles * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRadians(degrees) {
  return degrees * Math.PI / 180;
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
