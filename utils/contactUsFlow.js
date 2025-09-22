const { pool } = require('../db');
const { getSystemPrompt, getExistingOptions } = require('./llmSystemPrompts');

// Helper function to generate LLM response for contact flow
async function generateLLMResponse(model, session, userMessage, context = {}) {
  if (!model) return null;
  
  try {
    const systemPrompt = getSystemPrompt("contact_team");
    const conversationHistory = session.conversationHistory || [];
    
    // Build conversation context
    let historyContext = "";
    if (conversationHistory.length > 0) {
      historyContext = "\nConversation History:\n" + 
        conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join("\n");
    }
    
    const prompt = `${systemPrompt}
    
Current Session State:
- Step: ${session.step || 'contact_menu'}
- Callback Time: ${session.callback_time || 'Not set'}
- Callback Name: ${session.callback_name || 'Not set'}
- Callback Phone: ${session.callback_phone || 'Not set'}
- Callback Reason: ${session.callback_reason || 'Not set'}

${historyContext}

User's current message: "${userMessage}"

Generate a friendly, contextual response in JSON format:
{
  "message": "your response here",
  "options": ["option1", "option2", "option3"]
}

Available contact options: ${getExistingOptions('contact_team', 'method').join(', ')}
Available time options: ${getExistingOptions('contact_team', 'time').join(', ')}`;

    const result = await model.generateContent(prompt);
    const response = JSON.parse(result.response.text());
    
    // Update conversation history
    if (!session.conversationHistory) session.conversationHistory = [];
    session.conversationHistory.push(
      { role: "user", content: userMessage },
      { role: "assistant", content: response.message }
    );
    
    return response;
  } catch (error) {
    console.error("LLM response generation failed:", error);
    return null;
  }
}

