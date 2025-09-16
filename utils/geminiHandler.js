const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- Rule-based extraction helpers ---
const KNOWN_BRANDS = [
  'hyundai','honda','toyota','maruti','suzuki','maruti suzuki','tata','kia','mahindra','skoda','renault','ford','chevrolet','volkswagen','vw','bmw','audi','mercedes','mercedes-benz','mg','nissan','jeep','volvo'
];
const KNOWN_TYPES = ['suv','sedan','hatchback','mpv','muv','coupe','convertible','pickup','truck','crossover'];

function normalizeBrand(word) {
  const w = word.toLowerCase();
  if (w === 'vw') return 'volkswagen';
  if (w === 'mercedes-benz' || w === 'mercedes benz') return 'mercedes';
  if (w === 'maruti suzuki') return 'maruti';
  return w;
}

function parseBudget(message) {
  const m = message.toLowerCase();
  // Match patterns like: under 10 lakh(s), below 8 l, 12-15 lakhs, 7l, 5,00,000
  const lakhPattern = /(?:under|below|upto|up to)\s*(\d{1,2})(?:\s*l(?:akh)?s?)?/;
  const rangePattern = /(\d{1,2})\s*[-to]{1,3}\s*(\d{1,2})\s*l(?:akh)?s?/;
  const simpleLakh = /(\d{1,2})\s*l(?:akh)?s?/;
  const inrPattern = /(?:₹|rs\.?\s*)([\d,]{3,7})/;
  if (rangePattern.test(m)) {
    const [, a, b] = m.match(rangePattern);
    return { budget_min: Number(a), budget_max: Number(b) };
  }
  if (lakhPattern.test(m)) {
    const [, b] = m.match(lakhPattern);
    return { budget_max: Number(b) };
  }
  if (simpleLakh.test(m)) {
    const [, b] = m.match(simpleLakh);
    return { budget_max: Number(b) };
  }
  if (inrPattern.test(m)) {
    const [, amt] = m.match(inrPattern);
    const n = Number(amt.replace(/,/g, ''));
    if (!Number.isNaN(n)) {
      // Convert INR to lakhs approx
      const lakhs = Math.round(n / 100000);
      return { budget_max: lakhs };
    }
  }
  return null;
}

function extractBrand(message) {
  const lower = message.toLowerCase();
  for (const b of KNOWN_BRANDS) {
    if (lower.includes(b)) return normalizeBrand(b);
  }
  return null;
}

function extractType(message) {
  const lower = message.toLowerCase();
  for (const t of KNOWN_TYPES) {
    if (lower.includes(t)) return t;
  }
  return null;
}

