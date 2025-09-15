const { formatRupees, getAvailableTypes, getAvailableBrands, getCarsByFilter , getCarImagesByRegistration} = require('./carData');
const { extractBrowseSlots } = require('./intentExtractor');
const { getNextAvailableDays, getTimeSlots, getActualDateFromSelection, getActualDateFromDaySelection } = require('./timeUtils');
const { validateBudget, validateCarType, validateBrand, createValidationErrorMessage } = require('./inputValidation');
const fs = require('fs');
const path = require('path');

// Import database connection
const pool = require('../db');

// Helper function to construct image URL using the new naming convention
// Only returns URL if image exists in database
async function constructImageUrl(registrationNumber, sequenceNumber, baseUrl = null) {
  try {
    const pool = require('../db');
    
    // Check if this specific image exists in the database
    const res = await pool.query(`
      SELECT ci.image_path
      FROM car_images ci
      JOIN cars c ON ci.car_id = c.id
      WHERE c.registration_number = $1 AND ci.image_type = $2 
      LIMIT 1
    `, [registrationNumber, ['front', 'back', 'side', 'interior'][sequenceNumber - 1]]);
    
    if (res.rows.length === 0) {
      console.log(`📸 No image found for ${registrationNumber} sequence ${sequenceNumber}`);
      return null;
    }
    
    const base ='http://27.111.72.50:3000';
    const imagePath = res.rows[0].image_path;
    
    // Return Cloudinary URL if it's already a full URL, otherwise construct local URL
    if (imagePath.startsWith('http')) {
      return imagePath;
    } else {
      return `${base}/${imagePath}`;
    }
    
  } catch (error) {
    console.error('Error constructing image URL:', error);
    return null;
  }
}

// Helper function to check if an image URL is publicly accessible
function isPubliclyAccessible(baseUrl) {
  return baseUrl && !baseUrl.includes('localhost') && !baseUrl.includes('127.0.0.1');
}

