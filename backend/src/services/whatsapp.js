import { Client } from 'whatsapp-web.js';
import { logger } from '../utils/logger.js';
import Message from '../models/Message.js';
import MessageTemplate from '../models/MessageTemplate.js';
import Customer from '../models/Customer.js';
import { redis } from './redis.js';

class WhatsAppService {
  constructor() {
    this.client = null;
    this.initialized = false;
    this.messageQueue = new Map();
    this.retryAttempts = new Map();
    this.MAX_RETRIES = 3;
    this.RETRY_DELAY = 5000; // 5 seconds
  }

  async initialize() {
    try {
      this.client = new Client({
        authStrategy: 'remote',
        apiKey: process.env.WHATSAPP_API_KEY,
        webhookUrl: process.env.WEBHOOK_URL
      });

      this.client.on('ready', () => {
        this.initialized = true;
        logger.info('WhatsApp client is ready');
      });

      this.client.on('message', this.handleIncomingMessage.bind(this));
      this.client.on('message_ack', this.handleMessageStatus.bind(this));
      this.client.on('disconnected', this.handleDisconnection.bind(this));

      await this.client.initialize();
    } catch (error) {
      logger.error('WhatsApp initialization error:', error);
      throw error;
    }
  }

  async sendMessage(to, content, options = {}) {
    try {
      if (!this.initialized) {
        throw new Error('WhatsApp client not initialized');
      }

      const message = new Message({
        channel: 'whatsapp',
        direction: 'outbound',
        customer: options.customer,
        content,
        recipient: to,
        template: options.template,
        sender: options.sender,
        metadata: options.metadata
      });

      // Handle template messages
      if (options.template) {
        const template = await MessageTemplate.findById(options.template);
        if (!template) {
          throw new Error('Template not found');
        }

        const renderedContent = template.renderTemplate(options.variables || {});
        message.content = renderedContent.whatsapp.body;
      }

      // Queue message
      await this.queueMessage(message);

      return message;
    } catch (error) {
      logger.error('Error sending WhatsApp message:', error);
      throw error;
    }
  }

  async queueMessage(message) {
    try {
      // Save message to database
      await message.save();

      // Add to Redis queue
      await redis.lpush('whatsapp:messageQueue', JSON.stringify({
        messageId: message._id,
        recipient: message.recipient,
        content: message.content,
        timestamp: Date.now()
      }));

      // Process queue
      this.processQueue();
    } catch (error) {
      logger.error('Error queuing message:', error);
      throw error;
    }
  }

  async processQueue() {
    try {
      const queueItem = await redis.rpop('whatsapp:messageQueue');
      if (!queueItem) return;

      const { messageId, recipient, content } = JSON.parse(queueItem);
      const message = await Message.findById(messageId);

      if (!message) {
        logger.error(`Message ${messageId} not found in database`);
        return;
      }

      // Send message through WhatsApp
      const response = await this.client.sendMessage(recipient, content);
      
      // Update message with WhatsApp message ID
      message.metadata.set('whatsappMessageId', response.id._serialized);
      await message.updateStatus('sent');

      // Process next message in queue
      setImmediate(() => this.processQueue());
    } catch (error) {
      logger.error('Error processing message queue:', error);
      
      // Retry failed messages
      if (queueItem) {
        const { messageId } = JSON.parse(queueItem);
        await this.handleRetry(messageId);
      }
    }
  }

  async handleRetry(messageId) {
    const attempts = this.retryAttempts.get(messageId) || 0;
    
    if (attempts < this.MAX_RETRIES) {
      this.retryAttempts.set(messageId, attempts + 1);
      
      setTimeout(async () => {
        const message = await Message.findById(messageId);
        if (message) {
          await this.queueMessage(message);
        }
      }, this.RETRY_DELAY * Math.pow(2, attempts));
    } else {
      const message = await Message.findById(messageId);
      if (message) {
        await message.updateStatus('failed', {
          code: 'MAX_RETRIES_EXCEEDED',
          message: 'Message failed after maximum retry attempts'
        });
      }
      this.retryAttempts.delete(messageId);
    }
  }

  async handleIncomingMessage(message) {
    try {
      // Find or create customer
      const customer = await this.findOrCreateCustomer(message.from);

      // Create message record
      const incomingMessage = new Message({
        channel: 'whatsapp',
        direction: 'inbound',
        customer: customer._id,
        content: message.body,
        recipient: message.to,
        metadata: {
          whatsappMessageId: message.id._serialized,
          type: message.type,
          timestamp: message.timestamp
        }
      });

      // Handle attachments
      if (message.hasMedia) {
        const media = await message.downloadMedia();
        incomingMessage.attachments.push({
          type: media.mimetype.split('/')[0],
          url: media.data,
          mimeType: media.mimetype
        });
      }

      await incomingMessage.save();

      // Emit event for real-time updates
      global.io.emit('newMessage', {
        customerId: customer._id,
        messageId: incomingMessage._id
      });

      // Process automated responses
      await this.processAutomatedResponses(incomingMessage, customer);
    } catch (error) {
      logger.error('Error handling incoming message:', error);
    }
  }

  async handleMessageStatus(message) {
    try {
      const messageId = message.id._serialized;
      const status = this.mapStatus(message.ack);

      const savedMessage = await Message.findOne({
        'metadata.whatsappMessageId': messageId
      });

      if (savedMessage) {
        await savedMessage.updateStatus(status);
      }
    } catch (error) {
      logger.error('Error handling message status:', error);
    }
  }

  async handleDisconnection(reason) {
    logger.warn('WhatsApp client disconnected:', reason);
    this.initialized = false;

    // Attempt to reconnect
    setTimeout(async () => {
      try {
        await this.initialize();
      } catch (error) {
        logger.error('WhatsApp reconnection failed:', error);
      }
    }, 5000);
  }

  mapStatus(ack) {
    const statusMap = {
      0: 'sent',
      1: 'delivered',
      2: 'read',
      3: 'read',
      4: 'read'
    };
    return statusMap[ack] || 'sent';
  }

  async findOrCreateCustomer(phoneNumber) {
    try {
      let customer = await Customer.findOne({
        'metadata.whatsappId': phoneNumber
      });

      if (!customer) {
        // Get contact info from WhatsApp
        const contact = await this.client.getContactById(phoneNumber);
        
        customer = new Customer({
          type: 'individual',
          customerNumber: await this.generateCustomerNumber(),
          metadata: {
            whatsappId: phoneNumber,
            whatsappName: contact.name || contact.pushname
          },
          contactPreferences: {
            whatsapp: true
          }
        });

        await customer.save();
      }

      return customer;
    } catch (error) {
      logger.error('Error finding/creating customer:', error);
      throw error;
    }
  }

  async generateCustomerNumber() {
    const lastCustomer = await Customer.findOne({}, {}, { sort: { 'customerNumber': -1 } });
    const lastNumber = lastCustomer ? parseInt(lastCustomer.customerNumber.slice(4)) : 0;
    return `CUS-${(lastNumber + 1).toString().padStart(6, '0')}`;
  }

  async processAutomatedResponses(message, customer) {
    // Implement automated response logic here
    // This could include:
    // - Welcome messages for new customers
    // - Auto-replies based on keywords
    // - Business hours responses
    // - Integration with chatbot/AI services
  }
}

export const whatsappService = new WhatsAppService();