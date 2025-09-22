const SLOT_ORDER = [
  "brand", "model", "year", "fuel", "kms", "owner", "condition", "name", "phone", "location"
];

const SLOT_OPTIONS = {
  brand: ["Hyundai", "Maruti", "Tata", "Other brands"],
  fuel: ["Petrol", "Diesel", "CNG", "Electric"],
  kms: ["0–10k", "10–20k", "20–30k", "30–50k", "50k+"],
  owner: ["First", "Second", "Third+"],
  condition: ["Excellent", "Good", "Average", "Poor"],
  year: Array.from({ length: 2 }, (_, i) => (2023 - i).toString())
};

// ------------------ Validation functions ------------------
const validators = {
  year: year => {
    const yearNum = parseInt(year);
    if (yearNum === 2023 || yearNum === 2022) return { isValid: true, matchedOption: yearNum.toString() };
    return { isValid: false, suggestions: ["Please enter a valid year: 2023 or 2022"] };
  },
  fuel: fuel => {
    const valid = SLOT_OPTIONS.fuel.find(f => f.toLowerCase() === fuel.toLowerCase());
    return valid ? { isValid: true, matchedOption: valid } : { isValid: false, suggestions: SLOT_OPTIONS.fuel };
  },
  condition: cond => {
    const valid = SLOT_OPTIONS.condition.find(c => c.toLowerCase() === cond.toLowerCase());
    return valid ? { isValid: true, matchedOption: valid } : { isValid: false, suggestions: SLOT_OPTIONS.condition };
  },
  name: name => {
    if (name && name.length >= 2 && name.length <= 50) return { isValid: true, matchedOption: name };
    return { isValid: false, suggestions: ["Please enter a valid name (2-50 characters)"] };
  },
  phone: phone => {
    const phoneRegex = /^[6-9]\d{9}$/;
    return phoneRegex.test(phone) ? { isValid: true, matchedOption: phone } : { isValid: false, suggestions: ["Please enter a valid 10-digit Indian mobile number"] };
  }
};