async function handleBrowseUsedCars(session, userMessage) {
  console.log("📩 Entered handleBrowseUsedCars");
  
  const step = session.step || 'browse_start';
  console.log("🧠 Current step:", step);
  console.log("📝 User input:", userMessage);
  console.log("🔍 Session object:", JSON.stringify(session, null, 2));

  // Budget options constant
  const BUDGET_OPTIONS = [
    "Under ₹5 Lakhs",
    "₹5-10 Lakhs",
    "₹10-15 Lakhs",
    "₹15-20 Lakhs",
    "Above ₹20 Lakhs"
  ];

  switch (step) {
    case 'browse_start':
      console.log("🔄 Step matched: browse_start");
      console.log("📝 User message in browse_start:", userMessage);
      
      // If brand/type/budget pre-filled, skip steps accordingly
      if (!session.budget) {
        session.step = 'browse_budget';
        return {
          message: "Great! We'll help you find cars. First, what's your budget range?",
          options: BUDGET_OPTIONS
        };
      }
      if (!session.type) {
        session.step = 'browse_type';
        const types = await getAvailableTypes(pool, session.budget);
        return {
          message: `Noted your budget (${session.budget}). What type of car do you prefer?`,
          options: ['all Type', ...types]
        };
      }
      if (!session.brand) {
        session.step = 'browse_brand';
        const brands = await getAvailableBrands(pool, session.budget, session.type);
        return {
          message: `Got it. Any preferred brand?`,
          options: ['all Brand', ...brands]
        };
      }
      // If all provided, jump to results
      session.step = 'show_cars';
      const carsPrefilled = await getCarsByFilter(pool, session.budget, session.type, session.brand);
      session.filteredCars = carsPrefilled;
      session.carIndex = 0;
      if (carsPrefilled.length === 0) {
        return { message: `We don't have cars matching your criteria right now.`, options: ["Change criteria"] };
      }
      return await getCarDisplayChunk(session, pool);

    case 'browse_budget':
      console.log("🔄 Step matched: browse_budget");
      console.log("💰 Validating budget:", userMessage);
      
      // New: allow users to type brand/type sentences here; capture and skip
      try {
        const slots = await extractBrowseSlots(userMessage);
        if (slots) {
          // If a brand mentioned, store it
          if (slots.brand && !session.brand) {
            const capBrand = slots.brand.charAt(0).toUpperCase() + slots.brand.slice(1).toLowerCase();
            session.brand = capBrand;
            console.log("📝 Captured brand during budget step:", session.brand);
          }
          // If a type mentioned, store it (map to title case)
          if (slots.type && !session.type) {
            const mapping = { suv: 'SUV', sedan: 'Sedan', hatchback: 'Hatchback', coupe: 'Coupe', convertible: 'Convertible', wagon: 'Wagon', pickup: 'Pickup', muv: 'MUV' };
            const t = slots.type.toLowerCase();
            session.type = mapping[t] || (t.charAt(0).toUpperCase() + t.slice(1));
            console.log("📝 Captured type during budget step:", session.type);
          }
          // If a budget range was expressed in free text, convert to bucket and proceed
          if (typeof slots.budgetMin === 'number' || typeof slots.budgetMax === 'number') {
            const min = slots.budgetMin ?? 0;
            const max = slots.budgetMax ?? Infinity;
            if (max <= 500000) session.budget = 'Under ₹5 Lakhs';
            else if (min >= 500000 && max <= 1000000) session.budget = '₹5-10 Lakhs';
            else if (min >= 1000000 && max <= 1500000) session.budget = '₹10-15 Lakhs';
            else if (min >= 1500000 && max <= 2000000) session.budget = '₹15-20 Lakhs';
            else if (min >= 2000000 || max === Infinity) session.budget = 'Above ₹20 Lakhs';
            if (session.budget) {
              console.log("📝 Budget inferred during budget step:", session.budget);
              // proceed like a valid budget selection
              const budgetValidation = { isValid: true, matchedOption: session.budget };
              console.log("✅ Valid budget selected:", budgetValidation.matchedOption);
              session.budget = budgetValidation.matchedOption;
              session.step = 'browse_type';
              console.log("📝 Updated session step to:", session.step);
              console.log("💰 Updated session budget to:", session.budget);
              const types = await getAvailableTypes(pool, session.budget);
              return {
                message: `Perfect! ${budgetValidation.matchedOption} gives you excellent options. What type of car do you prefer?`,
                options: ['all Type', ...types]
              };
            }
          }
          // If only brand/type captured and no budget yet, ask budget without error
          if ((slots.brand || slots.type) && !session.budget) {
            return {
              message: `Noted${session.brand ? ' brand ' + session.brand : ''}${session.type ? ' and type ' + session.type : ''}. What's your budget range?`,
              options: [
                "Under ₹5 Lakhs",
                "₹5-10 Lakhs",
                "₹10-15 Lakhs",
                "₹15-20 Lakhs",
                "Above ₹20 Lakhs"
              ]
            };
          }
        }
      } catch (e) {
        console.log('ℹ️ Slot extraction skipped/failed in budget step:', e?.message);
      }

      const budgetValidation = validateBudget(userMessage);
      if (!budgetValidation.isValid) {
        const BUDGET_OPTIONS = [
          "Under ₹5 Lakhs",
          "₹5-10 Lakhs",
          "₹10-15 Lakhs",
          "₹15-20 Lakhs",
          "Above ₹20 Lakhs"
        ];
        
        return {
          message: createValidationErrorMessage("budget range", budgetValidation.suggestions, BUDGET_OPTIONS),
          options: BUDGET_OPTIONS
        };
      }
      
      console.log("✅ Valid budget selected:", budgetValidation.matchedOption);
      session.budget = budgetValidation.matchedOption;
      session.step = 'browse_type';
      console.log("📝 Updated session step to:", session.step);
      console.log("💰 Updated session budget to:", session.budget);
      
      const types = await getAvailableTypes(pool, session.budget);
      return {
        message: `Perfect! ${budgetValidation.matchedOption} gives you excellent options. What type of car do you prefer?`,
        options: ['all Type', ...types]
      };

    case 'browse_type':
      console.log("🔄 Step matched: browse_type");
      console.log("🚗 Validating car type:", userMessage);
      
      // Allow users to mention brand/type here in free text
      try {
        const slots = await extractBrowseSlots(userMessage);
        if (slots) {
          // Capture brand if provided at the wrong step
          if (slots.brand && !session.brand) {
            const capBrand = slots.brand.charAt(0).toUpperCase() + slots.brand.slice(1).toLowerCase();
            session.brand = capBrand;
            console.log("📝 Captured brand during type step:", session.brand);
          }
          // If a valid type was expressed, prefer it
          if (slots.type) {
            const mapping = { suv: 'SUV', sedan: 'Sedan', hatchback: 'Hatchback', coupe: 'Coupe', convertible: 'Convertible', wagon: 'Wagon', pickup: 'Pickup', muv: 'MUV' };
            const t = slots.type.toLowerCase();
            const normalizedType = mapping[t] || (t.charAt(0).toUpperCase() + t.slice(1));
            userMessage = normalizedType; // fall through to normal validation
          } else if (slots.brand && !slots.type) {
            // Only brand provided, ask for type again (no error)
            const types = await getAvailableTypes(pool, session.budget);
            return {
              message: `Noted your brand ${session.brand}. What type of car do you prefer?`,
              options: ['all Type', ...types]
            };
          }
        }
      } catch (e) {
        console.log('ℹ️ Slot extraction skipped/failed in type step:', e?.message);
      }

      const typeValidation = validateCarType(userMessage);
      if (!typeValidation.isValid) {
        const types = await getAvailableTypes(pool, session.budget);
        const TYPE_OPTIONS = ['all Type', ...types];
        
        return {
          message: createValidationErrorMessage("car type", typeValidation.suggestions, TYPE_OPTIONS),
          options: TYPE_OPTIONS
        };
      }
      
      console.log("✅ Valid car type selected:", typeValidation.matchedOption);
      session.type = typeValidation.matchedOption === 'all Type' ? 'all' : typeValidation.matchedOption;
      session.step = 'browse_brand';
      
      const brands = await getAvailableBrands(pool, session.budget, session.type);
      return {
        message: `Excellent choice! Which brand do you prefer?`,
        options: ['all Brand', ...brands]
      };

    case 'browse_brand':
      console.log("🔄 Step matched: browse_brand");
      console.log("🏷️ Validating brand:", userMessage);
      
      // Get available brands for validation
      const availableBrands = await getAvailableBrands(pool, session.budget, session.type);
      const brandValidation = validateBrand(userMessage, availableBrands);
      
      if (!brandValidation.isValid) {
        const BRAND_OPTIONS = ['all Brand', ...availableBrands];
        
        return {
          message: createValidationErrorMessage("brand", brandValidation.suggestions, BRAND_OPTIONS),
          options: BRAND_OPTIONS
        };
      }
      
      console.log("✅ Valid brand selected:", brandValidation.matchedOption);
      session.brand = brandValidation.matchedOption === 'all Brand' ? 'all' : brandValidation.matchedOption;
      session.step = 'show_cars';
      
      const cars = await getCarsByFilter(pool, session.budget, session.type, session.brand);
      session.filteredCars = cars;
      session.carIndex = 0;
      
      if (cars.length === 0) {
        return {
          message: `Sorry, no cars found matching your criteria. Let's try different options.`,
          options: ["Change criteria"]
        };
      }
      
      return await getCarDisplayChunk(session, pool);

    case 'show_more_cars':
      console.log("🔄 Step matched: show_more_cars");
      
      // Handle SELECT button responses with unique id first (format: book_Brand_Model_Variant)
      if (userMessage.startsWith("book_")) {
        const carId = userMessage;
        const cars = session.filteredCars || [];
        
        // Find the car by ID
        const selectedCar = cars.find(car => {
          const carIdFromCar = `book_${car.brand}_${car.model}_${car.variant}`.replace(/\s+/g, '_');
          return carIdFromCar === carId;
        });
        
        if (selectedCar) {
          session.selectedCar = `${selectedCar.brand} ${selectedCar.model} ${selectedCar.variant}`;
          session.step = 'car_selected_options';
          return {
            message: `Great choice! You've selected ${session.selectedCar}. What would you like to do next?`,
            options: ["Book Test Drive", "Change My Criteria"]
          };
        }
      }

      // Fallback: if platform only returns the generic title "SELECT" and exactly one car is visible,
      // assume the visible car is the intended selection
      if (userMessage === "SELECT") {
        const cars = session.filteredCars || [];
        const startIndex = session.carIndex || 0;
        const endIndex = Math.min(startIndex + 3, cars.length);
        const visible = cars.slice(startIndex, endIndex);
        if (visible.length === 1) {
          const onlyCar = visible[0];
          session.selectedCar = `${onlyCar.brand} ${onlyCar.model} ${onlyCar.variant}`;
          session.step = 'car_selected_options';
          return {
            message: `Great choice! You've selected ${session.selectedCar}. What would you like to do next?`,
            options: ["Book Test Drive", "Change My Criteria"]
          };
        }
      }
      
      // Handle "Browse More Cars" button
      if (userMessage === "Browse More Cars") {
        session.carIndex += 3;
        const cars = session.filteredCars || [];
        
        if (session.carIndex >= cars.length) {
          return {
            message: "No more cars available. Would you like to change your criteria?",
            options: ["Change criteria"]
          };
        }
        
        return await getCarDisplayChunk(session, pool);
      }
      
      // Handle "Change criteria" selection
      if (userMessage === "Change criteria" || userMessage === "Change My Criteria") {
        session.step = 'browse_budget';
        session.carIndex = 0; // Reset car index
        session.filteredCars = []; // Clear filtered cars
        session.selectedCar = null; // Clear selected car
        return {
          message: "No problem! Let's find you a different car. What's your budget range?",
          options: BUDGET_OPTIONS
        };
      }
      
      // If it's a car selection (legacy support)
      session.selectedCar = userMessage;
      session.step = 'test_drive_date';
      return {
        message: `Excellent! Let's schedule your ${userMessage} test drive. When would you prefer?`,
        options: ["Today", "Tomorrow", "Later this Week", "Next Week"]
      };

    case 'car_selected_options':
      console.log("🔄 Step matched: car_selected_options");
      
      if (userMessage === "Book Test Drive") {
        session.step = 'test_drive_date';
        return {
          message: `Excellent! Let's schedule your ${session.selectedCar} test drive. When would you prefer?`,
          options: ["Today", "Tomorrow", "Later this Week", "Next Week"]
        };
      }
      
      if (userMessage === "Change My Criteria") {
        session.step = 'browse_start';
        session.carIndex = 0; // Reset car index
        session.filteredCars = []; // Clear filtered cars
        session.selectedCar = null; // Clear selected car
        return {
          message: "No problem! Let's find you a different car. What's your budget range?",
          options: BUDGET_OPTIONS
        };
      }

    case 'test_drive_date':
      console.log("🔄 Step matched: test_drive_date");
      session.testDriveDate = userMessage;
      
      if (["Today", "Tomorrow"].includes(userMessage)) {
        // Store the actual date for these options
        const actualDate = getActualDateFromSelection(userMessage);
        if (actualDate) {
          session.testDriveActualDate = actualDate;
          session.testDriveDateFormatted = actualDate.toLocaleDateString('en-IN', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });
        }
        
        session.step = 'test_drive_time';
        return {
          message: "Perfect! Which time works better for you?",
          options: getTimeSlots()
        };
      } else {
        session.step = 'test_drive_day';
        return {
          message: "Which day works best for you?",
          options: getNextAvailableDays(userMessage)
        };
      }

    case 'test_drive_day':
      console.log("🔄 Step matched: test_drive_day");
      session.testDriveDay = userMessage;
      
      // Get the actual date from the day selection
      const actualDateFromDay = getActualDateFromDaySelection(userMessage, session.testDriveDate);
      if (actualDateFromDay) {
        session.testDriveActualDate = actualDateFromDay;
        session.testDriveDateFormatted = actualDateFromDay.toLocaleDateString('en-IN', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });
      }
      
      session.step = 'test_drive_time';
      return {
        message: "Perfect! What time works best?",
        options: getTimeSlots()
      };

    case 'test_drive_time':
      console.log("🔄 Step matched: test_drive_time");
      session.testDriveTime = userMessage;
      session.step = 'td_name';
      return { message: "Great! I need some details to confirm your booking:\n\n1. Your Name:" };

    case 'td_name':
      console.log("🔄 Step matched: td_name");
      session.td_name = userMessage;
      session.step = 'td_phone';
      return { message: "2. Your Phone Number:" };

    case 'td_phone':
      console.log("🔄 Step matched: td_phone");
      session.td_phone = userMessage;
      session.step = 'td_license';
      return {
        message: "3. Do you have a valid driving license?",
        options: ["Yes", "No"]
      };

    case 'td_license':
      console.log("🔄 Step matched: td_license");
      session.td_license = userMessage;
      session.step = 'td_location_mode';
      return {
        message: "Thank you! Where would you like to take the test drive?",
        options: ["Showroom pickup", "Home pickup"]
      };

    case 'td_location_mode':
      console.log("🔄 Step matched: td_location_mode");
      console.log("🔍 Debug - userMessage:", userMessage);
      session.td_location_mode = userMessage;
      console.log("🔍 Debug - session.td_location_mode set to:", session.td_location_mode);
      if (userMessage.includes("Home pickup")) {
        session.step = 'td_home_address';
        return { message: "Please share your current address for the test drive:" };
      } else {
        session.step = 'test_drive_confirmation';
        return getTestDriveConfirmation(session);
      }

    case 'td_home_address':
      console.log("🔄 Step matched: td_home_address");
      session.td_home_address = userMessage;
      session.step = 'test_drive_confirmation';
      return getTestDriveConfirmation(session);

    case 'td_drop_location':
      console.log("🔄 Step matched: td_drop_location");
      session.td_drop_location = userMessage;
      session.step = 'test_drive_confirmation';
      return getTestDriveConfirmation(session);

    case 'test_drive_confirmation':
      console.log("🔄 Step matched: test_drive_confirmation");
      
      if (userMessage === "Confirm") {
        // Save test drive details to database
        try {
          // Use the actual date if available, otherwise use current date
          let testDriveDateTime = new Date();
          if (session.testDriveActualDate) {
            testDriveDateTime = session.testDriveActualDate;
            // Set the time based on user selection
            if (session.testDriveTime) {
              if (session.testDriveTime.includes("Morning")) {
                testDriveDateTime.setHours(10, 0, 0, 0);
              } else if (session.testDriveTime.includes("Afternoon")) {
                testDriveDateTime.setHours(13, 0, 0, 0);
              } else if (session.testDriveTime.includes("Evening")) {
                testDriveDateTime.setHours(16, 0, 0, 0);
              }
            }
          }
          
          console.log("📅 Saving test drive with date:", testDriveDateTime);
          
          await pool.query(`
            INSERT INTO test_drives 
            (user_id, car, datetime, name, phone, has_dl, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
          `, [
            session.userId || 'unknown', // You might need to pass userId in session
            session.selectedCar || 'Not selected',
            testDriveDateTime,
            session.td_name || 'Not provided',
            session.td_phone || 'Not provided',
            session.td_license ? true : false // Convert license info to boolean
          ]);
          console.log("✅ Test drive details saved to database");
        } catch (error) {
          console.error("❌ Error saving test drive details:", error);
        }
        
        session.step = 'booking_complete';
        return {
          message: "Thank you! Your test drive has been confirmed. We'll contact you shortly to finalize the details.",
          options: ["Explore More", "End Conversation"]
        };
      }
      
      if (userMessage === "Reject") {
        session.step = 'browse_start';
        session.carIndex = 0;
        session.filteredCars = [];
        session.selectedCar = null;
        return {
          message: "No problem! Let's find you a different car. What's your budget range?",
          options: BUDGET_OPTIONS
        };
      }
      
      // If user sends all other message, show confirmation again
      return getTestDriveConfirmation(session);

    case 'booking_complete':
      console.log("🔄 Step matched: booking_complete");
      
      if (userMessage === "Explore More") {
        session.step = 'browse_start';
        session.carIndex = 0;
        session.filteredCars = [];
        session.selectedCar = null;
        return {
          message: "Welcome! Let's find your perfect car. What's your budget range?",
          options: BUDGET_OPTIONS
        };
      }
      
      if (userMessage === "End Conversation") {
        // Set a flag to prevent greeting message from showing again
        session.conversationEnded = true;
        // Clear other session data but keep the flag
        const conversationEnded = true;
        Object.keys(session).forEach(key => {
          delete session[key];
        });
        session.conversationEnded = conversationEnded;
        return null; // Return null to indicate no message should be sent
      }
      
      return {
        message: "Please select an option:",
        options: ["Explore More", "End Conversation"]
      };

    case 'change_criteria_confirm':
      console.log("🔄 Step matched: change_criteria_confirm");
      if (userMessage.toLowerCase().includes("yes") || userMessage.toLowerCase().includes("proceed")) {
        session.step = 'browse_budget';
        return await handleBrowseUsedCars(session, "start over");
      } else {
        return { message: "Okay, keeping your current selection intact." };
      }

    default:
      console.log("❌ Step not recognized, restarting...");
      return { message: "Something went wrong. Let's start again.", options: ["🏁 Start Again"] };
  }
}

