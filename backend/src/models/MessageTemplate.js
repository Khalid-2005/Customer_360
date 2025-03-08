import mongoose from 'mongoose';

const variableSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  description: String,
  defaultValue: String,
  required: {
    type: Boolean,
    default: true
  },
  type: {
    type: String,
    enum: ['string', 'number', 'date', 'boolean'],
    default: 'string'
  },
  validation: {
    pattern: String,
    minLength: Number,
    maxLength: Number,
    minimum: Number,
    maximum: Number
  }
}, { _id: false });

const buttonSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['url', 'phone', 'quick_reply'],
    required: true
  },
  text: {
    type: String,
    required: true
  },
  value: {
    type: String,
    required: true
  },
  variables: [variableSchema]
}, { _id: false });

const messageTemplateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  description: String,
  category: {
    type: String,
    enum: [
      'marketing',
      'transactional',
      'customer_service',
      'notification',
      'reminder',
      'other'
    ],
    required: true
  },
  channels: [{
    type: String,
    enum: ['whatsapp', 'email', 'sms'],
    required: true
  }],
  content: {
    type: Map,
    of: {
      body: {
        type: String,
        required: true
      },
      subject: String, // for email
      preview: String, // for WhatsApp
      header: {
        type: String,
        format: {
          type: String,
          enum: ['text', 'image', 'video', 'document']
        },
        value: String
      },
      footer: String,
      buttons: [buttonSchema]
    },
    required: true
  },
  variables: [variableSchema],
  status: {
    type: String,
    enum: ['draft', 'pending_approval', 'approved', 'rejected', 'archived'],
    default: 'draft'
  },
  whatsappStatus: {
    approved: {
      type: Boolean,
      default: false
    },
    rejectionReason: String,
    namespace: String,
    templateName: String,
    language: {
      type: String,
      default: 'en'
    }
  },
  tags: [{
    type: String
  }],
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  },
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: Date,
  usage: {
    totalSent: {
      type: Number,
      default: 0
    },
    lastUsed: Date,
    deliveryRate: {
      type: Number,
      default: 0
    },
    openRate: {
      type: Number,
      default: 0
    },
    clickRate: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true
});

// Indexes
messageTemplateSchema.index({ name: 1 });
messageTemplateSchema.index({ status: 1 });
messageTemplateSchema.index({ category: 1 });
messageTemplateSchema.index({ tags: 1 });
messageTemplateSchema.index({ 'whatsappStatus.approved': 1 });

// Validate template before saving
messageTemplateSchema.pre('save', function(next) {
  // Ensure at least one channel is specified
  if (!this.channels || this.channels.length === 0) {
    next(new Error('At least one channel must be specified'));
    return;
  }

  // Validate content for each channel
  for (const channel of this.channels) {
    const channelContent = this.content.get(channel);
    
    if (!channelContent) {
      next(new Error(`Content for channel ${channel} is required`));
      return;
    }

    if (channel === 'email' && !channelContent.subject) {
      next(new Error('Subject is required for email templates'));
      return;
    }
  }

  next();
});

// Instance methods
messageTemplateSchema.methods.renderTemplate = function(variables) {
  const result = {};

  for (const [channel, content] of this.content) {
    const renderedContent = { ...content };
    
    // Replace variables in body
    renderedContent.body = this.replaceVariables(content.body, variables);
    
    // Replace variables in subject (for email)
    if (content.subject) {
      renderedContent.subject = this.replaceVariables(content.subject, variables);
    }
    
    // Replace variables in buttons
    if (content.buttons) {
      renderedContent.buttons = content.buttons.map(button => ({
        ...button,
        text: this.replaceVariables(button.text, variables),
        value: this.replaceVariables(button.value, variables)
      }));
    }

    result[channel] = renderedContent;
  }

  return result;
};

messageTemplateSchema.methods.replaceVariables = function(text, variables) {
  return text.replace(/\{\{([\w.]+)\}\}/g, (match, variable) => {
    return variables[variable] || match;
  });
};

messageTemplateSchema.methods.updateUsageStats = async function(messageStatus) {
  this.usage.totalSent++;
  this.usage.lastUsed = new Date();
  
  // Update delivery and engagement rates
  const totalMessages = this.usage.totalSent;
  const delivered = await mongoose.model('Message').countDocuments({
    template: this._id,
    status: 'delivered'
  });
  const read = await mongoose.model('Message').countDocuments({
    template: this._id,
    status: 'read'
  });
  
  this.usage.deliveryRate = (delivered / totalMessages) * 100;
  this.usage.openRate = (read / delivered) * 100;
  
  await this.save();
};

const MessageTemplate = mongoose.model('MessageTemplate', messageTemplateSchema);

export default MessageTemplate;