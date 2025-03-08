import mongoose from 'mongoose';

const attachmentSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['image', 'video', 'document', 'audio', 'location'],
    required: true
  },
  url: {
    type: String,
    required: true
  },
  mimeType: String,
  size: Number,
  filename: String,
  thumbnail: String,
  duration: Number, // for audio/video
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  }
}, { _id: false });

const deliveryStatusSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read', 'failed'],
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  error: {
    code: String,
    message: String
  }
}, { _id: false });

const messageSchema = new mongoose.Schema({
  channel: {
    type: String,
    enum: ['whatsapp', 'email', 'sms'],
    required: true
  },
  direction: {
    type: String,
    enum: ['inbound', 'outbound'],
    required: true
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  template: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MessageTemplate'
  },
  content: {
    type: String,
    required: true
  },
  attachments: [attachmentSchema],
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  },
  status: {
    type: String,
    enum: ['queued', 'sending', 'sent', 'delivered', 'read', 'failed'],
    default: 'queued'
  },
  statusHistory: [deliveryStatusSchema],
  originalMessageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  thread: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MessageThread'
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  recipient: {
    type: String,
    required: true
  },
  scheduledFor: Date,
  sentAt: Date,
  deliveredAt: Date,
  readAt: Date,
  tags: [{
    type: String
  }],
  campaign: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign'
  }
}, {
  timestamps: true
});

// Indexes
messageSchema.index({ customer: 1, createdAt: -1 });
messageSchema.index({ channel: 1, status: 1 });
messageSchema.index({ thread: 1, createdAt: 1 });
messageSchema.index({ campaign: 1 });
messageSchema.index({ scheduledFor: 1, status: 1 });

// Virtual for formatted timestamp
messageSchema.virtual('formattedTimestamp').get(function() {
  return this.createdAt.toLocaleString();
});

// Update status and status history
messageSchema.methods.updateStatus = async function(status, error = null) {
  this.status = status;
  
  const statusUpdate = {
    status,
    timestamp: new Date()
  };

  if (error) {
    statusUpdate.error = {
      code: error.code,
      message: error.message
    };
  }

  this.statusHistory.push(statusUpdate);

  // Update timestamp fields
  switch (status) {
    case 'sent':
      this.sentAt = new Date();
      break;
    case 'delivered':
      this.deliveredAt = new Date();
      break;
    case 'read':
      this.readAt = new Date();
      break;
  }

  await this.save();
};

// Check if message is part of a thread
messageSchema.methods.isThreaded = function() {
  return !!this.thread;
};

// Get full thread
messageSchema.methods.getThread = async function() {
  if (!this.thread) return [];
  
  return await this.model('Message')
    .find({ thread: this.thread })
    .sort({ createdAt: 1 })
    .populate('sender', 'firstName lastName');
};

// Create a reply
messageSchema.methods.createReply = async function(content, sender) {
  const reply = new this.constructor({
    channel: this.channel,
    direction: 'outbound',
    customer: this.customer,
    content,
    sender,
    recipient: this.recipient,
    thread: this.thread || this._id,
    originalMessageId: this._id
  });

  await reply.save();
  return reply;
};

// Static method to create a new thread
messageSchema.statics.createThread = async function(messages) {
  const thread = new mongoose.Types.ObjectId();
  
  for (const message of messages) {
    message.thread = thread;
    await message.save();
  }
  
  return thread;
};

const Message = mongoose.model('Message', messageSchema);

export default Message;