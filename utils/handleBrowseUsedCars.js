
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
  
  session.requirements = session.requirements || { budget: null, type: null, brand: null };
  session.step = session.step || 'browse_start';

  // 1️⃣ Pre-extract info from first user message if available
  if (!session.requirements.preFilled && userMessage && model) {
    try {
      const extracted = await extractFilters(model, userMessage); // should return { budget?, type?, brand? }
      session.requirements = { ...session.requirements, ...extracted, preFilled: true };
    } catch (e) {
      console.log("⚠️ Filter extraction failed, continuing without pre-fill");
    }
  }

  // 2️⃣ Determine next missing requirement
  const nextReq = !session.requirements.budget ? 'budget' :
                  !session.requirements.type ? 'type' :
                  !session.requirements.brand ? 'brand' : null;

  // 3️⃣ If all requirements collected, show filtered cars
  if (!nextReq) {
    try {
      const cars = await getCarsByFilter(pool, session.requirements.budget, session.requirements.type, session.requirements.brand);
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
  else if (nextReq === 'type') options = ['All Types', ...(await getAvailableTypes(pool, session.requirements.budget)).slice(0, 6)];
  else if (nextReq === 'brand') options = ['Any Brand', ...(await getAvailableBrands(pool, session.requirements.budget, session.requirements.type)).slice(0, 6)];

  // 5️⃣ LLM-friendly prompt with existing requirements
  const existingInfo = [];
  if (session.requirements.budget) existingInfo.push(`Budget: ${session.requirements.budget}`);
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
1. Acknowledge existing info if any.
2. Ask for the next missing requirement in a friendly way.
3. Offer options to proceed or start fresh if user wants.
4. Extract any info present in the user message.
5. Response must be JSON:
{ "message": "text", "options": ["button1","button2"], "extracted_info": {"budget":"", "type":"", "brand":""} }
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
  return {
    message: `Let's provide your ${nextReq}.`,
    options
  };
}

module.exports = { handleBrowseUsedCars };