function extractYear(message) {
  const match = message.match(/\b(19\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function ruleBasedExtract(message) {
  const lower = message.toLowerCase();
  const entities = {};
  const brand = extractBrand(lower);
  if (brand) entities.brand = brand;
  const type = extractType(lower);
  if (type) entities.type = type;
  const year = extractYear(lower);
  if (year) entities.year = year;
  const budget = parseBudget(lower);
  if (budget) Object.assign(entities, budget);

  // Intent heuristics
  const isGreeting = /\b(hi|hello|hey|namaste|good\s*(morning|afternoon|evening))\b/.test(lower);
  const isBrowse = /(browse|show\s+me|see|looking\s*for|search|find|buy|available).*(car|suv|sedan|hatch|inventory)|\bcars?\b/.test(lower);
  const isValuation = /(valuation|value\s*my|sell\s*my|price\s*my|what'?s\s*my\s*car\s*worth)/.test(lower);
  const isTestDrive = /(test\s*drive|book\s*drive|schedule\s*drive|drive\s*booking)/.test(lower);
  const isContact = /(contact|call|phone|talk\s*to|speak\s*to|sales\s*team)/.test(lower);
  const isAbout = /(about\s*(us|dealership)|who\s*are\s*you|info|information)/.test(lower);

  if (isGreeting && !isBrowse && !isValuation && !isTestDrive && !isContact && !isAbout) {
    return { intent: 'greeting', entities, confidence: 0.9, source: 'rule-based' };
  }
  if (isValuation) {
    return { intent: 'car_valuation', entities, confidence: 0.92, source: 'rule-based' };
  }
  if (isTestDrive) {
    return { intent: 'test_drive', entities, confidence: 0.9, source: 'rule-based' };
  }
  if (isContact) {
    return { intent: 'contact_team', entities, confidence: 0.9, source: 'rule-based' };
  }
  if (isAbout) {
    return { intent: 'about_us', entities, confidence: 0.9, source: 'rule-based' };
  }
  if (isBrowse || brand || type || budget) {
    return { intent: 'browse_cars', entities, confidence: 0.9, source: 'rule-based' };
  }

  // No confident rule hit
  return null;
}

// Context for the AI to understand the car dealership bot's purpose
const SYSTEM_CONTEXT = `You are a helpful car dealership assistant for Sherpa Hyundai. Your role is to:
1. Help customers with car-related queries (browsing used cars, valuations, contact info, about us)
2. Provide intelligent, helpful responses to any customer message
3. Be friendly, professional, and conversational
4. Guide users to appropriate services based on their needs
5. Handle both car-related and general questions with appropriate responses

Available services:
- 🚗 Browse Used Cars: View our inventory of pre-owned vehicles
- 💰 Get Car Valuation: Get a free estimate for your current car
- 📞 Contact Our Team: Speak with our sales representatives
- ℹ️ About Us: Learn about Sherpa Hyundai

For car-related questions: Provide helpful information and guide to relevant services.
For off-topic questions: Acknowledge politely and redirect to car services.
For unclear messages: Ask clarifying questions and suggest relevant options.`;

async function handleOutOfContextQuestion(userMessage, retryCount = 0) {
  const maxRetries = 2;
  const timeoutMs = 10000; // 10 seconds timeout
  
  try {
    // Check if we have a Gemini API key
    if (!process.env.GEMINI_API_KEY) {
      console.log("⚠️ No Gemini API key found, using fallback response");
      return getFallbackResponse(userMessage);
    }

    // Validate API key format
    if (!process.env.GEMINI_API_KEY.startsWith('AIza')) {
      console.log("⚠️ Invalid Gemini API key format, using fallback response");
      return getFallbackResponse(userMessage);
    }

    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      generationConfig: {
        maxOutputTokens: 200,
        temperature: 0.7,
      }
    });

    const prompt = `${SYSTEM_CONTEXT}

User message: "${userMessage}"

Please provide a helpful, intelligent response that:
1. Acknowledges their message appropriately
2. If car-related: Provide helpful information and guide to relevant services
3. If off-topic: Politely redirect to car services while being understanding
4. If unclear: Ask clarifying questions and suggest relevant options
5. Always be friendly, professional, and conversational
6. Keep response under 200 words
7. End with suggesting relevant menu options

Response:`;

    // Add timeout to prevent hanging
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Gemini API timeout')), timeoutMs);
    });

    const apiPromise = model.generateContent(prompt);
    
    const result = await Promise.race([apiPromise, timeoutPromise]);
    const response = await result.response;
    const text = response.text();
    
    // Validate response
    if (!text || text.trim().length === 0) {
      throw new Error('Empty response from Gemini API');
    }
    
    console.log("🤖 Gemini response:", text);
    return text;

  } catch (error) {
    console.error("❌ Error calling Gemini API:", error.message);
    
    // Handle specific error types
    if (error.message.inAIzaSyD1wgLyF9bP_DalyEduTOOMJsu8ldTEgz8cludes('timeout')) {
      console.log("⏰ Gemini API timeout, retrying...");
      if (retryCount < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // Exponential backoff
        return handleOutOfContextQuestion(userMessage, retryCount + 1);
      }
    } else if (error.message.includes('quota') || error.message.includes('limit')) {
      console.log("📊 Gemini API quota exceeded, using fallback");
    } else if (error.message.includes('permission') || error.message.includes('unauthorized')) {
      console.log("🔐 Gemini API permission denied, using fallback");
    } else if (error.message.includes('network') || error.message.includes('ECONNREFUSED')) {
      console.log("🌐 Gemini API network error, using fallback");
      if (retryCount < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return handleOutOfContextQuestion(userMessage, retryCount + 1);
      }
    } else if (error.message.includes('Empty response')) {
      console.log("📭 Empty response from Gemini API, using fallback");
    }
    
    return getFallbackResponse(userMessage);
  }
}

