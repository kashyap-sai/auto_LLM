const { handleCarValuationStep } = require('./getCarValuation');
const { handleContactUsStep } = require('./contactUsFlow');
const { handleAboutUsStep } = require('./aboutUs');
const { handleBrowseUsedCars } = require('./handleBrowseUsedCars');
const { extractBrowseSlots, extractValuationSlots, extractContactSlots, extractAboutSlots } = require('./intentExtractor');
const { getMainMenu } = require('./conversationFlow');

async function mainRouter(session, message, pool) {
  const lowerMsg = message.toLowerCase();
  console.log("🧭 Incoming message:", message);
  console.log("🧠 Current session step:", session.step);
  console.log("🔍 Debug - session.conversationEnded:", session.conversationEnded);
  console.log("🔍 Session object ID:", session._id || 'no_id');
  console.log("🔍 Session keys:", Object.keys(session));

if (session.conversationEnded && (lowerMsg.includes('start') || lowerMsg.includes('begin') || lowerMsg.includes('new') || lowerMsg.includes('restart') || lowerMsg.includes('hi') || lowerMsg.includes('hello'))) {
    delete session.conversationEnded;
    // Clear all session data for fresh start
    session.step = 'main_menu';
    session.carIndex = 0;
    session.filteredCars = [];
    session.selectedCar = null;
    session.budget = null;
    session.type = null;
    session.brand = null;
    session.testDriveDate = null;
    session.testDriveTime = null;
    session.td_name = null;
    session.td_phone = null;
    session.td_license = null;
    session.td_location_mode = null;
    session.td_home_address = null;
    session.td_drop_location = null;
    console.log("🔄 Restarting conversation after end - cleared all session data");
    return getMainMenu();
  }
  // Check for restart keywords that should clear the ended conversation FIRST
  if (session.conversationEnded && (lowerMsg.includes('start') || lowerMsg.includes('begin') || lowerMsg.includes('new') || lowerMsg.includes('restart'))) {
    delete session.conversationEnded;
    session.step = 'main_menu';
    console.log("🔄 Restarting conversation after end");
    return getMainMenu();
  }

  // Check if conversation was ended - don't process further
  if (session.conversationEnded) {
    console.log("🔍 Debug - Conversation ended, not sending any message");
    return null; // Return null to indicate no message should be sent
  }

  // Intent-driven dynamic routing using Gemini
  const intent = session.lastIntent;
  const entities = session.lastEntities || {};
  const confidence = typeof session.lastConfidence === 'number' ? session.lastConfidence : 0;

  // Helper: seed session from extracted entities for each flow
  const seedFromEntities = () => {
    // Browse cars
    if (entities.brand) session.brand = entities.brand;
    if (entities.model) session.model = entities.model;
    if (entities.type) session.type = entities.type;
    if (entities.fuel_type) session.fuel = entities.fuel_type;
    if (typeof entities.budget_min === 'number' || typeof entities.budget_max === 'number') {
      session.budget = {
        min: typeof entities.budget_min === 'number' ? entities.budget_min : undefined,
        max: typeof entities.budget_max === 'number' ? entities.budget_max : undefined
      };
    }

    // Valuation
    if (entities.year) session.year = entities.year;
    if (entities.kms) session.kms = entities.kms;
    if (entities.owner) session.owner = entities.owner;
    if (entities.condition) session.condition = entities.condition;
    if (entities.location) session.location = entities.location;
    if (entities.phone) session.phone = entities.phone;

    // Test drive specifics
    if (entities.test_drive_date) session.testDriveDate = entities.test_drive_date;
    if (entities.test_drive_time) session.testDriveTime = entities.test_drive_time;
  };

  if (intent) {
    const inActiveFlow = !!session.step && (
      session.step.startsWith('browse') ||
      session.step === 'show_more_cars' ||
      session.step === 'show_more_cars_after_images' ||
      session.step === 'car_selected_options' ||
      session.step.startsWith('test_drive') ||
      session.step.startsWith('td_') ||
      session.step.startsWith('valuation') ||
      session.step.startsWith('contact') ||
      session.step.startsWith('about')
    );

    // Only ask for clarification if NOT already in an active flow
    if (confidence < 0.6 && session.step !== 'intent_clarify' && !inActiveFlow) {
      session.step = 'intent_clarify';
      return {
        message: 'Just to confirm—what would you like to do?',
        options: ['🚗 Browse Used Cars', '💰 Get Car Valuation', '📞 Contact Our Team', 'Book a Test Drive']
      };
    }

    // Proceed by intent (or continue current flow) and seed entities
    seedFromEntities();
    switch (intent) {
      case 'browse_cars': {
        session.step = session.step?.startsWith('browse') ? session.step : 'browse_start';
        return handleBrowseUsedCars(session, message, pool);
      }
      case 'car_valuation': {
        session.step = session.step?.startsWith('valuation') ? session.step : 'valuation_start';
        return handleCarValuationStep(session, message);
      }
      case 'test_drive': {
        // Test drive flow is implemented within browse/test drive steps
        if (!session.step || !session.step.startsWith('test_drive')) {
          session.step = 'test_drive_start';
        }
        return handleBrowseUsedCars(session, message, pool);
      }
      case 'contact_team': {
        // Seed contact details if present
        if (entities.name) session.callback_name = entities.name;
        if (entities.phone) session.contact_callback_phone = entities.phone;
        if (entities.reason) session.callback_reason = entities.reason;
        session.step = session.step?.startsWith('contact') ? session.step : 'contact_start';
        return handleContactUsStep(session, message);
      }
      case 'about_us': {
        session.step = session.step?.startsWith('about') ? session.step : 'about_start';
        return handleAboutUsStep(session, message);
      }
      case 'greeting': {
        session.step = 'main_menu';
        return getMainMenu();
      }
      default:
        break;
    }
  }

  // Route based on step or keywords
  if (session.step && (session.step.startsWith('valuation') || 
      ['brand', 'model', 'year', 'fuel', 'kms', 'owner', 'condition', 'name', 'phone', 'location', 'other_brand_input', 'other_model_input'].includes(session.step))) {
    console.log("➡️ Routing to: Car Valuation");
    return handleCarValuationStep(session, message);
  }

  if (session.step && (session.step.startsWith('contact') || 
      ['contact_menu', 'callback_time', 'callback_name', 'contact_callback_phone', 'callback_reason'].includes(session.step))) {
    console.log("➡️ Routing to: Contact Us");
    return handleContactUsStep(session, message);
  }

  if (session.step && (session.step.startsWith('about') || 
      ['about_menu', 'about_selection'].includes(session.step))) {
    console.log("➡️ Routing to: About Us");
    return handleAboutUsStep(session, message);
  }

  if (session.step && (session.step.startsWith('browse') || session.step === 'show_more_cars' || session.step === 'show_more_cars_after_images' || session.step === 'car_selected_options' || session.step.startsWith('test_drive') || session.step.startsWith('td_') || session.step === 'change_criteria_confirm')) {
    console.log("➡️ Routing to: Browse Used Cars (step: " + session.step + ")");
    return handleBrowseUsedCars(session, message, pool);
  }

  // Keyword-based routing fallback
  if (lowerMsg.includes('valuation') || message === "💰 Get Car Valuation") {
    // Prefill valuation fields from message
    try {
      const slots = await extractValuationSlots(message);
      if (slots) {
        if (slots.brand) session.brand = slots.brand;
        if (slots.model) session.model = slots.model;
        if (slots.year) session.year = String(slots.year);
        if (slots.fuel) session.fuel = slots.fuel;
        if (slots.kms) session.kms = slots.kms;
        if (slots.owner) session.owner = slots.owner;
        if (slots.condition) session.condition = slots.condition;
        if (slots.name) session.name = slots.name;
        if (slots.phone) session.phone = slots.phone;
        if (slots.location) session.location = slots.location;
      }
    } catch(_) {}
    session.step = 'valuation_start';
    console.log("💬 Keyword matched: valuation → Routing with prefilled slots");
    return handleCarValuationStep(session, message);
  }

  if (lowerMsg.includes('contact') || message === "📞 Contact Our Team") {
    try {
      const slots = await extractContactSlots(message);
      if (slots) {
        if (slots.action === 'call') { session.step = 'done'; return handleContactUsStep(session, 'Call'); }
        if (slots.action === 'visit') { session.step = 'done'; return handleContactUsStep(session, 'Visit'); }
        if (slots.action === 'callback') {
          session.step = 'callback_time';
          if (slots.time) session.callback_time = slots.time;
          if (slots.name) session.callback_name = slots.name;
          if (slots.phone) session.callback_phone = slots.phone;
          if (slots.reason) session.callback_reason = slots.reason;
          return handleContactUsStep(session, message);
        }
      }
    } catch(_) {}
    session.step = 'contact_start';
    console.log("💬 Keyword matched: contact → Routing to Contact Us");
    return handleContactUsStep(session, message);
  }

  // Explicit option for booking a test drive
  if (lowerMsg.includes('test drive') || message === 'Book a Test Drive') {
    session.step = 'test_drive_start';
    console.log("💬 Keyword matched: test drive → Routing to Test Drive flow");
    return handleBrowseUsedCars(session, message, pool);
  }

  if (lowerMsg.includes('about') || message === "ℹ️ About Us") {
    try {
      const slots = await extractAboutSlots(message);
      if (slots && slots.section && slots.section !== 'unknown') {
        session.step = 'about_selection';
        return handleAboutUsStep(session, slots.section);
      }
    } catch(_) {}
    session.step = 'about_start';
    console.log("💬 Keyword matched: about → Routing to About Us");
    return handleAboutUsStep(session, message);
  }

  if (lowerMsg.includes('browse') || lowerMsg.includes('buy') || lowerMsg.includes('look') || lowerMsg.includes('show') || lowerMsg.includes('find') || lowerMsg.includes('car ' ) || message === "🚗 Browse Used Cars") {
    // New: attempt to extract slots and pre-fill session to skip steps
    try {
      const slots = await extractBrowseSlots(message);
      console.log('🧠 Extracted slots:', slots);
      session.step = 'browse_start';
      if (slots) {
        // Map budget to our buckets for getAvailable* helpers
        if (typeof slots.budgetMin === 'number' || typeof slots.budgetMax === 'number') {
          const min = slots.budgetMin ?? 0;
          const max = slots.budgetMax ?? Infinity;
          if (max <= 500000) session.budget = 'Under ₹5 Lakhs';
          else if (min >= 500000 && max <= 1000000) session.budget = '₹5-10 Lakhs';
          else if (min >= 1000000 && max <= 1500000) session.budget = '₹10-15 Lakhs';
          else if (min >= 1500000 && max <= 2000000) session.budget = '₹15-20 Lakhs';
          else if (min >= 2000000 || max === Infinity) session.budget = 'Above ₹20 Lakhs';
        }
        if (slots.type) {
          const t = slots.type.toLowerCase();
          const mapping = { suv: 'SUV', sedan: 'Sedan', hatchback: 'Hatchback', coupe: 'Coupe', convertible: 'Convertible', wagon: 'Wagon', pickup: 'Pickup' };
          session.type = mapping[t] || null;
        }
        if (slots.brand) {
          session.brand = slots.brand.charAt(0).toUpperCase() + slots.brand.slice(1).toLowerCase();
        }
      }
    } catch (_) {}
    console.log("💬 Intent matched: browse → Routing to Browse Cars with prefilled slots (if any)");
    return handleBrowseUsedCars(session, message, pool);
  }

  // Greet and start main menu if first message
  if (!session.step || ['hi', 'hello', 'hey','hy'].includes(lowerMsg)) {
    session.step = 'main_menu';
    console.log("🔁 Resetting to main menu");
    return getMainMenu();
  }

  // Handle unknown messages by showing main menu
  console.log("⚠️ Unknown message, showing main menu");
  return getMainMenu();
}

// ✅ Correct export
exports.routeMessage = mainRouter;
