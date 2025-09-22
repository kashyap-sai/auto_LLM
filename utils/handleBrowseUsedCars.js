
const { formatRupees, getAvailableTypes, getAvailableBrands, getCarsByFilter } = require('./carData');
const { extractFilters } = require('./extractFilters');
const { getNextAvailableDays, getTimeSlots, getActualDateFromSelection } = require('./timeUtils');
const pool = require('../db');

// ------------------ Helper: Display 3 cars ------------------
async function getCarDisplayChunk(session) {
  const cars = session.filteredCars || [];
  const startIndex = session.carIndex || 0;
  const endIndex = Math.min(startIndex + 3, cars.length);
  const visibleCars = cars.slice(startIndex, endIndex);

  const carText = visibleCars
    .map((car, idx) => `${idx + 1}. ${car.brand} ${car.model} ${car.variant} - ₹${car.price}L`)
    .join('\n');

  const carButtons = visibleCars.map(car =>
    `book_${car.brand}_${car.model}_${car.variant}`.replace(/\s+/g, '_')
  );

  const moreButton = endIndex < cars.length ? ['Browse More Cars'] : [];
  return { message: `${carText}\n\nSelect a car or explore more:`, options: [...carButtons, ...moreButton] };
}

// ------------------ Helper: Test Drive Confirmation ------------------
async function getTestDriveConfirmation(session) {
  let locationText = '📍 Test Drive Location: To be confirmed';
  if (session.td_location_mode) {
    const mode = session.td_location_mode.toLowerCase();
    if (mode.includes('home')) locationText = `📍 Test Drive Location: ${session.td_home_address || 'To be confirmed'}`;
    else if (mode.includes('showroom')) locationText = "📍 Showroom Address: Sherpa Hyundai Showroom, 123 MG Road, Bangalore\n🅿️ Free parking available";
  }

  let dateDisplay = session.testDriveDateFormatted || session.testDriveDate || 'To be confirmed';

  return {
    message: `Perfect! Here's your test drive confirmation:

📋 TEST DRIVE CONFIRMED:
👤 Name: ${session.td_name || 'Not provided'}
📱 Phone: ${session.td_phone || 'Not provided'}
🚗 Car: ${session.selectedCar || 'Not selected'}
📅 Date: ${dateDisplay}
⏰ Time: ${session.testDriveTime || 'Not selected'}
${locationText}

What to bring:
✅ Valid driving license
✅ Photo ID
📞 Need help? Call us: +91-9876543210

Please confirm your booking:`,
    options: ['Confirm', 'Reject']
  };
}

