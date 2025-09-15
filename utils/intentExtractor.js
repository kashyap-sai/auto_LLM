const { GoogleGenerativeAI } = require('@google/generative-ai');

function simpleRegexExtract(message) {
  const lower = message.toLowerCase();
  // Basic intent detection
  const browseKeywords = ['browse', 'buy', 'look', 'see', 'show', 'find'];
  const valuationKeywords = ['valuation', 'value', 'price my car'];

  const intent = browseKeywords.some(k => lower.includes(k)) ? 'browse'
    : valuationKeywords.some(k => lower.includes(k)) ? 'valuation'
    : null;

  // Extract brand (very basic list; DB-driven brand list is better but this helps offline)
  const brands = ['maruti', 'hyundai', 'honda', 'toyota', 'tata', 'kia', 'mahindra', 'skoda', 'renault', 'ford', 'volkswagen', 'bmw', 'audi', 'mercedes'];
  const brand = brands.find(b => lower.includes(b));

  // Extract type
  const types = ['suv', 'sedan', 'hatchback', 'coupe', 'convertible', 'wagon', 'pickup'];
  const type = types.find(t => lower.includes(t));

  // Extract budget
  let budgetMin = null, budgetMax = null;
  const lakhPattern = /(\d+(?:\.\d+)?)\s*lakh|lakhs|lacs/;
  const rangePattern = /(\d+(?:\.\d+)?)\s*[-to]+\s*(\d+(?:\.\d+)?)\s*lakh|lakhs|lacs/;
  const underPattern = /(under|below)\s*(\d+(?:\.\d+)?)\s*lakh|lakhs|lacs/;
  const abovePattern = /(above|over)\s*(\d+(?:\.\d+)?)\s*lakh|lakhs|lacs/;

  const toNumber = (v) => Math.round(parseFloat(v) * 100000);

  const mRange = lower.match(rangePattern);
  if (mRange && mRange[1] && mRange[2]) {
    budgetMin = toNumber(mRange[1]);
    budgetMax = toNumber(mRange[2]);
  } else {
    const mUnder = lower.match(underPattern);
    if (mUnder && mUnder[2]) {
      budgetMin = 0; budgetMax = toNumber(mUnder[2]);
    }
    const mAbove = lower.match(abovePattern);
    if (mAbove && mAbove[2]) {
      budgetMin = toNumber(mAbove[2]); budgetMax = null;
    }
    if (!mUnder && !mAbove) {
      const single = lower.match(lakhPattern);
      if (single && single[1]) {
        // Treat as approximate max
        budgetMin = 0; budgetMax = toNumber(single[1]);
      }
    }
  }

  return { intent, brand, type, budgetMin, budgetMax, source: 'regex' };
}

async function extractSlotsWithGemini(message) {
  if (!process.env.GEMINI_API_KEY) return null;
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = `You extract structured fields from a user sentence about buying/browsing used cars.
Return strict JSON with keys: intent (one of: browse, valuation, contact, about, unknown), brand (lowercase word or null), type (suv/sedan/hatchback/coupe/convertible/wagon/pickup or null), budgetMin (integer rupees or null), budgetMax (integer rupees or null).
User: "${message}"`;
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) return null;
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    parsed.source = 'gemini';
    return parsed;
  } catch (e) {
    return null;
  }
}

async function extractBrowseSlots(message) {
  // Try Gemini first, fallback to regex
  const gem = await extractSlotsWithGemini(message);
  if (gem) return gem;
  return simpleRegexExtract(message);
}

async function extractValuationSlots(message) {
  // Gemini JSON schema for valuation
  if (process.env.GEMINI_API_KEY) {
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const prompt = `Extract valuation details from user text. Return strict JSON with keys:
{ intent: 'valuation'|'unknown', brand: string|null, model: string|null, year: number|null, fuel: 'Petrol'|'Diesel'|'CNG'|'Electric'|null, kms: string|null, owner: string|null, condition: string|null, name: string|null, phone: string|null, location: string|null }.
User: "${message}"`;
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const s = text.indexOf('{');
      const e = text.lastIndexOf('}');
      if (s !== -1 && e !== -1) return JSON.parse(text.slice(s, e + 1));
    } catch (_) {}
  }
  const lower = message.toLowerCase();
  const rough = {};
  // very basic regex for year
  const yearMatch = lower.match(/\b(20\d{2}|19\d{2})\b/);
  if (yearMatch) rough.year = parseInt(yearMatch[1]);
  // fuel
  if (lower.includes('petrol')) rough.fuel = 'Petrol';
  if (lower.includes('diesel')) rough.fuel = 'Diesel';
  if (lower.includes('cng')) rough.fuel = 'CNG';
  if (lower.includes('electric')) rough.fuel = 'Electric';
  // phone
  const phone = message.replace(/[^0-9]/g,'').match(/\b\d{10}\b/);
  if (phone) rough.phone = phone[0];
  // naive brand from browse brands
  const brands = ['maruti','hyundai','honda','toyota','tata','kia','mahindra','skoda','renault','ford','volkswagen','bmw','audi','mercedes'];
  const b = brands.find(b=>lower.includes(b));
  if (b) rough.brand = b.charAt(0).toUpperCase()+b.slice(1);
  rough.intent = 'valuation';
  return rough;
}

async function extractContactSlots(message) {
  if (process.env.GEMINI_API_KEY) {
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const prompt = `Extract contact intent from user text. Return strict JSON:
{ action: 'call'|'callback'|'visit'|'unknown', time: string|null, name: string|null, phone: string|null, reason: string|null }.
User: "${message}"`;
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const s = text.indexOf('{');
      const e = text.lastIndexOf('}');
      if (s !== -1 && e !== -1) return JSON.parse(text.slice(s, e + 1));
    } catch(_) {}
  }
  const lower = message.toLowerCase();
  const slots = { action: 'unknown', time: null, name: null, phone: null, reason: null };
  if (lower.includes('call')) slots.action = 'call';
  if (lower.includes('callback') || lower.includes('call back')) slots.action = 'callback';
  if (lower.includes('visit') || lower.includes('showroom')) slots.action = 'visit';
  const phone = message.replace(/[^0-9]/g,'').match(/\b\d{10}\b/);
  if (phone) slots.phone = phone[0];
  return slots;
}

async function extractAboutSlots(message) {
  if (process.env.GEMINI_API_KEY) {
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const prompt = `Classify which about topic user asked. Return JSON { section: 'Company Story'|'Why Choose Us'|'Our Locations'|'Our Services'|'Awards & Achievements'|'unknown' }.
User: "${message}"`;
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const s = text.indexOf('{');
      const e = text.lastIndexOf('}');
      if (s !== -1 && e !== -1) return JSON.parse(text.slice(s, e + 1));
    } catch(_) {}
  }
  const lower = message.toLowerCase();
  let section = 'unknown';
  if (lower.includes('story')) section = 'Company Story';
  else if (lower.includes('why')) section = 'Why Choose Us';
  else if (lower.includes('location') || lower.includes('visit')) section = 'Our Locations';
  else if (lower.includes('service')) section = 'Our Services';
  else if (lower.includes('award') || lower.includes('achievement')) section = 'Awards & Achievements';
  return { section };
}

module.exports = {
  extractBrowseSlots,
  extractValuationSlots,
  extractContactSlots,
  extractAboutSlots
};


