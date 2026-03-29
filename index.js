import express from 'express';
import cors from 'cors';
import { VertexAI } from '@google-cloud/vertexai';

// ── Config ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
const NDC_API_KEY = process.env.NDC_API_KEY || 'ndc_uXbiQTwHpw8XI5r9qQYI5DwVIgPLhXWZlROhVBYdIMI';
const NDC_BASE = 'https://ndc-api-juz3nslm5a-uc.a.run.app';
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || 'REPLACE_WITH_PROJECT_ID';
const GCP_REGION = process.env.GCP_REGION || 'us-central1';
const MAPS_API_KEY = process.env.MAPS_API_KEY || 'REPLACE_WITH_MAPS_KEY';

// ── Vertex AI ───────────────────────────────────────────────────────────────
const vertexAI = new VertexAI({ project: GCP_PROJECT_ID, location: GCP_REGION });
const model = vertexAI.getGenerativeModel({
  model: 'gemini-1.5-flash-001',
  generationConfig: { maxOutputTokens: 1200, temperature: 0.85 },
});

// ── NDC → Google Places keyword mapping ─────────────────────────────────────
const KEYWORD_TO_PLACES = [
  { keywords: ['pizza'], type: 'restaurant', keyword: 'pizza', emoji: '🍕' },
  { keywords: ['burger', 'hamburger'], type: 'restaurant', keyword: 'burger', emoji: '🍔' },
  { keywords: ['taco', 'mexican'], type: 'restaurant', keyword: 'taco', emoji: '🌮' },
  { keywords: ['sushi', 'japanese'], type: 'restaurant', keyword: 'sushi', emoji: '🍣' },
  { keywords: ['ice cream', 'gelato'], type: 'restaurant', keyword: 'ice cream', emoji: '🍦' },
  { keywords: ['donut', 'doughnut'], type: 'restaurant', keyword: 'donut', emoji: '🍩' },
  { keywords: ['coffee', 'espresso', 'latte', 'cappuccino'], type: 'cafe', keyword: 'coffee', emoji: '☕' },
  { keywords: ['tea', 'chai', 'matcha'], type: 'cafe', keyword: 'tea', emoji: '🍵' },
  { keywords: ['beer', 'brewery', 'ale'], type: 'bar', keyword: 'brewery', emoji: '🍺' },
  { keywords: ['wine', 'winery', 'vineyard'], type: 'bar', keyword: 'wine', emoji: '🍷' },
  { keywords: ['cocktail', 'mixology'], type: 'bar', keyword: 'cocktail', emoji: '🍸' },
  { keywords: ['chocolate', 'cocoa'], type: 'restaurant', keyword: 'chocolate', emoji: '🍫' },
  { keywords: ['bakery', 'bread', 'pastry', 'cake'], type: 'bakery', keyword: 'bakery', emoji: '🍰' },
  { keywords: ['bbq', 'barbecue', 'grill'], type: 'restaurant', keyword: 'bbq', emoji: '🔥' },
  { keywords: ['seafood', 'fish', 'shrimp', 'lobster'], type: 'restaurant', keyword: 'seafood', emoji: '🦞' },
  { keywords: ['chicken', 'wings', 'fried chicken'], type: 'restaurant', keyword: 'chicken', emoji: '🍗' },
  { keywords: ['dog', 'puppy', 'canine'], type: 'pet_store', keyword: 'dog', emoji: '🐶' },
  { keywords: ['cat', 'kitten', 'feline'], type: 'pet_store', keyword: 'cat', emoji: '🐱' },
  { keywords: ['book', 'reading', 'library', 'literature'], type: 'book_store', keyword: 'book', emoji: '📚' },
  { keywords: ['yoga', 'meditation', 'mindfulness'], type: 'gym', keyword: 'yoga', emoji: '🧘' },
  { keywords: ['fitness', 'exercise', 'workout', 'gym'], type: 'gym', keyword: 'gym', emoji: '💪' },
  { keywords: ['garden', 'plant', 'flower', 'botanical'], type: 'florist', keyword: 'flowers', emoji: '🌸' },
  { keywords: ['art', 'painting', 'gallery', 'museum'], type: 'art_gallery', keyword: 'art', emoji: '🎨' },
  { keywords: ['music', 'concert', 'jazz', 'rock'], type: 'night_club', keyword: 'live music', emoji: '🎵' },
  { keywords: ['movie', 'film', 'cinema'], type: 'movie_theater', keyword: 'movie', emoji: '🎬' },
  { keywords: ['spa', 'massage', 'wellness', 'relaxation'], type: 'spa', keyword: 'spa', emoji: '💆' },
  { keywords: ['photography', 'photo', 'camera'], type: 'electronics_store', keyword: 'camera', emoji: '📷' },
  { keywords: ['hiking', 'trail', 'nature', 'outdoor'], type: 'park', keyword: 'park', emoji: '🏞️' },
  { keywords: ['golf'], type: 'stadium', keyword: 'golf', emoji: '⛳' },
  { keywords: ['bowling'], type: 'bowling_alley', keyword: 'bowling', emoji: '🎳' },
  { keywords: ['game', 'video game', 'gaming'], type: 'electronics_store', keyword: 'gaming', emoji: '🎮' },
];

