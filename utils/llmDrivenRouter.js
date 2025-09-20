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
  if (intentData.entities) {
    sessionState.requirements = { ...sessionState.requirements, ...intentData.entities };
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

    default:
      return await handleFallback(userMessage, sessionState);
  }
}

// -------------------- Helper: Enter flow --------------------
async function enterFlow(flowType, flowHandler, userMessage, sessionState) {
  let model = null;
  
  // Create LLM instance only if API key is available
  if (process.env.GEMINI_API_KEY) {
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    } catch (e) {
      console.log("⚠️ Failed to create LLM instance, using fallback mode");
    }
  } else {
    console.log("⚠️ GEMINI_API_KEY not set, using fallback mode");
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
        console.log("⚠️ LLM greeting failed, using fallback");
        sessionState.initialMessage = `Let's get started with ${flowType}.`;
        sessionState.initialOptions = [];
      }
    } else {
      sessionState.initialMessage = `Let's get started with ${flowType}.`;
      sessionState.initialOptions = [];
    }
  }

  // 2️⃣ Pass user message + session (with pre-filled entities) to flow handler
  // Flow handlers should handle "step" & "requirements" internally
  return await flowHandler(sessionState, userMessage, model);
}

// -------------------- Helper: Fallback handler --------------------
async function handleFallback(userMessage, sessionState) {
  let message = "I'm here to help! 😊 What would you like to do today?";
  let options = ["🚗 Browse Cars", "💰 Car Valuation", "📞 Contact Team", "ℹ️ About Us"];

  if (process.env.GEMINI_API_KEY) {
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      
      const systemPrompt = getSystemPrompt("fallback");
      const llmResponse = await model.generateContent(
        `${systemPrompt}\nUser said: "${userMessage}"\nGenerate JSON: {"message": "...", "options": [...]}`
      );

      const parsed = JSON.parse(llmResponse.response.text());
      message = parsed.message || message;
      options = parsed.options || options;
    } catch (e) {
      console.warn("⚠️ Could not parse fallback LLM JSON, using default.");
    }
  } else {
    console.log("⚠️ GEMINI_API_KEY not set, using default fallback response");
  }

  return { message, options };
}

module.exports = { llmDrivenRouter };