function getFallbackResponse(userMessage) {
  const lowerMsg = userMessage.toLowerCase();
  
  // Check for common off-topic keywords
  const offTopicKeywords = [
    'cook', 'recipe', 'food', 'biryani', 'weather', 'sports', 'movie', 'music',
    'joke', 'funny', 'game', 'politics', 'news', 'travel', 'hotel', 'restaurant'
  ];
  
  const isOffTopic = offTopicKeywords.some(keyword => lowerMsg.includes(keyword));
  const carKeywords = [
    'car','vehicle','auto','drive','buy','sell','price','valuation','browse','inventory','model','brand','year','fuel',
    'diesel','petrol','hybrid','electric','km','mileage','condition','owner','contact','team','sales',
    'honda','hyundai','toyota','maruti','tata','kia','mahindra','skoda','renault','ford','chevrolet','volkswagen','bmw','audi','mercedes',
    '₹','lakhs','lakh','budget','under','above','range'
  ];
  const iscarTopic = carKeywords.some(keyword => lowerMsg.includes(keyword));
  
  if (iscarTopic) {
    return `I'm here to help you with car-related services at Sherpa Hyundai! 🚗

How can I assist you today?
🚗 Browse Used Cars
💰 Get Car Valuation
📞 Contact Our Team
ℹ️ About Us`;
    
  }
  return `I understand you're asking about "${userMessage}", but I'm specifically here to help you with car-related services at Sherpa Hyundai! 🚗

I can assist you with:
🚗 Browse our used car inventory
💰 Get a free car valuation
📞 Contact our sales team
ℹ️ Learn more about us

What would you like to explore today?`;
  // For unclear messages, provide a general redirect
  
}