async function getCarDisplayChunk(session, pool) {
  const cars = session.filteredCars || [];
  
  if (cars.length === 0) {
    return { message: "No more cars to display.", options: ["Change criteria"] };
  }

  // Show up to 3 cars at a time
  const startIndex = session.carIndex;
  const endIndex = Math.min(startIndex + 3, cars.length);
  const carsToShow = cars.slice(startIndex, endIndex);

  console.log(`📊 Processing ${carsToShow.length} cars (${startIndex + 1}-${endIndex} of ${cars.length})`);

  const messages = [];
  
  for (let i = 0; i < carsToShow.length; i++) {
    const car = carsToShow[i];
    
    // Get car images by registration number for the new naming convention
    let imagesByRegistration = [];
    try {
      imagesByRegistration = await getCarImagesByRegistration(pool, car.registration_number);
      console.log(`📸 Retrieved ${imagesByRegistration.length} images by registration for ${car.registration_number}`);
    } catch (error) {
      console.error(`❌ Error fetching images by registration for ${car.registration_number}:`, error);
    }
    
    // Use images by registration if available
    const finalCarImages = imagesByRegistration;

    
    const caption =
      `🚗 ${car.brand} ${car.model} ${car.variant}\n` +
      `📅 Year: ${car.year}\n` +
      `⛽ Fuel: ${car.fuel_type}\n` +
      `💰 Price: ${formatRupees(car.price)}`;
    
    if (finalCarImages && finalCarImages.length > 0) {
      // Validate that we have valid image data
      const validImages = finalCarImages.filter(img => img && img.path && typeof img.path === 'string');
      
      if (validImages.length === 0) {
        console.log(`⚠️ No valid images found for car ${car.id}, falling back to text-only`);
        // Fall back to text-only message
        const enhancedCaption = caption + '\n\n📸 Images: Not available at the moment 1';
        messages.push({
          type: 'text',
          text: { body: enhancedCaption }
        });
      } else {
        // Add image message with first available image
        const firstImage = validImages[0];
        
        // Use the new naming convention helper function
        let imageUrl = null;
        if (firstImage.sequence && car.registration_number) {
          // Use the new naming convention: registrationNumber_1.jpg
          imageUrl = await constructImageUrl(car.registration_number, firstImage.sequence);
          console.log(`📸 Using new naming convention for image: ${imageUrl}`);
        } else {
          // Fall back to the old path-based method
          if (firstImage.path.startsWith('uploads/')) {
            // imageUrl = `${process.env.NGROK_URL || process.env.PUBLIC_URL || 'http://27.111.72.50:3000'}/${firstImage.path}`;
            imageUrl = 'http://27.111.72.50:3000'
          } else {
            // imageUrl = `${process.env.NGROK_URL || process.env.PUBLIC_URL || 'http://27.111.72.50:3000'}/uploads/${firstImage.path}`;
            imageUrl = 'http://27.111.72.50:3000'
          }
          console.log(`📸 Using fallback path method for image: ${imageUrl}`);
        }
        
        // Guard: if URL couldn't be constructed, fall back to text
        if (!imageUrl || typeof imageUrl !== 'string') {
          console.log('⚠️ Image URL missing, falling back to text message');
          const enhancedCaption = caption + '\n\n📸 Images: Not available at the moment 2';
          messages.push({
            type: 'text',
            text: { body: enhancedCaption }
          });
          continue;
        }
        
        // Check if the image URL is publicly accessible
        if (isPubliclyAccessible(imageUrl)) {
          console.log(`📸 Adding car image (publicly accessible): ${imageUrl}`);
          messages.push({
            type: 'image',
            image: { link: imageUrl, caption: caption }
          });
        } else {
          console.log(`⚠️ Image URL not publicly accessible, falling back to text-only: ${imageUrl}`);
          // Fall back to text-only message with enhanced caption
          const enhancedCaption = caption + '\n\n📸 Images: Available but not publicly accessible. Please visit our website to view images.';
          messages.push({
            type: 'text',
            text: { body: enhancedCaption }
          });
        }
        
        // Removed additional images to show only one image with details
        // Previously, we sent up to 3 images per car. Now, we only send the first image.
      }
    } else {
      // No images available - show text-only message with enhanced caption
      console.log(`📸 No images found for car ${car.id}, showing text-only message`);
      
      // Enhanced caption for cars without images
      const enhancedCaption = caption + '\n\n📸 Images: Not available at the moment 3';
      
      // Add text message instead of image
      messages.push({
        type: 'text',
        text: { body: enhancedCaption }
      });
      
      // Try to find image in static images directory as fallback (only if no uploaded images)
      const staticImageFile = `${car.brand}_${car.model}_${car.variant}`.replace(/\s+/g, '_') + '.png';
      const staticImageUrl = `${process.env.NGROK_URL || process.env.PUBLIC_URL || 'http://27.111.72.50:3000'}/images/${staticImageFile}`;
      
      console.log(`📸 Trying static image fallback: ${staticImageFile}`);
      
      // Note: We don't add the static image here since WhatsApp doesn't support mixed message types
      // The text message above will be sufficient
    }

    // Add SELECT button message for each car
    const carId = `book_${car.brand}_${car.model}_${car.variant}`.replace(/\s+/g, '_');
    messages.push({
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: 'SELECT' },
        action: {
          buttons: [
            {
              type: 'reply',
              reply: {
                id: carId,
                title: 'SELECT'
              }
            }
          ]
        }
      }
    });
  }

  // Add "Browse More Cars" button if there are more cars to show
  const hasMoreCars = endIndex < cars.length;
  
  let messageText = `Showing cars ${startIndex + 1}-${endIndex} of ${cars.length}:`;
  
  console.log(`📸 Created ${messages.length} messages for cars`);
  console.log(`📸 Message types:`, messages.map(m => m.type));
  
  const final = {
    message: messageText,
    messages: messages
  };
  
  // Always add "Browse More Cars" option if there are more cars
  if (hasMoreCars) {
    final.options = ["Browse More Cars"];
    console.log("🔍 Adding Browse More Cars button - hasMoreCars:", hasMoreCars, "cars.length:", cars.length, "endIndex:", endIndex);
  } else {
    final.message += "\n\nNo more cars available.";
    final.options = ["Change criteria"];
    console.log("🔍 No more cars to show - hasMoreCars:", hasMoreCars, "cars.length:", cars.length, "endIndex:", endIndex);
  }
  
  console.log("🔍 Final response structure:", JSON.stringify(final, null, 2));
  
  session.step = 'show_more_cars';
  return final;
}