// ── Express App ─────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// ── Helpers ─────────────────────────────────────────────────────────────────
async function ndcFetch(endpoint) {
  const res = await fetch(`${NDC_BASE}${endpoint}`, {
    headers: { 'X-API-Key': NDC_API_KEY },
  });
  if (!res.ok) throw new Error(`NDC API ${endpoint} failed: ${res.status}`);
  return res.json();
}

function matchObservancesToPlaces(observances) {
  const matched = [];
  const seen = new Set();

  for (const obs of observances) {
    const name = (obs.name || obs.title || '').toLowerCase();
    for (const mapping of KEYWORD_TO_PLACES) {
      if (seen.has(mapping.keyword)) continue;
      if (mapping.keywords.some(kw => name.includes(kw))) {
        matched.push({ ...mapping, observance: obs.name || obs.title });
        seen.add(mapping.keyword);
        if (matched.length >= 3) return matched;
      }
    }
  }

  if (matched.length === 0) {
    matched.push({ type: 'restaurant', keyword: 'restaurant', emoji: '🍽️', observance: 'Celebrate Today' });
    matched.push({ type: 'cafe', keyword: 'cafe', emoji: '☕', observance: 'Celebrate Today' });
  }

  return matched;
}

function scoreObservance(obs, profile) {
  let score = 0;
  const name = (obs.name || obs.title || '').toLowerCase();

  if (profile.passions) {
    for (const passion of profile.passions) {
      if (name.includes(passion.toLowerCase())) score += 10;
    }
  }

  if (profile.mood) {
    const moodMap = {
      adventurous: ['adventure', 'explore', 'discover', 'wild', 'extreme'],
      creative: ['art', 'craft', 'create', 'design', 'music', 'paint'],
      relaxed: ['relax', 'calm', 'peaceful', 'zen', 'meditation', 'spa'],
      energetic: ['fitness', 'sport', 'dance', 'run', 'active', 'energy'],
      social: ['friend', 'party', 'community', 'together', 'gathering'],
      reflective: ['book', 'read', 'think', 'journal', 'mindful', 'poetry'],
    };
    const moodKeywords = moodMap[profile.mood.toLowerCase()] || [];
    if (moodKeywords.some(kw => name.includes(kw))) score += 5;
  }

  if (profile.birthMonth && obs.date) {
    const obsMonth = new Date(obs.date).getMonth() + 1;
    if (obsMonth === profile.birthMonth) score += 3;
  }

  score += Math.random() * 2;
  return score;
}

function selectFourObservances(allObservances, profile) {
  const scored = allObservances.map(obs => ({
    ...obs,
    score: scoreObservance(obs, profile),
  }));
  scored.sort((a, b) => b.score - a.score);

  const selected = {
    destined: scored[0] || null,
    season: scored[1] || null,
    world: scored[2] || null,
    wildcard: scored[Math.floor(Math.random() * Math.min(scored.length, 10))] || scored[3] || null,
  };

  return selected;
}

function buildHoroscopePrompt(selected, profile) {
  const { name, birthMonth, mood, passions } = profile;
  const passionStr = (passions || []).join(', ');

  return `You are the mystical voice of the National Day Calendar. Generate a personalized daily horoscope reading for ${name || 'a curious soul'}.

Their birth month: ${birthMonth || 'unknown'}
Current mood: ${mood || 'open'}
Passions: ${passionStr || 'general curiosity'}

Today's cosmic observances aligned for them:
1. DESTINED DAY: ${selected.destined?.name || 'National Celebration Day'} — This day was made for them
2. COSMIC SEASON: ${selected.season?.name || 'National Discovery Day'} — The season's energy speaks
3. WORLD CONNECTION: ${selected.world?.name || 'International Unity Day'} — A global thread connects
4. WILDCARD: ${selected.wildcard?.name || 'National Surprise Day'} — The universe has a surprise

Return a JSON object with exactly these fields:
{
  "intro": "A 2-sentence mystical opening that sets the scene (50-80 words)",
  "destined": "A personalized reading for the Destined Day (60-100 words). Connect it to their passions and mood.",
  "season": "A reading for the Cosmic Season observance (60-100 words). Tie it to the current time of year.",
  "world": "A reading for the World Connection (60-100 words). Make it feel globally connected.",
  "wildcard": "A fun, unexpected reading for the Wildcard (60-100 words). Be playful and surprising.",
  "closing": "A 1-2 sentence mystical closing with an actionable suggestion (30-50 words)"
}

Be warm, mystical, fun, and specific. Reference the actual observance names. Never be generic.`;
}

