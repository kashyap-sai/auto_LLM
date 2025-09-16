const pool = require('../db');

class MessageLogger {
    /**
     * Log a WhatsApp message interaction
     * @param {Object} messageData - Message data to log
     * @param {string} messageData.phoneNumber - Customer phone number
     * @param {string} messageData.messageType - Type of message (browse_cars, car_valuation, etc.)
     * @param {string} messageData.messageContent - Content of the message
     * @param {boolean} messageData.responseSent - Whether a response was sent
     * @param {string} messageData.responseContent - Content of the response
     * @param {string} messageData.sessionId - Session ID for tracking
     * @param {string} messageData.userAgent - User agent string
     * @param {string} messageData.ipAddress - IP address
     */
    static async logMessage(messageData) {
        try {
            const {
                phoneNumber,
                messageType,
                messageContent,
                responseSent = false,
                responseContent = null,
                sessionId = null,
                userAgent = null,
                ipAddress = null,
                intent = null,
                entities = null,
                confidence = null
            } = messageData;

            const query = `
                INSERT INTO message_logs (
                    phone_number, message_type, message_content, 
                    response_sent, response_content, session_id, 
                    user_agent, ip_address, intent, entities, confidence
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                RETURNING id
            `;

            const values = [
                phoneNumber,
                messageType,
                messageContent,
                responseSent,
                responseContent,
                sessionId,
                userAgent,
                ipAddress,
                intent,
                entities ? JSON.stringify(entities) : null,
                typeof confidence === 'number' ? Math.round(confidence * 100) / 100 : null
            ];

            const result = await pool.query(query, values);
            console.log(`📝 Message logged: ID ${result.rows[0].id}, Type: ${messageType}, Phone: ${phoneNumber}`);
            return result.rows[0].id;
        } catch (error) {
            console.error('❌ Error logging message:', error);
            throw error;
        }
    }

    /**
     * Get message statistics for a time range
     * @param {Date} startDate - Start date
     * @param {Date} endDate - End date
     * @returns {Object} Message statistics
     */
    static async getMessageStats(startDate, endDate) {
        try {
            const query = `
                SELECT 
                    message_type,
                    COUNT(*) as count,
                    COUNT(CASE WHEN response_sent = true THEN 1 END) as responses_sent,
                    COUNT(DISTINCT phone_number) as unique_users
                FROM message_logs 
                WHERE created_at >= $1 AND created_at <= $2
                GROUP BY message_type
                ORDER BY count DESC
            `;

            const result = await pool.query(query, [startDate, endDate]);
            return result.rows;
        } catch (error) {
            console.error('❌ Error getting message stats:', error);
            throw error;
        }
    }

    /**
     * Get time-based message distribution
     * @param {Date} startDate - Start date
     * @param {Date} endDate - End date
     * @returns {Array} Time-based message data
     */
    static async getTimeBasedStats(startDate, endDate) {
        try {
            const query = `
                SELECT 
                    EXTRACT(HOUR FROM created_at) as hour,
                    message_type,
                    COUNT(*) as count
                FROM message_logs 
                WHERE created_at >= $1 AND created_at <= $2
                GROUP BY EXTRACT(HOUR FROM created_at), message_type
                ORDER BY hour, message_type
            `;

            const result = await pool.query(query, [startDate, endDate]);
            return result.rows;
        } catch (error) {
            console.error('❌ Error getting time-based stats:', error);
            throw error;
        }
    }

    /**
     * Get daily message counts
     * @param {number} days - Number of days to look back
     * @returns {Array} Daily message counts
     */
    static async getDailyStats(days = 30) {
        try {
            const query = `
                SELECT 
                    DATE(created_at) as date,
                    message_type,
                    COUNT(*) as count
                FROM message_logs 
                WHERE created_at >= NOW() - INTERVAL '${days} days'
                GROUP BY DATE(created_at), message_type
                ORDER BY date DESC, message_type
            `;

            const result = await pool.query(query);
            return result.rows;
        } catch (error) {
            console.error('❌ Error getting daily stats:', error);
            throw error;
        }
    }

    /**
     * Get unique phone numbers for a time range
     * @param {Date} startDate - Start date
     * @param {Date} endDate - End date
     * @returns {Array} Unique phone numbers
     */
    static async getUniquePhoneNumbers(startDate, endDate) {
        try {
            const query = `
                SELECT DISTINCT phone_number, COUNT(*) as message_count
                FROM message_logs 
                WHERE created_at >= $1 AND created_at <= $2
                GROUP BY phone_number
                ORDER BY message_count DESC
            `;

            const result = await pool.query(query, [startDate, endDate]);
            return result.rows;
        } catch (error) {
            console.error('❌ Error getting unique phone numbers:', error);
            throw error;
        }
    }

    /**
     * Get message logs for Excel export
     * @param {Date} startDate - Start date
     * @param {Date} endDate - End date
     * @returns {Array} Message logs data
     */
    static async getMessageLogsForExport(startDate, endDate) {
        try {
            const query = `
                SELECT 
                    phone_number,
                    message_type,
                    message_content,
                    response_sent,
                    response_content,
                    created_at
                FROM message_logs 
                WHERE created_at >= $1 AND created_at <= $2
                ORDER BY created_at DESC
            `;

            const result = await pool.query(query, [startDate, endDate]);
            return result.rows;
        } catch (error) {
            console.error('❌ Error getting message logs for export:', error);
            throw error;
        }
    }
}

module.exports = MessageLogger;