// Function to detect if a message is out of context
function isOutOfContext(message) {
  const lowerMsg = message.toLowerCase();
  
  // Car-related keywords that should NOT trigger out-of-context handling
  const carKeywords = [
    'car', 'vehicle', 'auto', 'motor', 'drive', 'buy', 'sell', 'price', 'cost',
    'valuation', 'value', 'browse', 'inventory', 'model', 'brand', 'year', 'fuel',
    'diesel', 'petrol', 'hybrid', 'electric', 'km', 'mileage', 'condition', 'owner',
    'contact', 'call', 'phone', 'team', 'sales', 'about', 'info', 'help', 'assist',
    'honda', 'hyundai', 'toyota', 'maruti', 'tata', 'kia', 'mahindra', 'skoda',
    'renault', 'ford', 'chevrolet', 'volkswagen', 'bmw', 'audi', 'mercedes',
    '₹', 'lakhs', 'lakh', 'crore', 'crores', 'budget', 'under', 'above', 'range'
  ];
  
  // Off-topic keywords that should trigger out-of-context handling
  const offTopicKeywords = [
    'cook', 'recipe', 'food', 'biryani', 'rice', 'chicken', 'vegetable', 'spice',
    'weather', 'temperature', 'rain', 'sunny', 'cold', 'hot',
    'sports', 'cricket', 'football', 'basketball', 'tennis',
    'movie', 'film', 'cinema', 'actor', 'actress', 'director',
    'music', 'song', 'singer', 'album', 'concert',
    'joke', 'funny', 'humor', 'comedy',
    'game', 'play', 'gaming', 'video game',
    'politics', 'election', 'vote', 'government',
    'news', 'current events', 'headlines',
    'travel', 'vacation', 'trip', 'hotel', 'flight', 'booking',
    'restaurant', 'dining', 'cafe', 'food delivery',
    'shopping', 'clothes', 'fashion', 'shoes',
    'health', 'medical', 'doctor', 'hospital',
    'education', 'school', 'college', 'university', 'study',
    'job', 'work', 'career', 'employment',
    'love', 'relationship', 'dating', 'marriage',
    'religion', 'god', 'prayer', 'temple', 'church',
    'philosophy', 'meaning', 'purpose', 'life'
  ];
  
  // Check if message contains car-related keywords
  const hasCarKeywords = carKeywords.some(keyword => lowerMsg.includes(keyword));
  
  // Check if message contains off-topic keywords
  const hasOffTopicKeywords = offTopicKeywords.some(keyword => lowerMsg.includes(keyword));
  
  // If it has off-topic keywords but no car keywords, it's likely out of context
  if (hasOffTopicKeywords && !hasCarKeywords) {
    return true;
  }
  
  // If it's a very short message (1-2 words) and doesn't contain car keywords, it might be out of context
  // BUT check if it's a valid budget option or other car-related selection first
  if (message.trim().split(' ').length <= 2 && !hasCarKeywords) {
    // Check if it's a budget option (contains ₹ symbol)
    if (message.includes('₹')) {
      return false; // This is a valid budget selection, not out of context
    }
    
    // Check if it's a common car-related selection
    const commonSelections = [
      'under', 'above', 'all', 'type', 'brand', 'model', 'yes', 'no', 'ok', 'okay',
      'select', 'choose', 'next', 'previous', 'more', 'back', 'home', 'menu'
    ];
    
    if (commonSelections.some(selection => lowerMsg.includes(selection))) {
      return false; // This is a valid selection, not out of context
    }
    
    return true;
  }
  
  return false;
}

module.exports = {
  handleOutOfContextQuestion,
  isOutOfContext,
  getFallbackResponse
};

// New: extract intent and entities from a user message using Gemini
async function extractIntentEntities(message, history = []) {
  try {
    // 1) Try rule-based first
    const ruleHit = ruleBasedExtract(message);
    if (ruleHit) return ruleHit;

    // 2) Fallback to Gemini if available
    if (!process.env.GEMINI_API_KEY || !process.env.GEMINI_API_KEY.startsWith('AIza')) {
      return { intent: 'general', entities: {}, confidence: 0.0, source: 'fallback' };
    }
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { temperature: 0.2, maxOutputTokens: 256 } });
    const sys = `You are an intent and entity extractor for a car dealership WhatsApp bot.\nReturn STRICT JSON only (no prose). Schema:\n{\n  "intent": one of ["browse_cars","car_valuation","test_drive","contact_team","about_us","greeting","general"],\n  "entities": {\n     "brand"?: string, "model"?: string, "year"?: number, "fuel_type"?: string,\n     "budget_min"?: number, "budget_max"?: number, "phone"?: string,\n     "test_drive_date"?: string, "test_drive_time"?: string, "location"?: string\n  },\n  "confidence": number (0..1)\n}\nPrefer intent based on the user's goal.`;
    const convo = history.map(h => `${h.role.toUpperCase()}: ${h.text}`).join('\n');
    const prompt = `${sys}\n\nConversation:\n${convo}\nUSER: ${message}\n\nJSON:`;
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) return { intent: 'general', entities: {}, confidence: 0.0, source: 'gemini' };
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    // Basic validation
    if (!parsed.intent) parsed.intent = 'general';
    if (typeof parsed.entities !== 'object') parsed.entities = {};
    if (typeof parsed.confidence !== 'number') parsed.confidence = 0.5;
    return { ...parsed, source: 'gemini' };
  } catch (e) {
    console.error('❌ Gemini extractIntentEntities error:', e.message);
    return { intent: 'general', entities: {}, confidence: 0.0, source: 'fallback' };
  }
}

module.exports.extractIntentEntities = extractIntentEntities;