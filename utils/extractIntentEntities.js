const { GoogleGenerativeAI } = require('@google/generative-ai');

async function callGemini(message, prompt) {
  if (!'AIzaSyCWGLV6ZOEVXGmXvptVL65Z9d1ownwvTfo') {
    console.log("⚠️ GEMINI_API_KEY not set, returning default intent");
    return null;
  }
  
  try {
    const genAI = new GoogleGenerativeAI('AIzaSyCWGLV6ZOEVXGmXvptVL65Z9d1ownwvTfo');
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

async function generateLLMResponse(message, intent, entities) {
  // Ensure message is a string
  const messageStr = typeof message === 'string' ? message : String(message || '');
  
  if (!'AIzaSyCWGLV6ZOEVXGmXvptVL65Z9d1ownwvTfo') {
    console.log("⚠️ GEMINI_API_KEY not set, using fallback response");
    return generateFallbackResponse(messageStr, intent, entities);
  }
  
  try {
    const genAI = new GoogleGenerativeAI('AIzaSyCWGLV6ZOEVXGmXvptVL65Z9d1ownwvTfo');
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const responsePrompt = 
    
    `You are AutoSherpa, a professional Hyundai dealership assistant. Generate a unique, contextual response for the user's message.

    USER MESSAGE: "${messageStr}"
    DETECTED INTENT: ${intent}
    EXTRACTED ENTITIES: ${JSON.stringify(entities)}

    PROFESSIONAL RESPONSE GUIDELINES:
    - Generate a UNIQUE response that matches the user's specific message
    - Maintain a professional yet friendly tone
    - Use appropriate emojis sparingly (1-2 maximum)
    - Be helpful and informative without being overly enthusiastic
    - Vary your language and avoid repetitive phrases
    - Acknowledge extracted entities naturally and professionally
    - Keep responses concise and to the point
    - Avoid using the same words/phrases repeatedly
    - Sound knowledgeable and trustworthy

    EXAMPLES OF PROFESSIONAL RESPONSES:
    - For "I want hyndai car" with brand: "Hyundai" → "I'd be happy to show you our Hyundai inventory. What's your budget range? 🚗"
    - For "Show me cars for 7 ls" with budgetMax: 7 → "Let me find vehicles in your ₹5-10L range. What type of car interests you? 🚗"
    - For "Looking for honda city" with brand: "Honda", model: "City" → "The Honda City is an excellent choice. I can show you our available options. What's your budget? 🚗"

    Generate ONLY the response message (no JSON, no quotes, just the message):`;

    const result = await model.generateContent(responsePrompt);
    const response = result.response.text().trim();
    
    // Clean up the response (remove quotes if present)
    return response.replace(/^["']|["']$/g, '');
  } catch (err) {
    console.error("LLM response generation error:", err.message);
    return generateFallbackResponse(messageStr, intent, entities);
  }
}

function extractEntitiesFallback(message, history = []) {
  // Ensure message is a string
  const messageStr = typeof message === 'string' ? message : String(message || '');
  const msg = messageStr.toLowerCase();
  const entities = {};
  let intent = 'other';
  
  // Check conversation history for context
  const historyArray = Array.isArray(history) ? history : [];
  const recentIntents = historyArray.slice(-3).map(h => h.intent);
  const isInTestDriveFlow = recentIntents.includes('test_drive');
  const isInBrowseFlow = recentIntents.includes('browse_cars');
  
  // Also check if we're in browse flow based on session state
  const sessionState = typeof history === 'object' && !Array.isArray(history) ? history : {};
  const isInBrowseFlowByState = sessionState.step === 'browse_start' || 
                                sessionState.step === 'show_cars' ||
                                (sessionState.requirements && Object.keys(sessionState.requirements).length > 0);
  
  // Extract budget with typo tolerance - standardized format
  const budgetMatch = msg.match(/(\d+)\s*(lakh|lakhs|lac|lacs|ljs|ljsa|ls|l)/);
  if (budgetMatch) {
    const amount = parseInt(budgetMatch[1]);
    if (amount < 5) {
      entities.budget = 'Under ₹5L';
    } else if (amount >= 5 && amount < 10) {
      entities.budget = '₹5-10L';
    } else if (amount >= 10 && amount < 15) {
      entities.budget = '₹10-15L';
    } else {
      entities.budget = 'Above ₹15L';
    }
  }
  
  // Extract brands with typo tolerance
  if (msg.includes('hyundai') || msg.includes('hyndai') || msg.includes('hyndi')) entities.brand = 'Hyundai';
  if (msg.includes('maruti') || msg.includes('maruthi')) entities.brand = 'Maruti';
  if (msg.includes('honda')) entities.brand = 'Honda';
  if (msg.includes('toyota')) entities.brand = 'Toyota';
  if (msg.includes('tata')) entities.brand = 'Tata';
  if (msg.includes('mahindra')) entities.brand = 'Mahindra';
  if (msg.includes('kia')) entities.brand = 'Kia';
  if (msg.includes('volkswagen') || msg.includes('vw')) entities.brand = 'Volkswagen';
  if (msg.includes('skoda')) entities.brand = 'Skoda';
  if (msg.includes('ford')) entities.brand = 'Ford';
  if (msg.includes('chevrolet') || msg.includes('chevy')) entities.brand = 'Chevrolet';
  if (msg.includes('nissan')) entities.brand = 'Nissan';
  if (msg.includes('renault')) entities.brand = 'Renault';
  
  // Extract models with typo tolerance
  if (msg.includes('city') || msg.includes('cty')) entities.model = 'City';
  if (msg.includes('swift') || msg.includes('swft')) entities.model = 'Swift';
  if (msg.includes('innova')) entities.model = 'Innova';
  if (msg.includes('nexon')) entities.model = 'Nexon';
  if (msg.includes('creta')) entities.model = 'Creta';
  if (msg.includes('verna')) entities.model = 'Verna';
  if (msg.includes('santro')) entities.model = 'Santro';
  if (msg.includes('baleno')) entities.model = 'Baleno';
  if (msg.includes('dzire') || msg.includes('dizire')) entities.model = 'Dzire';
  if (msg.includes('alto')) entities.model = 'Alto';
  if (msg.includes('polo')) entities.model = 'Polo';
  if (msg.includes('vento')) entities.model = 'Vento';
  if (msg.includes('amaze')) entities.model = 'Amaze';
  if (msg.includes('jazz')) entities.model = 'Jazz';
  if (msg.includes('civic')) entities.model = 'Civic';
  if (msg.includes('accord')) entities.model = 'Accord';
  if (msg.includes('corolla')) entities.model = 'Corolla';
  if (msg.includes('camry')) entities.model = 'Camry';
  if (msg.includes('fortuner')) entities.model = 'Fortuner';
  if (msg.includes('scorpio')) entities.model = 'Scorpio';
  if (msg.includes('thar')) entities.model = 'Thar';
  if (msg.includes('bolero')) entities.model = 'Bolero';
  if (msg.includes('i20') || msg.includes('i-20') || msg.includes('i 20')) entities.model = 'i20';
  
  // Extract types with typo tolerance
  if (msg.includes('suv') || msg.includes('s.u.v') || msg.includes('s u v')) entities.type = 'SUV';
  if (msg.includes('sedan') || msg.includes('seden') || msg.includes('sedon')) entities.type = 'Sedan';
  if (msg.includes('hatchback') || msg.includes('hatch') || msg.includes('hatchbak')) entities.type = 'Hatchback';
  if (msg.includes('coupe') || msg.includes('coup')) entities.type = 'Coupe';
  if (msg.includes('convertible') || msg.includes('convert')) entities.type = 'Convertible';
  if (msg.includes('wagon') || msg.includes('wagn')) entities.type = 'Wagon';
  if (msg.includes('pickup') || msg.includes('pick') || msg.includes('pick up')) entities.type = 'Pickup';
  
  // Extract fuel with typo tolerance
  if (msg.includes('petrol')) entities.fuel = 'Petrol';
  if (msg.includes('diesel')) entities.fuel = 'Diesel';
  if (msg.includes('cng') || msg.includes('c.n.g') || msg.includes('c n g')) entities.fuel = 'CNG';
  if (msg.includes('electric') || msg.includes('ev')) entities.fuel = 'Electric';
  
  // Determine intent with context awareness
  if (msg.includes('price') || msg.includes('value') || msg.includes('valuation') || msg.includes('worth') || 
      msg.includes('sell') || msg.includes('selling') || msg.includes('get rid of') || msg.includes('dispose')) {
    intent = 'car_valuation';
  } else if (msg.includes('test') && msg.includes('drive')) {
    intent = 'test_drive';
  } else if (isInBrowseFlow || isInBrowseFlowByState || isInTestDriveFlow) {
    // If we're in browse flow, stay in browse flow for most inputs
    if (msg.includes('budget') || msg.includes('price') || msg.includes('lakh') || msg.includes('cost')) {
      intent = 'browse_cars';
    } else if (msg.includes('type') || msg.includes('suv') || msg.includes('sedan') || msg.includes('hatchback')) {
      intent = 'browse_cars';
    } else if (msg.includes('brand') || msg.includes('hyundai') || msg.includes('maruti') || msg.includes('honda') || msg.includes('toyota')) {
      intent = 'browse_cars';
    } else if (msg.includes('car') || msg.includes('vehicle') || msg.includes('show') || msg.includes('different') || msg.includes('change')) {
      intent = 'browse_cars';
    } else if (msg.includes('what') || msg.includes('how') || msg.includes('help') || msg.includes('don\'t know') || msg.includes('hmm')) {
      intent = 'browse_cars'; // Stay in browse flow for questions
    } else if (msg.includes('weather') || msg.includes('politics') || msg.includes('news') || msg.includes('sports')) {
      // Handle off-topic questions but stay in browse flow
      intent = 'browse_cars';
    } else {
      intent = 'browse_cars'; // Default to browse flow if in browse context
    }
  } else if (isInTestDriveFlow) {
    // If we're in test drive flow, handle test drive related inputs
    if (msg.includes('name') || msg.includes('john') || msg.includes('sarah') || msg.includes('mike') || 
        msg.includes('david') || msg.includes('lisa') || msg.includes('anna') || msg.includes('tom')) {
      intent = 'test_drive';
      entities.name = msg.match(/(john|sarah|mike|david|lisa|anna|tom)/i)?.[1] || 'User';
    } else if (msg.match(/\d{10}/) || msg.includes('phone') || msg.includes('number')) {
      intent = 'test_drive';
      const phoneMatch = msg.match(/\d{10}/);
      if (phoneMatch) entities.phone = phoneMatch[0];
    } else if (msg.includes('license') || msg.includes('dl') || msg.includes('driving')) {
      intent = 'test_drive';
      entities.license = msg.includes('yes') ? 'Yes' : 'No';
    } else if (msg.includes('morning') || msg.includes('afternoon') || msg.includes('evening') || 
               msg.includes('tomorrow') || msg.includes('today') || msg.includes('time')) {
      intent = 'test_drive';
      entities.time = msg;
    } else if (msg.includes('confirm') || msg.includes('yes') || msg.includes('book')) {
      intent = 'test_drive';
    } else {
      intent = 'test_drive'; // Stay in test drive flow
    }
  } else if (msg.includes('car') || msg.includes('vehicle') || msg.includes('buy') || 
             msg.includes('looking') || msg.includes('want') || msg.includes('need') || msg.includes('show') ||
             Object.keys(entities).length > 0) {
    intent = 'browse_cars';
  } else if (msg.includes('contact') || msg.includes('visit') || msg.includes('call')) {
    intent = 'contact_team';
  } else if (msg.includes('about') || msg.includes('company') || msg.includes('who are you') || 
             msg.includes('what are you') || msg.includes('tell me about') || msg.includes('your story') ||
             msg.includes('your company') || msg.includes('sherpa') || msg.includes('hyundai')) {
    intent = 'about_us';
  } else if (msg.includes('hello') || msg.includes('hi') || msg.includes('hey')) {
    intent = 'greeting';
  }
  
  return { intent, entities };
}

function generateFallbackResponse(message, intent, entities) {
  // Ensure message is a string
  const messageStr = typeof message === 'string' ? message : String(message || '');
  const msg = messageStr.toLowerCase();
  
  // Generate contextual responses based on extracted entities and message content
  if (entities.brand && entities.model) {
    return `Perfect! I'd love to show you our amazing ${entities.brand} ${entities.model} cars! 🚗✨`;
  } else if (entities.brand) {
    return `Excellent choice! Let me show you our fantastic ${entities.brand} cars! 🚗💫`;
  } else if (entities.model) {
    return `Great! The ${entities.model} is an amazing car! Let me show you our available options! 🚗🌟`;
  } else if (entities.type) {
    return `Perfect! I have some fantastic ${entities.type} cars waiting for you! 🚗✨`;
  } else if (entities.budget) {
    return `Great! Let's find some amazing cars in your ${entities.budget} budget range! 🚗💫`;
  } else if (entities.fuel) {
    return `Excellent! I have some fantastic ${entities.fuel} cars for you! 🚗🌟`;
  } else if (intent === 'browse_cars') {
    // More contextual responses based on message content and session state
    const sessionState = typeof history === 'object' && !Array.isArray(history) ? history : {};
    const requirements = sessionState.requirements || {};
    
    if (msg.includes('budget') || msg.includes('price') || msg.includes('cost')) {
      if (requirements.budget) {
        return `Your budget is ${requirements.budget}. What type of car are you looking for? 🚗✨`;
      }
      return `Let's find the perfect budget for you! What's your price range? 💰✨`;
    } else if (msg.includes('type') || msg.includes('suv') || msg.includes('sedan')) {
      if (requirements.type) {
        return `You're looking for ${requirements.type} cars. Which brand interests you? 🏭✨`;
      }
      return `Great! What type of car are you looking for? 🚗✨`;
    } else if (msg.includes('brand') || msg.includes('hyundai') || msg.includes('maruti')) {
      if (requirements.brand) {
        return `You're interested in ${requirements.brand} cars. Let me show you the available options! 🚗✨`;
      }
      return `Perfect! Which brand interests you most? 🏭✨`;
    } else if (msg.includes('what') || msg.includes('how') || msg.includes('help')) {
      if (requirements.budget && requirements.type && requirements.brand) {
        return `You're looking for ${requirements.brand} ${requirements.type} cars in ${requirements.budget} range. Let me show you the options! 🚗✨`;
      } else if (requirements.budget && requirements.type) {
        return `You want ${requirements.type} cars in ${requirements.budget} range. Which brand interests you? 🏭✨`;
      } else if (requirements.budget) {
        return `Your budget is ${requirements.budget}. What type of car are you looking for? 🚗✨`;
      }
      return `I'm here to help you find the perfect car! Let's start with your budget. 💰✨`;
    } else if (msg.includes('change') || msg.includes('different')) {
      return `No problem! Let's explore different options. What's your budget? 💰✨`;
    } else if (msg.includes('hmm') || msg.includes('don\'t know')) {
      return `That's okay! Let me help you figure it out. What's your budget range? 💰✨`;
    } else if (msg.includes('weather') || msg.includes('politics') || msg.includes('news')) {
      return `I'm focused on helping you find the perfect car! What's your budget range? 🚗✨`;
    } else {
      return `Exciting! Let's find your perfect car! What's your budget? 🚗✨`;
    }
  } else if (intent === 'car_valuation') {
    return `Perfect! I'd love to help you get an accurate valuation! 💰✨`;
  } else if (intent === 'test_drive') {
    if (entities.name) {
      return `Perfect! Nice to meet you ${entities.name}! What's your phone number for the test drive? 📞✨`;
    } else if (entities.phone) {
      return `Great! Do you have a valid driving license? 🚗✨`;
    } else if (entities.license) {
      return `Excellent! What time would work best for your test drive? ⏰✨`;
    } else if (entities.time) {
      return `Perfect! Let me confirm your test drive details. Ready to book? 🚗✨`;
    } else {
      return `Great! Let's get your test drive details. What's your name? 👤✨`;
    }
  } else if (intent === 'greeting') {
    return `Hello! Welcome to Sherpa Hyundai! 👋✨`;
  } else if (intent === 'contact_team') {
    return `I'd be happy to connect you with our team! 📞✨`;
  } else if (intent === 'about_us') {
    return `I'm AutoSherpa, your friendly assistant from Sherpa Hyundai! 🏢✨ I'm here to help you find the perfect car, get valuations, and book test drives.`;
  } else {
    return `I'm here to help! 😊 What would you like to do today?`;
  }
}

async function extractIntentEntities(message, history = []) {
  try {
    // Handle both array history and session state
    const sessionState = typeof history === 'object' && !Array.isArray(history) ? history : {};
    const historyArray = Array.isArray(history) ? history : [];
    
    // Initialize conversation history tracking if not exists
    if (!sessionState.conversationHistory) {
      sessionState.conversationHistory = [];
    }
    
    // Add current message to conversation history
    const currentMessage = typeof message === 'string' ? message : String(message || '');
    sessionState.conversationHistory.push({
      message: currentMessage,
      timestamp: new Date().toISOString(),
      intent: null // Will be filled after intent extraction
    });
    
    // Keep only last 10 messages to avoid memory issues
    if (sessionState.conversationHistory.length > 10) {
      sessionState.conversationHistory = sessionState.conversationHistory.slice(-10);
    }
    
    // Create a comprehensive prompt for intent and entity extraction with response generation
    const prompt = `You are AutoSherpa, a friendly Hyundai chatbot assistant for Sherpa Hyundai dealership.

CRITICAL TYPO TOLERANCE RULES:
- Handle ALL typos, misspellings, and variations with maximum flexibility
- Extract entities even with partial matches or phonetic similarities
- Be extremely forgiving with spelling variations
- Correct common typos automatically

ENTITY EXTRACTION WITH TYPO TOLERANCE (STANDARDIZED FORMAT):
- brand: Extract from typos like "hyndai"→"Hyundai", "maruthi"→"Maruti", "honda"→"Honda", "toyota"→"Toyota", "tata"→"Tata", "mahindra"→"Mahindra", "kia"→"Kia", "volkswagen"→"Volkswagen", "skoda"→"Skoda", "ford"→"Ford", "chevrolet"→"Chevrolet", "nissan"→"Nissan", "renault"→"Renault"
- model: Extract from typos like "cty"→"City", "swft"→"Swift", "innova"→"Innova", "nexon"→"Nexon", "creta"→"Creta", "verna"→"Verna", "santro"→"Santro", "baleno"→"Baleno", "dzire"→"Dzire", "alto"→"Alto", "polo"→"Polo", "vento"→"Vento", "amaze"→"Amaze", "jazz"→"Jazz", "civic"→"Civic", "accord"→"Accord", "corolla"→"Corolla", "camry"→"Camry", "fortuner"→"Fortuner", "scorpio"→"Scorpio", "thar"→"Thar", "bolero"→"Bolero", "i20"→"i20"
- type: Extract from typos like "s.u.v"→"SUV", "seden"→"Sedan", "hatch"→"Hatchback", "coup"→"Coupe", "convert"→"Convertible", "wagn"→"Wagon", "pick"→"Pickup"
- fuel: Extract from typos like "petrol"→"Petrol", "diesel"→"Diesel", "c.n.g"→"CNG", "electric"→"Electric"
- budget: Extract numbers from typos like "ljsa", "ljs", "ls", "lac", "lakh" → categorize as "Under ₹5L", "₹5-10L", "₹10-15L", "Above ₹15L"

INTENT CLASSIFICATION RULES:
- browse_cars: User wants to see/search/buy cars, vehicles, SUVs, sedans, etc. OR mentions specific budget/price ranges OR mentions any car brand/model/type OR asks about brands ("what brands you have", "which brands", "show me brands", "brand options")
- car_valuation: User wants price estimate, valuation, appraisal, "what's my car worth", "how much is my car", "car value", "I want to sell my car", "sell my car", "get rid of my car", "dispose of my car", "trade in my car"
- test_drive: User mentions test drive, booking test drive, trying cars (BUT route to browse_cars first)
- contact_team: User wants to contact, call, visit, speak to someone
- about_us: User asks about company, services, story, locations, "who are you"
- greeting: Hello, hi, good morning, namaste, etc.
- other: Everything else, off-topic, unclear requests, weather, jokes, personal topics

SPECIAL HANDLING FOR BRAND QUESTIONS:
- Detect if user is asking about brands: "what brands you have", "which brands", "show me brands", "brand options", "what car brands", "available brands"
- Check conversation history for previous brand questions
- If this is a repeated brand question, mark as "repeated_brand_question" in entities

Return strict JSON with these keys (STANDARDIZED FORMAT):
{
  "intent": "browse_cars"|"car_valuation"|"test_drive"|"contact_team"|"about_us"|"greeting"|"other",
  "entities": {
    "brand": "string|null",
    "model": "string|null", 
    "type": "SUV"|"Sedan"|"Hatchback"|"Coupe"|"Convertible"|"Wagon"|"Pickup"|null,
    "budget": "Under ₹5L"|"₹5-10L"|"₹10-15L"|"₹15-20L"|"Above ₹20L"|null,
    "year": "number|null",
    "fuel": "Petrol"|"Diesel"|"CNG"|"Electric"|null,
    "kms": "string|null",
    "owner": "string|null",
    "condition": "string|null",
    "name": "string|null",
    "phone": "string|null",
    "location": "string|null",
    "time": "string|null",
    "reason": "string|null",
    "repeated_brand_question": "boolean|null"
  },
  "confidence": "number between 0.0 and 1.0"
}

User message: "${message}"

${historyArray.length > 0 ? `Previous conversation context: ${JSON.stringify(historyArray.slice(-3))}` : ''}
${sessionState.step ? `Current session step: ${sessionState.step}` : ''}
${sessionState.requirements ? `Current requirements: ${JSON.stringify(sessionState.requirements)}` : ''}
${sessionState.conversationHistory ? `Recent conversation history: ${JSON.stringify(sessionState.conversationHistory.slice(-5))}` : ''}

IMPORTANT: Check if this is a repeated brand question by looking at conversation history. If user previously asked about brands and is asking again, set "repeated_brand_question": true in entities.`;

    const result = await callGemini(message, prompt);
    
    if (result) {
      // Validate and clean the result
      const intent = result.intent || 'other';
      const entities = result.entities || {};
      const confidence = typeof result.confidence === 'number' ? result.confidence : 0.5;
      
      // Update conversation history with detected intent
      if (sessionState.conversationHistory && sessionState.conversationHistory.length > 0) {
        sessionState.conversationHistory[sessionState.conversationHistory.length - 1].intent = intent;
      }
      
      // Generate LLM response based on extracted intent and entities
      const messageStr = typeof message === 'string' ? message : String(message || '');
      const llmMessage = await generateLLMResponse(messageStr, intent, entities);
      
      return {
        intent,
        entities,
        confidence: Math.max(0.0, Math.min(1.0, confidence)),
        message: llmMessage
      };
    }
    
    // Fallback: Extract entities using pattern matching when LLM fails
    const fallbackMessageStr = typeof message === 'string' ? message : String(message || '');
    const fallbackResult = extractEntitiesFallback(fallbackMessageStr, sessionState);
    const fallbackMessage = await generateLLMResponse(fallbackMessageStr, fallbackResult.intent, fallbackResult.entities, sessionState);
    
    return {
      intent: fallbackResult.intent,
      entities: fallbackResult.entities,
      confidence: 0.3,
      message: fallbackMessage
    };
    
  } catch (error) {
    console.error("Error in extractIntentEntities:", error.message);
    
    // Generate LLM response even in error cases
    const sessionState = typeof history === 'object' && !Array.isArray(history) ? history : {};
    const messageStr = typeof message === 'string' ? message : String(message || '');
    const errorResult = extractEntitiesFallback(messageStr, sessionState);
    const errorMessage = await generateLLMResponse(messageStr, errorResult.intent, errorResult.entities, sessionState);
    
    return {
      intent: errorResult.intent,
      entities: errorResult.entities,
      confidence: 0.3,
      message: errorMessage
    };
  }
}

module.exports = {
  extractIntentEntities
};