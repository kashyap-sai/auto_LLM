const { GoogleGenerativeAI } = require('@google/generative-ai');

async function callGemini(message, prompt) {
  if (!process.env.GEMINI_API_KEY) {
    return null;
  }
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const s = text.indexOf('{');
    const e = text.lastIndexOf('}');
    if (s !== -1 && e !== -1) {
      return JSON.parse(text.slice(s, e + 1));
    }
  } catch (err) {
    console.error("Gemini parsing error:", err.message);
  }
  return null;
}

async function extractBrowseSlots(message) {
  const prompt = `You extract structured fields from a user sentence about buying/browsing used cars.
Return strict JSON with keys: 
{ intent: 'browse'|'valuation'|'contact'|'about'|'unknown', 
  brand: string|null, 
  type: 'suv'|'sedan'|'hatchback'|'coupe'|'convertible'|'wagon'|'pickup'|null,
  budgetMin: integer|null, 
  budgetMax: integer|null }.
  
User: "${message}"`;
  return await callGemini(message, prompt) || { intent: 'unknown', brand: null, type: null, budgetMin: null, budgetMax: null };
}

async function extractValuationSlots(message) {
  const prompt = `Extract valuation details from user text. Return strict JSON with keys:
{ intent: 'valuation'|'unknown', brand: string|null, model: string|null, year: number|null, fuel: 'Petrol'|'Diesel'|'CNG'|'Electric'|null, kms: string|null, owner: string|null, condition: string|null, name: string|null, phone: string|null, location: string|null }.
User: "${message}"`;
  return await callGemini(message, prompt) || { intent: 'unknown' };
}

async function extractContactSlots(message) {
  const prompt = `Extract contact intent from user text. Return strict JSON:
{ action: 'call'|'callback'|'visit'|'unknown', time: string|null, name: string|null, phone: string|null, reason: string|null }.
User: "${message}"`;
  return await callGemini(message, prompt) || { action: 'unknown', time: null, name: null, phone: null, reason: null };
}

async function extractAboutSlots(message) {
  const prompt = `Classify which about topic user asked. Return JSON: 
{ section: 'Company Story'|'Why Choose Us'|'Our Locations'|'Our Services'|'Awards & Achievements'|'unknown' }.
User: "${message}"`;
  return await callGemini(message, prompt) || { section: 'unknown' };
}

module.exports = {
  extractBrowseSlots,
  extractValuationSlots,
  extractContactSlots,
  extractAboutSlots
};