// ------------------ LLM-Driven Car Valuation Flow ------------------
async function handleCarValuationStep(session, userMessage, llm, pool) {
  session.slots = session.slots || {};
  session.conversationHistory = session.conversationHistory || [];
  
  // Add current message to conversation history
  session.conversationHistory.push({
    role: "user",
    content: userMessage,
    timestamp: new Date().toISOString()
  });

  // Determine next missing slot
  const nextSlot = SLOT_ORDER.find(s => !session.slots[s]);
  const allSlotsFilled = SLOT_ORDER.every(s => session.slots[s]);

  // If all slots are filled, handle completion
  if (allSlotsFilled) {
    return await handleValuationCompletion(session, userMessage, llm, pool);
  }

  // Create comprehensive LLM prompt for car valuation flow
  const SYSTEM_PROMPT = `
You are AutoSherpa, a friendly Hyundai chatbot assistant helping users get car valuations at Sherpa Hyundai dealership.

CAR VALUATION FLOW CONTEXT:
- You're helping users sell their cars and get accurate valuations
- You need to collect information in this order: ${SLOT_ORDER.join(", ")}
- Current progress: ${Object.keys(session.slots).length}/${SLOT_ORDER.length} slots filled
- Next required slot: ${nextSlot || "all filled"}

CONVERSATION HANDLING RULES:
1. ALWAYS be conversational, friendly, and empathetic
2. Handle ANY type of user input gracefully (questions, off-topic, related topics)
3. Extract car information from user messages when possible
4. For off-topic questions: Acknowledge politely and guide back to car valuation
5. For related questions: Answer helpfully while staying focused on valuation
6. Generate UNIQUE, contextual responses based on conversation history
7. Use appropriate emojis and maintain enthusiastic tone

USER INPUT EXAMPLES AND RESPONSES:
- "Hyundai" → Extract brand, ask for model
- "Creta" → Extract model, ask for year
- "2020" → Extract year, ask for fuel
- "What's the weather?" → Off-topic, acknowledge and guide back
- "What's car insurance?" → Related question, answer briefly and guide back
- "I want to sell my 2020 Hyundai Creta" → Extract multiple slots (brand, model, year)
- "hmm" or "lol" → Gibberish, stay friendly and ask for next slot

SLOT COLLECTION STRATEGY:
- Ask for ONE slot at a time in the specified order
- Show available options when asking for slots with predefined choices
- Extract multiple slots if user provides them in one message
- Validate extracted information and ask for clarification if needed
- Be flexible with user responses and interpretations

AVAILABLE OPTIONS:
${JSON.stringify(SLOT_OPTIONS, null, 2)}

RESPONSE FORMAT:
Always respond in JSON:
{
  "message": "unique friendly conversational response based on user's message and context",
  "options": ["button1", "button2", "button3"] or [],
  "slots_filled": {"slot_name": "value"} or {},
  "conversation_type": "on_topic"|"off_topic"|"related_question"|"slot_collection"
}

CONVERSATION HISTORY:
${session.conversationHistory.slice(-5).map(h => `${h.role}: ${h.content}`).join('\n')}

CURRENT SLOTS STATUS:
${JSON.stringify(session.slots, null, 2)}
`;

  let llmResponse;
  try {
    if (llm && typeof llm.generateContent === 'function') {
      const fullPrompt = `${SYSTEM_PROMPT}

USER MESSAGE: "${userMessage}"

Based on the user's message above, generate an appropriate response following the JSON format specified.`;
      
      const result = await llm.generateContent(fullPrompt);
      llmResponse = result.response.text();
    } else {
      // Fallback to basic response if LLM not available
      const fallbackData = generateFallbackResponse(userMessage, session.slots, nextSlot);
      llmResponse = JSON.stringify(fallbackData);
    }
  } catch (error) {
    console.error("LLM generation error:", error);
    llmResponse = JSON.stringify({
      message: `I'd love to help you get your car valuation! What's your car's brand?`,
      options: SLOT_OPTIONS.brand,
      slots_filled: {},
      conversation_type: "slot_collection"
    });
  }

  let data;
  try {
    // Extract JSON from LLM response
    const jsonStart = llmResponse.indexOf('{');
    const jsonEnd = llmResponse.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      data = JSON.parse(llmResponse.slice(jsonStart, jsonEnd + 1));
    } else {
      throw new Error("No JSON found in response");
    }
  } catch (e) {
    console.error("LLM parsing error:", e, llmResponse);
    data = {
      message: `I'd love to help you get your car valuation! What's your car's brand?`,
      options: SLOT_OPTIONS.brand,
      slots_filled: {},
      conversation_type: "slot_collection"
    };
  }

  // Update session slots with extracted information
  if (data.slots_filled) {
    Object.assign(session.slots, data.slots_filled);
  }

  // Validate extracted slots
  for (const [slot, validator] of Object.entries(validators)) {
    if (session.slots[slot]) {
      const valid = validator(session.slots[slot]);
      if (!valid.isValid) {
        delete session.slots[slot];
        return {
          message: `I need a valid ${slot}. ${valid.suggestions.join(', ')}`,
          options: SLOT_OPTIONS[slot] || [],
          conversation_type: "validation_error"
        };
      } else {
        session.slots[slot] = valid.matchedOption;
      }
    }
  }

  // Add assistant response to conversation history
  session.conversationHistory.push({
    role: "assistant",
    content: data.message,
    timestamp: new Date().toISOString(),
    conversation_type: data.conversation_type
  });

  // Keep conversation history manageable (last 20 messages)
  if (session.conversationHistory.length > 20) {
    session.conversationHistory = session.conversationHistory.slice(-20);
  }

  return {
    message: data.message,
    options: data.options || [],
    conversation_type: data.conversation_type
  };
}

