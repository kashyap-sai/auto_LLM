const SLOT_ORDER = [
  "brand", "model", "year", "fuel", "kms", "owner", "condition", "name", "phone", "location"
];

const SLOT_OPTIONS = {
  brand: ["Hyundai", "Maruti", "Tata", "Other brands"],
  fuel: ["Petrol", "Diesel", "CNG", "Electric"],
  kms: ["0–10k", "10–20k", "20–30k", "30–50k", "50k+"],
  owner: ["First", "Second", "Third+"],
  condition: ["Excellent", "Good", "Average", "Poor"],
  year: Array.from({length: 31}, (_, i) => (new Date().getFullYear() - i).toString())
};

// -----------------------------
// LLM-driven handler
// -----------------------------
async function handleCarValuationStep(session, userMessage, llm, pool) {
  session.slots = session.slots || {};

  // -----------------------------
  // Determine next missing slot
  // -----------------------------
  const nextSlot = SLOT_ORDER.find(s => !session.slots[s]);

  // -----------------------------
  // Check if user asks for options
  // -----------------------------
  const showOptionsKeywords = ["options", "choices", "what can i select", "what are my choices"];
  const lowerMsg = userMessage.toLowerCase();
  if (nextSlot && showOptionsKeywords.some(k => lowerMsg.includes(k))) {
    return {
      message: `Here are the available options for ${nextSlot}:`,
      options: SLOT_OPTIONS[nextSlot] || []
    };
  }

  // -----------------------------
  // LLM Prompt
  // -----------------------------
  const SYSTEM_PROMPT = `
You are a virtual assistant for Sherpa Hyundai helping users get car valuations.
- Ask for missing information **one slot at a time**, in order: ${SLOT_ORDER.join(", ")}.
- Show options for the slot if available.
- If the user provides multiple pieces of information, extract all possible slots.
- If the user asks for "options" or "choices", show the available options for the current missing slot.
- Handle off-topic questions politely and redirect back to the current slot.
- Respond ONLY in JSON:
{
  "message": "string",
  "options": ["optional list of options"],
  "slots_filled": { "optional slots updated" }
}
`;

  const llmResponse = await llm.generate({
    prompt: `
System:
${SYSTEM_PROMPT}

User:
${userMessage}

Current slots:
${JSON.stringify(session.slots)}

Next slot to ask: ${nextSlot || "all filled"}

Slot options:
${JSON.stringify(SLOT_OPTIONS)}
`
  });

  // -----------------------------
  // Parse LLM JSON
  // -----------------------------
  let data;
  try {
    data = JSON.parse(llmResponse.text);
  } catch (e) {
    console.error("LLM parsing error:", e, llmResponse.text);
    return { message: "Sorry, I didn't understand. Can you rephrase?" };
  }

  // -----------------------------
  // Update session slots
  // -----------------------------
  if(data.slots_filled) Object.assign(session.slots, data.slots_filled);

  // -----------------------------
  // Local validation for critical slots
  // -----------------------------
  const validations = {
    year: validateYear,
    fuel: validateFuelType,
    condition: validateCondition,
    name: validateName,
    phone: validatePhoneNumber
  };

  for (const slot of Object.keys(validations)) {
    if(session.slots[slot]) {
      const valid = validations[slot](session.slots[slot]);
      if(!valid.isValid) {
        delete session.slots[slot];
        return {
          message: createValidationErrorMessage(slot, valid.suggestions, SLOT_OPTIONS[slot] || []),
          options: SLOT_OPTIONS[slot] || []
        };
      } else {
        session.slots[slot] = valid.matchedOption;
      }
    }
  }

  // -----------------------------
  // Check if all slots filled → finalize
  // -----------------------------
  const allSlotsFilled = SLOT_ORDER.every(s => session.slots[s]);

  if(allSlotsFilled) {
    try {
      if(!pool || typeof pool.query !== "function") throw new Error("Database not available");

      const result = await pool.query(
        `INSERT INTO car_valuations
        (name, phone, location, brand, model, year, fuel, kms, owner, condition, submitted_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
        RETURNING id`,
        SLOT_ORDER.map(s => session.slots[s])
      );

      console.log("✅ Saved car valuation with ID:", result.rows[0]?.id);
    } catch (err) {
      console.error("❌ Database save error:", err);
    }

    return {
      message: `
Perfect ${session.slots.name}! Here's what happens next:

📋 SELLER CONFIRMATION:
👤 Name: ${session.slots.name}
📱 Phone: ${session.slots.phone}
🚗 Car: ${session.slots.year} ${session.slots.brand} ${session.slots.model} ${session.slots.fuel}
📍 Location: ${session.slots.location}

📅 Next Steps:
1. Our executive will call you within 2 hours
2. We'll schedule a physical inspection
3. Final price quote after inspection
4. Instant payment if you accept our offer

📞 Questions? Call: +91-9876543210
Thank you for choosing Sherpa Hyundai! 😊`,
      options: ["Explore", "End Conversation"]
    };
  }

  // -----------------------------
  // Return LLM message for next slot
  // -----------------------------
  return {
    message: data.message,
    options: data.options || SLOT_OPTIONS[nextSlot] || []
  };
}

module.exports = { handleCarValuationStep };