// ------------------ LLM-Driven Test Drive Flow ------------------
async function handleTestDriveFlow(session, userMessage, model) {
  const step = session.step;

  const llmResponse = await model.generate({
    prompt: `
You are AutoSherpa, helping users schedule a test drive.

CURRENT CONTEXT:
- User Message: "${userMessage}"
- Current Step: ${step}
- Selected Car: ${session.selectedCar || 'Not selected'}
- Test Drive Date: ${session.testDriveDate || 'Not selected'}
- Test Drive Time: ${session.testDriveTime || 'Not selected'}
- Name: ${session.td_name || 'Not provided'}
- Phone: ${session.td_phone || 'Not provided'}
- License: ${session.td_license || 'Not provided'}
- Location Mode: ${session.td_location_mode || 'Not selected'}
- Home Address: ${session.td_home_address || 'Not provided'}

TEST DRIVE FLOW STEPS:
1. test_drive_start → Ask for date
2. test_drive_date → Ask for time
3. test_drive_time → Ask for name
4. td_name → Ask for phone (10 digits only)
5. td_phone → Ask for license (Yes/No)
6. td_license → Ask for location (Showroom/Home)
7. td_location_mode → Ask for address if home, or show confirmation
8. td_home_address → Show confirmation
9. test_drive_confirmation → Confirm booking
10. booking_complete → Explore more or end

CONVERSATION HANDLING:
1. Handle ANY user input gracefully (off-topic, frustration, questions, etc.)
2. Extract relevant information if present
3. Be conversational and understanding
4. Guide user through the test drive process
5. Always provide appropriate button options

RESPONSE FORMAT:
{
  "message": "friendly conversational response",
  "options": ["button1", "button2"],
  "next_step": "step_name",
  "extracted_info": {"field": "value"}
}
`,
    max_tokens: 150
  });

  try {
    const responseData = JSON.parse(llmResponse.text);

    // Update session info
    if (responseData.extracted_info) Object.assign(session, responseData.extracted_info);
    if (responseData.next_step) session.step = responseData.next_step;

    // Handle database booking
    if (responseData.next_step === 'test_drive_confirmation' || step === 'test_drive_confirmation') {
      if (userMessage.toLowerCase().includes('confirm')) {
        try {
          let testDriveDateTime = getActualDateFromSelection(session.testDriveDate);
          if (session.testDriveTime) {
            const time = session.testDriveTime.toLowerCase();
            if (time.includes('morning')) testDriveDateTime.setHours(10, 0, 0, 0);
            else if (time.includes('afternoon')) testDriveDateTime.setHours(13, 0, 0, 0);
            else if (time.includes('evening')) testDriveDateTime.setHours(16, 0, 0, 0);
          }

          await pool.query(`
            INSERT INTO test_drives (user_id, car, datetime, name, phone, has_dl, address, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
          `, [
            session.userId || 'unknown',
            session.selectedCar,
            testDriveDateTime,
            session.td_name || 'Not provided',
            session.td_phone || 'Not provided',
            session.td_license.toLowerCase() === 'yes',
            session.td_home_address || null
          ]);

          session.step = 'booking_complete';
          return { message: "Your test drive has been confirmed! Would you like to explore more cars?", options: ["Explore More", "End Conversation"] };

        } catch (e) {
          console.error("❌ Error saving test drive:", e);
          const errorResponse = await model.generate({
            prompt: `You are AutoSherpa. There was an error saving the test drive booking. Generate a friendly response. Respond in JSON: {"message": "friendly text", "options": ["Retry"]}`,
            max_tokens: 50
          });
          const errorData = JSON.parse(errorResponse.text);
          return { message: errorData.message, options: errorData.options };
        }
      }
    }

    // Booking completion handling
    if (step === 'booking_complete') {
      if (userMessage === "Explore More") {
        session.step = 'browse_start';
        session.carIndex = 0;
        session.filteredCars = [];
        session.selectedCar = null;
        session.requirements = { budget: null, type: null, brand: null };
        return { message: "Let's find your next car! What's your budget?", options: ["Under ₹5L", "₹5-10L", "₹10-15L", "₹15-20L", "Above ₹20L"] };
      }
      if (userMessage === "End Conversation") {
        Object.keys(session).forEach(key => delete session[key]);
        session.conversationEnded = true;
        return null;
      }
    }

    return { message: responseData.message, options: responseData.options || ["Confirm", "Reject"] };
  } catch (e) {
    return { message: llmResponse.text, options: ["Confirm", "Reject"] };
  }
}

