
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
    
    // Check for repeated brand question
    const isRepeatedBrandQuestion = session.entities && session.entities.repeated_brand_question === true;
    if (isRepeatedBrandQuestion) {
      return {
        message: "I see you're asking about brands again! 😊 Let me give you some quick options to explore:",
        options: [
          "🚗 Browse All Brands",
          "💰 Set Budget First", 
          "🔍 Filter by Type",
          "📞 Talk to Expert",
          "ℹ️ Learn About Us"
        ]
      };
    }
    
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
    } else if (userMessage === "🚗 Browse All Brands") {
      return {
        message: "Here are all the brands we have available:",
        options: brandOptions
      };
    } else if (userMessage === "💰 Set Budget First") {
      return {
        message: "Great! Let's start with your budget range:",
        options: budgetOptions
      };
    } else if (userMessage === "🔍 Filter by Type") {
      return {
        message: "What type of car are you looking for?",
        options: typeOptions
      };
    } else if (userMessage === "📞 Talk to Expert") {
      session.step = 'contact_expert';
      return {
        message: "I'll connect you with our car expert! They can help you find the perfect car. What's your name?",
        options: ["Skip Name", "Go Back"]
      };
    } else if (userMessage === "ℹ️ Learn About Us") {
      session.step = 'about_us';
      return {
        message: "Welcome to Sherpa Hyundai! We're your trusted partner for quality used cars. What would you like to know?",
        options: ["Our Story", "Our Services", "Contact Info", "Go Back"]
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
    } else if (userMessage === "Go Back") {
      // Reset to browse start
      session.step = 'browse_start';
      return {
        message: "Let's continue browsing cars! What's your budget?",
        options: budgetOptions
      };
    } else if (userMessage === "Skip Name") {
      return {
        message: "No problem! Our expert will call you shortly. What's your phone number?",
        options: ["Skip Phone", "Go Back"]
      };
    } else if (userMessage === "Skip Phone") {
      return {
        message: "Perfect! Our expert will reach out to you soon. Is there anything else I can help you with?",
        options: ["Browse Cars", "Car Valuation", "End Conversation"]
      };
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
            session.requirements = { ...session.requirements, ...validExtracted };
            console.log("🔍 Browse Cars - Extracted from text:", JSON.stringify(validExtracted, null, 2));
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
        if (model) {
          try {
            const noCarsResponse = await model.generateContent(`
User searched for cars with criteria: ${JSON.stringify(session.requirements)}
No cars were found matching their criteria.

Generate a helpful one-sentence response and suggest alternatives.

Return JSON: {"message": "Your response here", "options": ["Change criteria", "Notify me", "Browse all cars"]}
            `);
            
            const responseText = noCarsResponse.response.text();
            const jsonStart = responseText.indexOf('{');
            const jsonEnd = responseText.lastIndexOf('}') + 1;
            
            if (jsonStart !== -1 && jsonEnd > jsonStart) {
              const jsonStr = responseText.substring(jsonStart, jsonEnd);
              const responseData = JSON.parse(jsonStr);
              return { message: responseData.message, options: responseData.options || ["Change criteria", "Notify me"] };
            }
          } catch (e) {
            console.warn('LLM failed for no cars response');
          }
        }
        return { message: "No cars found matching your criteria. Would you like to change your preferences?", options: ["Change criteria", "Notify me"] };
      }

      return await getCarDisplayChunk(session);
    } catch (e) {
      console.error('Error fetching cars:', e);
      if (model) {
        try {
          const errorResponse = await model.generateContent(`
An error occurred while fetching cars for user with criteria: ${JSON.stringify(session.requirements)}

Generate a helpful one-sentence response acknowledging the error and offering solutions.

Return JSON: {"message": "Your response here", "options": ["Try again", "Change criteria", "Contact support"]}
          `);
          
          const responseText = errorResponse.response.text();
          const jsonStart = responseText.indexOf('{');
          const jsonEnd = responseText.lastIndexOf('}') + 1;
          
          if (jsonStart !== -1 && jsonEnd > jsonStart) {
            const jsonStr = responseText.substring(jsonStart, jsonEnd);
            const responseData = JSON.parse(jsonStr);
            return { message: responseData.message, options: responseData.options || ["Try again", "Change criteria"] };
          }
        } catch (llmError) {
          console.warn('LLM failed for error response');
        }
      }
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
You are AutoSherpa, a professional Hyundai dealership assistant helping users browse cars.

CURRENT CONTEXT:
- User Message: "${userMessage}"
- Next Requirement Needed: ${nextReq}
- Collected Info: ${JSON.stringify(session.requirements)}
- Available Options: ${JSON.stringify(options)}

PROFESSIONAL GUIDELINES:
1. Generate ONLY ONE SENTENCE - keep it concise and professional
2. Ask for the next missing requirement in a helpful, professional manner
3. Maintain a knowledgeable and trustworthy tone
4. Extract any info present in the user message
5. Avoid repetitive phrases and vary your language
6. Use emojis sparingly (maximum 1 per response)
7. Response must be EXACT JSON format:
{ "message": "Your ONE sentence message here", "options": ["button1","button2"], "extracted_info": {"budget":"", "type":"", "brand":""} }

PROFESSIONAL EXAMPLES (ONE SENTENCE ONLY):
- For budget: "What's your preferred budget range? 💰"
- For type: "What type of vehicle interests you? 🚗"
- For brand: "Which brand would you like to explore? 🏭"

SPECIAL CASES:
- If user says "I don't know" or "not sure" about budget: "No worries! Let me show you our budget ranges to help you decide 💰"
- If user seems confused: "Let me guide you through our selection process step by step 🚗"

CRITICAL: Generate ONLY ONE SHORT PROFESSIONAL SENTENCE based on the user's input!
        `);

      const responseText = llmResponse.response.text();
      console.log("🔍 LLM Raw Response:", responseText);
      
      // Extract JSON from response
      const jsonStart = responseText.indexOf('{');
      const jsonEnd = responseText.lastIndexOf('}') + 1;
      
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        const jsonStr = responseText.substring(jsonStart, jsonEnd);
        console.log("🔍 Extracted JSON:", jsonStr);
        
        const responseData = JSON.parse(jsonStr);
      
      // Merge extracted info
      if (responseData.extracted_info) {
        session.requirements = { ...session.requirements, ...responseData.extracted_info };
      }

      return { 
        message: responseData.message, 
        options: responseData.options || options 
      };
      } else {
        console.warn('🔍 No JSON found in LLM response, retrying...');
        
        // Retry with simpler prompt
        const retryResponse = await model.generateContent(`
Generate a one-sentence response for asking about ${nextReq} based on user message: "${userMessage}"

Return ONLY this JSON format:
{"message": "Your response here", "options": ${JSON.stringify(options)}}
        `);
        
        const retryText = retryResponse.response.text();
        const retryJsonStart = retryText.indexOf('{');
        const retryJsonEnd = retryText.lastIndexOf('}') + 1;
        
        if (retryJsonStart !== -1 && retryJsonEnd > retryJsonStart) {
          const retryJsonStr = retryText.substring(retryJsonStart, retryJsonEnd);
          const retryData = JSON.parse(retryJsonStr);
          return { 
            message: retryData.message, 
            options: retryData.options || options 
          };
        }
      }
    } catch (e) {
      console.warn('🔍 LLM completely failed:', e.message);
      
      // Last resort - use LLM for simple response
      try {
        const simpleResponse = await model.generateContent(`
User said: "${userMessage}"
Ask them about ${nextReq} in one sentence.

Just return the message text, no JSON.
        `);
        
        return { 
          message: simpleResponse.response.text().trim(), 
          options: options 
        };
      } catch (finalError) {
        console.error('🔍 Final LLM attempt failed:', finalError.message);
      }
    }
  }
  
  // If we reach here, LLM is not available - this should not happen in production
  console.error('🚨 CRITICAL: LLM not available for browse cars flow!');
  return {
    message: "I'm having trouble processing your request. Please try again later.",
    options: ["🚗 Browse Cars", "💰 Car Valuation", "📞 Contact Team", "ℹ️ About Us"]
  };
}

module.exports = { handleBrowseUsedCars };