function fallbackHoroscope(selected) {
  return {
    intro: `The stars have aligned with today's celebrations to bring you a special message. The universe is celebrating right alongside you today!`,
    destined: `${selected.destined?.name || 'Today'} resonates deeply with your cosmic energy. This is a day meant specifically for you — embrace it fully and let its spirit guide your actions.`,
    season: `${selected.season?.name || 'This season'} carries the energy of the current season into your life. Let the rhythm of this time inspire you to grow and explore new possibilities.`,
    world: `${selected.world?.name || 'Today'} connects you to a global celebration. You are part of something much bigger — feel the unity of millions celebrating alongside you.`,
    wildcard: `Surprise! ${selected.wildcard?.name || 'The universe'} throws you a cosmic curveball. Sometimes the best discoveries come from the most unexpected places. Stay open!`,
    closing: `Trust the celebrations the universe has placed before you today. Pick one observance and celebrate it with intention — your cosmic self will thank you.`,
  };
}

// ── Health Check ────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    features: {
      horoscope: true,
      nearbyPlaces: true,
      vertexAI: true,
    },
    model: 'gemini-1.5-flash-001',
  });
});

// ── Horoscope Generation ────────────────────────────────────────────────────
app.post('/api/horoscope-generate', async (req, res) => {
  try {
    const { name, birthMonth, mood, passions } = req.body;
    const profile = { name, birthMonth, mood, passions };

    const [todayData, weekData, monthData, internationalData] = await Promise.all([
      ndcFetch('/api/v1/today').catch(() => ({ days: [] })),
      ndcFetch('/api/v1/weeks/current').catch(() => ({ weeks: [] })),
      ndcFetch('/api/v1/months/current').catch(() => ({ months: [] })),
      ndcFetch('/api/v1/international/today').catch(() => ({ days: [] })),
    ]);

    const allObservances = [
      ...(todayData.days || todayData.data || []),
      ...(weekData.weeks || weekData.data || []),
      ...(monthData.months || monthData.data || []),
      ...(internationalData.days || internationalData.data || []),
    ];

    if (allObservances.length === 0) {
      return res.json({ success: true, horoscope: fallbackHoroscope({}) });
    }

    const selected = selectFourObservances(allObservances, profile);
    const prompt = buildHoroscopePrompt(selected, profile);

    let horoscope;
    try {
      const result = await model.generateContent(prompt);
      const response = result.response;
      const text = response.candidates[0].content.parts[0].text;

      const jsonStr = text.replace(/\`\`\`json\n?/g, '').replace(/\`\`\`\n?/g, '').trim();
      horoscope = JSON.parse(jsonStr);
    } catch (aiError) {
      console.error('Vertex AI error, using fallback:', aiError.message);
      horoscope = fallbackHoroscope(selected);
    }

    res.json({
      success: true,
      horoscope,
      observances: {
        destined: selected.destined?.name || null,
        season: selected.season?.name || null,
        world: selected.world?.name || null,
        wildcard: selected.wildcard?.name || null,
      },
    });
  } catch (error) {
    console.error('Horoscope generation error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate horoscope' });
  }
});

// ── Nearby Places ───────────────────────────────────────────────────────────
app.post('/api/nearby-places', async (req, res) => {
  try {
    const { lat, lng, radius = 5000, observances: clientObservances } = req.body;

    if (!lat || !lng) {
      return res.status(400).json({ success: false, error: 'lat and lng are required' });
    }

    let observances = clientObservances;
    if (!observances || observances.length === 0) {
      const todayData = await ndcFetch('/api/v1/today').catch(() => ({ days: [] }));
      observances = todayData.days || todayData.data || [];
    }

    const categories = matchObservancesToPlaces(observances);

    const categoryResults = await Promise.all(
      categories.map(async (cat) => {
        try {
          const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
          url.searchParams.set('location', `${lat},${lng}`);
          url.searchParams.set('radius', String(radius));
          url.searchParams.set('type', cat.type);
          if (cat.keyword) url.searchParams.set('keyword', cat.keyword);
          url.searchParams.set('key', MAPS_API_KEY);

          const placesRes = await fetch(url.toString());
          const placesData = await placesRes.json();

          const places = (placesData.results || []).slice(0, 8).map(place => ({
            name: place.name,
            address: place.vicinity,
            rating: place.rating || null,
            userRatingsTotal: place.user_ratings_total || 0,
            priceLevel: place.price_level ?? null,
            isOpen: place.opening_hours?.open_now ?? null,
            lat: place.geometry?.location?.lat,
            lng: place.geometry?.location?.lng,
            placeId: place.place_id,
            photo: place.photos?.[0]
              ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${place.photos[0].photo_reference}&key=${MAPS_API_KEY}`
              : null,
          }));

          return {
            category: cat.keyword,
            type: cat.type,
            emoji: cat.emoji,
            observance: cat.observance,
            places,
          };
        } catch (err) {
          console.error(`Places fetch error for ${cat.keyword}:`, err.message);
          return { category: cat.keyword, type: cat.type, emoji: cat.emoji, observance: cat.observance, places: [] };
        }
      })
    );

    res.json({ success: true, categories: categoryResults });
  } catch (error) {
    console.error('Nearby places error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch nearby places' });
  }
});

// ── Start Server ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`NDC Proxy running on port ${PORT}`);
  console.log(`Project: ${GCP_PROJECT_ID} | Region: ${GCP_REGION}`);
});