// ------------------ Handle Valuation Completion ------------------
async function handleValuationCompletion(session, userMessage, llm, pool) {
  // Create completion prompt
  const COMPLETION_PROMPT = `
You are AutoSherpa completing a car valuation for Sherpa Hyundai dealership.

CAR DETAILS COLLECTED:
${JSON.stringify(session.slots, null, 2)}

CONVERSATION HISTORY:
${session.conversationHistory.slice(-5).map(h => `${h.role}: ${h.content}`).join('\n')}

TASK: Generate a friendly completion message that:
1. Acknowledges the user by name
2. Summarizes the car details collected
3. Explains the next steps in the valuation process
4. Maintains enthusiastic and professional tone
5. Uses appropriate emojis
6. Provides contact information

RESPONSE FORMAT:
{
  "message": "completion message with car details and next steps",
  "options": ["Explore", "End Conversation", "Contact Us"],
  "action": "save_to_database"
}
`;

  let completionResponse;
  try {
    if (llm && typeof llm.generateContent === 'function') {
      const result = await llm.generateContent(`${COMPLETION_PROMPT}\n\nUser: ${userMessage}`);
      completionResponse = result.response.text();
    } else {
      // Fallback completion message
      completionResponse = JSON.stringify({
        message: `Perfect ${session.slots.name}! Here's what happens next:\n\n📋 SELLER CONFIRMATION:\n👤 Name: ${session.slots.name}\n📱 Phone: ${session.slots.phone}\n🚗 Car: ${session.slots.year} ${session.slots.brand} ${session.slots.model} ${session.slots.fuel}\n📍 Location: ${session.slots.location}\n\n📅 Next Steps:\n1. Our executive will call you within 2 hours\n2. We'll schedule a physical inspection\n3. Final price quote after inspection\n4. Instant payment if you accept our offer\n\n📞 Questions? Call: +91-9876543210\nThank you for choosing Sherpa Hyundai! 😊`,
        options: ["Explore", "End Conversation"],
        action: "save_to_database"
      });
    }
  } catch (error) {
    console.error("Completion LLM error:", error);
    completionResponse = JSON.stringify({
      message: `Perfect ${session.slots.name}! Here's what happens next:\n\n📋 SELLER CONFIRMATION:\n👤 Name: ${session.slots.name}\n📱 Phone: ${session.slots.phone}\n🚗 Car: ${session.slots.year} ${session.slots.brand} ${session.slots.model} ${session.slots.fuel}\n📍 Location: ${session.slots.location}\n\n📅 Next Steps:\n1. Our executive will call you within 2 hours\n2. We'll schedule a physical inspection\n3. Final price quote after inspection\n4. Instant payment if you accept our offer\n\n📞 Questions? Call: +91-9876543210\nThank you for choosing Sherpa Hyundai! 😊`,
      options: ["Explore", "End Conversation"],
      action: "save_to_database"
    });
  }

  let completionData;
  try {
    const jsonStart = completionResponse.indexOf('{');
    const jsonEnd = completionResponse.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      completionData = JSON.parse(completionResponse.slice(jsonStart, jsonEnd + 1));
    } else {
      throw new Error("No JSON found in completion response");
    }
  } catch (e) {
    console.error("Completion parsing error:", e);
    completionData = {
      message: `Perfect ${session.slots.name}! Here's what happens next:\n\n📋 SELLER CONFIRMATION:\n👤 Name: ${session.slots.name}\n📱 Phone: ${session.slots.phone}\n🚗 Car: ${session.slots.year} ${session.slots.brand} ${session.slots.model} ${session.slots.fuel}\n📍 Location: ${session.slots.location}\n\n📅 Next Steps:\n1. Our executive will call you within 2 hours\n2. We'll schedule a physical inspection\n3. Final price quote after inspection\n4. Instant payment if you accept our offer\n\n📞 Questions? Call: +91-9876543210\nThank you for choosing Sherpa Hyundai! 😊`,
      options: ["Explore", "End Conversation"],
      action: "save_to_database"
    };
  }

  // Save to database
  if (completionData.action === "save_to_database") {
    try {
      if (pool && typeof pool.query === "function") {
      const result = await pool.query(
        `INSERT INTO car_valuations
        (name, phone, location, brand, model, year, fuel, kms, owner, condition, submitted_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
        RETURNING id`,
        SLOT_ORDER.map(s => session.slots[s])
      );
      console.log("✅ Saved car valuation with ID:", result.rows[0]?.id);
      }
    } catch (err) {
      console.error("❌ Database save error:", err);
    }
  }

  // Add completion to conversation history
  session.conversationHistory.push({
    role: "assistant",
    content: completionData.message,
    timestamp: new Date().toISOString(),
    conversation_type: "completion"
  });

    return {
    message: completionData.message,
    options: completionData.options || ["Explore", "End Conversation"]
  };
}

