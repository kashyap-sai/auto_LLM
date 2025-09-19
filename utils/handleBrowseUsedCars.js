const { formatRupees, getAvailableTypes, getAvailableBrands, getCarsByFilter } = require('./carData');
const { extractFilters } = require('./extractFilters');
const { getNextAvailableDays, getTimeSlots, getActualDateFromSelection } = require('./timeUtils');
const pool = require('../db');

// ------------------ Helper: Display 3 cars ------------------
async function getCarDisplayChunk(session, pool) {
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
    if (mode.includes('home')) {
      locationText = `📍 Test Drive Location: ${session.td_home_address || 'To be confirmed'}`;
    } else if (mode.includes('showroom')) {
      locationText = "📍 Showroom Address: Sherpa Hyundai Showroom, 123 MG Road, Bangalore\n🅿️ Free parking available";
    }
  }

  let dateDisplay = 'To be confirmed';
  if (session.testDriveDate) dateDisplay = session.testDriveDate;
  if (session.testDriveDateFormatted) dateDisplay = session.testDriveDateFormatted;

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

// ------------------ Test Drive Flow ------------------
async function handleTestDriveFlow(session, userMessage, model, pool) {
  const step = session.step;

  switch (step) {
    case 'test_drive_start':
      session.step = 'test_drive_date';
      return { message: `Let's schedule your ${session.selectedCar} test drive. When would you like to go?`, options: ["Today", "Tomorrow", "Later this Week", "Next Week"] };

    case 'test_drive_date':
      session.testDriveDate = userMessage;
      session.step = 'test_drive_time';
      return { message: "Great! Which time works best for your test drive?", options: getTimeSlots() };

    case 'test_drive_time':
      session.testDriveTime = userMessage;
      session.step = 'td_name';
      return { message: "Perfect! Can I get your name to confirm the booking?" };

    case 'td_name':
      session.td_name = userMessage;
      session.step = 'td_phone';
      return { message: "Thanks! What's your phone number?" };

    case 'td_phone':
      session.td_phone = userMessage;
      session.step = 'td_license';
      return { message: "Do you have a valid driving license?", options: ["Yes", "No"] };

    case 'td_license':
      session.td_license = userMessage;
      session.step = 'td_location_mode';
      return { message: "Where would you like to take the test drive?", options: ["Showroom pickup", "Home pickup"] };

    case 'td_location_mode':
      session.td_location_mode = userMessage;
      if (userMessage.toLowerCase().includes('home')) {
        session.step = 'td_home_address';
        return { message: "Please share your current address for the test drive:" };
      } else {
        session.step = 'test_drive_confirmation';
        return await getTestDriveConfirmation(session);
      }

    case 'td_home_address':
      session.td_home_address = userMessage;
      session.step = 'test_drive_confirmation';
      return await getTestDriveConfirmation(session);

    case 'test_drive_confirmation':
      if (userMessage.toLowerCase().includes('confirm')) {
        // Save booking
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

        } catch (e) {
          console.error("❌ Error saving test drive:", e);
          return { message: "Something went wrong saving your booking. Please try again.", options: ["Retry"] };
        }

        session.step = 'booking_complete';
        return { message: "Your test drive has been confirmed! Would you like to explore more cars?", options: ["Explore More", "End Conversation"] };
      }

      // Fallback LLM if user types free text
      const llmResponse = await model.generate({
        prompt: `
          SYSTEM: You are AutoSherpa, helping users schedule a test drive.
          Session: ${JSON.stringify(session)}
          User message: "${userMessage}"
          Reply conversationally, guide the user to confirm the test drive.
          Show buttons: ["Confirm", "Reject"]
        `,
        max_tokens: 80
      });
      return { message: llmResponse.text, options: ["Confirm", "Reject"] };

    case 'booking_complete':
      if (userMessage === "Explore More") {
        session.step = 'browse_start';
        session.carIndex = 0;
        session.filteredCars = [];
        session.selectedCar = null;
        return { message: "Let's find your next car! What's your budget?", options: ["Under ₹5L", "₹5-10L", "₹10-15L", "₹15-20L", "Above ₹20L"] };
      }
      if (userMessage === "End Conversation") {
        Object.keys(session).forEach(key => delete session[key]);
        session.conversationEnded = true;
        return null;
      }

      return { message: "Please choose:", options: ["Explore More", "End Conversation"] };

    default:
      return { message: "Please continue with your test drive booking.", options: ["Confirm", "Reject"] };
  }
}

// ------------------ Main Flow ------------------
async function handleBrowseUsedCars(session, userMessage, model, pool) {
  const BUDGET_OPTIONS = ["Under ₹5L", "₹5-10L", "₹10-15L", "₹15-20L", "Above ₹20L"];
  session.requirements = session.requirements || { budget: null, type: null, brand: null };
  session.step = session.step || 'browse_start';

  // 1️⃣ Browsing Flow
  if (session.step.startsWith('browse')) {
    if (!userMessage || userMessage.trim().length === 0) {
      session.step = 'browse_budget';
      return { message: "Let's start by selecting your budget for cars 🚗", options: BUDGET_OPTIONS };
    }

    const filters = await extractFilters(model, userMessage);
    if (filters) session.requirements = { ...session.requirements, ...filters };

    const nextReq = !session.requirements.budget ? 'budget' :
                    !session.requirements.type ? 'type' :
                    !session.requirements.brand ? 'brand' : null;

    if (!nextReq) {
      try {
        const cars = await getCarsByFilter(pool, session.requirements.budget, session.requirements.type, session.requirements.brand);
        session.filteredCars = cars;
        session.carIndex = 0;

        if (!cars || cars.length === 0) {
          return { message: `Sorry! Couldn't find matching cars.`, options: ["Change criteria", "Notify me"] };
        }

        session.step = 'show_cars';
        return await getCarDisplayChunk(session, pool);
      } catch (e) {
        console.error('❌ getCarsByFilter failed:', e);
        return { message: 'Something went wrong fetching cars. Try again later.', options: ["Try again", "Change criteria"] };
      }
    }

    // Ask next requirement
    let options = [];
    if (nextReq === 'budget') options = BUDGET_OPTIONS;
    else if (nextReq === 'type') options = ['All Types', ...(await getAvailableTypes(pool, session.requirements.budget)).slice(0, 6)];
    else if (nextReq === 'brand') options = ['Any Brand', ...(await getAvailableBrands(pool, session.requirements.budget, session.requirements.type)).slice(0, 6)];

    const llmResponse = await model.generate({
      prompt: `
        SYSTEM: You are AutoSherpa, a friendly assistant helping users browse used cars.
        User message: "${userMessage}"
        Next requirement: "${nextReq}"
        Known requirements: ${JSON.stringify(session.requirements)}
        Button options: ${JSON.stringify(options)}
        Reply conversationally in 1 sentence, then show the button options.
      `,
      max_tokens: 80
    });

    return { message: llmResponse.text, options };
  }

  // 2️⃣ Show Cars
  if (session.step === 'show_cars') {
    return await getCarDisplayChunk(session, pool);
  }

  // 3️⃣ Car Selected Options
  if (session.step === 'car_selected_options' || session.step.startsWith('test_drive')) {
    return await handleTestDriveFlow(session, userMessage, model, pool);
  }

  // 4️⃣ Default fallback
  return { message: "Let's continue browsing cars.", options: BUDGET_OPTIONS };
}

module.exports = { handleBrowseUsedCars };