function getTestDriveConfirmation(session) {
  console.log("🔍 Debug - session.td_location_mode:", session.td_location_mode);
  console.log("🔍 Debug - session.td_home_address:", session.td_home_address);
  console.log("🔍 Debug - session.td_drop_location:", session.td_drop_location);
  console.log("🔍 Debug - testDriveDateFormatted:", session.testDriveDateFormatted);
  
  let locationText;
  
  // Check for different location modes
  const locationMode = session.td_location_mode ? session.td_location_mode.toLowerCase() : '';
  console.log("🔍 Debug - Location mode:", locationMode);
  
  if (locationMode === "home pickup") {
    locationText = `\n📍 Test Drive Location: ${session.td_home_address || 'To be confirmed'}`;
    console.log("🔍 Debug - Using home address:", session.td_home_address);
  } else if (locationMode === "showroom pickup") {
    locationText = "\n📍 Showroom Address: Sherpa Hyundai Showroom, 123 MG Road, Bangalore\n🅿️ Free parking available";
    console.log("🔍 Debug - Using showroom address");
  } else if (locationMode.includes("delivery")) {
    locationText = `\n📍 Test Drive Location: ${session.td_drop_location || 'To be confirmed'}`;
    console.log("🔍 Debug - Using delivery address:", session.td_drop_location);
  } else {
    locationText = "\n📍 Test Drive Location: To be confirmed";
    console.log("🔍 Debug - Using default location");
  }

  // Format the date properly
  let dateDisplay = 'To be confirmed';
  if (session.testDriveDateFormatted) {
    dateDisplay = session.testDriveDateFormatted;
  } else if (session.testDriveDate === 'Today' || session.testDriveDate === 'Tomorrow') {
    dateDisplay = session.testDriveDate;
  } else if (session.testDriveDay) {
    dateDisplay = session.testDriveDay;
  }

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

Quick reminder: We'll also have financing options ready if you like the car during your test drive!

Please confirm your booking:`,
    options: ["Confirm", "Reject"]
  };
}

module.exports = { handleBrowseUsedCars };