// ------------------ Fallback Response Generation ------------------
function generateFallbackResponse(userMessage, currentSlots, nextSlot) {
  const msg = userMessage.toLowerCase();
  const slotsFilled = {};
  let message = "";
  let options = [];
  let conversationType = "slot_collection";

  // Extract slots from user message
  if (msg.includes('hyundai')) slotsFilled.brand = 'Hyundai';
  if (msg.includes('maruti')) slotsFilled.brand = 'Maruti';
  if (msg.includes('tata')) slotsFilled.brand = 'Tata';
  
  if (msg.includes('creta')) slotsFilled.model = 'Creta';
  if (msg.includes('verna')) slotsFilled.model = 'Verna';
  if (msg.includes('santro')) slotsFilled.model = 'Santro';
  if (msg.includes('i20')) slotsFilled.model = 'i20';
  
  // Extract year (only 2023 and 2022)
  if (msg.includes('2023')) slotsFilled.year = '2023';
  if (msg.includes('2022')) slotsFilled.year = '2022';
  
  // Extract fuel
  if (msg.includes('petrol')) slotsFilled.fuel = 'Petrol';
  if (msg.includes('diesel')) slotsFilled.fuel = 'Diesel';
  if (msg.includes('cng')) slotsFilled.fuel = 'CNG';
  if (msg.includes('electric')) slotsFilled.fuel = 'Electric';
  
  // Extract kms
  if (msg.includes('30k') || msg.includes('30 k')) slotsFilled.kms = '30–50k';
  if (msg.includes('20k') || msg.includes('20 k')) slotsFilled.kms = '20–30k';
  if (msg.includes('10k') || msg.includes('10 k')) slotsFilled.kms = '10–20k';
  
  // Extract owner
  if (msg.includes('first')) slotsFilled.owner = 'First';
  if (msg.includes('second')) slotsFilled.owner = 'Second';
  if (msg.includes('third')) slotsFilled.owner = 'Third+';
  
  // Extract condition
  if (msg.includes('excellent')) slotsFilled.condition = 'Excellent';
  if (msg.includes('good')) slotsFilled.condition = 'Good';
  if (msg.includes('average')) slotsFilled.condition = 'Average';
  if (msg.includes('poor')) slotsFilled.condition = 'Poor';
  
  // Extract name
  const nameMatch = msg.match(/\b(john|jane|mike|sarah|david|lisa|anna|tom)\b/i);
  if (nameMatch) slotsFilled.name = nameMatch[1];
  
  // Extract phone
  const phoneMatch = msg.match(/\b[6-9]\d{9}\b/);
  if (phoneMatch) slotsFilled.phone = phoneMatch[0];
  
  // Extract location
  if (msg.includes('mumbai')) slotsFilled.location = 'Mumbai';
  if (msg.includes('delhi')) slotsFilled.location = 'Delhi';
  if (msg.includes('bangalore')) slotsFilled.location = 'Bangalore';
  if (msg.includes('chennai')) slotsFilled.location = 'Chennai';

  // Handle off-topic questions
  if (msg.includes('weather') || msg.includes('politics') || msg.includes('news') || msg.includes('sports')) {
    conversationType = "off_topic";
    message = "I'd be happy to chat about that, but let's focus on getting your car valuation! What's your car's brand? 🚗✨";
    options = SLOT_OPTIONS.brand;
  }
  // Handle related questions
  else if (msg.includes('insurance') || msg.includes('service') || msg.includes('maintenance') || msg.includes('resale')) {
    conversationType = "related_question";
    message = "Great question! While I can't provide detailed advice on that, let's get your car valuation first. What's your car's brand? 🚗✨";
    options = SLOT_OPTIONS.brand;
  }
  // Handle gibberish
  else if (msg.includes('hmm') || msg.includes('lol') || msg.includes('ahhh') || msg.length < 3) {
    conversationType = "gibberish";
    message = "No worries! Let's get your car valuation started. What's your car's brand? 🚗✨";
    options = SLOT_OPTIONS.brand;
  }
  // Handle slot collection
  else {
    // Determine what to ask next
    const nextSlotToAsk = SLOT_ORDER.find(s => !currentSlots[s] && !slotsFilled[s]);
    
    if (Object.keys(slotsFilled).length > 0) {
      // Some slots were extracted
      message = `Great! I've got some of your car details. What's your car's ${nextSlotToAsk}? 🚗✨`;
    } else {
      // No slots extracted, ask for next slot
      message = `Let's get your car valuation started. What's your car's ${nextSlotToAsk}? 🚗✨`;
    }
    
    options = SLOT_OPTIONS[nextSlotToAsk] || [];
  }

  return {
    message,
    options,
    slots_filled: slotsFilled,
    conversation_type: conversationType
  };
}

module.exports = { handleCarValuationStep };