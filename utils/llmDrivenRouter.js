// llmDrivenRouter.js
const { handleCarValuationStep } = require("./getCarValuation");
const { handleContactUsStep } = require("./contactUsFlow");
const { handleAboutUsStep } = require("./aboutUs");
const { handleBrowseUsedCars } = require("./handleBrowseUsedCars");
const { extractIntentEntities } = require("./extractIntentEntities");
const { getSystemPrompt } = require("./llmSystemPrompts");
const { GoogleGenerativeAI } = require('@google/generative-ai');

// -------------------- Central LLM Router --------------------
async function llmDrivenRouter(userMessage, sessionState) {
  // 1️⃣ Extract intent + entities from user message
  const intentData = await extractIntentEntities(userMessage, sessionState);
  
  // 2️⃣ Merge extracted entities into session state (pre-fill for flows)
  sessionState.requirements = sessionState.requirements || {};
  
  // Merge entities from current message AND previous session entities
  const entitiesToMerge = {
    ...sessionState.previousEntities,  // Previous entities from session
    ...intentData.entities             // Current message entities
  };
  
  if (Object.keys(entitiesToMerge).length > 0) {
    sessionState.requirements = { ...sessionState.requirements, ...entitiesToMerge };
  }

  // 3️⃣ Handle flow based on detected intent
  switch (intentData.intent) {
    case "browse_cars":
      return await enterFlow("browse_cars", handleBrowseUsedCars, userMessage, sessionState);

    case "car_valuation":
      return await enterFlow("car_valuation", handleCarValuationStep, userMessage, sessionState);

    case "contact_team":
      return await enterFlow("contact_team", handleContactUsStep, userMessage, sessionState);

    case "about_us":
      return await enterFlow("about_us", handleAboutUsStep, userMessage, sessionState);

    case "greeting":
      return await handleFallback(userMessage, sessionState);

    default:
      return await handleFallback(userMessage, sessionState);
  }
}

// -------------------- Helper: Enter flow --------------------
async function enterFlow(flowType, flowHandler, userMessage, sessionState) {
  let model = null;
  
  // Create LLM instance only if API key is available
  if ('AIzaSyCWGLV6ZOEVXGmXvptVL65Z9d1ownwvTfo') {
    try {
      const genAI = new GoogleGenerativeAI('AIzaSyCWGLV6ZOEVXGmXvptVL65Z9d1ownwvTfo');
      model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    } catch (e) {
      console.log("⚠️ Failed to create LLM instance, using fallback mode");
    }
  }

  // If flow not started yet, send system-prompt LLM greeting
  if (!sessionState.step) {
    if (model) {
      try {
        const systemPrompt = getSystemPrompt(flowType);
        const llmResponse = await model.generateContent(
          `${systemPrompt}\nUser said: "${userMessage}"\nGenerate a friendly first message for this flow in JSON: {"message": "...", "options": [...]}`
        );

        const parsed = JSON.parse(llmResponse.response.text());
        sessionState.initialMessage = parsed.message || `Let's get started with ${flowType}.`;
        sessionState.initialOptions = parsed.options || [];
      } catch (e) {
        sessionState.initialMessage = `Let's get started with ${flowType}.`;
        sessionState.initialOptions = [];
      }
    } else {
      sessionState.initialMessage = `Let's get started with ${flowType}.`;
      sessionState.initialOptions = [];
    }
  }

  // 2️⃣ Pass user message + session (with pre-filled entities) to flow handler
  try {
    const result = await flowHandler(sessionState, userMessage, model);
    return result;
  } catch (error) {
    console.error(`❌ Error in flow handler ${flowType}:`, error);
    return { message: "I apologize, but I encountered an error. Please try again.", options: ["🚗 Browse Cars", "💰 Car Valuation", "📞 Contact Team", "ℹ️ About Us"] };
  }
}

// -------------------- Helper: Fallback handler --------------------
async function handleFallback(userMessage, sessionState) {
  let message = "I'm here to help! 😊 What would you like to do today?";
  let options = ["🚗 Browse Cars", "💰 Car Valuation", "📞 Contact Team", "ℹ️ About Us"];

  if ('AIzaSyCWGLV6ZOEVXGmXvptVL65Z9d1ownwvTfo') {
    try {
      const genAI = new GoogleGenerativeAI('AIzaSyCWGLV6ZOEVXGmXvptVL65Z9d1ownwvTfo');
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      
      const systemPrompt = getSystemPrompt("fallback");
      const llmResponse = await model.generateContent(
        `${systemPrompt}

User said: "${userMessage}"

BE PROFESSIONAL AND HELPFUL! Generate ONLY ONE SENTENCE responses:

EXAMPLES:
- For gibberish "asdfgh" → "I'm here to help you find the perfect car. What can I assist you with? 🚗"
- For off-topic "weather" → "I specialize in helping with car needs. How can I assist you today? 🚗"
- For greeting "hello" → "Hello! Welcome to Sherpa Hyundai. How can I help you? 🚗"
- For unclear requests → "I'm here to help with your car needs. What would you like to do? 🚗"

CRITICAL: Generate ONLY ONE SHORT PROFESSIONAL SENTENCE in this EXACT JSON format:
{
  "message": "Your ONE sentence response here",
  "options": ["🚗 Browse Cars", "💰 Car Valuation", "📞 Contact Team", "ℹ️ About Us"]
}

Keep it professional, concise, and redirect to car services!`
      );

      const responseText = llmResponse.response.text();
      
      // Extract JSON from response
      const jsonStart = responseText.indexOf('{');
      const jsonEnd = responseText.lastIndexOf('}') + 1;
      
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        const jsonStr = responseText.substring(jsonStart, jsonEnd);
        const parsed = JSON.parse(jsonStr);
        message = parsed.message || message;
        options = parsed.options || options;
      }
    } catch (e) {
      console.warn("⚠️ Could not parse fallback LLM JSON, using default.");
    }
  }

  return { message, options };
}

module.exports = { routeMessage: llmDrivenRouter };