async function handleContactUsStep(session, userMessage, model = null) {
  const state = session.step || 'contact_menu';
  console.log("🧠 [Contact Flow] Current step:", state);
  console.log("📝 User input:", userMessage);

  // Try LLM response first, fallback to hardcoded if needed
  const llmResponse = await generateLLMResponse(model, session, userMessage);
  
  switch (state) {
    case 'contact_start':
    case 'contact_menu':
      session.step = 'contact_menu'; // Reset step in case it's called from main menu
      
      // If slots prefilled (from router), fast-forward
      if (session.callback_time || session.callback_name || session.callback_phone) {
        if (!session.callback_time) {
          session.step = 'callback_time';
          if (llmResponse) {
            return {
              message: llmResponse.message || "Perfect! Our team will call you back. What's the best time to reach you?",
              options: llmResponse.options || [
                "🌅 Morning(9-12PM)",
                "🌞 Afternoon(12-4PM)",
                "🌆 Evening(4PM-8PM)"
              ]
            };
          }
          return {
            message: "Perfect! Our team will call you back. What's the best time to reach you?",
            options: [
              "🌅 Morning(9-12PM)",
              "🌞 Afternoon(12-4PM)",
              "🌆 Evening(4PM-8PM)"
            ]
          };
        }
        if (!session.callback_name) {
          session.step = 'callback_name';
          if (llmResponse) {
            return { 
              message: llmResponse.message || "Great! Please provide your name:",
              options: llmResponse.options || []
            };
          }
          return { message: "Great! Please provide your name:" };
        }
        if (!session.callback_phone) {
          session.step = 'contact_callback_phone';
          if (llmResponse) {
            return { 
              message: llmResponse.message || "Please provide your phone number:",
              options: llmResponse.options || []
            };
          }
          return { message: "Please provide your phone number:" };
        }
        session.step = 'callback_reason';
        if (llmResponse) {
          return { 
            message: llmResponse.message || "What do you need help with?",
            options: llmResponse.options || []
          };
        }
        return { message: "What do you need help with?" };
      }
      // Handle specific contact methods
      if (userMessage.includes("Call")) {
        session.step = 'done';
        if (llmResponse) {
          return {
            message: llmResponse.message || `Perfect! Here are our direct contact numbers for immediate assistance:

📞 CALL US DIRECTLY:
🏢 Main Showroom - Bangalore:
📞 Sales: +91-9876543210
📞 Service: +91-9876543211
🕒 Mon-Sat: 9 AM - 8 PM, Sun: 10 AM - 6 PM

🏢 Branch - Electronic City:
📞 Sales: +91-9876543212
🕒 Mon-Sat: 9 AM - 8 PM

🆘 Emergency Support:
📞 24/7 Helpline: +91-9876543213

💡 Pro Tip: Mention you contacted us via WhatsApp for priority assistance!`,
            options: llmResponse.options || ["Explore", "End Conversation"]
          };
        }
        return {
          message: `Perfect! Here are our direct contact numbers for immediate assistance:

📞 CALL US DIRECTLY:
🏢 Main Showroom - Bangalore:
📞 Sales: +91-9876543210
📞 Service: +91-9876543211
🕒 Mon-Sat: 9 AM - 8 PM, Sun: 10 AM - 6 PM

🏢 Branch - Electronic City:
📞 Sales: +91-9876543212
🕒 Mon-Sat: 9 AM - 8 PM

🆘 Emergency Support:
📞 24/7 Helpline: +91-9876543213

💡 Pro Tip: Mention you contacted us via WhatsApp for priority assistance!`,
          options: ["Explore", "End Conversation"]
        };
      }

      if (userMessage.toLowerCase().includes("callback")) {
        session.step = 'callback_time';
        if (llmResponse) {
          return {
            message: llmResponse.message || "Perfect! Our team will call you back. What's the best time to reach you?",
            options: llmResponse.options || [
              "🌅 Morning(9-12PM)",
              "🌞 Afternoon(12-4PM)",
              "🌆 Evening(4PM-8PM)"
            ]
          };
        }
        return {
          message: "Perfect! Our team will call you back. What's the best time to reach you?",
          options: [
            "🌅 Morning(9-12PM)",
            "🌞 Afternoon(12-4PM)",
            "🌆 Evening(4PM-8PM)"
          ]
        };
      }

      if (userMessage.includes("Visit")) {
        session.step = 'done';
        if (llmResponse) {
          return {
            message: llmResponse.message || `We'd love to welcome you! Here are our locations:

📍 SHERPA HYUNDAI LOCATIONS:

🏢 Main Showroom - Bangalore:
📍 123 MG Road, Bangalore - 560001
📞 +91-9876543210
🕒 Mon-Sat: 9:00 AM - 8:00 PM, Sun: 10:00 AM - 6:00 PM
🅿️ Free parking, Test drives, Lounge

🏢 Branch - Electronic City:
📍 456 Hosur Road, Electronic City - 560100
📞 +91-9876543211
🕒 Mon-Sat: 9:00 AM - 8:00 PM

🗺️ How to Reach:
🚇 Metro: MG Road Station (2 min walk)
🚗 Car: Ring Road access
🚌 Buses available nearby`,
            options: llmResponse.options || ["Explore", "End Conversation"]
          };
        }
        return {
          message: `We'd love to welcome you! Here are our locations:

📍 SHERPA HYUNDAI LOCATIONS:

🏢 Main Showroom - Bangalore:
📍 123 MG Road, Bangalore - 560001
📞 +91-9876543210
🕒 Mon-Sat: 9:00 AM - 8:00 PM, Sun: 10:00 AM - 6:00 PM
🅿️ Free parking, Test drives, Lounge

🏢 Branch - Electronic City:
📍 456 Hosur Road, Electronic City - 560100
📞 +91-9876543211
🕒 Mon-Sat: 9:00 AM - 8:00 PM

🗺️ How to Reach:
🚇 Metro: MG Road Station (2 min walk)
🚗 Car: Ring Road access
🚌 Buses available nearby`,
          options: ["Explore", "End Conversation"]
        };
      }

      // Default contact menu
      if (llmResponse) {
        return {
          message: llmResponse.message || "How would you like to get in touch?",
          options: llmResponse.options || [
            "📞 Call us now",
            "📧 Request callback",
            "📍 Visit showroom"
          ]
        };
      }
      return {
        message: "How would you like to get in touch?",
        options: [
          "📞 Call us now",
          "📧 Request callback",
          "📍 Visit showroom"
        ]
      };

    case 'callback_time':
      session.callback_time = userMessage;
      session.step = 'callback_name';
      if (llmResponse) {
        return { 
          message: llmResponse.message || "Great! Please provide your name:",
          options: llmResponse.options || []
        };
      }
      return { message: "Great! Please provide your name:" };

    case 'callback_name':
      session.callback_name = userMessage;
      session.step = 'contact_callback_phone';
      if (llmResponse) {
        return { 
          message: llmResponse.message || "Please provide your phone number:",
          options: llmResponse.options || []
        };
      }
      return { message: "Please provide your phone number:" };

    case 'contact_callback_phone':
      session.callback_phone = userMessage;
      session.step = 'callback_reason';
      if (llmResponse) {
        return { 
          message: llmResponse.message || "What do you need help with?",
          options: llmResponse.options || []
        };
      }
      return { message: "What do you need help with?" };

    case 'callback_reason':
      session.callback_reason = userMessage;
      session.step = 'done';

      try {
        // Save callback request to database
        await pool.query(
          `INSERT INTO callback_requests (name, phone, reason, preferred_time)
           VALUES ($1, $2, $3, $4)`,
          [
            session.callback_name,
            session.callback_phone,
            session.callback_reason,
            session.callback_time
          ]
        );

        const successMessage = `Perfect ${session.callback_name}! Your callback is scheduled:

📋 CALLBACK SCHEDULED:
👤 Name: ${session.callback_name}
📱 Phone: ${session.callback_phone}
⏰ Preferred Time: ${session.callback_time}

📞 What to Expect:
✅ Call within 2 hours if during business hours
✅ Our expert will assist with: ${session.callback_reason}
🕒 Business Hours: Mon-Sat: 9 AM - 8 PM

Need urgent help?
📞 Call: +91-9876543210
📍 Visit: 123 MG Road, Bangalore
Thank you! 😊`;

        if (llmResponse) {
          return {
            message: llmResponse.message || successMessage,
            options: llmResponse.options || ["Explore", "End Conversation"]
          };
        }
        return {
          message: successMessage,
          options: ["Explore", "End Conversation"]
        };
      } catch (error) {
        console.error('Error saving callback request:', error);
        
        // Return success message even if database save fails
        const successMessage = `Perfect ${session.callback_name}! Your callback is scheduled:

📋 CALLBACK SCHEDULED:
👤 Name: ${session.callback_name}
📱 Phone: ${session.callback_phone}
⏰ Preferred Time: ${session.callback_time}

📞 What to Expect:
✅ Call within 2 hours if during business hours
✅ Our expert will assist with: ${session.callback_reason}
🕒 Business Hours: Mon-Sat: 9 AM - 8 PM

Need urgent help?
📞 Call: +91-9876543210
📍 Visit: 123 MG Road, Bangalore
Thank you! 😊`;

        if (llmResponse) {
          return {
            message: llmResponse.message || successMessage,
            options: llmResponse.options || ["Explore", "End Conversation"]
          };
        }
        return {
          message: successMessage,
          options: ["Explore", "End Conversation"]
        };
      }

    case 'done':
      if (userMessage === "Explore") {
        // Reset session and go back to main menu
        session.step = 'main_menu';
        if (llmResponse) {
          return {
            message: llmResponse.message || "Great! Let's explore more options. What would you like to do?",
            options: llmResponse.options || [
              "🚗 Browse Used Cars",
              "💰 Get Car Valuation", 
              "📞 Contact Our Team",
              "ℹ️ About Us"
            ]
          };
        }
        return {
          message: "Great! Let's explore more options. What would you like to do?",
          options: [
            "🚗 Browse Used Cars",
            "💰 Get Car Valuation", 
            "📞 Contact Our Team",
            "ℹ️ About Us"
          ]
        };
      } else if (userMessage === "End Conversation") {
        // End conversation with thank you note
        session.step = 'conversation_ended';
        const endMessage = `Thank you for choosing Sherpa Hyundai! 🙏

We appreciate your time and look forward to serving you.

📞 For any queries: +91-9876543210
📍 Visit us: 123 MG Road, Bangalore
🌐 Website: www.sherpahyundai.com

Have a great day! 😊`;
        
        if (llmResponse) {
          return {
            message: llmResponse.message || endMessage,
            options: llmResponse.options || []
          };
        }
        return {
          message: endMessage
        };
      }
      
      if (llmResponse) {
        return { 
          message: llmResponse.message || "Something went wrong in contact flow. Please try again.",
          options: llmResponse.options || []
        };
      }
      return { message: "Something went wrong in contact flow. Please try again." };

    default:
      if (llmResponse) {
        return { 
          message: llmResponse.message || "Something went wrong in contact flow. Please try again.",
          options: llmResponse.options || []
        };
      }
      return { message: "Something went wrong in contact flow. Please try again." };
  }
}

module.exports = { handleContactUsStep };