// ------------------ LLM-Driven Browse Cars Flow ------------------
async function handleBrowseUsedCars(session, userMessage, model) {
  const BUDGET_OPTIONS = ["Under ₹5L", "₹5-10L", "₹10-15L", "₹15-20L", "Above ₹20L"];
  
  // Initialize requirements only if not already set (preserve extracted requirements)
  if (!session.requirements) {
    session.requirements = { budget: null, type: null, brand: null };
  }
  session.step = session.step || 'browse_start';
  
  console.log("🔍 Browse Cars - Initial requirements:", JSON.stringify(session.requirements, null, 2));

  // 1️⃣ Handle user input - extract info from ANY user message OR button selection
  if (userMessage) {
    // Check if it's a button selection (exact match with options)
    const budgetOptions = ["Under ₹5L", "₹5-10L", "₹10-15L", "₹15-20L", "Above ₹20L"];
    const typeOptions = ["All Types", "Hatchback", "MUV", "SUV", "Sedan"];
    const brandOptions = ["Any Brand", "Hyundai", "Maruti", "Tata", "Honda", "Toyota", "Mahindra", "Kia"];
    
    // Handle special commands
    if (userMessage.toLowerCase().includes('change') || userMessage.toLowerCase().includes('modify') || userMessage.toLowerCase().includes('different')) {
      // User wants to change something - ask what they want to change
      const currentReqs = [];
      if (session.requirements.budget) currentReqs.push(`Budget: ${session.requirements.budget}`);
      if (session.requirements.type) currentReqs.push(`Type: ${session.requirements.type}`);
      if (session.requirements.brand) currentReqs.push(`Brand: ${session.requirements.brand}`);
      
      return {
        message: `What would you like to change? Current: ${currentReqs.join(', ')}`,
        options: ["Change Budget", "Change Type", "Change Brand", "Start Over"]
      };
    }
    
    if (userMessage === "Change Budget") {
      return {
        message: "Please select your budget:",
        options: budgetOptions
      };
    } else if (userMessage === "Change Type") {
      return {
        message: "Please select car type:",
        options: typeOptions
      };
    } else if (userMessage === "Change Brand") {
      return {
        message: "Please select brand:",
        options: brandOptions
      };
    } else if (userMessage === "Start Over") {
      session.requirements = { budget: null, type: null, brand: null };
      return {
        message: "Let's start fresh! What's your budget?",
        options: budgetOptions
      };
    } else if (budgetOptions.includes(userMessage)) {
      session.requirements.budget = userMessage;
      console.log("🔍 Browse Cars - Budget selected:", userMessage);
    } else if (typeOptions.includes(userMessage)) {
      session.requirements.type = userMessage === "All Types" ? null : userMessage;
      console.log("🔍 Browse Cars - Type selected:", userMessage);
    } else if (brandOptions.includes(userMessage)) {
      session.requirements.brand = userMessage === "Any Brand" ? null : userMessage;
      console.log("🔍 Browse Cars - Brand selected:", userMessage);
    } else if (model) {
      // Try to extract from natural language
      try {
        const extracted = await extractFilters(model, userMessage);
        if (extracted && Object.keys(extracted).length > 0) {
          // Only merge non-null values to avoid overwriting existing requirements
          const validExtracted = {};
          Object.keys(extracted).forEach(key => {
            if (extracted[key] !== null && extracted[key] !== undefined) {
              validExtracted[key] = extracted[key];
            }
          });
          
          if (Object.keys(validExtracted).length > 0) {
            // Smart merging: preserve existing values unless user explicitly wants to change them
            const mergedRequirements = { ...session.requirements };
            
            // Only update if the new value is different and meaningful
            if (validExtracted.budget && validExtracted.budget !== session.requirements.budget) {
              mergedRequirements.budget = validExtracted.budget;
              console.log(`🔄 Updated budget: ${session.requirements.budget} → ${validExtracted.budget}`);
            }
            if (validExtracted.type && validExtracted.type !== session.requirements.type) {
              mergedRequirements.type = validExtracted.type;
              console.log(`🔄 Updated type: ${session.requirements.type} → ${validExtracted.type}`);
            }
            if (validExtracted.brand && validExtracted.brand !== session.requirements.brand) {
              mergedRequirements.brand = validExtracted.brand;
              console.log(`🔄 Updated brand: ${session.requirements.brand} → ${validExtracted.brand}`);
            }
            
            session.requirements = mergedRequirements;
            console.log("🔍 Browse Cars - Extracted from text:", JSON.stringify(validExtracted, null, 2));
            console.log("🔍 Browse Cars - Merged requirements:", JSON.stringify(session.requirements, null, 2));
          }
        }
      } catch (e) {
        console.log("⚠️ Filter extraction failed, continuing without update");
      }
    }
    
    console.log("🔍 Browse Cars - Updated requirements:", JSON.stringify(session.requirements, null, 2));
  }

  // 2️⃣ Determine next missing requirement (STANDARDIZED FORMAT)
  const hasBudget = !!session.requirements.budget;
  const budgetToUse = session.requirements.budget;
  const nextReq = !hasBudget ? 'budget' :
                  !session.requirements.type ? 'type' :
                  !session.requirements.brand ? 'brand' : null;
  
  console.log("🔍 Browse Cars - Requirement check:");
  console.log("  - hasBudget:", hasBudget, "(budget:", session.requirements.budget, ")");
  console.log("  - hasType:", !!session.requirements.type);
  console.log("  - hasBrand:", !!session.requirements.brand);
  console.log("  - nextReq:", nextReq);

  // 3️⃣ If all requirements collected, show filtered cars
  if (!nextReq) {
    try {
      const cars = await getCarsByFilter(pool, budgetToUse, session.requirements.type, session.requirements.brand);
      session.filteredCars = cars;
      session.carIndex = 0;
      session.step = 'show_cars';

      if (!cars || cars.length === 0) {
        return { message: "No cars found matching your criteria. Would you like to change your preferences?", options: ["Change criteria", "Notify me"] };
      }

      return await getCarDisplayChunk(session);
    } catch (e) {
      console.error('Error fetching cars:', e);
      return { message: "Oops! Something went wrong fetching cars. Try again?", options: ["Try again", "Change criteria"] };
    }
  }

  // 4️⃣ Prompt user for next missing requirement
  let options = [];
  if (nextReq === 'budget') options = BUDGET_OPTIONS;
  else if (nextReq === 'type') options = ['All Types', ...(await getAvailableTypes(pool, budgetToUse)).slice(0, 6)];
  else if (nextReq === 'brand') options = ['Any Brand', ...(await getAvailableBrands(pool, budgetToUse, session.requirements.type)).slice(0, 6)];

  // 5️⃣ LLM-friendly prompt with existing requirements
  const existingInfo = [];
  if (hasBudget) existingInfo.push(`Budget: ${budgetToUse}`);
  if (session.requirements.type) existingInfo.push(`Type: ${session.requirements.type}`);
  if (session.requirements.brand) existingInfo.push(`Brand: ${session.requirements.brand}`);

  if (model) {
    try {
      const llmResponse = await model.generateContent(`
You are AutoSherpa, assisting the user to browse cars.

CURRENT CONTEXT:
- User Message: "${userMessage}"
- Next Requirement Needed: ${nextReq}
- Collected Info: ${JSON.stringify(session.requirements)}

GUIDELINES:
1. Generate ONLY ONE SENTENCE - keep it short and punchy!
2. Ask for the next missing requirement in a friendly, engaging way
3. Use humor and personality - be conversational!
4. Extract any info present in the user message
5. Response must be EXACT JSON format:
{ "message": "Your ONE sentence message here", "options": ["button1","button2"], "extracted_info": {"budget":"", "type":"", "brand":""} }

EXAMPLES (ONE SENTENCE ONLY):
- For budget: "What's your dream budget range? 💰✨"
- For type: "What type of car gets your heart racing? 🚗💫"
- For brand: "Which brand speaks to you? 🏭✨"

CRITICAL: Generate ONLY ONE SHORT SENTENCE based on the user's input!
        `);

      const responseData = JSON.parse(llmResponse.response.text());
      
      // Merge extracted info
      if (responseData.extracted_info) {
        session.requirements = { ...session.requirements, ...responseData.extracted_info };
      }

      return { 
        message: responseData.message, 
        options: responseData.options || options 
      };
    } catch (e) {
      console.warn('LLM JSON parse failed, fallback to default options.');
    }
  }
  
  // Fallback response when no model or LLM fails
  const fallbackMessages = {
    budget: "What's your dream budget range? 💰✨",
    type: "What type of car gets your heart racing? 🚗💫", 
    brand: "Which brand speaks to you? 🏭✨"
  };
  
  return {
    message: fallbackMessages[nextReq] || `Let's find your perfect ${nextReq}! 🚗✨`,
    options
  };
}

module.exports = { handleBrowseUsedCars };

