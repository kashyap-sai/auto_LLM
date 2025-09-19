const { handleCarValuationStep } = require('./getCarValuation');
const { handleContactUsStep } = require('./contactUsFlow');
const { handleAboutUsStep } = require('./aboutUs');
const { handleBrowseUsedCars } = require('./handleBrowseUsedCars');
const { getMainMenu } = require('./conversationFlow');

async function mainRouter(session, message, pool, llm) {
  const lowerMsg = message.toLowerCase();
  console.log("🧭 Incoming message:", message);

  // -------------------------------
  // Step 1: Detect conversation restart
  // -------------------------------
  if (session.conversationEnded && /(start|begin|new|restart|hi|hello)/i.test(lowerMsg)) {
    delete session.conversationEnded;
    session.step = 'main_menu';
    session.carIndex = 0;
    session.filteredCars = [];
    session.selectedCar = null;
    return getMainMenu();
  }

  if (session.conversationEnded) {
    return null; // no reply if ended
  }

  // -------------------------------
  // Step 2: Use LLM to classify intent
  // -------------------------------
  const llmResp = await llm.generate({
    prompt: `
You are AutoSherpa, a friendly Hyundai chatbot assistant. 
1. Classify the intent of the user's message into one of:
   - browse_cars
   - car_valuation
   - test_drive
   - contact_team
   - about_us
   - greeting
   - other
2. Also, generate a short, friendly, conversational message guiding the user.

Respond ONLY in JSON:
{
  "intent": "one_of_above",
  "confidence": 0-1,
  "message": "friendly guidance text for user"
}

User: "${message}"
    `,
    max_tokens: 100
  });

  let intentData;
  try {
    intentData = JSON.parse(llmResp.text);
  } catch (e) {
    console.error("❌ LLM parse error:", e, llmResp.text);
    intentData = { intent: "other", confidence: 0.3, message: "I’m here to help 😊 What would you like to do today?" };
  }

  session.lastIntent = intentData.intent;
  session.lastConfidence = intentData.confidence;

  // -------------------------------
  // Step 3: Handle low-confidence case → show main menu with variable friendly text
  // -------------------------------
  if (intentData.confidence < 0.6 && !session.step) {
    session.step = 'intent_clarify';
    return {
      message: intentData.message || "I’m here to help 😊 What would you like to do today?",
      options: [
        "🚗 Browse Used Cars",
        "💰 Get Car Valuation",
        "📞 Contact Our Team",
        "ℹ️ About Us"
      ]
    };
  }

  // -------------------------------
  // Step 4: Priority - if already inside a flow, continue it
  // -------------------------------
  if (session.step) {
    if (session.step.startsWith('browse') || session.step === 'show_more_cars' || session.step === 'car_selected_options') {
      return handleBrowseUsedCars(session, message, llm, pool);
    }
    if (session.step.startsWith('test_drive') || session.step.startsWith('td_')) {
      return handleBrowseUsedCars(session, message, llm, pool);
    }
    if (session.step.startsWith('valuation')) {
      return handleCarValuationStep(session, message, llm, pool);
    }
    if (session.step.startsWith('contact')) {
      return handleContactUsStep(session, message);
    }
    if (session.step.startsWith('about')) {
      return handleAboutUsStep(session, message);
    }
  }

  // -------------------------------
  // Step 5: Route based on classified intent
  // -------------------------------
  switch (intentData.intent) {
    case 'browse_cars':
      session.step = 'browse_start';
      return handleBrowseUsedCars(session, message, llm, pool);

    case 'car_valuation':
      session.step = 'valuation_start';
      return handleCarValuationStep(session, message, llm, pool);

    case 'test_drive':
      session.step = 'test_drive_start';
      return handleBrowseUsedCars(session, message, llm, pool);

    case 'contact_team':
      session.step = 'contact_start';
      return handleContactUsStep(session, message);

    case 'about_us':
      session.step = 'about_start';
      return handleAboutUsStep(session, message);

    case 'greeting':
      session.step = 'main_menu';
      return getMainMenu();

    case 'other':
    default:
      return {
        message: intentData.message || "Here’s what I can help you with today:",
        options: [
          "🚗 Browse Used Cars",
          "💰 Get Car Valuation",
          "📞 Contact Our Team",
          "ℹ️ About Us"
        ]
      };
  }
}

// ✅ Export
exports.routeMessage = mainRouter;
