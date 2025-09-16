require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

// Import database connection
const pool = require('./db');
const { routeMessage } = require('./utils/mainRouter');
<<<<<<< HEAD
=======
const { extractIntentEntities } = require('./utils/geminiHandler');
const MessageLogger = require('./utils/messageLogger');
>>>>>>> 3c80ab4 (Updated the Gemini LLM)
const sessions = {}; 

const app = express();
app.use(bodyParser.json());

app.use('/images', express.static('images'));
app.use('/uploads', express.static('uploads'));
const WHATSAPP_TOKEN = process.env.WHATSAPP_API_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const API_BASE_URL = `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

// Validate environment variables
if (!WHATSAPP_TOKEN) {
  console.error("❌ WHATSAPP_API_TOKEN is not set in environment variables");
  process.exit(1);
}

if (!WHATSAPP_PHONE_NUMBER_ID) {
  console.error("❌ WHATSAPP_PHONE_NUMBER_ID is not set in environment variables");
  process.exit(1);
}

console.log("🔧 WhatsApp Configuration:");
console.log("📱 Phone Number ID:", WHATSAPP_PHONE_NUMBER_ID);
console.log("🔑 Token available:", WHATSAPP_TOKEN ? "Yes" : "No");
console.log("🌐 API Base URL:", API_BASE_URL);

// WhatsApp Bot Server
const WHATSAPP_PORT = process.env.WHATSAPP_PORT || 3001;

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    res.json({ status: 'healthy', database: 'connected' });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({ status: 'unhealthy', database: 'disconnected', error: error.message });
  }
});

// Webhook Verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'auto';

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Webhook verification failed');
    console.log('Expected token:', VERIFY_TOKEN);
    console.log('Received token:', token);
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  try {
    const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];
    const from = msg?.from;

    // Support for text and button replies
    const userMsg =
      msg?.text?.body ||
      msg?.interactive?.list_reply?.title ||
      msg?.interactive?.button_reply?.title;

    if (from && userMsg) {
      if (!sessions[from]) sessions[from] = {};

      console.log('\n📩 Incoming Message');
      console.log('From:', from);
      console.log('Message:', userMsg);
      console.log('Session Before:', JSON.stringify(sessions[from], null, 2));
      
      // Additional validation
      if (!userMsg.trim()) {
        console.error("❌ Empty user message received");
        return res.sendStatus(200);
      }

<<<<<<< HEAD
           let response;
=======
      // Build short history (optional)
      const history = [{ role: 'user', text: userMsg }];
      // Extract intent/entities via Gemini
      let intentData = { intent: 'general', entities: {}, confidence: 0.0 };
      try {
        intentData = await extractIntentEntities(userMsg, history);
      } catch (_) {}

      // Log incoming message with AI fields
      try {
        await MessageLogger.logMessage({
          phoneNumber: from,
          messageType: 'incoming',
          messageContent: userMsg,
          responseSent: false,
          sessionId: sessions[from].sessionId || null,
          userAgent: req.headers['user-agent'],
          ipAddress: req.ip || req.connection.remoteAddress,
          intent: intentData.intent,
          entities: intentData.entities,
          confidence: intentData.confidence
        });
      } catch (logError) {
        console.error("❌ Error logging incoming message:", logError);
      }

      let response;
>>>>>>> 3c80ab4 (Updated the Gemini LLM)
      try {
        // Optionally store extracted intent in session for routing hints
        sessions[from].lastIntent = intentData.intent;
        sessions[from].lastEntities = intentData.entities;
        sessions[from].lastConfidence = typeof intentData.confidence === 'number' ? intentData.confidence : 0.0;
        response = await routeMessage(sessions[from], userMsg, pool);
        console.log('Session After:', JSON.stringify(sessions[from], null, 2));
        console.log('Response:', JSON.stringify(response, null, 2));
        console.log('----------------------------------');
      } catch (error) {
        console.error("❌ Error in routeMessage:", error);
        response = { message: "I apologize, but I encountered an error. Please try again." };
      }

      // Validate response before sending
      if (response === null) {
        console.log("📸 No additional message needed (button already included in previous messages)");
        // Don't send any additional message
      } else if (response && response.message) {
        await sendWhatsAppMessage(from, response.message, response.options || [], response.messages || []);
<<<<<<< HEAD
=======
        
        // Log outgoing response
        try {
          await MessageLogger.logMessage({
            phoneNumber: from,
            messageType: 'outgoing',
            messageContent: response.message,
            responseSent: true,
            responseContent: response.message,
            sessionId: sessions[from].sessionId || null,
            userAgent: req.headers['user-agent'],
            ipAddress: req.ip || req.connection.remoteAddress,
            intent: sessions[from].lastIntent || null,
            entities: sessions[from].lastEntities || null,
            confidence: intentData.confidence
          });
        } catch (logError) {
          console.error("❌ Error logging outgoing message:", logError);
        }
        
>>>>>>> 3c80ab4 (Updated the Gemini LLM)
      } else {
        console.error("❌ Invalid response from routeMessage:", response);
        await sendWhatsAppMessage(from, "I apologize, but I encountered an error. Please try again.", [], []);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Error handling webhook:', err.message);
    res.sendStatus(500);
  }
});

// Send WhatsApp Message
async function sendWhatsAppMessage(to, text, options = [], messages = []) {
  try {
    // Validate environment variables
    if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
      console.error("❌ WhatsApp configuration missing");
      return;
    }

    // Validate phone number format
    if (!to || typeof to !== 'string') {
      console.error("❌ Invalid phone number:", to);
      return;
    }

    // Validate input parameters
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      console.error("❌ Invalid message text:", text);
      text = "I apologize, but I encountered an error. Please try again.";
    }
    
    // Ensure text doesn't exceed WhatsApp's limit
    if (text.length > 1024) {
      console.warn("⚠️ Message text too long, truncating...");
      text = text.substring(0, 1021) + "...";
    }
    
    console.log("📨 Preparing to send message to:", to);
    console.log("📝 Message Text:", text);
    console.log("🧩 Options:", options);
    console.log("📸 Messages:", messages);

    // If we have messages array (for car images and buttons), send them first
    if (messages && messages.length > 0) {
      console.log("📸 Sending car messages...");
      
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        try {
          // Validate individual message
          if (!msg || !msg.type) {
            console.error("❌ Invalid message in messages array:", msg);
            continue;
          }
          
          let payload = {
            messaging_product: 'whatsapp',
            to,
            ...msg
          };

          console.log(`📦 Message ${i + 1}/${messages.length} Payload:`, JSON.stringify(payload, null, 2));
          
          const response = await axios.post(API_BASE_URL, payload, {
            headers: {
              Authorization: `Bearer ${WHATSAPP_TOKEN}`,
              'Content-Type': 'application/json'
            }
          });
          
          console.log(`✅ Message ${i + 1}/${messages.length} sent successfully`);

          // Increase delay to ensure proper message ordering
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error) {
          console.error("❌ Failed to send message:", error.message);
          if (error.response) {
            console.error("🔻 Response Data:", JSON.stringify(error.response.data, null, 2));
          }
        }
      }
      
      // If we sent messages array, check if we need to send a follow-up message with options
      if (text.trim().length > 0 && !text.startsWith("Here are some cars for you:")) {
        console.log("📸 Car images sent, sending follow-up message with options");
        // Continue to send the text message with options
      } else {
        console.log("📸 Car images sent, no follow-up message needed");
        return;
      }
    }

    let payload;

    if (options.length > 0) {
      // Limit options to 10 for WhatsApp compatibility
      const limitedOptions = options.slice(0, 10);
      const isList = limitedOptions.length > 3;
      const action = isList
        ? {
            button: 'Choose',
            sections: [
              {
                title: 'Available Options',
                rows: limitedOptions.map((opt, i) => ({
                  id: `option_${i + 1}`,
                  title: opt
                }))
              }
            ]
          }
        : {
            buttons: limitedOptions.map((opt, i) => ({
              type: 'reply',
              reply: { id: `option_${i + 1}`, title: opt }
            }))
          };

      // Validate interactive message body
      if (!text || text.trim().length === 0) {
        console.error("❌ Attempting to send empty interactive message body");
        text = "Please select an option:";
      }
      
      payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: isList ? 'list' : 'button',
          body: { text },
          ...(isList ? { footer: { text: 'Tap to choose from list' } } : {}),
          action
        }
      };

      console.log("📦 Payload (Interactive):", JSON.stringify(payload, null, 2));
    } else {
      // Final validation before sending
      if (!text || text.trim().length === 0) {
        console.error("❌ Attempting to send empty text message");
        text = "I apologize, but I encountered an error. Please try again.";
      }
      
      payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text }
      };

      console.log("📦 Payload (Text):", JSON.stringify(payload, null, 2));
    }

    console.log("📤 Sending to WhatsApp API...");
    console.log("🌐 URL:", API_BASE_URL);
    console.log("📦 Payload:", JSON.stringify(payload, null, 2));
    
    const response = await axios.post(API_BASE_URL, payload, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    console.log("✅ WhatsApp API response status:", response.status);
    console.log("📬 Message successfully sent!");
    return response;
  } catch (error) {
    console.error("❌ Failed to send WhatsApp message:");
    if (error.response) {
      console.error("🔻 Response Data:", JSON.stringify(error.response.data, null, 2));
    } else {
      console.error("❗ Error Message:", error.message);
    }
  }
}


const server = app.listen(WHATSAPP_PORT, () => {
  console.log(`🤖 WhatsApp Bot running on port ${WHATSAPP_PORT}`);
  console.log(`📱 Webhook endpoint: http://localhost:${WHATSAPP_PORT}/webhook`);
  console.log(`🏥 Health check: http://localhost:${WHATSAPP_PORT}/health`);
  console.log(`🚗 Inventory system can be started with: npm run start`);
  console.log(`🔄 Both services can be started with: npm run both`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  server.close(() => {
    console.log('✅ Server closed due to uncaught exception');
    process.exit(1);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  server.close(() => {
    console.log('✅ Server closed due to unhandled rejection');
    process.exit(1);
  });
});
